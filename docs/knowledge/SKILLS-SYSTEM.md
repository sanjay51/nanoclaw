# Skills System

Four types, where they live, how they load, and how the `skill/*` branch model works. All paths relative to `/home/swebdev/personal-workspace/nanoclaw`.

## The four types (from `CONTRIBUTING.md`)

| Type | Location | Storage model | Load time | Example |
|------|----------|---------------|-----------|---------|
| **Feature skill** | `.claude/skills/<name>/` on `main` | Pointer to a `skill/<name>` branch that carries the code | User runs `/<name>` → branch is merged into `main` | `/add-telegram`, `/add-slack`, `/add-whatsapp` |
| **Utility skill** | `.claude/skills/<name>/` with bundled code files | Self-contained in the skill dir | User invokes the skill; code runs on the host | `/claw` (Python CLI) |
| **Operational skill** | `.claude/skills/<name>/` on `main`, instructions only | No code beyond SKILL.md | User invokes; executes instructions via tools | `/setup`, `/debug`, `/customize`, `/update-nanoclaw`, `/init-onecli`, `/qodo-pr-resolver`, `/get-qodo-rules` |
| **Container skill** | `container/skills/<name>/` | Baked into the container image at build time | Runtime, inside every agent container | `agent-browser`, `slack-formatting`, `status`, `code-assist-shared`, `romi-code-assist`, `reco-code-assist` |

**Host vs container:**
- Host skills (`.claude/skills/`) run in Claude Code on the host — they can edit files, run shell commands, invoke other skills.
- Container skills (`container/skills/`) run inside the agent container — they shape the agent's behavior and tool access.

## `SKILL.md` frontmatter

Required fields:

```markdown
---
name: lowercase-alphanumeric-up-to-64-chars
description: When to invoke this skill. Claude uses this to decide auto-triggering.
---
```

Optional fields:
- `version: 1.0.0`
- `triggers: [regex-patterns]` — container skills
- `allowed-tools: [Tool1, Tool2]` — container skills (scopes the agent's tool access when the skill is active)
- `homepage: <url>`

Constraints (`CONTRIBUTING.md:96-114`):
- Keep SKILL.md under ~500 lines — offload detail to peer files
- No inline code — put scripts in separate files under the skill dir

## Feature skill installation flow

Running `/add-<channel>` does roughly this (exact steps live in each skill's SKILL.md):

1. **Preflight:** check if the integration code already exists (`src/channels/<name>.ts`). If yes, skip the merge and go to setup.
2. **Fetch + merge:** `git fetch <remote> <branch>` then `git merge <remote>/<branch>`, where the branch is `skill/<name>` on either `origin` (user's fork) or `upstream` (`qwibitai/nanoclaw`).
3. **Build:** `npm install && npm run build`.
4. **Setup:** interactive — prompt for bot token, register the main group, register secondary groups.
5. **Verify:** run the service, exchange a test message, confirm connectivity.

After merge, the branch code is just part of `main`. There's no runtime "feature skill loader" — `src/channels/index.ts` imports the module and `registerChannel()` self-registers.

## Container skill lifecycle

1. **Committed:** code lives in `container/skills/<name>/` on `main`.
2. **Baked:** `./container/build.sh` produces an image that includes these files.
3. **Synced at runtime:** `src/container-runner.ts:163-173` copies `container/skills/` into each group's `/home/node/.claude/skills/` at container startup — so per-group customizations are possible.
4. **Loaded by the agent:** Claude Agent SDK reads SKILL.md files from `/home/node/.claude/skills/` and integrates them into the agent's context.

If you change a container skill, **rebuild the image** (see `CONTAINERS.md` and `GOTCHAS.md`'s build-cache entry).

## The `skill/*` branch model

**Two branches for one feature:**
- `main` carries the **setup instructions** (SKILL.md) and any stable core code
- `skill/<name>` carries the **implementation code** (e.g., `src/channels/<name>.ts`, tests, index barrel updates)

Why split?
- Users can have a customized `main` without being forced to adopt every feature.
- Selective adoption: run `/add-feature` only for the features you want.
- Clean update path: `/update-nanoclaw` pulls upstream `main` without touching feature code you've opted into.

**Maintainer flow for new features** (for reference — see `CONTRIBUTING.md` for exact steps):
1. Contributor opens a PR to `qwibitai/nanoclaw` with the full change.
2. Once merged, the maintainer creates a `skill/<name>` branch from the PR commit.
3. `main` gets the setup-skill pointer at `.claude/skills/add-<name>/SKILL.md`.
4. User forks or pulls from upstream, sees the new setup skill on `main`, runs it when ready.

## `/update-nanoclaw`

Brings upstream `main` into a customized fork with minimal friction. Handles conflicts, validates the build, and doesn't touch your already-applied feature skills. See `.claude/skills/update-nanoclaw/SKILL.md`.

Run this before applying a new feature skill, so the skill branch merges against an up-to-date `main`.

## Touching skills — which branch to edit

| What you're changing | Branch |
|----------------------|--------|
| Operational skill SKILL.md (/setup, /debug, etc.) | `main` directly |
| Utility skill (add or edit) | `main` directly |
| Container skill (`container/skills/<name>/`) | `main` directly |
| Feature skill's SKILL.md (the setup instructions) | `main` directly |
| Feature skill's **implementation code** | The `skill/<name>` branch — not `main` |
| Adding a brand-new feature skill | Coordinate with the `/update-nanoclaw` flow and the maintainer — don't short-circuit the PR-then-branch pattern |

If you accidentally commit feature code to `main`, `/update-nanoclaw` will fight you on the next upstream sync. When in doubt, ask before pushing.

## Operational-skill slash commands (installed on `main`)

| Slash | Skill dir | Purpose |
|-------|-----------|---------|
| `/setup` | `setup/` | First-time install, auth channels, register main group, start service |
| `/debug` | `debug/` | Container logs, env vars, mount checks, common failure recipes |
| `/customize` | `customize/` | Interactive flow to add channels or modify behavior |
| `/update-nanoclaw` | `update-nanoclaw/` | Sync upstream changes with conflict handling |
| `/init-onecli` | `init-onecli/` | Install OneCLI gateway; migrate `.env` to vault |
| `/use-native-credential-proxy` | `use-native-credential-proxy/` | Simpler `.env`-based alternative to OneCLI |
| `/qodo-pr-resolver` | `qodo-pr-resolver/` | Fetch and fix Qodo PR review issues |
| `/get-qodo-rules` | `get-qodo-rules/` | Load org + repo coding rules from Qodo |
| `/claw` | `claw/` | Install the `claw` CLI for prompt-from-terminal |
| `/add-<channel>`, `/add-<integration>` | `add-*/` | Feature skills — merge code + run setup |
| `/update-skills` | `update-skills/` | Pull updates for installed feature-skill branches |

This list reflects the skills checked in now; new ones may appear on `main` as features land upstream.
