import type { HttpStatus } from '../constants/httpStatus.js';
import type { ErrorCode } from '../constants/errorCodes.js';

/** Every intentionally-thrown error in the app should be (or extend) this class. */
export class AppError extends Error {
  public readonly statusCode: HttpStatus;
  public readonly code: ErrorCode;
  public readonly details?: unknown;
  public readonly isOperational = true;

  constructor(statusCode: HttpStatus, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace?.(this, this.constructor);
  }
}
