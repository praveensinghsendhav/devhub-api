import type { Request, Response } from 'express';
import * as organizationsService from './organizations.service.js';
import { inviteIdSchema, type CreateInvitesInput } from './organizations.validators.js';
import { sendSuccess } from '../../common/utils/apiResponse.js';
import { HTTP_STATUS } from '../../common/constants/httpStatus.js';
import { RESPONSE_MESSAGES } from '../../common/constants/responseMessages.js';
import { getParam } from '../../common/utils/requestParams.js';

export async function getCurrent(req: Request, res: Response): Promise<void> {
  sendSuccess(res, HTTP_STATUS.OK, await organizationsService.getCurrentOrganization(req.user!));
}

export async function listMembers(req: Request, res: Response): Promise<void> {
  sendSuccess(res, HTTP_STATUS.OK, await organizationsService.listMembers(req.user!));
}

export async function listInvites(req: Request, res: Response): Promise<void> {
  sendSuccess(res, HTTP_STATUS.OK, await organizationsService.listInvites(req.user!));
}

export async function createInvites(req: Request, res: Response): Promise<void> {
  const result = await organizationsService.createInvites(
    req.user!,
    req.body as CreateInvitesInput,
  );
  sendSuccess(res, HTTP_STATUS.CREATED, result, { message: RESPONSE_MESSAGES.INVITES_SENT });
}

export async function revokeInvite(req: Request, res: Response): Promise<void> {
  const inviteId = inviteIdSchema.parse(getParam(req, 'inviteId'));
  await organizationsService.revokeInvite(req.user!, inviteId);
  sendSuccess(res, HTTP_STATUS.OK, null, { message: RESPONSE_MESSAGES.INVITE_REVOKED });
}
