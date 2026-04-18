import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { ChatListService } from '../../services/chat-list.service';
import { ToastService } from '../../services/toast.service';
import { StatusService } from '../../services/status.service';
import { GroupDetail } from '../../shared/types';

type Mode = 'once' | 'recurring';
type Preset = 'hourly' | 'daily' | 'weekly' | 'custom';

interface Template {
  category: Category;
  title: string;
  description: string;
  prompt: string;
  preset?: Preset;
  mode?: Mode;
}

type Category = 'Featured' | 'Daily' | 'Research' | 'Reminders' | 'Workflows';

@Component({
  selector: 'app-task-create',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="flex-1 overflow-y-auto">
      <div class="max-w-3xl mx-auto px-6 pt-16 pb-24">

        <!-- Hero -->
        <div class="mb-10">
          <h1 class="font-serif text-5xl leading-[1.05] tracking-tight text-zinc-200">
            Hello <span class="italic">{{ auth.assistantName() }}</span>.
          </h1>
          <h2 class="font-serif text-5xl leading-[1.05] tracking-tight text-zinc-200 mt-1">
            What should I do for you?
          </h2>
        </div>

        <!-- Big input card -->
        <form (ngSubmit)="create()" class="mb-8">
          <div class="rounded-2xl border border-border bg-surface shadow-sm focus-within:border-zinc-500 transition-colors">
            <textarea [(ngModel)]="prompt" name="text"
              (keydown)="onKeydown($event)"
              (input)="autoResize($event)"
              rows="2"
              [placeholder]="'Give ' + auth.assistantName() + ' a task to work on...'"
              class="w-full px-5 pt-5 pb-2 bg-transparent text-base text-zinc-200 resize-none outline-none min-h-[88px] placeholder:text-zinc-500"></textarea>

            <div class="flex items-center gap-2 px-3 pb-3 flex-wrap">
              <!-- Schedule chip -->
              <button type="button" (click)="scheduleOpen.set(!scheduleOpen())"
                class="px-2.5 py-1 rounded-full border text-[12px] font-medium transition-colors flex items-center gap-1.5"
                [class]="scheduleOpen() ? 'bg-accent/10 border-zinc-600 text-zinc-200' : 'border-border bg-surface2 text-zinc-500 hover:text-zinc-200 hover:border-zinc-500'">
                <span>{{ scheduleSummary() }}</span>
                <span class="text-[10px] opacity-70">{{ scheduleOpen() ? '▾' : '▸' }}</span>
              </button>

              <div class="flex-1"></div>

              <button type="submit" [disabled]="!canCreate()"
                class="w-9 h-9 rounded-full bg-accent text-white flex items-center justify-center hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="Create task">↑</button>
            </div>

            <!-- Expanded schedule configurator -->
            @if (scheduleOpen()) {
              <div class="border-t border-border px-4 py-3 space-y-3 text-sm">
                <div class="flex gap-1 border-b border-border">
                  <button type="button" (click)="mode.set('once')"
                    class="px-3 py-1.5 text-[13px] font-medium border-b-2 -mb-px transition-colors"
                    [class]="mode() === 'once' ? 'text-zinc-200 border-zinc-200' : 'text-zinc-500 border-transparent hover:text-zinc-200'">
                    One-off
                  </button>
                  <button type="button" (click)="mode.set('recurring')"
                    class="px-3 py-1.5 text-[13px] font-medium border-b-2 -mb-px transition-colors"
                    [class]="mode() === 'recurring' ? 'text-zinc-200 border-zinc-200' : 'text-zinc-500 border-transparent hover:text-zinc-200'">
                    Recurring
                  </button>
                </div>

                @if (mode() === 'once') {
                  <div class="flex flex-wrap items-center gap-3 text-[13px]">
                    <label class="flex items-center gap-1.5 cursor-pointer">
                      <input type="radio" name="when" value="now" [(ngModel)]="when"> Run now
                    </label>
                    <label class="flex items-center gap-1.5 cursor-pointer">
                      <input type="radio" name="when" value="later" [(ngModel)]="when"> At:
                    </label>
                    <input type="datetime-local" [(ngModel)]="onceAt" [disabled]="when === 'now'"
                      class="px-2 py-1 rounded border border-border bg-surface2 text-[13px] outline-none focus:border-zinc-500 disabled:opacity-40">
                  </div>
                }

                @if (mode() === 'recurring') {
                  <div class="flex flex-wrap gap-1.5">
                    @for (p of presets; track p) {
                      <button type="button" (click)="preset.set(p)"
                        class="px-2.5 py-1 rounded-full text-[12px] font-medium border transition-colors"
                        [class]="preset() === p ? 'bg-accent text-white border-accent' : 'bg-surface2 border-border text-zinc-500 hover:text-zinc-200 hover:border-zinc-500'">
                        {{ presetLabel(p) }}
                      </button>
                    }
                  </div>

                  @if (preset() === 'daily') {
                    <div class="flex items-center gap-2 text-[13px]">
                      <span class="text-zinc-500">At</span>
                      <input type="time" [(ngModel)]="dailyTime"
                        class="px-2 py-1 rounded border border-border bg-surface2 text-[13px] outline-none focus:border-zinc-500">
                    </div>
                  }

                  @if (preset() === 'weekly') {
                    <div class="flex items-center gap-2 flex-wrap text-[13px]">
                      <span class="text-zinc-500">On</span>
                      <select [(ngModel)]="weeklyDow" class="px-2 py-1 rounded border border-border bg-surface2 text-[13px] outline-none">
                        <option value="0">Sunday</option>
                        <option value="1">Monday</option>
                        <option value="2">Tuesday</option>
                        <option value="3">Wednesday</option>
                        <option value="4">Thursday</option>
                        <option value="5">Friday</option>
                        <option value="6">Saturday</option>
                      </select>
                      <span class="text-zinc-500">at</span>
                      <input type="time" [(ngModel)]="weeklyTime"
                        class="px-2 py-1 rounded border border-border bg-surface2 text-[13px] outline-none focus:border-zinc-500">
                    </div>
                  }

                  @if (preset() === 'custom') {
                    <div>
                      <input type="text" [(ngModel)]="customCron" placeholder="0 9 * * *"
                        class="w-full px-3 py-1.5 rounded border border-border bg-surface2 text-[13px] font-mono outline-none focus:border-zinc-500">
                      <p class="text-[11px] text-zinc-500 mt-1">Standard 5-field cron: minute hour dom month dow</p>
                    </div>
                  }
                }
              </div>
            }
          </div>
        </form>

        <!-- Category tabs -->
        <div class="flex flex-wrap items-center gap-2 justify-center mb-6 pt-6">
          @for (c of categories; track c) {
            <button type="button" (click)="activeCategory.set(c)"
              class="px-4 py-1.5 rounded-full text-[13px] font-medium transition-colors"
              [class]="activeCategory() === c ? 'bg-accent text-white' : 'text-zinc-500 hover:text-zinc-200'">
              {{ c }}
            </button>
          }
        </div>

        <!-- Template cards -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          @for (t of filteredTemplates(); track t.title) {
            <button type="button" (click)="applyTemplate(t)"
              class="text-left rounded-xl border border-border bg-surface hover:border-zinc-600 transition-colors p-4 flex flex-col gap-2 min-h-[150px]">
              <div class="w-9 h-9 rounded-lg bg-accent text-white flex items-center justify-center text-sm font-semibold shrink-0">
                {{ t.title.charAt(0) }}
              </div>
              <div class="font-semibold text-[14px] text-zinc-200 leading-tight">{{ t.title }}</div>
              <div class="text-[12px] text-zinc-500 leading-relaxed line-clamp-3">{{ t.description }}</div>
            </button>
          }
        </div>
      </div>
    </div>
  `,
})
export class TaskCreateComponent implements OnInit {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private statusSvc = inject(StatusService);
  private chatList = inject(ChatListService);
  router = inject(Router);
  auth = inject(AuthService);

  groups = signal<GroupDetail[]>([]);
  selectedGroup: GroupDetail | null = null;

  mode = signal<Mode>('once');
  preset = signal<Preset>('hourly');
  presets: Preset[] = ['hourly', 'daily', 'weekly', 'custom'];
  scheduleOpen = signal(false);

  prompt = '';

  when: 'now' | 'later' = 'now';
  onceAt = this.defaultLocalDateTime();

  dailyTime = '09:00';
  weeklyDow: '0'|'1'|'2'|'3'|'4'|'5'|'6' = '1';
  weeklyTime = '09:00';
  customCron = '0 * * * *';

  categories: Category[] = ['Featured', 'Daily', 'Research', 'Reminders', 'Workflows'];
  activeCategory = signal<Category>('Featured');

  templates: Template[] = [
    { category: 'Featured', title: 'Morning Brief', description: 'Summarize my unread emails and calendar for the day every morning at 9am.', prompt: 'Summarize my unread emails and today\'s calendar. Flag anything urgent.', mode: 'recurring', preset: 'daily' },
    { category: 'Featured', title: 'Stretch Reminder', description: 'Remind me to stretch every hour during work hours.', prompt: 'Remind me to take a 2-minute stretch break and suggest a quick exercise.', mode: 'recurring', preset: 'hourly' },
    { category: 'Featured', title: 'Weekly Review', description: 'Every Monday morning, summarize what I accomplished last week and flag unfinished work.', prompt: 'Summarize what I accomplished last week from my messages and tasks. Flag unfinished work and suggest priorities for this week.', mode: 'recurring', preset: 'weekly' },
    { category: 'Featured', title: 'One-off Draft', description: 'In 10 minutes, draft a quick status update for the team.', prompt: 'Draft a short status update for my team covering today\'s progress, blockers, and tomorrow\'s plan.', mode: 'once' },

    { category: 'Daily', title: 'Inbox Zero', description: 'Each morning, triage my inbox — which emails need a reply today?', prompt: 'Look at my unread emails and categorize them: needs reply today, can wait, or can be archived.', mode: 'recurring', preset: 'daily' },
    { category: 'Daily', title: 'Calendar Check', description: 'Every morning, review tomorrow\'s meetings and flag any conflicts.', prompt: 'Check tomorrow\'s calendar. Flag any conflicts, back-to-back meetings, or prep I should do tonight.', mode: 'recurring', preset: 'daily' },
    { category: 'Daily', title: 'End-of-Day Wrap', description: 'At 5pm, summarize today\'s work and queue up tomorrow.', prompt: 'Summarize what I did today and suggest top 3 priorities for tomorrow.', mode: 'recurring', preset: 'daily' },
    { category: 'Daily', title: 'Standup Note', description: 'Every weekday morning, draft a standup update from yesterday\'s activity.', prompt: 'Draft a 3-bullet standup note: yesterday, today, blockers. Use my recent messages and commits for context.', mode: 'recurring', preset: 'daily' },

    { category: 'Research', title: 'Market Pulse', description: 'Scan news and social for anything relevant to my portfolio this morning.', prompt: 'Scan top news and Twitter for anything material to my investments. Summarize and flag anything that needs immediate attention.', mode: 'recurring', preset: 'daily' },
    { category: 'Research', title: 'Competitor Watch', description: 'Every Monday, check competitor product and pricing pages for changes.', prompt: 'Check the competitor product and pricing pages listed in my notes. Summarize any changes from last week.', mode: 'recurring', preset: 'weekly' },
    { category: 'Research', title: 'Topic Deep Dive', description: 'Research a specific topic deeply, once — useful for ad-hoc briefings.', prompt: 'Research this topic in depth: [replace with topic]. Return a structured summary: background, key players, recent developments, open questions.', mode: 'once' },
    { category: 'Research', title: 'Paper Digest', description: 'Weekly: find the most-discussed new papers in my field and summarize.', prompt: 'Find the 5 most-discussed new papers in my field this week and summarize each in 3 sentences.', mode: 'recurring', preset: 'weekly' },

    { category: 'Reminders', title: 'Quick Reminder', description: 'One-off: ping me in 10 minutes with a message.', prompt: 'Ping me with a reminder: [replace with what you want to remember].', mode: 'once' },
    { category: 'Reminders', title: 'Hydrate', description: 'Every hour, remind me to drink water.', prompt: 'Remind me to drink some water.', mode: 'recurring', preset: 'hourly' },
    { category: 'Reminders', title: 'Posture Check', description: 'Every hour, remind me to sit up straight and adjust my screen.', prompt: 'Posture check: sit up, shoulders back, screen at eye level. Quick reset.', mode: 'recurring', preset: 'hourly' },
    { category: 'Reminders', title: 'Evening Wind Down', description: 'At 9pm every night, remind me to wind down and plan tomorrow.', prompt: 'Wind-down reminder: close laptop, write 3 things for tomorrow, and step away from the screen.', mode: 'recurring', preset: 'daily' },

    { category: 'Workflows', title: 'Draft a Post', description: 'Ad-hoc: draft a post or tweet on a topic I specify.', prompt: 'Draft a post about: [replace with topic]. Return 3 variants: short/punchy, long/narrative, thread.', mode: 'once' },
    { category: 'Workflows', title: 'Meeting Recap', description: 'Ad-hoc: turn rough notes into a structured meeting recap.', prompt: 'Turn these meeting notes into a structured recap with Decisions, Action Items, and Open Questions: [paste notes]', mode: 'once' },
    { category: 'Workflows', title: 'PR Description', description: 'Ad-hoc: turn a code diff into a clean PR description.', prompt: 'Write a PR description based on this diff: [paste diff]. Include Summary, Changes, Test Plan.', mode: 'once' },
    { category: 'Workflows', title: 'Email Triage Rule', description: 'Daily: apply my triage rules to new messages and reply to simple ones.', prompt: 'Go through new emails. For each: categorize (urgent, reply needed, FYI, archive). Draft 1-line replies for the FYIs I should acknowledge.', mode: 'recurring', preset: 'daily' },
  ];

  filteredTemplates = computed(() => {
    const cat = this.activeCategory();
    if (cat === 'Featured') return this.templates.filter(t => t.category === 'Featured');
    return this.templates.filter(t => t.category === cat);
  });

  suggestions = [
    'Summarize my unread emails every morning at 9am',
    'In 10 minutes, draft a quick status update',
    'Every Monday at 9, plan the week',
    'Check my calendar tomorrow and flag conflicts',
  ];

  scheduleSummary = computed(() => {
    if (this.mode() === 'once') {
      if (this.when === 'now') return 'Run now';
      const d = new Date(this.onceAt);
      return isNaN(d.getTime()) ? 'Once' : 'Once at ' + d.toLocaleString();
    }
    const p = this.preset();
    if (p === 'hourly') return 'Every hour';
    if (p === 'daily') return 'Daily at ' + this.dailyTime;
    if (p === 'weekly') {
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      return 'Weekly on ' + days[parseInt(this.weeklyDow, 10)] + ' at ' + this.weeklyTime;
    }
    return 'Cron: ' + this.customCron;
  });

  canCreate(): boolean {
    return !!this.prompt.trim();
  }

  async ngOnInit(): Promise<void> {
    const list = await this.api.getGroups().catch(() => []);
    this.groups.set(list);
    if (list.length) this.selectedGroup = list[0];
  }

  presetLabel(p: Preset): string {
    return p === 'hourly' ? 'Every hour' : p === 'daily' ? 'Daily' : p === 'weekly' ? 'Weekly' : 'Custom cron';
  }

  applyTemplate(t: Template): void {
    this.prompt = t.prompt;
    if (t.mode) this.mode.set(t.mode);
    if (t.preset) this.preset.set(t.preset);
    this.scheduleOpen.set(true);
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
    el.style.height = Math.min(el.scrollHeight, 300) + 'px';
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
    const prompt = this.prompt.trim();
    if (!prompt) { this.toast.show('Enter a prompt first', true); return; }
    const sched = this.buildSchedule();
    if (!sched) return;

    // Every task gets its own fresh web chat (1:1 chat↔task). Name the chat
    // from the first line of the prompt so it's recognizable in the sidebar.
    const chatName = prompt.split('\n')[0].slice(0, 60).trim() || 'New scheduled task';

    try {
      const folder = this.webFolder();
      if (!folder) {
        this.toast.show('No web group configured — cannot create task', true);
        return;
      }

      const newChat = await this.chatList.create(chatName);

      await this.api.createTask({
        prompt,
        group_folder: folder,
        chat_jid: newChat.jid,
        schedule_type: sched.type,
        schedule_value: sched.value,
        context_mode: 'group',
      });

      // Seed the chat with the prompt so the agent sees the task in history
      // (future chat-style questions like "what's this task about" can then be
      // answered). This triggers one agent run now; scheduled runs continue
      // on top per the configured schedule.
      try {
        await this.api.sendMessage(prompt, newChat.jid);
      } catch { /* non-fatal: the task is still created */ }

      this.toast.show('Task created');
      await this.statusSvc.refresh();
      this.router.navigate(['/chat', newChat.jid]);
    } catch (e: any) { this.toast.show(e.message, true); }
  }

  private webFolder(): string | null {
    const s = this.statusSvc.status();
    if (!s) return null;
    const preferred = s.groups.find((g) => g.jid === 'web:localhost');
    if (preferred) return preferred.folder;
    const anyWeb = s.groups.find((g) => g.jid.startsWith('web:'));
    return anyWeb?.folder || null;
  }
}
