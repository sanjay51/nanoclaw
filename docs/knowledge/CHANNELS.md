# Channels

How channels plug in, how messages are normalized, and how outbound routing decides who sends what. All paths relative to `/home/swebdev/personal-workspace/nanoclaw`.

## The contract

Every channel implements the `Channel` interface (`src/types.ts:107-118`):

```typescript
interface Channel {
  name: string;
  connect(): Promise<void>;
  sendMessage(jid: string, text: string): Promise<void>;
  isConnected(): boolean;
  ownsJid(jid: string): boolean;
  disconnect(): Promise<void>;
  setTyping?(jid: string, isTyping: boolean): Promise<void>;
  syncGroups?(force: boolean): Promise<void>;
}
```

`ownsJid(jid)` is how `routeOutbound()` (`src/router.ts:44`) picks which channel to send a reply through. Channels must only claim JIDs that match their prefix (e.g. Telegram claims `tg:*`).

## Self-registration

`src/channels/registry.ts:1-29` exposes:
- `registerChannel(name, factory)` — called at module top-level by each channel
- `ChannelOpts` (line 8-12) — callbacks the host provides: `onMessage`, `onChatMetadata`, `registeredGroups()`
- Factory returns `Channel | null` — null means the channel isn't available (missing credentials, feature flag off, etc.) and is silently skipped.

**Load path:** `src/index.ts:21` imports `./channels/index.js`. The barrel file (`src/channels/index.ts`) imports each channel module, which triggers that module's `registerChannel()` call. There is no dynamic discovery — adding a channel means editing the barrel import list.

## Channels currently on main

Feature skills for many channels exist on `skill/*` branches, but the following are merged into this fork's `main`:

| Channel | File | JID prefix | Activation |
|---------|------|-----------|------------|
| **Telegram** | `src/channels/telegram.ts:48-440` (register at line 431) | `tg:<chat-id>` | `TELEGRAM_BOT_TOKEN` env var |
| **Web** | `src/channels/web.ts:68-400+` | `web:<session-id>` | Always-on; listens on `DEFAULT_PORT` (default 3456, `web.ts:53`) |

Channel skills that ship as `skill/*` branches (not necessarily merged here): Discord, Gmail, Slack, WhatsApp. Check `.claude/skills/add-<channel>/SKILL.md` for their install flow.

## Main channel

The "main" is a registered group with `isMain = true`. Configured at registration time via the setup flow (`/setup` or `npx tsx setup/index.ts --step register ... --is-main`). Stored in `registered_groups.is_main` (`src/db.ts:138-139`).

Why main is special:
- **No trigger required** — every inbound message is processed without `@Romi`
- **Elevated container mounts** — full repo + store visibility (see `CONTAINERS.md`)
- **Admin surface** — `/schedule`, group registration, credential management, personality changes flow through here

There is typically one main group per install (often the user's self-chat or a personal Telegram channel).

## Message normalization (inbound)

Each channel maps its native payload into `NewMessage` (`src/types.ts:65-78`):

```typescript
interface NewMessage {
  id: string;
  chat_jid: string;        // e.g. "tg:-100123456"
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;       // ISO 8601
  is_from_me?: boolean;
  is_bot_message?: boolean;
  thread_id?: string;
  reply_to_message_id?: string;
  reply_to_message_content?: string;
  reply_to_sender_name?: string;
}
```

Example — Telegram's normalization happens inline in `src/channels/telegram.ts:150-200+`: message_id → `id`, chat.id → `chat_jid` (with `tg:` prefix), `new Date(ctx.message.date * 1000).toISOString()` → `timestamp` (line 165), `from.id` / `from.first_name` → sender fields, reply metadata copied across.

After normalization, the channel invokes `onMessage(msg)` from `ChannelOpts`. The host stores it (`storeMessage()` in `src/db.ts:328`) and the main loop takes over.

## Outbound routing

`src/router.ts:38-60`:
- `formatOutbound(raw)` — strips `<internal>` tags, returns the cleaned text
- `routeOutbound(channels, jid, text)` — iterates channels, finds the one whose `ownsJid(jid)` returns true, calls `channel.sendMessage(jid, text)`

**Per-channel formatting happens at send time, not in the router.** The router hands raw text (still containing Markdown) to the channel, and the channel converts to its native syntax.

Where the conversion lives:
- **Telegram:** uses Markdown v1 via `parse_mode: 'Markdown'` (`src/channels/telegram.ts:30-46`). Claude's default Markdown renders cleanly; Telegram falls back to plain text on parse errors.
- **Slack:** `container/skills/slack-formatting/SKILL.md` converts Markdown → mrkdwn (`*bold*`, `_italic_`, `~strike~`, `<@user>`, `<#channel>`). This is a container skill — the conversion runs **inside** the agent before output, not in the host router.
- **Web:** sends raw text (the web UI renders Markdown itself).
- **WhatsApp / Discord / Gmail / Signal** (when their skills are applied): see `.claude/skills/channel-formatting/` and the channel's skill — each one carries its own converter.

Host-level outbound broadcast: non-web channels also push a copy to the Web channel so SSE clients see the same reply (`src/index.ts:427-434`).

## Credentials

No channel-specific config files. Channels read from env:
- At startup via `readEnvFile([KEYS])` — e.g. Telegram at `src/channels/telegram.ts:432-434`
- API keys/tokens flow through the **OneCLI gateway** at `http://127.0.0.1:10254` (see `CONTAINERS.md`). Channels themselves generally hold long-lived bot tokens in `.env`; agent-level credentials (Anthropic API key, per-service OAuth) come through OneCLI.

## Channel skill vs channel runtime code

- A **channel skill** (`.claude/skills/add-<channel>/`) is a setup skill on `main` plus a code-carrying branch `skill/<channel>`. Running `/add-<channel>` merges the branch into the user's `main`.
- Once merged, the channel's runtime code lives in `src/channels/<channel>.ts` and is indistinguishable from core code.
- The skill is purely a **distribution model**; there is no dynamic runtime skill loading for channels.

## Adding a new channel — checklist

If the task is to add a channel:

1. Create `src/channels/<name>.ts` implementing the `Channel` interface.
2. Call `registerChannel('<name>', factory)` at module top-level.
3. Add an import line to the barrel `src/channels/index.ts`.
4. Define the JID prefix (`<name>:<id>`). Make sure `ownsJid()` only returns true for that prefix.
5. Normalize inbound messages into `NewMessage` shape (including reply metadata).
6. Read credentials from env (ideally via `readEnvFile()`).
7. Add a formatter if the channel doesn't accept raw Markdown — either inline or as a container skill under `container/skills/<name>-formatting/`.
8. Write tests next to the source (`<name>.test.ts`) — see `CONVENTIONS.md`.
9. Optional: create a `skill/<name>` branch and `.claude/skills/add-<name>/SKILL.md` so other installs can pull it in — see `SKILLS-SYSTEM.md`.
