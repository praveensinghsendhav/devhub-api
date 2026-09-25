import type { Response } from 'express';
import type { ApiErrorResponse, ApiSuccessResponse } from '../../shared/index.js';
import type { HttpStatus } from '../constants/httpStatus.js';
import type { ErrorCode } from '../constants/errorCodes.js';

/** Every success response in the app goes through this — one envelope shape, everywhere. */
export function sendSuccess<T>(
  res: Response,
  statusCode: HttpStatus,
  data: T,
  meta?: Record<string, unknown> | null,
): void {
  const body: ApiSuccessResponse<T> = { success: true, data, meta: meta ?? null };
  res.status(statusCode).json(body);
}

export function sendError(
  res: Response,
  statusCode: HttpStatus,
  code: ErrorCode,
  message: string,
  details?: unknown,
): void {
  const body: ApiErrorResponse = { success: false, error: { code, message, details } };
  res.status(statusCode).json(body);
}
