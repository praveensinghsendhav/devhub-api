import nodemailer, { type Transporter } from 'nodemailer';
import { env, isProduction } from './env.js';
import { logger } from './logger.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!env.SMTP_HOST) return null;
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return transporter;
}

/**
 * The one place outbound email leaves the app. Without SMTP configured, development logs the
 * message (so invite links are still usable locally); production refuses to silently drop mail.
 */
export async function sendMail(message: MailMessage): Promise<void> {
  const transport = getTransporter();

  if (!transport) {
    if (isProduction) throw new Error('SMTP_HOST is not configured — cannot send email');
    logger.warn(
      { to: message.to, subject: message.subject, text: message.text },
      'SMTP not configured — email logged instead of sent',
    );
    return;
  }

  await transport.sendMail({ from: env.MAIL_FROM, ...message });
}

/**
 * Checks the SMTP login once at startup so bad credentials show up immediately, not on the first
 * invite. Never throws — the API still starts, it just warns. Credentials are never logged.
 */
export async function verifyMailer(): Promise<void> {
  const transport = getTransporter();
  if (!transport) {
    logger.warn('SMTP not configured — emails (like invites) will be logged, not sent');
    return;
  }
  try {
    await transport.verify();
    logger.info(`SMTP ready (${env.SMTP_HOST}:${env.SMTP_PORT})`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`SMTP check failed for ${env.SMTP_HOST}:${env.SMTP_PORT} — ${message}`);
  }
}

export function appUrl(path: string): string {
  const base = (env.APP_URL ?? env.CLIENT_ORIGIN).replace(/\/+$/, '');
  return `${base}${path}`;
}
