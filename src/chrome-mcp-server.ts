/**
 * Chrome DevTools Protocol MCP Server
 *
 * Streamable HTTP MCP server that wraps Chrome DevTools Protocol (CDP).
 * Runs on the host, accessible from containers via host.docker.internal.
 * Requires Chrome to be running with --remote-debugging-port.
 */
import http from 'http';
import WebSocket from 'ws';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

import { logger } from './logger.js';

// ---------------------------------------------------------------------------
// CDP helpers
// ---------------------------------------------------------------------------

interface CDPTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

let cdpBaseUrl = 'http://localhost:9222';

/** Fetch the list of debuggable targets from Chrome. */
async function getTargets(): Promise<CDPTarget[]> {
  const res = await fetch(`${cdpBaseUrl}/json`);
  if (!res.ok) throw new Error(`CDP /json failed: ${res.status}`);
  return (await res.json()) as CDPTarget[];
}

/** Resolve a target – by id, or fall back to the first page target. */
async function resolveTarget(tabId?: string): Promise<CDPTarget> {
  const targets = await getTargets();
  if (tabId) {
    const t = targets.find((t) => t.id === tabId);
    if (!t) throw new Error(`Tab ${tabId} not found`);
    return t;
  }
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('No page targets available');
  return page;
}

let msgIdCounter = 1;

/** Send a single CDP command and wait for the result. */
async function cdpCommand(
  wsUrl: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const id = msgIdCounter++;
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`CDP timeout: ${method}`));
    }, 30_000);

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id, method, params }));
    });

    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id === id) {
        clearTimeout(timer);
        ws.close();
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });

    ws.addEventListener('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** Helper: send CDP command to a target (by tab id or first page). */
async function sendToTarget(
  method: string,
  params: Record<string, unknown> = {},
  tabId?: string,
): Promise<unknown> {
  const target = await resolveTarget(tabId);
  if (!target.webSocketDebuggerUrl) {
    throw new Error(`Target ${target.id} has no debugger URL`);
  }
  return cdpCommand(target.webSocketDebuggerUrl, method, params);
}

/** Evaluate JS in the page and return the stringified result. */
async function evaluate(expression: string, tabId?: string): Promise<string> {
  const result = (await sendToTarget(
    'Runtime.evaluate',
    {
      expression,
      returnByValue: true,
      awaitPromise: true,
    },
    tabId,
  )) as {
    result: { type: string; value?: unknown; description?: string };
    exceptionDetails?: { text: string };
  };

  if (result.exceptionDetails) {
    throw new Error(`JS error: ${result.exceptionDetails.text}`);
  }
  const val = result.result;
  if (val.type === 'undefined') return 'undefined';
  if (val.value !== undefined) {
    return typeof val.value === 'string'
      ? val.value
      : JSON.stringify(val.value, null, 2);
  }
  return val.description || String(val.value);
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

function buildServer(): McpServer {
  const server = new McpServer({
    name: 'chrome',
    version: '1.0.0',
  });

  // -- navigate --
  server.tool(
    'navigate',
    'Navigate to a URL in a browser tab.',
    {
      url: z.string().describe('The URL to navigate to'),
      tabId: z
        .string()
        .optional()
        .describe('Target tab ID (defaults to first page)'),
    },
    async ({ url, tabId }) => {
      await sendToTarget('Page.navigate', { url }, tabId);
      // Wait for load
      await sendToTarget('Page.enable', {}, tabId);
      await new Promise((r) => setTimeout(r, 1500));
      return {
        content: [{ type: 'text' as const, text: `Navigated to ${url}` }],
      };
    },
  );

  // -- read_page --
  server.tool(
    'read_page',
    'Get the text content of the current page.',
    {
      tabId: z
        .string()
        .optional()
        .describe('Target tab ID (defaults to first page)'),
      selector: z
        .string()
        .optional()
        .describe('CSS selector to read specific element (defaults to body)'),
    },
    async ({ tabId, selector }) => {
      const sel = selector || 'document.body';
      const expr = selector
        ? `document.querySelector(${JSON.stringify(selector)})?.innerText || ''`
        : `document.body.innerText`;
      const text = await evaluate(expr, tabId);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  // -- read_html --
  server.tool(
    'read_html',
    'Get the HTML of the current page or a specific element.',
    {
      tabId: z.string().optional(),
      selector: z
        .string()
        .optional()
        .describe('CSS selector (defaults to document.documentElement)'),
    },
    async ({ tabId, selector }) => {
      const expr = selector
        ? `document.querySelector(${JSON.stringify(selector)})?.outerHTML || ''`
        : `document.documentElement.outerHTML`;
      const html = await evaluate(expr, tabId);
      // Truncate to avoid massive payloads
      const truncated =
        html.length > 100_000
          ? html.slice(0, 100_000) + '\n... (truncated)'
          : html;
      return { content: [{ type: 'text' as const, text: truncated }] };
    },
  );

  // -- execute_javascript --
  server.tool(
    'execute_javascript',
    'Execute JavaScript in the page context and return the result.',
    {
      code: z.string().describe('JavaScript code to execute'),
      tabId: z.string().optional(),
    },
    async ({ code, tabId }) => {
      const result = await evaluate(code, tabId);
      return { content: [{ type: 'text' as const, text: result }] };
    },
  );

  // -- click --
  server.tool(
    'click',
    'Click an element matching a CSS selector.',
    {
      selector: z.string().describe('CSS selector of the element to click'),
      tabId: z.string().optional(),
    },
    async ({ selector, tabId }) => {
      const expr = `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return 'Element not found: ${selector.replace(/'/g, "\\'")}';
        el.click();
        return 'Clicked: ' + (el.tagName || '') + ' ' + (el.textContent || '').slice(0, 50);
      })()`;
      const result = await evaluate(expr, tabId);
      return { content: [{ type: 'text' as const, text: result }] };
    },
  );

  // -- type_text --
  server.tool(
    'type_text',
    'Type text into an input element matching a CSS selector.',
    {
      selector: z.string().describe('CSS selector of the input element'),
      text: z.string().describe('Text to type'),
      clear: z
        .boolean()
        .optional()
        .describe('Clear existing value first (default true)'),
      tabId: z.string().optional(),
    },
    async ({ selector, text, clear, tabId }) => {
      const shouldClear = clear !== false;
      const expr = `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return 'Element not found: ${selector.replace(/'/g, "\\'")}';
        el.focus();
        ${shouldClear ? "el.value = '';" : ''}
        el.value = ${JSON.stringify(text)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return 'Typed into: ' + el.tagName;
      })()`;
      const result = await evaluate(expr, tabId);
      return { content: [{ type: 'text' as const, text: result }] };
    },
  );

  // -- find_elements --
  server.tool(
    'find_elements',
    'Find elements matching a CSS selector and return their text, tag, and attributes.',
    {
      selector: z.string().describe('CSS selector'),
      tabId: z.string().optional(),
      limit: z
        .number()
        .optional()
        .describe('Max elements to return (default 20)'),
    },
    async ({ selector, tabId, limit }) => {
      const max = limit || 20;
      const expr = `(() => {
        const els = [...document.querySelectorAll(${JSON.stringify(selector)})].slice(0, ${max});
        return JSON.stringify(els.map((el, i) => ({
          index: i,
          tag: el.tagName.toLowerCase(),
          id: el.id || undefined,
          class: el.className || undefined,
          text: (el.textContent || '').trim().slice(0, 100),
          href: el.href || undefined,
          value: el.value || undefined,
        })));
      })()`;
      const result = await evaluate(expr, tabId);
      return { content: [{ type: 'text' as const, text: result }] };
    },
  );

  // -- screenshot --
  server.tool(
    'screenshot',
    'Take a screenshot of the current page. Returns a base64-encoded PNG image.',
    {
      tabId: z.string().optional(),
    },
    async ({ tabId }) => {
      const result = (await sendToTarget(
        'Page.captureScreenshot',
        { format: 'png' },
        tabId,
      )) as { data: string };
      return {
        content: [
          {
            type: 'image' as const,
            data: result.data,
            mimeType: 'image/png',
          },
        ],
      };
    },
  );

  // -- list_tabs --
  server.tool('list_tabs', 'List all open browser tabs.', {}, async () => {
    const targets = await getTargets();
    const pages = targets
      .filter((t) => t.type === 'page')
      .map((t) => ({
        id: t.id,
        title: t.title,
        url: t.url,
      }));
    return {
      content: [
        { type: 'text' as const, text: JSON.stringify(pages, null, 2) },
      ],
    };
  });

  // -- create_tab --
  server.tool(
    'create_tab',
    'Open a new browser tab.',
    {
      url: z
        .string()
        .optional()
        .describe('URL to open (defaults to about:blank)'),
    },
    async ({ url }) => {
      const targetUrl = url || 'about:blank';
      const res = await fetch(`${cdpBaseUrl}/json/new?${targetUrl}`);
      if (!res.ok) throw new Error(`Failed to create tab: ${res.status}`);
      const target = (await res.json()) as CDPTarget;
      return {
        content: [
          {
            type: 'text' as const,
            text: `Created tab ${target.id}: ${target.url}`,
          },
        ],
      };
    },
  );

  // -- close_tab --
  server.tool(
    'close_tab',
    'Close a browser tab.',
    {
      tabId: z.string().describe('ID of the tab to close'),
    },
    async ({ tabId }) => {
      const res = await fetch(`${cdpBaseUrl}/json/close/${tabId}`);
      if (!res.ok) throw new Error(`Failed to close tab: ${res.status}`);
      return {
        content: [{ type: 'text' as const, text: `Closed tab ${tabId}` }],
      };
    },
  );

  // -- read_console --
  server.tool(
    'read_console',
    'Read recent console messages from a page. Enables console monitoring for 2 seconds then returns captured messages.',
    {
      tabId: z.string().optional(),
    },
    async ({ tabId }) => {
      const target = await resolveTarget(tabId);
      if (!target.webSocketDebuggerUrl) {
        throw new Error('No debugger URL');
      }
      // Capture console messages for a brief window
      const messages: string[] = [];
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(target.webSocketDebuggerUrl!);
        const timer = setTimeout(() => {
          ws.close();
          resolve();
        }, 2000);

        ws.addEventListener('open', () => {
          ws.send(
            JSON.stringify({
              id: msgIdCounter++,
              method: 'Runtime.enable',
            }),
          );
        });

        ws.addEventListener('message', (ev) => {
          const msg = JSON.parse(String(ev.data));
          if (msg.method === 'Runtime.consoleAPICalled') {
            const args = msg.params.args || [];
            const text = args
              .map((a: { value?: unknown; description?: string }) =>
                a.value !== undefined ? String(a.value) : a.description || '',
              )
              .join(' ');
            messages.push(`[${msg.params.type}] ${text}`);
          }
        });

        ws.addEventListener('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });

      return {
        content: [
          {
            type: 'text' as const,
            text:
              messages.length > 0
                ? messages.join('\n')
                : '(no console messages)',
          },
        ],
      };
    },
  );

  return server;
}

// ---------------------------------------------------------------------------
// HTTP server (streamable HTTP transport)
// ---------------------------------------------------------------------------

export async function startChromeMcpServer(
  port: number,
  chromeCdpUrl?: string,
): Promise<http.Server> {
  if (chromeCdpUrl) cdpBaseUrl = chromeCdpUrl;

  const httpServer = http.createServer();

  // Track transports and their paired MCP servers per session
  const sessions = new Map<
    string,
    { transport: StreamableHTTPServerTransport; server: McpServer }
  >();

  httpServer.on('request', async (req, res) => {
    // Health check
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    // MCP endpoint
    if (req.url === '/mcp') {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      if (
        req.method === 'POST' ||
        req.method === 'GET' ||
        req.method === 'DELETE'
      ) {
        let transport: StreamableHTTPServerTransport;

        if (sessionId && sessions.has(sessionId)) {
          transport = sessions.get(sessionId)!.transport;
        } else if (!sessionId && req.method === 'POST') {
          // New session — create a fresh MCP server + transport pair
          const mcpServer = buildServer();
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => crypto.randomUUID(),
            onsessioninitialized: (sid) => {
              sessions.set(sid, { transport, server: mcpServer });
            },
          });
          transport.onclose = () => {
            const sid = [...sessions.entries()].find(
              ([, s]) => s.transport === transport,
            )?.[0];
            if (sid) {
              sessions.delete(sid);
              mcpServer.close().catch(() => {});
            }
          };
          await mcpServer.connect(transport);
        } else {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Bad request: missing session ID');
          return;
        }

        await transport.handleRequest(req, res);
        return;
      }
    }

    res.writeHead(404);
    res.end('Not found');
  });

  return new Promise((resolve) => {
    httpServer.listen(port, '0.0.0.0', () => {
      logger.info({ port }, 'Chrome MCP server listening');
      resolve(httpServer);
    });
  });
}
