// Runs the n8n Code node scripts outside n8n, with small stand-ins for n8n's built-in helpers,
// so the logic can be checked against the real dataset without opening the n8n editor.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const dataset = require('../data/bookleaf_sample_data.json');
const codeDir = path.join(__dirname, '..', 'n8n', 'code-nodes');

function runNode(file, { json = {}, nodes = {}, staticData = {} } = {}) {
  const code = fs.readFileSync(path.join(codeDir, file), 'utf8');
  const $input = { first: () => ({ json }), all: () => [{ json }] };
  const $ = (name) => ({ first: () => ({ json: nodes[name] }) });
  const fn = new Function('$input', '$json', '$', '$getWorkflowStaticData', code);
  return fn($input, json, $, () => staticData)[0].json;
}

// Bubble would give us snake_case fields like these (same names as the dataset, renamed a bit).
function authorWithBooks(authorId, today = '2026-11-11T06:00:00Z') {
  const a = dataset.authors.find((x) => x.author_id === authorId);
  const books = a.books.map((b) => ({
    title: b.title, status: b.status, publication_date: b.publication_date,
    total_copies_sold: b.total_copies_sold, total_royalty_earned: b.total_royalty_earned,
    royalty_paid: b.royalty_paid, royalty_pending: b.royalty_pending,
    last_royalty_payout_date: b.last_royalty_payout_date,
  }));
  return { notification_id: 'n1', author_id: authorId, author_name: a.name, author_email: a.email, books, today };
}
const prompt = (authorId, today) => runNode('3-build-prompt.js', {
  json: authorWithBooks(authorId, today),
  nodes: { Config: { ai_model: 'test-model' } },
});

test('validate: rejects missing fields', () => {
  const out = runNode('1-validate-request.js', { json: { body: { author_id: 'a1' } } });
  assert.strictEqual(out.valid, false);
  assert.deepStrictEqual(out.errors, ['notification_id is required']);
});

test('validate: the same notification arriving twice is a duplicate, a new one is fine', () => {
  const staticData = {};
  const call = (notification) => runNode('1-validate-request.js', { json: { body: { notification_id: notification, author_id: 'a1' } }, staticData });
  assert.strictEqual(call('n1').duplicate, false);
  assert.strictEqual(call('n1').duplicate, true);
  assert.strictEqual(call('n2').duplicate, false);
});

test('normalize: strips Bubble type suffixes and keeps the id', () => {
  const out = runNode('2-normalize-bubble-data.js', {
    nodes: {
      'Validate request': { notification_id: 'n1', author_id: 'abc' },
      'Fetch author': { response: { _id: 'abc', name_text: 'Ananya Reddy', 'Created Date': 'x' } },
      'Fetch books': { response: { results: [{ _id: 'b1', title_text: 'Between Two Temples', royalty_pending_number: 2546, author_custom_author: 'abc', status_option_bookstatus: 'Published & Live' }] } },
    },
  });
  assert.strictEqual(out.author.name, 'Ananya Reddy');
  assert.strictEqual(out.author.id, 'abc');
  assert.deepStrictEqual(out.books[0], { id: 'b1', title: 'Between Two Temples', royalty_pending: 2546, author: 'abc', status: 'Published & Live' });
});

test('prompt: author who has never been paid is flagged and the payout date is right', () => {
  const { facts } = prompt('AUTH003');
  assert.strictEqual(facts.payout_situation, 'pending');
  assert.deepStrictEqual(facts.never_paid_books, ['Between Two Temples']);
  assert.deepStrictEqual(facts.overdue_books, ['Between Two Temples']);
  assert.strictEqual(facts.totals.pending, '₹2,546');
  // 11 Nov 2026: the quarter that ended 30 Sep still has its 45-day window open (until 14 Nov)
  assert.match(facts.quarter_end, /^30 Sep(t)? 2026$/);
  assert.strictEqual(facts.payout_due_by, '14 Nov 2026');
});

test('prompt: once the window has passed, the next payout is the current quarter', () => {
  const { facts } = prompt('AUTH003', '2026-11-20T06:00:00Z');
  assert.strictEqual(facts.quarter_end, '31 Dec 2026');
  assert.strictEqual(facts.payout_due_by, '14 Feb 2027');
});

test('prompt: fully paid author gets all_paid and nothing overdue', () => {
  const { facts } = prompt('AUTH008');
  assert.strictEqual(facts.payout_situation, 'all_paid');
  assert.deepStrictEqual(facts.overdue_books, []);
  assert.strictEqual(facts.totals.pending, '₹0');
});

test('prompt: pending under ₹1,000 rolls over, and the book in production is reported', () => {
  const { facts } = prompt('AUTH009');
  assert.strictEqual(facts.payout_situation, 'below_threshold');
  assert.strictEqual(facts.totals.pending, '₹850');
  assert.deepStrictEqual(facts.books_in_production, [{ title: 'Raising Roots', current_stage: 'Typesetting' }]);
  assert.strictEqual(facts.published_books.length, 1);
});

test('prompt: three-book author with one still in production', () => {
  const { facts, system, user } = prompt('AUTH007');
  assert.strictEqual(facts.published_books.length, 2);
  assert.strictEqual(facts.books_in_production[0].current_stage, 'Cover Design');
  assert.strictEqual(facts.totals.earned, '₹60,865');
  assert.ok(system.includes('SUBJECT:'));
  assert.ok(user.includes('₹60,865'));
});

test('parse: accepts the expected format and checks the headline numbers', () => {
  const facts = { totals: { earned: '₹100', paid: '₹60', pending: '₹40' } };
  const body = 'Hi Sam,\n\nHere is your royalty summary. Total earned ₹100, paid ₹60, pending ₹40. '.padEnd(140, 'x') + '\n\nWarm regards,\nBookLeaf Author Support Team';
  const out = runNode('4-parse-ai-response.js', {
    json: { content: [{ type: 'text', text: `SUBJECT: Your royalty summary\n\n${body}` }] },
    nodes: { 'Build prompt': { facts } },
  });
  assert.strictEqual(out.subject, 'Your royalty summary');
  assert.strictEqual(out.figures_match, true);
});

test('parse: throws when the reply is not in the expected format', () => {
  assert.throws(() => runNode('4-parse-ai-response.js', {
    json: { choices: [{ message: { content: 'Sorry, I cannot help with that.' } }] },
    nodes: { 'Build prompt': { facts: { totals: {} } } },
  }), /expected/);
});

test('failure payload: copes with string and object errors', () => {
  const nodes = { 'Validate request': { notification_id: 'n1', author_id: 'a1' } };
  assert.strictEqual(runNode('6-build-failure-payload.js', { json: { error: 'boom' }, nodes }).error_message, 'boom');
  assert.strictEqual(runNode('6-build-failure-payload.js', { json: { error: { message: 'timeout' } }, nodes }).error_message, 'timeout');
  const out = runNode('6-build-failure-payload.js', { json: {}, nodes });
  assert.strictEqual(out.status, 'Failed');
  assert.strictEqual(out.notification_id, 'n1');
});
