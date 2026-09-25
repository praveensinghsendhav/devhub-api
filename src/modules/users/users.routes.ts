import { Router } from 'express';
import * as usersController from './users.controller.js';
import { authenticate } from '../../common/middlewares/authenticate.js';
import { authorize } from '../../common/middlewares/authorize.js';

export const usersRouter = Router();

usersRouter.use(authenticate);
usersRouter.get('/', authorize('users:read'), usersController.listUsers);
