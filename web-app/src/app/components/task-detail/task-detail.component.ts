import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { ToastService } from '../../services/toast.service';
import { StatusService } from '../../services/status.service';
import { TaskDetail, TaskRunLog } from '../../shared/types';
import { relTime, fmtDate, humanDur } from '../../shared/utils';

@Component({
  selector: 'app-task-detail',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (task(); as t) {
      <div class="px-6 py-4 border-b border-border bg-surface flex items-center gap-3">
        <button (click)="router.navigate(['/tasks'])" class="text-sm text-zinc-400 px-2 py-1 border border-border rounded hover:bg-zinc-800">&larr; Tasks</button>
        <h2 class="text-lg font-semibold">Edit Task</h2>
        <span class="text-xs px-2 py-0.5 rounded-full border"
          [class]="t.status === 'active' ? 'bg-green-500/10 text-green-400 border-green-500/30' : t.status === 'paused' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30' : 'text-zinc-500 border-border'">{{ t.status }}</span>
      </div>
      <div class="p-6 overflow-y-auto flex-1 space-y-6">
        <section>
          <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3 pb-1.5 border-b border-border">Configuration</h3>
          <div class="grid gap-4 max-w-lg">
            <div><label class="block text-xs text-zinc-500 mb-1">Prompt</label><textarea [(ngModel)]="prompt" rows="3" class="w-full px-3 py-2 rounded border border-border bg-zinc-950 text-sm font-mono outline-none focus:border-accent resize-y"></textarea></div>
            <div><label class="block text-xs text-zinc-500 mb-1">Schedule Type</label>
              <select [(ngModel)]="scheduleType" class="px-3 py-2 rounded border border-border bg-zinc-950 text-sm outline-none">
                <option value="cron">Cron</option><option value="interval">Interval (ms)</option><option value="once">Once</option>
              </select></div>
            <div><label class="block text-xs text-zinc-500 mb-1">Schedule Value</label><input [(ngModel)]="scheduleValue" class="w-full px-3 py-2 rounded border border-border bg-zinc-950 text-sm outline-none focus:border-accent"></div>
            <div><label class="block text-xs text-zinc-500 mb-1">Status</label>
              <select [(ngModel)]="status" class="px-3 py-2 rounded border border-border bg-zinc-950 text-sm outline-none">
                <option value="active">Active</option><option value="paused">Paused</option>
              </select></div>
          </div>
          <div class="flex gap-2 mt-4">
            <button (click)="save()" class="px-4 py-1.5 rounded bg-accent text-white text-sm font-medium hover:bg-accent-hover">Save Changes</button>
            <button (click)="remove()" class="px-4 py-1.5 rounded border border-red-500/30 text-red-400 text-sm hover:bg-red-500/10">Delete Task</button>
          </div>
        </section>
        <section>
          <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3 pb-1.5 border-b border-border">Info</h3>
          <div class="space-y-2 text-sm">
            <div class="flex"><span class="w-32 text-zinc-500 shrink-0">ID</span><code class="text-xs">{{ t.id }}</code></div>
            <div class="flex"><span class="w-32 text-zinc-500 shrink-0">Group</span><code class="text-xs">{{ t.group_folder }}</code></div>
            <div class="flex"><span class="w-32 text-zinc-500 shrink-0">Context</span>{{ t.context_mode || 'isolated' }}</div>
            <div class="flex"><span class="w-32 text-zinc-500 shrink-0">Next Run</span>{{ t.next_run ? fmt(t.next_run) + ' (' + rel(t.next_run) + ')' : '-' }}</div>
            <div class="flex"><span class="w-32 text-zinc-500 shrink-0">Last Run</span>{{ t.last_run ? fmt(t.last_run) + ' (' + rel(t.last_run) + ')' : '-' }}</div>
            @if (t.last_result) { <div class="flex"><span class="w-32 text-zinc-500 shrink-0">Last Result</span><span class="truncate max-w-md">{{ t.last_result }}</span></div> }
          </div>
        </section>
        <section>
          <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3 pb-1.5 border-b border-border">Run History</h3>
          @if (logs().length) {
            <table class="w-full text-sm">
              <thead><tr class="text-xs text-zinc-500 uppercase tracking-wider">
                <th class="text-left px-3 py-2">Time</th><th class="text-left px-3 py-2">Duration</th><th class="text-left px-3 py-2">Status</th><th class="text-left px-3 py-2">Result</th>
              </tr></thead>
              <tbody>
                @for (l of logs(); track l.id) {
                  <tr class="border-t border-border">
                    <td class="px-3 py-2">{{ fmt(l.run_at) }}</td>
                    <td class="px-3 py-2">{{ dur(l.duration_ms) }}</td>
                    <td class="px-3 py-2"><span class="text-xs px-2 py-0.5 rounded-full border" [class]="l.status === 'success' ? 'bg-green-500/10 text-green-400 border-green-500/30' : 'bg-red-500/10 text-red-400 border-red-500/30'">{{ l.status }}</span></td>
                    <td class="px-3 py-2 text-zinc-500 truncate max-w-xs">{{ (l.result || l.error || '-').slice(0, 100) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          } @else {
            <p class="text-zinc-500 italic">No runs yet</p>
          }
        </section>
      </div>
    } @else {
      <div class="p-6 text-zinc-500">Loading...</div>
    }
  `,
})
export class TaskDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private statusSvc = inject(StatusService);
  router = inject(Router);

  task = signal<TaskDetail | null>(null);
  logs = signal<TaskRunLog[]>([]);
  prompt = ''; scheduleType = 'cron'; scheduleValue = ''; status = 'active';
  rel = relTime; fmt = fmtDate; dur = humanDur;

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id')!;
    const [t, logs] = await Promise.all([this.api.getTask(id), this.api.getTaskLogs(id)]);
    this.task.set(t);
    this.logs.set(logs);
    this.prompt = t.prompt; this.scheduleType = t.schedule_type;
    this.scheduleValue = t.schedule_value; this.status = t.status;
  }

  async save(): Promise<void> {
    try {
      await this.api.updateTask(this.task()!.id, {
        prompt: this.prompt, schedule_type: this.scheduleType,
        schedule_value: this.scheduleValue, status: this.status,
      });
      this.toast.show('Task updated');
      this.statusSvc.refresh();
    } catch (e: any) { this.toast.show(e.message, true); }
  }

  async remove(): Promise<void> {
    if (!confirm('Delete this task?')) return;
    try {
      await this.api.deleteTask(this.task()!.id);
      this.toast.show('Task deleted');
      this.statusSvc.refresh();
      this.router.navigate(['/tasks']);
    } catch (e: any) { this.toast.show(e.message, true); }
  }
}
