// Turns data/bookleaf_sample_data.json into the three CSV files that get uploaded into Bubble.
// Usage: node scripts/make-csvs.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data', 'bookleaf_sample_data.json'), 'utf8'));

function cell(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers, rows) {
  const lines = [headers.join(',')];
  for (const row of rows) lines.push(headers.map((h) => cell(row[h])).join(','));
  return lines.join('\n') + '\n';
}

const authors = [];
const books = [];
const payouts = [];

for (const a of data.authors) {
  authors.push({
    author_code: a.author_id,
    name: a.name,
    email: a.email,
    phone: a.phone,
    city: a.city,
    joined_date: a.joined_date,
  });

  for (const b of a.books) {
    books.push({
      book_code: b.book_id,
      author_code: a.author_id,
      title: b.title,
      isbn: b.isbn,
      genre: b.genre,
      publication_date: b.publication_date,
      status: b.status,
      mrp: b.mrp,
      royalty_per_copy: b.author_royalty_per_copy,
      total_copies_sold: b.total_copies_sold,
      total_royalty_earned: b.total_royalty_earned,
      royalty_paid: b.royalty_paid,
      royalty_pending: b.royalty_pending,
      last_royalty_payout_date: b.last_royalty_payout_date,
      print_partner: b.print_partner,
      available_on: (b.available_on || []).join(', '),
    });

    // The dataset only has "total paid" and "last payout date" per book, so each book
    // with something paid gets one payout row (amount = total paid so far).
    if (b.royalty_paid > 0 && b.last_royalty_payout_date) {
      payouts.push({
        book_code: b.book_id,
        author_code: a.author_id,
        amount: b.royalty_paid,
        paid_on: b.last_royalty_payout_date,
      });
    }
  }
}

const out = path.join(root, 'bubble', 'data');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'authors.csv'),
  toCsv(['author_code', 'name', 'email', 'phone', 'city', 'joined_date'], authors));
fs.writeFileSync(path.join(out, 'books.csv'),
  toCsv(['book_code', 'author_code', 'title', 'isbn', 'genre', 'publication_date', 'status', 'mrp',
    'royalty_per_copy', 'total_copies_sold', 'total_royalty_earned', 'royalty_paid', 'royalty_pending',
    'last_royalty_payout_date', 'print_partner', 'available_on'], books));
fs.writeFileSync(path.join(out, 'payouts.csv'),
  toCsv(['book_code', 'author_code', 'amount', 'paid_on'], payouts));

console.log(`authors: ${authors.length}, books: ${books.length}, payout rows: ${payouts.length}`);
