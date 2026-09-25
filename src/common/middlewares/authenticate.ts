import type { NextFunction, Request, Response } from 'express';
import * as Sentry from '@sentry/node';
import { verifyAccessToken } from '../utils/jwt.js';
import { getAuthUser } from '../../modules/users/users.service.js';
import { AppError } from '../errors/AppError.js';
import { ERROR_CODES } from '../constants/errorCodes.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';

/** Verifies the access token and attaches `req.user` + `req.deviceId`. Every protected route uses this once. */
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;

  if (!token) {
    throw new AppError(HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.UNAUTHORIZED, 'Missing access token');
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = await getAuthUser(payload.sub);
    req.deviceId = payload.deviceId;
    // ID only — no email or name — so Sentry issues can be grouped per user without storing PII.
    Sentry.setUser({ id: req.user.id });
    next();
  } catch (err) {
    if (err instanceof AppError) {
      next(err);
      return;
    }
    next(
      new AppError(
        HTTP_STATUS.UNAUTHORIZED,
        ERROR_CODES.TOKEN_INVALID,
        'Invalid or expired access token',
      ),
    );
  }
}
