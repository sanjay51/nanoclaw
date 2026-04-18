# Data Layer

SQLite schema, migrations, the task scheduler, and the on-disk layout. All paths relative to `/home/swebdev/personal-workspace/nanoclaw`.

## Where the database lives

- File: `store/messages.db` (`src/config.ts:50` — `STORE_DIR` resolves to `<repo>/store`)
- Init: `initDatabase()` at `src/db.ts:204-213` creates the schema (if missing) and runs migrations.
- On the **main group** container, this path is mounted at `/workspace/project/store` RW so the agent can read/write it. Non-main containers have no access.

## Tables

Schema defined in `createSchema()` at `src/db.ts:25-202`.

| Table | Key columns | Purpose |
|-------|-------------|---------|
| `chats` | `jid` (PK), `name`, `last_message_time`, `channel`, `is_group` | Chat metadata across channels |
| `messages` | `(id, chat_jid)` composite PK, `sender`, `content`, `timestamp`, `is_from_me`, `is_bot_message`, `reply_to_*` | Full conversation history |
| `registered_groups` | `jid` (PK), `folder` (UNIQUE), `trigger_pattern`, `is_main`, `requires_trigger`, `container_config`, `personality_id` | Groups that trigger the agent |
| `router_state` | `key` (PK), `value` | Global cursors (last_timestamp, last_agent_timestamp JSON) |
| `sessions` | `group_folder` (PK), `session_id` | Per-folder Claude session ids |
| `chat_sessions` | `chat_jid` (PK), `session_id` | Per-chat session ids (used for `web:*` where one group hosts many chats) |
| `scheduled_tasks` | `id` (PK), `group_folder`, `chat_jid`, `prompt`, `script`, `schedule_type`, `schedule_value`, `context_mode`, `next_run`, `last_run`, `status` | Scheduled task definitions |
| `task_run_logs` | `id` (AI), `task_id` (FK), `run_at`, `duration_ms`, `status`, `result`, `error` | Per-run history for tasks |
| `personalities` | `id` (PK), `name`, `instructions` | Assistant personalities (experimental — see GOTCHAS) |
| `credentials` | `id` (PK), `name`, `website`, `username`, `password_encrypted`, `notes` | Encrypted website credentials |

Indexes: `messages.timestamp`, `messages.reply_to_message_id`, `chats.last_message_time`, `scheduled_tasks.next_run`, `scheduled_tasks.status`, `task_run_logs(task_id, run_at)`.

## Migrations

**Additive, in-process, forgiving** (`src/db.ts:106-188`). Each migration is an `ALTER TABLE ADD COLUMN ...` wrapped in try/catch that swallows "duplicate column" errors. This makes them idempotent but silently hides other SQL errors — see GOTCHAS.

Tracked column additions include: `context_mode`, `script`, `is_bot_message` (with a content-prefix backfill), `is_main`, `channel`, `is_group`, `reply_to_*`, `personality_id`.

**JSON → SQLite migration** (`src/db.ts:1030-1088`): on first init, legacy `router_state.json`, `sessions.json`, and `registered_groups.json` are imported and renamed with `.migrated`. If you see `.json.migrated` files in `store/`, that's this step having run.

**No schema version column.** The migration set is "whatever code at this commit knows to ALTER." If you add a new column, add the corresponding ALTER IF NOT EXISTS + catch to `createSchema()`.

## Task scheduler (`src/task-scheduler.ts`)

**Supported schedule types** (`schedule_type` column):
- `once` — one-shot, fires at `next_run`, then `next_run = null` and status → completed
- `cron` — standard cron expression in `schedule_value`, parsed with the user's `TZ`
- `interval` — millisecond interval in `schedule_value`

**Next-run computation** (`computeNextRun()`, `src/task-scheduler.ts:32-64`):
- `cron`: next occurrence from `CronExpressionParser` with the configured timezone.
- `interval`: offsets from `next_run` by the interval, **skipping missed intervals** to prevent drift under clock skew or downtime.
- `once`: returns null.

**Firing decision** — polled, not event-driven (`startSchedulerLoop()`, `:260-303`):
1. `getDueTasks()` (`src/db.ts:572-583`) returns rows where `status = 'active'` AND `next_run <= now()`.
2. Each due task is enqueued on the appropriate `GroupQueue` (see `ARCHITECTURE.md`).
3. Loop sleeps until the next due time, capped by `SCHEDULER_POLL_INTERVAL` (60 s default, `src/config.ts:31`).

**Immediate re-poll:** `nudgeScheduler()` (`:253-258`) — called when a task is created/updated so the next check isn't delayed up to a minute.

**Context mode** — the `context_mode` column controls how much conversation state the scheduled task sees. Default `'isolated'`. Full semantics live in `docs/REQUIREMENTS.md:102-110`. If you touch this, verify the value with `SELECT context_mode FROM scheduled_tasks WHERE id = ?`.

## Groups: dual storage

- **Database:** `registered_groups` row — JID, folder name, trigger, config, flags.
- **Filesystem:** `groups/<folder>/` — group's working directory mounted into the container.
- **Session state:** `data/sessions/<folder>/.claude/` — Claude Code session for that group, mounted at `/home/node/.claude` in the container.

Folder name validation: alphanumeric + underscore only, via `src/group-folder.ts`.

## `data/` layout (on disk)

```
data/
├── env/
│   └── env                    # Mirrored env file for containers
├── ipc/
│   └── <folder>/
│       ├── messages/          # Host → container nudge files
│       ├── tasks/             # Task enqueue files
│       └── input/             # Live pipe to running container
└── sessions/
    └── <folder>/
        ├── .claude/
        │   ├── projects/      # Claude Code session history
        │   ├── backups/
        │   ├── plugins/
        │   ├── shell-snapshots/
        │   ├── session-env/
        │   ├── telemetry/
        │   └── skills/        # Copy of container/skills/ (synced per run)
        └── agent-runner-src/  # Per-group TS source copy, recompiled per run
```

## Groups ↔ channels cardinality

**1:many.** A single registered group can have multiple chat JIDs across channels (Telegram, Web, etc.), driven by the `chats` table's `channel` column. In practice most groups have one JID; web chats cluster several sessions under one group folder.

## Per-group `CLAUDE.md`

Lives inside the group's Claude session directory: `data/sessions/<folder>/.claude/CLAUDE.md`. This is what the agent reads as group-specific memory. Edit it by hand, or have the agent write to it during a conversation.

The project-root `CLAUDE.md` is separate and lives at the repo root.

## Uncertainties

- Personality updates via web API are unclear about their effect on active sessions — see GOTCHAS.
- The exact backfill logic for `is_bot_message` before the column existed is a content-prefix check (`src/db.ts:379-390`). If someone changes the prefix, older messages may be misclassified.
- Encryption of `credentials.password_encrypted` — the at-rest key source isn't documented locally. If you touch the credentials feature, trace the encryption path before touching data.
