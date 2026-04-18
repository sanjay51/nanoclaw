# UX Reviewer — Core Checks (Shared)

Product-agnostic UX review checks. Product-specific `UX-REVIEWER.md` files reference this and add project-specific standards (e.g. "Tailwind only", test URLs, brand rules).

## When This Runs

After code review (Phase 3) passes all 3 rounds, but before shipping (Phase 5). Only runs for tasks that touch user-facing UI.

## What to Check

Open Chrome and review the UI changes for this task. Take screenshots and evaluate each of the following:

### 1. Visual Consistency
- Do fonts, colors, spacing, and sizing match the rest of the app?
- Are buttons, inputs, and cards styled consistently with existing components?
- Is the visual hierarchy clear — can the user tell what's most important?
- Are icons and images properly sized and aligned?

### 2. Layout & Spacing
- Is the spacing between elements consistent and balanced?
- Does the layout breathe — or is it too cramped / too sparse?
- Are elements properly aligned (left/right/center)?
- Does the layout hold up with different content lengths (short text, long text, empty)?

### 3. Responsiveness — Test ALL These Screen Sizes
Test at each of these viewports and take a screenshot for each:
- **Ultra-wide monitor:** 2560x1440 — does the content stretch too wide or look lost?
- **Standard desktop:** 1440x900
- **Narrow/small laptop:** 1280x720
- **Tall/narrow monitor:** 1080x1920 (portrait monitor)
- **Tablet landscape:** 1024x768
- **Tablet portrait:** 768x1024
- **Phone (large):** 428x926 (iPhone 14 Pro Max)
- **Phone (standard):** 375x812 (iPhone SE / small phones)
- **Phone (narrow):** 320x568 (smallest common size)

For each viewport check:
- Does the layout reflow gracefully?
- Is anything cut off, overflowing, or horizontally scrolling?
- Are touch targets large enough on mobile (min 44x44px)?
- Does text remain readable — no tiny fonts or massive whitespace?
- Do images/cards scale proportionally?
- Is the navigation still usable?

### 4. Interaction & Feedback
- Do clickable elements look clickable (cursor, hover state)?
- Is there hover/focus feedback on interactive elements?
- Do buttons show loading state during async actions?
- Are disabled states visually distinct?
- Is there clear feedback after user actions (success messages, state changes)?

### 5. Error & Edge States
- What happens with empty data? Is there a helpful empty state?
- What do error messages look like? Are they clear and actionable?
- What happens with very long text? Does it truncate, wrap, or overflow?
- What happens with missing images or failed loads?

### 6. Accessibility
- Is there sufficient color contrast (WCAG AA: 4.5:1 for text)?
- Can the UI be navigated with keyboard (tab order, focus indicators)?
- Are form fields labeled properly?
- Are images/icons using alt text or aria-labels?
- Is the font size readable (min 14px for body text)?

### 7. User Flow
- Is the user journey intuitive? Would a first-time user understand what to do?
- Are there too many steps to complete the action?
- Is the most common action the easiest to reach?
- Are confirmation dialogs used for destructive actions?
- Can the user easily undo or go back?

### 8. Loading Performance (Visual)
- Does the page feel fast? Any noticeable lag?
- Is there a loading skeleton or spinner while data loads?
- Does content shift around after loading (layout shift)?

Take screenshots at each step. For any issue found, describe:
1. What the problem is
2. Where exactly it appears (screenshot + description)
3. How to fix it

Fix any issues found, then re-test to confirm the fix.

## General UX Standards

- **Consistency over creativity** — match existing patterns in the app before inventing new ones
- **Mobile first** — if it doesn't work on mobile, it doesn't work
- **Progressive disclosure** — don't overwhelm the user with everything at once
- **Forgiving inputs** — accept multiple formats, trim whitespace, be lenient
- **Clear affordances** — if it's clickable, it should look clickable
- **No dead ends** — every state should have a next step or a way out
- **Instant feedback** — every action should produce visible feedback within 100ms

## Summary (Send to Telegram)

After the UX review, add a UX section to the completion summary:

- **UX Review** — What was found and fixed (or "No UX issues found")
- Include before/after screenshots if issues were fixed
- Note any issues that were flagged but not fixed (e.g. pre-existing issues outside task scope — create a backlog task for these)
