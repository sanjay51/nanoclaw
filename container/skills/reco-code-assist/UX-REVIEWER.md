---
name: ux-reviewer
description: Visually inspects RecoCards UI using Chrome across 9 viewport sizes. Extends the shared UX-REVIEWER-CORE with RecoCards-specific standards (Tailwind-only, test URLs).
---

# Reco UX Review

Visually inspect the UI using Chrome. This is the final quality gate for any task that touches the UI.

**Read `../code-assist-shared/UX-REVIEWER-CORE.md` first.** That file has the 8-category checklist (visual consistency, layout, responsiveness across 9 viewports, interaction feedback, error states, accessibility, user flow, loading performance) and the general UX standards. This file only adds RecoCards-specific items.

## When This Runs

After Phase 3 passes all 3 rounds, but before shipping (Phase 5). Skip for backend-only or config-only changes.

## RecoCards-Specific Standards

- **Tailwind only — no vanilla CSS.** All styling in RecoCards must use Tailwind utility classes. If any vanilla CSS was introduced (custom stylesheets, inline `style` attributes, or `<style>` blocks), flag it and convert to Tailwind. Only allow vanilla CSS if there is absolutely no Tailwind equivalent (rare).
- Check the diff for any `.css` file changes or inline styles. If found, convert to Tailwind.

## Test URLs

Use these sample pages for visual testing when the task doesn't specify a particular page:

- **Board:** http://localhost:4200/board/happy-birthday-asdfas-102801045528
- **Greeting card:** http://localhost:4200/greeting-card/happy-birthday-asdfasdf-99078000753
- **One-to-one card:** http://localhost:4200/one-to-one-card/thank-you-asdf-140322752175

## Summary (Send to Telegram)

After the UX review, add a UX section to the completion summary:

- **UX Review** — what was found and fixed (or "No UX issues found")
- Include before/after screenshots if issues were fixed
- Note any pre-existing issues that were flagged but not fixed — create a backlog task for these with "AI Created" = Yes
