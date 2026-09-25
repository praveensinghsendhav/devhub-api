import type { Request, Response } from 'express';
import * as meetingsService from './meetings.service.js';
import { idParam, rangeQuerySchema } from './meetings.validators.js';
import { sendSuccess } from '../../common/utils/apiResponse.js';
import { HTTP_STATUS } from '../../common/constants/httpStatus.js';
import { getParam } from '../../common/utils/requestParams.js';

const meetingIdOf = (req: Request) => idParam('meeting id').parse(getParam(req, 'meetingId'));
const userIdOf = (req: Request) => idParam('user id').parse(getParam(req, 'userId'));

export async function getCalendar(req: Request, res: Response): Promise<void> {
  const { from, to } = rangeQuerySchema.parse(req.query);
  sendSuccess(res, HTTP_STATUS.OK, await meetingsService.getCalendar(req.user!, from, to));
}

export async function listUpcoming(req: Request, res: Response): Promise<void> {
  sendSuccess(res, HTTP_STATUS.OK, await meetingsService.listUpcoming(req.user!.id));
}

export async function listInvitations(req: Request, res: Response): Promise<void> {
  sendSuccess(res, HTTP_STATUS.OK, await meetingsService.listInvitations(req.user!.id));
}

export async function getMeeting(req: Request, res: Response): Promise<void> {
  sendSuccess(
    res,
    HTTP_STATUS.OK,
    await meetingsService.getMeeting(req.user!.id, meetingIdOf(req)),
  );
}

export async function createMeeting(req: Request, res: Response): Promise<void> {
  sendSuccess(res, HTTP_STATUS.CREATED, await meetingsService.createMeeting(req.user!, req.body));
}

export async function updateMeeting(req: Request, res: Response): Promise<void> {
  const meeting = await meetingsService.updateMeeting(req.user!, meetingIdOf(req), req.body);
  sendSuccess(res, HTTP_STATUS.OK, meeting);
}

export async function cancelMeeting(req: Request, res: Response): Promise<void> {
  sendSuccess(
    res,
    HTTP_STATUS.OK,
    await meetingsService.cancelMeeting(req.user!, meetingIdOf(req)),
  );
}

export async function invite(req: Request, res: Response): Promise<void> {
  const meeting = await meetingsService.inviteToMeeting(
    req.user!,
    meetingIdOf(req),
    req.body.userIds,
  );
  sendSuccess(res, HTTP_STATUS.OK, meeting);
}

export async function respond(req: Request, res: Response): Promise<void> {
  const meeting = await meetingsService.respond(req.user!, meetingIdOf(req), req.body.response);
  sendSuccess(res, HTTP_STATUS.OK, meeting);
}

export async function removeParticipant(req: Request, res: Response): Promise<void> {
  const meeting = await meetingsService.removeParticipant(
    req.user!,
    meetingIdOf(req),
    userIdOf(req),
  );
  sendSuccess(res, HTTP_STATUS.OK, meeting);
}
