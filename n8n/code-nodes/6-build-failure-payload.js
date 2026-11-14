// Code node: "Build failure payload"
// Every error branch in the workflow ends up here (Data API down, AI call failed,
// bad AI output, email send failed). It turns the error into the same callback format.

const request = $('Validate request').first().json;
const err = $json.error;

let message = 'Unknown error';
if (typeof err === 'string') message = err;
else if (err) message = err.message || err.description || JSON.stringify(err);
else if ($json.message) message = $json.message;

return [{
  json: {
    notification_id: request.notification_id,
    author_id: request.author_id,
    status: 'Failed',
    subject: '',
    email_body: '',
    figures_match: false,
    error_message: String(message).slice(0, 500),
    finished_at: new Date().toISOString(),
  },
}];
