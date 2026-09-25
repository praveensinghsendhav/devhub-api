import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../../config/env.js';

/**
 * Encryption at rest for sensitive columns: AES-256-GCM with a key that lives only in the API's
 * environment. A copy of the database alone reveals nothing; the app itself reads plaintext.
 *
 * Stored format: `enc:v1:` + base64(iv ‖ authTag ‖ ciphertext). Values without the prefix are
 * returned as-is, so rows written before encryption was enabled (and empty strings) still read.
 */

const PREFIX = 'enc:v1:';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const key = Buffer.from(env.DB_ENCRYPTION_KEY, 'base64');

/** `context` (e.g. "messages.body") is bound in, so a value can't be copied into another column. */
export function encryptField(plaintext: string, context: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

export function decryptField(stored: string, context: string): string {
  if (!stored.startsWith(PREFIX)) return stored;
  const raw = Buffer.from(stored.slice(PREFIX.length), 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, IV_BYTES));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([
    decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
    decipher.final(),
  ]).toString('utf8');
}
