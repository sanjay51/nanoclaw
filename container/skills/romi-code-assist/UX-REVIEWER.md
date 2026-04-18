---
name: romi-ux-reviewer
description: UX review for NanoClaw. Usually skipped (no web UI). When a task changes channel output rendering, review the rendered message across channels instead.
---

# Romi UX Review

NanoClaw has no web UI. For most tasks, **skip Phase 4 entirely** and note "N/A — no UI changes" in the Telegram summary.

**Read `../code-assist-shared/UX-REVIEWER-CORE.md` first** only if the task involves a real UI surface. That file covers viewports, accessibility, interaction feedback — all of which apply if and when a NanoClaw web/admin UI is added.

---

## When Phase 4 Applies for NanoClaw

Phase 4 applies only in these cases:

### A) Channel-output formatting changes

If the task modifies how Romi renders messages to a channel (WhatsApp, Telegram, Slack, Discord), review the **rendered output**, not a screen layout:

1. Restart the service: `systemctl --user restart nanoclaw`
2. Send a test message that exercises the changed rendering path (e.g. a long message, a markdown table, an image, a code block, emoji reactions).
3. Take a screenshot of how the message appears in the actual channel app.
4. Verify:
   - Markdown / formatting converts correctly for that channel's syntax
   - Links are clickable
   - Code blocks preserve whitespace
   - Emoji / reactions render as expected
   - Long messages are chunked correctly (no mid-word splits)
   - Attachments / images render
5. If the change affects multiple channels, test each one that's configured.
6. Attach the screenshot(s) to the Telegram completion summary.

Reference: channel-specific formatting rules live in `container/skills/<channel>-formatting/` and `.claude/skills/channel-formatting/`.

### B) Future web/admin UI

If and when NanoClaw adds a web dashboard or admin UI, follow the full UX review in `../code-assist-shared/UX-REVIEWER-CORE.md` — viewport matrix, accessibility, interaction feedback, etc.

---

## NanoClaw-Specific UX Standards

- **Channel-native formatting** — respect each channel's native syntax (WhatsApp: `*bold*`, Telegram: `**bold**`, Slack: `*bold*`). Don't send raw Markdown that renders as literal characters.
- **Message length** — long responses get chunked at paragraph boundaries, not mid-sentence. Streaming updates replace the previous chunk rather than appending a wall of duplicates.
- **Reply context** — when Romi replies to a specific message, use the channel's reply/quote primitive so the conversation stays threaded.
- **Emoji reactions** — lightweight acknowledgements (👀 "seen", 🐶 "working on it", ✅ "done") reduce noise compared to text replies.
- **Error surfaces** — when a tool fails or the container exits, surface a short, specific error rather than a stack trace. Sensitive values (tokens, paths) must not leak.
- **Dog personality** — Romi has a friendly dog personality with the 🐶 emoji. UI-ish changes should preserve that tone, not strip it.

---

## Summary (Send to Telegram)

After Phase 4, add to the completion summary:

- **UX Review** — one of:
  - `"N/A — no UI changes"` (most NanoClaw tasks)
  - `"Channel output verified on <channels>"` + attach screenshots
  - Full UX findings (if a real UI was touched)
- Note any issues that were flagged but not fixed (pre-existing issues outside task scope — create a backlog issue for these with `ai-created` label).
