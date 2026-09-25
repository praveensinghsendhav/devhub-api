import { Router } from 'express';
import * as organizationsController from './organizations.controller.js';
import { createInvitesSchema } from './organizations.validators.js';
import { validate } from '../../common/middlewares/validate.js';
import { authenticate } from '../../common/middlewares/authenticate.js';
import { authorize } from '../../common/middlewares/authorize.js';
import { authLimiter } from '../../common/middlewares/rateLimiter.js';

export const organizationsRouter = Router();

organizationsRouter.use(authenticate);
organizationsRouter.get('/current', organizationsController.getCurrent);
organizationsRouter.get(
  '/current/members',
  authorize('users:read'),
  organizationsController.listMembers,
);
organizationsRouter.get(
  '/current/invites',
  authorize('users:manage'),
  organizationsController.listInvites,
);
organizationsRouter.post(
  '/current/invites',
  // Each call can send up to 20 emails, so it shares the tight auth limiter to curb abuse.
  authLimiter,
  authorize('users:manage'),
  validate(createInvitesSchema),
  organizationsController.createInvites,
);
organizationsRouter.delete(
  '/current/invites/:inviteId',
  authorize('users:manage'),
  organizationsController.revokeInvite,
);
