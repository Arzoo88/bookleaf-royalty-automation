// Sends a test request to the n8n webhook with the full author + books in the body,
// so you can test the n8n workflow on its own, before the Bubble side exists.
//
// Usage: node scripts/send-test-webhook.js <webhook-url> <api-key> [AUTH003]
// Tip: while testing, point "bubble_callback_url" in the Config node at a webhook.site URL
// so you can see the callback that Bubble would receive.
const dataset = require('../data/bookleaf_sample_data.json');

const [url, apiKey, authorId = 'AUTH003'] = process.argv.slice(2);
if (!url || !apiKey) {
  console.log('Usage: node scripts/send-test-webhook.js <webhook-url> <api-key> [AUTH003]');
  process.exit(1);
}

const author = dataset.authors.find((a) => a.author_id === authorId);
if (!author) {
  console.log(`No author with id ${authorId} in the dataset`);
  process.exit(1);
}

const payload = {
  notification_id: `test-${Date.now()}`,
  author_id: author.author_id,
  author_name: author.name,
  author_email: author.email,
  books: author.books.map((b) => ({
    title: b.title,
    status: b.status,
    publication_date: b.publication_date,
    total_copies_sold: b.total_copies_sold,
    total_royalty_earned: b.total_royalty_earned,
    royalty_paid: b.royalty_paid,
    royalty_pending: b.royalty_pending,
    last_royalty_payout_date: b.last_royalty_payout_date,
  })),
};

fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
  body: JSON.stringify(payload),
})
  .then(async (res) => console.log(res.status, await res.text()))
  .catch((err) => console.error('Request failed:', err.message));
