---
name: send-email
description: Send a transactional email with a subject, heading, message body, and optional call-to-action button. Use when the user asks to send, email, or mail someone — e.g. "email alice@example.com with the meeting notes", "send a quick note to bob", "mail myself a reminder".
allowed-tools: Bash(curl:*), Bash(jq:*)
---

# send-email

Send an email through the Reco delivery API. It renders a templated HTML email with a heading, a message body, and an optional CTA button, then delivers it via SES.

## Endpoint

```
GET https://p71ku9k4b9.execute-api.us-west-2.amazonaws.com/default/reco-schedule-card-delivery
```

## Query parameters

| Param             | Required | Notes |
|-------------------|----------|-------|
| `action`          | yes      | Always `send-email-generic` |
| `sender`          | yes      | Always `hello@recocards.com` |
| `recipient_email` | yes      | To address |
| `templateData`    | yes      | JSON string with the fields below |

`templateData` fields:

| Field       | Required | Notes |
|-------------|----------|-------|
| `subject`   | yes      | Email subject line |
| `heading`   | yes      | Large heading shown at the top of the email body |
| `message`   | yes      | Main body text. Plain text; newlines render as paragraph breaks. |
| `cta_label` | no       | Label for the call-to-action button. Omit or use `""` to hide the button. |
| `cta_link`  | no       | URL the CTA button links to. Required if `cta_label` is set. |

## Gathering inputs

Before sending, make sure you have:

- **Recipient** — an email address. If the user gave a name but no address, ask for it.
- **Subject, heading, message** — if the user didn't say explicitly, infer a sensible subject and heading from the message content (e.g. subject = first short line, heading = same or a summary). Don't ask the user for these unless the intent is truly ambiguous.
- **CTA** — only include if the user asked for a button or link. Never invent a URL.

The sender is always `hello@recocards.com` — do not ask the user and do not let them override it.

## Sending

Build the `templateData` JSON with `jq` (safely escapes quotes and newlines), then GET the endpoint with `curl --data-urlencode` so each parameter is URL-encoded correctly.

```bash
SENDER="hello@recocards.com"
RECIPIENT="alice@example.com"
SUBJECT="Meeting notes"
HEADING="Today's sync"
MESSAGE="Here's a quick recap of what we discussed..."
CTA_LABEL="Open doc"            # optional
CTA_LINK="https://example.com"  # optional, required if CTA_LABEL set

TEMPLATE_DATA=$(jq -n \
  --arg subject "$SUBJECT" \
  --arg heading "$HEADING" \
  --arg message "$MESSAGE" \
  --arg cta_label "$CTA_LABEL" \
  --arg cta_link "$CTA_LINK" \
  '{subject:$subject, heading:$heading, message:$message, cta_label:$cta_label, cta_link:$cta_link}')

curl -sS -G "https://p71ku9k4b9.execute-api.us-west-2.amazonaws.com/default/reco-schedule-card-delivery" \
  --data-urlencode "action=send-email-generic" \
  --data-urlencode "sender=$SENDER" \
  --data-urlencode "recipient_email=$RECIPIENT" \
  --data-urlencode "templateData=$TEMPLATE_DATA"
```

If the CTA is not used, pass empty strings for `cta_label` and `cta_link` — the template hides the button when the label is empty.

## Confirming and reporting

- Before sending, show the user a one-line preview: `→ alice@example.com · "Meeting notes"`. Don't dump the whole body back at them. Only pause for confirmation if the content looks risky (bulk recipients, anything that reads like a financial request, etc.) — otherwise just send.
- After sending, check the HTTP response. A 2xx with a non-empty body usually means the message was accepted. Report success with the recipient and subject, e.g. `✓ Sent to alice@example.com — "Meeting notes"`.
- On non-2xx or a network error, show the response body (or error message) verbatim and do not claim success.

## Limitations

- One recipient per call — loop if the user asks to email multiple people, and note partial failures.
- No attachments. If the user wants to attach a file, tell them this endpoint doesn't support attachments.
- The API is a fire-and-forget scheduler; delivery itself happens downstream, so a 2xx means "accepted", not "delivered to the inbox".
