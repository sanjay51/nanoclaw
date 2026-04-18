# Containers

How the agent container is built, spawned, mounted, credentialed, and cleaned up. All paths relative to `/home/swebdev/personal-workspace/nanoclaw`.

## Runtime

Docker-only in code today: `src/container-runtime.ts:11` hardcodes `CONTAINER_RUNTIME_BIN = 'docker'`. A Linux host-gateway detection pass at `src/container-runtime.ts:14-20` ensures `host.docker.internal` resolves.

Apple Container / Podman support exists as `/convert-to-apple-container` (a user skill) but is not yet first-class in the runtime layer. Treat as experimental and verify before assuming.

## Image (`container/Dockerfile`)

- **Base:** `node:22-slim` (`container/Dockerfile:4`)
- **System packages** (`:7-27`): Chromium, CJK + emoji fonts, `libgbm1`, `libnss3`, `libgtk-3-0`, `libx11-xcb1`, `libxcomposite1`, `libxdamage1`, `libxrandr2`, `libasound2`, `libpangocairo-1.0-0`, `libcups2`, `libdrm2`, `libxshmfence1`, plus `curl` and `git`
- **Global npm packages** (`:34`): `agent-browser` and `@anthropic-ai/claude-code`
- **Agent-runner source** (`:40, 46`): `COPY agent-runner/package*.json` then `COPY agent-runner/`
- **Workspace directories** (`:52`): `/workspace/group`, `/workspace/global`, `/workspace/extra`, `/workspace/ipc/{messages,tasks,input}`
- **Entrypoint** (`:54-58`): a bash script that compiles the TypeScript agent-runner to `/tmp/dist`, symlinks node_modules read-only, reads JSON from stdin, and invokes the compiled runner.

Build: `./container/build.sh`. Image tag defaults to `nanoclaw-agent:latest` (configurable via first arg and `CONTAINER_RUNTIME` env).

**Build cache gotcha:** Buildkit keeps the build context volume around. `--no-cache` alone does not invalidate COPY steps. When you change files under `container/agent-runner/` or `container/skills/` and the image still looks stale, run `docker buildx prune -af` first, then `./container/build.sh`. See also `GOTCHAS.md`.

## Spawning a container

`runContainerAgent()` at `src/container-runner.ts:315-709` is the single entry point. It builds mounts + env + args, spawns the container, pipes a JSON prompt into stdin, and parses sentinel-delimited JSON outputs from stdout. See `ARCHITECTURE.md` for the full lifecycle.

`ContainerInput` (`src/container-runner.ts:40-49`) shape: `prompt`, `sessionId`, `groupFolder`, `chatJid`, `isMain`, `isScheduledTask`, `assistantName`, `script`.

## Mounts (`buildVolumeMounts`, `src/container-runner.ts:64-236`)

| Host | Container | Mode | When |
|------|-----------|------|------|
| `process.cwd()` (repo root) | `/workspace/project` | RO | Main group only. `.env` **shadowed with `/dev/null`** so secrets don't leak (`:88-93`). |
| `<repo>/store` | `/workspace/project/store` | RW | Main only. Lets the main-group agent touch the SQLite DB. |
| `<repo>/groups/<folder>` | `/workspace/group` | RW | Every group. Working directory. |
| `<repo>/groups/global` | `/workspace/global` | RO | Non-main groups only. Shared read-only context. |
| `<repo>/data/sessions/<folder>/.claude` | `/home/node/.claude` | RW | **Critical path** — not `/root/.claude`. `src/container-runner.ts:176`. Per-group Claude Code session state. |
| `<repo>/data/ipc/<folder>` | `/workspace/ipc` | RW | Per-group IPC files (messages/tasks/input). |
| `<repo>/data/sessions/<folder>/agent-runner-src` | `/app/src` | RW | Per-group copy of agent-runner TS source, recompiled per run. |
| Allowlisted user mounts | user-specified | user-specified | Validated via `~/.config/nanoclaw/mount-allowlist.json` (`src/mount-security.ts`). See GOTCHAS. |

## Environment variables passed to the container

`buildContainerArgs()` at `src/container-runner.ts:238-312`:

| Var | Source | Purpose |
|-----|--------|---------|
| `TZ` | `TIMEZONE` config | Local timezone for scheduling |
| `CHROME_MCP_URL` | `http://host.docker.internal:<CHROME_MCP_PORT>/mcp` | Browser automation MCP |
| `NANOCLAW_CREDENTIALS_URL` | `http://host.docker.internal:<WEB_PORT>/api/internal/credentials` | On-demand credential fetch |
| `NANOCLAW_PERSONALITIES_URL` | `http://host.docker.internal:<WEB_PORT>/api/internal/personalities` | Personalities API |
| `NO_PROXY` / `no_proxy` | `host.docker.internal,localhost,127.0.0.1` | Bypass proxy for local calls |
| `--user <uid>:<gid>` | Host uid/gid unless 0 or 1000 | File ownership match |

**OneCLI credential gateway** args are appended by `onecli.applyContainerConfig()` (`src/container-runner.ts:276-287`). The gateway intercepts outbound credential requests and injects the real secrets — no raw API keys ever hit the container. If OneCLI is unreachable at spawn time, the call logs a warning (`:283-286`) and the container runs without a credential proxy. Use `/init-onecli` or `/use-native-credential-proxy` to configure.

## Agent invocation inside the container

`container/agent-runner/src/index.ts:1-50` is the entry. It:
1. Reads JSON from stdin → `ContainerInput`.
2. Calls Claude Agent SDK `query()` with `cwd: /workspace/group`, allowed tools, bypass-permissions mode, MCP server config.
3. Streams assistant output wrapped in sentinel markers.

**Output format** (`container/agent-runner/src/index.ts:192-199`):
```
---NANOCLAW_OUTPUT_START---
{ ...JSON payload... }
---NANOCLAW_OUTPUT_END---
```
One payload per output — the container may emit many in a single run. The host's stdout parser reads them incrementally (`src/container-runner.ts:404-434`). Maximum total stdout size is capped at `CONTAINER_MAX_OUTPUT_SIZE` (default 10 MB, `:390-401`).

## Container skills (synced into every container)

`container/skills/` is mounted/synced into `/home/node/.claude/skills/` per group (`src/container-runner.ts:163-173`). Current skills include:

| Skill | Role |
|-------|------|
| `agent-browser` | Playwright/Chromium automation |
| `capabilities` | Lists what the agent can do |
| `image`, `image-gen` | Image handling + generation |
| `send-email` | Email send primitive |
| `slack-formatting` | Markdown → mrkdwn converter |
| `status` | Agent status reporting |
| `code-assist-shared` | Shared code-assist module (this project's) |
| `reco-code-assist`, `romi-code-assist`, `reco-assist`, `marketing-assist`, `reco-marketer` | Product-specific skills |

## Timeout and cleanup

Hard timeout (`src/container-runner.ts:459-541`): `max(config.timeout || CONTAINER_TIMEOUT, IDLE_TIMEOUT + 30s)`.
- Graceful stop via `stopContainer()` (`:472-473`).
- SIGKILL fallback (`:479`).
- If output was streamed before timeout → treated as success (`:514-526`).
- Else → real error, logs written.

On exit (`src/container-runner.ts:491-708`): logs go to `groups/<folder>/logs/container-<timestamp>.log` (`:543-608`). Orphaned containers from prior crashes are cleaned up on startup (`src/container-runtime.ts:78-102`).

## When to rebuild the container

You **must** rebuild (`./container/build.sh`) if you change:
- `container/Dockerfile`
- `container/agent-runner/` source (anything under it)
- `container/skills/` (new/modified skills)

You **don't** need to rebuild for changes to:
- `src/**` (host-side — hot-reload via `npm run dev`, or restart the service)
- `groups/**`, `data/**` (runtime data)
- `.claude/skills/**` (these run on the host, not inside the container)

If you're unsure whether the image picked up your change, the buildkit cache is likely stale — prune and rebuild (see gotchas).

## Uncertainties

- `--user <uid>:<gid>` behavior when host uid is exactly 0 or 1000 — the code branches around this but the full rationale isn't documented locally. If you touch mount ownership, trace `src/container-runner.ts:238-312` end-to-end.
- Legacy non-streaming path (`:648-693`) extracts the last marker pair from the full stdout — confirm whether any calling code still relies on it before deleting.
