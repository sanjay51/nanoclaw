# reco-marketer log template

Three CSVs that define the Google Sheets schema the skill maintains. On first run, the agent creates a Google Sheet in the user's Drive named `reco-marketer log — <group>` with three tabs matching these files, and imports the header rows.

## Sheets

### Opportunities
Every backlink candidate found. One row per candidate, deduped by `url`.

| column | meaning |
|---|---|
| `date_found` | ISO date when the opportunity was first discovered |
| `source` | Where it was discovered — `siteguru`, `haro`, `google-search`, `reddit`, `twitter`, `manual` |
| `type` | `resource-page`, `broken-link`, `guest-post`, `directory`, `unlinked-mention`, `haro`, `social-thread`, `press` |
| `url` | Canonical URL of the opportunity |
| `domain` | Root domain, for grouping |
| `anchor_text` | Suggested/observed anchor text, if relevant |
| `domain_authority` | DA score if known (from siteguru or manual) |
| `competitor` | Which competitor's backlink profile this came from, if applicable |
| `notes` | Free-form context — why this is a fit, relevance score, etc. |
| `status` | `new` → `drafted` → `sent` → `won` / `lost` / `skipped` |
| `last_checked` | ISO date of most recent check — used to re-verify stale opportunities |

### Drafts
One row per drafted outreach email or social reply. Nothing here has been sent until `approved_by_user` = TRUE and `sent_at` is set.

| column | meaning |
|---|---|
| `date_drafted` | ISO date |
| `opportunity_url` | Foreign key into Opportunities |
| `channel` | `email`, `twitter`, `reddit`, `linkedin` |
| `to` | Recipient (email address or @handle / u/username) |
| `subject` | Email subject (empty for social) |
| `body` | Full draft text |
| `disclosure_included` | TRUE for social replies, `n/a` for email outreach |
| `approved_by_user` | TRUE once the user has explicitly approved |
| `sent_at` | ISO timestamp when actually sent/posted |
| `outcome` | `pending`, `replied`, `ignored`, `link-acquired`, `rejected` |

### Wins
Acquired links — the thing that actually matters. Append-only.

| column | meaning |
|---|---|
| `date_acquired` | When the link went live |
| `url` | Page where the link lives |
| `domain` | Root domain |
| `domain_authority` | DA at time of acquisition |
| `type` | Matches Opportunities.type |
| `anchor_text` | Actual anchor text used |
| `competitor_displaced` | If this was a broken-link / replacement win |
| `notes` | How it happened, effort required |

## First-run initialization

The agent should:

1. Check if `<group-folder>/reco-marketer-doc-id.txt` exists locally. If yes, open that Sheet.
2. If not, create a new Google Sheet named `reco-marketer log — <group>`, add three tabs (`Opportunities`, `Drafts`, `Wins`), and paste the header rows from these CSVs into row 1 of each.
3. Save the Sheet's document ID to `<group-folder>/reco-marketer-doc-id.txt` for future runs.
4. Share the Sheet with the user's primary Google account (read-write).

## Deduplication rules

- **Opportunities**: dedupe by exact `url` match. If found again with different metadata, update `last_checked` and `notes` — don't create a duplicate row.
- **Drafts**: never create a second draft for the same `opportunity_url` unless the prior draft's `outcome` is `ignored` or `rejected` and >14 days have passed.
- **Wins**: append only. Never modify existing rows.
