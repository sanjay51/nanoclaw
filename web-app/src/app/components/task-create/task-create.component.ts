import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { StatusService } from '../../services/status.service';
import { GroupDetail } from '../../shared/types';

type Mode = 'once' | 'recurring';
type Preset = 'hourly' | 'daily' | 'weekly' | 'custom';

@Component({
  selector: 'app-task-create',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="flex-1 flex flex-col min-w-0 min-h-0 h-full">
      <!-- Header -->
      <div class="px-6 py-4 border-b border-border bg-surface flex items-center gap-3 shrink-0">
        <button (click)="router.navigate(['/tasks'])" class="text-sm text-zinc-400 px-2 py-1 border border-border rounded hover:bg-zinc-800">&larr; Tasks</button>
        <h2 class="text-lg font-semibold">New Task</h2>
      </div>

      <!-- Chat-style message area -->
      <div class="flex-1 overflow-y-auto px-6 py-6 min-h-0">
        @if (!prompt.trim()) {
          <div class="h-full flex flex-col items-center justify-center max-w-2xl mx-auto text-center gap-6 px-4">
            <div>
              <div class="text-2xl font-semibold text-zinc-100 mb-2">New task for {{ auth.assistantName() }}</div>
              <div class="text-sm text-zinc-400">Describe what you'd like me to do, then pick when.</div>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full">
              @for (s of suggestions; track s) {
                <button (click)="prompt = s"
                  class="text-left px-3.5 py-3 rounded-lg border border-border bg-zinc-900/40 hover:bg-zinc-800 hover:border-zinc-600 transition-colors text-sm text-zinc-300">
                  {{ s }}
                </button>
              }
            </div>
          </div>
        } @else {
          <div class="max-w-3xl mx-auto flex flex-col gap-3">
            <!-- User's prompt as a chat bubble -->
            <div class="self-end bg-user-bg rounded-2xl rounded-br-md px-4 py-3 max-w-[85%] text-sm leading-relaxed whitespace-pre-wrap break-words">
              <div class="flex gap-2 items-baseline mb-1 text-[11px]">
                <span class="font-semibold text-zinc-300">You</span>
              </div>
              {{ prompt }}
            </div>

            <!-- Preview from the assistant -->
            <div class="self-start bg-bot-bg border border-border rounded-2xl rounded-bl-md px-4 py-3 max-w-[85%] text-sm leading-relaxed">
              <div class="flex gap-2 items-baseline mb-1 text-[11px]">
                <span class="font-semibold text-accent">{{ auth.assistantName() }}</span>
              </div>
              <div>
                I'll run this <strong>{{ scheduleSummary() }}</strong>
                @if (selectedGroup) {
                  in <strong>{{ selectedGroup.name }}</strong>
                }
                with <strong>{{ contextMode === 'group' ? 'shared group context' : 'an isolated context each run' }}</strong>.
              </div>
              <div class="text-xs text-zinc-500 mt-2">
                Tweak any of these below, then press the arrow to create the task.
              </div>
            </div>
          </div>
        }
      </div>

      <!-- Options bar: schedule / group / context as compact chips -->
      <div class="px-6 py-3 border-t border-border bg-surface shrink-0 space-y-3">
        <div class="max-w-3xl mx-auto flex flex-wrap items-center gap-2 text-xs">
          <!-- Schedule chip (opens expander below) -->
          <button (click)="scheduleOpen.set(!scheduleOpen())"
            class="px-2.5 py-1 rounded-full border text-xs font-medium transition-colors flex items-center gap-1.5"
            [class]="scheduleOpen() ? 'bg-accent/15 border-accent/50 text-white' : 'border-border bg-zinc-900 text-zinc-300 hover:border-zinc-500'">
            <span class="text-zinc-500">Schedule:</span>
            <span>{{ scheduleSummary() }}</span>
            <span class="text-[10px] opacity-70">{{ scheduleOpen() ? '▾' : '▸' }}</span>
          </button>

          <!-- Group chip (native select) -->
          <label class="px-2.5 py-1 rounded-full border border-border bg-zinc-900 text-zinc-300 flex items-center gap-1.5 cursor-pointer hover:border-zinc-500">
            <span class="text-zinc-500">Group:</span>
            <select [(ngModel)]="selectedGroup" name="group" class="bg-transparent text-zinc-200 outline-none cursor-pointer text-xs">
              @for (g of groups(); track g.jid) { <option [ngValue]="g">{{ g.name }}</option> }
            </select>
          </label>

          <!-- Context chip -->
          <label class="px-2.5 py-1 rounded-full border border-border bg-zinc-900 text-zinc-300 flex items-center gap-1.5 cursor-pointer hover:border-zinc-500">
            <span class="text-zinc-500">Context:</span>
            <select [(ngModel)]="contextMode" name="ctx" class="bg-transparent text-zinc-200 outline-none cursor-pointer text-xs">
              <option value="isolated">Isolated</option>
              <option value="group">Group</option>
            </select>
          </label>
        </div>

        <!-- Expanded schedule configurator -->
        @if (scheduleOpen()) {
          <div class="max-w-3xl mx-auto p-3 rounded-lg border border-border bg-zinc-900/60 space-y-3 text-sm">
            <!-- Mode tabs -->
            <div class="flex gap-1 border-b border-border">
              <button (click)="mode.set('once')"
                class="px-4 py-1.5 text-sm font-medium border-b-2 -mb-px transition-colors"
                [class]="mode() === 'once' ? 'text-white border-accent' : 'text-zinc-400 border-transparent hover:text-white'">
                One-off
              </button>
              <button (click)="mode.set('recurring')"
                class="px-4 py-1.5 text-sm font-medium border-b-2 -mb-px transition-colors"
                [class]="mode() === 'recurring' ? 'text-white border-accent' : 'text-zinc-400 border-transparent hover:text-white'">
                Recurring
              </button>
            </div>

            @if (mode() === 'once') {
              <div class="flex flex-wrap items-center gap-3">
                <label class="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="when" value="now" [(ngModel)]="when"> Run now
                </label>
                <label class="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="when" value="later" [(ngModel)]="when"> At:
                </label>
                <input type="datetime-local" [(ngModel)]="onceAt" [disabled]="when === 'now'"
                  class="px-2 py-1 rounded border border-border bg-zinc-950 text-sm outline-none focus:border-accent disabled:opacity-40">
              </div>
            }

            @if (mode() === 'recurring') {
              <div class="flex flex-wrap gap-2">
                @for (p of presets; track p) {
                  <button (click)="preset.set(p)"
                    class="px-3 py-1.5 rounded text-xs font-medium border transition-colors"
                    [class]="preset() === p ? 'bg-accent border-accent text-white' : 'bg-zinc-900 border-border text-zinc-400 hover:text-white hover:border-zinc-500'">
                    {{ presetLabel(p) }}
                  </button>
                }
              </div>

              @if (preset() === 'daily') {
                <div class="flex items-center gap-2">
                  <span class="text-zinc-500 text-xs">At</span>
                  <input type="time" [(ngModel)]="dailyTime"
                    class="px-2 py-1 rounded border border-border bg-zinc-950 text-sm outline-none focus:border-accent">
                </div>
              }

              @if (preset() === 'weekly') {
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-zinc-500 text-xs">On</span>
                  <select [(ngModel)]="weeklyDow" class="px-2 py-1 rounded border border-border bg-zinc-950 text-sm outline-none">
                    <option value="0">Sunday</option>
                    <option value="1">Monday</option>
                    <option value="2">Tuesday</option>
                    <option value="3">Wednesday</option>
                    <option value="4">Thursday</option>
                    <option value="5">Friday</option>
                    <option value="6">Saturday</option>
                  </select>
                  <span class="text-zinc-500 text-xs">at</span>
                  <input type="time" [(ngModel)]="weeklyTime"
                    class="px-2 py-1 rounded border border-border bg-zinc-950 text-sm outline-none focus:border-accent">
                </div>
              }

              @if (preset() === 'custom') {
                <div>
                  <input type="text" [(ngModel)]="customCron" placeholder="0 9 * * *"
                    class="w-full px-3 py-2 rounded border border-border bg-zinc-950 text-sm font-mono outline-none focus:border-accent">
                  <p class="text-xs text-zinc-600 mt-1">Standard 5-field cron: minute hour dom month dow</p>
                </div>
              }
            }
          </div>
        }
      </div>

      <!-- Chat-style input bar -->
      <div class="px-6 py-4 border-t border-border bg-surface shrink-0">
        <form (ngSubmit)="create()" class="max-w-3xl mx-auto">
          <div class="flex items-end gap-2 px-2 py-2 rounded-2xl border border-border bg-zinc-950 focus-within:border-accent transition-colors">
            <textarea [(ngModel)]="prompt" name="text" rows="1"
              (keydown)="onKeydown($event)"
              (input)="autoResize($event)"
              [placeholder]="'Tell ' + auth.assistantName() + ' what to do...'"
              class="flex-1 px-2 py-2 bg-transparent text-zinc-200 text-sm resize-none outline-none min-h-[36px] max-h-[200px] placeholder:text-zinc-500"></textarea>
            <button type="submit" [disabled]="!canCreate()"
              class="w-9 h-9 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors shrink-0 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
              title="Create task">&#10148;</button>
          </div>
        </form>
      </div>
    </section>
  `,
})
export class TaskCreateComponent implements OnInit {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private statusSvc = inject(StatusService);
  router = inject(Router);
  auth = inject(AuthService);

  groups = signal<GroupDetail[]>([]);
  selectedGroup: GroupDetail | null = null;

  mode = signal<Mode>('once');
  preset = signal<Preset>('hourly');
  presets: Preset[] = ['hourly', 'daily', 'weekly', 'custom'];
  scheduleOpen = signal(false);

  prompt = '';
  contextMode: 'isolated' | 'group' = 'isolated';

  when: 'now' | 'later' = 'now';
  onceAt = this.defaultLocalDateTime();

  dailyTime = '09:00';
  weeklyDow: '0'|'1'|'2'|'3'|'4'|'5'|'6' = '1';
  weeklyTime = '09:00';
  customCron = '0 * * * *';

  suggestions = [
    'Summarize my unread emails every morning at 9am',
    'In 10 minutes, draft a quick status update',
    'Every Monday at 9, plan the week',
    'Check my calendar tomorrow and flag conflicts',
  ];

  scheduleSummary = computed(() => {
    if (this.mode() === 'once') {
      if (this.when === 'now') return 'now';
      const d = new Date(this.onceAt);
      return isNaN(d.getTime()) ? 'once' : 'once at ' + d.toLocaleString();
    }
    const p = this.preset();
    if (p === 'hourly') return 'every hour';
    if (p === 'daily') return 'daily at ' + this.dailyTime;
    if (p === 'weekly') {
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      return 'weekly on ' + days[parseInt(this.weeklyDow, 10)] + ' at ' + this.weeklyTime;
    }
    return 'cron: ' + this.customCron;
  });

  canCreate(): boolean {
    return !!this.prompt.trim() && !!this.selectedGroup;
  }

  async ngOnInit(): Promise<void> {
    const list = await this.api.getGroups().catch(() => []);
    this.groups.set(list);
    if (list.length) this.selectedGroup = list[0];
  }

  presetLabel(p: Preset): string {
    return p === 'hourly' ? 'Every hour' : p === 'daily' ? 'Daily' : p === 'weekly' ? 'Weekly' : 'Custom cron';
  }

  onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.create();
    }
  }

  autoResize(e: Event): void {
    const el = e.target as HTMLTextAreaElement;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }

  private defaultLocalDateTime(): string {
    const d = new Date(Date.now() + 5 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  private buildSchedule(): { type: 'once' | 'cron'; value: string } | null {
    if (this.mode() === 'once') {
      if (this.when === 'now') return { type: 'once', value: new Date().toISOString() };
      if (!this.onceAt) { this.toast.show('Pick a date/time', true); return null; }
      return { type: 'once', value: new Date(this.onceAt).toISOString() };
    }
    const p = this.preset();
    if (p === 'hourly') return { type: 'cron', value: '0 * * * *' };
    if (p === 'daily') {
      const [h, m] = (this.dailyTime || '09:00').split(':');
      return { type: 'cron', value: `${parseInt(m, 10)} ${parseInt(h, 10)} * * *` };
    }
    if (p === 'weekly') {
      const [h, m] = (this.weeklyTime || '09:00').split(':');
      return { type: 'cron', value: `${parseInt(m, 10)} ${parseInt(h, 10)} * * ${this.weeklyDow}` };
    }
    const cron = this.customCron.trim();
    if (!cron) { this.toast.show('Enter a cron expression', true); return null; }
    return { type: 'cron', value: cron };
  }

  async create(): Promise<void> {
    if (!this.canCreate()) { this.toast.show('Enter a prompt first', true); return; }
    const sched = this.buildSchedule();
    if (!sched) return;

    try {
      const created = await this.api.createTask({
        prompt: this.prompt.trim(),
        group_folder: this.selectedGroup!.folder,
        chat_jid: this.selectedGroup!.jid,
        schedule_type: sched.type,
        schedule_value: sched.value,
        context_mode: this.contextMode,
      });
      this.toast.show('Task created');
      this.statusSvc.refresh();
      this.router.navigate(['/tasks', created.id]);
    } catch (e: any) { this.toast.show(e.message, true); }
  }
}
