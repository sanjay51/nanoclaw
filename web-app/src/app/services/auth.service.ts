import { Injectable, signal, computed } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private _endpoint = signal('');
  private _token = signal('');
  private _connected = signal(false);
  private _assistantName = signal('Romi');

  endpoint = this._endpoint.asReadonly();
  token = this._token.asReadonly();
  connected = this._connected.asReadonly();
  assistantName = this._assistantName.asReadonly();

  connect(endpoint: string, token: string, assistantName: string): void {
    this._endpoint.set(endpoint.replace(/\/+$/, ''));
    this._token.set(token);
    this._assistantName.set(assistantName);
    this._connected.set(true);
  }

  disconnect(): void {
    this._endpoint.set('');
    this._token.set('');
    this._connected.set(false);
    this._assistantName.set('NanoClaw');
    localStorage.removeItem('nanoclaw-endpoint');
    localStorage.removeItem('nanoclaw-token');
  }

  saveCredentials(endpoint: string, token: string): void {
    localStorage.setItem('nanoclaw-endpoint', endpoint);
    localStorage.setItem('nanoclaw-token', token);
  }

  getSavedCredentials(): { endpoint: string; token: string } | null {
    const endpoint = localStorage.getItem('nanoclaw-endpoint');
    const token = localStorage.getItem('nanoclaw-token');
    if (endpoint) return { endpoint, token: token || '' };
    return null;
  }
}
