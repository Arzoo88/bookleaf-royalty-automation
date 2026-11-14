# Bubble setup guide

Steps for building the Bubble side, in the order that worked best: data first, privacy second,
screens third, n8n last. Button names move around a little between Bubble versions, so use the
manual (manual.bubble.io) if a label looks different.

Keep every field name in **snake_case exactly as written here**. n8n reads them through the Data
API, and Bubble turns a field called `royalty_pending` into `royalty_pending_number` in the API.

---

## 0. Accounts and secrets

- Bubble: free plan, new app (for example `bookleaf-royalty`). The API URLs will start with
  `https://<app>.bubbleapps.io/version-test/api/1.1`.
- n8n Cloud trial (or self-hosted with ngrok). Import `n8n/royalty-summary-workflow.json`.
- An AI key (Anthropic or OpenAI).
- Make up one **webhook secret** (a long random string). It goes in two places: n8n (credential
  "Bookleaf webhook key") and the Bubble API Connector.

## 1. Data types

Create these in the **Data** tab. (User already exists.)

**User**: add `role` (text: `author` or `admin`) and `author` (type Author).

**Author**: `author_code` (text), `name` (text), `email` (text), `phone` (text), `city` (text),
`joined_date` (date), `books_count` (number), `total_earned` (number), `total_paid` (number),
`total_pending` (number), `payout_status` (text: Fully paid / Pending / Overdue).

**Book**: `book_code` (text), `author_code` (text), `author` (Author), `title` (text), `isbn` (text),
`genre` (text), `publication_date` (date), `status` (text), `mrp` (number),
`royalty_per_copy` (number), `total_copies_sold` (number), `total_royalty_earned` (number),
`royalty_paid` (number), `royalty_pending` (number), `last_royalty_payout_date` (date),
`print_partner` (text), `available_on` (text), `payout_status` (text: Green / Yellow / Red / Grey).

**Payout**: `book` (Book), `author` (Author), `book_code` (text), `author_code` (text),
`amount` (number), `paid_on` (date).

**NotificationLog**: `author` (Author), `triggered_by` (User), `status` (text: Pending / Success /
Failed), `subject` (text), `email_body` (text), `error_message` (text), `finished_at` (date),
`figures_match` (yes/no).

## 2. Import the data

Data tab > App data > pick the type > **Upload**. Use the CSVs in `bubble/data/` in this order:
`authors.csv` (type Author), `books.csv` (type Book), `payouts.csv` (type Payout).
Map each column to the field with the same name. Dates are `yyyy-mm-dd`. Leave the `author` /
`book` link fields unmapped; they are filled in next. Check the counts afterwards: 10 authors,
18 books, 12 payouts.

## 3. Link books and payouts to their author

The CSVs carry `author_code` / `book_code` as plain text. Turn them into real relationships with
two small backend workflows (Backend workflows page):

- `link_book` (parameter `book` of type Book): Make changes to `book`:
  `author` = Search for Authors (author_code = book's author_code) :first item.
- `link_payout` (parameter `payout` of type Payout): Make changes to `payout`:
  `author` = Search for Authors (author_code = payout's author_code) :first item,
  `book` = Search for Books (book_code = payout's book_code) :first item.

Then on a temporary admin-only page add a button with two actions: **Schedule API workflow on a
list** for `link_book` (list: Search for Books) and the same for `link_payout`. Click it once,
check in the Data tab that `author` is filled for every row, then delete the button.

## 4. Users and roles

You need one admin and one author login (the brief asks for one of each; more is better).
On a temporary page add inputs for email/password and a button that runs
**Sign the user up** and then **Make changes to Current User**: `role`, and `author`
(Search for Authors (email = the email typed in) :first item). Create:

- `admin@bookleaf.com` with role `admin`
- the author emails from the dataset with role `author` (at least `priya.sharma@email.com`,
  `ananya.reddy@email.com`, `farhan.sheikh@email.com`, `kavita.deshmukh@email.com`)

Delete the temporary page afterwards.

## 5. Privacy rules (Settings > Privacy)

| Type | Rule | When | Allowed |
|---|---|---|---|
| User | Self | `This User is Current User` | view all fields |
| User | Admin | `Current User's role is admin` | view all fields, find in searches |
| Author | Own | `This Author is Current User's author` | view all fields, find in searches |
| Author | Admin | `Current User's role is admin` | everything |
| Book | Own | `This Book's author is Current User's author` | view all fields, find in searches |
| Book | Admin | `Current User's role is admin` | everything |
| Payout | Own / Admin | same as Book | same as Book |
| NotificationLog | Admin only | `Current User's role is admin` | everything |

"Everyone else (default)" gets nothing on every type. Use **Run as** in the editor to preview as
different users.

## 6. Status badge and author stats (backend workflows)

`recalc_book` (parameter `book`): four **Make changes to book** actions, each with an
**Only when** condition, setting `payout_status`:

- `Grey` when `book's status` is not `Published & Live`
- `Green` when published and `royalty_pending = 0`
- `Red` when published, `royalty_pending > 0` and either
  (`last_royalty_payout_date` is not empty and < `Current date/time:change days by -90`) or
  (`last_royalty_payout_date` is empty and `publication_date` < `Current date/time:change days by -90`)
- `Yellow` when published, `royalty_pending > 0` and the Red condition is false

`recalc_author` (parameter `author`): Make changes to `author`:
`books_count` = Search for Books (author = author):count,
`total_earned` = Search for Books (author = author):each item's total_royalty_earned:sum
(same for `total_paid`, `total_pending`). Then three more actions for `payout_status`:
`Overdue` when Search for Books (author = author, payout_status = Red):count > 0,
`Pending` when that count is 0 and `total_pending > 0`, `Fully paid` when `total_pending = 0`.

Add an admin-only "Recalculate" button: Schedule `recalc_book` on a list (all books), then
Schedule `recalc_author` on a list (all authors) with the scheduled date one minute later.
Run it once after the import, and again whenever the date moves a lot (the Red rule depends on today).

## 7. Pages

**`index` (login).** Email + password inputs, button: **Log the user in**, then go to
`my-books` when `Current User's role is author`, or to `admin` when it is admin. On every other
page, add a **When page is loaded** workflow: if the user is not logged in go to `index`; on the
admin pages, if `Current User's role` is not admin go to `my-books`.

**`my-books` (author).**
- Summary row: total earned / paid / pending =
  Search for Books (author = Current User's author):each item's `total_royalty_earned`:sum (and the
  same for paid and pending).
- Repeating group of Book, source Search for Books (author = Current User's author), sorted by
  `publication_date`. In each cell: title, ISBN, genre, status, publication date, MRP,
  available_on, copies sold, royalty earned / paid / pending, last payout date.
- Badge: a text inside a group with four conditionals on `Current cell's Book's payout_status`
  (Green / Yellow / Red / Grey background and label).
- Edge cases: a conditional that shows "Not yet published" when `publication_date` is empty and
  hides the royalty block (with "In production, no royalty data yet") when the book is not
  `Published & Live`; "No payout yet" when `last_royalty_payout_date` is empty.

**`admin`.**
- Search input (name), dropdown for city (choices: Search for Authors:each item's city:unique
  elements), dropdown for payout status (Fully paid / Pending / Overdue).
- Repeating group of Author with source Search for Authors (name contains the input, city =
  dropdown, payout_status = dropdown), each constraint set to **Ignore when empty**. Columns:
  name, city, `books_count`, `total_earned`, `total_pending`, status. Click a row: go to
  `admin-author` and send the Author as data.
- Two buttons: **Send summaries to all authors with pending royalties** (section 8) and **Recalculate**.
- Notification Log: repeating group of NotificationLog sorted by Created Date descending: author
  name, created date, status, subject, error message, and a popup with `email_body`. Add a
  conditional that shows "Timed out" instead of "Pending" when the log is Pending and older than
  5 minutes, so nothing looks stuck forever.

**`admin-author`.** Type of content: Author. Show the author's details, the same book repeating
group and totals as `my-books` (but with `Current page's Author` instead of Current User's
author), a Payouts repeating group (Search for Payouts: author = Current page's Author), the
author's own log rows, and the **Generate & Send Royalty Summary** button.

## 8. Connecting to n8n

**API Connector.** Add the plugin, create an API called `n8n`. Under Shared headers add
`X-API-Key` = your webhook secret and tick **Private**. Add a call:

- Name `trigger_summary`, Use as **Action**, POST
- URL `https://<your-n8n>/webhook/royalty-summary`
- Body type JSON: `{"notification_id": "<notification_id>", "author_id": "<author_id>"}`
- Tick **Include errors in response and allow workflow actions to continue**
- To initialise the call, put n8n in test mode (Listen for test event), use the **test** webhook URL
  once with sample values, then switch the call back to the **production** URL.

**`send_summary` (backend workflow; parameters `author` of type Author, `triggered_by` of type User).**

1. Create a new NotificationLog (`author`, `triggered_by`, `status` = Pending).
   **Only when** Search for NotificationLogs (author = author, status = Pending, Created Date >
   Current date/time:change minutes by -2):count = 0. This is what stops a second log for an author
   who already has one running.
2. n8n `trigger_summary` with `notification_id` = Result of step 1's unique id and `author_id` =
   author's unique id. **Only when** Result of step 1 is not empty.
3. Make changes to Result of step 1: `status` = Failed, `error_message` = "Could not reach n8n".
   **Only when** step 2 returned an error.

**Single button** (`admin-author`): disable it with a custom state (`sending` = yes while running),
then **Schedule API workflow** `send_summary` (author = Current page's Author, triggered_by =
Current User), pause 2 seconds, `sending` = no. The log row appears immediately as Pending.

**Bulk button** (`admin`): **Schedule API workflow on a list**, workflow `send_summary`, list =
Search for Authors (total_pending > 0), interval 3 seconds (gentle on the AI API), with
`author` = Current list item and `triggered_by` = Current User.

## 9. The callback from n8n

1. Settings > API: enable the **Workflow API and backend workflows** and the **Data API**.
   In the Data API list, expose **Author** and **Book**. Generate an **API token**; it goes into n8n as
   `Authorization: Bearer <token>` (credential "Bubble API token").
2. Create a backend workflow `royalty_callback`. Tick "Expose as a public API workflow",
   leave "can be run without authentication" **unticked**, and tick **Ignore privacy rules**.
   Parameters: `notification_id` (type NotificationLog), `status`, `subject`, `email_body`,
   `error_message` (text), `figures_match` (yes/no).
3. Action: Make changes to `notification_id`: `status`, `subject`, `email_body`, `error_message`,
   `figures_match` from the parameters and `finished_at` = Current date/time.
4. To let Bubble learn the parameters, use **Detect request data** and send one test request from a
   terminal, using a real log id (create one by hand in the Data tab first):

```
curl -X POST "https://<app>.bubbleapps.io/version-test/api/1.1/wf/royalty_callback" ^
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" ^
  -d "{\"notification_id\":\"<log id>\",\"status\":\"Success\",\"subject\":\"test\",\"email_body\":\"test\",\"error_message\":\"\",\"figures_match\":true}"
```

5. **Check how Bubble names your fields.** n8n's Fetch nodes need the key that holds the author link
   on a Book. Look at one record:

```
curl -H "Authorization: Bearer <token>" "https://<app>.bubbleapps.io/version-test/api/1.1/obj/book?limit=1"
```

   Normally it is `author_custom_author`. If yours differs, change `books_author_field` in the
   n8n **Config** node. If any other field comes back with an unexpected name, adjust the Code node
   "Normalize Bubble data".

## 10. Test checklist

- [ ] Log in as two different authors: each sees only their own books and totals. Typing the admin
      page URL as an author sends you back.
- [ ] Admin list: search by name, filter by city, filter by payout status. Totals match the dataset.
- [ ] Authors to open: Ananya Reddy (never paid), Farhan Sheikh (fully paid), Kavita Deshmukh (pending
      below ₹1,000 plus a book in typesetting), Sneha Kulkarni (3 books, one in cover design).
- [ ] Generate & Send for one author: log goes Pending, then Success, and the email text appears.
      Check the n8n execution is green.
- [ ] Click the button twice quickly: only one log row and one n8n execution.
- [ ] Bulk button: one log per author with pending royalties.
- [ ] Break the AI key on purpose: log shows Failed with the error text.
- [ ] Switch the n8n workflow off: log shows Failed (or "Timed out") instead of spinning.
- [ ] `node scripts/send-test-webhook.js <webhook-url> <secret> AUTH003` returns 202, and a wrong
      secret returns 403.

## 11. Outline for the 3 to 5 minute screen recording

1. (0:20) The data model in the Data tab, the privacy rules page.
2. (0:50) Author login: books, status badges, totals. Log out.
3. (0:50) Admin: list, filters, search, open an author.
4. (1:20) Click Generate & Send, switch to n8n and show the execution lighting up node by node, come
   back and show the log changing to Success with the email text.
5. (0:40) Show a failure: wrong AI key or webhook off, and the Failed row. Mention the duplicate click protection.
6. (0:20) Quick look at the README sections.

## Troubleshooting

- Webhook returns 404 from Bubble: the workflow is not active, or you are still using the `webhook-test` URL.
- Webhook returns 403: the secret in the API Connector header does not match the n8n credential.
- Fetch nodes return 401 or empty lists: wrong token, Data API not enabled, or the type is not exposed.
- Callback returns 401: the Bearer token in the n8n credential "Bubble API token" is missing or wrong.
- Free plan: heavy API use can hit the plan's limits; do not run bulk sends in loops while testing.
