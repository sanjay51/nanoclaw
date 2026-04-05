import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { ToastService } from '../../services/toast.service';
import { GroupDetail, SessionInfo, MessageItem } from '../../shared/types';
import { relTime, fmtDate } from '../../shared/utils';

@Component({
  selector: 'app-group-detail',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (group(); as g) {
      <div class="px-6 py-4 border-b border-border bg-surface flex items-center gap-3">
        <button (click)="router.navigate(['/groups'])" class="text-sm text-zinc-400 px-2 py-1 border border-border rounded hover:bg-zinc-800">&larr; Groups</button>
        <h2 class="text-lg font-semibold">{{ g.name }}</h2>
        @if (g.isMain) { <span class="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/30">main</span> }
      </div>
      <div class="p-6 overflow-y-auto flex-1 space-y-6">
        <!-- Config -->
        <section>
          <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3 pb-1.5 border-b border-border">Configuration</h3>
          <div class="grid gap-4 max-w-lg">
            <div><label class="block text-xs text-zinc-500 mb-1">Name</label><input [(ngModel)]="name" class="w-full px-3 py-2 rounded border border-border bg-zinc-950 text-sm outline-none focus:border-accent"></div>
            <div><label class="block text-xs text-zinc-500 mb-1">Trigger</label><input [(ngModel)]="trigger" class="w-full px-3 py-2 rounded border border-border bg-zinc-950 text-sm outline-none focus:border-accent"></div>
            <div><label class="block text-xs text-zinc-500 mb-1">Requires Trigger</label>
              <select [(ngModel)]="requiresTrigger" class="px-3 py-2 rounded border border-border bg-zinc-950 text-sm outline-none"><option [ngValue]="true">Yes</option><option [ngValue]="false">No</option></select></div>
            <div><label class="block text-xs text-zinc-500 mb-1">Container Timeout (ms)</label><input [(ngModel)]="timeout" type="number" placeholder="300000" class="w-full px-3 py-2 rounded border border-border bg-zinc-950 text-sm outline-none focus:border-accent"></div>
          </div>
          <div class="flex gap-2 mt-4">
            <button (click)="save()" class="px-4 py-1.5 rounded bg-accent text-white text-sm font-medium hover:bg-accent-hover">Save Changes</button>
            @if (!g.isMain) { <button (click)="remove()" class="px-4 py-1.5 rounded border border-red-500/30 text-red-400 text-sm hover:bg-red-500/10">Delete Group</button> }
          </div>
        </section>
        <!-- Info -->
        <section>
          <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3 pb-1.5 border-b border-border">Info</h3>
          <div class="space-y-2 text-sm">
            <div class="flex"><span class="w-32 text-zinc-500 shrink-0">JID</span><code class="text-xs">{{ g.jid }}</code></div>
            <div class="flex"><span class="w-32 text-zinc-500 shrink-0">Folder</span><code class="text-xs">{{ g.folder }}</code></div>
            <div class="flex"><span class="w-32 text-zinc-500 shrink-0">Added</span>{{ fmt(g.added_at) }}</div>
            <div class="flex items-center gap-2"><span class="w-32 text-zinc-500 shrink-0">Session</span>
              @if (session()) { <code class="text-xs">{{ session()!.sessionId.slice(0, 16) }}...</code> <button (click)="clearSession()" class="text-xs px-2 py-0.5 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10">Clear</button> }
              @else { <span class="text-zinc-500">None</span> }
            </div>
          </div>
        </section>
        <!-- Messages -->
        <section>
          <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3 pb-1.5 border-b border-border">Message History</h3>
          <button (click)="loadMessages()" class="text-xs px-3 py-1.5 rounded border border-border hover:bg-zinc-800 mb-2">Load Messages</button>
          @if (msgs().length) {
            <div class="max-h-96 overflow-y-auto border border-border rounded bg-zinc-950">
              @for (m of msgs(); track m.id) {
                <div class="px-3 py-2 border-b border-border text-sm last:border-b-0">
                  <span class="text-xs text-zinc-600 float-right">{{ rel(m.timestamp) }}</span>
                  <span class="font-medium text-accent mr-1.5">{{ m.sender_name }}</span>
                  <span class="text-zinc-400">{{ m.content.length > 200 ? m.content.slice(0, 200) + '...' : m.content }}</span>
                </div>
              }
            </div>
          }
        </section>
      </div>
    } @else {
      <div class="p-6 text-zinc-500">Loading...</div>
    }
  `,
})
export class GroupDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private api = inject(ApiService);
  private toast = inject(ToastService);
  router = inject(Router);

  group = signal<GroupDetail | null>(null);
  session = signal<SessionInfo | null>(null);
  msgs = signal<MessageItem[]>([]);
  name = ''; trigger = ''; requiresTrigger = true; timeout: number | null = null;
  rel = relTime; fmt = fmtDate;

  async ngOnInit(): Promise<void> {
    const jid = this.route.snapshot.paramMap.get('jid')!;
    const [g, sessions] = await Promise.all([this.api.getGroup(jid), this.api.getSessions()]);
    this.group.set(g);
    this.session.set(sessions.find(s => s.folder === g.folder) || null);
    this.name = g.name; this.trigger = g.trigger; this.requiresTrigger = g.requiresTrigger;
    this.timeout = g.containerConfig?.timeout || null;
  }

  async save(): Promise<void> {
    const g = this.group()!;
    try {
      const updates: any = { name: this.name, trigger: this.trigger, requiresTrigger: this.requiresTrigger };
      if (this.timeout && this.timeout > 0) updates.containerConfig = { timeout: this.timeout };
      await this.api.updateGroup(g.jid, updates);
      this.toast.show('Group updated');
    } catch (e: any) { this.toast.show(e.message, true); }
  }

  async remove(): Promise<void> {
    if (!confirm('Delete this group registration?')) return;
    try {
      await this.api.deleteGroup(this.group()!.jid);
      this.toast.show('Group deleted');
      this.router.navigate(['/groups']);
    } catch (e: any) { this.toast.show(e.message, true); }
  }

  async clearSession(): Promise<void> {
    try {
      await this.api.deleteSession(this.group()!.folder);
      this.session.set(null);
      this.toast.show('Session cleared');
    } catch (e: any) { this.toast.show(e.message, true); }
  }

  async loadMessages(): Promise<void> {
    try {
      this.msgs.set(await this.api.getGroupMessages(this.group()!.jid));
    } catch (e: any) { this.toast.show(e.message, true); }
  }
}
