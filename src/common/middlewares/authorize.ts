import type { NextFunction, Request, Response } from 'express';
import type { Permission } from '../../shared/index.js';
import { hasPermission } from '../../shared/index.js';
import { AppError } from '../errors/AppError.js';
import { ERROR_CODES } from '../constants/errorCodes.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { RESPONSE_MESSAGES } from '../constants/responseMessages.js';

/**
 * The single RBAC enforcement point. Usage: `router.post('/x', authenticate, authorize('chat:create'), ctrl)`.
 * Never check `req.user.roles` ad hoc elsewhere — route through this so authorization stays in one place.
 */
export function authorize(...required: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(
        new AppError(
          HTTP_STATUS.UNAUTHORIZED,
          ERROR_CODES.UNAUTHORIZED,
          RESPONSE_MESSAGES.UNAUTHORIZED,
        ),
      );
      return;
    }
    if (!hasPermission(req.user.permissions, required)) {
      next(new AppError(HTTP_STATUS.FORBIDDEN, ERROR_CODES.FORBIDDEN, RESPONSE_MESSAGES.FORBIDDEN));
      return;
    }
    next();
  };
}
