import { Component, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { StatusService } from '../../services/status.service';
import { ChatSummary, GroupDetail } from '../../shared/types';

@Component({
  selector: 'app-group-register',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="px-6 py-4 border-b border-border bg-surface flex items-center gap-3">
      <button (click)="router.navigate(['/groups'])" class="text-sm text-zinc-400 px-2 py-1 border border-border rounded hover:bg-zinc-800">&larr; Groups</button>
      <h2 class="text-lg font-semibold">Register Group</h2>
    </div>
    <div class="p-6 overflow-y-auto flex-1">
      @if (unregistered().length) {
        <section class="mb-6">
          <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3 pb-1.5 border-b border-border">Select Existing Chat</h3>
          <select (change)="onChatSelect($event)" class="px-3 py-2 rounded border border-border bg-zinc-950 text-sm outline-none max-w-md w-full">
            <option value="">-- Select a chat or enter manually --</option>
            @for (c of unregistered(); track c.jid) {
              <option [value]="c.jid">{{ c.name || c.jid }} ({{ c.channel || '?' }})</option>
            }
          </select>
        </section>
      }
      <section>
        <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3 pb-1.5 border-b border-border">Group Details</h3>
        <div class="grid gap-4 max-w-lg">
          <div><label class="block text-xs text-zinc-500 mb-1">JID</label><input [(ngModel)]="jid" placeholder="e.g. tg:-100123456" class="w-full px-3 py-2 rounded border border-border bg-zinc-950 text-sm outline-none focus:border-accent"></div>
          <div><label class="block text-xs text-zinc-500 mb-1">Name</label><input [(ngModel)]="name" placeholder="Group name" class="w-full px-3 py-2 rounded border border-border bg-zinc-950 text-sm outline-none focus:border-accent"></div>
          <div><label class="block text-xs text-zinc-500 mb-1">Folder</label><input [(ngModel)]="folder" placeholder="my_group" class="w-full px-3 py-2 rounded border border-border bg-zinc-950 text-sm outline-none focus:border-accent">
            <p class="text-xs text-zinc-600 mt-1">Unique folder name (alphanumeric, _, -)</p></div>
          <div><label class="block text-xs text-zinc-500 mb-1">Trigger</label><input [(ngModel)]="trigger" [placeholder]="'@' + auth.assistantName()" class="w-full px-3 py-2 rounded border border-border bg-zinc-950 text-sm outline-none focus:border-accent"></div>
          <div><label class="block text-xs text-zinc-500 mb-1">Requires Trigger</label>
            <select [(ngModel)]="requiresTrigger" class="px-3 py-2 rounded border border-border bg-zinc-950 text-sm outline-none"><option [ngValue]="true">Yes</option><option [ngValue]="false">No</option></select></div>
        </div>
        <div class="flex gap-2 mt-4">
          <button (click)="register()" class="px-4 py-1.5 rounded bg-accent text-white text-sm font-medium hover:bg-accent-hover">Register Group</button>
          <button (click)="router.navigate(['/groups'])" class="px-4 py-1.5 rounded border border-border text-sm hover:bg-zinc-800">Cancel</button>
        </div>
      </section>
    </div>
  `,
})
export class GroupRegisterComponent implements OnInit {
  private api = inject(ApiService);
  auth = inject(AuthService);
  private toast = inject(ToastService);
  private status = inject(StatusService);
  router = inject(Router);

  unregistered = signal<ChatSummary[]>([]);
  jid = ''; name = ''; folder = ''; trigger = ''; requiresTrigger = true;

  async ngOnInit(): Promise<void> {
    const [chats, groups] = await Promise.all([this.api.getChats(), this.api.getGroups()]);
    const registered = new Set(groups.map(g => g.jid));
    this.unregistered.set(chats.filter(c => c.is_group && !registered.has(c.jid)));
  }

  onChatSelect(event: Event): void {
    const jid = (event.target as HTMLSelectElement).value;
    const chat = this.unregistered().find(c => c.jid === jid);
    if (chat) {
      this.jid = chat.jid;
      this.name = chat.name || '';
      this.folder = (chat.name || chat.jid).toLowerCase().replace(/[^a-z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 30);
    }
  }

  async register(): Promise<void> {
    if (!this.jid || !this.name || !this.folder) { this.toast.show('JID, name, and folder are required', true); return; }
    try {
      await this.api.registerGroup({
        jid: this.jid, name: this.name, folder: this.folder,
        trigger: this.trigger || undefined, requiresTrigger: this.requiresTrigger,
      });
      this.toast.show('Group registered');
      this.status.refresh();
      this.router.navigate(['/groups']);
    } catch (e: any) { this.toast.show(e.message, true); }
  }
}
