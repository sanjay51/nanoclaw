import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { StatusData } from '../shared/types';

@Injectable({ providedIn: 'root' })
export class StatusService {
  private api = inject(ApiService);
  private _interval: ReturnType<typeof setInterval> | null = null;

  status = signal<StatusData | null>(null);

  async refresh(): Promise<StatusData> {
    const data = await this.api.getStatus();
    this.status.set(data);
    return data;
  }

  startPolling(intervalMs = 10000): void {
    this.stopPolling();
    this._interval = setInterval(() => this.refresh().catch(() => {}), intervalMs);
  }

  stopPolling(): void {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }
}
