import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { ToastService } from '../../services/toast.service';
import { Personality } from '../../shared/types';

@Component({
  selector: 'app-personalities',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="px-6 py-4 border-b border-border bg-surface flex items-center justify-between">
      <h2 class="text-lg font-semibold">Personalities</h2>
      <button (click)="startCreate()" class="px-3 py-1.5 rounded bg-accent text-white text-sm font-medium hover:bg-accent-hover">+ New Personality</button>
    </div>
    <div class="p-6 overflow-y-auto flex-1 space-y-6">
      @if (editing()) {
        <section class="border border-border rounded-lg p-5 bg-surface max-w-2xl">
          <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">{{ editId ? 'Edit' : 'New' }} Personality</h3>
          <div class="space-y-4">
            <div>
              <label class="block text-xs text-zinc-500 mb-1">Name</label>
              <input [(ngModel)]="editName" placeholder="e.g. Friendly Helper" class="w-full px-3 py-2 rounded border border-border bg-zinc-950 text-sm outline-none focus:border-accent">
            </div>
            <div>
              <label class="block text-xs text-zinc-500 mb-1">Instructions</label>
              <textarea [(ngModel)]="editInstructions" rows="8" placeholder="Custom instructions for how the agent should behave..." class="w-full px-3 py-2 rounded border border-border bg-zinc-950 text-sm outline-none focus:border-accent resize-y min-h-[120px]"></textarea>
            </div>
            <div class="flex gap-2">
              <button (click)="saveEdit()" class="px-4 py-1.5 rounded bg-accent text-white text-sm font-medium hover:bg-accent-hover">Save</button>
              <button (click)="cancelEdit()" class="px-4 py-1.5 rounded border border-border text-sm text-zinc-400 hover:bg-zinc-800">Cancel</button>
            </div>
          </div>
        </section>
      }

      @if (personalities().length === 0 && !editing()) {
        <div class="text-zinc-500 text-sm">No personalities yet. Create one to get started.</div>
      } @else {
        <div class="space-y-3 max-w-2xl">
          @for (p of personalities(); track p.id) {
            <div class="border border-border rounded-lg p-4 bg-surface hover:border-zinc-600 transition-colors">
              <div class="flex items-start justify-between gap-3">
                <div class="flex-1 min-w-0">
                  <h4 class="font-medium text-sm">{{ p.name }}</h4>
                  <p class="text-xs text-zinc-500 mt-1 line-clamp-2">{{ p.instructions || 'No instructions set' }}</p>
                </div>
                <div class="flex gap-1.5 shrink-0">
                  <button (click)="startEdit(p)" class="px-2.5 py-1 rounded border border-border text-xs text-zinc-400 hover:bg-zinc-800">Edit</button>
                  <button (click)="remove(p)" class="px-2.5 py-1 rounded border border-red-500/30 text-xs text-red-400 hover:bg-red-500/10">Delete</button>
                </div>
              </div>
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class PersonalitiesComponent implements OnInit {
  private api = inject(ApiService);
  private toast = inject(ToastService);

  personalities = signal<Personality[]>([]);
  editing = signal(false);
  editId = '';
  editName = '';
  editInstructions = '';

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    try {
      this.personalities.set(await this.api.getPersonalities());
    } catch (e: any) {
      this.toast.show(e.message, true);
    }
  }

  startCreate(): void {
    this.editId = '';
    this.editName = '';
    this.editInstructions = '';
    this.editing.set(true);
  }

  startEdit(p: Personality): void {
    this.editId = p.id;
    this.editName = p.name;
    this.editInstructions = p.instructions;
    this.editing.set(true);
  }

  cancelEdit(): void {
    this.editing.set(false);
  }

  async saveEdit(): Promise<void> {
    if (!this.editName.trim()) {
      this.toast.show('Name is required', true);
      return;
    }
    try {
      if (this.editId) {
        await this.api.updatePersonality(this.editId, {
          name: this.editName.trim(),
          instructions: this.editInstructions,
        });
        this.toast.show('Personality updated');
      } else {
        await this.api.createPersonality({
          name: this.editName.trim(),
          instructions: this.editInstructions,
        });
        this.toast.show('Personality created');
      }
      this.editing.set(false);
      await this.load();
    } catch (e: any) {
      this.toast.show(e.message, true);
    }
  }

  async remove(p: Personality): Promise<void> {
    if (!confirm(`Delete personality "${p.name}"?`)) return;
    try {
      await this.api.deletePersonality(p.id);
      this.toast.show('Personality deleted');
      await this.load();
    } catch (e: any) {
      this.toast.show(e.message, true);
    }
  }
}
