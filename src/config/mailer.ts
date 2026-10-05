import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
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

/**
 * Nodemailer picks a random address across A and AAAA records, so in containers without an IPv6
 * route (most Docker setups) sends fail intermittently with ENETUNREACH. Pin SMTP to IPv4 and keep
 * the real hostname as the TLS servername so certificate checks still pass.
 */
async function resolveSmtpHost(host: string): Promise<string> {
  if (isIP(host)) return host;
  try {
    const { address } = await lookup(host, { family: 4 });
    return address;
  } catch (err) {
    logger.warn({ err }, `Could not resolve an IPv4 address for ${host}; using the hostname`);
    return host;
  }
}

async function getTransporter(): Promise<Transporter | null> {
  if (!env.SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: await resolveSmtpHost(env.SMTP_HOST),
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
      tls: { servername: env.SMTP_HOST },
    });
  }
  return transporter;
}

/** Network-level failures may mean the cached IP went stale; drop it so the next send re-resolves. */
function resetOnNetworkError(err: unknown): void {
  const code = (err as { code?: string } | null)?.code;
  if (code === 'ESOCKET' || code === 'ECONNECTION' || code === 'ETIMEDOUT') transporter = null;
}

/**
 * The one place outbound email leaves the app. Without SMTP configured, development logs the
 * message (so invite links are still usable locally); production refuses to silently drop mail.
 */
export async function sendMail(message: MailMessage): Promise<void> {
  const transport = await getTransporter();

  if (!transport) {
    if (isProduction) throw new Error('SMTP_HOST is not configured — cannot send email');
    logger.warn(
      { to: message.to, subject: message.subject, text: message.text },
      'SMTP not configured — email logged instead of sent',
    );
    return;
  }

  try {
    await transport.sendMail({ from: env.MAIL_FROM, ...message });
  } catch (err) {
    resetOnNetworkError(err);
    throw err;
  }
}

/**
 * Checks the SMTP login once at startup so bad credentials show up immediately, not on the first
 * invite. Never throws — the API still starts, it just warns. Credentials are never logged.
 */
export async function verifyMailer(): Promise<void> {
  const transport = await getTransporter();
  if (!transport) {
    logger.warn('SMTP not configured — emails (like invites) will be logged, not sent');
    return;
  }
  try {
    await transport.verify();
    logger.info(`SMTP ready (${env.SMTP_HOST}:${env.SMTP_PORT})`);
  } catch (err) {
    resetOnNetworkError(err);
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`SMTP check failed for ${env.SMTP_HOST}:${env.SMTP_PORT} — ${message}`);
  }
}

export function appUrl(path: string): string {
  const base = (env.APP_URL ?? env.CLIENT_ORIGIN).replace(/\/+$/, '');
  return `${base}${path}`;
}
