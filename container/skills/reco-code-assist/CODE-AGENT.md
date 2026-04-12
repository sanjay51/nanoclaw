---
name: reco-code-agent
description: Implementation instructions for RecoCards.com code tasks. Covers git workflow, build verification, UI testing, and cleanup rules.
homepage: https://github.com/users/sanjay51/projects/2/views/1
---

# Implementation Instructions

These are the rules to follow when implementing a task for RecoCards.com. The orchestrator (SKILL.md) handles task pickup, review cycles, and shipping — this file covers the actual implementation work.

## Before You Start

1. **Read `CLAUDE.md`** in the repo root (`/Users/sanjay/personal-workspace/recocards.com`) for project conventions.
2. Understand the task description, acceptance criteria, and any rework feedback provided by the orchestrator.

## Git Rules

### Every New Task Gets a Fresh Branch
**This has gone wrong before.** A previous branch was reused and overwrote unrelated changes.

For every new task:
1. **Switch to `main` first** and pull latest (`git checkout main && git pull`)
2. **Create a new branch** with a descriptive name (e.g. `feat/card-sharing`, `fix/login-redirect`)
3. Do all work on this new branch
4. Create a **new PR** from this branch
5. **Never reuse an existing branch from a previous task**

For rework on an existing task:
- Use the **same branch** that the existing PR is on
- Push fixes to that same branch so the existing PR updates

### Clean Up Temp Files Before Raising a PR
- Delete test scripts, debug logs, throwaway files
- Run `git status` and review — if a file shouldn't be in the PR, delete it

### Always Push Changes to the PR
**This has been forgotten before.** After ANY change:
- Commit the changes
- Push to the PR branch
- Verify the PR is updated on GitHub
- **If you didn't push, you didn't finish.**

## Build Must Pass
- After making changes, **always run the build** and verify it passes before raising or updating a PR.
- If the build fails, Claude must fix the errors and re-run until it passes.
- **A PR with a failing build is not a valid PR.** Do not mark the task as complete if the build is broken.

## Rule 0: Stay on Scope — No Unrelated Changes
- **Only make changes that are directly related to the task.** Nothing else.
- Do not refactor nearby code, fix unrelated bugs, or "improve" things outside the task.
- If Claude makes unrelated changes, they must be reverted before the PR is raised.
- **If you discover bugs or improvements**, create a new task in the GitHub Projects backlog with "AI Created" = Yes. Don't fix them in the current PR.

## UI Testing with Chrome

After implementing a UI feature, test it visually:

1. Make sure the dev server is running (start it if needed).
2. Open Chrome and navigate to the relevant page.
3. Take a screenshot and verify:
   - The layout looks correct
   - Elements are positioned and styled as expected
   - Text content is accurate
   - No visual glitches or broken layouts
4. Test interactions:
   - Click buttons, links, and interactive elements
   - Fill out forms and submit them
   - Check loading states, error states, and empty states
   - Verify responsive behavior if relevant
5. Take screenshots at each step to confirm the result.
6. Compare against acceptance criteria — does it match?

If anything looks wrong, fix it and re-test.

### Screenshot Rules
- **Before saving new screenshots, delete ALL existing files from the `screenshots/` directory.** Only the current task's screenshots should exist.
- **Commit the deletion** of old screenshots as part of the PR.
- **Send the final screenshot to the Telegram channel.**

### When UI Testing Applies
- A frontend feature or component was added or modified
- CSS/styling changes were made
- A bug fix involves visual elements
- The task has UI-related acceptance criteria
