import {
  MAX_MEETING_PARTICIPANTS,
  SOCKET_EVENTS,
  type HostAction,
  type MeetingAdmittedPayload,
  type MeetingChatMessage,
  type MeetingDeclinedPayload,
  type MeetingHostCommandPayload,
  type MeetingJoinResponse,
  type MeetingKnockPayload,
  type MeetingPeer,
  type MeetingPeerLeftPayload,
  type MeetingPeerUpdatedPayload,
  type MeetingReaction,
  type MeetingReactionPayload,
  type MeetingRemovedPayload,
  type MeetingRole,
  type MeetingRoomStatePayload,
  type MeetingSignalPayload,
  type PeerMediaState,
  type SignalData,
  type SocketAck,
} from '../../shared/index.js';
import { randomUUID } from 'node:crypto';
import type { RemoteSocket, Socket } from 'socket.io';
import { redis } from '../../config/redis.js';
import { logger } from '../../config/logger.js';
import { MeetingModel, type MeetingRow } from '../../models/meeting.model.js';
import * as presenceService from '../presence/presence.service.js';
import { getIO } from '../../websocket/index.js';
import { meetingRoom, presenceRoom, userRoom } from '../../websocket/rooms.js';
import type { SocketData } from '../../websocket/socketAuth.js';
import { iceServersFor } from './iceServers.js';
import * as realtime from './meetings.realtime.js';

/**
 * The live side of meetings. Who is in a call is exactly "which sockets are in the meeting room",
 * read through the Redis adapter, so it's correct across API instances and can't go stale when a
 * process dies. Media never touches this server: it only authorizes and relays signaling.
 */

type AnySocket = Socket | RemoteSocket<Record<string, never>, SocketData>;
type ModeratorContext = { meeting: MeetingRow; role: MeetingRole };

const ADMIT_TTL_SECONDS = 120;
const admitKey = (meetingId: string, userId: string) => `meeting:admit:${meetingId}:${userId}`;

const dataOf = (socket: AnySocket) => socket.data as SocketData;

/** True only when the socket says it's in this meeting *and* the server put it in that room. */
function isInMeeting(socket: AnySocket, meetingId: string): boolean {
  return (
    dataOf(socket).meeting?.meetingId === meetingId && socket.rooms.has(meetingRoom(meetingId))
  );
}

async function socketsIn(meetingId: string): Promise<AnySocket[]> {
  const sockets = await getIO().in(meetingRoom(meetingId)).fetchSockets();
  return sockets.filter((s) => dataOf(s).meeting?.meetingId === meetingId);
}

/** Roles come from the DB every time, so a promotion is seen by every instance at once. */
async function rolesFor(meetingId: string): Promise<Map<string, MeetingRole>> {
  const rows = await MeetingModel.getParticipants([meetingId]);
  return new Map(rows.map((row) => [row.user_id, row.role]));
}

function toPeer(socket: AnySocket, roles: Map<string, MeetingRole>): MeetingPeer {
  const data = dataOf(socket);
  return {
    peerId: socket.id,
    userId: data.userId,
    name: data.name,
    avatarUrl: data.avatarUrl,
    role: roles.get(data.userId) ?? 'participant',
    state: data.meeting!.state,
    joinedAt: data.meeting!.joinedAt,
  };
}

const isModeratorRole = (role: MeetingRole | undefined) => role === 'host' || role === 'cohost';

// ── Small per-socket rate limiter for chat and reactions ───────────

const buckets = new WeakMap<object, Map<string, { tokens: number; at: number }>>();

/** Token bucket: `burst` events at once, refilled over `perMs`. */
function allow(socket: Socket, key: string, burst: number, perMs: number): boolean {
  const map = buckets.get(socket) ?? new Map();
  buckets.set(socket, map);
  const now = Date.now();
  const bucket = map.get(key) ?? { tokens: burst, at: now };
  bucket.tokens = Math.min(burst, bucket.tokens + ((now - bucket.at) / perMs) * burst);
  bucket.at = now;
  if (bucket.tokens < 1) {
    map.set(key, bucket);
    return false;
  }
  bucket.tokens -= 1;
  map.set(key, bucket);
  return true;
}

// ── Presence + lifecycle ───────────────────────────────────────────

async function userHasLiveCall(userId: string): Promise<boolean> {
  const sockets = await getIO().in(userRoom(userId)).fetchSockets();
  return sockets.some((s) => {
    const meetingId = dataOf(s).meeting?.meetingId;
    return meetingId !== undefined && s.rooms.has(meetingRoom(meetingId));
  });
}

async function restorePresence(userId: string, organizationId: string | null): Promise<void> {
  if (await userHasLiveCall(userId)) return;
  const payload = await presenceService.leaveMeeting(userId);
  if (payload)
    getIO().to(presenceRoom(organizationId)).emit(SOCKET_EVENTS.PRESENCE_UPDATE, payload);
}

/** After someone leaves: if the room is empty, the meeting is no longer live. */
async function settleMeeting(meetingId: string): Promise<void> {
  if ((await socketsIn(meetingId)).length > 0) return;
  const meeting = await MeetingModel.findById(meetingId);
  if (!meeting || meeting.status !== 'live') return;

  const now = new Date();
  if (meeting.kind === 'instant') {
    await MeetingModel.update(meetingId, { status: 'ended', ended_at: now, ends_at: now });
  } else if (now >= meeting.ends_at) {
    await MeetingModel.update(meetingId, { status: 'ended', ended_at: now });
  } else {
    // Everyone stepped out early; people can still come back until it's over.
    await MeetingModel.update(meetingId, { status: 'scheduled' });
  }

  const participantIds = await MeetingModel.listActiveParticipantIds(meetingId);
  realtime.cancelRing(participantIds, meetingId);
  realtime.emitMeetingChanged(participantIds, meetingId);
}

// ── Join / leave ───────────────────────────────────────────────────

const joinError = (
  code: Extract<MeetingJoinResponse, { ok: false }>['code'],
  message: string,
): MeetingJoinResponse => ({ ok: false, code, message });

export async function join(
  socket: Socket,
  meetingId: string,
  initial: Pick<PeerMediaState, 'audio' | 'video'>,
): Promise<MeetingJoinResponse> {
  const data = dataOf(socket);
  const [meeting, participant] = await Promise.all([
    MeetingModel.findById(meetingId),
    MeetingModel.getParticipant(meetingId, data.userId),
  ]);

  // Same answer for "doesn't exist" and "not invited", so ids can't be probed.
  if (!meeting || !participant) return joinError('not_found', 'Meeting not found');
  if (participant.removed_at) return joinError('removed', 'A host removed you from this meeting');
  if (meeting.status === 'cancelled') return joinError('cancelled', 'This meeting was cancelled');
  if (meeting.status === 'ended') return joinError('ended', 'This meeting has ended');

  // One call per device: switching calls leaves the old one first. Rejoining the same call (a
  // reconnect) mustn’t briefly empty the room, or an instant call would end.
  if (data.meeting) await leave(socket, { settle: data.meeting.meetingId !== meetingId });

  const peers = await socketsIn(meetingId);
  const isModerator = isModeratorRole(participant.role);
  if (meeting.is_locked && !isModerator) {
    const admitted = await redis.getdel(admitKey(meetingId, data.userId));
    if (!admitted) return joinError('locked', 'This meeting is locked — ask a host to let you in');
  }
  if (peers.length >= MAX_MEETING_PARTICIPANTS) {
    return joinError('full', `This call is full (${MAX_MEETING_PARTICIPANTS} people max)`);
  }

  data.meeting = {
    meetingId,
    state: {
      audio: initial.audio && (!meeting.mute_on_join || isModerator),
      video: initial.video && meeting.media === 'video',
      screen: false,
      hand: false,
      quality: 'good',
    },
    joinedAt: new Date().toISOString(),
  };
  await socket.join(meetingRoom(meetingId));

  const roles = await rolesFor(meetingId);
  socket.to(meetingRoom(meetingId)).emit(SOCKET_EVENTS.MEETING_PEER_JOINED, {
    meetingId,
    peer: toPeer(socket, roles),
  } satisfies MeetingPeerUpdatedPayload);

  const participantIds = [...roles.keys()];
  if (meeting.status !== 'live') {
    await MeetingModel.update(meetingId, {
      status: 'live',
      started_at: meeting.started_at ?? new Date(),
    });
    realtime.emitMeetingChanged(participantIds, meetingId);
  }
  // Showing up is a yes — it goes on your calendar.
  if (participant.rsvp !== 'accepted') {
    await MeetingModel.setRsvp(meetingId, data.userId, 'accepted');
    realtime.emitMeetingChanged(participantIds, meetingId);
  }
  // Stop the phone ringing on this person's other devices.
  realtime.cancelRing([data.userId], meetingId);

  const presence = await presenceService.enterMeeting(data.userId);
  if (presence) {
    getIO().to(presenceRoom(data.organizationId)).emit(SOCKET_EVENTS.PRESENCE_UPDATE, presence);
  }

  return {
    ok: true,
    selfPeerId: socket.id,
    peers: peers.filter((s) => s.id !== socket.id).map((s) => toPeer(s, roles)),
    iceServers: iceServersFor(data.userId),
    meeting: {
      id: meeting.id,
      title: meeting.title,
      isLocked: meeting.is_locked,
      muteOnJoin: meeting.mute_on_join,
      myRole: participant.role,
      media: meeting.media,
    },
  };
}

/**
 * Leaves the socket's current call (if any). On a dropped connection, pass `graceMs`: the
 * "call is over" / status bookkeeping waits, so a quick reconnect doesn't end a call.
 */
export async function leave(
  socket: Socket,
  { settle = true, graceMs = 0 }: { settle?: boolean; graceMs?: number } = {},
): Promise<void> {
  const data = dataOf(socket);
  const meetingId = data.meeting?.meetingId;
  if (!meetingId) return;
  data.meeting = undefined;

  await socket.leave(meetingRoom(meetingId));
  const payload: MeetingPeerLeftPayload = { meetingId, peerId: socket.id };
  getIO().to(meetingRoom(meetingId)).emit(SOCKET_EVENTS.MEETING_PEER_LEFT, payload);
  if (!settle) return;

  const finish = async () => {
    await settleMeeting(meetingId);
    await restorePresence(data.userId, data.organizationId);
  };
  if (graceMs === 0) return finish();
  setTimeout(() => {
    finish().catch((err: unknown) => logger.error({ err, meetingId }, 'Failed to settle meeting'));
  }, graceMs);
}

/** Force everyone out — the host ended the call, or the meeting was cancelled. */
export async function endRoom(meetingId: string): Promise<void> {
  const sockets = await socketsIn(meetingId);
  const payload: MeetingRemovedPayload = { meetingId, reason: 'ended' };
  const io = getIO();
  io.to(meetingRoom(meetingId)).emit(SOCKET_EVENTS.MEETING_REMOVED, payload);
  io.in(meetingRoom(meetingId)).socketsLeave(meetingRoom(meetingId));

  const meeting = await MeetingModel.findById(meetingId);
  if (meeting && meeting.status !== 'cancelled') {
    const now = new Date();
    await MeetingModel.update(meetingId, {
      status: 'ended',
      ended_at: now,
      ...(meeting.kind === 'instant' || now < meeting.ends_at ? { ends_at: now } : {}),
    });
  }
  const participantIds = await MeetingModel.listActiveParticipantIds(meetingId);
  realtime.cancelRing(participantIds, meetingId);
  realtime.emitMeetingChanged(participantIds, meetingId);

  const people = new Map(sockets.map((s) => [dataOf(s).userId, dataOf(s).organizationId]));
  await Promise.all([...people].map(([userId, orgId]) => restorePresence(userId, orgId)));
}

/** Removes one person (all their devices) from a live call. */
export async function kickUser(meetingId: string, userId: string): Promise<void> {
  const io = getIO();
  const targets = (await socketsIn(meetingId)).filter((s) => dataOf(s).userId === userId);
  if (targets.length === 0) return;
  const removed: MeetingRemovedPayload = { meetingId, reason: 'removed' };
  for (const target of targets) {
    io.to(target.id).emit(SOCKET_EVENTS.MEETING_REMOVED, removed);
    io.in(target.id).socketsLeave(meetingRoom(meetingId));
    const left: MeetingPeerLeftPayload = { meetingId, peerId: target.id };
    io.to(meetingRoom(meetingId)).emit(SOCKET_EVENTS.MEETING_PEER_LEFT, left);
  }
  await settleMeeting(meetingId);
  await restorePresence(userId, dataOf(targets[0]!).organizationId);
}

// ── In-call relays ─────────────────────────────────────────────────

/**
 * Relays SDP/ICE to one peer. Both ends must be in the same meeting room; the sender id is stamped
 * by the server, so nobody can pose as another peer. The target check uses the local socket when
 * possible (ICE sends many small messages) and asks the adapter otherwise.
 */
export async function relaySignal(
  socket: Socket,
  meetingId: string,
  to: string,
  data: SignalData,
): Promise<void> {
  if (!isInMeeting(socket, meetingId) || to === socket.id) return;
  const room = meetingRoom(meetingId);
  const local = getIO().sockets.sockets.get(to);
  const targetInRoom = local
    ? local.rooms.has(room)
    : (await getIO().in(room).fetchSockets()).some((s) => s.id === to);
  if (!targetInRoom) return;
  const payload: MeetingSignalPayload = { meetingId, from: socket.id, data };
  getIO().to(to).emit(SOCKET_EVENTS.MEETING_SIGNAL, payload);
}

export async function updateMedia(
  socket: Socket,
  meetingId: string,
  state: PeerMediaState,
): Promise<void> {
  const data = dataOf(socket);
  if (!isInMeeting(socket, meetingId) || !data.meeting) return;
  data.meeting.state = state;
  const payload: MeetingPeerUpdatedPayload = {
    meetingId,
    peer: toPeer(socket, await rolesFor(meetingId)),
  };
  socket.to(meetingRoom(meetingId)).emit(SOCKET_EVENTS.MEETING_PEER_UPDATED, payload);
}

/** In-call chat is relayed, never stored — it disappears with the call. */
export function sendChat(socket: Socket, meetingId: string, text: string): SocketAck {
  if (!isInMeeting(socket, meetingId)) return { ok: false, message: 'You’re not in this call' };
  if (!allow(socket, 'chat', 5, 5_000)) return { ok: false, message: 'Slow down a little' };
  const data = dataOf(socket);
  const message: MeetingChatMessage = {
    id: randomUUID(),
    meetingId,
    peerId: socket.id,
    userId: data.userId,
    name: data.name,
    text,
    sentAt: new Date().toISOString(),
  };
  getIO().to(meetingRoom(meetingId)).emit(SOCKET_EVENTS.MEETING_CHAT, message);
  return { ok: true };
}

export function sendReaction(socket: Socket, meetingId: string, emoji: MeetingReaction): void {
  if (!isInMeeting(socket, meetingId) || !allow(socket, 'reaction', 8, 4_000)) return;
  const payload: MeetingReactionPayload = {
    meetingId,
    peerId: socket.id,
    name: dataOf(socket).name,
    emoji,
  };
  getIO().to(meetingRoom(meetingId)).emit(SOCKET_EVENTS.MEETING_REACTION, payload);
}

// ── Host controls ──────────────────────────────────────────────────

async function requireModerator(
  socket: Socket,
  meetingId: string,
): Promise<ModeratorContext | string> {
  if (!isInMeeting(socket, meetingId)) return 'You’re not in this call';
  const [meeting, participant] = await Promise.all([
    MeetingModel.findById(meetingId),
    MeetingModel.getParticipant(meetingId, dataOf(socket).userId),
  ]);
  if (!meeting || !participant || !isModeratorRole(participant.role)) {
    return 'Only hosts can do that';
  }
  return { meeting, role: participant.role };
}

export async function hostAction(
  socket: Socket,
  meetingId: string,
  action: HostAction,
  peerId: string | undefined,
): Promise<SocketAck> {
  const context = await requireModerator(socket, meetingId);
  if (typeof context === 'string') return { ok: false, message: context };
  const io = getIO();
  const room = meetingRoom(meetingId);
  const byName = dataOf(socket).name;

  // Room-wide actions.
  if (action === 'mute-all') {
    const payload: MeetingHostCommandPayload = { meetingId, command: 'mute', byName };
    socket.to(room).emit(SOCKET_EVENTS.MEETING_HOST_COMMAND, payload);
    return { ok: true };
  }
  if (action === 'lock' || action === 'unlock') {
    await MeetingModel.update(meetingId, { is_locked: action === 'lock' });
    const payload: MeetingRoomStatePayload = { meetingId, isLocked: action === 'lock' };
    io.to(room).emit(SOCKET_EVENTS.MEETING_ROOM_STATE, payload);
    return { ok: true };
  }
  if (action === 'end') {
    if (context.role !== 'host') return { ok: false, message: 'Only the host can end the call' };
    await endRoom(meetingId);
    return { ok: true };
  }

  // Actions aimed at one person.
  const sockets = await socketsIn(meetingId);
  const target = sockets.find((s) => s.id === peerId);
  if (!target) return { ok: false, message: 'That person has left the call' };
  const targetUserId = dataOf(target).userId;
  const roles = await rolesFor(meetingId);
  const targetRole = roles.get(targetUserId);

  if (action === 'mute' || action === 'camera-off' || action === 'lower-hand') {
    const payload: MeetingHostCommandPayload = { meetingId, command: action, byName };
    io.to(target.id).emit(SOCKET_EVENTS.MEETING_HOST_COMMAND, payload);
    return { ok: true };
  }

  if (targetRole === 'host') return { ok: false, message: 'The host can’t be changed or removed' };

  if (action === 'remove') {
    await MeetingModel.markRemoved(meetingId, targetUserId);
    await kickUser(meetingId, targetUserId);
    realtime.emitMeetingChanged([...roles.keys()], meetingId);
    return { ok: true };
  }

  // make-cohost / remove-cohost
  if (context.role !== 'host') return { ok: false, message: 'Only the host can change roles' };
  await MeetingModel.setRole(
    meetingId,
    targetUserId,
    action === 'make-cohost' ? 'cohost' : 'participant',
  );
  const updatedRoles = await rolesFor(meetingId);
  for (const s of sockets.filter((x) => dataOf(x).userId === targetUserId)) {
    const payload: MeetingPeerUpdatedPayload = { meetingId, peer: toPeer(s, updatedRoles) };
    io.to(room).emit(SOCKET_EVENTS.MEETING_PEER_UPDATED, payload);
  }
  realtime.emitMeetingChanged([...updatedRoles.keys()], meetingId);
  return { ok: true };
}

// ── Locked meetings: knock and admit ───────────────────────────────

export async function knock(socket: Socket, meetingId: string): Promise<SocketAck> {
  const data = dataOf(socket);
  const participant = await MeetingModel.getParticipant(meetingId, data.userId);
  if (!participant || participant.removed_at) return { ok: false, message: 'Meeting not found' };
  if (!allow(socket, 'knock', 3, 30_000)) {
    return { ok: false, message: 'You already asked — give the host a moment' };
  }

  const [sockets, roles] = await Promise.all([socketsIn(meetingId), rolesFor(meetingId)]);
  const moderators = sockets.filter((s) => isModeratorRole(roles.get(dataOf(s).userId)));
  if (moderators.length === 0) return { ok: false, message: 'No host is in the call yet' };

  const payload: MeetingKnockPayload = {
    meetingId,
    userId: data.userId,
    name: data.name,
    avatarUrl: data.avatarUrl,
  };
  getIO()
    .to(moderators.map((s) => s.id))
    .emit(SOCKET_EVENTS.MEETING_KNOCK, payload);
  return { ok: true };
}

export async function admit(
  socket: Socket,
  meetingId: string,
  userId: string,
  allowIn: boolean,
): Promise<SocketAck> {
  const context = await requireModerator(socket, meetingId);
  if (typeof context === 'string') return { ok: false, message: context };
  // The admission is a one-time pass, used up by the next join.
  if (allowIn) await redis.set(admitKey(meetingId, userId), '1', 'EX', ADMIT_TTL_SECONDS);
  const payload: MeetingAdmittedPayload = { meetingId, allow: allowIn };
  getIO().to(userRoom(userId)).emit(SOCKET_EVENTS.MEETING_ADMITTED, payload);
  return { ok: true };
}

// ── Ringing ────────────────────────────────────────────────────────

export async function decline(socket: Socket, meetingId: string): Promise<void> {
  const data = dataOf(socket);
  const participant = await MeetingModel.getParticipant(meetingId, data.userId);
  if (!participant || participant.removed_at || participant.role === 'host') return;
  await MeetingModel.setRsvp(meetingId, data.userId, 'declined');
  realtime.cancelRing([data.userId], meetingId);
  const payload: MeetingDeclinedPayload = { meetingId, userId: data.userId, name: data.name };
  getIO().to(meetingRoom(meetingId)).emit(SOCKET_EVENTS.MEETING_DECLINED, payload);
  realtime.emitMeetingChanged(await MeetingModel.listActiveParticipantIds(meetingId), meetingId);
}
