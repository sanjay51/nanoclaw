---
name: reco-code-assist
description: "End-to-end orchestrator for RecoCards.com development. Auto-picks the highest-priority GitHub task marked Delegate to AI, implements it via reco-code-agent, runs 3-round code review via code-reviewer, performs visual UX testing via ux-reviewer, raises a PR, and sends a completion summary to Telegram. Use this skill whenever someone says pick up the next task, work on Reco, run the pipeline, implement the next feature, whats next on the board, or any reference to automating RecoCards development end-to-end. Also trigger when a task status is Needs Rework or Check Comments."
homepage: https://github.com/users/sanjay51/projects/2/views/1
---

# reco-code-assist

Orchestrates the full RecoCards.com development pipeline: task pickup → implementation → code review → UX review → PR → notification. Delegates to the shared code-assist module rather than duplicating logic.

## Product Context

- **Product:** RecoCards.com — a recommendation cards platform
- **Repository:** `/Users/sanjay/personal-workspace/recocards.com`
- **GitHub Project Board:** https://github.com/users/sanjay51/projects/2/views/1
- **Tech stack:** Angular (standalone components, signals, Tailwind), Firebase/Firestore, Stripe
- **Convention file:** Always ensure Claude reads `CLAUDE.md` in the repo root before touching any code
- **Task source:** the GitHub Projects board above, filtered by **"Delegate to AI" = "Yes"**

## The Pipeline

Five phases in strict order. Canonical phase instructions live in `../code-assist-shared/PIPELINE.md` — read it fresh each run. The Reco-specific wiring below overrides the defaults where noted.

### Phase 1: Pick Up a Task

**For new work:**
1. Use `gh` CLI to read the project board at https://github.com/users/sanjay51/projects/2/views/1
2. Find tasks where **"Delegate to AI" = "Yes"** — ignore everything else.
3. Among those, pick the **highest-priority task** (top of the list).
4. If no tasks have "Delegate to AI" = Yes, reply `HEARTBEAT_OK` and stop.
5. Set the task status to **"In Progress"** on the board.
6. When a task is in Ready state, start from scratch on the `recocards` branch — do not look at existing branches or previous code.

**For rework** — follow the shared PIPELINE.md Phase 1 rework rules (all three feedback sources).

---

### Phase 2: Implement

Follow `CODE-AGENT.md` in this skill folder (which extends `../code-assist-shared/CODE-AGENT-CORE.md`).

---

### Phase 3: Code Review

Run the 3-round self-review cycle against `../code-assist-shared/CODE-REVIEWER.md` (read fresh every time — the pattern list grows).

All three rounds must pass clean. Also enforce: no duplicate code, no dead code, no test scripts left behind.

---

### Phase 4: UX Review

Runs if the task touches UI. Skip for backend-only or config-only changes.

Follow `UX-REVIEWER.md` in this skill folder (which extends `../code-assist-shared/UX-REVIEWER-CORE.md`).

---

### Phase 5: Ship It

Follow shared PIPELINE.md Phase 5. Reco-specific:
- **Set the task status** to **"In Review"** on the project board.
- **Add the PR link** to the task on the board.
- **Deploy to alpha** — after the PR is created and the board updated, run `npm run deploy-static-alpha` from the repo root to push the change to the alpha environment. This is mandatory for every task, not optional.
  - Run from the PR branch (the change you just shipped, not `main`).
  - **`npm run deploy-static-alpha` handles the build itself.** Do not run `npm run build`, `ng build`, or any other build command before or after the deploy — that's redundant and wastes time. Just run the one deploy command.
  - If the deploy fails, do not mark the task as complete — fix the failure or escalate. A successful PR with a failed deploy is still an unfinished task.
  - Capture the deploy command's final summary line (URL or version tag) for the Telegram summary.

---

## Completion Summary Format (Telegram)

Use the format in `../code-assist-shared/PIPELINE.md`. Title: `🚀 Task Complete: [Task Title]`.

Add a line below the PR link:

```
🚀 Alpha deploy: <result — URL/version, or "FAILED: <reason>">
```

---

## Handling Failures & Guardrails

See `../code-assist-shared/PIPELINE.md` for the full failure matrix and guardrails. Reco-specific additions:
- **Never mark a task "In Review" if the build is broken or reviews haven't passed.**
- **CODE-AGENT.md, CODE-REVIEWER.md, and UX-REVIEWER.md contain detailed instructions** — read them fresh for each task.
- **Screenshots directory gets wiped per task** — only the current task's screenshots should exist.
