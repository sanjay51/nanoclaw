# NanoClaw Architecture

Personal Claude agent orchestrator. Routes messages from multiple channels through isolated Docker containers running Claude Agent SDK.

## Core Flow

```
Channel (Telegram/Web/Slack/Discord) → onMessage callback
  → SQLite: storeMessage()
  → startMessageLoop() polls every 2s
  → GroupQueue: enqueueMessageCheck()
  → processGroupMessages() checks triggers
  → runAgent() spawns Docker container
  → Container reads stdin JSON, runs Claude Agent SDK
  → OUTPUT_MARKER pairs streamed on stdout
  → channel.sendMessage() delivers response
```

## Source Map

### Orchestrator: `src/index.ts`

Entry point. Manages state, message loop, agent invocation.

| Function | Line | Purpose |
|----------|------|---------|
| `main()` | L570 | Init DB, load state, start subsystems, connect channels |
| `loadState()` | L101 | Load cursor positions and sessions from DB |
| `saveState()` | L139 | Persist message cursor and agent timestamps |
| `getOrRecoverCursor()` | L122 | Recover cursor from last bot reply if state missing |
| `registerGroup()` | L144 | Create group directory, copy CLAUDE.md template, ensure OneCLI agent |
| `getAvailableGroups()` | L195 | Known chats ordered by activity, marked registered/unregistered |
| `processGroupMessages()` | L220 | Check trigger, format messages, run agent, manage idle timeout |
| `runAgent()` | L338 | Spawn container, write task/group snapshots, track sessions |
| `startMessageLoop()` | L440 | Infinite poll loop, dedup by group, queue for processing |
| `recoverPendingMessages()` | L547 | Startup recovery for unprocessed messages |

**State variables** (module-level):
- `lastTimestamp` — global cursor for all messages
- `sessions: Record<string, string>` — group folder to session ID
- `registeredGroups: Record<string, RegisteredGroup>` — JID to group config
- `lastAgentTimestamp: Record<string, string>` — per-group message cursor
- `channels: Channel[]` — connected channel instances
- `queue: GroupQueue` — concurrency manager

### Container Runner: `src/container-runner.ts`

Spawns Docker containers, streams output, manages timeouts.

| Function | Line | Purpose |
|----------|------|---------|
| `runContainerAgent()` | L286 | Main spawn: stdin JSON in, stdout marker pairs out |
| `buildVolumeMounts()` | L61 | Mount list: group folder, global, IPC, sessions, skills |
| `buildContainerArgs()` | L235 | Docker CLI args: OneCLI proxy, user mapping, mounts |
| `writeTasksSnapshot()` | L682 | Write `/workspace/ipc/current_tasks.json` for container |
| `writeGroupsSnapshot()` | L721 | Write `/workspace/ipc/available_groups.json` (main only) |

**Key types:**
- `ContainerInput` — `{ prompt, sessionId?, groupFolder, chatJid, isMain, isScheduledTask?, assistantName?, script? }`
- `ContainerOutput` — `{ status, result, newSessionId?, error? }`

**Output protocol:** Results wrapped in `---NANOCLAW_OUTPUT_START---` / `---NANOCLAW_OUTPUT_END---` JSON pairs on stdout. Multiple pairs per session (streaming). Container stays alive for IPC follow-up messages.

### Container Runtime: `src/container-runtime.ts`

Docker abstraction layer.

| Function | Line | Purpose |
|----------|------|---------|
| `hostGatewayArgs()` | L14 | `--add-host` on Linux (Docker Desktop handles it on macOS) |
| `stopContainer()` | L31 | `docker stop -t 1` with name validation |
| `ensureContainerRuntimeRunning()` | L39 | Check `docker info`, fatal exit if unavailable |
| `cleanupOrphans()` | L79 | Find and stop leftover `nanoclaw-*` containers |

`CONTAINER_RUNTIME_BIN = 'docker'` — change this one constant to switch runtimes.

### Concurrency: `src/group-queue.ts`

**`GroupQueue` class** — manages concurrent container slots.

| Method | Line | Purpose |
|--------|------|---------|
| `enqueueMessageCheck()` | L62 | Queue messages; run if slot available, otherwise wait |
| `enqueueTask()` | L90 | Queue tasks; preempt idle containers if tasks pending |
| `registerProcess()` | L132 | Store process/container refs for a group |
| `notifyIdle()` | L148 | Mark container idle; preempt if tasks waiting |
| `sendMessage()` | L160 | Write IPC file to active container's input dir |
| `closeStdin()` | L183 | Write `_close` sentinel for graceful shutdown |
| `shutdown()` | L347 | SIGTERM handler: detach containers (don't kill) |

**Per-group state** (`GroupState`): active, idleWaiting, pendingMessages, pendingTasks[], process, containerName, retryCount.

**Concurrency model:** Up to `MAX_CONCURRENT_CONTAINERS` (default 5) active. Waiting groups queue. Tasks prioritized over messages. Exponential backoff on failure (5s base, max 5 retries).

### Task Scheduler: `src/task-scheduler.ts`

| Function | Line | Purpose |
|----------|------|---------|
| `startSchedulerLoop()` | L245 | Poll DB every 60s, find due tasks, enqueue to GroupQueue |
| `computeNextRun()` | L31 | Next execution: cron (cron-parser), interval (+ms, skip missed), once (null) |
| `runTask()` | L78 | Spawn container with `isScheduledTask=true`, close after 10s result delay |

### IPC Watcher: `src/ipc.ts`

Polls `/data/ipc/{groupFolder}/` directories every 1s.

| Function | Line | Purpose |
|----------|------|---------|
| `startIpcWatcher()` | L30 | Scan messages/ and tasks/ dirs, process files, delete after |
| `processTaskIpc()` | L157 | Handle: schedule_task, pause/resume/cancel_task, update_task, refresh_groups, register_group |

**Authorization:** Main group can operate on any group. Non-main groups only on themselves. Identity derived from IPC directory path (not user-controlled).

**IPC file types:**
- `/data/ipc/{group}/messages/*.json` — `{ type: "message", text, sender? }`
- `/data/ipc/{group}/tasks/*.json` — `{ type: "schedule_task"|"pause_task"|..., ... }`
- `/data/ipc/{group}/input/*.json` — Follow-up messages to active container
- `/data/ipc/{group}/input/_close` — Graceful shutdown sentinel

### Message Router: `src/router.ts`

| Function | Line | Purpose |
|----------|------|---------|
| `formatMessages()` | L13 | Convert `NewMessage[]` to XML for agent prompt |
| `stripInternalTags()` | L34 | Remove `<internal>...</internal>` from output |
| `formatOutbound()` | L38 | Strip internal tags, return empty if nothing left |
| `findChannel()` | L54 | Find channel that owns a JID |

**XML format:**
```xml
<context timezone="America/Los_Angeles"/>
<messages>
  <message sender="Alice" time="Apr 4, 2026, 2:30 PM">
    Hello
  </message>
</messages>
```

### Database: `src/db.ts`

SQLite via `better-sqlite3`. File: `store/messages.db`.

**Schema:**

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `chats` | jid PK, name, channel, is_group | Chat metadata from all channels |
| `messages` | (id, chat_jid) PK, sender, content, timestamp | Conversation history for registered groups |
| `registered_groups` | jid PK, folder UNIQUE, trigger_pattern, is_main | Group configuration |
| `scheduled_tasks` | id PK, group_folder, schedule_type, next_run, status | Task definitions |
| `task_run_logs` | task_id FK, run_at, duration_ms, status | Execution history |
| `sessions` | group_folder PK, session_id | Container session tracking |
| `router_state` | key PK, value | Global state (cursors, timestamps) |

**Key query functions:**

| Function | Line | Purpose |
|----------|------|---------|
| `storeMessage()` | L286 | INSERT OR REPLACE message |
| `getNewMessages()` | L331 | Messages since timestamp across multiple JIDs |
| `getMessagesSince()` | L368 | Messages for single chat since timestamp |
| `getAllRegisteredGroups()` | L656 | All groups as `Record<jid, RegisteredGroup>` |
| `getDueTasks()` | L506 | Active tasks where `next_run <= now()` |
| `createTask()` | L407 | Insert scheduled task |
| `updateTaskAfterRun()` | L519 | Set next_run, last_run; mark completed if once |

### Configuration: `src/config.ts`

**Environment variables** (process.env > .env > defaults):

| Variable | Default | Purpose |
|----------|---------|---------|
| `ASSISTANT_NAME` | Romi | Bot display name |
| `ONECLI_URL` | http://localhost:10254 | Credential gateway |
| `CONTAINER_IMAGE` | nanoclaw-agent:latest | Agent container image |
| `CONTAINER_TIMEOUT` | 1800000 (30min) | Hard container timeout |
| `IDLE_TIMEOUT` | 1800000 (30min) | Container idle before reap |
| `MAX_CONCURRENT_CONTAINERS` | 5 | Parallel container slots |
| `MAX_MESSAGES_PER_PROMPT` | 10 | Context window per invocation |
| `POLL_INTERVAL` | 2000 | Message loop poll (ms) |
| `SCHEDULER_POLL_INTERVAL` | 60000 | Task scheduler poll (ms) |
| `TZ` | System/UTC | Timezone for scheduling |
| `WEB_PORT` | — | Web UI port (opt-in) |

**Trigger system:** `buildTriggerPattern(trigger)` creates regex `^{trigger}\b` (case-insensitive). Default: `@Romi`.

### Types: `src/types.ts`

| Interface | Purpose |
|-----------|---------|
| `Channel` | Channel contract: connect, sendMessage, isConnected, ownsJid, disconnect, setTyping?, syncGroups? |
| `RegisteredGroup` | name, folder, trigger, added_at, containerConfig?, requiresTrigger?, isMain? |
| `NewMessage` | id, chat_jid, sender, sender_name, content, timestamp, thread_id?, reply_to_* |
| `ScheduledTask` | id, group_folder, chat_jid, prompt, schedule_type, schedule_value, next_run, status |
| `ContainerConfig` | additionalMounts?, timeout? |
| `MountAllowlist` | allowedRoots[], blockedPatterns[], nonMainReadOnly |
| `OnInboundMessage` | `(chatJid, message) => void` callback |
| `OnChatMetadata` | `(chatJid, timestamp, name?, channel?, isGroup?) => void` callback |

### Channels: `src/channels/`

**Registry** (`registry.ts`): Factory pattern. Each channel calls `registerChannel(name, factory)` at import time. `index.ts` barrel-imports all channels.

**Channel implementations:**

| Channel | File | JID Prefix | Transport |
|---------|------|------------|-----------|
| Telegram | `telegram.ts` | `tg:` | Grammy Bot API (long-polling) |
| Web | `web.ts` | `web:` | HTTP server + SSE on localhost |

**`TelegramChannel`** (`telegram.ts`):
- Grammy `Bot` instance with `/chatid` and `/ping` commands
- Translates `@bot_username` mentions to trigger format
- Downloads photos/videos/documents to group attachments dir
- Splits messages at 4096 char Telegram limit

**`WebChannel`** (`web.ts`):
- HTTP server on `127.0.0.1:{WEB_PORT}`
- SSE at `/api/events` for real-time messages
- POST `/api/message` for sending
- GET `/api/status` returns channels, groups, tasks, chats
- Sidebar UI with dark/light theme toggle
- `setChannelsAccessor()` hook for status endpoint

### Security

**`mount-security.ts`** — Allowlist at `~/.config/nanoclaw/mount-allowlist.json` (outside project, never mounted).
- Default blocked: `.ssh`, `.gnupg`, `.aws`, credentials, `.env`, keys
- Per-root `allowReadWrite` flag
- Non-main groups forced read-only

**`sender-allowlist.ts`** — At `~/.config/nanoclaw/sender-allowlist.json`.
- Modes: `trigger` (message stored, trigger required) or `drop` (message silently rejected)
- Per-chat overrides

**`group-folder.ts`** — Path validation: `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`. Prevents traversal. Reserved name `global`.

### Other Utilities

| File | Purpose |
|------|---------|
| `logger.ts` | Color-coded leveled logging (debug/info/warn/error/fatal) |
| `env.ts` | `.env` parser that doesn't mutate `process.env` |
| `timezone.ts` | `isValidTimezone()`, `formatLocalTime()` |
| `remote-control.ts` | Spawns `claude remote-control` session, tracks PID |

---

## Container Side

### Dockerfile (`container/Dockerfile`)

Base `node:22-slim` with Chromium, agent-browser, claude-code globally installed.

**Entrypoint** (`/app/entrypoint.sh`):
```bash
set -e
cd /app && npx tsc --outDir /tmp/dist 2>&1 >&2
ln -s /app/node_modules /tmp/dist/node_modules
chmod -R a-w /tmp/dist
cat > /tmp/input.json
node /tmp/dist/index.js < /tmp/input.json
```

Recompiles TypeScript on every run (allows host to inject updated source via `/app/src` mount), then reads stdin JSON, runs agent.

### Agent Runner (`container/agent-runner/src/index.ts`)

**Input:** stdin JSON `ContainerInput` (prompt, sessionId, groupFolder, chatJid, isMain, assistantName)

**Output:** `---NANOCLAW_OUTPUT_START---` / `---NANOCLAW_OUTPUT_END---` wrapped JSON on stdout

**Flow:**
1. Parse stdin → `ContainerInput`
2. Clean stale `_close` sentinel
3. Drain pending IPC input messages into prompt
4. If `isScheduledTask` with `script`: run script first, only wake agent if `wakeAgent: true`
5. Query loop: `SDK query()` → wait for IPC message → query again → repeat until `_close`
6. Pre-compact hook archives transcripts to `conversations/` folder

**Key classes/functions:**
- `MessageStream` — Async iterable feeding SDK messages
- `runQuery()` — Calls `@anthropic-ai/claude-agent-sdk` `query()` with MCP server
- `createPreCompactHook()` — Saves conversation transcripts before context compaction
- `writeOutput()` — Emits OUTPUT_MARKER pair to stdout
- `waitForIpcMessage()` — Polls `/workspace/ipc/input/` for follow-up messages

### MCP Server (`container/agent-runner/src/ipc-mcp-stdio.ts`)

Runs as MCP server inside the container. Provides tools to the agent:

| Tool | Purpose | Authorization |
|------|---------|---------------|
| `send_message` | Immediate message delivery to chat | All groups |
| `schedule_task` | Create cron/interval/once task | All groups (own JID only for non-main) |
| `list_tasks` | Read current_tasks.json | All groups (filtered for non-main) |
| `pause_task` | Set status=paused | All groups (own tasks) |
| `resume_task` | Set status=active | All groups (own tasks) |
| `cancel_task` | Delete task | All groups (own tasks) |
| `update_task` | Modify prompt/schedule | All groups (own tasks) |
| `refresh_groups` | Sync channel group lists | Main only |
| `register_group` | Add new group | Main only |

Tools write JSON files to `/workspace/ipc/tasks/` which the host's IPC watcher processes.

### Container Skills (`container/skills/`)

Skill modules synced to each group's `.claude/skills/`:
- `agent-browser/` — Chromium automation
- `capabilities/` — Agent capability definitions
- `slack-formatting/` — Slack mrkdwn output rules
- `status/` — Status reporting

---

## Directory Structure

```
nanoclaw/
  src/                    # Host application
    index.ts              # Orchestrator
    container-runner.ts   # Container spawning
    container-runtime.ts  # Docker abstraction
    group-queue.ts        # Concurrency manager
    task-scheduler.ts     # Cron/interval/once tasks
    ipc.ts                # IPC file watcher
    router.ts             # Message formatting
    db.ts                 # SQLite operations
    config.ts             # Configuration
    types.ts              # Shared interfaces
    channels/
      registry.ts         # Channel factory registry
      index.ts            # Barrel import
      telegram.ts         # Telegram Bot API
      web.ts              # HTTP/SSE web UI
  container/
    Dockerfile            # Agent container image
    build.sh              # Build script
    agent-runner/
      src/index.ts        # Agent entry point
      src/ipc-mcp-stdio.ts # MCP tools server
    skills/               # Agent skill modules
  groups/
    global/               # Shared memory (read-only in containers)
    main/                 # Main group (if WhatsApp)
    {name}/               # Per-group: CLAUDE.md, conversations/, attachments/, logs/
  data/
    ipc/{group}/          # Per-group IPC: input/, messages/, tasks/
    sessions/{group}/     # .claude/ session data, agent-runner-src/
  store/
    messages.db           # SQLite database
```

## Design Principles

1. **Per-group isolation** — Each group has own folder, session, IPC namespace. Containers can't see other groups.
2. **Credential separation** — OneCLI gateway injects secrets at request time. Containers never see API keys. `.env` mounted as `/dev/null`.
3. **Fail-safe security** — Mount allowlist outside project. Path traversal prevention. IPC identity from directory path, not user input.
4. **Streaming output** — Marker-pair protocol allows multiple results per session. Idle containers stay warm for IPC follow-ups.
5. **Graceful lifecycle** — SIGTERM detaches containers (doesn't kill). Idle timeout reaps them. Cursor rollback on error (unless output already sent).
