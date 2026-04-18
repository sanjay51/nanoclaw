import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { StatusService } from '../../services/status.service';
import { relTime } from '../../shared/utils';
import { GroupNamesPipe } from '../../shared/pipes';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [GroupNamesPipe],
  template: `
    <div class="flex items-center gap-3 mb-4">
      <h3 class="font-serif text-xl text-zinc-200">Dashboard</h3>
      <span class="ml-auto text-[11px] text-zinc-500">Auto-refreshes every 10s</span>
    </div>
    <div>
      @if (status.status(); as s) {
        <!-- Stat cards -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div class="bg-surface border border-border rounded-xl p-5">
            <div class="text-2xl font-bold">{{ connectedChannels(s) }}/{{ s.channels.length }}</div>
            <div class="text-xs text-zinc-500 mt-1 uppercase tracking-wide">Channels</div>
          </div>
          <div class="bg-surface border border-border rounded-xl p-5">
            <div class="text-2xl font-bold">{{ s.groups.length }}</div>
            <div class="text-xs text-zinc-500 mt-1 uppercase tracking-wide">Groups</div>
          </div>
          <div class="bg-surface border border-border rounded-xl p-5">
            <div class="text-2xl font-bold">{{ activeTasks(s) }}</div>
            <div class="text-xs text-zinc-500 mt-1 uppercase tracking-wide">Active Tasks</div>
          </div>
          <div class="bg-surface border border-border rounded-xl p-5">
            <div class="text-2xl font-bold">{{ s.chats.length }}</div>
            <div class="text-xs text-zinc-500 mt-1 uppercase tracking-wide">Chats</div>
          </div>
        </div>

        <!-- Channels -->
        <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2 pb-1.5 border-b border-border">Channels</h3>
        <table class="w-full text-sm mb-6">
          <thead><tr class="text-xs text-zinc-500 uppercase tracking-wider">
            <th class="text-left px-3 py-2">Channel</th><th class="text-left px-3 py-2">Status</th><th class="text-left px-3 py-2">Groups</th>
          </tr></thead>
          <tbody>
            @for (ch of s.channels; track ch.name) {
              <tr class="border-t border-border">
                <td class="px-3 py-2.5">{{ ch.name }}</td>
                <td class="px-3 py-2.5"><span class="text-xs px-2 py-0.5 rounded-full" [class]="ch.connected ? 'bg-green-500/10 text-green-400 border border-green-500/30' : 'bg-red-500/10 text-red-400 border border-red-500/30'">{{ ch.connected ? 'online' : 'offline' }}</span></td>
                <td class="px-3 py-2.5 text-zinc-500">{{ ch.groups | groupNames }}</td>
              </tr>
            }
          </tbody>
        </table>

        <!-- Recent activity -->
        <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2 pb-1.5 border-b border-border">Recent Activity</h3>
        <table class="w-full text-sm">
          <thead><tr class="text-xs text-zinc-500 uppercase tracking-wider">
            <th class="text-left px-3 py-2">Chat</th><th class="text-left px-3 py-2">Channel</th><th class="text-left px-3 py-2">Last Activity</th>
          </tr></thead>
          <tbody>
            @for (c of s.chats.slice(0, 10); track c.jid) {
              <tr class="border-t border-border">
                <td class="px-3 py-2.5">{{ c.name || c.jid }}</td>
                <td class="px-3 py-2.5 text-zinc-500">{{ c.channel || '-' }}</td>
                <td class="px-3 py-2.5 text-zinc-500">{{ rel(c.lastActivity) }}</td>
              </tr>
            }
          </tbody>
        </table>
      } @else {
        <p class="text-zinc-500 text-center py-10">Loading...</p>
      }
    </div>
  `,
})
export class DashboardComponent implements OnInit, OnDestroy {
  status = inject(StatusService);
  rel = relTime;

  ngOnInit() { this.status.refresh(); }
  ngOnDestroy() { /* polling managed by app component */ }

  connectedChannels(s: any): number { return s.channels.filter((c: any) => c.connected).length; }
  activeTasks(s: any): number { return s.tasks.filter((t: any) => t.status === 'active').length; }
}
