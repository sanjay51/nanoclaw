---
name: reco-code-assist
description: "End-to-end orchestrator for RecoCards.com development. Auto-picks the highest-priority GitHub task marked Delegate to AI, implements it via reco-code-agent, runs 3-round code review via code-reviewer, performs visual UX testing via ux-reviewer, raises a PR, and sends a completion summary to Telegram. Use this skill whenever someone says pick up the next task, work on Reco, run the pipeline, implement the next feature, whats next on the board, or any reference to automating RecoCards development end-to-end. Also trigger when a task status is Needs Rework or Check Comments."
homepage: https://github.com/users/sanjay51/projects/2/views/1
---

# reco-code-assist

Orchestrates the full RecoCards.com development pipeline: task pickup → implementation → code review → UX review → PR → notification. Delegates each phase to the appropriate specialist skill rather than doing the work directly.

## Product Context

- **Product:** RecoCards.com — a recommendation cards platform
- **Repository:** `/Users/sanjay/personal-workspace/recocards.com`
- **GitHub Project Board:** https://github.com/users/sanjay51/projects/2/views/1
- **Tech stack:** Angular (standalone components, signals, Tailwind), Firebase/Firestore, Stripe
- **Convention file:** Always ensure Claude reads `CLAUDE.md` in the repo root before touching any code.

## The Pipeline

This skill runs five phases in strict order. Each phase must complete successfully before the next begins. If any phase fails or surfaces issues, fix them before moving on — never skip a phase.

```
┌─────────────┐    ┌──────────────┐    ┌───────────────┐    ┌────────────┐    ┌────────────┐
│  1. PICK UP │ →  │ 2. IMPLEMENT │ →  │ 3. CODE REVIEW│ →  │ 4. UX TEST │ →  │ 5. SHIP IT │
│  (GitHub)   │    │ (CODE-       │    │ (CODE-REVIEWER.md) │    │ (UX-       │    │ (PR + TG)  │
│             │    │  AGENT.md)   │    │               │    │ REVIEWER.md│    │            │
└─────────────┘    └──────────────┘    └───────────────┘    └────────────┘    └────────────┘
```

---

### Phase 1: Pick Up a Task

Query the GitHub Projects board for the next task to work on.

**For new work:**
1. Use `gh` CLI to read the project board at https://github.com/users/sanjay51/projects/2/views/1
2. Find tasks where **"Delegate to AI" = "Yes"** — ignore everything else.
3. Among those, pick the **highest-priority task** (top of the list).
4. If no tasks have "Delegate to AI" = Yes, reply `HEARTBEAT_OK` and stop.
5. Set the task status to **"In Progress"** on the board.
6. When a task is in Ready state, you should start from scratch on `recocards` branch and not look onto any existing branches or previous code.

**For rework** (status is "Needs Rework" or "Check Comments"):
1. Find the task with that status.
2. Read feedback from ALL THREE sources — this is critical, don't skip any:
   - PR conversation: `gh pr view <number> --comments`
   - PR file comments: `gh api repos/{owner}/{repo}/pulls/{number}/comments`
   - GitHub issue comments: `gh issue view <number> --comments`
3. Compile every piece of feedback into a clear list for the implementation phase.

**Output of this phase:** A clear task description, acceptance criteria, and (for rework) the full list of feedback to address.

---

### Phase 2: Implement (follow CODE-AGENT.md)

Read and follow the instructions in **CODE-AGENT.md** for the implementation work. Key rules:

1. **Read `CLAUDE.md` in the repo root first** — always.
2. **Fresh branch from main** for new tasks. Same branch for rework.
3. **Build must pass** before moving on. If it fails, fix and re-run.
4. **Stay on scope** — no unrelated changes. If you discover other issues, create new backlog items with "AI Created" = Yes.
5. Clean up temp/debug files before proceeding.

For rework: address every single piece of feedback from Phase 1.

---

### Phase 3: Code Review (use CODE-REVIEWER.md)

Run the 3-round mandatory self-review cycle:

- **Round 1 — Bugs & Logic:** Check against all 21 patterns in `CODE-REVIEWER.md`. Find bugs, logic flaws, edge cases, error handling gaps. Revert any out-of-scope changes.
- **Round 2 — Security & Performance:** Injection, XSS, auth bypasses, N+1 queries, unnecessary re-renders. Verify every changed file is task-relevant.
- **Round 3 — User Experience:** UX issues from a user's perspective — confusing flows, missing feedback, poor errors, accessibility. Final diff check — every changed line must be justified.

Each round that finds issues → fix → re-run that round. All three rounds must pass clean before continuing.

Also enforce: no duplicate code (reuse existing functions/components), no dead code, no test scripts left behind.

---

### Phase 4: UX Review (follow UX-REVIEWER.md)

This phase only runs if the task touches UI. Skip it for backend-only or config-only changes.

Read and follow **UX-REVIEWER.md** for the full visual inspection:

1. Start the dev server if not already running.
2. Open Chrome, navigate to the affected pages.
3. Test across all 9 viewport sizes (320px → 2560px).
4. Check: visual consistency, layout/spacing, responsiveness, interaction feedback, error/edge states, accessibility, user flow, loading performance.
5. **Tailwind only** — flag any vanilla CSS, inline styles, or `<style>` blocks.
6. Fix any issues found and re-test.
7. Save final screenshots to `screenshots/` (delete old ones first).

---

### Phase 5: Ship It

Once all review phases pass:

1. **Commit and push** all changes to the PR branch. If you didn't push, you didn't finish.
2. **Create or update the PR** on GitHub with a clear title and description.
3. **Set the task status** to **"In Review"** on the project board.
4. **Add the PR link** to the task on the board.
5. For rework: **reply to each feedback comment** on the PR/issue explaining what was changed.
6. **Send the completion summary to Telegram** (see format below).

---

## Completion Summary Format (Telegram)

Send a single message covering the full pipeline run:

```
🚀 Task Complete: [Task Title]

📋 Changes Made:
- [Brief list of what changed — files, features, fixes]

🔍 Code Review:
- Round 1 (Bugs): [found/fixed or clean]
- Round 2 (Security): [found/fixed or clean]
- Round 3 (UX): [found/fixed or clean]

🎨 UX Review: [findings or "No UX issues"]

🔗 PR: [link]

📸 [Attach final screenshot]
```

---

## Handling Failures

- **Build fails:** Fix in Phase 2, don't proceed to review.
- **Review finds issues:** Fix and re-run that review round. Don't proceed until clean.
- **UX test finds issues:** Fix and re-test. Don't ship broken UI.
- **Can't determine task scope:** Stop and ask Sanjay rather than guessing.
- **Conflicting feedback:** Flag the conflict in the PR comment and ask for clarification.

## Important Guardrails

- **Never skip phases.** The pipeline exists because each phase catches different problems.
- **Never mark a task "In Review" if the build is broken or reviews haven't passed.**
- **CODE-AGENT.md, CODE-REVIEWER.md, and UX-REVIEWER.md contain detailed instructions** — read them fresh for each task. Don't rely on memory of their contents.
- **CODE-REVIEWER.md must be read fresh every time** during code review rounds. The pattern list grows over time.
- **Screenshots directory gets wiped per task** — only the current task's screenshots should exist.
