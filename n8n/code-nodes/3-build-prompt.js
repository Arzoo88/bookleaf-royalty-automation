// Code node: "Build prompt"
// All the maths and date logic happens here, in code. The AI only gets finished facts
// (already formatted amounts, dates, flags) and writes the email around them.

const MIN_PAYOUT = 1000;      // BookLeaf minimum payout, in rupees
const OVERDUE_DAYS = 90;      // same rule as the red badge in the Bubble app
const PUBLISHED = 'Published & Live';
const DAY = 24 * 60 * 60 * 1000;

const input = $input.first().json;
const config = $('Config').first().json;

// Two ways in: Bubble can send the whole author + books, or n8n fetched them from the Data API.
const author = input.author || { name: input.author_name, email: input.author_email };
const books = Array.isArray(input.books) ? input.books : [];
const today = input.today ? new Date(input.today) : new Date();

const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
const fmtDate = (d) => d
  ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
  : null;

// Royalties are calculated every quarter and paid within 45 days of the quarter ending.
function royaltyCycle(now) {
  const y = now.getUTCFullYear();
  const quarterEnds = [
    new Date(Date.UTC(y - 1, 11, 31)), new Date(Date.UTC(y, 2, 31)), new Date(Date.UTC(y, 5, 30)),
    new Date(Date.UTC(y, 8, 30)), new Date(Date.UTC(y, 11, 31)), new Date(Date.UTC(y + 1, 2, 31)),
  ];
  const lastEnd = [...quarterEnds].reverse().find((d) => d <= now);
  const nextEnd = quarterEnds.find((d) => d > now);
  const lastDue = new Date(lastEnd.getTime() + 45 * DAY);
  const nextDue = new Date(nextEnd.getTime() + 45 * DAY);
  // If the payout window for the quarter that just ended is still open, that is the next payout.
  return lastDue >= now
    ? { quarterEnd: lastEnd, dueBy: lastDue }
    : { quarterEnd: nextEnd, dueBy: nextDue };
}

function isOverdue(book) {
  if (book.status !== PUBLISHED || !(book.royalty_pending > 0)) return false;
  const cutoff = new Date(today.getTime() - OVERDUE_DAYS * DAY);
  if (book.last_royalty_payout_date) return new Date(book.last_royalty_payout_date) < cutoff;
  return book.publication_date ? new Date(book.publication_date) < cutoff : false;
}

const published = books.filter((b) => b.status === PUBLISHED);
const inProduction = books.filter((b) => b.status !== PUBLISHED);
const sum = (key) => published.reduce((total, b) => total + (Number(b[key]) || 0), 0);

const totalEarned = sum('total_royalty_earned');
const totalPaid = sum('royalty_paid');
const totalPending = sum('royalty_pending');

let situation = 'pending';
if (published.length === 0) situation = 'no_published_books';
else if (totalPending === 0) situation = 'all_paid';
else if (totalPending < MIN_PAYOUT) situation = 'below_threshold';

const cycle = royaltyCycle(today);

const facts = {
  today: fmtDate(today),
  author: { name: author.name, email: author.email },
  published_books: published.map((b) => ({
    title: b.title,
    copies_sold: Number(b.total_copies_sold) || 0,
    royalty_earned: inr(b.total_royalty_earned),
    royalty_paid: inr(b.royalty_paid),
    royalty_pending: inr(b.royalty_pending),
    last_payout: fmtDate(b.last_royalty_payout_date) || 'no payout yet',
    overdue: isOverdue(b),
  })),
  totals: { earned: inr(totalEarned), paid: inr(totalPaid), pending: inr(totalPending) },
  payout_situation: situation,
  quarter_end: fmtDate(cycle.quarterEnd),
  payout_due_by: fmtDate(cycle.dueBy),
  never_paid_books: published.filter((b) => !b.last_royalty_payout_date && b.royalty_pending > 0).map((b) => b.title),
  overdue_books: published.filter(isOverdue).map((b) => b.title),
  books_in_production: inProduction.map((b) => ({
    title: b.title,
    current_stage: String(b.status || '').replace(/^In Production\s*-\s*/i, ''),
  })),
};

const system = `You write royalty summary emails for BookLeaf Publishing, a self-publishing company in India and the US. A BookLeaf team member has asked for this email to be sent to an author, so write it as the BookLeaf Author Support Team.

How royalties work at BookLeaf
- Authors get 80% of the net profit per book and BookLeaf keeps 20%. Net profit is MRP minus printing cost, platform commission (Amazon/Flipkart) and shipping.
- Royalties are calculated quarterly and paid within 45 days after the quarter ends.
- The minimum payout is ₹1,000. Smaller balances roll over to the next quarter.
- Payouts are bank transfers to the account linked in the author's dashboard.

Tone
- Warm and professional. The author is a partner, not a customer to be managed.
- Be specific. Use the exact amounts, dates and numbers you are given. Never round, estimate or invent anything.
- If BookLeaf is at fault (a book appears in overdue_books), own it plainly, apologise for the delay and say the team will review it within 48 hours. Do not deflect.
- Never blame the author for anything.

What to write, in this order
1. "Hi <first name>,"
2. One short line saying this is their royalty summary.
3. Each published book on its own line: title, copies sold, royalty earned, paid and pending.
4. A short totals block with total earned, total paid and total pending.
5. A payout paragraph that matches payout_situation:
   - all_paid: thank them warmly and say everything earned so far has been paid.
   - pending: give the pending amount and say it is expected by payout_due_by (payout for the quarter ending quarter_end).
   - below_threshold: say the pending amount is under the ₹1,000 minimum, so it rolls over to the next quarter and is paid with the next payout once the balance crosses ₹1,000. Do not promise a date.
   - no_published_books: say there are no sales yet and move on to the production update.
   If never_paid_books is not empty, say no payout has been made yet for those titles and explain the quarterly cycle without sounding defensive.
6. If books_in_production is not empty, one short status line per book with its current stage.
7. A warm close with one clear next step (for example: reply to this email if anything looks off, or check the dashboard for the detailed breakdown). Sign off exactly as:
Warm regards,
BookLeaf Author Support Team

Format
- Plain text only. No markdown. Use "- " for list lines.
- The first line must be "SUBJECT: <subject line>", then a blank line, then the email.
- 150 to 300 words.
- Copy the ₹ amounts exactly as they appear in FACTS.`;

const user = `FACTS (JSON)\n${JSON.stringify(facts, null, 2)}\n\nWrite the email now.`;

return [{
  json: {
    notification_id: input.notification_id,
    author_id: input.author_id,
    author_email: author.email,
    model: config.ai_model,
    system,
    user,
    facts,
  },
}];
