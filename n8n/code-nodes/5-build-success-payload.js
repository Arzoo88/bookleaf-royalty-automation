// Code node: "Build success payload"
// This is exactly what gets POSTed back to the Bubble API workflow.

const request = $('Validate request').first().json;
const parsed = $('Parse AI response').first().json;

return [{
  json: {
    notification_id: request.notification_id,
    author_id: request.author_id,
    status: 'Success',
    subject: parsed.subject,
    email_body: parsed.email_body,
    figures_match: parsed.figures_match,
    error_message: '',
    finished_at: new Date().toISOString(),
  },
}];
