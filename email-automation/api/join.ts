import { renderWelcomeEmailHtml, renderWelcomeEmailText } from './_emailTemplate';

// Vercel Node serverless function — runs server-side only, so RESEND_API_KEY
// (set in the Vercel project's Environment Variables, never committed) never
// reaches the browser bundle. The join form calls POST /api/join right when
// someone submits, so every signup gets the email without any manual step.
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const { name, email, consent } = req.body ?? {};

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    res.status(400).json({ ok: false, error: 'A valid email is required' });
    return;
  }
  if (!consent) {
    res.status(400).json({ ok: false, error: 'Consent is required' });
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    res.status(500).json({ ok: false, error: 'RESEND_API_KEY is not configured on the server' });
    return;
  }

  const fromEmail = process.env.FROM_EMAIL || 'Jaldi Ghar Pahuncho <onboarding@resend.dev>';
  const safeName = typeof name === 'string' && name.trim() ? name.trim() : 'Traveller';

  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: email,
        subject: '🏎️ Jaldi Ghar Pahuncho — Thanks for Racing With Us!',
        html: renderWelcomeEmailHtml(safeName),
        text: renderWelcomeEmailText(safeName),
      }),
    });

    const body = await resendRes.json().catch(() => ({}));
    if (!resendRes.ok) {
      console.error('Resend error:', body);
      res.status(502).json({ ok: false, error: 'Failed to send email' });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('join handler error:', err);
    res.status(500).json({ ok: false, error: 'Unexpected server error' });
  }
}
