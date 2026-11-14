# Author Royalty Dashboard & Automated Notification System

BookLeaf Assignment 2: Bubble.io app + n8n workflow + AI-written royalty summary emails.

Authors log in and see their books and royalties. Admins see every author, and can click one
button (or a bulk button) to have n8n ask an AI model to write that author's royalty summary
email. The result is sent back to Bubble and shown in a Notification Log.

## What is in this folder

| Path | What it is |
|---|---|
| `bubble/SETUP_GUIDE.md` | The steps I followed to build the Bubble app (data types, privacy rules, pages, workflows, API connector) |
| `bubble/data/*.csv` | Dataset converted to CSV for upload into Bubble (authors, books, payouts) |
| `n8n/royalty-summary-workflow.json` | n8n workflow export (Anthropic Claude Haiku) |
| `n8n/royalty-summary-workflow-openai.json` | Same workflow using OpenAI `gpt-4o-mini` instead |
| `n8n/code-nodes/` | Readable copies of the six Code nodes used in the workflow |
| `scripts/` | `make-csvs.js` (JSON to CSV) and `send-test-webhook.js` (test n8n without Bubble) |
| `test/` | Unit tests for the Code node logic, run against the real dataset (`node --test test/`) |

## How the pieces talk to each other

```
 Admin clicks "Generate & Send"                      Bubble (backend workflow)
        │                                                     │
        │   1. create NotificationLog (status = Pending)      │
        │   2. POST /webhook/royalty-summary  + X-API-Key     │
        ▼                                                     ▼
                         n8n workflow
   validate + dedupe ──► 202 Accepted (answers immediately)
          │
          ├─► Data API: fetch author + books from Bubble
          ├─► Code: work out totals, overdue books, payout dates
          ├─► AI model: write the email (SUBJECT + body)
          ├─► Code: check format and headline numbers
          ▼
   POST /api/1.1/wf/royalty_callback  + Bearer token ──► Bubble updates the log
                                                      (Success / Failed, subject, email text)
```

Why the webhook answers with 202 straight away: the AI call can take several seconds and I did
not want Bubble waiting on it. Bubble creates the log row as `Pending` first, and n8n's callback
is what flips it to `Success` or `Failed`.

## Bubble database

| Data type | Fields | Notes |
|---|---|---|
| **User** (built in) | `role` (author / admin), `author` (Author) | Links a login to its author record. Admins have no author |
| **Author** | `author_code`, `name`, `email`, `phone`, `city`, `joined_date`, plus stats: `books_count`, `total_earned`, `total_paid`, `total_pending`, `payout_status` | The stats are stored on the author so the admin list can filter and sort without calculating for every row |
| **Book** | `book_code`, `author_code`, `author` (Author), `title`, `isbn`, `genre`, `publication_date`, `status`, `mrp`, `royalty_per_copy`, `total_copies_sold`, `total_royalty_earned`, `royalty_paid`, `royalty_pending`, `last_royalty_payout_date`, `print_partner`, `available_on`, `payout_status` | `author_code` is only needed while importing; the real relationship is the `author` field |
| **Payout** | `book` (Book), `author` (Author), `amount`, `paid_on` | Payout history |
| **NotificationLog** | `author` (Author), `triggered_by` (User), `status` (Pending / Success / Failed), `subject`, `email_body`, `error_message`, `finished_at`, `figures_match` | One row per click; Created Date is the "sent at" time |

Why it is shaped like this
- Authors and Books are separate types with a link (one author, many books), like a foreign key.
- Money, counts and dates are real number/date fields, so they can be summed, compared and filtered.
- `payout_status` is stored (not calculated on screen) so the admin can filter authors by *fully paid / pending / overdue*. A backend workflow recalculates it (see the setup guide).
- Payout rows: the dataset only has total paid and the last payout date per book, so each book that has been paid gets one row (amount = total paid so far). Real payments would be one row each.
- `available_on` is a comma-separated text field because it is only displayed, never searched.

### Royalty status badge (per book)

| Badge | Rule |
|---|---|
| Green | published and nothing pending |
| Yellow | pending amount, and last payout within 90 days (or a book younger than 90 days that has never been paid) |
| Red | pending amount and last payout more than 90 days ago, or never paid and published more than 90 days ago |
| Grey | not published yet (no royalty data) |

Note: the dataset's payout dates are all in 2025, so when this is reviewed in late 2026 every book
that still has a pending amount shows Red. That is the rule working as written, not a bug.

### Privacy rules
- **User**: a user can see their own record; admins see all.
- **Author**: visible when `This Author is Current User's author`, or Current User's role is admin.
- **Book** and **Payout**: visible when their `author` is Current User's author, or admin.
- **NotificationLog**: admins only. Authors cannot see it.
- Everyone else: no permissions. I tested by logging in as two different authors and with "Run as".

## n8n workflow

| Node | What it does |
|---|---|
| Royalty summary webhook | POST endpoint, protected by a Header Auth credential (`X-API-Key`). Wrong or missing key is rejected by n8n with 403 |
| Validate request | Checks `notification_id` and `author_id` exist, and flags a duplicate if this `notification_id` was already received |
| Request valid? / Duplicate? | Branches. Bad input gets 400, a duplicate gets 409, otherwise 202 |
| Config | The one place for the Bubble URLs, the author-link field name and the model |
| Data in payload? | If the request already contains the books, use them. Otherwise fetch them |
| Fetch author / Fetch books | Bubble Data API calls (3 retries each) |
| Normalize Bubble data | Removes Bubble's type suffixes (`title_text` becomes `title`) |
| Build prompt | Calculates every figure and date, builds the system and user prompt |
| Call AI | Anthropic Messages API (or OpenAI in the other export), 2 tries, 45 s timeout |
| Parse AI response | Checks the `SUBJECT:` format and that total earned / paid / pending appear in the email |
| Send email (optional) | SMTP node, disabled by default. Enable it to actually email the author (bonus) |
| Build success / failure payload | Same JSON shape either way, so Bubble has a single callback to handle |
| Callback to Bubble | POSTs the result to the Bubble API workflow (3 retries) |
| Callback failed | Marks the n8n execution as failed if Bubble still cannot be reached |

### Why n8n fetches the data instead of Bubble sending it
Bubble only sends `notification_id` and `author_id`. That keeps the Bubble side small (building a
nested JSON list in Bubble is fiddly) and means n8n always reads the current numbers. The cost is
that the Data API has to be enabled and the field names depend on how the Data API names them.
The workflow also accepts the full author + books in the request body, which is how
`scripts/send-test-webhook.js` tests it.

## Prompt strategy

- **Numbers are never left to the AI.** The Code node formats every amount (`₹11,970`), works out
  totals, the 90-day overdue flag, and the payout date from the quarterly cycle plus the 45-day
  window. The prompt says "copy the amounts exactly".
- **The knowledge base is in the system prompt**: 80/20 split, quarterly calculation, 45-day window,
  ₹1,000 minimum, bank transfer. Tone rules come from the Assignment 1 guidelines: warm, specific,
  own BookLeaf's mistakes, no blaming authors, clear next step.
- **One instruction per situation** (`payout_situation`): `all_paid`, `pending`, `below_threshold`,
  `no_published_books`. Plus extra instructions when there are never-paid books, overdue books
  (apologise, review within 48 hours) or books in production (stage update).
- **Fixed output format** (`SUBJECT: ...`, blank line, body) so it can be parsed, and plain text so
  it can go straight into an email. 150-300 words, signed "BookLeaf Author Support Team".
- **Check after generation**: the workflow verifies the headline totals appear in the email and
  stores the result as `figures_match` in the log.

## Error handling

| What goes wrong | What happens |
|---|---|
| Wrong / missing webhook key | n8n returns 403, nothing runs |
| Missing `author_id` or `notification_id` | 400 with the reason |
| Admin double clicks | Bubble blocks it: the button is disabled while a send is running, and no second log is created if a `Pending` one already exists for that author from the last 2 minutes. So one click = one log = one webhook call. As a second layer, n8n returns 409 if it receives the same `notification_id` again |
| Bubble Data API unreachable | 3 retries, then error branch, log set to `Failed` with the error text |
| AI API fails or times out | 2 tries, then error branch, `Failed` |
| AI returns something that is not in the expected format | Parse node throws, `Failed` |
| Bubble cannot be called back | 3 retries, then the n8n execution is marked failed (visible in Executions) |
| n8n is down or does not answer | Bubble's API call is set to continue on error, so the log is set to `Failed` straight away. A `Pending` row older than 5 minutes is shown as "Timed out" in the log |

## Known limitations

- Duplicate protection in n8n uses workflow static data, which only works while the workflow is active (not in test runs), is per-instance, and cannot catch two identical calls arriving at the very same moment (static data is saved when a run finishes). That is why the real protection is in Bubble.
- Bubble free plan: no custom domain, one editor, limited API calls. It runs on the `version-test` URLs.
- Overdue/status badges depend on today's date, and the stored `payout_status` is a snapshot until the recalculation workflow is run again.
- The AI email is not sent by default; the SMTP node is there but disabled, so the output is verified in the log.
- Payout history is one row per book (see above), not individual payments.

## Tests

- `node --test test/` runs 11 unit tests over the Code node scripts with the real dataset: never-paid
  author, fully paid author, pending under ₹1,000, book in production, payout dates before and after
  the 45-day window, dedupe, Bubble field-name cleanup, AI-output parsing, failure payloads.
- `scripts/send-test-webhook.js` posts a real author from the dataset to the n8n webhook, to test n8n without Bubble.
- The Bubble screens and privacy rules are covered by the manual checklist in `bubble/SETUP_GUIDE.md`, section 10.

## My learning notes (Bubble was new to me)

<!-- TODO: write this part yourself, in your own words. It is 15% of the marks and they are
     asking about YOUR learning process. Ideas to cover:
     - How you learned Bubble (which tutorials / manual pages, how long it took)
     - What was confusing at first (e.g. privacy rules, the API Connector, option sets, backend workflows)
     - Something that did not work, what you tried, and how you worked around it
     - What you would do differently next time -->

