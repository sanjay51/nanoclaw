import { Component, inject, OnInit, OnDestroy, signal, ElementRef, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { SseService } from '../../services/sse.service';
import { StatusService } from '../../services/status.service';
import { ToastService } from '../../services/toast.service';
import { GroupDetail, MessageItem, Personality } from '../../shared/types';
import { relTime, renderMarkdown } from '../../shared/utils';

interface ChatMsg {
  text: string;
  cls: 'user' | 'bot';
  sender: string;
  timestamp: string;
  html?: SafeHtml;
  imageUrls?: string[];
}

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

  @ViewChild('messagesContainer') messagesEl!: ElementRef<HTMLDivElement>;
  @ViewChild('textInput') textInputEl!: ElementRef<HTMLTextAreaElement>;

  groups = signal<GroupDetail[]>([]);
  personalities = signal<Personality[]>([]);
  selectedPersonalityId = signal('');
  chatJid = signal('');
  messages = signal<ChatMsg[]>([]);
  inputText = '';
  pendingFiles: File[] = [];
  previewUrls = signal<string[]>([]);
  loading = signal(false);
  typing = signal(false);
  rel = relTime;

  private sub!: Subscription;

  async ngOnInit(): Promise<void> {
    const [groupList, personalityList] = await Promise.all([
      this.api.getGroups().catch(() => [] as GroupDetail[]),
      this.api.getPersonalities().catch(() => [] as Personality[]),
    ]);
    this.groups.set(groupList);
    this.personalities.set(personalityList);

    // Default to web group
    const webGroup = groupList.find(g => g.jid.startsWith('web:'));
    this.chatJid.set(webGroup?.jid || groupList[0]?.jid || '');
    this.syncPersonalityFromGroup();

    this.sub = this.sse.messages.subscribe(ev => {
      if (ev.type === 'message' && ev.text) {
        const jid = ev.chatJid || '';
        if (!this.chatJid() || !jid || jid === this.chatJid()) {
          this.addMessage(ev.text, 'bot', this.auth.assistantName(), ev.timestamp || new Date().toISOString());
          this.typing.set(false);
        }
      } else if (ev.type === 'typing') {
        this.typing.set(!!ev.isTyping);
      }
    });

    if (this.chatJid()) this.loadHistory();
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  async onGroupChange(): Promise<void> {
    this.messages.set([]);
    this.syncPersonalityFromGroup();
    if (this.chatJid()) await this.loadHistory();
  }

  async onPersonalityChange(): Promise<void> {
    const jid = this.chatJid();
    if (!jid) return;
    try {
      await this.api.updateGroup(jid, {
        personalityId: this.selectedPersonalityId() || null,
      });
      // Update local group list
      const groups = this.groups();
      const idx = groups.findIndex(g => g.jid === jid);
      if (idx >= 0) {
        const updated = { ...groups[idx], personalityId: this.selectedPersonalityId() || null };
        this.groups.set([...groups.slice(0, idx), updated, ...groups.slice(idx + 1)]);
      }
    } catch { /* silent */ }
  }

  private syncPersonalityFromGroup(): void {
    const group = this.groups().find(g => g.jid === this.chatJid());
    this.selectedPersonalityId.set(group?.personalityId || '');
  }

  async loadHistory(): Promise<void> {
    this.loading.set(true);
    try {
      const msgs = await this.api.getGroupMessages(this.chatJid());
      const chatMsgs = msgs.map(m => this.toMsg(m));
      this.messages.set(chatMsgs);
      setTimeout(() => this.scrollBottom(), 50);
    } catch {
      this.messages.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  async send(): Promise<void> {
    const text = this.inputText.trim();
    if (!text && !this.pendingFiles.length) return;

    const display = text || `[Image${this.pendingFiles.length > 1 ? 's' : ''}]`;
    this.addMessage(display, 'user', 'You', new Date().toISOString());

    // Show image previews
    if (this.pendingFiles.length) {
      const last = this.messages();
      const msg = last[last.length - 1];
      if (msg) msg.imageUrls = this.previewUrls().slice();
    }

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
    }
  }

  // File handling
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
        if (file) { this.pendingFiles.push(file); hasImage = true; }
      }
    }
    if (hasImage) { event.preventDefault(); this.updatePreviews(); }
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
    this.previewUrls.set(this.pendingFiles.map(f => URL.createObjectURL(f)));
  }

  private addMessage(text: string, cls: 'user' | 'bot', sender: string, timestamp: string): void {
    const msg: ChatMsg = { text, cls, sender, timestamp, html: this.renderHtml(text, cls) };
    this.messages.update(msgs => [...msgs, msg]);
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
    };
  }

  private renderHtml(text: string, cls: string): SafeHtml {
    let html = text;
    // Replace image refs with img tags
    const folder = this.getFolder();
    if (folder) {
      html = html.replace(/\[(Image|Photo)\]\s*\(([^)]+)\)/g, (_match, _type, filePath) => {
        const parts = filePath.match(/\/workspace\/group\/((?:attachments|generated)\/.+)/);
        if (parts) {
          const url = this.api.fileUrl(folder, parts[1]);
          return `<div class="my-2"><img src="${url}" class="max-w-72 max-h-72 rounded cursor-pointer" onclick="window.open(this.src)" loading="lazy"></div>`;
        }
        return _match;
      });
    }
    if (cls === 'bot') html = renderMarkdown(html);
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  private getFolder(): string | null {
    const s = this.status.status();
    if (!s) return null;
    const g = s.groups.find(g => g.jid === this.chatJid());
    return g?.folder || null;
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
