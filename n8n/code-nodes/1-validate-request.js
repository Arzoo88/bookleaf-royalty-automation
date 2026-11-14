// Code node: "Validate request"
// Flattens the webhook body, checks the two required fields, and ignores a notification
// that has already been received.
//
// The main protection against double clicks is in Bubble (it will not create a second Pending
// log for the same author). This is the second layer: one log = one run, so if the same
// notification_id arrives again (e.g. a retried HTTP call) it is marked as a duplicate.
// Limit: workflow static data is only saved when a run finishes, and only for ACTIVE workflows,
// so this catches repeats that arrive after the first run ended, not two calls at the same instant.

const REMEMBER_MS = 10 * 60 * 1000;

const body = $input.first().json.body || {};
const errors = [];
if (!body.notification_id) errors.push('notification_id is required');
if (!body.author_id) errors.push('author_id is required');

const store = $getWorkflowStaticData('global');
store.seen = store.seen || {};

const now = Date.now();
for (const id of Object.keys(store.seen)) {
  if (now - store.seen[id] > REMEMBER_MS) delete store.seen[id];
}

const valid = errors.length === 0;
const duplicate = valid && Boolean(store.seen[body.notification_id]);
if (valid && !duplicate) store.seen[body.notification_id] = now;

return [{ json: { ...body, valid, duplicate, errors } }];
