import {
  MAX_MEETING_INVITEES,
  hasPermission,
  type Announcement,
  type AuthUser,
  type Meeting,
  type MeetingParticipant,
  type MeetingRingPayload,
  type RsvpResponse,
} from '../../shared/index.js';
import * as Sentry from '@sentry/node';
import { db } from '../../db/knex.js';
import {
  MeetingModel,
  type MeetingParticipantDetailRow,
  type MeetingParticipantRow,
  type MeetingRow,
} from '../../models/meeting.model.js';
import { MessageModel } from '../../models/message.model.js';
import { UserModel } from '../../models/user.model.js';
import { AppError } from '../../common/errors/AppError.js';
import { ERROR_CODES } from '../../common/constants/errorCodes.js';
import { HTTP_STATUS } from '../../common/constants/httpStatus.js';
import * as realtime from './meetings.realtime.js';
import * as live from './meetings.live.js';
import type { CreateMeetingInput, UpdateMeetingInput } from './meetings.validators.js';

// ── Errors ─────────────────────────────────────────────────────────

const forbidden = (message: string) =>
  new AppError(HTTP_STATUS.FORBIDDEN, ERROR_CODES.FORBIDDEN, message);
const notFound = (message: string) =>
  new AppError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND, message);
const badRequest = (message: string) =>
  new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, message);

const DEFAULT_INSTANT_MINUTES = 60;
const DEFAULT_SCHEDULED_MINUTES = 30;
/** Small grace so "start now" from a slow form still counts as not-in-the-past. */
const PAST_GRACE_MS = 5 * 60_000;

// ── Mapping ────────────────────────────────────────────────────────

function toParticipant(row: MeetingParticipantDetailRow): MeetingParticipant {
  return {
    userId: row.user_id,
    name: row.name,
    email: row.email,
    avatarUrl: row.avatar_url,
    role: row.role,
    rsvp: row.rsvp,
    invitedBy: row.invited_by,
  };
}

async function buildMeetings(userId: string, rows: MeetingRow[]): Promise<Meeting[]> {
  if (rows.length === 0) return [];
  const participants = await MeetingModel.getParticipants(rows.map((r) => r.id));
  const byMeeting = new Map<string, MeetingParticipantDetailRow[]>();
  for (const p of participants) {
    byMeeting.set(p.meeting_id, [...(byMeeting.get(p.meeting_id) ?? []), p]);
  }

  return rows.flatMap((row) => {
    const list = byMeeting.get(row.id) ?? [];
    const self = list.find((p) => p.user_id === userId);
    if (!self) return [];
    const isModerator = self.role === 'host' || self.role === 'cohost';
    return [
      {
        id: row.id,
        title: row.title,
        description: row.description,
        kind: row.kind,
        media: row.media,
        status: row.status,
        startsAt: row.starts_at.toISOString(),
        endsAt: row.ends_at.toISOString(),
        startedAt: row.started_at ? row.started_at.toISOString() : null,
        endedAt: row.ended_at ? row.ended_at.toISOString() : null,
        createdBy: row.created_by,
        allowInvites: row.allow_invites,
        muteOnJoin: row.mute_on_join,
        isLocked: row.is_locked,
        participants: list.map(toParticipant),
        myRole: self.role,
        myRsvp: self.rsvp,
        canInvite: isModerator || row.allow_invites,
        createdAt: row.created_at.toISOString(),
      } satisfies Meeting,
    ];
  });
}

async function buildOne(userId: string, meetingId: string): Promise<Meeting> {
  const row = await MeetingModel.findById(meetingId);
  const [meeting] = row ? await buildMeetings(userId, [row]) : [];
  if (!meeting) throw notFound('Meeting not found');
  return meeting;
}

/** The meeting + the caller's invite, or a 404 that doesn't reveal whether the meeting exists. */
async function requireParticipant(
  meetingId: string,
  userId: string,
): Promise<{ meeting: MeetingRow; participant: MeetingParticipantRow }> {
  const [meeting, participant] = await Promise.all([
    MeetingModel.findById(meetingId),
    MeetingModel.getParticipant(meetingId, userId),
  ]);
  if (!meeting || !participant || participant.removed_at) throw notFound('Meeting not found');
  return { meeting, participant };
}

async function requireModerator(meetingId: string, userId: string) {
  const context = await requireParticipant(meetingId, userId);
  if (context.participant.role !== 'host' && context.participant.role !== 'cohost') {
    throw forbidden('Only hosts can do that');
  }
  return context;
}

function requireOpen(meeting: MeetingRow): void {
  if (meeting.status === 'cancelled') throw badRequest('This meeting was cancelled');
  if (meeting.status === 'ended') throw badRequest('This meeting has already ended');
}

/** Every invitee must be an active member of the actor's organization. */
async function resolveOrgUsers(actor: AuthUser, userIds: string[]) {
  const unique = [...new Set(userIds)].filter((id) => id !== actor.id);
  const users = await UserModel.findActiveInOrganization(unique, actor.organization?.id ?? null);
  if (users.length !== unique.length) throw notFound('One or more people were not found');
  return users;
}

function ringPayload(
  meeting: MeetingRow,
  actor: AuthUser,
  inviteeCount: number,
): MeetingRingPayload {
  return {
    meetingId: meeting.id,
    title: meeting.title,
    media: meeting.media,
    from: { id: actor.id, name: actor.name, avatarUrl: actor.avatarUrl },
    inviteeCount,
  };
}

// ── Queries ────────────────────────────────────────────────────────

export async function getCalendar(
  user: AuthUser,
  from: Date,
  to: Date,
): Promise<{ meetings: Meeting[]; announcements: Announcement[] }> {
  const canReadChat = hasPermission(user.permissions, 'chat:read');
  const [rows, posts] = await Promise.all([
    MeetingModel.listForCalendar(user.id, from, to),
    canReadChat ? MessageModel.listAnnouncementsForUser(user.id, from, to) : Promise.resolve([]),
  ]);
  return {
    meetings: await buildMeetings(user.id, rows),
    announcements: posts.map((post) => ({
      id: post.id,
      conversationId: post.conversation_id,
      conversationName: post.conversation_name ?? 'Announcements',
      senderName: post.sender_name,
      // The calendar only needs a preview; the full post is one click away in chat.
      body: post.body.length > 280 ? `${post.body.slice(0, 277)}…` : post.body,
      createdAt: post.created_at.toISOString(),
    })),
  };
}

export async function listUpcoming(userId: string): Promise<Meeting[]> {
  return buildMeetings(userId, await MeetingModel.listUpcoming(userId, 20));
}

export async function listInvitations(userId: string): Promise<Meeting[]> {
  return buildMeetings(userId, await MeetingModel.listPendingInvitations(userId));
}

export async function getMeeting(userId: string, meetingId: string): Promise<Meeting> {
  await requireParticipant(meetingId, userId);
  return buildOne(userId, meetingId);
}

// ── Commands ───────────────────────────────────────────────────────

export async function createMeeting(actor: AuthUser, input: CreateMeetingInput): Promise<Meeting> {
  const invitees = await resolveOrgUsers(actor, input.inviteeIds);
  if (input.kind === 'instant' && invitees.length === 0) {
    throw badRequest('Choose at least one person to call');
  }

  const startsAt = input.kind === 'instant' ? new Date() : new Date(input.startsAt!);
  if (input.kind === 'scheduled' && startsAt.getTime() < Date.now() - PAST_GRACE_MS) {
    throw badRequest('Pick a start time in the future');
  }
  const minutes =
    input.durationMinutes ??
    (input.kind === 'instant' ? DEFAULT_INSTANT_MINUTES : DEFAULT_SCHEDULED_MINUTES);
  const endsAt = new Date(startsAt.getTime() + minutes * 60_000);

  const meeting = await db.transaction(async (trx) => {
    const row = await MeetingModel.create(
      {
        organizationId: actor.organization?.id ?? null,
        title: input.title,
        description: input.description?.trim() || null,
        kind: input.kind,
        media: input.media ?? 'video',
        startsAt,
        endsAt,
        allowInvites: input.allowInvites ?? true,
        muteOnJoin: input.muteOnJoin ?? false,
        createdBy: actor.id,
      },
      trx,
    );
    await MeetingModel.addParticipants(
      row.id,
      [
        { userId: actor.id, role: 'host', rsvp: 'accepted' },
        ...invitees.map((u) => ({
          userId: u.id,
          role: 'participant' as const,
          rsvp: 'pending' as const,
        })),
      ],
      actor.id,
      trx,
    );
    return row;
  });

  Sentry.metrics.count('meeting.created', 1, { attributes: { kind: input.kind } });
  const inviteeIds = invitees.map((u) => u.id);
  realtime.emitMeetingChanged([actor.id, ...inviteeIds], meeting.id);
  if (input.kind === 'instant') {
    realtime.ring(inviteeIds, ringPayload(meeting, actor, inviteeIds.length));
  }
  return buildOne(actor.id, meeting.id);
}

export async function updateMeeting(
  actor: AuthUser,
  meetingId: string,
  input: UpdateMeetingInput,
): Promise<Meeting> {
  const { meeting } = await requireModerator(meetingId, actor.id);
  requireOpen(meeting);

  const changes: Parameters<typeof MeetingModel.update>[1] = {};
  if (input.title !== undefined) changes.title = input.title;
  if (input.description !== undefined) changes.description = input.description?.trim() || null;
  if (input.allowInvites !== undefined) changes.allow_invites = input.allowInvites;
  if (input.muteOnJoin !== undefined) changes.mute_on_join = input.muteOnJoin;

  if (input.startsAt !== undefined || input.durationMinutes !== undefined) {
    if (meeting.status === 'live') throw badRequest('You can’t reschedule a meeting that’s live');
    const startsAt = input.startsAt ? new Date(input.startsAt) : meeting.starts_at;
    if (input.startsAt && startsAt.getTime() < Date.now() - PAST_GRACE_MS) {
      throw badRequest('Pick a start time in the future');
    }
    const minutes =
      input.durationMinutes ??
      Math.round((meeting.ends_at.getTime() - meeting.starts_at.getTime()) / 60_000);
    changes.starts_at = startsAt;
    changes.ends_at = new Date(startsAt.getTime() + minutes * 60_000);
  }

  if (Object.keys(changes).length > 0) {
    await MeetingModel.update(meetingId, changes);
    realtime.emitMeetingChanged(await MeetingModel.listActiveParticipantIds(meetingId), meetingId);
  }
  return buildOne(actor.id, meetingId);
}

export async function cancelMeeting(actor: AuthUser, meetingId: string): Promise<Meeting> {
  const { meeting, participant } = await requireParticipant(meetingId, actor.id);
  if (participant.role !== 'host') throw forbidden('Only the host can cancel this meeting');
  requireOpen(meeting);

  if (meeting.status === 'live') await live.endRoom(meetingId);
  await MeetingModel.update(meetingId, { status: 'cancelled' });
  const participantIds = await MeetingModel.listActiveParticipantIds(meetingId);
  realtime.cancelRing(participantIds, meetingId);
  realtime.emitMeetingChanged(participantIds, meetingId);
  return buildOne(actor.id, meetingId);
}

/** Anyone in the meeting can add people, unless the host turned that off. */
export async function inviteToMeeting(
  actor: AuthUser,
  meetingId: string,
  userIds: string[],
): Promise<Meeting> {
  const { meeting, participant } = await requireParticipant(meetingId, actor.id);
  requireOpen(meeting);
  const isModerator = participant.role === 'host' || participant.role === 'cohost';
  if (!meeting.allow_invites && !isModerator) {
    throw forbidden('The host has turned off inviting for this meeting');
  }

  const users = await resolveOrgUsers(actor, userIds);
  const current = await MeetingModel.listActiveParticipantIds(meetingId);
  const fresh = users.filter((u) => !current.includes(u.id));
  if (current.length + fresh.length > MAX_MEETING_INVITEES) {
    throw badRequest(`A meeting can have up to ${MAX_MEETING_INVITEES} people invited`);
  }

  const addedIds = await MeetingModel.addParticipants(
    meetingId,
    fresh.map((u) => ({ userId: u.id, role: 'participant', rsvp: 'pending' })),
    actor.id,
  );
  if (addedIds.length > 0) {
    realtime.emitMeetingChanged([...current, ...addedIds], meetingId);
    // Joining a call that's already going: ring them so they can hop straight in.
    if (meeting.status === 'live') {
      realtime.ring(addedIds, ringPayload(meeting, actor, current.length + addedIds.length - 1));
    }
  }
  return buildOne(actor.id, meetingId);
}

export async function respond(
  actor: AuthUser,
  meetingId: string,
  response: Exclude<RsvpResponse, 'pending'>,
): Promise<Meeting> {
  const { meeting, participant } = await requireParticipant(meetingId, actor.id);
  requireOpen(meeting);
  if (participant.role === 'host') throw badRequest('You’re hosting this one');

  if (participant.rsvp !== response) {
    await MeetingModel.setRsvp(meetingId, actor.id, response);
    realtime.emitMeetingChanged(await MeetingModel.listActiveParticipantIds(meetingId), meetingId);
  }
  if (response === 'declined') realtime.cancelRing([actor.id], meetingId);
  return buildOne(actor.id, meetingId);
}

/** A host takes someone off the invite list (and out of the call, if they're in it). */
export async function removeParticipant(
  actor: AuthUser,
  meetingId: string,
  targetUserId: string,
): Promise<Meeting> {
  await requireModerator(meetingId, actor.id);
  if (targetUserId === actor.id)
    throw badRequest('Decline the meeting instead of removing yourself');
  const target = await MeetingModel.getParticipant(meetingId, targetUserId);
  if (!target || target.removed_at) throw notFound('That person isn’t in this meeting');
  if (target.role === 'host') throw forbidden('The host can’t be removed');

  const participantIds = await MeetingModel.listActiveParticipantIds(meetingId);
  await MeetingModel.markRemoved(meetingId, targetUserId);
  await live.kickUser(meetingId, targetUserId);
  realtime.cancelRing([targetUserId], meetingId);
  realtime.emitMeetingChanged(participantIds, meetingId);
  return buildOne(actor.id, meetingId);
}
