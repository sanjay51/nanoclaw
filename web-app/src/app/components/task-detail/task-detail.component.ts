import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { StatusService } from '../../services/status.service';
import { TaskDetail, TaskRunLog } from '../../shared/types';
import { relTime, fmtDate, humanDur, renderMarkdown } from '../../shared/utils';

interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ts: string;
  pending?: boolean;
  error?: boolean;
  sourceTaskId?: string;
}

@Component({
  selector: 'app-task-detail',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (task(); as t) {
      <section class="flex-1 flex flex-col min-w-0 min-h-0 h-full">
        <!-- Header -->
        <div class="px-6 py-4 border-b border-border bg-surface flex items-center gap-3 shrink-0">
          <button (click)="router.navigate(['/tasks'])" class="text-sm text-zinc-400 px-2 py-1 border border-border rounded hover:bg-zinc-800">&larr; Tasks</button>
          <h2 class="text-lg font-semibold truncate">{{ shortPrompt(t.prompt) }}</h2>
          <span class="text-xs px-2 py-0.5 rounded-full border"
            [class]="t.status === 'active' ? 'bg-green-500/10 text-green-400 border-green-500/30' : t.status === 'paused' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30' : 'text-zinc-500 border-border'">{{ t.status }}</span>
          <div class="ml-auto flex items-center gap-2">
            <button (click)="runNow()" [disabled]="running()"
              class="px-3 py-1 rounded bg-accent text-white text-xs font-medium hover:bg-accent-hover disabled:opacity-50">
              {{ running() ? 'Queuing...' : 'Run Now' }}
            </button>
            @if (t.status === 'active') {
              <button (click)="setStatus('paused')" class="px-3 py-1 rounded border border-border text-xs hover:bg-zinc-800">Pause</button>
            } @else if (t.status === 'paused') {
              <button (click)="setStatus('active')" class="px-3 py-1 rounded border border-accent/30 text-accent text-xs hover:bg-accent/10">Resume</button>
            }
            <button (click)="showConfig.set(!showConfig())" class="px-3 py-1 rounded border border-border text-xs text-zinc-400 hover:bg-zinc-800">
              {{ showConfig() ? 'Hide' : 'Edit' }} config
            </button>
          </div>
        </div>

        <!-- Collapsible config panel -->
        @if (showConfig()) {
          <div class="px-6 py-4 border-b border-border bg-zinc-900/60 shrink-0">
            <div class="max-w-3xl mx-auto grid gap-3">
              <div><label class="block text-xs text-zinc-500 mb-1">Prompt</label>
                <textarea [(ngModel)]="prompt" rows="2" class="w-full px-3 py-2 rounded border border-border bg-zinc-950 text-sm font-mono outline-none focus:border-accent resize-y"></textarea>
              </div>
              <div class="flex gap-2 flex-wrap">
                <label class="flex-1 min-w-[120px]"><span class="block text-xs text-zinc-500 mb-1">Schedule Type</span>
                  <select [(ngModel)]="scheduleType" class="w-full px-3 py-1.5 rounded border border-border bg-zinc-950 text-sm outline-none">
                    <option value="cron">Cron</option><option value="interval">Interval (ms)</option><option value="once">Once</option>
                  </select></label>
                <label class="flex-[2] min-w-[200px]"><span class="block text-xs text-zinc-500 mb-1">Schedule Value</span>
                  <input [(ngModel)]="scheduleValue" class="w-full px-3 py-1.5 rounded border border-border bg-zinc-950 text-sm font-mono outline-none focus:border-accent"></label>
              </div>
              <div class="flex items-center gap-2 flex-wrap text-xs text-zinc-500">
                <span>Next run: <span class="text-zinc-300">{{ t.next_run ? fmt(t.next_run) + ' (' + rel(t.next_run) + ')' : '—' }}</span></span>
                <span class="ml-3">Group: <code class="text-zinc-400">{{ t.group_folder }}</code></span>
                <span class="ml-3">Context: {{ t.context_mode || 'isolated' }}</span>
              </div>
              <div class="flex gap-2">
                <button (click)="save()" class="px-4 py-1.5 rounded bg-accent text-white text-sm font-medium hover:bg-accent-hover">Save Changes</button>
                <button (click)="remove()" class="px-4 py-1.5 rounded border border-red-500/30 text-red-400 text-sm hover:bg-red-500/10">Delete Task</button>
              </div>
            </div>
          </div>
        }

        <!-- Transcript (scheduled runs + chat) -->
        <div #scrollArea class="flex-1 overflow-y-auto px-6 py-6 min-h-0">
          <div class="max-w-3xl mx-auto flex flex-col gap-3">

            <!-- Task prompt as the seed "assistant" message -->
            <div class="self-start bg-bot-bg border border-border rounded-2xl rounded-bl-md px-4 py-3 max-w-[85%] text-sm leading-relaxed">
              <div class="flex gap-2 items-baseline mb-1 text-[11px]">
                <span class="font-semibold text-accent">{{ auth.assistantName() }}</span>
                <span class="text-zinc-600">task prompt</span>
              </div>
              <div class="whitespace-pre-wrap">{{ t.prompt }}</div>
              <div class="text-[11px] text-zinc-500 font-mono mt-2">
                {{ humanSchedule(t.schedule_type, t.schedule_value) }}
                @if (t.next_run) { <span> &middot; next {{ rel(t.next_run) }}</span> }
              </div>
            </div>

            <!-- Scheduled run bubbles -->
            @for (l of logs(); track l.id) {
              <div class="self-start max-w-[85%] rounded-2xl border rounded-bl-md px-4 py-3 bg-zinc-900/60 text-sm leading-relaxed"
                [class]="l.status === 'error' ? 'border-red-500/40' : 'border-border'">
                <div class="flex gap-2 items-baseline mb-1 text-[11px] flex-wrap">
                  <span class="font-semibold text-accent">Scheduled run</span>
                  <span class="text-zinc-600">{{ fmt(l.run_at) }}</span>
                  @if (l.duration_ms != null) { <span class="text-zinc-600">&middot; {{ dur(l.duration_ms) }}</span> }
                  <span class="text-[10px] px-1.5 py-0.5 rounded-full border"
                    [class]="l.status === 'success' ? 'bg-green-500/10 text-green-400 border-green-500/30' : 'bg-red-500/10 text-red-400 border-red-500/30'">{{ l.status }}</span>
                </div>
                <div class="text-zinc-200 whitespace-pre-wrap break-words"
                  [innerHTML]="renderBody(l.result || l.error || '(no output)')"></div>
              </div>
            }

            <!-- Ephemeral chat bubbles (user + assistant replies) -->
            @for (m of chat(); track m.id) {
              @if (m.role === 'user') {
                <div class="self-end bg-user-bg rounded-2xl rounded-br-md px-4 py-3 max-w-[85%] text-sm leading-relaxed whitespace-pre-wrap break-words">
                  <div class="flex gap-2 items-baseline mb-1 text-[11px]">
                    <span class="font-semibold text-zinc-300">You</span>
                    <span class="text-zinc-600">{{ rel(m.ts) }}</span>
                  </div>
                  {{ m.content }}
                </div>
              } @else {
                <div class="self-start bg-bot-bg border rounded-2xl rounded-bl-md px-4 py-3 max-w-[85%] text-sm leading-relaxed"
                  [class]="m.error ? 'border-red-500/40' : 'border-border'">
                  <div class="flex gap-2 items-baseline mb-1 text-[11px]">
                    <span class="font-semibold text-accent">{{ auth.assistantName() }}</span>
                    @if (m.pending) {
                      <span class="text-zinc-500">thinking…</span>
                    } @else {
                      <span class="text-zinc-600">{{ rel(m.ts) }}</span>
                    }
                  </div>
                  @if (m.pending) {
                    <div class="flex gap-1">
                      <span class="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-[thinking-dot_1.4s_ease-in-out_infinite]"></span>
                      <span class="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-[thinking-dot_1.4s_ease-in-out_0.2s_infinite]"></span>
                      <span class="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-[thinking-dot_1.4s_ease-in-out_0.4s_infinite]"></span>
                    </div>
                  } @else {
                    <div class="text-zinc-200 whitespace-pre-wrap break-words" [innerHTML]="renderBody(m.content)"></div>
                  }
                </div>
              }
            }

            @if (logs().length === 0 && chat().length === 0) {
              <div class="self-center text-xs text-zinc-500 italic py-4">No runs yet. Click <strong>Run Now</strong>, or send a message to ask a one-off question.</div>
            }
          </div>
        </div>

        <!-- Chat input -->
        <div class="px-6 py-4 border-t border-border bg-surface shrink-0">
          <form (ngSubmit)="sendChat()" class="max-w-3xl mx-auto">
            <div class="flex items-end gap-2 px-2 py-2 rounded-2xl border border-border bg-zinc-950 focus-within:border-accent transition-colors">
              <textarea [(ngModel)]="chatInput" name="chat" rows="1"
                (keydown)="onKeydown($event)"
                (input)="autoResize($event)"
                placeholder="Ask this task a one-off question..."
                class="flex-1 px-2 py-2 bg-transparent text-zinc-200 text-sm resize-none outline-none min-h-[36px] max-h-[200px] placeholder:text-zinc-500"></textarea>
              <button type="submit" [disabled]="!chatInput.trim() || sending()"
                class="w-9 h-9 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors shrink-0 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
                title="Send">&#10148;</button>
            </div>
            <p class="text-[11px] text-zinc-600 mt-1.5 max-w-3xl">
              Sends a one-off prompt in the same group ({{ t.group_folder }}, {{ t.context_mode || 'isolated' }} context). Doesn't change the task's saved prompt or schedule.
            </p>
          </form>
        </div>
      </section>
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
  auth = inject(AuthService);

  task = signal<TaskDetail | null>(null);
  logs = signal<TaskRunLog[]>([]);
  chat = signal<ChatMsg[]>([]);
  showConfig = signal(false);
  running = signal(false);
  sending = signal(false);

  prompt = '';
  scheduleType = 'cron';
  scheduleValue = '';
  chatInput = '';

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

  onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.sendChat();
    }
  }

  autoResize(e: Event): void {
    const el = e.target as HTMLTextAreaElement;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
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

  async sendChat(): Promise<void> {
    const t = this.task();
    if (!t) return;
    const text = this.chatInput.trim();
    if (!text || this.sending()) return;

    const userId = 'u-' + Date.now();
    const botId = 'a-' + Date.now();
    const now = new Date().toISOString();

    this.chat.update(arr => [...arr, { id: userId, role: 'user', content: text, ts: now }]);
    this.chat.update(arr => [...arr, { id: botId, role: 'assistant', content: '', ts: now, pending: true }]);
    this.chatInput = '';
    this.sending.set(true);

    try {
      const created = await this.api.createTask({
        prompt: text,
        group_folder: t.group_folder,
        chat_jid: t.chat_jid,
        schedule_type: 'once',
        schedule_value: new Date().toISOString(),
        context_mode: t.context_mode || 'isolated',
      });
      await this.api.runTask(created.id);
      this.chat.update(arr => arr.map(m => m.id === botId ? { ...m, sourceTaskId: created.id } : m));
      this.pollChatReply(created.id, botId);
    } catch (e: any) {
      this.chat.update(arr => arr.map(m => m.id === botId ? { ...m, pending: false, error: true, content: 'Failed to send: ' + e.message } : m));
      this.sending.set(false);
    }
  }

  private pollChatReply(sourceTaskId: string, botMsgId: string, attempt = 0): void {
    const maxAttempts = 60;
    const delay = 2000;

    setTimeout(async () => {
      try {
        const logs = await this.api.getTaskLogs(sourceTaskId, 1);
        if (logs.length > 0) {
          const log = logs[0];
          const content = log.result || log.error || '(no output)';
          const isError = log.status === 'error';
          this.chat.update(arr => arr.map(m => m.id === botMsgId ? {
            ...m, pending: false, error: isError, content, ts: log.run_at,
          } : m));
          this.sending.set(false);
          this.api.deleteTask(sourceTaskId).catch(() => { /* best-effort cleanup */ });
          this.statusSvc.refresh();
          return;
        }
      } catch { /* transient — keep polling */ }

      if (attempt + 1 >= maxAttempts) {
        this.chat.update(arr => arr.map(m => m.id === botMsgId ? {
          ...m, pending: false, error: true, content: 'Timed out waiting for a reply. The task may still be running — check the Tasks list.',
        } : m));
        this.sending.set(false);
        return;
      }
      this.pollChatReply(sourceTaskId, botMsgId, attempt + 1);
    }, delay);
  }
}
