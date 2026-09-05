export function renderWelcomeEmailHtml(name: string) {
  const safeName = escapeHtml(name || 'Traveller');
  return `
  <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 480px; margin: 0 auto; background: #fff7ec; padding: 32px 28px; border-radius: 16px;">
    <p style="font-size: 22px; margin: 0 0 4px;">🏎️</p>
    <h1 style="font-size: 22px; margin: 0 0 16px; color: #1a1a1a;">Jaldi Ghar Pahuncho</h1>

    <p style="font-size: 16px; color: #1a1a1a; line-height: 1.5;">Dear ${safeName},</p>

    <p style="font-size: 15px; color: #333; line-height: 1.6;">
      Thank you for racing with us! We hope the traffic wasn't too merciless and the
      "abbeyy oyee!" didn't catch you too many times.
    </p>

    <p style="font-size: 15px; color: #333; line-height: 1.6;">
      If you had fun, <strong>share it with your friends</strong> — send them a screenshot
      of your run and dare them to beat your distance.
    </p>

    <ul style="font-size: 14px; color: #555; line-height: 1.7; padding-left: 18px;">
      <li>This is a one-time note — we don't send you anything else after this.</li>
      <li>Your email was collected only with your consent at sign-up, for this event only.</li>
      <li>Got feedback or a great screenshot? Just reply to this email.</li>
    </ul>

    <p style="font-size: 15px; color: #333; line-height: 1.6; margin-top: 24px;">
      Regards,<br/>
      <strong>Jaldi Ghar Pahuncho Team</strong>
    </p>
  </div>`;
}

export function renderWelcomeEmailText(name: string) {
  const safeName = name || 'Traveller';
  return `Dear ${safeName},

Thank you for racing with us! We hope the traffic wasn't too merciless and the "abbeyy oyee!" didn't catch you too many times.

If you had fun, share it with your friends — send them a screenshot of your run and dare them to beat your distance.

- This is a one-time note — we don't send you anything else after this.
- Your email was collected only with your consent at sign-up, for this event only.
- Got feedback or a great screenshot? Just reply to this email.

Regards,
Jaldi Ghar Pahuncho Team`;
}

function escapeHtml(str: string) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
