import { Component, inject, OnInit, signal } from '@angular/core';
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

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, FormsModule, ConnectComponent, ToastComponent],
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
    { path: '/chat', label: 'Chat', icon: '\u2709' },
    { path: '/dashboard', label: 'Dashboard', icon: '\u25A0' },
    { path: '/groups', label: 'Channels', icon: '\u2605' },
    { path: '/tasks', label: 'Tasks', icon: '\u23F0' },
    { path: '/personalities', label: 'Personalities', icon: '\u2728' },
    { path: '/credentials', label: 'Credentials', icon: '\uD83D\uDD12' },
    { path: '/system', label: 'System', icon: '\u2699' },
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
