import fs from 'fs';
import http from 'http';
import path from 'path';
import { randomUUID } from 'crypto';

import { API_TOKEN, ASSISTANT_NAME, WEB_HOST } from '../config.js';
import {
  createCredential,
  createPersonality,
  createTask,
  createWebChat,
  decryptPassword,
  deleteChatAndMessages,
  deleteChatSession,
  deleteCredential,
  deletePersonality,
  deleteRegisteredGroup,
  deleteSession,
  deleteTask,
  encryptPassword,
  getAllChats,
  getAllCredentials,
  getAllPersonalities,
  getAllRegisteredGroups,
  getAllSessions,
  getAllTasks,
  getCredentialById,
  getGroupFoldersByPersonality,
  getMessageHistory,
  getPersonalityById,
  getRegisteredGroup,
  getTaskById,
  getTaskRunLogs,
  getWebChats,
  renameChat,
  setRegisteredGroup,
  updateCredential,
  updatePersonality,
  updateTask,
} from '../db.js';
import { readEnvFile } from '../env.js';
import { resolveGroupFolderPath } from '../group-folder.js';
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
    const event = JSON.stringify({ type: 'typing', chatJid: jid, isTyping });
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
    const taskRunMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/run$/);
    const taskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
    const groupMsgMatch = url.pathname.match(
      /^\/api\/groups\/([^/]+)\/messages$/,
    );
    const groupMatch = url.pathname.match(/^\/api\/groups\/([^/]+)$/);
    const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
    const chatMatch = url.pathname.match(/^\/api\/chats\/([^/]+)$/);
    const chatMsgMatch = url.pathname.match(
      /^\/api\/chats\/([^/]+)\/messages$/,
    );
    const personalityMatch = url.pathname.match(
      /^\/api\/personalities\/([^/]+)$/,
    );
    const credentialMatch = url.pathname.match(/^\/api\/credentials\/([^/]+)$/);

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
    } else if (taskRunMatch && req.method === 'POST') {
      this.handleRunTaskNow(taskRunMatch[1], res);
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
      if (url.searchParams.get('channel') === 'web') {
        this.handleGetWebChats(res);
      } else {
        this.handleGetChats(res);
      }
    } else if (url.pathname === '/api/chats' && req.method === 'POST') {
      this.handleCreateWebChat(req, res);
    } else if (chatMsgMatch && req.method === 'GET') {
      this.handleGetChatMessages(decodeURIComponent(chatMsgMatch[1]), url, res);
    } else if (chatMatch && req.method === 'PATCH') {
      this.handleRenameWebChat(decodeURIComponent(chatMatch[1]), req, res);
    } else if (chatMatch && req.method === 'DELETE') {
      this.handleDeleteWebChat(decodeURIComponent(chatMatch[1]), res);
    } else if (url.pathname === '/api/groups' && req.method === 'POST') {
      this.handleRegisterGroup(req, res);
    } else if (url.pathname === '/api/upload' && req.method === 'POST') {
      this.handleUpload(req, res, url);
    } else if (url.pathname.startsWith('/api/files/') && req.method === 'GET') {
      this.handleServeFile(url, res);
    } else if (url.pathname === '/api/logs' && req.method === 'GET') {
      this.handleGetLogs(url, res);
    } else if (url.pathname === '/api/personalities' && req.method === 'GET') {
      this.handleGetPersonalities(res);
    } else if (url.pathname === '/api/personalities' && req.method === 'POST') {
      this.handleCreatePersonality(req, res);
    } else if (personalityMatch && req.method === 'PATCH') {
      this.handleUpdatePersonality(personalityMatch[1], req, res);
    } else if (personalityMatch && req.method === 'DELETE') {
      this.handleDeletePersonality(personalityMatch[1], res);
    } else if (url.pathname === '/api/credentials' && req.method === 'GET') {
      this.handleGetCredentials(res);
    } else if (url.pathname === '/api/credentials' && req.method === 'POST') {
      this.handleCreateCredential(req, res);
    } else if (credentialMatch && req.method === 'PATCH') {
      this.handleUpdateCredential(credentialMatch[1], req, res);
    } else if (credentialMatch && req.method === 'DELETE') {
      this.handleDeleteCredential(credentialMatch[1], res);
    } else if (
      url.pathname === '/api/internal/credentials' &&
      req.method === 'GET'
    ) {
      this.handleInternalGetCredentials(url, res);
    } else if (
      url.pathname === '/api/internal/personalities' &&
      req.method === 'GET'
    ) {
      this.handleInternalGetPersonalities(res);
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
        const isWebJid = chatJid.startsWith(JID_PREFIX);

        // Only set web metadata for web JIDs — don't overwrite other channels
        if (isWebJid) {
          this.opts.onChatMetadata(
            chatJid,
            timestamp,
            'Web Chat',
            'web',
            false,
          );
        }

        // Web chats are lightweight: they don't require a dedicated registered
        // group — they piggyback on any registered web:* group's container.
        // Non-web jids still require explicit registration.
        const registered = this.opts.registeredGroups();
        if (!isWebJid && !registered[chatJid]) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: `Chat not registered. Register this group with JID "${chatJid}" first.`,
            }),
          );
          return;
        }
        if (isWebJid) {
          const hasAnyWebGroup = Object.keys(registered).some((j) =>
            j.startsWith(JID_PREFIX),
          );
          if (!hasAnyWebGroup) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                error:
                  'No web host group registered. Register a web:* group first.',
              }),
            );
            return;
          }
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
      personalityId: g.personalityId || null,
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
        personalityId: group.personalityId || null,
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
        if (data.personalityId !== undefined) {
          const oldPid = group.personalityId;
          updated.personalityId =
            data.personalityId === null ? undefined : data.personalityId;
          // Clear session when personality changes so agent starts fresh
          if (updated.personalityId !== oldPid) {
            deleteSession(updated.folder);
          }
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

  private handleRunTaskNow(id: string, res: http.ServerResponse): void {
    const task = getTaskById(id);
    if (!task) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Task not found' }));
      return;
    }
    if (task.status === 'paused') {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'Task is paused — resume it first to run',
        }),
      );
      return;
    }
    updateTask(id, { next_run: new Date().toISOString() });
    nudgeScheduler();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
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

  // ---- Chats endpoints ----

  private handleGetChats(res: http.ServerResponse): void {
    const chats = getAllChats();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(chats));
  }

  private handleGetWebChats(res: http.ServerResponse): void {
    const chats = getWebChats();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(chats));
  }

  private handleCreateWebChat(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    let body = '';
    req.on('data', (chunk: string) => (body += chunk));
    req.on('end', () => {
      try {
        const data = body ? JSON.parse(body) : {};
        const name =
          typeof data.name === 'string' && data.name.trim()
            ? data.name.trim()
            : 'New chat';
        const jid = `${JID_PREFIX}${randomUUID()}`;
        createWebChat(jid, name);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jid, name }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  }

  private handleRenameWebChat(
    jid: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    if (!jid.startsWith(JID_PREFIX)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not a web chat' }));
      return;
    }
    let body = '';
    req.on('data', (chunk: string) => (body += chunk));
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (typeof data.name !== 'string' || !data.name.trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'name required' }));
          return;
        }
        renameChat(jid, data.name.trim());
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  }

  private handleDeleteWebChat(jid: string, res: http.ServerResponse): void {
    if (!jid.startsWith(JID_PREFIX)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not a web chat' }));
      return;
    }
    deleteChatAndMessages(jid);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  }

  private handleGetChatMessages(
    jid: string,
    url: URL,
    res: http.ServerResponse,
  ): void {
    const limit = Math.min(
      parseInt(url.searchParams.get('limit') || '200', 10) || 200,
      1000,
    );
    const msgs = getMessageHistory(jid, limit);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(msgs));
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
          res.end(JSON.stringify({ error: 'Required: jid, name, folder' }));
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
        const msg = err instanceof Error ? err.message : 'Invalid request';
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: msg }));
      }
    });
  }

  // ---- Logs ----

  // ---- Image upload ----

  private handleUpload(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL,
  ): void {
    const chatJid = url.searchParams.get('chat_jid') || DEFAULT_JID;
    const registered = this.opts.registeredGroups();
    const isWebJid = chatJid.startsWith(JID_PREFIX);
    const group = isWebJid
      ? registered[chatJid] ||
        Object.entries(registered).find(([j]) => j.startsWith(JID_PREFIX))?.[1]
      : registered[chatJid];
    if (!group) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: 'No host group available for this chat' }),
      );
      return;
    }

    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=(.+)/);
    if (!boundaryMatch) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing multipart boundary' }));
      return;
    }

    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks);
        const boundary = boundaryMatch[1];
        const files = parseMultipart(body, boundary);

        if (files.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No files uploaded' }));
          return;
        }

        const groupDir = resolveGroupFolderPath(group.folder);
        const attachDir = path.join(groupDir, 'attachments');
        fs.mkdirSync(attachDir, { recursive: true });

        const saved: Array<{
          filename: string;
          path: string;
          containerPath: string;
        }> = [];
        for (const file of files) {
          // Sanitize filename
          const safeName = `upload_${Date.now()}_${file.filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
          const destPath = path.join(attachDir, safeName);
          fs.writeFileSync(destPath, file.data);
          saved.push({
            filename: safeName,
            path: destPath,
            containerPath: `/workspace/group/attachments/${safeName}`,
          });
        }

        // Store as a message with image reference
        const text = url.searchParams.get('text') || '';
        const imageRefs = saved
          .map((f) => `[Image] (${f.containerPath})`)
          .join('\n');
        const content = text ? `${text}\n${imageRefs}` : imageRefs;
        const timestamp = new Date().toISOString();

        if (chatJid.startsWith(JID_PREFIX)) {
          this.opts.onChatMetadata(
            chatJid,
            timestamp,
            'Web Chat',
            'web',
            false,
          );
        }

        this.opts.onMessage(chatJid, {
          id: randomUUID(),
          chat_jid: chatJid,
          sender: 'web-user',
          sender_name: 'You',
          content,
          timestamp,
          is_from_me: false,
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            files: saved.map((f) => ({
              filename: f.filename,
              containerPath: f.containerPath,
            })),
          }),
        );
      } catch (err) {
        logger.error({ err }, 'Upload error');
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Upload failed' }));
      }
    });
  }

  // ---- File serving (for uploaded/generated images) ----

  private handleServeFile(url: URL, res: http.ServerResponse): void {
    // URL: /api/files/{folder}/attachments/{filename}
    const parts = url.pathname.replace('/api/files/', '').split('/');
    if (parts.length < 2) {
      res.writeHead(400);
      res.end();
      return;
    }
    const folder = parts[0];
    const filePath = parts.slice(1).join('/');

    // Only allow serving from attachments/ and generated/ subdirs
    if (
      !filePath.startsWith('attachments/') &&
      !filePath.startsWith('generated/')
    ) {
      res.writeHead(403);
      res.end();
      return;
    }

    try {
      const groupDir = resolveGroupFolderPath(folder);
      const fullPath = path.join(groupDir, filePath);

      // Prevent path traversal
      if (!fullPath.startsWith(groupDir)) {
        res.writeHead(403);
        res.end();
        return;
      }

      if (!fs.existsSync(fullPath)) {
        res.writeHead(404);
        res.end();
        return;
      }

      const ext = path.extname(fullPath).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
      };
      const contentType = mimeTypes[ext] || 'application/octet-stream';

      const data = fs.readFileSync(fullPath);
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      });
      res.end(data);
    } catch {
      res.writeHead(500);
      res.end();
    }
  }

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

  // ---- Personality endpoints ----

  private handleGetPersonalities(res: http.ServerResponse): void {
    const personalities = getAllPersonalities();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(personalities));
  }

  private handleCreatePersonality(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    let body = '';
    req.on('data', (chunk: string) => (body += chunk));
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (!data.name || typeof data.name !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Required: name' }));
          return;
        }
        const now = new Date().toISOString();
        const personality = {
          id: randomUUID(),
          name: data.name,
          instructions: data.instructions || '',
          created_at: now,
          updated_at: now,
        };
        createPersonality(personality);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(personality));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  }

  private handleUpdatePersonality(
    id: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    let body = '';
    req.on('data', (chunk: string) => (body += chunk));
    req.on('end', () => {
      try {
        const existing = getPersonalityById(id);
        if (!existing) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Personality not found' }));
          return;
        }
        const data = JSON.parse(body);
        const updates: Record<string, string> = {};
        if (typeof data.name === 'string') updates.name = data.name;
        if (typeof data.instructions === 'string')
          updates.instructions = data.instructions;
        if (Object.keys(updates).length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No valid fields to update' }));
          return;
        }
        // If instructions changed, clear sessions for all groups using this personality
        // so the agent starts fresh with the new context
        const instructionsChanged =
          typeof data.instructions === 'string' &&
          data.instructions !== existing.instructions;

        updatePersonality(id, updates);

        if (instructionsChanged) {
          const folders = getGroupFoldersByPersonality(id);
          for (const folder of folders) {
            deleteSession(folder);
          }
        }

        const updated = getPersonalityById(id);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(updated));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  }

  private handleDeletePersonality(id: string, res: http.ServerResponse): void {
    const existing = getPersonalityById(id);
    if (!existing) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Personality not found' }));
      return;
    }
    deletePersonality(id);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  }

  // --- Credential handlers ---

  /**
   * Internal endpoint for containers to fetch decrypted credentials on demand.
   * Supports optional ?name= partial match filter. Always returns fresh data
   * from the database — no caching or snapshot files.
   */
  private handleInternalGetCredentials(
    url: URL,
    res: http.ServerResponse,
  ): void {
    const allCredentials = getAllCredentials();
    const nameFilter = url.searchParams.get('name');

    const filtered = nameFilter
      ? allCredentials.filter((c) =>
          c.name.toLowerCase().includes(nameFilter.toLowerCase()),
        )
      : allCredentials;

    const decrypted = filtered.map((c) => ({
      name: c.name,
      website: c.website,
      username: c.username,
      password: c.password_encrypted
        ? decryptPassword(c.password_encrypted)
        : '',
      notes: c.notes,
    }));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(decrypted));
  }

  private handleInternalGetPersonalities(res: http.ServerResponse): void {
    const personalities = getAllPersonalities().map((p) => ({
      id: p.id,
      name: p.name,
      instructions: p.instructions,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(personalities));
  }

  private handleGetCredentials(res: http.ServerResponse): void {
    const credentials = getAllCredentials().map((c) => ({
      id: c.id,
      name: c.name,
      website: c.website,
      username: c.username,
      has_password: !!c.password_encrypted,
      notes: c.notes,
      created_at: c.created_at,
      updated_at: c.updated_at,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(credentials));
  }

  private handleCreateCredential(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    let body = '';
    req.on('data', (chunk: string) => (body += chunk));
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (!data.name || typeof data.name !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Required: name' }));
          return;
        }
        const now = new Date().toISOString();
        const credential = {
          id: randomUUID(),
          name: data.name,
          website: data.website || '',
          username: data.username || '',
          password_encrypted: data.password
            ? encryptPassword(data.password)
            : '',
          notes: data.notes || '',
          created_at: now,
          updated_at: now,
        };
        createCredential(credential);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            id: credential.id,
            name: credential.name,
            website: credential.website,
            username: credential.username,
            has_password: !!credential.password_encrypted,
            notes: credential.notes,
            created_at: credential.created_at,
            updated_at: credential.updated_at,
          }),
        );
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  }

  private handleUpdateCredential(
    id: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    let body = '';
    req.on('data', (chunk: string) => (body += chunk));
    req.on('end', () => {
      try {
        const existing = getCredentialById(id);
        if (!existing) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Credential not found' }));
          return;
        }
        const data = JSON.parse(body);
        const updates: Record<string, string> = {};
        if (typeof data.name === 'string') updates.name = data.name;
        if (typeof data.website === 'string') updates.website = data.website;
        if (typeof data.username === 'string') updates.username = data.username;
        if (typeof data.password === 'string')
          updates.password_encrypted = encryptPassword(data.password);
        if (typeof data.notes === 'string') updates.notes = data.notes;
        if (Object.keys(updates).length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No valid fields to update' }));
          return;
        }
        updateCredential(id, updates);
        const updated = getCredentialById(id)!;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            id: updated.id,
            name: updated.name,
            website: updated.website,
            username: updated.username,
            has_password: !!updated.password_encrypted,
            notes: updated.notes,
            created_at: updated.created_at,
            updated_at: updated.updated_at,
          }),
        );
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  }

  private handleDeleteCredential(id: string, res: http.ServerResponse): void {
    const existing = getCredentialById(id);
    if (!existing) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Credential not found' }));
      return;
    }
    deleteCredential(id);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
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

// ---------- Multipart parser ----------

interface MultipartFile {
  filename: string;
  contentType: string;
  data: Buffer;
}

function parseMultipart(body: Buffer, boundary: string): MultipartFile[] {
  const files: MultipartFile[] = [];
  const boundaryBuf = Buffer.from(`--${boundary}`);
  const endBuf = Buffer.from(`--${boundary}--`);

  let pos = 0;
  while (pos < body.length) {
    const start = body.indexOf(boundaryBuf, pos);
    if (start === -1) break;
    const next = body.indexOf(boundaryBuf, start + boundaryBuf.length);
    if (next === -1 && body.indexOf(endBuf, start + boundaryBuf.length) === -1)
      break;

    const partEnd = next !== -1 ? next : body.length;
    const part = body.subarray(start + boundaryBuf.length, partEnd);

    // Find header/body separator (double CRLF)
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) {
      pos = partEnd;
      continue;
    }

    const headers = part.subarray(0, headerEnd).toString('utf-8');
    const fileData = part.subarray(headerEnd + 4);

    // Check for filename in Content-Disposition
    const filenameMatch = headers.match(
      /filename="([^"]+)"|filename=([^\s;]+)/,
    );
    if (!filenameMatch) {
      pos = partEnd;
      continue;
    }
    const filename = filenameMatch[1] || filenameMatch[2];
    const ctMatch = headers.match(/Content-Type:\s*(\S+)/i);
    const contentType = ctMatch ? ctMatch[1] : 'application/octet-stream';

    // Trim trailing CRLF
    let dataEnd = fileData.length;
    if (
      dataEnd >= 2 &&
      fileData[dataEnd - 2] === 0x0d &&
      fileData[dataEnd - 1] === 0x0a
    ) {
      dataEnd -= 2;
    }

    files.push({
      filename,
      contentType,
      data: Buffer.from(fileData.subarray(0, dataEnd)),
    });
    pos = partEnd;
  }
  return files;
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

  .icon-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    cursor: pointer;
    padding: 4px 9px;
    font-size: 15px;
    line-height: 1;
    font-weight: 500;
    transition: background 0.15s, color 0.15s;
  }
  .icon-btn:hover { background: var(--surface2); color: var(--text); }

  .section-title {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .section-title > span { flex: 1; }

  .section-action {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 0 4px;
    line-height: 1;
    transition: color 0.15s;
  }
  .section-action:hover { color: var(--accent-hover); text-decoration: underline; }

  /* ---- New task form: mode tabs ---- */
  .mode-tabs {
    display: flex;
    gap: 4px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 14px;
  }
  .mode-tab {
    background: none;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    padding: 8px 14px;
    font-size: 13px;
    font-weight: 500;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
  }
  .mode-tab.active { color: var(--text); border-bottom-color: var(--accent); }
  .mode-tab:hover:not(.active) { color: var(--text); }

  .preset-row {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-bottom: 10px;
  }
  .preset-btn {
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    cursor: pointer;
    padding: 6px 10px;
    font-size: 12px;
    font-weight: 500;
  }
  .preset-btn.active { background: var(--accent); border-color: var(--accent); color: #fff; }
  .preset-btn:hover:not(.active) { background: var(--border); color: var(--text); }

  .time-row {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }
  .time-row label { font-size: 12px; color: var(--text-dim); }
  .time-row input[type="time"],
  .time-row input[type="datetime-local"],
  .time-row select {
    padding: 6px 8px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    font-size: 13px;
  }

  .hint {
    font-size: 11px;
    color: var(--text-muted);
    margin-top: 6px;
  }

  /* ---- Task detail: chat-style run log ---- */
  .task-chat-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    border-radius: var(--radius-sm);
    background: var(--surface2);
    margin-bottom: 16px;
    flex-wrap: wrap;
  }
  .task-chat-header .prompt {
    flex: 1;
    min-width: 200px;
    font-size: 13px;
    color: var(--text);
    font-weight: 500;
    line-height: 1.4;
  }
  .task-chat-header .schedule {
    font-size: 11px;
    color: var(--text-muted);
    font-family: var(--mono);
  }

  .run-log {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-bottom: 16px;
  }
  .run-bubble {
    background: var(--bot-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 10px 14px;
    max-width: 80%;
    align-self: flex-start;
  }
  .run-bubble.error { border-color: rgba(239,68,68,0.4); }
  .run-bubble-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    color: var(--text-muted);
    margin-bottom: 6px;
  }
  .run-bubble-meta .badge { font-size: 10px; padding: 1px 6px; }
  .run-bubble-body {
    font-size: 13px;
    color: var(--text);
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.5;
  }
  .run-bubble-body code {
    font-family: var(--mono);
    font-size: 12px;
    background: var(--surface2);
    padding: 1px 4px;
    border-radius: 3px;
  }

  .task-config-toggle {
    background: none;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    cursor: pointer;
    padding: 6px 12px;
    font-size: 12px;
    margin-bottom: 10px;
  }
  .task-config-toggle:hover { background: var(--surface2); color: var(--text); }
  .task-config { display: none; }
  .task-config.visible { display: block; }

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
    <button class="icon-btn" id="global-new-task" title="New task">+</button>
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
    <div class="section-title">
      <span>Scheduled Tasks</span>
      <button class="section-action" id="tasks-new-task" title="New task">+ New</button>
    </div>
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

  // ---- Task detail / chat-style run log ----

  function humanSchedule(type, value) {
    if (type === 'once') {
      const d = new Date(value);
      if (!isNaN(d.getTime())) return 'Once at ' + d.toLocaleString();
      return 'Once: ' + value;
    }
    if (type === 'interval') {
      const ms = parseInt(value, 10);
      if (!isNaN(ms)) return 'Every ' + humanDuration(ms);
      return 'Interval: ' + value;
    }
    if (type === 'cron') {
      const parts = (value || '').trim().split(/\\s+/);
      if (parts.length === 5) {
        const [m, h, dom, mon, dow] = parts;
        if (m === '0' && h === '*' && dom === '*' && mon === '*' && dow === '*') return 'Every hour';
        if (dom === '*' && mon === '*' && dow === '*' && /^\\d+$/.test(m) && /^\\d+$/.test(h)) {
          return 'Daily at ' + h.padStart(2, '0') + ':' + m.padStart(2, '0');
        }
        if (dom === '*' && mon === '*' && /^\\d+$/.test(dow) && /^\\d+$/.test(m) && /^\\d+$/.test(h)) {
          const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          return 'Weekly on ' + (days[parseInt(dow, 10)] || dow) + ' at ' + h.padStart(2, '0') + ':' + m.padStart(2, '0');
        }
      }
      return 'Cron: ' + value;
    }
    return type + ': ' + value;
  }

  function showTaskDetail(task) {
    const scheduleStr = humanSchedule(task.type, task.value);
    const nextStr = task.nextRun ? ' &middot; next ' + relTime(task.nextRun) : '';

    const html =
      '<div class="task-chat-header">' +
        '<div class="prompt">' + esc(task.prompt) + '</div>' +
        '<span class="badge ' + task.status + '">' + task.status + '</span>' +
        '<span class="schedule">' + esc(scheduleStr) + nextStr + '</span>' +
      '</div>' +
      '<div class="detail-actions" style="margin-bottom:14px;">' +
        '<button class="btn primary" id="run-now">Run Now</button>' +
        (task.status === 'active'
          ? '<button class="btn" id="pause-task">Pause</button>'
          : task.status === 'paused'
          ? '<button class="btn" id="resume-task">Resume</button>'
          : '') +
        '<button class="task-config-toggle" id="toggle-config">Edit configuration</button>' +
      '</div>' +
      '<div class="task-config" id="task-config">' +
        '<div class="detail-section">' +
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
          '<div class="detail-actions">' +
            '<button class="btn primary" id="save-task">Save Changes</button>' +
            '<button class="btn danger" id="delete-task">Delete Task</button>' +
          '</div>' +
        '</div>' +
        '<div class="detail-section">' +
          '<h3>Info</h3>' +
          '<div class="detail-field"><label>ID</label><div class="value mono">' + esc(task.id) + '</div></div>' +
          '<div class="detail-field"><label>Group</label><div class="value">' + esc(task.group) + '</div></div>' +
          '<div class="detail-field"><label>Context Mode</label><div class="value">' + esc(task.contextMode || 'isolated') + '</div></div>' +
        '</div>' +
      '</div>' +
      '<div class="detail-section">' +
        '<h3>Run History</h3>' +
        '<div class="run-log" id="run-log"><div class="empty-hint">Loading...</div></div>' +
      '</div>';

    showDetail(task.prompt.length > 40 ? task.prompt.slice(0, 40) + '...' : task.prompt, html);

    // Toggle config
    const configEl = document.getElementById('task-config');
    document.getElementById('toggle-config').addEventListener('click', () => {
      configEl.classList.toggle('visible');
    });

    // Run Now
    document.getElementById('run-now').addEventListener('click', async () => {
      try {
        const res = await fetch('/api/tasks/' + encodeURIComponent(task.id) + '/run', { method: 'POST' });
        if (res.ok) {
          toast('Queued — scheduler will pick this up shortly');
          refreshSidebar();
          setTimeout(() => loadRunLog(task.id), 3000);
        } else {
          const err = await res.json().catch(() => ({}));
          toast(err.error || 'Could not queue run', true);
        }
      } catch { toast('Network error', true); }
    });

    // Pause / Resume
    const pauseBtn = document.getElementById('pause-task');
    const resumeBtn = document.getElementById('resume-task');
    if (pauseBtn) pauseBtn.addEventListener('click', () => setTaskStatus(task.id, 'paused'));
    if (resumeBtn) resumeBtn.addEventListener('click', () => setTaskStatus(task.id, 'active'));

    // Save config
    document.getElementById('save-task').addEventListener('click', async () => {
      const body = {
        prompt: document.getElementById('edit-prompt').value,
        schedule_type: document.getElementById('edit-type').value,
        schedule_value: document.getElementById('edit-value').value,
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

    // Delete
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

    loadRunLog(task.id);
  }

  async function setTaskStatus(id, status) {
    try {
      const res = await fetch('/api/tasks/' + encodeURIComponent(id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        toast('Task ' + (status === 'paused' ? 'paused' : 'resumed'));
        refreshSidebar();
        const task = (statusData.tasks || []).find(t => t.id === id);
        if (task) { task.status = status; showTaskDetail(task); }
      } else { toast('Update failed', true); }
    } catch { toast('Network error', true); }
  }

  async function loadRunLog(id) {
    const el = document.getElementById('run-log');
    if (!el) return;
    try {
      const res = await fetch('/api/tasks/' + encodeURIComponent(id) + '/logs?limit=20');
      if (!res.ok) { el.innerHTML = '<div class="empty-hint">Could not load history</div>'; return; }
      const logs = await res.json();
      if (!logs.length) { el.innerHTML = '<div class="empty-hint">No runs yet. Click Run Now to trigger one.</div>'; return; }
      el.innerHTML = logs.map(l => {
        const cls = l.status === 'error' ? 'run-bubble error' : 'run-bubble';
        const body = l.result || l.error || '(no output)';
        const dur = l.duration_ms != null ? humanDuration(l.duration_ms) : '';
        return '<div class="' + cls + '">' +
          '<div class="run-bubble-meta">' +
            '<span>' + esc(new Date(l.run_at).toLocaleString()) + '</span>' +
            (dur ? '<span>&middot; ' + esc(dur) + '</span>' : '') +
            '<span class="badge ' + esc(l.status) + '">' + esc(l.status) + '</span>' +
          '</div>' +
          '<div class="run-bubble-body">' + renderMarkdown(body) + '</div>' +
        '</div>';
      }).join('');
    } catch {
      el.innerHTML = '<div class="empty-hint">Could not load history</div>';
    }
  }

  // ---- New task form ----

  async function showNewTaskForm() {
    let groups = [];
    try {
      const res = await fetch('/api/groups');
      if (res.ok) groups = await res.json();
    } catch {}

    if (!groups.length) {
      showDetail('New Task', '<div class="empty-hint">No groups registered. Register a group first.</div>');
      return;
    }

    const groupOpts = groups.map(g =>
      '<option value="' + esc(g.folder) + '" data-jid="' + esc(g.jid) + '">' +
        esc(g.name) + ' (' + esc(g.folder) + ')' +
      '</option>'
    ).join('');

    // Default datetime: now + 5 minutes, local timezone, formatted for <input type="datetime-local">
    const soon = new Date(Date.now() + 5 * 60 * 1000);
    const pad = n => String(n).padStart(2, '0');
    const localSoon = soon.getFullYear() + '-' + pad(soon.getMonth() + 1) + '-' + pad(soon.getDate()) +
      'T' + pad(soon.getHours()) + ':' + pad(soon.getMinutes());

    const html =
      '<div class="mode-tabs">' +
        '<button class="mode-tab active" data-mode="once">One-off</button>' +
        '<button class="mode-tab" data-mode="recurring">Recurring</button>' +
      '</div>' +

      '<div class="detail-field">' +
        '<label>What should ' + esc('${ASSISTANT_NAME}') + ' do?</label>' +
        '<textarea id="nt-prompt" placeholder="e.g. Summarize my unread emails and send the summary"></textarea>' +
      '</div>' +

      '<div class="detail-field">' +
        '<label>Group</label>' +
        '<select id="nt-group">' + groupOpts + '</select>' +
      '</div>' +

      // One-off mode pane
      '<div class="detail-field mode-pane" id="pane-once">' +
        '<label>When</label>' +
        '<div class="time-row">' +
          '<label><input type="radio" name="nt-when" value="now" checked> Run now</label>' +
          '<label><input type="radio" name="nt-when" value="later"> At:</label>' +
          '<input type="datetime-local" id="nt-once-at" value="' + localSoon + '" disabled>' +
        '</div>' +
        '<div class="hint">One-off tasks run once, then stop. Scheduler checks every 60s.</div>' +
      '</div>' +

      // Recurring mode pane (hidden initially)
      '<div class="detail-field mode-pane" id="pane-recurring" style="display:none;">' +
        '<label>How often</label>' +
        '<div class="preset-row" id="nt-presets">' +
          '<button type="button" class="preset-btn active" data-preset="hourly">Every hour</button>' +
          '<button type="button" class="preset-btn" data-preset="daily">Daily</button>' +
          '<button type="button" class="preset-btn" data-preset="weekly">Weekly</button>' +
          '<button type="button" class="preset-btn" data-preset="custom">Custom cron</button>' +
        '</div>' +

        '<div class="time-row" id="preset-daily" style="display:none;">' +
          '<label>At</label>' +
          '<input type="time" id="nt-daily-time" value="09:00">' +
        '</div>' +

        '<div class="time-row" id="preset-weekly" style="display:none;">' +
          '<label>On</label>' +
          '<select id="nt-weekly-dow">' +
            '<option value="0">Sunday</option>' +
            '<option value="1" selected>Monday</option>' +
            '<option value="2">Tuesday</option>' +
            '<option value="3">Wednesday</option>' +
            '<option value="4">Thursday</option>' +
            '<option value="5">Friday</option>' +
            '<option value="6">Saturday</option>' +
          '</select>' +
          '<label>at</label>' +
          '<input type="time" id="nt-weekly-time" value="09:00">' +
        '</div>' +

        '<div class="detail-field" id="preset-custom" style="display:none;margin-top:8px;">' +
          '<input type="text" id="nt-cron" placeholder="0 9 * * *" value="0 * * * *">' +
          '<div class="hint">Standard 5-field cron: minute hour dom month dow</div>' +
        '</div>' +
      '</div>' +

      '<div class="detail-field">' +
        '<label>Context Mode</label>' +
        '<div class="time-row">' +
          '<label><input type="radio" name="nt-ctx" value="isolated" checked> Isolated (fresh context each run)</label>' +
          '<label><input type="radio" name="nt-ctx" value="group"> Group (share group conversation)</label>' +
        '</div>' +
      '</div>' +

      '<div class="detail-actions">' +
        '<button class="btn primary" id="nt-create">Create Task</button>' +
        '<button class="btn" id="nt-cancel">Cancel</button>' +
      '</div>';

    showDetail('New Task', html);

    // Mode tab switching
    let mode = 'once';
    document.querySelectorAll('.mode-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        mode = btn.dataset.mode;
        document.querySelectorAll('.mode-tab').forEach(b => b.classList.toggle('active', b === btn));
        document.getElementById('pane-once').style.display = mode === 'once' ? '' : 'none';
        document.getElementById('pane-recurring').style.display = mode === 'recurring' ? '' : 'none';
      });
    });

    // One-off "at" radio toggles datetime input
    document.querySelectorAll('input[name="nt-when"]').forEach(r => {
      r.addEventListener('change', () => {
        document.getElementById('nt-once-at').disabled = document.querySelector('input[name="nt-when"]:checked').value === 'now';
      });
    });

    // Recurring presets
    let preset = 'hourly';
    document.querySelectorAll('#nt-presets .preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        preset = btn.dataset.preset;
        document.querySelectorAll('#nt-presets .preset-btn').forEach(b => b.classList.toggle('active', b === btn));
        document.getElementById('preset-daily').style.display = preset === 'daily' ? '' : 'none';
        document.getElementById('preset-weekly').style.display = preset === 'weekly' ? '' : 'none';
        document.getElementById('preset-custom').style.display = preset === 'custom' ? '' : 'none';
      });
    });

    // Cancel
    document.getElementById('nt-cancel').addEventListener('click', showChat);

    // Create
    document.getElementById('nt-create').addEventListener('click', async () => {
      const promptText = document.getElementById('nt-prompt').value.trim();
      if (!promptText) { toast('Please enter a prompt', true); return; }

      const groupSelect = document.getElementById('nt-group');
      const selectedOpt = groupSelect.options[groupSelect.selectedIndex];
      const groupFolder = groupSelect.value;
      const chatJid = selectedOpt.dataset.jid;
      const contextMode = document.querySelector('input[name="nt-ctx"]:checked').value;

      let schedule_type, schedule_value;

      if (mode === 'once') {
        schedule_type = 'once';
        const when = document.querySelector('input[name="nt-when"]:checked').value;
        if (when === 'now') {
          schedule_value = new Date().toISOString();
        } else {
          const raw = document.getElementById('nt-once-at').value;
          if (!raw) { toast('Pick a date/time', true); return; }
          schedule_value = new Date(raw).toISOString();
        }
      } else {
        schedule_type = 'cron';
        if (preset === 'hourly') {
          schedule_value = '0 * * * *';
        } else if (preset === 'daily') {
          const t = document.getElementById('nt-daily-time').value || '09:00';
          const [h, m] = t.split(':');
          schedule_value = parseInt(m, 10) + ' ' + parseInt(h, 10) + ' * * *';
        } else if (preset === 'weekly') {
          const t = document.getElementById('nt-weekly-time').value || '09:00';
          const [h, m] = t.split(':');
          const dow = document.getElementById('nt-weekly-dow').value;
          schedule_value = parseInt(m, 10) + ' ' + parseInt(h, 10) + ' * * ' + dow;
        } else {
          schedule_value = document.getElementById('nt-cron').value.trim();
          if (!schedule_value) { toast('Enter a cron expression', true); return; }
        }
      }

      try {
        const res = await fetch('/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: promptText,
            group_folder: groupFolder,
            chat_jid: chatJid,
            schedule_type,
            schedule_value,
            context_mode: contextMode,
          }),
        });
        if (res.ok) {
          const created = await res.json();
          toast('Task created');
          await refreshSidebar();
          const t = (statusData.tasks || []).find(x => x.id === created.id);
          if (t) showTaskDetail(t);
          else showChat();
        } else {
          const err = await res.json().catch(() => ({}));
          toast(err.error || 'Create failed', true);
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

  // ---- New-task entry points ----
  document.getElementById('global-new-task').addEventListener('click', showNewTaskForm);
  document.getElementById('tasks-new-task').addEventListener('click', showNewTaskForm);

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
