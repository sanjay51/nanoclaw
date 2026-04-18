import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { ToastService } from '../../services/toast.service';
import { CredentialItem } from '../../shared/types';

@Component({
  selector: 'app-credentials',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="flex-1 overflow-y-auto">
      <div class="max-w-5xl mx-auto px-6 pt-14 pb-20">
        <div class="flex items-end justify-between mb-8">
          <div>
            <h1 class="font-serif text-4xl tracking-tight text-zinc-200">Credentials</h1>
            <p class="text-[13px] text-zinc-500 mt-1">Stored logins and tokens.</p>
          </div>
          <button (click)="startCreate()" class="px-4 py-2 rounded-full bg-accent text-white text-sm font-medium hover:bg-accent-hover">+ Add Credential</button>
        </div>
        <div class="space-y-6">
      @if (editing()) {
        <section class="border border-border rounded-lg p-5 bg-surface max-w-2xl">
          <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">{{ editId ? 'Update' : 'New' }} Credential</h3>
          <div class="space-y-4">
            <div>
              <label class="block text-xs text-zinc-500 mb-1">Name</label>
              <input [(ngModel)]="editName" placeholder="e.g. GitHub, AWS, My Server" class="w-full px-3 py-2 rounded border border-border bg-zinc-950 text-sm outline-none focus:border-accent">
            </div>
            <div>
              <label class="block text-xs text-zinc-500 mb-1">Website / URL</label>
              <input [(ngModel)]="editWebsite" placeholder="e.g. https://github.com" class="w-full px-3 py-2 rounded border border-border bg-zinc-950 text-sm outline-none focus:border-accent">
            </div>
            <div>
              <label class="block text-xs text-zinc-500 mb-1">Username / Email</label>
              <input [(ngModel)]="editUsername" placeholder="e.g. user@example.com" class="w-full px-3 py-2 rounded border border-border bg-zinc-950 text-sm outline-none focus:border-accent">
            </div>
            <div>
              <label class="block text-xs text-zinc-500 mb-1">
                Password / Secret
                @if (editId) {
                  <span class="text-zinc-600 ml-1">(leave blank to keep current)</span>
                }
              </label>
              <input [(ngModel)]="editPassword" type="password" placeholder="{{editId ? '********' : 'Enter password'}}" class="w-full px-3 py-2 rounded border border-border bg-zinc-950 text-sm outline-none focus:border-accent">
            </div>
            <div>
              <label class="block text-xs text-zinc-500 mb-1">Notes</label>
              <textarea [(ngModel)]="editNotes" rows="3" placeholder="Any additional info the agent might need..." class="w-full px-3 py-2 rounded border border-border bg-zinc-950 text-sm outline-none focus:border-accent resize-y"></textarea>
            </div>
            <div class="flex gap-2">
              <button (click)="saveEdit()" class="px-4 py-1.5 rounded bg-accent text-white text-sm font-medium hover:bg-accent-hover">Save</button>
              <button (click)="cancelEdit()" class="px-4 py-1.5 rounded border border-border text-sm text-zinc-400 hover:bg-zinc-800">Cancel</button>
            </div>
          </div>
        </section>
      }

      @if (credentials().length === 0 && !editing()) {
        <div class="text-zinc-500 text-sm">No credentials stored yet. Add one so the agent can use it.</div>
      } @else {
        <div class="space-y-3 max-w-2xl">
          @for (c of credentials(); track c.id) {
            <div class="border border-border rounded-lg p-4 bg-surface hover:border-zinc-600 transition-colors">
              <div class="flex items-start justify-between gap-3">
                <div class="flex-1 min-w-0">
                  <h4 class="font-medium text-sm">{{ c.name }}</h4>
                  @if (c.website) {
                    <p class="text-xs text-zinc-500 mt-0.5">{{ c.website }}</p>
                  }
                  <div class="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-zinc-400">
                    @if (c.username) {
                      <span>User: {{ c.username }}</span>
                    }
                    <span>Password: {{ c.has_password ? '********' : 'not set' }}</span>
                  </div>
                  @if (c.notes) {
                    <p class="text-xs text-zinc-500 mt-1.5 line-clamp-2">{{ c.notes }}</p>
                  }
                </div>
                <div class="flex gap-1.5 shrink-0">
                  <button (click)="startEdit(c)" class="px-2.5 py-1 rounded border border-border text-xs text-zinc-400 hover:bg-zinc-800">Update</button>
                  <button (click)="remove(c)" class="px-2.5 py-1 rounded border border-red-500/30 text-xs text-red-400 hover:bg-red-500/10">Delete</button>
                </div>
              </div>
            </div>
          }
        </div>
      }
        </div>
      </div>
    </div>
  `,
})
export class CredentialsComponent implements OnInit {
  private api = inject(ApiService);
  private toast = inject(ToastService);

  credentials = signal<CredentialItem[]>([]);
  editing = signal(false);
  editId = '';
  editName = '';
  editWebsite = '';
  editUsername = '';
  editPassword = '';
  editNotes = '';

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    try {
      this.credentials.set(await this.api.getCredentials());
    } catch (e: any) {
      this.toast.show(e.message, true);
    }
  }

  startCreate(): void {
    this.editId = '';
    this.editName = '';
    this.editWebsite = '';
    this.editUsername = '';
    this.editPassword = '';
    this.editNotes = '';
    this.editing.set(true);
  }

  startEdit(c: CredentialItem): void {
    this.editId = c.id;
    this.editName = c.name;
    this.editWebsite = c.website;
    this.editUsername = c.username;
    this.editPassword = '';
    this.editNotes = c.notes;
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
        const data: Record<string, string> = {
          name: this.editName.trim(),
          website: this.editWebsite,
          username: this.editUsername,
          notes: this.editNotes,
        };
        if (this.editPassword) {
          data['password'] = this.editPassword;
        }
        await this.api.updateCredential(this.editId, data);
        this.toast.show('Credential updated');
      } else {
        await this.api.createCredential({
          name: this.editName.trim(),
          website: this.editWebsite,
          username: this.editUsername,
          password: this.editPassword,
          notes: this.editNotes,
        });
        this.toast.show('Credential saved');
      }
      this.editing.set(false);
      await this.load();
    } catch (e: any) {
      this.toast.show(e.message, true);
    }
  }

  async remove(c: CredentialItem): Promise<void> {
    if (!confirm(`Delete credential "${c.name}"?`)) return;
    try {
      await this.api.deleteCredential(c.id);
      this.toast.show('Credential deleted');
      await this.load();
    } catch (e: any) {
      this.toast.show(e.message, true);
    }
  }
}
