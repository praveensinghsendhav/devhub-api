import type { NextFunction, Request, Response } from 'express';
import * as Sentry from '@sentry/node';
import { ZodError } from 'zod';
import { AppError } from '../errors/AppError.js';
import { sendError } from '../utils/apiResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { ERROR_CODES } from '../constants/errorCodes.js';
import { RESPONSE_MESSAGES } from '../constants/responseMessages.js';
import { logger } from '../../config/logger.js';

/**
 * The one place every error in the app is turned into a response. Controllers/services never
 * format error JSON themselves — they throw (an AppError, or anything), and this normalizes it.
 * Only 5xx errors reach Sentry; 4xx are expected client mistakes.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({ err, path: req.path }, 'Unhandled AppError');
      Sentry.captureException(err);
    }
    sendError(res, err.statusCode, err.code, err.message, err.details);
    return;
  }

  if (err instanceof ZodError) {
    sendError(
      res,
      HTTP_STATUS.UNPROCESSABLE_ENTITY,
      ERROR_CODES.VALIDATION_ERROR,
      RESPONSE_MESSAGES.VALIDATION_ERROR,
      err.issues,
    );
    return;
  }

  logger.error({ err, path: req.path }, 'Unexpected error');
  Sentry.captureException(err);
  sendError(
    res,
    HTTP_STATUS.INTERNAL_SERVER_ERROR,
    ERROR_CODES.INTERNAL_ERROR,
    RESPONSE_MESSAGES.INTERNAL_ERROR,
  );
}
