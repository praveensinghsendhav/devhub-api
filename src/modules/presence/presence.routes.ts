import { Router } from 'express';
import * as presenceController from './presence.controller.js';
import { updateStatusSchema } from '../auth/auth.validators.js';
import { validate } from '../../common/middlewares/validate.js';
import { authenticate } from '../../common/middlewares/authenticate.js';

export const presenceRouter = Router();

presenceRouter.use(authenticate);
presenceRouter.get('/', presenceController.listStatuses);
presenceRouter.patch('/status', validate(updateStatusSchema), presenceController.updateStatus);
