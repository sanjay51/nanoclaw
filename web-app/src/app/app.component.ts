import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { LowerCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { AuthService } from './services/auth.service';
import { ChatListService } from './services/chat-list.service';
import { SseService } from './services/sse.service';
import { StatusService } from './services/status.service';
import { ThemeService } from './services/theme.service';
import { ToastService } from './services/toast.service';
import { ConnectComponent } from './components/connect/connect.component';
import { ToastComponent } from './components/toast/toast.component';
import { ChatSummary } from './shared/types';
import { relTime } from './shared/utils';

interface ConversationItem {
  kind: 'chat' | 'chat-with-task' | 'task';
  jid: string;          // unique key (equal to chat_jid — 1 row per chat)
  targetJid: string;    // chat_jid to navigate to when clicked
  name: string;
  subtitle: string;     // schedule summary for task-bearing rows
  sortTime: string;
  channel: string;
  status: string;       // task status ('active' | 'paused' | '' for plain chats)
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, FormsModule, LowerCasePipe, ConnectComponent, ToastComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements OnInit {
  auth = inject(AuthService);
  sse = inject(SseService);
  status = inject(StatusService);
  theme = inject(ThemeService);
  toast = inject(ToastService);
  chatList = inject(ChatListService);
  private router = inject(Router);

  rel = relTime;
  editingJid = signal('');
  editingName = '';

  navItems = [
    { path: '/chat', label: 'Chat' },
    { path: '/groups', label: 'Channels' },
    { path: '/personalities', label: 'Personalities' },
    { path: '/credentials', label: 'Credentials' },
  ];

  ngOnInit(): void {
    const saved = this.auth.getSavedCredentials();
    if (saved) {
      this.autoConnect(saved.endpoint, saved.token);
    }
  }

  private async autoConnect(endpoint: string, token: string): Promise<void> {
    try {
      const url = endpoint.replace(/\/+$/, '');
      const res = await fetch(url + '/api/status', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return;
      const data = await res.json();
      this.auth.connect(endpoint, token, data.assistant || 'Romi');
      this.sse.connect();
      this.status.refresh();
      this.status.startPolling();
      this.chatList.start();
    } catch { /* silent */ }
  }

  disconnect(): void {
    this.sse.disconnect();
    this.status.stopPolling();
    this.auth.disconnect();
  }

  currentChatJid(): string {
    const url = this.router.url;
    const m = url.match(/^\/chat\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  chatHasTask(jid: string): boolean {
    const tasks = this.status.status()?.tasks || [];
    return tasks.some((t: any) => t.chatJid === jid);
  }

  /**
   * Unified conversation list — one entry per chat_jid. A chat may optionally
   * have one attached task (shown as a ⏰ marker on the same row). Non-web
   * chat_jids only appear if they have a task bound. This enforces the 1:1
   * chat↔task rule at the UI level; duplicate tasks on the same chat_jid
   * collapse to the first.
   */
  conversations = computed<ConversationItem[]>(() => {
    const webChats = this.chatList.chats();
    const s = this.status.status();
    const tasks: any[] = s?.tasks || [];
    const groups: any[] = s?.groups || [];

    // Pick the most recently scheduled task per chat_jid so duplicates land on
    // the latest one rather than whatever happened to be first in the list.
    const taskByJid = new Map<string, any>();
    const score = (t: any) => t.nextRun || t.lastRun || t.id || '';
    for (const t of tasks) {
      if (!t.chatJid) continue;
      const prev = taskByJid.get(t.chatJid);
      if (!prev || score(t) > score(prev)) taskByJid.set(t.chatJid, t);
    }

    const items: ConversationItem[] = [];
    const seen = new Set<string>();

    for (const c of webChats) {
      const t = taskByJid.get(c.jid);
      items.push({
        kind: t ? 'chat-with-task' : 'chat',
        jid: c.jid,
        targetJid: c.jid,
        name: c.name,
        subtitle: t ? this.humanSchedule(t.type, t.value) : '',
        sortTime: c.last_message_time || t?.nextRun || t?.lastRun || '',
        channel: 'web',
        status: t?.status || '',
      });
      seen.add(c.jid);
    }

    for (const [jid, t] of taskByJid) {
      if (seen.has(jid)) continue;
      const g = groups.find((gr) => gr.jid === jid);
      const fallback = (t.prompt || '').split('\n')[0].slice(0, 60).trim();
      items.push({
        kind: 'task',
        jid,
        targetJid: jid,
        name: g?.name || fallback || jid,
        subtitle: this.humanSchedule(t.type, t.value),
        sortTime: t.nextRun || t.lastRun || '',
        channel: jid.split(':')[0] || 'unknown',
        status: t.status,
      });
      seen.add(jid);
    }

    items.sort((a, b) => (b.sortTime || '').localeCompare(a.sortTime || ''));
    return items;
  });

  isWebChat(jid: string): boolean {
    return jid.startsWith('web:');
  }

  private humanSchedule(type: string, value: string): string {
    if (type === 'once') {
      const d = new Date(value);
      return isNaN(d.getTime()) ? 'once' : 'once @ ' + d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    }
    if (type === 'interval') {
      const ms = parseInt(value, 10);
      if (isNaN(ms)) return 'interval';
      if (ms < 60000) return `every ${Math.round(ms / 1000)}s`;
      if (ms < 3600000) return `every ${Math.round(ms / 60000)}m`;
      if (ms < 86400000) return `every ${Math.round(ms / 3600000)}h`;
      return `every ${Math.round(ms / 86400000)}d`;
    }
    if (type === 'cron') {
      const parts = (value || '').trim().split(/\s+/);
      if (parts.length === 5) {
        const [m, h, dom, mon, dow] = parts;
        const isNum = (s: string) => /^\d+$/.test(s);
        if (m === '0' && h === '*' && dom === '*' && mon === '*' && dow === '*') return 'every hour';
        if (dom === '*' && mon === '*' && dow === '*' && isNum(m) && isNum(h)) {
          return `daily @ ${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
        }
        if (dom === '*' && mon === '*' && isNum(dow) && isNum(m) && isNum(h)) {
          const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          return `weekly ${days[parseInt(dow, 10)] || dow} @ ${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
        }
      }
      return value;
    }
    return `${type}: ${value}`;
  }

  startRenameFromItem(item: ConversationItem, event: Event): void {
    event.stopPropagation();
    const chat = this.chatList.chats().find((c) => c.jid === item.jid);
    if (!chat) return;
    this.editingJid.set(item.jid);
    this.editingName = chat.name;
  }

  async commitRenameFromItem(item: ConversationItem): Promise<void> {
    const chat = this.chatList.chats().find((c) => c.jid === item.jid);
    if (!chat) { this.editingJid.set(''); return; }
    await this.commitRename(chat);
  }

  async deleteFromItem(item: ConversationItem, event: Event): Promise<void> {
    const chat = this.chatList.chats().find((c) => c.jid === item.jid);
    if (!chat) return;
    await this.deleteChat(chat, event);
  }

  async newChat(): Promise<void> {
    try {
      const created = await this.chatList.create();
      this.router.navigate(['/chat', created.jid]);
    } catch (e: any) {
      this.toast.show(e.message, true);
    }
  }

  selectChat(jid: string): void {
    if (jid === this.currentChatJid()) return;
    this.router.navigate(['/chat', jid]);
  }

  startRename(chat: ChatSummary, event: Event): void {
    event.stopPropagation();
    this.editingJid.set(chat.jid);
    this.editingName = chat.name;
  }

  async commitRename(chat: ChatSummary): Promise<void> {
    const name = this.editingName.trim();
    this.editingJid.set('');
    if (!name || name === chat.name) return;
    try {
      await this.chatList.rename(chat.jid, name);
    } catch (e: any) {
      this.toast.show(e.message, true);
    }
  }

  async deleteChat(chat: ChatSummary, event: Event): Promise<void> {
    event.stopPropagation();
    if (!confirm(`Delete "${chat.name}"? This removes its messages and context.`))
      return;
    try {
      await this.chatList.remove(chat.jid);
      if (chat.jid === this.currentChatJid()) {
        const list = this.chatList.chats();
        if (list.length) {
          this.router.navigate(['/chat', list[0].jid]);
        } else {
          this.newChat();
        }
      }
    } catch (e: any) {
      this.toast.show(e.message, true);
    }
  }
}
