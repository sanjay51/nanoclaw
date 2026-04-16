import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { SseService } from '../../services/sse.service';
import { StatusService } from '../../services/status.service';

@Component({
  selector: 'app-connect',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="flex items-center justify-center w-full h-screen">
      <div class="bg-surface border border-border rounded-xl p-8 w-96 max-w-[90vw]">
        <h1 class="text-xl font-bold tracking-tight mb-1">Romi 🐕</h1>
        <p class="text-sm text-zinc-500 mb-6">Connect to your NanoClaw instance</p>
        <form (ngSubmit)="connect()">
          <div class="mb-4">
            <label class="block text-xs font-medium text-zinc-500 mb-1.5">Endpoint URL</label>
            <input [(ngModel)]="endpoint" name="endpoint" type="text" placeholder="http://192.168.1.100:3456"
                   class="w-full px-3 py-2.5 rounded-md border border-border bg-zinc-950 text-zinc-200 text-sm outline-none focus:border-accent">
          </div>
          <div class="mb-4">
            <label class="block text-xs font-medium text-zinc-500 mb-1.5">API Token</label>
            <input [(ngModel)]="token" name="token" type="password" placeholder="Your API token"
                   class="w-full px-3 py-2.5 rounded-md border border-border bg-zinc-950 text-zinc-200 text-sm outline-none focus:border-accent">
          </div>
          <button type="submit" [disabled]="loading"
                  class="w-full py-2.5 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent-hover disabled:opacity-40 transition-colors">
            {{ loading ? 'Connecting...' : 'Connect' }}
          </button>
          <label class="flex items-center gap-2 mt-3 text-sm text-zinc-500 cursor-pointer">
            <input type="checkbox" [(ngModel)]="remember" name="remember" class="accent-blue-500"> Remember connection
          </label>
          @if (error) {
            <div class="mt-3 px-3 py-2 rounded-md bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{{ error }}</div>
          }
        </form>
      </div>
    </div>
  `,
})
export class ConnectComponent {
  private auth = inject(AuthService);
  private sse = inject(SseService);
  private status = inject(StatusService);

  endpoint = '';
  token = '';
  remember = false;
  loading = false;
  error = '';

  constructor() {
    const saved = this.auth.getSavedCredentials();
    if (saved) {
      this.endpoint = saved.endpoint;
      this.token = saved.token;
      this.remember = true;
    }
  }

  async connect(): Promise<void> {
    if (!this.endpoint.trim()) { this.error = 'Endpoint URL is required'; return; }
    this.loading = true;
    this.error = '';

    try {
      const url = this.endpoint.replace(/\/+$/, '');
      const res = await fetch(url + '/api/status', {
        headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
      });
      if (res.status === 401) throw new Error('Invalid token');
      if (!res.ok) throw new Error('Connection failed: ' + res.status);

      const data = await res.json();
      this.auth.connect(this.endpoint, this.token, data.assistant || 'Romi');
      if (this.remember) this.auth.saveCredentials(this.endpoint, this.token);
      this.sse.connect();
      this.status.refresh();
      this.status.startPolling();
    } catch (e: any) {
      this.error = e.message || 'Connection failed';
    } finally {
      this.loading = false;
    }
  }
}
