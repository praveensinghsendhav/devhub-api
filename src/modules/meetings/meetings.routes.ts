import { Router } from 'express';
import * as meetingsController from './meetings.controller.js';
import {
  createMeetingSchema,
  inviteSchema,
  rsvpSchema,
  updateMeetingSchema,
} from './meetings.validators.js';
import { validate } from '../../common/middlewares/validate.js';
import { authenticate } from '../../common/middlewares/authenticate.js';
import { authorize } from '../../common/middlewares/authorize.js';

export const meetingsRouter = Router();

const M = '/:meetingId';

meetingsRouter.use(authenticate);

// Static paths first so they aren't read as a meeting id.
meetingsRouter.get('/calendar', authorize('meeting:read'), meetingsController.getCalendar);
meetingsRouter.get('/upcoming', authorize('meeting:read'), meetingsController.listUpcoming);
meetingsRouter.get('/invitations', authorize('meeting:read'), meetingsController.listInvitations);

meetingsRouter.post(
  '/',
  authorize('meeting:create'),
  validate(createMeetingSchema),
  meetingsController.createMeeting,
);
meetingsRouter.get(M, authorize('meeting:read'), meetingsController.getMeeting);

// Per-meeting host/participant checks happen in the service.
meetingsRouter.patch(
  M,
  authorize('meeting:read'),
  validate(updateMeetingSchema),
  meetingsController.updateMeeting,
);
meetingsRouter.post(`${M}/cancel`, authorize('meeting:read'), meetingsController.cancelMeeting);
meetingsRouter.post(
  `${M}/invite`,
  authorize('meeting:read'),
  validate(inviteSchema),
  meetingsController.invite,
);
meetingsRouter.post(
  `${M}/rsvp`,
  authorize('meeting:read'),
  validate(rsvpSchema),
  meetingsController.respond,
);
meetingsRouter.delete(
  `${M}/participants/:userId`,
  authorize('meeting:read'),
  meetingsController.removeParticipant,
);
