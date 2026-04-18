import {
  Component,
  inject,
  OnInit,
  OnDestroy,
  signal,
  computed,
  ElementRef,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { ChatListService } from '../../services/chat-list.service';
import { SseService } from '../../services/sse.service';
import { StatusService } from '../../services/status.service';
import { ToastService } from '../../services/toast.service';
import { MessageItem, TaskSummary } from '../../shared/types';
import { relTime, renderMarkdown } from '../../shared/utils';

type SchedMode = 'once' | 'recurring';
type SchedPreset = 'hourly' | 'daily' | 'weekly' | 'custom';

interface LinkPreview {
  url: string;
  kind: 'image' | 'link';
  host?: string;
}

interface ChatMsg {
  text: string;
  cls: 'user' | 'bot';
  sender: string;
  timestamp: string;
  html?: SafeHtml;
  imageUrls?: string[];
  previews?: LinkPreview[];
}

const SUGGESTIONS = [
  'Summarize the latest AI research in 5 bullets',
  'Plan a 3-day trip to Lisbon with a $800 budget',
  'Draft a polite follow-up email for a delayed invoice',
  'Explain async/await to a junior engineer',
];

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './chat.component.html',
})
export class ChatComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  auth = inject(AuthService);
  private sse = inject(SseService);
  private status = inject(StatusService);
  private toast = inject(ToastService);
  private sanitizer = inject(DomSanitizer);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private chatList = inject(ChatListService);

  @ViewChild('messagesContainer') messagesEl!: ElementRef<HTMLDivElement>;
  @ViewChild('textInput') textInputEl!: ElementRef<HTMLTextAreaElement>;

  chatJid = signal('');
  messages = signal<ChatMsg[]>([]);

  inputText = '';
  private drafts = new Map<string, string>();
  private sentHistory: string[] = [];
  private historyIndex = -1;
  private draftText = '';
  pendingFiles: File[] = [];
  previewUrls = signal<string[]>([]);
  loading = signal(false);
  typing = signal(false);
  rel = relTime;
  suggestions = SUGGESTIONS;

  // Schedule attachment
  attachedTask = signal<TaskSummary | null>(null);
  scheduleOpen = signal(false);
  schedSaving = signal(false);
  schedRunning = signal(false);

  schedPrompt = '';
  schedMode = signal<SchedMode>('recurring');
  schedPreset = signal<SchedPreset>('daily');
  schedPresets: SchedPreset[] = ['hourly', 'daily', 'weekly', 'custom'];
  schedWhen: 'now' | 'later' = 'later';
  schedOnceAt = '';
  schedDailyTime = '09:00';
  schedWeeklyDow: '0'|'1'|'2'|'3'|'4'|'5'|'6' = '1';
  schedWeeklyTime = '09:00';
  schedCustomCron = '0 9 * * *';

  scheduleSummary = computed(() => this.summarizeTask(this.attachedTask()));

  // Heuristic: does what the user is about to send look like a schedule
  // change? Surface a hint above the send button so the agent isn't asked to
  // do something it can't.
  looksLikeScheduleRequest = computed(() => {
    const text = (this.inputText || '').trim();
    if (!text || text.length > 240) return false;
    return /\b(in\s+\d+\s*(minute|min|hour|hr|hrs|day|days|second|sec|secs)s?\b|tomorrow\b|every\s+(day|hour|week|minute|morning|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|daily|hourly|weekly|at\s+\d{1,2}(:\d{2})?\s*(am|pm)?|remind\s+me\b|send\s+me\b.*\b(later|soon|after|minutes?|hours?|days?)\b|schedule\b)/i.test(text);
  });

  private subs: Subscription[] = [];

  async ngOnInit(): Promise<void> {
    this.chatList.start();

    this.subs.push(
      this.route.paramMap.subscribe(async (params) => {
        const routeJid = params.get('jid');
        if (routeJid) {
          this.saveDraft();
          this.chatJid.set(routeJid);
          this.inputText = this.drafts.get(routeJid) ?? '';
          this.scheduleOpen.set(false);
          setTimeout(() => this.autoResizeNow(), 0);
          await this.loadHistory();
          this.refreshAttachedTask();
        } else {
          const list = this.chatList.chats();
          if (list.length > 0) {
            this.router.navigate(['/chat', list[0].jid], { replaceUrl: true });
          } else {
            await this.createAndNavigate(true);
          }
        }
      }),
    );

    this.subs.push(
      this.sse.messages.subscribe((ev) => {
        if (ev.type === 'message' && ev.text) {
          const jid = ev.chatJid || '';
          if (jid === this.chatJid()) {
            this.addMessage(
              ev.text,
              'bot',
              this.auth.assistantName(),
              ev.timestamp || new Date().toISOString(),
            );
            this.typing.set(false);
          }
        } else if (ev.type === 'typing') {
          // Typing events carry chatJid; legacy events without one fall back
          // to applying to the current chat.
          const typingJid = ev.chatJid || this.chatJid();
          if (typingJid === this.chatJid()) {
            this.typing.set(!!ev.isTyping);
            if (ev.isTyping) setTimeout(() => this.scrollBottom(), 20);
          }
        }
      }),
    );
  }

  ngOnDestroy(): void {
    for (const s of this.subs) s.unsubscribe();
  }

  private async createAndNavigate(replaceUrl = false): Promise<void> {
    try {
      const created = await this.chatList.create();
      this.router.navigate(['/chat', created.jid], { replaceUrl });
    } catch (e: any) {
      this.toast.show(e.message, true);
    }
  }

  async loadHistory(): Promise<void> {
    const jid = this.chatJid();
    this.typing.set(false);
    if (!jid) {
      this.messages.set([]);
      return;
    }
    this.loading.set(true);
    try {
      const msgs = await this.api.getChatMessages(jid);
      this.messages.set(msgs.map((m) => this.toMsg(m)));
      setTimeout(() => this.scrollBottom(), 50);
    } catch {
      this.messages.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  pickSuggestion(text: string): void {
    this.inputText = text;
    setTimeout(() => this.textInputEl?.nativeElement.focus(), 0);
  }

  async send(): Promise<void> {
    const text = this.inputText.trim();
    if (!text && !this.pendingFiles.length) return;
    if (!this.chatJid()) {
      await this.createAndNavigate();
      if (!this.chatJid()) return;
    }

    const display = text || `[Image${this.pendingFiles.length > 1 ? 's' : ''}]`;
    this.addMessage(display, 'user', 'You', new Date().toISOString());

    if (this.pendingFiles.length) {
      const last = this.messages();
      const msg = last[last.length - 1];
      if (msg) msg.imageUrls = this.previewUrls().slice();
    }

    // Rename chat from "New chat" on first user message
    const currentChat = this.chatList.chats().find((c) => c.jid === this.chatJid());
    if (currentChat && currentChat.name === 'New chat' && text) {
      const title = text.split('\n')[0].slice(0, 60).trim();
      if (title) this.chatList.rename(currentChat.jid, title).catch(() => {});
    }

    this.sentHistory.unshift(text);
    this.historyIndex = -1;
    this.draftText = '';
    this.inputText = '';
    this.drafts.delete(this.chatJid());
    this.resetTextarea();

    try {
      if (this.pendingFiles.length) {
        await this.api.uploadImages(this.pendingFiles, this.chatJid(), text || undefined);
        this.clearFiles();
      } else {
        await this.api.sendMessage(text, this.chatJid());
      }
    } catch (e: any) {
      this.addMessage('Error: ' + e.message, 'bot', 'System', new Date().toISOString());
    }
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.send();
      return;
    }

    if (event.key === 'ArrowUp' && this.sentHistory.length > 0) {
      const el = this.textInputEl?.nativeElement;
      if (el && el.selectionStart === 0 && el.selectionEnd === 0) {
        event.preventDefault();
        if (this.historyIndex === -1) this.draftText = this.inputText;
        if (this.historyIndex < this.sentHistory.length - 1) {
          this.historyIndex++;
          this.inputText = this.sentHistory[this.historyIndex];
        }
      }
    }

    if (event.key === 'ArrowDown' && this.historyIndex >= 0) {
      const el = this.textInputEl?.nativeElement;
      const atEnd = el && el.selectionStart === el.value.length;
      if (atEnd) {
        event.preventDefault();
        this.historyIndex--;
        this.inputText =
          this.historyIndex >= 0
            ? this.sentHistory[this.historyIndex]
            : this.draftText;
      }
    }
  }

  onFileSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files) this.addFiles(input.files);
    input.value = '';
  }

  onPaste(event: ClipboardEvent): void {
    const items = event.clipboardData?.items;
    if (!items) return;
    let hasImage = false;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) {
          this.pendingFiles.push(file);
          hasImage = true;
        }
      }
    }
    if (hasImage) {
      event.preventDefault();
      this.updatePreviews();
    }
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    (event.target as HTMLElement).classList.remove('ring-2');
    if (event.dataTransfer?.files.length) this.addFiles(event.dataTransfer.files);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  removeFile(idx: number): void {
    this.pendingFiles.splice(idx, 1);
    this.updatePreviews();
  }

  clearFiles(): void {
    this.pendingFiles = [];
    this.previewUrls.set([]);
  }

  private addFiles(fileList: FileList): void {
    for (let i = 0; i < fileList.length; i++) {
      if (fileList[i].type.startsWith('image/')) this.pendingFiles.push(fileList[i]);
    }
    this.updatePreviews();
  }

  private updatePreviews(): void {
    this.previewUrls.set(this.pendingFiles.map((f) => URL.createObjectURL(f)));
  }

  private addMessage(
    text: string,
    cls: 'user' | 'bot',
    sender: string,
    timestamp: string,
  ): void {
    const msg: ChatMsg = {
      text,
      cls,
      sender,
      timestamp,
      html: this.renderHtml(text, cls),
      previews: this.extractPreviews(text),
    };
    this.messages.update((msgs) => [...msgs, msg]);
    setTimeout(() => this.scrollBottom(), 20);
  }

  private toMsg(m: MessageItem): ChatMsg {
    const cls: 'user' | 'bot' = m.is_bot_message ? 'bot' : 'user';
    return {
      text: m.content,
      cls,
      sender: m.sender_name,
      timestamp: m.timestamp,
      html: this.renderHtml(m.content, cls),
      previews: this.extractPreviews(m.content),
    };
  }

  private renderHtml(text: string, cls: string): SafeHtml {
    let html = text;
    const folder = this.getFolder();
    if (folder) {
      html = html.replace(/\[(Image|Photo)\]\s*\(([^)]+)\)/g, (m, _t, fp) => {
        const parts = fp.match(/\/workspace\/group\/((?:attachments|generated)\/.+)/);
        if (parts) {
          const url = this.api.fileUrl(folder, parts[1]);
          return `<div class="my-2"><img src="${url}" class="max-w-72 max-h-72 rounded cursor-pointer" onclick="window.open(this.src)" loading="lazy"></div>`;
        }
        return m;
      });
    }
    if (cls === 'bot') html = renderMarkdown(html);
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  private extractPreviews(text: string): LinkPreview[] {
    const urlRe = /https?:\/\/[^\s<>"'`)]+/gi;
    const imageExt = /\.(png|jpe?g|gif|webp|svg|bmp)(\?|$)/i;
    const seen = new Set<string>();
    const out: LinkPreview[] = [];
    for (const match of text.matchAll(urlRe)) {
      let url = match[0].replace(/[.,;:!?)\]]+$/, '');
      if (seen.has(url)) continue;
      seen.add(url);
      let host: string | undefined;
      try {
        host = new URL(url).host;
      } catch {
        continue;
      }
      out.push({ url, kind: imageExt.test(url) ? 'image' : 'link', host });
      if (out.length >= 4) break;
    }
    return out;
  }

  private getFolder(): string | null {
    const s = this.status.status();
    if (!s) return null;
    const jid = this.chatJid();

    // Exact JID match (e.g. tg:123 → telegram_main folder).
    const exact = s.groups.find((g) => g.jid === jid);
    if (exact) return exact.folder;

    // Same channel prefix (e.g. web:abc falls back to web:localhost's folder).
    const prefix = jid.split(':')[0] + ':';
    const sameChannel = s.groups.find((g) => g.jid.startsWith(prefix));
    if (sameChannel) return sameChannel.folder;

    // Last resort — any web group.
    const anyWeb = s.groups.find((g) => g.jid.startsWith('web:'));
    return anyWeb?.folder || null;
  }

  private scrollBottom(): void {
    if (this.messagesEl?.nativeElement) {
      this.messagesEl.nativeElement.scrollTop = this.messagesEl.nativeElement.scrollHeight;
    }
  }

  private resetTextarea(): void {
    if (this.textInputEl?.nativeElement) {
      this.textInputEl.nativeElement.style.height = 'auto';
    }
  }

  private autoResizeNow(): void {
    const el = this.textInputEl?.nativeElement;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }

  private saveDraft(): void {
    const jid = this.chatJid();
    if (!jid) return;
    const text = this.inputText;
    if (text && text.length) this.drafts.set(jid, text);
    else this.drafts.delete(jid);
  }

  autoResize(event: Event): void {
    const el = event.target as HTMLTextAreaElement;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }

  // -------- Schedule attachment --------

  refreshAttachedTask(): void {
    const jid = this.chatJid();
    if (!jid) { this.attachedTask.set(null); return; }
    const tasks = (this.status.status()?.tasks || []) as TaskSummary[];
    const match = tasks.find((t) => t.chatJid === jid) || null;
    this.attachedTask.set(match);
    if (match) this.populateEditorFromTask(match);
  }

  private populateEditorFromTask(t: TaskSummary): void {
    this.schedPrompt = t.prompt;
    if (t.type === 'once') {
      this.schedMode.set('once');
      this.schedWhen = 'later';
      const d = new Date(t.value);
      if (!isNaN(d.getTime())) this.schedOnceAt = this.toLocalDateTime(d);
    } else if (t.type === 'cron') {
      this.schedMode.set('recurring');
      const parts = (t.value || '').trim().split(/\s+/);
      if (parts.length === 5) {
        const [m, h, dom, mon, dow] = parts;
        const isNum = (s: string) => /^\d+$/.test(s);
        if (m === '0' && h === '*' && dom === '*' && mon === '*' && dow === '*') {
          this.schedPreset.set('hourly');
        } else if (dom === '*' && mon === '*' && dow === '*' && isNum(m) && isNum(h)) {
          this.schedPreset.set('daily');
          this.schedDailyTime = h.padStart(2, '0') + ':' + m.padStart(2, '0');
        } else if (dom === '*' && mon === '*' && isNum(dow) && isNum(m) && isNum(h)) {
          this.schedPreset.set('weekly');
          this.schedWeeklyDow = dow as any;
          this.schedWeeklyTime = h.padStart(2, '0') + ':' + m.padStart(2, '0');
        } else {
          this.schedPreset.set('custom');
          this.schedCustomCron = t.value;
        }
      } else {
        this.schedPreset.set('custom');
        this.schedCustomCron = t.value;
      }
    }
  }

  summarizeTask(t: TaskSummary | null): string {
    if (!t) return '';
    if (t.type === 'once') {
      const d = new Date(t.value);
      return isNaN(d.getTime()) ? 'Once' : 'Once at ' + d.toLocaleString();
    }
    if (t.type === 'cron') {
      const parts = (t.value || '').trim().split(/\s+/);
      if (parts.length === 5) {
        const [m, h, dom, mon, dow] = parts;
        const isNum = (s: string) => /^\d+$/.test(s);
        if (m === '0' && h === '*' && dom === '*' && mon === '*' && dow === '*') return 'Every hour';
        if (dom === '*' && mon === '*' && dow === '*' && isNum(m) && isNum(h)) {
          return 'Daily at ' + h.padStart(2, '0') + ':' + m.padStart(2, '0');
        }
        if (dom === '*' && mon === '*' && isNum(dow) && isNum(m) && isNum(h)) {
          const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          return 'Weekly on ' + (days[parseInt(dow, 10)] || dow) + ' at ' + h.padStart(2, '0') + ':' + m.padStart(2, '0');
        }
      }
      return 'Cron: ' + t.value;
    }
    return t.type + ': ' + t.value;
  }

  openScheduleEditor(): void {
    const existing = this.attachedTask();
    if (existing) {
      this.populateEditorFromTask(existing);
    } else {
      this.schedPrompt = '';
      this.schedMode.set('recurring');
      this.schedPreset.set('daily');
      this.schedWhen = 'later';
      this.schedOnceAt = this.toLocalDateTime(new Date(Date.now() + 5 * 60 * 1000));
    }
    this.scheduleOpen.set(true);
  }

  /**
   * Turn the text currently in the input box into a scheduled task.
   * Tries to guess a "in N min/hours" clause; falls back to one-off in 5 min.
   */
  scheduleInputAsTask(): void {
    const text = (this.inputText || '').trim();
    const parsed = this.parseInlineSchedule(text);

    this.schedPrompt = parsed.prompt || text || '';
    if (parsed.mode === 'once') {
      this.schedMode.set('once');
      this.schedWhen = 'later';
      this.schedOnceAt = this.toLocalDateTime(parsed.when);
    } else {
      this.schedMode.set('recurring');
      this.schedPreset.set('daily');
      this.schedWhen = 'later';
      this.schedOnceAt = this.toLocalDateTime(new Date(Date.now() + 5 * 60 * 1000));
    }
    this.scheduleOpen.set(true);
  }

  /**
   * Best-effort extraction of "in N minutes/hours/days" or "tomorrow" from the
   * end or beginning of a prompt; returns the cleaned prompt plus a target
   * datetime. Falls back to now+5min if no cue is found.
   */
  private parseInlineSchedule(text: string): { prompt: string; mode: 'once'; when: Date } {
    const fallback = new Date(Date.now() + 5 * 60 * 1000);
    if (!text) return { prompt: '', mode: 'once', when: fallback };

    // "in N minutes|mins|hours|hrs|days"
    const rel = text.match(/\bin\s+(\d+)\s*(minute|min|hour|hr|hrs|day|days)s?\b/i);
    if (rel) {
      const n = parseInt(rel[1], 10);
      const unit = rel[2].toLowerCase();
      const ms = unit.startsWith('min') ? n * 60_000
        : unit.startsWith('hr') || unit.startsWith('hour') ? n * 3_600_000
        : n * 86_400_000;
      return {
        prompt: text.replace(rel[0], '').trim(),
        mode: 'once',
        when: new Date(Date.now() + ms),
      };
    }

    // "tomorrow at 9" / "tomorrow at 9am"
    const tom = text.match(/\btomorrow(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?\b/i);
    if (tom) {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      if (tom[1]) {
        let h = parseInt(tom[1], 10);
        const m = tom[2] ? parseInt(tom[2], 10) : 0;
        const ampm = (tom[3] || '').toLowerCase();
        if (ampm === 'pm' && h < 12) h += 12;
        if (ampm === 'am' && h === 12) h = 0;
        d.setHours(h, m, 0, 0);
      } else {
        d.setHours(9, 0, 0, 0);
      }
      return { prompt: text.replace(tom[0], '').trim(), mode: 'once', when: d };
    }

    return { prompt: text, mode: 'once', when: fallback };
  }

  presetLabel(p: SchedPreset): string {
    return p === 'hourly' ? 'Every hour' : p === 'daily' ? 'Daily' : p === 'weekly' ? 'Weekly' : 'Custom cron';
  }

  previewSchedule(): string {
    if (this.schedMode() === 'once') {
      if (this.schedWhen === 'now') return 'Run now';
      if (!this.schedOnceAt) return 'Pick a time';
      const d = new Date(this.schedOnceAt);
      return isNaN(d.getTime()) ? 'Pick a time' : 'Once at ' + d.toLocaleString();
    }
    const p = this.schedPreset();
    if (p === 'hourly') return 'Every hour';
    if (p === 'daily') return 'Daily at ' + this.schedDailyTime;
    if (p === 'weekly') {
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      return 'Weekly on ' + days[parseInt(this.schedWeeklyDow, 10)] + ' at ' + this.schedWeeklyTime;
    }
    return 'Cron: ' + this.schedCustomCron;
  }

  private toLocalDateTime(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  private buildSchedule(): { type: 'once' | 'cron'; value: string } | null {
    if (this.schedMode() === 'once') {
      if (this.schedWhen === 'now') return { type: 'once', value: new Date().toISOString() };
      if (!this.schedOnceAt) { this.toast.show('Pick a date/time', true); return null; }
      return { type: 'once', value: new Date(this.schedOnceAt).toISOString() };
    }
    const p = this.schedPreset();
    if (p === 'hourly') return { type: 'cron', value: '0 * * * *' };
    if (p === 'daily') {
      const [h, m] = (this.schedDailyTime || '09:00').split(':');
      return { type: 'cron', value: `${parseInt(m, 10)} ${parseInt(h, 10)} * * *` };
    }
    if (p === 'weekly') {
      const [h, m] = (this.schedWeeklyTime || '09:00').split(':');
      return { type: 'cron', value: `${parseInt(m, 10)} ${parseInt(h, 10)} * * ${this.schedWeeklyDow}` };
    }
    const cron = this.schedCustomCron.trim();
    if (!cron) { this.toast.show('Enter a cron expression', true); return null; }
    return { type: 'cron', value: cron };
  }

  private allTasksForChat(): any[] {
    const jid = this.chatJid();
    return ((this.status.status()?.tasks || []) as any[]).filter((t) => t.chatJid === jid);
  }

  async saveSchedule(): Promise<void> {
    const chatJid = this.chatJid();
    if (!chatJid) { this.toast.show('No chat loaded', true); return; }
    const prompt = this.schedPrompt.trim();
    if (!prompt) { this.toast.show('Enter an instruction for each run', true); return; }
    const sched = this.buildSchedule();
    if (!sched) return;
    const folder = this.getFolder();
    if (!folder) { this.toast.show('No web group folder available', true); return; }

    this.schedSaving.set(true);
    try {
      const existing = this.allTasksForChat();
      if (existing.length > 0) {
        // Update the first, delete the rest (1:1 enforcement).
        const [keep, ...extra] = existing;
        await this.api.updateTask(keep.id, {
          prompt,
          schedule_type: sched.type,
          schedule_value: sched.value,
        });
        await Promise.all(extra.map((t) => this.api.deleteTask(t.id).catch(() => null)));
        this.toast.show(extra.length ? `Schedule updated (${extra.length} duplicate${extra.length > 1 ? 's' : ''} removed)` : 'Schedule updated');
      } else {
        await this.api.createTask({
          prompt,
          group_folder: folder,
          chat_jid: chatJid,
          schedule_type: sched.type,
          schedule_value: sched.value,
          context_mode: 'group',
        });
        this.toast.show('Schedule attached');
      }

      // Rename the chat to reflect the current prompt so the sidebar title
      // stays in sync. Only applies to web chats (rename API is web-only).
      if (chatJid.startsWith('web:')) {
        const desired = prompt.split('\n')[0].slice(0, 60).trim();
        const current = this.chatList.chats().find((c) => c.jid === chatJid)?.name;
        const shouldRename =
          desired && current && current !== desired && (current === 'New chat' || current === 'Web Chat' || this.looksLikePromptDerivedName(current));
        if (shouldRename) {
          await this.chatList.rename(chatJid, desired).catch(() => null);
        }
      }

      this.scheduleOpen.set(false);
      await this.status.refresh();
      this.refreshAttachedTask();
    } catch (e: any) {
      this.toast.show(e.message, true);
    } finally {
      this.schedSaving.set(false);
    }
  }

  /** Heuristic: was this chat name auto-derived from a prior prompt? */
  private looksLikePromptDerivedName(name: string): boolean {
    // Auto-derived names were generated from the first 60 chars of a prompt.
    // User-chosen names are typically shorter or obviously custom; this guard
    // avoids clobbering custom names.
    return name.length > 30 && !/\s{2,}/.test(name);
  }

  async removeSchedule(): Promise<void> {
    const all = this.allTasksForChat();
    if (!all.length) return;
    if (!confirm('Remove the schedule from this chat? The chat itself will stay.')) return;
    try {
      await Promise.all(all.map((t) => this.api.deleteTask(t.id).catch(() => null)));
      this.toast.show('Schedule removed');
      this.scheduleOpen.set(false);
      this.attachedTask.set(null);
      this.status.refresh();
    } catch (e: any) { this.toast.show(e.message, true); }
  }

  async schedRunNow(): Promise<void> {
    const t = this.attachedTask();
    if (!t) return;
    this.schedRunning.set(true);
    try {
      await this.api.runTask(t.id);
      this.toast.show('Queued — scheduler will pick this up shortly');
      this.status.refresh();
    } catch (e: any) {
      this.toast.show(e.message, true);
    } finally {
      this.schedRunning.set(false);
    }
  }

  async togglePause(): Promise<void> {
    const t = this.attachedTask();
    if (!t) return;
    const next = t.status === 'paused' ? 'active' : 'paused';
    try {
      await this.api.updateTask(t.id, { status: next });
      this.toast.show('Schedule ' + (next === 'paused' ? 'paused' : 'resumed'));
      await this.status.refresh();
      this.refreshAttachedTask();
    } catch (e: any) { this.toast.show(e.message, true); }
  }
}
