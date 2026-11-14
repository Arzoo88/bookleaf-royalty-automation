// Code node: "Normalize Bubble data"
// Bubble's Data API names fields with a type suffix, e.g. title_text, royalty_pending_number,
// author_custom_author. This strips the suffix so the rest of the workflow can just use
// title, royalty_pending, author, ...

const SUFFIX = /_(text|number|boolean|date|image|file|geographic_address)$|_list_.+$|_option_.+$|_custom_.+$/;
const BUILT_IN = ['Created Date', 'Modified Date', 'Created By', 'Slug'];

function clean(record) {
  const out = {};
  for (const [key, value] of Object.entries(record || {})) {
    if (key === '_id') {
      out.id = value;
    } else if (!BUILT_IN.includes(key)) {
      out[key.replace(SUFFIX, '')] = value;
    }
  }
  return out;
}

const request = $('Validate request').first().json;
const authorResponse = $('Fetch author').first().json;
const booksResponse = $('Fetch books').first().json;

const author = clean(authorResponse.response);
const books = ((booksResponse.response || {}).results || []).map(clean);

return [{
  json: {
    notification_id: request.notification_id,
    author_id: request.author_id,
    author,
    books,
  },
}];
