---
name: romi-code-agent
description: Implementation instructions for NanoClaw code tasks. Extends the shared CODE-AGENT-CORE with NanoClaw-specific build, service, and container rules.
homepage: https://github.com/sanjay51/nanoclaw
---

# Romi Implementation Instructions

These are the rules to follow when implementing a task in NanoClaw. The orchestrator (`SKILL.md`) handles task pickup, review cycles, and shipping — this file covers the actual implementation work.

**Read `../code-assist-shared/CODE-AGENT-CORE.md` first.** That file has the git rules, scope discipline, cleanup, and general UI testing rules. This file only adds NanoClaw-specific items.

---

## NanoClaw Context

- **Repo root:** `/home/swebdev/personal-workspace/nanoclaw`
- **Primary docs:** `CLAUDE.md`, `README.md`, `CONTRIBUTING.md`, `docs/REQUIREMENTS.md`
- **Knowledge base:** `docs/knowledge/` in the NanoClaw repo — start with `docs/knowledge/INDEX.md` (host: `/home/swebdev/personal-workspace/nanoclaw/docs/knowledge/`; in-container main group: `/workspace/project/docs/knowledge/`)
- **Remote:** push to `origin` (`sanjay51/nanoclaw`). `upstream` (`qwibitai/nanoclaw`) is read-only unless explicitly requested.

## Before You Start — Load the Knowledge Base

The KB under `./knowledge/` is where the actual mental model of NanoClaw lives. Skipping it means working from guesses.

Every task:
1. **Read `docs/knowledge/INDEX.md`** and pick the KB files relevant to the task scope.
2. **Read those KB files in full** — don't skim. They include file:line citations to ground claims.
3. **Read `docs/knowledge/GOTCHAS.md`** regardless of task area.
4. **Read `CLAUDE.md`** at the repo root.
5. If the task adds/changes a skill: also read `CONTRIBUTING.md` and `docs/knowledge/SKILLS-SYSTEM.md`.
6. If the task touches a channel: also read the channel's SKILL.md under `.claude/skills/add-<channel>/`.

Then understand the task description, acceptance criteria, and any rework feedback from Phase 1.

## Build & Verify

- **TypeScript build:** `npm run build` — must pass cleanly.
- **Hot-reload dev:** `npm run dev` — use when iterating locally.
- **Type-check only:** `npx tsc --noEmit` if you want a fast check without emit.
- **No test suite runner for the whole repo** — verify changes by running the service and exercising the affected path. If a change is risky and untestable via messaging, ask for manual verification before shipping.

## Service Management

After **any** code or config change, restart the service:

```bash
# Linux (this machine)
systemctl --user restart nanoclaw

# macOS (if running there)
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

Verify it's healthy:
```bash
systemctl --user status nanoclaw
# or
journalctl --user -u nanoclaw -n 50 --no-pager
```

If the service fails to start, **don't ship** — investigate the logs and fix the root cause.

## Container Changes

If you modify anything under `container/` (including `container/skills/`):

1. Rebuild: `./container/build.sh`
2. If COPY steps look cached and stale, prune the buildkit first (see "Container Build Cache" in `CLAUDE.md`), then re-run `./container/build.sh`.
3. Restart the service so new container runs pick up the new image.

## Skill Changes (if the task touches `.claude/skills/` or `container/skills/`)

- **Feature skills** live on `skill/*` branches — do not edit them directly on `main`. Coordinate via the `/update-nanoclaw` flow.
- **Operational, utility, and container skills** live on `main` — edit directly.
- When adding a new skill, update the capabilities list and any relevant indices. Check `CONTRIBUTING.md` for the SKILL.md frontmatter format.

## Database Changes

NanoClaw uses SQLite (`src/db.ts`). If the task modifies the schema:

1. Check whether the change is backwards-compatible with existing data.
2. If it's a migration, add the migration logic in `src/db.ts` so existing installs upgrade cleanly.
3. Don't ship schema changes that would corrupt existing `data/nanoclaw.db` files.

## Secrets & Credentials

**Never read, print, commit, or log secrets.** NanoClaw uses OneCLI or the native credential proxy — treat `.env`, OneCLI vault contents, and any token-like strings as sensitive.

- Do not cat `.env` or OneCLI vault files.
- Do not include keys in commit messages, PR descriptions, or Telegram summaries.
- If a debug step would require a real credential, use a mock or stop and ask.

## Testing Channel Output

For tasks that change how messages render (WhatsApp, Telegram, Slack, Discord):

1. Restart the service.
2. Send a test message through the affected channel.
3. Screenshot the rendered output — that's the "UX review" for channel-rendering changes.
4. Include the screenshot in the Telegram completion summary.

## Cleanup Before PR (NanoClaw additions on top of shared rules)

Before `git status` check, also ensure:
- No committed `data/` files (user-local state — groups, sessions, DB).
- No committed logs or debug dumps.
- No `screenshots/` left over from a previous UX test.
- `.env*` files not staged.
