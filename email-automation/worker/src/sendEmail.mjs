import { pathToFileURL } from 'url';
import { renderWelcomeEmailHtml, renderWelcomeEmailText } from './emailTemplate.mjs';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'Jaldi Ghar Pahuncho <onboarding@resend.dev>';

export async function sendWelcomeEmail(toEmail, name) {
  if (!RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is not set. Copy .env.example to .env and fill it in (see README).');
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: toEmail,
      subject: "🏎️ Jaldi Ghar Pahuncho — Thanks for Racing With Us!",
      html: renderWelcomeEmailHtml(name),
      text: renderWelcomeEmailText(name),
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Resend API error (${res.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

// CLI usage: node src/sendEmail.mjs someone@example.com "Their Name"
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , toEmail, name] = process.argv;
  if (!toEmail) {
    console.error('Usage: node src/sendEmail.mjs <email> [name]');
    process.exit(1);
  }
  try {
    const result = await sendWelcomeEmail(toEmail, name || 'Traveller');
    console.log('Sent:', result);
  } catch (err) {
    console.error('Failed to send:', err.message);
    process.exit(1);
  }
}
