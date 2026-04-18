# NanoClaw Knowledge Base — Index

This directory (`docs/knowledge/`) is the deep reference library for the NanoClaw codebase. It's consumed by the `romi-code-assist` skill and any other skill or tool that needs an accurate mental model of the system. Read the relevant file(s) **before** writing code — don't rely on memory.

All claims are grounded in real file paths and line numbers in the NanoClaw repo. If you find a discrepancy between a KB file and the code, **trust the code and update the KB** as part of your task cleanup.

Resolved paths:
- Host: `/home/swebdev/personal-workspace/nanoclaw/docs/knowledge/`
- In the agent container (main group only): `/workspace/project/docs/knowledge/`

## When to read each file

| File | Read before working on… |
|------|-------------------------|
| `ARCHITECTURE.md` | Message loop, orchestrator, IPC, container invocation, session/cursor state, retry logic |
| `CHANNELS.md` | Adding a channel, modifying routing/formatting, changing main-channel behavior, message normalization |
| `CONTAINERS.md` | Dockerfile changes, mounts, env vars, agent-runner, OneCLI credential flow, container timeout/cleanup |
| `DATA.md` | SQLite schema, migrations, task scheduler, group folder layout, `data/sessions/` layout |
| `SKILLS-SYSTEM.md` | Adding a skill (any type), modifying SKILL.md, changing skill-branch flow, installing a feature skill |
| `CONVENTIONS.md` | Any code change — style, naming, lint, commit format, test framework, restart discipline |
| `GOTCHAS.md` | **Read every task.** Known pitfalls and past incidents across all areas |

## Reading order for common task shapes

- **"Add channel X"** → `SKILLS-SYSTEM.md` § feature skills → `CHANNELS.md` → `GOTCHAS.md` → implement against `skill/*` branch
- **"Fix message routing"** → `ARCHITECTURE.md` → `CHANNELS.md` → `GOTCHAS.md`
- **"Change container mounts"** → `CONTAINERS.md` → `GOTCHAS.md` (mount allowlist, symlink resolution, .env shadow)
- **"Add a scheduled task feature"** → `DATA.md` § scheduler → `ARCHITECTURE.md` § group queue
- **"Modify DB schema"** → `DATA.md` → `GOTCHAS.md` (migration silent-catch, personalities WIP)
- **"Change a skill"** → `SKILLS-SYSTEM.md` → `CONVENTIONS.md` § commit format
- **"Debug something"** → `GOTCHAS.md` first, then the area-specific KB, then `.claude/skills/debug/SKILL.md`

## How to keep this KB fresh

- If you add a new subsystem, add an entry to `INDEX.md` and a KB file for it.
- If you discover a new gotcha in the wild, append it to `GOTCHAS.md` with a file:line cite.
- If you find a KB claim is stale (file moved, line changed), update the claim — don't leave the stale reference.
- The KB is descriptive of current state + enumerates pitfalls. Prescriptive rules ("do / don't") live in the shared code-assist module at `container/skills/code-assist-shared/CODE-REVIEWER.md`.
