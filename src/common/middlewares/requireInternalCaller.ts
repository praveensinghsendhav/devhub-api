import { createHash, timingSafeEqual } from 'node:crypto';
import { BlockList, isIPv6 } from 'node:net';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../../config/env.js';
import { sendError } from '../utils/apiResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { ERROR_CODES } from '../constants/errorCodes.js';
import { RESPONSE_MESSAGES } from '../constants/responseMessages.js';

const allowAll = env.INTERNAL_API_ALLOWED_IPS.trim() === '*';
const allowed = new BlockList();
for (const entry of env.INTERNAL_API_ALLOWED_IPS.split(',').map((s) => s.trim())) {
  if (!entry || entry === '*') continue;
  const [address, prefix] = entry.split('/');
  const type = isIPv6(address!) ? 'ipv6' : 'ipv4';
  if (prefix) allowed.addSubnet(address!, Number(prefix), type);
  else allowed.addAddress(address!, type);
}

/** "::ffff:127.0.0.1" (IPv4 on a dual-stack socket) → "127.0.0.1". */
function normalize(address: string): string {
  return address.startsWith('::ffff:') ? address.slice(7) : address;
}

const INTERNAL_SECRET_HEADER = 'x-internal-secret';
const digest = (value: string) => createHash('sha256').update(value).digest();
const expectedSecret = env.INTERNAL_API_SECRET ? digest(env.INTERNAL_API_SECRET) : null;

/** Constant-time compare (hashing first makes the lengths equal). */
function hasValidSecret(req: Request): boolean {
  const sent = req.headers[INTERNAL_SECRET_HEADER];
  return (
    expectedSecret !== null &&
    typeof sent === 'string' &&
    timingSafeEqual(digest(sent), expectedSecret)
  );
}

/**
 * The REST API is only called by the Next.js server (devhub-web: src/app/api/[...path]/route.ts).
 * It passes by sending INTERNAL_API_SECRET (hosted setups like Vercel, where its address changes)
 * or by calling from an allowed TCP peer address — not X-Forwarded-For, which a client could
 * fake. Anyone else gets 404, so browsers can't reach the API directly.
 */
export function requireInternalCaller(req: Request, res: Response, next: NextFunction): void {
  const peer = req.socket.remoteAddress;
  if (
    allowAll ||
    hasValidSecret(req) ||
    (peer && allowed.check(normalize(peer), isIPv6(normalize(peer)) ? 'ipv6' : 'ipv4'))
  ) {
    next();
    return;
  }
  sendError(res, HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND, RESPONSE_MESSAGES.NOT_FOUND);
}
