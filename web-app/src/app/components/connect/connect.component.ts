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
    <div class="flex items-center justify-center w-full h-screen px-4">
      <div class="w-full max-w-md">
        <div class="flex items-center gap-2 mb-10">
          <span class="text-2xl">🐕</span>
          <span class="font-serif text-2xl tracking-tight">romi</span>
        </div>
        <h1 class="font-serif text-4xl leading-tight tracking-tight mb-2">Connect.</h1>
        <p class="text-[14px] text-zinc-500 mb-8">Paste your NanoClaw endpoint and API token.</p>
        <form (ngSubmit)="connect()" class="space-y-4">
          <div>
            <label class="block text-[11px] uppercase tracking-wider font-medium text-zinc-500 mb-1.5">Endpoint URL</label>
            <input [(ngModel)]="endpoint" name="endpoint" type="text" placeholder="http://192.168.1.100:3456"
                   class="w-full px-4 py-3 rounded-xl border border-border bg-surface text-[14px] outline-none focus:border-zinc-500 transition-colors">
          </div>
          <div>
            <label class="block text-[11px] uppercase tracking-wider font-medium text-zinc-500 mb-1.5">API Token</label>
            <input [(ngModel)]="token" name="token" type="password" placeholder="Your API token"
                   class="w-full px-4 py-3 rounded-xl border border-border bg-surface text-[14px] outline-none focus:border-zinc-500 transition-colors">
          </div>
          <button type="submit" [disabled]="loading"
                  class="w-full py-3 rounded-full bg-accent text-white text-[14px] font-medium hover:bg-accent-hover disabled:opacity-40 transition-colors">
            {{ loading ? 'Connecting…' : 'Connect' }}
          </button>
          <label class="flex items-center gap-2 text-[13px] text-zinc-500 cursor-pointer">
            <input type="checkbox" [(ngModel)]="remember" name="remember"> Remember connection
          </label>
          @if (error) {
            <div class="px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-red-600 text-[13px]">{{ error }}</div>
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
