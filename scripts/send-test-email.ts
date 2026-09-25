/**
 * Sends one test email through the configured SMTP settings.
 * Usage: npm run mail:test -- you@example.com
 */
import { env } from '../src/config/env.js';
import { sendMail } from '../src/config/mailer.js';

const to = process.argv[2];

if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
  console.error('Usage: npm run mail:test -- you@example.com');
  process.exit(1);
}

if (!env.SMTP_HOST) {
  console.error('SMTP_HOST is not set in .env — nothing to test.');
  process.exit(1);
}

try {
  await sendMail({
    to,
    subject: 'DevHub SMTP test',
    text: `If you can read this, DevHub can send email through ${env.SMTP_HOST}.`,
    html: `<p>If you can read this, <strong>DevHub</strong> can send email through ${env.SMTP_HOST}.</p>`,
  });
  console.log(
    `Sent a test email to ${to} via ${env.SMTP_HOST}:${env.SMTP_PORT}. Check the inbox (and spam).`,
  );
  process.exit(0);
} catch (err) {
  console.error(`Failed to send: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
