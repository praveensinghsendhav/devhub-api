import { Router } from 'express';
import { authRouter } from '../modules/auth/auth.routes.js';
import { usersRouter } from '../modules/users/users.routes.js';
import { presenceRouter } from '../modules/presence/presence.routes.js';
import { chatRouter } from '../modules/chat/chat.routes.js';
import { organizationsRouter } from '../modules/organizations/organizations.routes.js';
import { meetingsRouter } from '../modules/meetings/meetings.routes.js';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/organizations', organizationsRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/presence', presenceRouter);
apiRouter.use('/chat', chatRouter);
apiRouter.use('/meetings', meetingsRouter);
