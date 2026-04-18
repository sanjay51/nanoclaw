import { Injectable, inject } from '@angular/core';
import { AuthService } from './auth.service';
import {
  StatusData, GroupDetail, TaskDetail, TaskRunLog,
  SessionInfo, ChatSummary, MessageItem, Personality, CredentialItem,
} from '../shared/types';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private auth = inject(AuthService);

  private url(path: string): string {
    return this.auth.endpoint() + path;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { ...extra };
    const token = this.auth.token();
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const opts: RequestInit = { method, headers: this.headers() };
    if (body !== undefined) {
      (opts.headers as Record<string, string>)['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(this.url(path), opts);
    if (res.status === 204) return null as T;
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || res.statusText);
    return data as T;
  }

  // Status
  getStatus(): Promise<StatusData> { return this.request('GET', '/api/status'); }

  // Groups
  getGroups(): Promise<GroupDetail[]> { return this.request('GET', '/api/groups'); }
  getGroup(jid: string): Promise<GroupDetail> { return this.request('GET', `/api/groups/${encodeURIComponent(jid)}`); }
  updateGroup(jid: string, data: unknown): Promise<void> { return this.request('PATCH', `/api/groups/${encodeURIComponent(jid)}`, data); }
  deleteGroup(jid: string): Promise<void> { return this.request('DELETE', `/api/groups/${encodeURIComponent(jid)}`); }
  registerGroup(data: unknown): Promise<{ ok: boolean; jid: string }> { return this.request('POST', '/api/groups', data); }
  getGroupMessages(jid: string, limit = 50): Promise<MessageItem[]> {
    return this.request('GET', `/api/groups/${encodeURIComponent(jid)}/messages?limit=${limit}`);
  }

  // Tasks
  createTask(data: unknown): Promise<TaskDetail> { return this.request('POST', '/api/tasks', data); }
  getTask(id: string): Promise<TaskDetail> { return this.request('GET', `/api/tasks/${encodeURIComponent(id)}`); }
  updateTask(id: string, data: unknown): Promise<void> { return this.request('PATCH', `/api/tasks/${encodeURIComponent(id)}`, data); }
  deleteTask(id: string): Promise<void> { return this.request('DELETE', `/api/tasks/${encodeURIComponent(id)}`); }
  getTaskLogs(id: string, limit = 20): Promise<TaskRunLog[]> { return this.request('GET', `/api/tasks/${encodeURIComponent(id)}/logs?limit=${limit}`); }
  runTask(id: string): Promise<{ ok: boolean }> { return this.request('POST', `/api/tasks/${encodeURIComponent(id)}/run`); }

  // Sessions
  getSessions(): Promise<SessionInfo[]> { return this.request('GET', '/api/sessions'); }
  deleteSession(folder: string): Promise<void> { return this.request('DELETE', `/api/sessions/${encodeURIComponent(folder)}`); }

  // Chats
  getChats(): Promise<ChatSummary[]> { return this.request('GET', '/api/chats'); }
  getWebChats(): Promise<ChatSummary[]> { return this.request('GET', '/api/chats?channel=web'); }
  createWebChat(name?: string): Promise<{ jid: string; name: string }> {
    return this.request('POST', '/api/chats', { name: name || 'New chat' });
  }
  renameWebChat(jid: string, name: string): Promise<{ ok: boolean }> {
    return this.request('PATCH', `/api/chats/${encodeURIComponent(jid)}`, { name });
  }
  deleteWebChat(jid: string): Promise<{ ok: boolean }> {
    return this.request('DELETE', `/api/chats/${encodeURIComponent(jid)}`);
  }
  getChatMessages(jid: string, limit = 200): Promise<MessageItem[]> {
    return this.request('GET', `/api/chats/${encodeURIComponent(jid)}/messages?limit=${limit}`);
  }

  // Messages
  sendMessage(text: string, chatJid?: string): Promise<void> {
    return this.request('POST', '/api/message', { text, chat_jid: chatJid });
  }

  // Upload
  async uploadImages(files: File[], chatJid: string, text?: string): Promise<void> {
    const formData = new FormData();
    files.forEach(f => formData.append('file', f));
    let uploadUrl = this.url(`/api/upload?chat_jid=${encodeURIComponent(chatJid)}`);
    if (text) uploadUrl += `&text=${encodeURIComponent(text)}`;
    const res = await fetch(uploadUrl, {
      method: 'POST',
      headers: this.auth.token() ? { Authorization: `Bearer ${this.auth.token()}` } : {},
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Upload failed');
    }
  }

  // Personalities
  getPersonalities(): Promise<Personality[]> { return this.request('GET', '/api/personalities'); }
  createPersonality(data: { name: string; instructions?: string }): Promise<Personality> { return this.request('POST', '/api/personalities', data); }
  updatePersonality(id: string, data: { name?: string; instructions?: string }): Promise<Personality> { return this.request('PATCH', `/api/personalities/${encodeURIComponent(id)}`, data); }
  deletePersonality(id: string): Promise<void> { return this.request('DELETE', `/api/personalities/${encodeURIComponent(id)}`); }

  // Credentials
  getCredentials(): Promise<CredentialItem[]> { return this.request('GET', '/api/credentials'); }
  createCredential(data: { name: string; website?: string; username?: string; password?: string; notes?: string }): Promise<CredentialItem> {
    return this.request('POST', '/api/credentials', data);
  }
  updateCredential(id: string, data: { name?: string; website?: string; username?: string; password?: string; notes?: string }): Promise<CredentialItem> {
    return this.request('PATCH', `/api/credentials/${encodeURIComponent(id)}`, data);
  }
  deleteCredential(id: string): Promise<void> { return this.request('DELETE', `/api/credentials/${encodeURIComponent(id)}`); }

  // Logs
  getLogs(type: 'all' | 'error' = 'all', lines = 80): Promise<{ lines: string[] }> {
    return this.request('GET', `/api/logs?type=${type}&lines=${lines}`);
  }

  // File URL helper (for images)
  fileUrl(folder: string, subpath: string): string {
    return this.url(`/api/files/${encodeURIComponent(folder)}/${subpath}`);
  }

  // SSE URL
  sseUrl(): string {
    const token = this.auth.token();
    return this.url('/api/events') + (token ? `?token=${encodeURIComponent(token)}` : '');
  }
}
