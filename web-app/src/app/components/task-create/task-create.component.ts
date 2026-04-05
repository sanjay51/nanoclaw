import { Component, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { ToastService } from '../../services/toast.service';
import { StatusService } from '../../services/status.service';
import { GroupDetail } from '../../shared/types';

@Component({
  selector: 'app-task-create',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="px-6 py-4 border-b border-border bg-surface flex items-center gap-3">
      <button (click)="router.navigate(['/tasks'])" class="text-sm text-zinc-400 px-2 py-1 border border-border rounded hover:bg-zinc-800">&larr; Tasks</button>
      <h2 class="text-lg font-semibold">New Task</h2>
    </div>
    <div class="p-6 overflow-y-auto flex-1">
      <div class="grid gap-4 max-w-lg">
        <div><label class="block text-xs text-zinc-500 mb-1">Prompt</label>
          <textarea [(ngModel)]="prompt" rows="3" placeholder="What should the agent do?" class="w-full px-3 py-2 rounded border border-border bg-zinc-950 text-sm font-mono outline-none focus:border-accent resize-y"></textarea></div>
        <div><label class="block text-xs text-zinc-500 mb-1">Group</label>
          <select [(ngModel)]="selectedGroup" class="w-full px-3 py-2 rounded border border-border bg-zinc-950 text-sm outline-none">
            @for (g of groups(); track g.jid) { <option [ngValue]="g">{{ g.name }} ({{ g.folder }})</option> }
          </select></div>
        <div><label class="block text-xs text-zinc-500 mb-1">Schedule Type</label>
          <select [(ngModel)]="scheduleType" class="px-3 py-2 rounded border border-border bg-zinc-950 text-sm outline-none">
            <option value="cron">Cron</option><option value="interval">Interval (ms)</option><option value="once">Once</option>
          </select></div>
        <div><label class="block text-xs text-zinc-500 mb-1">Schedule Value</label>
          <input [(ngModel)]="scheduleValue" placeholder="e.g. 0 9 * * * or 3600000" class="w-full px-3 py-2 rounded border border-border bg-zinc-950 text-sm outline-none focus:border-accent">
          <p class="text-xs text-zinc-600 mt-1">Cron expression, interval in ms, or ISO timestamp</p></div>
        <div><label class="block text-xs text-zinc-500 mb-1">Context Mode</label>
          <select [(ngModel)]="contextMode" class="px-3 py-2 rounded border border-border bg-zinc-950 text-sm outline-none">
            <option value="isolated">Isolated</option><option value="group">Group</option>
          </select>
          <p class="text-xs text-zinc-600 mt-1">Isolated: fresh context each run. Group: shares conversation.</p></div>
      </div>
      <div class="flex gap-2 mt-5">
        <button (click)="create()" class="px-4 py-1.5 rounded bg-accent text-white text-sm font-medium hover:bg-accent-hover">Create Task</button>
        <button (click)="router.navigate(['/tasks'])" class="px-4 py-1.5 rounded border border-border text-sm hover:bg-zinc-800">Cancel</button>
      </div>
    </div>
  `,
})
export class TaskCreateComponent implements OnInit {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private status = inject(StatusService);
  router = inject(Router);

  groups = signal<GroupDetail[]>([]);
  selectedGroup: GroupDetail | null = null;
  prompt = ''; scheduleType = 'cron'; scheduleValue = ''; contextMode = 'isolated';

  async ngOnInit(): Promise<void> {
    const list = await this.api.getGroups().catch(() => []);
    this.groups.set(list);
    if (list.length) this.selectedGroup = list[0];
  }

  async create(): Promise<void> {
    if (!this.selectedGroup || !this.prompt || !this.scheduleValue) {
      this.toast.show('Fill in all required fields', true); return;
    }
    try {
      await this.api.createTask({
        prompt: this.prompt,
        group_folder: this.selectedGroup.folder,
        chat_jid: this.selectedGroup.jid,
        schedule_type: this.scheduleType,
        schedule_value: this.scheduleValue,
        context_mode: this.contextMode,
      });
      this.toast.show('Task created');
      this.status.refresh();
      this.router.navigate(['/tasks']);
    } catch (e: any) { this.toast.show(e.message, true); }
  }
}
