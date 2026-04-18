# Gotchas

Read this **every task**. These are pitfalls that have bitten people before or that the code goes out of its way to work around. Each entry: what, where, why, how to avoid.

---

## 1. Container buildkit cache is sticky

**Where:** `container/Dockerfile`, `./container/build.sh`; noted in project `CLAUDE.md:84-86` and `.claude/skills/debug/SKILL.md:240-242`.

**What goes wrong:** Buildkit caches the build context volume aggressively. `--no-cache` alone does **not** invalidate COPY steps when files under `container/agent-runner/` or `container/skills/` change — you'll build a new image that still has stale skill/runner code.

**How to avoid:** When in doubt, `docker buildx prune -af` (or `docker builder prune -af`) first, then `./container/build.sh`. After build, restart running containers so the next agent spawn uses the new image.

---

## 2. WhatsApp re-auth required after upgrade

**Where:** project `CLAUDE.md:81-82`.

**What goes wrong:** WhatsApp is now a separate feature skill rather than bundled in core. After a major upgrade the channel can stop connecting.

**How to avoid:** Run `/add-whatsapp` to reinstall. Existing auth in `store/auth/creds.json` and registered groups are preserved — this is a code merge, not a wipe.

---

## 3. `.env` is deliberately shadowed inside the main-group container

**Where:** `src/container-runner.ts:88-93` mounts `/dev/null` over `/workspace/project/.env` for the main group.

**What goes wrong if you "fix" it:** You leak every credential to the agent. The shadow is load-bearing — credentials flow through OneCLI (`NANOCLAW_CREDENTIALS_URL`) on demand, not via `.env`.

**How to avoid:** Don't un-shadow. If the agent needs a secret, expose it via the credentials API and let OneCLI mediate.

---

## 4. Message history is capped per prompt

**Where:** `src/index.ts:312, 655, 734`; `src/config.ts:66-69`. Commit `c98205c` introduced this.

**What goes wrong without it:** The agent's prompt balloons with full history, the Claude API truncates or errors, and costs climb.

**How to avoid:** Respect `MAX_MESSAGES_PER_PROMPT` (default 10). If a feature needs more context, fetch it deliberately inside the agent rather than stuffing it into the prompt.

---

## 5. Mount allowlist silently blocks missing entries

**Where:** `src/mount-security.ts:48-68`. Allowlist file at `~/.config/nanoclaw/mount-allowlist.json`.

**What goes wrong:** A mount that's not on the allowlist is dropped with a log warning — **not** an error. A user's `--mount` config can be silently ignored.

**How to avoid:** When the agent reports "the file isn't there," check the logs for "Mount allowlist not found" or "not allowed." Add the path to the allowlist or instruct the user to.

---

## 6. Symlinks are resolved before mount validation

**Where:** `src/mount-security.ts:134-140` (`getRealPath`), `:185-187` (`findAllowedRoot`).

**What goes wrong:** If a user symlinks `~/projects` → `/tmp/secrets`, the validator sees `/tmp/secrets`. A benign-looking allowlist entry can expose somewhere else.

**How to avoid:** Document allowlist entries in real-path terms, not symlinks. When reviewing an allowlist change, resolve symlinks before approving.

---

## 7. Sessions live at `/home/node/.claude`, not `/root/.claude`

**Where:** `src/container-runner.ts:176`.

**What goes wrong:** If you change the mount target to `/root/.claude` (the old default), Claude Code inside the container writes to the wrong place, loses session continuity, and doubles disk usage.

**How to avoid:** Leave the target as `/home/node/.claude`. If the container image changes its default user, update this mount at the same time.

---

## 8. DB migrations silently swallow ALTER TABLE errors

**Where:** `src/db.ts:106-188` — each migration is a try/catch that ignores failures.

**What goes wrong:** Columns are missing in production because a real syntax error was hidden by the catch. You discover it when a query fails in a way that doesn't name the missing column.

**How to avoid:** When adding a migration, run it on a dry DB and verify the column appears: `sqlite3 store/messages.db '.schema <table>'`. If you see unexpected missing columns at runtime, that's almost always this.

---

## 9. `is_bot_message` has a content-prefix backfill

**Where:** `src/db.ts:379-390` (test comment), `:383` (backfill migration).

**What goes wrong:** Before the `is_bot_message` column existed, bot messages were identified by a content prefix. If the prefix format changes, legacy messages get reclassified. The main loop filters on this flag to avoid replying to itself.

**How to avoid:** Don't change the bot-message prefix. If you must, write a migration that updates `is_bot_message` in-place for legacy rows first.

---

## 10. Sender allowlist is cached until process restart

**Where:** `src/sender-allowlist.ts` (similar caching pattern shown in `src/mount-security.ts:17-18`).

**What goes wrong:** You add a sender to `~/.config/nanoclaw/sender-allowlist.json`, it still gets dropped.

**How to avoid:** After any allowlist change, `systemctl --user restart nanoclaw` (or `launchctl kickstart -k gui/$(id -u)/com.nanoclaw` on macOS). This is rule #3 in the project `CLAUDE.md` — restart after changes.

---

## 11. Personalities feature is experimental

**Where:** `src/db.ts:97-103` (table), `:183` (FK on `registered_groups.personality_id`). Referenced in `src/ipc.ts:642`.

**What goes wrong:** The table exists and some endpoints reference it, but the feature is not fully documented in CLAUDE.md/README. Behavior when changing a group's personality mid-session is unclear — may or may not clear the session.

**How to avoid:** Treat as internal until documented. Don't build new features on top of it without tracing the full path.

---

## 12. Scheduler poll interval is 60 s; nudge if you need immediacy

**Where:** `src/task-scheduler.ts:253-258` (`nudgeScheduler`), `:260-303` (`startSchedulerLoop`).

**What goes wrong:** You create a task with `next_run` "now" and wait up to a minute for it to fire.

**How to avoid:** Call `nudgeScheduler()` after creating or updating a task. The IPC task-enqueue path does this automatically (`src/ipc.ts:382-387`).

---

## 13. Cursor advance happens before the container spawn

**Where:** `src/index.ts:374-376, 462-470, 607`.

**What goes wrong:** The message cursor moves forward **before** the container runs. If the container crashes before any output is emitted, the code rolls the cursor back. If output was already streamed, the cursor stays advanced to avoid duplicate replies.

**How to avoid:** If you change the retry/error path, preserve this invariant. A premature rollback after partial output will spam the user; a missing rollback after a hard crash will skip their message.

---

## 14. Group queue: one container per group, five total

**Where:** `src/group-queue.ts:73-83, 205, 229`; `src/config.ts:78-80`.

**What goes wrong:** Users see "nothing happened" for a minute because 5 groups are already active and theirs is waiting. There's no user-facing "queued" signal today.

**How to avoid:** If you're tuning throughput, raise `MAX_CONCURRENT_CONTAINERS`. If you're debugging apparent hangs, check the group queue state first. Tasks beat messages within a group's priority.

---

## 15. Container stdout is sentinel-delimited JSON — don't plain-log

**Where:** `src/container-runner.ts:37-38, 404-434`; `container/agent-runner/src/index.ts:192-199`.

**What goes wrong:** Plain `console.log` output from the agent-runner pollutes the parser and can get misread as agent output.

**How to avoid:** Inside `container/agent-runner/`, anything that isn't a sentinel-wrapped JSON payload should go to stderr, not stdout.

---

## 16. IPC is file-based — atomic rename, not partial write

**Where:** `src/ipc.ts`; `data/ipc/<folder>/{messages,tasks,input}`.

**What goes wrong:** Two processes writing to the same IPC file can clash. The expected pattern is write-to-temp then rename, which is atomic on POSIX filesystems.

**How to avoid:** If you write IPC files from another tool, use `write + rename`, never append. Ack files have a 60 s TTL (`src/ipc.ts:85-102`) — don't wait longer than that to process them.

---

## 17. `docker` is hardcoded; Apple Container path is partial

**Where:** `src/container-runtime.ts:11`.

**What goes wrong:** `/convert-to-apple-container` exists as a user skill, but the core runtime still assumes `docker`. Features that call into Apple Container-specific behavior will need code changes.

**How to avoid:** If a task asks for Apple Container support, budget time for the switch — it's not a one-line env change. Verify each call site to `container-runtime.ts`.

---

## 18. `skill/*` feature code must not land on `main`

**Where:** `CONTRIBUTING.md` (skill branches); `/update-nanoclaw` skill.

**What goes wrong:** Committing feature implementation directly to `main` instead of the `skill/<name>` branch causes conflicts on every upstream sync and breaks selective adoption for other users.

**How to avoid:** Setup instructions (SKILL.md) live on `main`. Implementation code lives on `skill/<name>`. If you're unsure whether a change is "setup" or "implementation," ask before pushing.
