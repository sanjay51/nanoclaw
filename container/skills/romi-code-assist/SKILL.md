---
name: romi-code-assist
description: "End-to-end orchestrator for NanoClaw development. Auto-picks the highest-priority GitHub issue labeled `delegate-to-ai`, implements it via romi-code-agent, runs 3-round code review via code-reviewer, performs UX testing if UI is involved, raises a PR, and sends a completion summary to Telegram. Use this skill whenever someone says pick up the next NanoClaw task, work on Romi, run the Romi pipeline, implement the next NanoClaw feature, what's next on NanoClaw, or any reference to automating NanoClaw development end-to-end. Also trigger when a task status is Needs Rework or Check Comments."
homepage: https://github.com/sanjay51/nanoclaw
---

# romi-code-assist

Orchestrates the full NanoClaw development pipeline: task pickup → implementation → code review → UX review (if UI) → PR → notification. Romi (the NanoClaw assistant) uses this to ship its own codebase. Delegates each phase to the shared code-assist module rather than duplicating the logic.

## Product Context

- **Product:** NanoClaw — personal Claude assistant with skill-based channel system (WhatsApp, Telegram, Slack, Discord, Gmail)
- **Repository:** `/home/swebdev/personal-workspace/nanoclaw`
- **GitHub repo:** `sanjay51/nanoclaw` — https://github.com/sanjay51/nanoclaw
- **Upstream:** `qwibitai/nanoclaw` (do not PR to upstream unless explicitly asked)
- **Tech stack:** Node.js, TypeScript, SQLite, Claude Agent SDK, container runtime (Docker / Apple Container)
- **Convention file:** Always ensure Claude reads `CLAUDE.md` in the repo root before touching any code
- **Task source:** GitHub issues on `sanjay51/nanoclaw` labeled `delegate-to-ai` (no Projects board)

## The Pipeline

Five phases run in strict order. Each phase must complete cleanly before the next. Canonical phase instructions live in `../code-assist-shared/PIPELINE.md` — read it fresh each run.

### Phase 1: Pick Up a Task

NanoClaw uses **GitHub issue labels** instead of a Projects board.

**For new work:**
1. `gh issue list --repo sanjay51/nanoclaw --label delegate-to-ai --state open --json number,title,body,labels` — filter and sort by any priority labels (`priority:high`, `priority:medium`, `priority:low`).
2. Pick the highest-priority unclaimed issue. An issue is "claimed" if it has an `in-progress` label or an open PR linked to it.
3. If none qualify, reply `HEARTBEAT_OK` and stop.
4. Add the `in-progress` label to the issue: `gh issue edit <number> --add-label in-progress --remove-label delegate-to-ai`.

**For rework** (issue has `needs-rework` or `check-comments` label):
1. Find the issue with that label.
2. Read feedback from ALL THREE sources (don't skip any):
   - PR conversation: `gh pr view <number> --comments`
   - PR file comments: `gh api repos/sanjay51/nanoclaw/pulls/<number>/comments`
   - GitHub issue comments: `gh issue view <number> --comments`
3. Compile every piece of feedback into a clear list for Phase 2.

**Output:** task description, acceptance criteria, and (for rework) the full feedback list.

---

### Phase 2: Implement (follow CODE-AGENT.md)

Read and follow `CODE-AGENT.md` in this skill folder. Core rules live in `../code-assist-shared/CODE-AGENT-CORE.md`.

**Before touching any code, load the knowledge base:**

The KB lives in the NanoClaw repo at `docs/knowledge/` (not inside this skill). Resolved absolute path depends on where you're running:
- **Host (Claude Code):** `/home/swebdev/personal-workspace/nanoclaw/docs/knowledge/`
- **Inside the agent container (main group):** `/workspace/project/docs/knowledge/`

1. **Read `docs/knowledge/INDEX.md`** — it's the navigation map. Identify which area(s) the task touches and read the relevant KB file(s) in full.
2. **Always read `docs/knowledge/GOTCHAS.md`** regardless of task — many pitfalls apply across areas.
3. **Always read `CLAUDE.md`** at the repo root for project-level conventions.
4. **Read `CONTRIBUTING.md`** before adding or modifying skills — it covers the four skill types and PR requirements.

KB files (at `docs/knowledge/` in the NanoClaw repo):

| File | Read when task involves… |
|------|--------------------------|
| `ARCHITECTURE.md` | Message loop, orchestrator, IPC, container invocation, retry/cursor logic |
| `CHANNELS.md` | Channels, routing, formatting, main-channel behavior, message normalization |
| `CONTAINERS.md` | Dockerfile, mounts, env vars, agent-runner, OneCLI, timeout/cleanup |
| `DATA.md` | SQLite schema, migrations, scheduler, group folder layout, `data/sessions/` |
| `SKILLS-SYSTEM.md` | Any skill change; `skill/*` branch model; installing a feature skill |
| `CONVENTIONS.md` | Code style, lint, tests, commit/PR format, restart discipline |
| `GOTCHAS.md` | **Every task** |

NanoClaw-specific build/run notes:

- Build: `npm run build` (TypeScript compile) — must pass.
- Dev/lint: `npm run dev` runs with hot reload; `systemctl --user restart nanoclaw` after any host-side change.
- Container changes (anything under `container/`): rebuild with `./container/build.sh`. Prune the buildkit first if COPY steps look stale (see `knowledge/GOTCHAS.md` #1).

For rework: address every piece of feedback from Phase 1.

---

### Phase 3: Code Review

Run the 3-round self-review cycle against `../code-assist-shared/CODE-REVIEWER.md` (read fresh — the pattern list grows).

- **Round 1 — Bugs & Logic**
- **Round 2 — Security & Performance**
- **Round 3 — User Experience**

Each round that finds issues → fix → re-run that round. All three must pass clean.

Also enforce: no duplicate code, no dead code, no test scripts left behind.

---

### Phase 4: UX Review (conditional)

**Skip this phase entirely for NanoClaw backend / skill / channel / config changes** — NanoClaw has no web UI. Most tasks will skip Phase 4.

Run Phase 4 only if the task touches a user-facing surface, for example:
- Channel output formatting (WhatsApp/Telegram/Slack rendering) — if so, test via the actual channel
- A future web dashboard or admin UI

When Phase 4 applies, follow `UX-REVIEWER.md` in this skill folder (references `../code-assist-shared/UX-REVIEWER-CORE.md`).

For channel-output formatting changes, "UX review" means sending test messages through the actual channel and screenshotting the rendered output.

---

### Phase 5: Ship It

1. **Commit and push** all changes to the PR branch.
2. **Create or update the PR** on `sanjay51/nanoclaw` with a clear title and description. Include `Closes #<issue>`.
3. **Set the issue labels**: remove `in-progress`, add `in-review`.
4. **Link the PR** in an issue comment if not auto-linked.
5. For rework: **reply to each feedback comment** on the PR/issue explaining what was changed.
6. **Restart the service** if code changes are merged locally: `systemctl --user restart nanoclaw`. (Do this after merge, not before — user may want to review first.)
7. **Send the completion summary to Telegram** (format below).

---

## Completion Summary Format (Telegram)

```
🐶 Romi Task Complete: [Task Title]

📋 Changes Made:
- [Brief list — files, features, fixes]

🔍 Code Review:
- Round 1 (Bugs): [found/fixed or clean]
- Round 2 (Security): [found/fixed or clean]
- Round 3 (UX): [found/fixed or clean]

🎨 UX Review: [findings, or "N/A — no UI changes"]

🔗 PR: [link]

📸 [Attach final screenshot, if UI task]
```

---

## Handling Failures

See `../code-assist-shared/PIPELINE.md` for the full failure-handling matrix. NanoClaw-specific notes:

- **Service won't start after change:** check `journalctl --user -u nanoclaw -n 100` or `launchctl list | grep nanoclaw` on macOS. Don't ship if the service is broken.
- **Container build stale:** rebuild with `./container/build.sh`. If COPY steps look cached, prune the builder first.
- **Skill branch conflicts:** NanoClaw skills live on `skill/*` branches. If a task requires touching a skill branch, coordinate via `/update-nanoclaw` workflow rather than direct merging.

## Important Guardrails

- **Never push to `upstream` (qwibitai/nanoclaw)** — only `origin` (sanjay51/nanoclaw), unless explicitly asked.
- **Never skip phases.** Each phase catches different problems.
- **Read shared module files fresh** every run — `PIPELINE.md`, `CODE-REVIEWER.md`, `CODE-AGENT-CORE.md`, `UX-REVIEWER-CORE.md`.
- **Don't modify `CLAUDE.md` or `CONTRIBUTING.md`** unless the task explicitly calls for it.
- **Screenshots directory gets wiped per task** — only the current task's screenshots should exist.
