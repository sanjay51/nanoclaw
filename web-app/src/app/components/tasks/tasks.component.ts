import { Component, inject, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { StatusService } from '../../services/status.service';
import { ToastService } from '../../services/toast.service';
import { relTime } from '../../shared/utils';

@Component({
  selector: 'app-tasks',
  standalone: true,
  template: `
    <div class="flex-1 overflow-y-auto">
      <div class="max-w-5xl mx-auto px-6 pt-14 pb-20">

        <div class="flex items-end justify-between mb-8">
          <div>
            <h1 class="font-serif text-4xl tracking-tight text-zinc-200">Tasks</h1>
            <p class="text-[13px] text-zinc-500 mt-1">Scheduled and recurring work.</p>
          </div>
          <button (click)="router.navigate(['/tasks/new'])"
            class="px-4 py-2 rounded-full bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors">
            + New Task
          </button>
        </div>

        @if (tasks.length) {
          <div class="rounded-2xl border border-border bg-surface overflow-hidden">
            <table class="w-full text-sm">
              <thead class="bg-surface2">
                <tr class="text-[11px] text-zinc-500 uppercase tracking-wider">
                  <th class="text-left px-5 py-3 font-medium">Prompt</th>
                  <th class="text-left px-5 py-3 font-medium">Group</th>
                  <th class="text-left px-5 py-3 font-medium">Schedule</th>
                  <th class="text-left px-5 py-3 font-medium">Status</th>
                  <th class="text-left px-5 py-3 font-medium">Next Run</th>
                  <th class="text-left px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                @for (t of tasks; track t.id; let i = $index) {
                  <tr class="border-t border-border hover:bg-surface2/60 transition-colors">
                    <td (click)="openTask(t)" class="px-5 py-3 cursor-pointer max-w-md">
                      <div class="truncate text-zinc-200 font-medium">{{ t.prompt }}</div>
                    </td>
                    <td class="px-5 py-3 text-zinc-500"><code class="text-[12px]">{{ t.group }}</code></td>
                    <td class="px-5 py-3 text-zinc-500 text-[13px]">{{ t.type }}: <code class="text-[12px]">{{ t.value }}</code></td>
                    <td class="px-5 py-3">
                      <span class="text-[11px] px-2 py-0.5 rounded-full"
                        [class]="t.status === 'active' ? 'bg-green-100 text-green-700' : t.status === 'paused' ? 'bg-amber-100 text-amber-700' : 'bg-zinc-100 text-zinc-600'">{{ t.status }}</span>
                    </td>
                    <td class="px-5 py-3 text-zinc-500 text-[13px]">{{ rel(t.nextRun) }}</td>
                    <td class="px-5 py-3 text-right">
                      @if (t.status === 'active') {
                        <button (click)="toggle(t.id, 'paused')" class="text-[12px] px-2.5 py-1 rounded-full border border-border text-zinc-500 hover:text-zinc-200 hover:border-zinc-500">Pause</button>
                      } @else if (t.status === 'paused') {
                        <button (click)="toggle(t.id, 'active')" class="text-[12px] px-2.5 py-1 rounded-full border border-zinc-600 text-zinc-200 hover:bg-zinc-800/60">Resume</button>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <div class="rounded-2xl border border-border bg-surface p-12 text-center">
            <p class="font-serif text-2xl text-zinc-200 mb-2">No tasks yet.</p>
            <p class="text-zinc-500 text-[14px] mb-6">Schedule something for me to work on.</p>
            <button (click)="router.navigate(['/tasks/new'])"
              class="px-4 py-2 rounded-full bg-accent text-white text-sm font-medium hover:bg-accent-hover">
              + Create your first task
            </button>
          </div>
        }
      </div>
    </div>
  `,
})
export class TasksComponent implements OnInit {
  private api = inject(ApiService);
  private status = inject(StatusService);
  private toast = inject(ToastService);
  router = inject(Router);
  tasks: any[] = [];
  rel = relTime;

  async ngOnInit(): Promise<void> {
    await this.status.refresh();
    this.tasks = this.status.status()?.tasks || [];
  }

  openTask(t: any): void {
    const jid: string = t.chatJid || '';
    if (jid.startsWith('web:')) {
      this.router.navigate(['/chat', jid]);
    } else {
      this.router.navigate(['/tasks', t.id]);
    }
  }

  async toggle(id: string, newStatus: string): Promise<void> {
    try {
      await this.api.updateTask(id, { status: newStatus });
      this.toast.show(`Task ${newStatus === 'paused' ? 'paused' : 'resumed'}`);
      await this.status.refresh();
      this.tasks = this.status.status()?.tasks || [];
    } catch (e: any) { this.toast.show(e.message, true); }
  }
}
