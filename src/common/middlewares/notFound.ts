import type { Request, Response } from 'express';
import { sendError } from '../utils/apiResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { ERROR_CODES } from '../constants/errorCodes.js';
import { RESPONSE_MESSAGES } from '../constants/responseMessages.js';

export function notFound(req: Request, res: Response): void {
  sendError(
    res,
    HTTP_STATUS.NOT_FOUND,
    ERROR_CODES.NOT_FOUND,
    `${RESPONSE_MESSAGES.NOT_FOUND}: ${req.method} ${req.originalUrl}`,
  );
}
