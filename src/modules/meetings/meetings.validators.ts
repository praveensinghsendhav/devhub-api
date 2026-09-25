import { z } from 'zod';
import {
  HOST_ACTIONS,
  MAX_MEETING_INVITEES,
  MEETING_CHAT_MAX_LENGTH,
  MEETING_KINDS,
  MEETING_MEDIA,
  MEETING_REACTIONS,
} from '../../shared/index.js';

const uuid = (label: string) => z.string().uuid(`Invalid ${label}`);
const title = z.string().trim().min(1, 'Give the meeting a title').max(120, 'Title is too long');
const description = z.string().trim().max(2000, 'Description is too long');
const startsAt = z.iso.datetime({ offset: true, message: 'Pick a valid start time' });
const durationMinutes = z.coerce
  .number()
  .int()
  .min(5, 'Meetings are at least 5 minutes')
  .max(8 * 60, 'Meetings can be up to 8 hours');
// Everyone but the host.
const invitees = z.array(uuid('user id')).max(MAX_MEETING_INVITEES - 1, 'Too many people');

export const createMeetingSchema = z
  .object({
    title,
    description: description.optional(),
    kind: z.enum(MEETING_KINDS),
    media: z.enum(MEETING_MEDIA).optional(),
    startsAt: startsAt.optional(),
    durationMinutes: durationMinutes.optional(),
    inviteeIds: invitees,
    allowInvites: z.boolean().optional(),
    muteOnJoin: z.boolean().optional(),
  })
  .refine((v) => v.kind === 'instant' || v.startsAt, {
    message: 'Pick a start time',
    path: ['startsAt'],
  })
  .refine((v) => v.kind === 'scheduled' || v.inviteeIds.length > 0, {
    message: 'Choose who to call',
    path: ['inviteeIds'],
  });
export type CreateMeetingInput = z.infer<typeof createMeetingSchema>;

export const updateMeetingSchema = z.object({
  title: title.optional(),
  description: description.nullable().optional(),
  startsAt: startsAt.optional(),
  durationMinutes: durationMinutes.optional(),
  allowInvites: z.boolean().optional(),
  muteOnJoin: z.boolean().optional(),
});
export type UpdateMeetingInput = z.infer<typeof updateMeetingSchema>;

export const inviteSchema = z.object({
  userIds: invitees.min(1, 'Choose at least one person'),
});

export const rsvpSchema = z.object({ response: z.enum(['accepted', 'tentative', 'declined']) });

/** Calendar window: capped so one request can't scan years of history. */
export const rangeQuerySchema = z
  .object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) })
  .transform((v) => ({ from: new Date(v.from), to: new Date(v.to) }))
  .refine((v) => v.to > v.from, { message: '`to` must be after `from`' })
  .refine((v) => v.to.getTime() - v.from.getTime() <= 62 * 86_400_000, {
    message: 'Ask for at most two months at a time',
  });

export const idParam = (label: string) => uuid(label);

// ── Socket payloads (untrusted) ────────────────────────────────────

const meetingId = uuid('meeting id');
const peerId = z.string().min(1).max(64);

export const joinSocketSchema = z.object({
  meetingId,
  state: z.object({ audio: z.boolean(), video: z.boolean() }),
});

export const meetingOnlySocketSchema = z.object({ meetingId });

/** SDP is big but bounded; anything larger is not a real session description. */
export const signalSocketSchema = z.object({
  meetingId,
  to: peerId,
  data: z
    .object({
      description: z
        .object({
          type: z.enum(['offer', 'answer', 'pranswer', 'rollback']),
          sdp: z.string().max(100_000).optional(),
        })
        .optional(),
      candidate: z
        .object({
          candidate: z.string().max(2_000),
          sdpMid: z.string().max(64).nullable().optional(),
          sdpMLineIndex: z.number().int().min(0).max(64).nullable().optional(),
          usernameFragment: z.string().max(256).nullable().optional(),
        })
        .nullable()
        .optional(),
      videoPref: z.enum(['high', 'low', 'off']).optional(),
    })
    .refine((d) => d.description || d.candidate !== undefined || d.videoPref, 'Empty signal'),
});

export const mediaSocketSchema = z.object({
  meetingId,
  state: z.object({
    audio: z.boolean(),
    video: z.boolean(),
    screen: z.boolean(),
    hand: z.boolean(),
    quality: z.enum(['good', 'fair', 'poor']),
  }),
});

export const chatSocketSchema = z.object({
  meetingId,
  text: z.string().trim().min(1).max(MEETING_CHAT_MAX_LENGTH),
});

export const reactionSocketSchema = z.object({ meetingId, emoji: z.enum(MEETING_REACTIONS) });

export const hostActionSocketSchema = z.object({
  meetingId,
  action: z.enum(HOST_ACTIONS),
  peerId: peerId.optional(),
});

export const admitSocketSchema = z.object({
  meetingId,
  userId: uuid('user id'),
  allow: z.boolean(),
});
