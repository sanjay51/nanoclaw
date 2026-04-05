import { Injectable, inject, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { ApiService } from './api.service';
import { SseEvent } from '../shared/types';

@Injectable({ providedIn: 'root' })
export class SseService {
  private api = inject(ApiService);
  private es: EventSource | null = null;
  private events$ = new Subject<SseEvent>();

  connected = signal(false);
  messages = this.events$.asObservable();

  connect(): void {
    this.disconnect();
    const es = new EventSource(this.api.sseUrl());
    this.es = es;

    es.onopen = () => this.connected.set(true);

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as SseEvent;
        this.events$.next(data);
      } catch { /* ignore */ }
    };

    es.onerror = () => {
      this.connected.set(false);
      es.close();
      this.es = null;
      setTimeout(() => this.connect(), 3000);
    };
  }

  disconnect(): void {
    if (this.es) {
      this.es.close();
      this.es = null;
    }
    this.connected.set(false);
  }
}
