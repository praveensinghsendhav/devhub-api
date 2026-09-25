import rateLimit from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import type { Request, Response } from 'express';
import { rateLimitRedisClient } from '../../config/redis.js';
import { sendError } from '../utils/apiResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { ERROR_CODES } from '../constants/errorCodes.js';
import { RESPONSE_MESSAGES } from '../constants/responseMessages.js';

function rateLimitHandler(_req: Request, res: Response): void {
  sendError(
    res,
    HTTP_STATUS.TOO_MANY_REQUESTS,
    ERROR_CODES.RATE_LIMITED,
    RESPONSE_MESSAGES.RATE_LIMITED,
  );
}

function makeStore(prefix: string) {
  return new RedisStore({
    prefix,
    sendCommand: (command: string, ...args: string[]) =>
      rateLimitRedisClient.call(command, ...args) as Promise<RedisReply>,
  });
}

/** General API traffic: generous, per-IP+user. */
export const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore('rl:api:'),
  handler: rateLimitHandler,
});

/**
 * Session refresh: its own budget so page loads and token renewals never eat into the login limit.
 * The refresh token is a 64-byte random, httpOnly cookie, so there's nothing to brute-force here.
 */
export const refreshLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore('rl:refresh:'),
  handler: rateLimitHandler,
});

/** Login/signup/invites: tight, to blunt credential-stuffing and brute force. */
export const authLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore('rl:auth:'),
  handler: rateLimitHandler,
});
