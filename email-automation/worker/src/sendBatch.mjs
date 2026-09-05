import { readFile, writeFile } from 'fs/promises';
import { sendWelcomeEmail } from './sendEmail.mjs';

// Stands in for the `email_job` SpacetimeDB table (see jaldigharpahuncho.md section 4.2)
// until the real module + worker subscription is wired up. Same job-queue shape:
// each row has a status that flips from "pending" to "sent" or "failed".
const QUEUE_PATH = new URL('../signups.json', import.meta.url);

async function loadQueue() {
  const raw = await readFile(QUEUE_PATH, 'utf8');
  return JSON.parse(raw);
}

async function saveQueue(entries) {
  await writeFile(QUEUE_PATH, JSON.stringify(entries, null, 2) + '\n');
}

const entries = await loadQueue();
let sent = 0;
let failed = 0;

for (const entry of entries) {
  if (entry.status !== 'pending') continue;
  try {
    await sendWelcomeEmail(entry.email, entry.name);
    entry.status = 'sent';
    entry.sentAt = new Date().toISOString();
    sent++;
    console.log(`Sent to ${entry.email}`);
  } catch (err) {
    entry.status = 'failed';
    entry.error = err.message;
    failed++;
    console.error(`Failed for ${entry.email}: ${err.message}`);
  }
}

await saveQueue(entries);
console.log(`\nDone. Sent: ${sent}, Failed: ${failed}, Total in queue: ${entries.length}`);
