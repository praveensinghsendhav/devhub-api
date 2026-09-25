import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/AppError.js';
import { ERROR_CODES } from '../constants/errorCodes.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';

export const DEVICE_ID_HEADER = 'x-device-id';

/**
 * Requires the client to identify which device it's on. This is what lets one user be signed
 * in on several devices at once, each with its own refresh token that can be revoked independently.
 */
export function requireDeviceId(req: Request, _res: Response, next: NextFunction): void {
  const deviceId = req.headers[DEVICE_ID_HEADER];
  if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 128) {
    next(
      new AppError(
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
        `Missing or invalid ${DEVICE_ID_HEADER} header`,
      ),
    );
    return;
  }
  req.deviceId = deviceId;
  next();
}
