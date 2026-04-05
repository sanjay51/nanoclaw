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
    <div class="px-6 py-4 border-b border-border bg-surface flex items-center gap-3">
      <h2 class="text-lg font-semibold">Tasks</h2>
      <div class="ml-auto">
        <button (click)="router.navigate(['/tasks/new'])" class="px-3 py-1.5 rounded bg-accent text-white text-sm font-medium hover:bg-accent-hover">+ New Task</button>
      </div>
    </div>
    <div class="p-6 overflow-y-auto flex-1">
      @if (tasks.length) {
        <table class="w-full text-sm">
          <thead><tr class="text-xs text-zinc-500 uppercase tracking-wider">
            <th class="text-left px-3 py-2">Prompt</th><th class="text-left px-3 py-2">Group</th>
            <th class="text-left px-3 py-2">Schedule</th><th class="text-left px-3 py-2">Status</th>
            <th class="text-left px-3 py-2">Next Run</th><th class="text-left px-3 py-2">Actions</th>
          </tr></thead>
          <tbody>
            @for (t of tasks; track t.id) {
              <tr class="border-t border-border">
                <td (click)="router.navigate(['/tasks', t.id])" class="px-3 py-2.5 cursor-pointer hover:text-accent max-w-xs truncate">{{ t.prompt }}</td>
                <td class="px-3 py-2.5"><code class="text-xs text-zinc-400">{{ t.group }}</code></td>
                <td class="px-3 py-2.5 text-zinc-500">{{ t.type }}: <code>{{ t.value }}</code></td>
                <td class="px-3 py-2.5">
                  <span class="text-xs px-2 py-0.5 rounded-full border"
                    [class]="t.status === 'active' ? 'bg-green-500/10 text-green-400 border-green-500/30' : t.status === 'paused' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30' : 'text-zinc-500 border-border'">{{ t.status }}</span>
                </td>
                <td class="px-3 py-2.5 text-zinc-500">{{ rel(t.nextRun) }}</td>
                <td class="px-3 py-2.5">
                  @if (t.status === 'active') {
                    <button (click)="toggle(t.id, 'paused')" class="text-xs px-2 py-1 rounded border border-border hover:bg-zinc-800">Pause</button>
                  } @else if (t.status === 'paused') {
                    <button (click)="toggle(t.id, 'active')" class="text-xs px-2 py-1 rounded bg-accent/10 text-accent border border-accent/30 hover:bg-accent/20">Resume</button>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      } @else {
        <p class="text-zinc-500 text-center py-10 italic">No scheduled tasks</p>
      }
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

  async toggle(id: string, newStatus: string): Promise<void> {
    try {
      await this.api.updateTask(id, { status: newStatus });
      this.toast.show(`Task ${newStatus === 'paused' ? 'paused' : 'resumed'}`);
      await this.status.refresh();
      this.tasks = this.status.status()?.tasks || [];
    } catch (e: any) { this.toast.show(e.message, true); }
  }
}
