// Code node: "Parse AI response"
// Works with both Anthropic and OpenAI response shapes. Throwing here sends the run down the
// error branch, which marks the notification as Failed in Bubble.

const res = $input.first().json;
const raw = (res.content && res.content[0] && res.content[0].text)
  || (res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content)
  || '';
const text = String(raw).trim();

const match = text.match(/^SUBJECT:\s*(.+?)\r?\n+([\s\S]+)$/i);
if (!match) throw new Error('AI reply was not in the expected "SUBJECT: ..." + body format');

const subject = match[1].trim();
const emailBody = match[2].trim();
if (emailBody.length < 100) throw new Error('AI email body looks too short to send');

// Quick check that the three headline numbers made it into the email unchanged.
const facts = $('Build prompt').first().json.facts;
const figuresMatch = [facts.totals.earned, facts.totals.paid, facts.totals.pending]
  .every((amount) => emailBody.includes(amount));

return [{ json: { subject, email_body: emailBody, figures_match: figuresMatch } }];
