import type { Request, Response } from 'express';
import { SOCKET_EVENTS } from '../../shared/index.js';
import * as presenceService from './presence.service.js';
import type { UpdateStatusInput } from '../auth/auth.validators.js';
import { sendSuccess } from '../../common/utils/apiResponse.js';
import { HTTP_STATUS } from '../../common/constants/httpStatus.js';
import { getIO } from '../../websocket/index.js';
import { presenceRoom } from '../../websocket/rooms.js';
import { UserModel } from '../../models/user.model.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function updateStatus(req: Request, res: Response): Promise<void> {
  const { status, customStatus } = req.body as UpdateStatusInput;
  const payload = await presenceService.setManualStatus(req.user!.id, status, customStatus ?? null);
  getIO()
    .to(presenceRoom(req.user!.organization?.id ?? null))
    .emit(SOCKET_EVENTS.PRESENCE_UPDATE, payload);
  sendSuccess(res, HTTP_STATUS.OK, payload);
}

export async function listStatuses(req: Request, res: Response): Promise<void> {
  const requested = String(req.query.userIds ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => UUID.test(id))
    .slice(0, 500);
  // Only reveal presence for people in the caller's own organization.
  const visible = await UserModel.findActiveInOrganization(
    requested,
    req.user!.organization?.id ?? null,
  );
  const statuses = await presenceService.getStatuses(visible.map((u) => u.id));
  sendSuccess(res, HTTP_STATUS.OK, statuses);
}
