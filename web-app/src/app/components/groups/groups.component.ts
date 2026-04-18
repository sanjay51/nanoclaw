import { Component, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { GroupDetail } from '../../shared/types';
import { relTime } from '../../shared/utils';

@Component({
  selector: 'app-groups',
  standalone: true,
  template: `
    <div class="flex items-center gap-3 mb-4">
      <h3 class="font-serif text-xl text-zinc-200">Registered Groups</h3>
      <div class="ml-auto">
        <button (click)="router.navigate(['/groups/register'])" class="px-3 py-1.5 rounded-full bg-accent text-white text-[13px] font-medium hover:bg-accent-hover">+ Register Channel</button>
      </div>
    </div>
    <div class="rounded-2xl border border-border bg-surface overflow-hidden">
      @if (groups().length) {
        <table class="w-full text-sm">
          <thead><tr class="text-xs text-zinc-500 uppercase tracking-wider">
            <th class="text-left px-3 py-2">Name</th><th class="text-left px-3 py-2">Folder</th>
            <th class="text-left px-3 py-2">Channel</th><th class="text-left px-3 py-2">Type</th><th class="text-left px-3 py-2">Added</th>
          </tr></thead>
          <tbody>
            @for (g of groups(); track g.jid) {
              <tr (click)="router.navigate(['/groups', g.jid])" class="border-t border-border cursor-pointer hover:bg-zinc-800/50">
                <td class="px-3 py-2.5 font-medium">{{ g.name }}</td>
                <td class="px-3 py-2.5"><code class="text-xs text-zinc-400">{{ g.folder }}</code></td>
                <td class="px-3 py-2.5 text-zinc-500">{{ g.jid.split(':')[0] }}</td>
                <td class="px-3 py-2.5">
                  @if (g.isMain) { <span class="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/30">main</span> }
                  @else { {{ g.requiresTrigger ? 'trigger' : 'auto' }} }
                </td>
                <td class="px-3 py-2.5 text-zinc-500">{{ rel(g.added_at) }}</td>
              </tr>
            }
          </tbody>
        </table>
      } @else {
        <p class="text-zinc-500 text-center py-10 italic">No channels registered</p>
      }
    </div>
  `,
})
export class GroupsComponent implements OnInit {
  private api = inject(ApiService);
  router = inject(Router);
  groups = signal<GroupDetail[]>([]);
  rel = relTime;

  async ngOnInit(): Promise<void> {
    this.groups.set(await this.api.getGroups().catch(() => []));
  }
}
