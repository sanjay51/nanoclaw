import http from 'http';
import { randomUUID } from 'crypto';

import { ASSISTANT_NAME } from '../config.js';
import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';
import { registerChannel, ChannelOpts } from './registry.js';
import { Channel, OnChatMetadata, OnInboundMessage, RegisteredGroup } from '../types.js';

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

  constructor(port: number, opts: WebChannelOpts) {
    this.port = port;
    this.opts = opts;
  }

  async connect(): Promise<void> {
    this.server = http.createServer((req, res) => this.handleRequest(req, res));

    return new Promise<void>((resolve, reject) => {
      this.server!.listen(this.port, '127.0.0.1', () => {
        logger.info({ port: this.port }, 'Web channel listening');
        console.log(`\n  Web UI: http://localhost:${this.port}\n`);
        resolve();
      });
      this.server!.on('error', reject);
    });
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    const event = JSON.stringify({ type: 'message', text, timestamp: new Date().toISOString() });
    this.broadcast(`data: ${event}\n\n`);
    logger.info({ jid, length: text.length }, 'Web message sent');
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    const event = JSON.stringify({ type: 'typing', isTyping });
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

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    // CORS for localhost
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname === '/' && req.method === 'GET') {
      this.serveUI(res);
    } else if (url.pathname === '/api/events' && req.method === 'GET') {
      this.handleSSE(res);
    } else if (url.pathname === '/api/message' && req.method === 'POST') {
      this.handleMessage(req, res);
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

  private handleMessage(req: http.IncomingMessage, res: http.ServerResponse): void {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const { text } = JSON.parse(body);
        if (!text || typeof text !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing text field' }));
          return;
        }

        const chatJid = DEFAULT_JID;
        const timestamp = new Date().toISOString();

        this.opts.onChatMetadata(chatJid, timestamp, 'Web Chat', 'web', false);

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

  private serveUI(res: http.ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
  }
}

// ---------- Inline HTML ----------

const HTML = /* html */ `<!DOCTYPE html>
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
    --border: #2a2a2a;
    --text: #e4e4e4;
    --text-dim: #888;
    --accent: #3b82f6;
    --accent-hover: #2563eb;
    --user-bg: #1e3a5f;
    --bot-bg: #1a1a1a;
    --radius: 12px;
    --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    --mono: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  }

  html, body { height: 100%; }

  body {
    font-family: var(--font);
    background: var(--bg);
    color: var(--text);
    display: flex;
    flex-direction: column;
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
    background: #ef4444;
    transition: background 0.3s;
  }
  header .dot.connected { background: #22c55e; }

  header h1 {
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
</style>
</head>
<body>
  <header>
    <div class="dot" id="dot"></div>
    <h1>${ASSISTANT_NAME}</h1>
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

<script>
(function() {
  const messages = document.getElementById('messages');
  const empty = document.getElementById('empty');
  const typing = document.getElementById('typing');
  const form = document.getElementById('form');
  const input = document.getElementById('input');
  const dot = document.getElementById('dot');
  const status = document.getElementById('status');

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

  // Minimal markdown: code blocks, inline code, bold, italic
  function renderMarkdown(text) {
    // Escape HTML first
    text = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    // Code blocks
    text = text.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, '<pre><code>$1</code></pre>');
    // Inline code
    text = text.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
    // Bold
    text = text.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
    // Italic
    text = text.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
    return text;
  }

  // Auto-resize textarea
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 200) + 'px';
  });

  // Enter to send, Shift+Enter for newline
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

  // SSE
  function connectSSE() {
    const es = new EventSource('/api/events');

    es.onopen = () => {
      dot.classList.add('connected');
      status.textContent = 'connected';
    };

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'message') {
          typing.classList.remove('visible');
          addMsg(data.text, 'bot');
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
      status.textContent = 'reconnecting...';
      es.close();
      setTimeout(connectSSE, 2000);
    };
  }

  connectSSE();
})();
</script>
</body>
</html>`;

registerChannel('web', (opts: ChannelOpts) => {
  const envVars = readEnvFile(['WEB_PORT']);
  const portStr = process.env.WEB_PORT || envVars.WEB_PORT || '';
  // Web channel is opt-in: requires WEB_PORT to be set
  if (!portStr) {
    logger.debug('Web: WEB_PORT not set, skipping');
    return null;
  }
  const port = parseInt(portStr, 10) || DEFAULT_PORT;
  return new WebChannel(port, opts);
});
