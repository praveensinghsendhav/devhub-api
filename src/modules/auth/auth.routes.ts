import { Router } from 'express';
import * as authController from './auth.controller.js';
import { loginSchema } from './auth.validators.js';
import {
  acceptInviteSchema,
  previewInviteSchema,
  registerOrganizationSchema,
} from '../organizations/organizations.validators.js';
import { validate } from '../../common/middlewares/validate.js';
import { requireDeviceId } from '../../common/middlewares/requireDeviceId.js';
import { authenticate } from '../../common/middlewares/authenticate.js';
import { authLimiter, refreshLimiter } from '../../common/middlewares/rateLimiter.js';

export const authRouter = Router();

authRouter.post(
  '/login',
  authLimiter,
  requireDeviceId,
  validate(loginSchema),
  authController.login,
);
authRouter.post(
  '/register',
  authLimiter,
  requireDeviceId,
  validate(registerOrganizationSchema),
  authController.register,
);
// Invite tokens travel in the body, not the URL, so they never land in request logs.
authRouter.post(
  '/invites/preview',
  authLimiter,
  validate(previewInviteSchema),
  authController.previewInvite,
);
authRouter.post(
  '/invites/accept',
  authLimiter,
  requireDeviceId,
  validate(acceptInviteSchema),
  authController.acceptInvite,
);
authRouter.post('/refresh', refreshLimiter, requireDeviceId, authController.refresh);
authRouter.post('/logout', authenticate, authController.logout);
authRouter.get('/me', authenticate, authController.me);
