# Architecture

How NanoClaw receives a message, decides what to do with it, spawns the agent container, and streams the response back. Grounded in code paths at `/home/swebdev/personal-workspace/nanoclaw`.

## Process shape

Single Node.js process (`src/index.ts`) launched by systemd/launchd. It:
1. Initializes SQLite (`src/db.ts`) and loads persisted state (`src/index.ts:177-191`).
2. Loads channel modules via the barrel file `src/channels/index.ts` — each channel self-registers (`src/channels/registry.ts:18`).
3. Calls `connect()` on every successfully registered channel.
4. Starts three concurrent loops: **message loop**, **IPC watcher**, **task scheduler**.

## The main message loop

**Poll-based, not reactive.** `startMessageLoop()` at `src/index.ts:579-722` runs forever with interval `POLL_INTERVAL` (default 2000 ms, `src/config.ts:30`).

Each tick:
1. `getNewMessages()` (`src/db.ts:373`) fetches rows newer than the in-memory cursor `lastTimestamp` (`src/index.ts:82`).
2. Messages are filtered by each group's trigger pattern, unless the group is `isMain` (no trigger required — `src/index.ts:318`).
3. Qualifying messages are enqueued per-group via `GroupQueue.enqueueMessageCheck(groupJid)` (`src/group-queue.ts:62-88`).
4. The cursor advances **before** the container is spawned (`src/index.ts:607`). If a critical error happens without any output, the cursor is rolled back to retry (`src/index.ts:462-470`).

## Per-group queue + global concurrency gate

`GroupQueue` (`src/group-queue.ts`) runs at most one container per group at a time, and at most `MAX_CONCURRENT_CONTAINERS` (default 5, `src/config.ts:78-80`) across the whole process.

State held per group (`GroupState`, `src/group-queue.ts:17-28`): `active`, `pendingMessages`, `pendingTasks[]`, `process`, `containerName`, `retryCount`.

Priority: **tasks > messages** inside a group (`src/group-queue.ts:291-301, 326-335`).

When a message arrives:
- If a container is already active for that group → set `pendingMessages = true` (`src/group-queue.ts:68`). It will be piped via the IPC input file (see below) or picked up in a follow-up spawn.
- Else if global `activeCount >= MAX_CONCURRENT_CONTAINERS` → add to waiting list (`src/group-queue.ts:73-83`).
- Else → spawn immediately (`src/group-queue.ts:85`).

Exponential backoff retries on container failure: up to 5 attempts, 5s → 10s → 20s → 40s → 80s (`src/group-queue.ts:263-284`).

## Message lifecycle (full path)

1. Channel receives an inbound message → calls the `onMessage` callback passed in `ChannelOpts` (`src/index.ts:819`).
2. Allowlist check (`src/index.ts:830-844`) — drops senders not on the sender allowlist if one is configured.
3. `storeMessage()` writes to the `messages` table (`src/db.ts:328`).
4. Main loop detects the new row (see above).
5. `GroupQueue.enqueueMessageCheck(groupJid)` routes the group to the per-group queue (`src/group-queue.ts:62-88`).
6. When the queue decides to spawn, it calls `runContainerAgent()` (`src/container-runner.ts:315-709`) with the prompt via stdin.
7. Container stdout is parsed for sentinel markers (`---NANOCLAW_OUTPUT_START---` / `---NANOCLAW_OUTPUT_END---`, `src/container-runner.ts:37-38, 404-434`). Each JSON payload between markers triggers `onOutput()`.
8. `onOutput()` (`src/index.ts:401-448`) stores the reply in DB (with `is_bot_message = true`), then calls `routeOutbound()` which fans out via `channel.sendMessage(jid, text)` (`src/router.ts:44`).
9. Non-web channels also broadcast their output to the Web channel via SSE (`src/index.ts:427-434`).
10. Container can emit multiple outputs; idle timer is reset each time (`src/index.ts:438`). After `IDLE_TIMEOUT` (default 30 min, `src/config.ts:77`) of silence, stdin is closed and the container exits.

## Group ↔ JID mapping

Primary source of truth: the `registered_groups` SQLite table (`src/db.ts:88-95`). Columns: `jid`, `name`, `folder`, `trigger_pattern`, `container_config`, `requires_trigger`, `is_main`, `personality_id`.

Loaded into memory on startup as `registeredGroups[]` (`src/index.ts:187`). Resolved per-message via `resolveHostGroup(chatJid)` (`src/index.ts:124-134`). Web-backed chats fall back to a shared web group that can host many chat JIDs (`src/index.ts:128-131`).

The `folder` field is the group's working directory (`groups/<folder>/`) and IPC namespace (`data/ipc/<folder>/`). Group folder names are validated alphanumeric-plus-underscore in `src/group-folder.ts`.

## `isMain` — the privileged group

Set once at registration (`src/types.ts:42`, stored in `registered_groups.is_main`, `src/db.ts:138-139`). Passed into the container via `ContainerInput.isMain` (`src/container-runner.ts:45`).

What `isMain` unlocks:
- **No trigger required** — every message is processed without needing `@Romi` (`src/index.ts:318`).
- **Project-root mount** — the main group container mounts the repo at `/workspace/project` (RO) + `store/` (RW) so the agent can read code and touch the DB.
- **Writable global folder** — non-main groups see `/workspace/global` as RO.

The main channel is where admin commands (`/schedule`, group registration, credential ops) are expected to originate.

## In-memory vs persisted state

**In-memory (lost on restart):**
- `lastTimestamp` — global message cursor (`src/index.ts:82`)
- `sessions[folder]` — cache of active Claude session IDs (`src/index.ts:83`)
- `registeredGroups[jid]` — group configs (`src/index.ts:84`)
- `messageLoopRunning` — process guard (`src/index.ts:86`)

**Persisted in SQLite (`store/messages.db`):**
- `router_state` — last cursors (`src/db.ts:76-79`)
- `sessions`, `chat_sessions` — Claude session IDs by folder / chat JID
- `messages` — full conversation history
- `registered_groups`, `scheduled_tasks`, `task_run_logs`, `chats`, `personalities`, `credentials`

**Recovery:** `loadState()` (`src/index.ts:177-191`) restores sessions and cursors. If `lastAgentTimestamp[jid]` is missing, it's recovered from `getLastBotMessageTimestamp()` (`src/index.ts:198-213`) so the bot resumes from the last reply it sent rather than re-answering old messages.

## IPC — file-based, poll-backed

`src/ipc.ts` watches three directories per group under `data/ipc/<folder>/`:
- `messages/` — host-to-container nudge files
- `tasks/` — task enqueue files
- `input/` — **live pipe** for adding a message to an already-running container (`src/group-queue.ts:160-178`)

The IPC watcher also handles host-facing commands like `register_group`, `schedule_task`, personality updates (`src/ipc.ts:560-598, 382-387`). IPC writes use atomic rename for safety. Acks live 60 s (`src/ipc.ts:85-102`).

## Streaming output

The container emits sentinel-delimited JSON payloads. `src/container-runner.ts:404-434` parses them off a rolling stdout buffer so each payload reaches the channel **before** the container exits. This gives users partial-output feedback for long-running work.

The idle timer resets on every payload (`src/index.ts:438`), keeping the container alive for follow-ups via the IPC input file. This is the closest NanoClaw comes to a "persistent conversation" inside a container — there is no keepalive ping.

## Timeout and crash handling

Hard timeout (`src/container-runner.ts:459-541`): `max(config.timeout || CONTAINER_TIMEOUT, IDLE_TIMEOUT + 30s)`.
- Graceful stop first (`src/container-runner.ts:472-473`).
- SIGKILL fallback (`src/container-runner.ts:479`).
- If output was already streamed, the timeout is treated as a clean idle exit — no error surfaced (`src/container-runner.ts:514-526`).
- If no output and no exit, a real timeout error is logged (`src/container-runner.ts:534-539`).

Session recovery (`src/index.ts:541-576`): if the session file is missing (ENOENT), the cached session id is cleared so the next attempt starts fresh (`src/index.ts:557-562`).

## Uncertainties

- Personality updates via web API (`src/ipc.ts:642`) — it is unclear whether changing the personality clears the active session. Confirm before building on this.
- Streaming `newSessionId` extraction (`src/container-runner.ts:418`) assumes agent-runner emits it; no cross-check done from this side.
- Apple Container runtime: the `/convert-to-apple-container` skill exists, but `src/container-runtime.ts:11` currently hardcodes `docker`. Treat Apple Container as experimental until proven.
