import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { SseService } from './sse.service';
import { ChatSummary } from '../shared/types';

@Injectable({ providedIn: 'root' })
export class ChatListService {
  private api = inject(ApiService);
  private sse = inject(SseService);

  chats = signal<ChatSummary[]>([]);
  private started = false;

  start(): void {
    if (this.started) return;
    this.started = true;
    this.reload();
    this.sse.messages.subscribe((ev) => {
      if (ev.type === 'message' && ev.chatJid && ev.chatJid.startsWith('web:')) {
        this.reload();
      }
    });
  }

  async reload(): Promise<void> {
    try {
      const list = await this.api.getWebChats();
      this.chats.set(list);
    } catch {
      this.chats.set([]);
    }
  }

  async create(name = 'New chat'): Promise<{ jid: string; name: string }> {
    const created = await this.api.createWebChat(name);
    await this.reload();
    return created;
  }

  async rename(jid: string, name: string): Promise<void> {
    await this.api.renameWebChat(jid, name);
    await this.reload();
  }

  async remove(jid: string): Promise<void> {
    await this.api.deleteWebChat(jid);
    await this.reload();
  }
}
