# Code-Assist Pipeline (Shared)

The canonical 5-phase pipeline used by product-specific code-assist skills (`reco-code-assist`, `romi-code-assist`, etc.). Each product skill wires its own context (repo path, tech stack, task source) into this skeleton.

```
┌──────────┐   ┌──────────────┐   ┌────────────────┐   ┌──────────┐   ┌──────────┐
│ 1. PICK  │ → │ 2. IMPLEMENT │ → │ 3. CODE REVIEW │ → │ 4. UX    │ → │ 5. SHIP  │
│   UP     │   │ (CODE-AGENT) │   │ (CODE-REVIEWER)│   │ REVIEW   │   │ (PR + TG)│
└──────────┘   └──────────────┘   └────────────────┘   └──────────┘   └──────────┘
```

Each phase must complete cleanly before the next begins. If a phase fails or surfaces issues, fix them before moving on — never skip a phase.

---

## Phase 1 — Pick Up a Task

Task source varies per product (GitHub Projects board, issue labels, PR status, etc.). The product skill defines where to look. Common rules:

- **For new work:** pick the highest-priority unclaimed task flagged for AI delegation. Move its status to "In Progress" before starting.
- **For rework** (status is "Needs Rework" or "Check Comments"): read feedback from ALL THREE sources — don't skip any:
  - PR conversation: `gh pr view <number> --comments`
  - PR file comments: `gh api repos/{owner}/{repo}/pulls/{number}/comments`
  - Issue comments: `gh issue view <number> --comments`
- **If no task qualifies:** reply `HEARTBEAT_OK` and stop.
- **Output:** a clear task description, acceptance criteria, and (for rework) the full list of feedback to address.

---

## Phase 2 — Implement

Follow the product's `CODE-AGENT.md`. Shared rules in `CODE-AGENT-CORE.md`. Key invariants:

1. Read the repo's `CLAUDE.md` first — always.
2. Fresh branch from main for new tasks. Same branch for rework.
3. Build must pass before moving on.
4. Stay on scope — no unrelated changes. Log discoveries as new backlog items with "AI Created" = Yes.
5. Clean up temp/debug files before proceeding.

For rework: address every single piece of feedback from Phase 1.

---

## Phase 3 — Code Review

Run the 3-round mandatory self-review cycle against `CODE-REVIEWER.md` (read it fresh every time — the pattern list grows).

- **Round 1 — Bugs & Logic:** all patterns. Find bugs, logic flaws, edge cases, error handling gaps. Revert out-of-scope changes.
- **Round 2 — Security & Performance:** injection, XSS, auth bypasses, N+1 queries, unnecessary re-renders. Verify every changed file is task-relevant.
- **Round 3 — User Experience:** UX issues from the user's perspective — confusing flows, missing feedback, poor errors, accessibility. Final diff check — every changed line must be justified.

Each round that finds issues → fix → re-run that round. All three rounds must pass clean before continuing.

Also enforce: no duplicate code (reuse existing functions/components), no dead code, no test scripts left behind.

---

## Phase 4 — UX Review

Only runs if the task touches user-facing UI. Skip for backend-only, CLI-only, or config-only changes.

Follow the product's `UX-REVIEWER.md`. Shared checks in `UX-REVIEWER-CORE.md` (viewport matrix, accessibility, interaction feedback). Product-specific rules (e.g. Tailwind-only, allowed URLs) live in the product file.

Fix any issues found and re-test. Save final screenshots to `screenshots/` (delete old ones first).

---

## Phase 5 — Ship It

Once all review phases pass:

1. **Commit and push** all changes to the PR branch. If you didn't push, you didn't finish.
2. **Create or update the PR** on GitHub with a clear title and description.
3. **Set the task status** to "In Review" on the task source.
4. **Add the PR link** to the task.
5. For rework: **reply to each feedback comment** on the PR/issue explaining what was changed.
6. **Send the completion summary to Telegram** (format below).

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

🎨 UX Review: [findings or "No UX issues" or "N/A — no UI changes"]

🔗 PR: [link]

📸 [Attach final screenshot, if UI task]
```

---

## Handling Failures

- **Build fails:** Fix in Phase 2, don't proceed to review.
- **Review finds issues:** Fix and re-run that review round. Don't proceed until clean.
- **UX test finds issues:** Fix and re-test. Don't ship broken UI.
- **Can't determine task scope:** Stop and ask the user rather than guessing.
- **Conflicting feedback:** Flag the conflict in the PR comment and ask for clarification.

## Important Guardrails

- **Never skip phases.** Each phase catches different problems.
- **Never mark a task "In Review" if the build is broken or reviews haven't passed.**
- **Read `CODE-AGENT.md`, `CODE-REVIEWER.md`, and `UX-REVIEWER.md` fresh for each task.** Don't rely on memory of their contents.
- **Screenshots directory gets wiped per task** — only the current task's screenshots should exist.
