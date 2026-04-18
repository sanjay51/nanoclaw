# Conventions

Code style, tooling, testing, and the discipline around restarts and PRs. All paths relative to `/home/swebdev/personal-workspace/nanoclaw`.

## TypeScript & modules

- **Strict mode on.** `tsconfig.json` has `"strict": true`, target ES2022.
- **ESM.** `package.json` declares `"type": "module"`; `tsconfig.json` uses `"module": "NodeNext"`. Import paths in source use `.js` extensions (NodeNext requirement): `import './channels/index.js'`.
- **Node 20+** required (`package.json` `engines.node`).
- **Build output** lands in `dist/`.

## File naming

- **Kebab-case** for source files: `group-queue.ts`, `container-runner.ts`, `sender-allowlist.ts`, `task-scheduler.ts`.
- **Tests co-located** with source: `group-queue.test.ts` sits next to `group-queue.ts`.
- Classes/types inside files use PascalCase; functions and vars use camelCase.

## npm scripts (`package.json`)

| Script | What it does |
|--------|--------------|
| `npm run dev` | Hot reload via `tsx src/index.ts` |
| `npm run build` | `tsc` compile to `dist/` |
| `npm run typecheck` | `tsc --noEmit` — fast check without emit |
| `npm run format` | Prettier write |
| `npm run format:check` | Prettier check (CI-safe) |
| `npm run lint` | ESLint on `src/` |
| `npm run lint:fix` | ESLint fix |
| `npm run test` | Vitest once |
| `npm run test:watch` | Vitest watch |
| `npm run setup` | Interactive setup flow |

## Linting + formatting

- **ESLint** configured via `eslint.config.js`. Rules worth knowing:
  - `@typescript-eslint/no-unused-vars` — prefix with `_` to suppress (e.g., `_unused`).
  - `preserve-caught-error` — catch clauses must keep the error binding.
  - `no-catch-all/no-catch-all` — warns on bare `catch (e)` with no context handling.
  - `@typescript-eslint/no-explicit-any` — warns, not errors. Prefer a real type.
- **Prettier** with `"singleQuote": true` in `.prettierrc`.
- **Husky** installed (`prepare` script). Hooks run on commit — don't bypass them without a reason.

Before any PR: `npm run format && npm run lint && npm run typecheck && npm run test`. If any of those fail, the PR isn't ready.

## Testing (Vitest)

- Pattern: `*.test.ts`, next to the source file.
- Vitest is ESM-native and fast — prefer it for any new test.
- `vi.mock()` for dependency mocks, `beforeEach` / `afterEach` for setup/teardown.
- **Fake timers** (`vi.useFakeTimers()`) are used for timing-sensitive concurrency tests — see `group-queue.test.ts` for a canonical example.
- Existing coverage emphasizes: routing, concurrency (group queue), container mount building, DB migrations, timezone parsing, IPC auth, formatting.

If your change touches one of those areas, extend the existing test file rather than making a parallel one.

## Logging

- **Pino-ish logger** in `src/logger.ts`. API is `logger.debug()`, `logger.info()`, `logger.warn()`, `logger.error()`.
- **Structured logs with a context object:** `logger.debug({ groupJid, identifier }, 'OneCLI agent ensured')`. Put IDs in the object, not the message.
- No `console.log` in source. Tests may use it sparingly.
- Inside `container/agent-runner/`, everything that isn't sentinel-wrapped output belongs on **stderr** (see GOTCHAS #15).

## Configuration

Central: `src/config.ts`. Env-driven. Adding a new knob:

1. Read it via `process.env.NAME` with a typed default.
2. Export a named constant (screaming snake case) or a typed getter.
3. If it's user-facing, mention it in `CLAUDE.md` or `README.md`.

Common env vars referenced throughout the code: `ASSISTANT_NAME`, `API_TOKEN`, `ONECLI_URL`, `TZ`, `WEB_HOST`, `WEB_PORT`, `CONTAINER_IMAGE`, `CONTAINER_TIMEOUT`, `MAX_MESSAGES_PER_PROMPT`, `CHROME_MCP_PORT`, `CHROME_CDP_URL`, `IDLE_TIMEOUT`, `MAX_CONCURRENT_CONTAINERS`, `POLL_INTERVAL`, `SCHEDULER_POLL_INTERVAL`, `TELEGRAM_BOT_TOKEN`.

## Restart discipline

**Always restart the service after code or config changes** — this is rule #3 in the project `CLAUDE.md`:

```bash
# Linux (this host)
systemctl --user restart nanoclaw

# macOS
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

Quick health check:
```bash
systemctl --user status nanoclaw         # Linux
journalctl --user -u nanoclaw -n 50      # Linux logs
```

If the service doesn't come back up, don't mark the task complete — investigate the logs.

## Container rebuild discipline

If your change is under `container/` (Dockerfile, `agent-runner/`, or `skills/`), you must run `./container/build.sh`. If COPY steps look stale, prune the buildkit first — see GOTCHAS #1.

## Commits + PRs

**Commit message style** (from recent `git log`):
- Conventional Commits: `fix:`, `feat:`, `style:`, `docs:`, `chore:`, `refactor:`
- Short, action-oriented subject line
- Examples from recent history: `fix: discover script handles legacy config`, `fix: Apple Container networking and .env mount`, `style: run prettier on container/agent-runner/src/`

**Branch model:**
- `main` — stable, always buildable.
- `skill/<name>` — per-feature implementation branches (see `SKILLS-SYSTEM.md`).
- Local/work branches — any naming, merge via PR.

**PR requirements** (`CONTRIBUTING.md`):
- One thing per PR.
- Link related issues: `Closes #123`.
- Check the appropriate label/checkbox in the PR template.
- Tests for anything non-trivial.
- For a NanoClaw PR, the Romi pipeline's Phase 5 also adds: update labels (`in-progress` → `in-review`), leave a summary comment, send Telegram summary.

## User-visible strings

Mostly inline English. A few constants in `src/config.ts` (e.g., `ASSISTANT_NAME` defaulting to `"Romi"`). No i18n layer today. If a feature needs localization, that's a separate design conversation — don't bolt it on.

## Security-sensitive paths

These deserve extra care; read the relevant KB file before touching:

- `src/mount-security.ts` — allowlist validation, symlink resolution (GOTCHAS #5, #6)
- `src/container-runner.ts:88-93` — `.env` shadow (GOTCHAS #3)
- `src/db.ts` credentials table — encrypted secrets (DATA.md uncertainties)
- `src/ipc.ts` — IPC ack/command protocol
- OneCLI integration in `src/container-runner.ts:276-287`

Any change here should land with test coverage and an explicit note in the PR description.
