import {
  Component,
  inject,
  OnInit,
  OnDestroy,
  signal,
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
import { MessageItem } from '../../shared/types';
import { relTime, renderMarkdown } from '../../shared/utils';

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
  private sentHistory: string[] = [];
  private historyIndex = -1;
  private draftText = '';
  pendingFiles: File[] = [];
  previewUrls = signal<string[]>([]);
  loading = signal(false);
  typing = signal(false);
  rel = relTime;
  suggestions = SUGGESTIONS;

  private subs: Subscription[] = [];

  async ngOnInit(): Promise<void> {
    this.chatList.start();

    this.subs.push(
      this.route.paramMap.subscribe(async (params) => {
        const routeJid = params.get('jid');
        if (routeJid) {
          this.chatJid.set(routeJid);
          await this.loadHistory();
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
          this.typing.set(!!ev.isTyping);
          if (ev.isTyping) setTimeout(() => this.scrollBottom(), 20);
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
    const preferred = s.groups.find((g) => g.jid === 'web:localhost');
    if (preferred) return preferred.folder;
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

  autoResize(event: Event): void {
    const el = event.target as HTMLTextAreaElement;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }
}
