---
name: reco-code-agent
description: Implementation instructions for RecoCards.com code tasks. Extends the shared CODE-AGENT-CORE with RecoCards-specific context.
homepage: https://github.com/users/sanjay51/projects/2/views/1
---

# Reco Implementation Instructions

The orchestrator (`SKILL.md`) handles task pickup, review cycles, and shipping — this file covers the actual implementation work.

**Read `../code-assist-shared/CODE-AGENT-CORE.md` first.** That file has the git rules, scope discipline, cleanup rules, and general UI testing rules. This file only adds RecoCards-specific items.

## RecoCards Context

- **Repo root:** `/Users/sanjay/personal-workspace/recocards.com`
- **Primary docs:** `CLAUDE.md` in the repo root
- **Tech stack:** Angular (standalone components, signals), Tailwind, Firebase/Firestore, Stripe

## Before You Start (Reco additions)

1. Read `CLAUDE.md` in the repo root.
2. If the task is in Ready state, start from scratch on the `recocards` branch — don't look at existing branches or previous code.
3. Understand the task description, acceptance criteria, and any rework feedback from Phase 1.

## Build & Verify

- Run the Angular build — must pass before raising or updating a PR.
- If the build fails, fix and re-run until it passes.
- **A PR with a failing build is not a valid PR.**

## UI Testing

Follow the "UI Testing with Chrome" section in `../code-assist-shared/CODE-AGENT-CORE.md`. Reco test URLs:

- **Board:** http://localhost:4200/board/happy-birthday-asdfas-102801045528
- **Greeting card:** http://localhost:4200/greeting-card/happy-birthday-asdfasdf-99078000753
- **One-to-one card:** http://localhost:4200/one-to-one-card/thank-you-asdf-140322752175

### Screenshots

Follow the Screenshot Rules in the shared CORE file. Send the final screenshot to the Telegram channel.
