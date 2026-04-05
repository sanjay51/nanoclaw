import fs from 'fs';
import http from 'http';
import path from 'path';
import { randomUUID } from 'crypto';

import { API_TOKEN, ASSISTANT_NAME, WEB_HOST } from '../config.js';
import {
  createTask,
  deleteRegisteredGroup,
  deleteSession,
  deleteTask,
  getAllChats,
  getAllRegisteredGroups,
  getAllSessions,
  getAllTasks,
  getMessageHistory,
  getRegisteredGroup,
  getTaskById,
  getTaskRunLogs,
  setRegisteredGroup,
  updateTask,
} from '../db.js';
import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';
import { computeNextRun, nudgeScheduler } from '../task-scheduler.js';
import { registerChannel, ChannelOpts } from './registry.js';
import {
  Channel,
  OnChatMetadata,
  OnInboundMessage,
  RegisteredGroup,
} from '../types.js';

const DEFAULT_PORT = 3456;
const JID_PREFIX = 'web:';
const DEFAULT_JID = 'web:localhost';

interface WebChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
}

interface SSEClient {
  id: string;
  res: http.ServerResponse;
}

export class WebChannel implements Channel {
  name = 'web';

  private server: http.Server | null = null;
  private port: number;
  private opts: WebChannelOpts;
  private clients: SSEClient[] = [];
  private getChannels: () => Channel[] = () => [];

  constructor(port: number, opts: WebChannelOpts) {
    this.port = port;
    this.opts = opts;
  }

  /** Set after construction by index.ts so the sidebar can list channel status. */
  setChannelsAccessor(fn: () => Channel[]): void {
    this.getChannels = fn;
  }

  async connect(): Promise<void> {
    this.server = http.createServer((req, res) => this.handleRequest(req, res));

    return new Promise<void>((resolve, reject) => {
      this.server!.listen(this.port, WEB_HOST, () => {
        logger.info(
          { port: this.port, host: WEB_HOST },
          'Web channel listening',
        );
        if (WEB_HOST !== '127.0.0.1' && !API_TOKEN) {
          logger.warn(
            'Web channel is listening on a non-loopback address without API_TOKEN set. Set API_TOKEN in .env for security.',
          );
        }
        console.log(
          `\n  Web UI: http://${WEB_HOST === '0.0.0.0' ? 'localhost' : WEB_HOST}:${this.port}\n`,
        );
        resolve();
      });
      this.server!.on('error', reject);
    });
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    const event = JSON.stringify({
      type: 'message',
      chatJid: jid,
      text,
      timestamp: new Date().toISOString(),
    });
    this.broadcast(`data: ${event}\n\n`);
    logger.info({ jid, length: text.length }, 'Web message sent');
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    const event = JSON.stringify({ type: 'typing', isTyping });
    this.broadcast(`data: ${event}\n\n`);
  }

  /**
   * Broadcast an outbound message from any channel to SSE clients.
   * Called by index.ts so the dashboard can see responses from all channels.
   */
  broadcastOutbound(chatJid: string, text: string): void {
    const event = JSON.stringify({
      type: 'message',
      chatJid,
      text,
      timestamp: new Date().toISOString(),
    });
    this.broadcast(`data: ${event}\n\n`);
  }

  isConnected(): boolean {
    return this.server !== null && this.server.listening;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith(JID_PREFIX);
  }

  async disconnect(): Promise<void> {
    for (const client of this.clients) {
      client.res.end();
    }
    this.clients = [];
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
      this.server = null;
      logger.info('Web channel stopped');
    }
  }

  private broadcast(data: string): void {
    this.clients = this.clients.filter((c) => !c.res.writableEnded);
    for (const client of this.clients) {
      client.res.write(data);
    }
  }

  private checkAuth(req: http.IncomingMessage, url: URL): boolean {
    if (!API_TOKEN) return true;

    const authHeader = req.headers.authorization;
    if (authHeader) {
      const [scheme, token] = authHeader.split(' ');
      if (scheme === 'Bearer' && token === API_TOKEN) return true;
    }

    const queryToken = url.searchParams.get('token');
    if (queryToken === API_TOKEN) return true;

    return false;
  }

  private handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET, POST, PATCH, DELETE, OPTIONS',
    );
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization',
    );

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname.startsWith('/api/') && !this.checkAuth(req, url)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    // Route matching
    const taskLogMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/logs$/);
    const taskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
    const groupMsgMatch = url.pathname.match(
      /^\/api\/groups\/([^/]+)\/messages$/,
    );
    const groupMatch = url.pathname.match(/^\/api\/groups\/([^/]+)$/);
    const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);

    if (url.pathname === '/' && req.method === 'GET') {
      this.serveUI(res);
    } else if (url.pathname === '/api/events' && req.method === 'GET') {
      this.handleSSE(res);
    } else if (url.pathname === '/api/message' && req.method === 'POST') {
      this.handleMessage(req, res);
    } else if (url.pathname === '/api/status' && req.method === 'GET') {
      this.handleStatus(res);
    } else if (url.pathname === '/api/groups' && req.method === 'GET') {
      this.handleGetGroups(res);
    } else if (groupMsgMatch && req.method === 'GET') {
      this.handleGetGroupMessages(
        decodeURIComponent(groupMsgMatch[1]),
        url,
        res,
      );
    } else if (groupMatch && req.method === 'GET') {
      this.handleGetGroup(decodeURIComponent(groupMatch[1]), res);
    } else if (groupMatch && req.method === 'PATCH') {
      this.handleUpdateGroup(decodeURIComponent(groupMatch[1]), req, res);
    } else if (groupMatch && req.method === 'DELETE') {
      this.handleDeleteGroup(decodeURIComponent(groupMatch[1]), res);
    } else if (url.pathname === '/api/tasks' && req.method === 'POST') {
      this.handleCreateTask(req, res);
    } else if (taskLogMatch && req.method === 'GET') {
      this.handleGetTaskLogs(taskLogMatch[1], url, res);
    } else if (taskMatch && req.method === 'GET') {
      this.handleGetTask(taskMatch[1], res);
    } else if (taskMatch && req.method === 'PATCH') {
      this.handleUpdateTask(taskMatch[1], req, res);
    } else if (taskMatch && req.method === 'DELETE') {
      this.handleDeleteTask(taskMatch[1], res);
    } else if (url.pathname === '/api/sessions' && req.method === 'GET') {
      this.handleGetSessions(res);
    } else if (sessionMatch && req.method === 'DELETE') {
      this.handleDeleteSession(decodeURIComponent(sessionMatch[1]), res);
    } else if (url.pathname === '/api/chats' && req.method === 'GET') {
      this.handleGetChats(res);
    } else if (url.pathname === '/api/groups' && req.method === 'POST') {
      this.handleRegisterGroup(req, res);
    } else if (url.pathname === '/api/logs' && req.method === 'GET') {
      this.handleGetLogs(url, res);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  }

  private handleSSE(res: http.ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');

    const client: SSEClient = { id: randomUUID(), res };
    this.clients.push(client);

    res.on('close', () => {
      this.clients = this.clients.filter((c) => c.id !== client.id);
    });
  }

  private handleMessage(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        const text = parsed.text;
        if (!text || typeof text !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing text field' }));
          return;
        }

        const chatJid =
          typeof parsed.chat_jid === 'string' && parsed.chat_jid
            ? parsed.chat_jid
            : DEFAULT_JID;
        const timestamp = new Date().toISOString();

        // Only set web metadata for web JIDs — don't overwrite other channels
        if (chatJid.startsWith(JID_PREFIX)) {
          this.opts.onChatMetadata(
            chatJid,
            timestamp,
            'Web Chat',
            'web',
            false,
          );
        }

        const group = this.opts.registeredGroups()[chatJid];
        if (!group) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: `Chat not registered. Register this group with JID "${chatJid}" first.`,
            }),
          );
          return;
        }

        this.opts.onMessage(chatJid, {
          id: randomUUID(),
          chat_jid: chatJid,
          sender: 'web-user',
          sender_name: 'You',
          content: text,
          timestamp,
          is_from_me: false,
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  }

  private handleGetTask(id: string, res: http.ServerResponse): void {
    const task = getTaskById(id);
    if (!task) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Task not found' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(task));
  }

  private handleUpdateTask(
    id: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    let body = '';
    req.on('data', (chunk: string) => (body += chunk));
    req.on('end', () => {
      try {
        const task = getTaskById(id);
        if (!task) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Task not found' }));
          return;
        }

        const data = JSON.parse(body);
        const allowed = [
          'prompt',
          'schedule_type',
          'schedule_value',
          'status',
        ] as const;
        const updates: Record<string, unknown> = {};
        for (const key of allowed) {
          if (data[key] !== undefined) updates[key] = data[key];
        }

        if (Object.keys(updates).length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No valid fields to update' }));
          return;
        }

        updateTask(id, updates);
        nudgeScheduler();
        const updated = getTaskById(id);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(updated));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  }

  private handleDeleteTask(id: string, res: http.ServerResponse): void {
    const task = getTaskById(id);
    if (!task) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Task not found' }));
      return;
    }
    deleteTask(id);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  }

  // ---- Group endpoints ----

  private handleGetGroups(res: http.ServerResponse): void {
    const groups = getAllRegisteredGroups();
    const result = Object.entries(groups).map(([jid, g]) => ({
      jid,
      name: g.name,
      folder: g.folder,
      trigger: g.trigger,
      isMain: g.isMain || false,
      requiresTrigger: g.requiresTrigger !== false,
      containerConfig: g.containerConfig || null,
      added_at: g.added_at,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  }

  private handleGetGroup(jid: string, res: http.ServerResponse): void {
    const group = getRegisteredGroup(jid);
    if (!group) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Group not found' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        jid: group.jid,
        name: group.name,
        folder: group.folder,
        trigger: group.trigger,
        isMain: group.isMain || false,
        requiresTrigger: group.requiresTrigger !== false,
        containerConfig: group.containerConfig || null,
        added_at: group.added_at,
      }),
    );
  }

  private handleUpdateGroup(
    jid: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    let body = '';
    req.on('data', (chunk: string) => (body += chunk));
    req.on('end', () => {
      try {
        const group = getRegisteredGroup(jid);
        if (!group) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Group not found' }));
          return;
        }

        const data = JSON.parse(body);
        const updated: typeof group = { ...group };
        if (typeof data.name === 'string') updated.name = data.name;
        if (typeof data.trigger === 'string') updated.trigger = data.trigger;
        if (typeof data.requiresTrigger === 'boolean')
          updated.requiresTrigger = data.requiresTrigger;
        if (data.containerConfig !== undefined) {
          const cfg = updated.containerConfig || {};
          if (typeof data.containerConfig?.timeout === 'number')
            cfg.timeout = data.containerConfig.timeout;
          updated.containerConfig = cfg;
        }

        setRegisteredGroup(jid, updated);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  }

  private handleDeleteGroup(jid: string, res: http.ServerResponse): void {
    const group = getRegisteredGroup(jid);
    if (!group) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Group not found' }));
      return;
    }
    if (group.isMain) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Cannot delete the main group' }));
      return;
    }
    deleteRegisteredGroup(jid);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  }

  private handleGetGroupMessages(
    jid: string,
    url: URL,
    res: http.ServerResponse,
  ): void {
    const since = url.searchParams.get('since') || '';
    const limit = Math.min(
      parseInt(url.searchParams.get('limit') || '100', 10) || 100,
      500,
    );
    const messages = getMessageHistory(jid, limit, since || undefined);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(messages));
  }

  // ---- Task create & logs ----

  private handleCreateTask(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    let body = '';
    req.on('data', (chunk: string) => (body += chunk));
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (!data.prompt || !data.schedule_type || !data.schedule_value) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: 'Required: prompt, schedule_type, schedule_value',
            }),
          );
          return;
        }
        if (!data.group_folder || !data.chat_jid) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({ error: 'Required: group_folder, chat_jid' }),
          );
          return;
        }

        const task = {
          id: randomUUID(),
          group_folder: data.group_folder,
          chat_jid: data.chat_jid,
          prompt: data.prompt,
          script: data.script || null,
          schedule_type: data.schedule_type as 'cron' | 'interval' | 'once',
          schedule_value: data.schedule_value,
          context_mode:
            (data.context_mode as 'group' | 'isolated') || 'isolated',
          next_run: null as string | null,
          status: 'active' as const,
          created_at: new Date().toISOString(),
        };

        // Compute initial next_run
        task.next_run = computeNextRun(
          task as import('../types.js').ScheduledTask,
        );

        createTask(task);
        nudgeScheduler();
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(task));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  }

  private handleGetTaskLogs(
    id: string,
    url: URL,
    res: http.ServerResponse,
  ): void {
    const limit = Math.min(
      parseInt(url.searchParams.get('limit') || '50', 10) || 50,
      200,
    );
    const logs = getTaskRunLogs(id, limit);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(logs));
  }

  // ---- Session endpoints ----

  private handleGetSessions(res: http.ServerResponse): void {
    const sessions = getAllSessions();
    const result = Object.entries(sessions).map(([folder, sessionId]) => ({
      folder,
      sessionId,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  }

  private handleDeleteSession(folder: string, res: http.ServerResponse): void {
    deleteSession(folder);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  }

  // ---- Chats endpoint ----

  private handleGetChats(res: http.ServerResponse): void {
    const chats = getAllChats();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(chats));
  }

  // ---- Group registration ----

  private handleRegisterGroup(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    let body = '';
    req.on('data', (chunk: string) => (body += chunk));
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (!data.jid || !data.name || !data.folder) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({ error: 'Required: jid, name, folder' }),
          );
          return;
        }
        const group = {
          name: data.name,
          folder: data.folder,
          trigger: data.trigger || `@${ASSISTANT_NAME}`,
          added_at: new Date().toISOString(),
          requiresTrigger:
            data.requiresTrigger !== undefined ? data.requiresTrigger : true,
          isMain: false,
          containerConfig: data.containerConfig || undefined,
        };
        setRegisteredGroup(data.jid, group);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, jid: data.jid }));
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'Invalid request';
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: msg }));
      }
    });
  }

  // ---- Logs ----

  private handleGetLogs(url: URL, res: http.ServerResponse): void {
    const lines = parseInt(url.searchParams.get('lines') || '100', 10) || 100;
    const type = url.searchParams.get('type') === 'error' ? 'error' : 'all';

    const logDir = path.resolve(process.cwd(), 'logs');
    const logFile =
      type === 'error'
        ? path.join(logDir, 'nanoclaw.error.log')
        : path.join(logDir, 'nanoclaw.log');

    try {
      if (!fs.existsSync(logFile)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ lines: [] }));
        return;
      }
      const content = fs.readFileSync(logFile, 'utf-8');
      const allLines = content.split('\n').filter((l) => l.trim());
      const result = allLines.slice(-Math.min(lines, 500));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ lines: result }));
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to read logs' }));
    }
  }

  private handleStatus(res: http.ServerResponse): void {
    const groups = getAllRegisteredGroups();

    const channels = this.getChannels().map((ch) => {
      // Find groups owned by this channel
      const channelGroups = Object.entries(groups)
        .filter(([jid]) => ch.ownsJid(jid))
        .map(([jid, g]) => ({
          jid,
          name: g.name,
          folder: g.folder,
          isMain: g.isMain || false,
          trigger: g.trigger,
          requiresTrigger: g.requiresTrigger !== false,
        }));
      return {
        name: ch.name,
        connected: ch.isConnected(),
        groups: channelGroups,
      };
    });

    const groupList = Object.entries(groups).map(([jid, g]) => ({
      jid,
      name: g.name,
      folder: g.folder,
      isMain: g.isMain || false,
      trigger: g.trigger,
      requiresTrigger: g.requiresTrigger !== false,
    }));

    const tasks = getAllTasks();
    const taskList = tasks.map((t) => ({
      id: t.id,
      prompt: t.prompt,
      group: t.group_folder,
      chatJid: t.chat_jid,
      type: t.schedule_type,
      value: t.schedule_value,
      contextMode: t.context_mode,
      status: t.status,
      nextRun: t.next_run,
      lastRun: t.last_run,
      lastResult: t.last_result ? t.last_result.slice(0, 200) : null,
    }));

    const chats = getAllChats();
    const chatList = chats.slice(0, 20).map((c) => ({
      jid: c.jid,
      name: c.name,
      channel: c.channel,
      isGroup: c.is_group === 1,
      lastActivity: c.last_message_time,
    }));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        assistant: ASSISTANT_NAME,
        channels,
        groups: groupList,
        tasks: taskList,
        chats: chatList,
      }),
    );
  }

  private serveUI(res: http.ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(buildHTML());
  }
}

// ---------- Inline HTML ----------
// NOTE: Standalone version lives in web-app/. For significant UI changes, update web-app/ first.

function buildHTML(): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${ASSISTANT_NAME} — NanoClaw</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #0a0a0a;
    --surface: #141414;
    --surface2: #1a1a1a;
    --border: #2a2a2a;
    --border-light: #333;
    --text: #e4e4e4;
    --text-dim: #888;
    --text-muted: #555;
    --accent: #3b82f6;
    --accent-hover: #2563eb;
    --green: #22c55e;
    --yellow: #eab308;
    --red: #ef4444;
    --user-bg: #1e3a5f;
    --bot-bg: #1a1a1a;
    --radius: 12px;
    --radius-sm: 6px;
    --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    --mono: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    --sidebar-w: 280px;
  }

  :root.light {
    --bg: #f5f5f5;
    --surface: #ffffff;
    --surface2: #f0f0f0;
    --border: #e0e0e0;
    --border-light: #d5d5d5;
    --text: #1a1a1a;
    --text-dim: #666;
    --text-muted: #999;
    --accent: #2563eb;
    --accent-hover: #1d4ed8;
    --user-bg: #dbeafe;
    --bot-bg: #ffffff;
  }

  html, body { height: 100%; }

  body {
    font-family: var(--font);
    background: var(--bg);
    color: var(--text);
    display: flex;
  }

  /* ---- Sidebar ---- */
  #sidebar {
    width: var(--sidebar-w);
    min-width: var(--sidebar-w);
    background: var(--surface);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    flex-shrink: 0;
  }

  .sidebar-header {
    padding: 16px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .sidebar-header h1 {
    font-size: 16px;
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  .sidebar-header .spacer { flex: 1; }

  .sidebar-header .version {
    font-size: 11px;
    color: var(--text-muted);
  }

  .theme-toggle {
    background: none;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    cursor: pointer;
    padding: 4px 6px;
    font-size: 14px;
    line-height: 1;
    transition: background 0.15s, color 0.15s;
  }
  .theme-toggle:hover { background: var(--surface2); color: var(--text); }

  .section {
    padding: 12px 16px 8px;
  }

  .section-title {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    margin-bottom: 8px;
  }

  .item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: var(--radius-sm);
    font-size: 13px;
    color: var(--text-dim);
    transition: background 0.1s;
    cursor: pointer;
  }
  .item:hover { background: var(--surface2); }
  .item.selected { background: var(--surface2); color: var(--text); }

  .item .dot {
    width: 6px; height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .dot.green { background: var(--green); }
  .dot.yellow { background: var(--yellow); }
  .dot.red { background: var(--red); }
  .dot.dim { background: var(--text-muted); }

  .item .label { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .item .badge {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 10px;
    background: var(--surface2);
    border: 1px solid var(--border);
    color: var(--text-muted);
    white-space: nowrap;
  }
  .item .badge.main { color: var(--accent); border-color: rgba(59,130,246,0.3); background: rgba(59,130,246,0.08); }
  .item .badge.active { color: var(--green); border-color: rgba(34,197,94,0.3); background: rgba(34,197,94,0.08); }
  .item .badge.paused { color: var(--yellow); border-color: rgba(234,179,8,0.3); background: rgba(234,179,8,0.08); }

  .task-meta {
    font-size: 11px;
    color: var(--text-muted);
    padding-left: 22px;
    margin-top: -2px;
    margin-bottom: 4px;
  }

  .empty-hint {
    font-size: 12px;
    color: var(--text-muted);
    padding: 4px 8px;
    font-style: italic;
  }

  .divider {
    height: 1px;
    background: var(--border);
    margin: 4px 16px;
  }

  /* ---- Main chat area ---- */
  #main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  #chat-view {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  header {
    padding: 12px 20px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 10px;
    background: var(--surface);
    flex-shrink: 0;
  }

  header .dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: var(--red);
    transition: background 0.3s;
  }
  header .dot.connected { background: var(--green); }

  header h2 {
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  header .status {
    font-size: 12px;
    color: var(--text-dim);
    margin-left: auto;
  }

  #messages {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .msg {
    max-width: 720px;
    padding: 10px 14px;
    border-radius: var(--radius);
    font-size: 14px;
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .msg.user {
    align-self: flex-end;
    background: var(--user-bg);
    border-bottom-right-radius: 4px;
  }

  .msg.bot {
    align-self: flex-start;
    background: var(--bot-bg);
    border: 1px solid var(--border);
    border-bottom-left-radius: 4px;
  }

  .msg.bot code {
    font-family: var(--mono);
    font-size: 13px;
    background: #222;
    padding: 1px 5px;
    border-radius: 4px;
  }

  .msg.bot pre {
    background: #111;
    padding: 10px 12px;
    border-radius: 8px;
    overflow-x: auto;
    margin: 6px 0;
    font-size: 13px;
    font-family: var(--mono);
  }
  .msg.bot pre code {
    background: none;
    padding: 0;
  }

  .typing {
    align-self: flex-start;
    padding: 10px 14px;
    font-size: 13px;
    color: var(--text-dim);
    display: none;
  }
  .typing.visible { display: block; }

  .typing span {
    animation: blink 1.4s infinite both;
  }
  .typing span:nth-child(2) { animation-delay: 0.2s; }
  .typing span:nth-child(3) { animation-delay: 0.4s; }

  @keyframes blink {
    0%, 80%, 100% { opacity: 0.3; }
    40% { opacity: 1; }
  }

  .empty-state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-dim);
    font-size: 14px;
    text-align: center;
    padding: 40px;
    line-height: 1.6;
  }

  #input-area {
    padding: 12px 20px;
    border-top: 1px solid var(--border);
    background: var(--surface);
    flex-shrink: 0;
  }

  #input-area form {
    display: flex;
    gap: 8px;
    max-width: 800px;
    margin: 0 auto;
  }

  #input-area textarea {
    flex: 1;
    padding: 10px 14px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    font-family: var(--font);
    font-size: 14px;
    resize: none;
    outline: none;
    min-height: 42px;
    max-height: 200px;
    line-height: 1.4;
  }
  #input-area textarea:focus {
    border-color: var(--accent);
  }

  #input-area button {
    padding: 0 18px;
    border-radius: var(--radius);
    border: none;
    background: var(--accent);
    color: #fff;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
    white-space: nowrap;
  }
  #input-area button:hover { background: var(--accent-hover); }
  #input-area button:disabled { opacity: 0.4; cursor: default; }

  /* ---- Detail panel (overlays main area) ---- */
  #detail-panel {
    display: none;
    flex-direction: column;
    height: 100%;
  }
  #detail-panel.visible { display: flex; }
  #chat-view.hidden { display: none; }

  .detail-header {
    padding: 12px 20px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 10px;
    background: var(--surface);
    flex-shrink: 0;
  }

  .detail-header .back-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    cursor: pointer;
    padding: 4px 10px;
    font-size: 13px;
    transition: background 0.15s, color 0.15s;
  }
  .detail-header .back-btn:hover { background: var(--surface2); color: var(--text); }

  .detail-header h2 {
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .detail-body {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
  }

  .detail-section {
    margin-bottom: 20px;
  }

  .detail-section h3 {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    margin-bottom: 8px;
  }

  .detail-field {
    margin-bottom: 14px;
  }

  .detail-field label {
    display: block;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-dim);
    margin-bottom: 4px;
  }

  .detail-field input,
  .detail-field select,
  .detail-field textarea {
    width: 100%;
    max-width: 500px;
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    font-family: var(--font);
    font-size: 13px;
    outline: none;
  }
  .detail-field input:focus,
  .detail-field select:focus,
  .detail-field textarea:focus {
    border-color: var(--accent);
  }

  .detail-field textarea {
    min-height: 80px;
    resize: vertical;
    font-family: var(--mono);
    line-height: 1.5;
  }

  .detail-field .value {
    font-size: 13px;
    color: var(--text);
    padding: 6px 0;
  }

  .detail-field .value.mono {
    font-family: var(--mono);
    font-size: 12px;
  }

  .detail-actions {
    display: flex;
    gap: 8px;
    margin-top: 20px;
    flex-wrap: wrap;
  }

  .btn {
    padding: 7px 16px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--surface2);
    color: var(--text);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
  }
  .btn:hover { background: var(--border); }
  .btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .btn.primary:hover { background: var(--accent-hover); }
  .btn.danger { color: var(--red); border-color: rgba(239,68,68,0.3); }
  .btn.danger:hover { background: rgba(239,68,68,0.1); }

  .info-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    background: var(--surface2);
    margin-bottom: 6px;
    font-size: 13px;
  }

  .info-row .dot {
    width: 6px; height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .info-row .label { flex: 1; }
  .info-row .meta {
    font-size: 11px;
    color: var(--text-muted);
  }

  .toast {
    position: fixed;
    bottom: 20px;
    right: 20px;
    padding: 10px 18px;
    border-radius: var(--radius);
    background: var(--green);
    color: #fff;
    font-size: 13px;
    font-weight: 500;
    opacity: 0;
    transform: translateY(10px);
    transition: opacity 0.2s, transform 0.2s;
    z-index: 100;
    pointer-events: none;
  }
  .toast.visible { opacity: 1; transform: translateY(0); }
  .toast.error { background: var(--red); }

  @media (max-width: 720px) {
    #sidebar { display: none; }
  }
</style>
</head>
<body>

<!-- Sidebar -->
<div id="sidebar">
  <div class="sidebar-header">
    <h1>${ASSISTANT_NAME}</h1>
    <div class="spacer"></div>
    <span class="version">NanoClaw</span>
    <button class="theme-toggle" id="theme-toggle" title="Toggle light/dark theme">&#9788;</button>
  </div>

  <div class="section" id="sec-channels">
    <div class="section-title">Channels</div>
    <div id="channel-list"><div class="empty-hint">Loading...</div></div>
  </div>

  <div class="divider"></div>

  <div class="section" id="sec-groups">
    <div class="section-title">Groups</div>
    <div id="group-list"><div class="empty-hint">Loading...</div></div>
  </div>

  <div class="divider"></div>

  <div class="section" id="sec-tasks">
    <div class="section-title">Scheduled Tasks</div>
    <div id="task-list"><div class="empty-hint">Loading...</div></div>
  </div>

  <div class="divider"></div>

  <div class="section" id="sec-chats">
    <div class="section-title">Recent Chats</div>
    <div id="chat-list"><div class="empty-hint">Loading...</div></div>
  </div>
</div>

<!-- Main area -->
<div id="main">
  <!-- Chat view (default) -->
  <div id="chat-view">
    <header>
      <div class="dot" id="dot"></div>
      <h2>Web Chat</h2>
      <span class="status" id="status">connecting...</span>
    </header>

    <div id="messages">
      <div class="empty-state" id="empty">Send a message to start chatting.</div>
    </div>

    <div class="typing" id="typing">
      <span>.</span><span>.</span><span>.</span> thinking
    </div>

    <div id="input-area">
      <form id="form">
        <textarea id="input" rows="1" placeholder="Message ${ASSISTANT_NAME}..." autofocus></textarea>
        <button type="submit">Send</button>
      </form>
    </div>
  </div>

  <!-- Detail panel (shown when clicking sidebar items) -->
  <div id="detail-panel">
    <div class="detail-header">
      <button class="back-btn" id="detail-back">&larr; Back</button>
      <h2 id="detail-title"></h2>
    </div>
    <div class="detail-body" id="detail-body"></div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
(function() {
  const messages = document.getElementById('messages');
  const empty = document.getElementById('empty');
  const typing = document.getElementById('typing');
  const form = document.getElementById('form');
  const input = document.getElementById('input');
  const dot = document.getElementById('dot');
  const statusEl = document.getElementById('status');
  const chatView = document.getElementById('chat-view');
  const detailPanel = document.getElementById('detail-panel');
  const detailBack = document.getElementById('detail-back');
  const detailTitle = document.getElementById('detail-title');
  const detailBody = document.getElementById('detail-body');
  const toastEl = document.getElementById('toast');

  // Cached status data for panel rendering
  let statusData = { channels: [], groups: [], tasks: [], chats: [] };

  // ---- Toast ----

  let toastTimer = null;
  function toast(msg, isError) {
    toastEl.textContent = msg;
    toastEl.className = 'toast visible' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.className = 'toast'; }, 2500);
  }

  // ---- Panel management ----

  function showChat() {
    chatView.classList.remove('hidden');
    detailPanel.classList.remove('visible');
    document.querySelectorAll('#sidebar .item.selected').forEach(el => el.classList.remove('selected'));
  }

  function showDetail(title, html) {
    chatView.classList.add('hidden');
    detailPanel.classList.add('visible');
    detailTitle.textContent = title;
    detailBody.innerHTML = html;
  }

  detailBack.addEventListener('click', showChat);

  // ---- Chat ----

  function addMsg(text, cls) {
    empty.style.display = 'none';
    const div = document.createElement('div');
    div.className = 'msg ' + cls;
    if (cls === 'bot') {
      div.innerHTML = renderMarkdown(text);
    } else {
      div.textContent = text;
    }
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }

  function renderMarkdown(text) {
    text = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    text = text.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, '<pre><code>$1</code></pre>');
    text = text.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
    text = text.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
    text = text.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
    return text;
  }

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 200) + 'px';
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.dispatchEvent(new Event('submit'));
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    addMsg(text, 'user');
    input.value = '';
    input.style.height = 'auto';
    // Switch to chat view if detail panel is open
    showChat();
    try {
      const res = await fetch('/api/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        addMsg('Error: ' + (err.error || res.statusText), 'bot');
      }
    } catch (err) {
      addMsg('Error: could not reach server', 'bot');
    }
  });

  // ---- SSE ----

  function connectSSE() {
    const es = new EventSource('/api/events');
    es.onopen = () => {
      dot.classList.add('connected');
      statusEl.textContent = 'connected';
    };
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'message') {
          typing.classList.remove('visible');
          addMsg(data.text, 'bot');
          // Switch to chat if a message arrives while viewing detail
          if (detailPanel.classList.contains('visible')) showChat();
        } else if (data.type === 'typing') {
          if (data.isTyping) {
            typing.classList.add('visible');
            messages.scrollTop = messages.scrollHeight;
          } else {
            typing.classList.remove('visible');
          }
        }
      } catch {}
    };
    es.onerror = () => {
      dot.classList.remove('connected');
      statusEl.textContent = 'reconnecting...';
      es.close();
      setTimeout(connectSSE, 2000);
    };
  }
  connectSSE();

  // ---- Helpers ----

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  function relTime(iso) {
    if (!iso) return 'never';
    const d = new Date(iso);
    const now = Date.now();
    const diff = now - d.getTime();
    if (diff < 0) return 'in ' + humanDuration(-diff);
    if (diff < 60000) return 'just now';
    return humanDuration(diff) + ' ago';
  }

  function humanDuration(ms) {
    if (ms < 60000) return Math.floor(ms / 1000) + 's';
    if (ms < 3600000) return Math.floor(ms / 60000) + 'm';
    if (ms < 86400000) return Math.floor(ms / 3600000) + 'h';
    return Math.floor(ms / 86400000) + 'd';
  }

  // ---- Channel detail panel ----

  function showChannelDetail(ch) {
    const groupsHtml = (ch.groups || []).length
      ? ch.groups.map(g =>
          '<div class="info-row">' +
            '<div class="dot ' + (g.isMain ? 'green' : 'dim') + '"></div>' +
            '<span class="label">' + esc(g.name) + '</span>' +
            (g.isMain ? '<span class="meta">main</span>' : '') +
          '</div>' +
          '<div style="padding: 2px 0 8px 14px; font-size: 12px; color: var(--text-muted);">' +
            'Folder: <code>' + esc(g.folder) + '</code>' +
            (g.trigger ? ' &middot; Trigger: <code>' + esc(g.trigger) + '</code>' : '') +
            ' &middot; Requires trigger: ' + (g.requiresTrigger ? 'yes' : 'no') +
          '</div>'
        ).join('')
      : '<div class="empty-hint">No groups registered on this channel</div>';

    const html =
      '<div class="detail-section">' +
        '<h3>Status</h3>' +
        '<div class="info-row">' +
          '<div class="dot ' + (ch.connected ? 'green' : 'red') + '"></div>' +
          '<span class="label">' + (ch.connected ? 'Connected' : 'Disconnected') + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="detail-section">' +
        '<h3>Groups</h3>' +
        groupsHtml +
      '</div>';

    showDetail(ch.name.charAt(0).toUpperCase() + ch.name.slice(1) + ' Channel', html);
  }

  // ---- Task detail / edit panel ----

  function showTaskDetail(task) {
    const html =
      '<div class="detail-section">' +
        '<h3>Task Details</h3>' +
        '<div class="detail-field">' +
          '<label>Prompt</label>' +
          '<textarea id="edit-prompt">' + esc(task.prompt) + '</textarea>' +
        '</div>' +
        '<div class="detail-field">' +
          '<label>Schedule Type</label>' +
          '<select id="edit-type">' +
            '<option value="cron"' + (task.type === 'cron' ? ' selected' : '') + '>Cron</option>' +
            '<option value="interval"' + (task.type === 'interval' ? ' selected' : '') + '>Interval (ms)</option>' +
            '<option value="once"' + (task.type === 'once' ? ' selected' : '') + '>Once</option>' +
          '</select>' +
        '</div>' +
        '<div class="detail-field">' +
          '<label>Schedule Value</label>' +
          '<input id="edit-value" type="text" value="' + esc(task.value) + '">' +
        '</div>' +
        '<div class="detail-field">' +
          '<label>Status</label>' +
          '<select id="edit-status">' +
            '<option value="active"' + (task.status === 'active' ? ' selected' : '') + '>Active</option>' +
            '<option value="paused"' + (task.status === 'paused' ? ' selected' : '') + '>Paused</option>' +
          '</select>' +
        '</div>' +
      '</div>' +
      '<div class="detail-section">' +
        '<h3>Info</h3>' +
        '<div class="detail-field">' +
          '<label>ID</label>' +
          '<div class="value mono">' + esc(task.id) + '</div>' +
        '</div>' +
        '<div class="detail-field">' +
          '<label>Group</label>' +
          '<div class="value">' + esc(task.group) + '</div>' +
        '</div>' +
        '<div class="detail-field">' +
          '<label>Context Mode</label>' +
          '<div class="value">' + esc(task.contextMode || 'isolated') + '</div>' +
        '</div>' +
        (task.nextRun ? '<div class="detail-field"><label>Next Run</label><div class="value">' + esc(new Date(task.nextRun).toLocaleString()) + ' (' + relTime(task.nextRun) + ')</div></div>' : '') +
        (task.lastRun ? '<div class="detail-field"><label>Last Run</label><div class="value">' + relTime(task.lastRun) + '</div></div>' : '') +
        (task.lastResult ? '<div class="detail-field"><label>Last Result</label><div class="value mono" style="white-space:pre-wrap;max-height:120px;overflow:auto;">' + esc(task.lastResult) + '</div></div>' : '') +
      '</div>' +
      '<div class="detail-actions">' +
        '<button class="btn primary" id="save-task">Save Changes</button>' +
        '<button class="btn danger" id="delete-task">Delete Task</button>' +
      '</div>';

    showDetail('Edit Task', html);

    // Wire up save
    document.getElementById('save-task').addEventListener('click', async () => {
      const body = {
        prompt: document.getElementById('edit-prompt').value,
        schedule_type: document.getElementById('edit-type').value,
        schedule_value: document.getElementById('edit-value').value,
        status: document.getElementById('edit-status').value,
      };
      try {
        const res = await fetch('/api/tasks/' + encodeURIComponent(task.id), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          toast('Task updated');
          refreshSidebar();
        } else {
          const err = await res.json().catch(() => ({}));
          toast(err.error || 'Update failed', true);
        }
      } catch { toast('Network error', true); }
    });

    // Wire up delete
    document.getElementById('delete-task').addEventListener('click', async () => {
      if (!confirm('Delete this task? This cannot be undone.')) return;
      try {
        const res = await fetch('/api/tasks/' + encodeURIComponent(task.id), { method: 'DELETE' });
        if (res.ok) {
          toast('Task deleted');
          showChat();
          refreshSidebar();
        } else {
          toast('Delete failed', true);
        }
      } catch { toast('Network error', true); }
    });
  }

  // ---- Sidebar rendering ----

  function renderChannels(channels) {
    const el = document.getElementById('channel-list');
    if (!channels.length) { el.innerHTML = '<div class="empty-hint">None</div>'; return; }
    el.innerHTML = channels.map((ch, i) =>
      '<div class="item" data-channel="' + i + '">' +
        '<div class="dot ' + (ch.connected ? 'green' : 'red') + '"></div>' +
        '<span class="label">' + esc(ch.name) + '</span>' +
        '<span class="badge">' + (ch.connected ? 'online' : 'offline') + '</span>' +
      '</div>'
    ).join('');
    el.querySelectorAll('.item[data-channel]').forEach(item => {
      item.addEventListener('click', () => {
        document.querySelectorAll('#sidebar .item.selected').forEach(el => el.classList.remove('selected'));
        item.classList.add('selected');
        const ch = channels[parseInt(item.dataset.channel)];
        showChannelDetail(ch);
      });
    });
  }

  function renderGroups(groups) {
    const el = document.getElementById('group-list');
    if (!groups.length) { el.innerHTML = '<div class="empty-hint">None registered</div>'; return; }
    el.innerHTML = groups.map(g =>
      '<div class="item">' +
        '<div class="dot ' + (g.isMain ? 'green' : 'dim') + '"></div>' +
        '<span class="label">' + esc(g.name) + '</span>' +
        (g.isMain ? '<span class="badge main">main</span>' : '') +
      '</div>'
    ).join('');
  }

  function renderTasks(tasks) {
    const el = document.getElementById('task-list');
    if (!tasks.length) { el.innerHTML = '<div class="empty-hint">No scheduled tasks</div>'; return; }
    el.innerHTML = tasks.map((t, i) =>
      '<div class="item" data-task="' + i + '">' +
        '<div class="dot ' + (t.status === 'active' ? 'green' : t.status === 'paused' ? 'yellow' : 'dim') + '"></div>' +
        '<span class="label">' + esc(t.prompt.length > 60 ? t.prompt.slice(0, 60) + '...' : t.prompt) + '</span>' +
        '<span class="badge ' + t.status + '">' + t.status + '</span>' +
      '</div>' +
      '<div class="task-meta">' + t.type + ': ' + esc(t.value) +
        (t.nextRun ? ' &middot; next ' + relTime(t.nextRun) : '') +
      '</div>'
    ).join('');
    el.querySelectorAll('.item[data-task]').forEach(item => {
      item.addEventListener('click', () => {
        document.querySelectorAll('#sidebar .item.selected').forEach(el => el.classList.remove('selected'));
        item.classList.add('selected');
        const t = tasks[parseInt(item.dataset.task)];
        showTaskDetail(t);
      });
    });
  }

  function renderChats(chats) {
    const el = document.getElementById('chat-list');
    if (!chats.length) { el.innerHTML = '<div class="empty-hint">No chats yet</div>'; return; }
    el.innerHTML = chats.slice(0, 10).map(c =>
      '<div class="item">' +
        '<div class="dot dim"></div>' +
        '<span class="label">' + esc(c.name || c.jid) + '</span>' +
        '<span class="badge">' + (c.channel || '?') + '</span>' +
      '</div>'
    ).join('');
  }

  async function refreshSidebar() {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) return;
      statusData = await res.json();
      renderChannels(statusData.channels || []);
      renderGroups(statusData.groups || []);
      renderTasks(statusData.tasks || []);
      renderChats(statusData.chats || []);
    } catch {}
  }

  refreshSidebar();
  setInterval(refreshSidebar, 10000);

  // ---- Theme toggle ----
  const themeBtn = document.getElementById('theme-toggle');
  const root = document.documentElement;
  const saved = localStorage.getItem('nanoclaw-theme');
  if (saved === 'light') root.classList.add('light');

  themeBtn.addEventListener('click', () => {
    root.classList.toggle('light');
    const isLight = root.classList.contains('light');
    localStorage.setItem('nanoclaw-theme', isLight ? 'light' : 'dark');
    themeBtn.innerHTML = isLight ? '&#9790;' : '&#9788;';
  });
  if (saved === 'light') themeBtn.innerHTML = '&#9790;';
})();
</script>
</body>
</html>`;
}

registerChannel('web', (opts: ChannelOpts) => {
  const envVars = readEnvFile(['WEB_PORT']);
  const portStr = process.env.WEB_PORT || envVars.WEB_PORT || '';
  if (!portStr) {
    logger.debug('Web: WEB_PORT not set, skipping');
    return null;
  }
  const port = parseInt(portStr, 10) || DEFAULT_PORT;
  return new WebChannel(port, opts);
});
