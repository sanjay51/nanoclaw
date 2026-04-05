import { Component, inject, OnInit, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ApiService } from '../../services/api.service';
import { ToastService } from '../../services/toast.service';
import { StatusData, SessionInfo, ChatSummary } from '../../shared/types';
import { relTime } from '../../shared/utils';

@Component({
  selector: 'app-system',
  standalone: true,
  template: `
    <div class="px-6 py-4 border-b border-border bg-surface">
      <h2 class="text-lg font-semibold">System</h2>
    </div>
    <div class="p-6 overflow-y-auto flex-1 space-y-6">
      <!-- Channels -->
      <section>
        <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2 pb-1.5 border-b border-border">Channels</h3>
        @if (status(); as s) {
          <table class="w-full text-sm">
            <thead><tr class="text-xs text-zinc-500 uppercase tracking-wider">
              <th class="text-left px-3 py-2">Channel</th><th class="text-left px-3 py-2">Status</th><th class="text-left px-3 py-2">Groups</th>
            </tr></thead>
            <tbody>
              @for (ch of s.channels; track ch.name) {
                <tr class="border-t border-border">
                  <td class="px-3 py-2.5">{{ ch.name }}</td>
                  <td class="px-3 py-2.5"><span class="text-xs px-2 py-0.5 rounded-full border" [class]="ch.connected ? 'bg-green-500/10 text-green-400 border-green-500/30' : 'bg-red-500/10 text-red-400 border-red-500/30'">{{ ch.connected ? 'online' : 'offline' }}</span></td>
                  <td class="px-3 py-2.5 text-zinc-500">{{ channelGroupNames(ch) }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>
      <!-- Sessions -->
      <section>
        <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2 pb-1.5 border-b border-border">Sessions</h3>
        @if (sessions().length) {
          <table class="w-full text-sm">
            <thead><tr class="text-xs text-zinc-500 uppercase tracking-wider">
              <th class="text-left px-3 py-2">Group Folder</th><th class="text-left px-3 py-2">Session ID</th><th class="text-left px-3 py-2">Action</th>
            </tr></thead>
            <tbody>
              @for (s of sessions(); track s.folder) {
                <tr class="border-t border-border">
                  <td class="px-3 py-2.5"><code class="text-xs">{{ s.folder }}</code></td>
                  <td class="px-3 py-2.5"><code class="text-[11px] text-zinc-500">{{ s.sessionId.slice(0, 24) }}...</code></td>
                  <td class="px-3 py-2.5"><button (click)="clearSession(s.folder)" class="text-xs px-2 py-1 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10">Clear</button></td>
                </tr>
              }
            </tbody>
          </table>
        } @else { <p class="text-zinc-500 italic text-sm">No active sessions</p> }
      </section>
      <!-- Chats -->
      <section>
        <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2 pb-1.5 border-b border-border">All Chats ({{ chats().length }})</h3>
        @if (chats().length) {
          <table class="w-full text-sm">
            <thead><tr class="text-xs text-zinc-500 uppercase tracking-wider">
              <th class="text-left px-3 py-2">Name</th><th class="text-left px-3 py-2">JID</th><th class="text-left px-3 py-2">Channel</th><th class="text-left px-3 py-2">Type</th><th class="text-left px-3 py-2">Last Activity</th>
            </tr></thead>
            <tbody>
              @for (c of chats().slice(0, 50); track c.jid) {
                <tr class="border-t border-border">
                  <td class="px-3 py-2.5">{{ c.name || '-' }}</td>
                  <td class="px-3 py-2.5"><code class="text-[11px] text-zinc-500">{{ c.jid }}</code></td>
                  <td class="px-3 py-2.5 text-zinc-500">{{ c.channel || '-' }}</td>
                  <td class="px-3 py-2.5">{{ c.is_group ? 'group' : 'direct' }}</td>
                  <td class="px-3 py-2.5 text-zinc-500">{{ rel(c.last_message_time) }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>
      <!-- Logs -->
      <section>
        <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2 pb-1.5 border-b border-border">Recent Logs</h3>
        <div class="flex gap-2 mb-3">
          <button (click)="loadLogs('all')" class="text-xs px-3 py-1.5 rounded border border-border hover:bg-zinc-800">All Logs</button>
          <button (click)="loadLogs('error')" class="text-xs px-3 py-1.5 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10">Error Logs</button>
        </div>
        @if (logHtml()) {
          <div class="max-h-96 overflow-y-auto bg-[#0d0d0d] border border-border rounded p-3 font-mono text-[11px] leading-relaxed text-zinc-500 whitespace-pre-wrap break-all" [innerHTML]="logHtml()"></div>
        } @else {
          <p class="text-zinc-600 text-sm italic">Click a button to load logs</p>
        }
      </section>
    </div>
  `,
})
export class SystemComponent implements OnInit {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private sanitizer = inject(DomSanitizer);

  status = signal<StatusData | null>(null);
  sessions = signal<SessionInfo[]>([]);
  chats = signal<ChatSummary[]>([]);
  logHtml = signal<SafeHtml | null>(null);
  rel = relTime;

  async ngOnInit(): Promise<void> {
    const [status, sessions, chats] = await Promise.all([
      this.api.getStatus(), this.api.getSessions(), this.api.getChats(),
    ]);
    this.status.set(status);
    this.sessions.set(sessions);
    this.chats.set(chats);
  }

  channelGroupNames(ch: any): string {
    return (ch.groups || []).map((g: any) => g.name).join(', ') || '-';
  }

  async clearSession(folder: string): Promise<void> {
    try {
      await this.api.deleteSession(folder);
      this.toast.show('Session cleared');
      this.sessions.set(await this.api.getSessions());
    } catch (e: any) { this.toast.show(e.message, true); }
  }

  async loadLogs(type: 'all' | 'error'): Promise<void> {
    try {
      const data = await this.api.getLogs(type);
      const lines = data.lines || [];
      if (!lines.length) { this.logHtml.set(this.sanitizer.bypassSecurityTrustHtml('<span class="text-zinc-600">No logs</span>')); return; }
      const html = lines.map(l => {
        const escaped = l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        if (/error|ERR/i.test(l)) return `<span class="text-red-400">${escaped}</span>`;
        if (/warn|WARN/i.test(l)) return `<span class="text-yellow-400">${escaped}</span>`;
        return escaped;
      }).join('\n');
      this.logHtml.set(this.sanitizer.bypassSecurityTrustHtml(html));
    } catch (e: any) { this.toast.show(e.message, true); }
  }
}
