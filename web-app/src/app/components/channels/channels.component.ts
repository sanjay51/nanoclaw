import { Component } from '@angular/core';
import { DashboardComponent } from '../dashboard/dashboard.component';
import { GroupsComponent } from '../groups/groups.component';
import { SystemComponent } from '../system/system.component';

@Component({
  selector: 'app-channels',
  standalone: true,
  imports: [DashboardComponent, GroupsComponent, SystemComponent],
  template: `
    <div class="overflow-y-auto flex-1">
      <div class="max-w-5xl mx-auto px-6 pt-14 pb-20">
        <div class="mb-8">
          <h1 class="font-serif text-4xl tracking-tight text-zinc-200">Channels</h1>
          <p class="text-[13px] text-zinc-500 mt-1">Your messaging channels, registered groups, and system status.</p>
        </div>
        <section class="channels-section mb-8">
          <app-dashboard></app-dashboard>
        </section>
        <section class="channels-section mb-8">
          <app-groups></app-groups>
        </section>
        <section class="channels-section">
          <app-system></app-system>
        </section>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }
    .channels-section {
      display: flex;
      flex-direction: column;
    }
    /* Children use flex-1 + overflow-y-auto assuming they fill a flex parent.
       Inside this wrapper they sit in normal flow, so let them size to their content. */
    .channels-section ::ng-deep .flex-1 {
      flex: 0 0 auto;
    }
    .channels-section ::ng-deep .overflow-y-auto {
      overflow-y: visible;
    }
  `],
})
export class ChannelsComponent {}
