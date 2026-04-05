import { Component, inject, OnInit } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from './services/auth.service';
import { SseService } from './services/sse.service';
import { StatusService } from './services/status.service';
import { ToastService } from './services/toast.service';
import { ConnectComponent } from './components/connect/connect.component';
import { ToastComponent } from './components/toast/toast.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ConnectComponent, ToastComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements OnInit {
  auth = inject(AuthService);
  sse = inject(SseService);
  status = inject(StatusService);
  toast = inject(ToastService);

  navItems = [
    { path: '/chat', label: 'Chat', icon: '\u2709' },
    { path: '/dashboard', label: 'Dashboard', icon: '\u25A0' },
    { path: '/groups', label: 'Groups', icon: '\u2605' },
    { path: '/tasks', label: 'Tasks', icon: '\u23F0' },
    { path: '/system', label: 'System', icon: '\u2699' },
  ];

  ngOnInit(): void {
    const saved = this.auth.getSavedCredentials();
    if (saved) {
      this.autoConnect(saved.endpoint, saved.token);
    }
  }

  private async autoConnect(endpoint: string, token: string): Promise<void> {
    try {
      const url = endpoint.replace(/\/+$/, '');
      const res = await fetch(url + '/api/status', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return;
      const data = await res.json();
      this.auth.connect(endpoint, token, data.assistant || 'NanoClaw');
      this.sse.connect();
      this.status.refresh();
      this.status.startPolling();
    } catch { /* silent */ }
  }

  disconnect(): void {
    this.sse.disconnect();
    this.status.stopPolling();
    this.auth.disconnect();
  }
}
