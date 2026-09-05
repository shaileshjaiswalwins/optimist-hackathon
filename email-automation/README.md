# Welcome Email Automation

Sends every player who joins the game an automated "thanks for playing" email.
Built as a self-contained extension — drop it into whichever repo actually
hosts the game.

## What's in here

- **`api/join.ts`** — a Vercel serverless function. Call it with
  `POST /api/join` and it emails the player via [Resend](https://resend.com).
  This is the piece that makes sending *automatic* — no manual step per signup.
- **`api/_emailTemplate.ts`** — the actual email copy (HTML + plain text).
- **`worker/`** — a standalone Node CLI for manually sending one-off emails or
  batch-processing a local queue. Useful for testing, or for admin use outside
  the game's own deploy. Not required if `api/join.ts` is wired up.

## How to integrate into the game repo

1. Copy `api/join.ts` and `api/_emailTemplate.ts` into the game's own `api/`
   directory (must sit at the root Vercel deploys, e.g. next to the game's
   `package.json` if that's the Vercel project root).
2. On the join form, after the player submits, fire this request in the
   background (don't block game start on it):

   ```ts
   fetch('/api/join', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ name, email, consent }),
   }).catch((err) => console.error('Welcome email request failed:', err));
   ```

   Requires the join form to actually collect `name`, `email`, and a
   `consent` checkbox (boolean) — the function rejects the request without
   a valid email and `consent: true`.

3. In the Vercel project's dashboard → **Settings → Environment Variables**,
   set:
   - `RESEND_API_KEY` — from resend.com (a key has already been generated for
     this project; ask Tannita for it rather than creating a new one)
   - `FROM_EMAIL` — e.g. `Jaldi Ghar Pahuncho <team@yourdomain.com>` (see
     domain step below)

4. **Before this can email real attendees**, verify a domain at
   [resend.com/domains](https://resend.com/domains) (a few DNS records) and
   point `FROM_EMAIL` at that domain. Until then, Resend only allows sending
   to the account's own verified address (sandbox mode) — fine for testing,
   not for the live event.

## Testing without deploying

`api/join.ts` is a Vercel serverless function — it will **not** respond via
a plain `vite`/`next dev` server. Either run `vercel dev`, or test after
deploying. Alternatively, use the standalone CLI in `worker/` for a manual
sanity check:

```bash
cd worker
cp .env.example .env   # fill in RESEND_API_KEY
npm run send you@example.com "Your Name"
```

## Email copy

Starts with "Dear Traveller," ends with "Regards, Jaldi Ghar Pahuncho Team",
and includes a line encouraging players to share a screenshot with friends.
Edit `api/_emailTemplate.ts` to change wording.
