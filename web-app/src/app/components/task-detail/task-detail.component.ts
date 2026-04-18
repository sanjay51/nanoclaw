import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { ToastService } from '../../services/toast.service';
import { StatusService } from '../../services/status.service';
import { TaskDetail, TaskRunLog } from '../../shared/types';
import { relTime, fmtDate, humanDur, renderMarkdown } from '../../shared/utils';

@Component({
  selector: 'app-task-detail',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (task(); as t) {
      <div class="px-6 py-4 border-b border-border bg-surface flex items-center gap-3">
        <button (click)="router.navigate(['/tasks'])" class="text-sm text-zinc-400 px-2 py-1 border border-border rounded hover:bg-zinc-800">&larr; Tasks</button>
        <h2 class="text-lg font-semibold truncate">{{ shortPrompt(t.prompt) }}</h2>
        <span class="text-xs px-2 py-0.5 rounded-full border"
          [class]="t.status === 'active' ? 'bg-green-500/10 text-green-400 border-green-500/30' : t.status === 'paused' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30' : 'text-zinc-500 border-border'">{{ t.status }}</span>
      </div>

      <div class="p-6 overflow-y-auto flex-1 space-y-5">

        <!-- Header card -->
        <div class="flex items-start gap-3 p-4 rounded border border-border bg-zinc-900/50">
          <div class="flex-1 min-w-0">
            <div class="text-sm">{{ t.prompt }}</div>
            <div class="text-xs text-zinc-500 font-mono mt-1">
              {{ humanSchedule(t.schedule_type, t.schedule_value) }}
              @if (t.next_run) { <span> &middot; next {{ rel(t.next_run) }}</span> }
            </div>
          </div>
        </div>

        <!-- Action bar -->
        <div class="flex flex-wrap gap-2">
          <button (click)="runNow()" [disabled]="running()"
            class="px-4 py-1.5 rounded bg-accent text-white text-sm font-medium hover:bg-accent-hover disabled:opacity-50">
            {{ running() ? 'Queuing...' : 'Run Now' }}
          </button>
          @if (t.status === 'active') {
            <button (click)="setStatus('paused')" class="px-3 py-1.5 rounded border border-border text-sm hover:bg-zinc-800">Pause</button>
          } @else if (t.status === 'paused') {
            <button (click)="setStatus('active')" class="px-3 py-1.5 rounded border border-accent/30 text-accent text-sm hover:bg-accent/10">Resume</button>
          }
          <button (click)="showConfig.set(!showConfig())" class="px-3 py-1.5 rounded border border-border text-sm text-zinc-400 hover:bg-zinc-800 ml-auto">
            {{ showConfig() ? 'Hide' : 'Edit' }} configuration
          </button>
        </div>

        <!-- Config (collapsed by default) -->
        @if (showConfig()) {
          <section class="border border-border rounded p-4 space-y-3">
            <div class="grid gap-3 max-w-lg">
              <div><label class="block text-xs text-zinc-500 mb-1">Prompt</label>
                <textarea [(ngModel)]="prompt" rows="3" class="w-full px-3 py-2 rounded border border-border bg-zinc-950 text-sm font-mono outline-none focus:border-accent resize-y"></textarea>
              </div>
              <div><label class="block text-xs text-zinc-500 mb-1">Schedule Type</label>
                <select [(ngModel)]="scheduleType" class="px-3 py-2 rounded border border-border bg-zinc-950 text-sm outline-none">
                  <option value="cron">Cron</option><option value="interval">Interval (ms)</option><option value="once">Once</option>
                </select></div>
              <div><label class="block text-xs text-zinc-500 mb-1">Schedule Value</label>
                <input [(ngModel)]="scheduleValue" class="w-full px-3 py-2 rounded border border-border bg-zinc-950 text-sm font-mono outline-none focus:border-accent"></div>
            </div>
            <div class="flex gap-2 pt-2">
              <button (click)="save()" class="px-4 py-1.5 rounded bg-accent text-white text-sm font-medium hover:bg-accent-hover">Save Changes</button>
              <button (click)="remove()" class="px-4 py-1.5 rounded border border-red-500/30 text-red-400 text-sm hover:bg-red-500/10">Delete Task</button>
            </div>
            <div class="pt-3 mt-3 border-t border-border space-y-1.5 text-xs">
              <div class="flex"><span class="w-24 text-zinc-500 shrink-0">ID</span><code class="text-zinc-400">{{ t.id }}</code></div>
              <div class="flex"><span class="w-24 text-zinc-500 shrink-0">Group</span><code class="text-zinc-400">{{ t.group_folder }}</code></div>
              <div class="flex"><span class="w-24 text-zinc-500 shrink-0">Context</span>{{ t.context_mode || 'isolated' }}</div>
            </div>
          </section>
        }

        <!-- Chat-style run log -->
        <section>
          <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">Run History</h3>
          @if (logs().length) {
            <div class="flex flex-col gap-2.5 max-w-3xl">
              @for (l of logs(); track l.id) {
                <div class="rounded-lg border p-3 bg-zinc-900/60"
                  [class]="l.status === 'error' ? 'border-red-500/30' : 'border-border'">
                  <div class="flex items-center gap-2 text-xs text-zinc-500 mb-1.5 flex-wrap">
                    <span>{{ fmt(l.run_at) }}</span>
                    @if (l.duration_ms != null) { <span>&middot; {{ dur(l.duration_ms) }}</span> }
                    <span class="text-xs px-2 py-0.5 rounded-full border"
                      [class]="l.status === 'success' ? 'bg-green-500/10 text-green-400 border-green-500/30' : 'bg-red-500/10 text-red-400 border-red-500/30'">{{ l.status }}</span>
                  </div>
                  <div class="text-sm text-zinc-200 whitespace-pre-wrap break-words leading-relaxed"
                    [innerHTML]="renderBody(l.result || l.error || '(no output)')"></div>
                </div>
              }
            </div>
          } @else {
            <p class="text-zinc-500 text-sm italic">No runs yet. Click Run Now to trigger one.</p>
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
  showConfig = signal(false);
  running = signal(false);

  prompt = '';
  scheduleType = 'cron';
  scheduleValue = '';

  rel = relTime;
  fmt = fmtDate;
  dur = humanDur;

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id')!;
    await this.load(id);
  }

  private async load(id: string): Promise<void> {
    try {
      const [t, logs] = await Promise.all([this.api.getTask(id), this.api.getTaskLogs(id)]);
      this.task.set(t);
      this.logs.set(logs);
      this.prompt = t.prompt;
      this.scheduleType = t.schedule_type;
      this.scheduleValue = t.schedule_value;
    } catch (e: any) {
      this.toast.show(e.message, true);
    }
  }

  shortPrompt(p: string): string {
    return p.length > 60 ? p.slice(0, 60) + '...' : p;
  }

  humanSchedule(type: string, value: string): string {
    if (type === 'once') {
      const d = new Date(value);
      return isNaN(d.getTime()) ? 'Once: ' + value : 'Once at ' + d.toLocaleString();
    }
    if (type === 'interval') {
      const ms = parseInt(value, 10);
      return isNaN(ms) ? 'Interval: ' + value : 'Every ' + humanDur(ms);
    }
    if (type === 'cron') {
      const parts = (value || '').trim().split(/\s+/);
      if (parts.length === 5) {
        const [m, h, dom, mon, dow] = parts;
        if (m === '0' && h === '*' && dom === '*' && mon === '*' && dow === '*') return 'Every hour';
        const isNum = (s: string) => /^\d+$/.test(s);
        if (dom === '*' && mon === '*' && dow === '*' && isNum(m) && isNum(h)) {
          return 'Daily at ' + h.padStart(2, '0') + ':' + m.padStart(2, '0');
        }
        if (dom === '*' && mon === '*' && isNum(dow) && isNum(m) && isNum(h)) {
          const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          return 'Weekly on ' + (days[parseInt(dow, 10)] || dow) + ' at ' + h.padStart(2, '0') + ':' + m.padStart(2, '0');
        }
      }
      return 'Cron: ' + value;
    }
    return type + ': ' + value;
  }

  renderBody(s: string): string {
    return renderMarkdown(s);
  }

  async runNow(): Promise<void> {
    const t = this.task();
    if (!t) return;
    this.running.set(true);
    try {
      await this.api.runTask(t.id);
      this.toast.show('Queued — scheduler will pick this up shortly');
      this.statusSvc.refresh();
      setTimeout(() => this.load(t.id), 3000);
    } catch (e: any) {
      this.toast.show(e.message, true);
    } finally {
      this.running.set(false);
    }
  }

  async setStatus(status: 'active' | 'paused'): Promise<void> {
    const t = this.task();
    if (!t) return;
    try {
      await this.api.updateTask(t.id, { status });
      this.toast.show('Task ' + (status === 'paused' ? 'paused' : 'resumed'));
      this.statusSvc.refresh();
      await this.load(t.id);
    } catch (e: any) { this.toast.show(e.message, true); }
  }

  async save(): Promise<void> {
    const t = this.task();
    if (!t) return;
    try {
      await this.api.updateTask(t.id, {
        prompt: this.prompt,
        schedule_type: this.scheduleType,
        schedule_value: this.scheduleValue,
      });
      this.toast.show('Task updated');
      this.statusSvc.refresh();
      await this.load(t.id);
    } catch (e: any) { this.toast.show(e.message, true); }
  }

  async remove(): Promise<void> {
    if (!confirm('Delete this task? This cannot be undone.')) return;
    const t = this.task();
    if (!t) return;
    try {
      await this.api.deleteTask(t.id);
      this.toast.show('Task deleted');
      this.statusSvc.refresh();
      this.router.navigate(['/tasks']);
    } catch (e: any) { this.toast.show(e.message, true); }
  }
}
