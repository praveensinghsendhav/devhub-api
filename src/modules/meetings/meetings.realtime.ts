import {
  SOCKET_EVENTS,
  type MeetingEventPayload,
  type MeetingRingPayload,
} from '../../shared/index.js';
import type { Server } from 'socket.io';
import { getIO } from '../../websocket/index.js';
import { userRoom } from '../../websocket/rooms.js';
import { logger } from '../../config/logger.js';

/** Realtime fan-out for meetings. Services call these after their DB writes succeed. */
function withIO(work: (io: Server) => unknown): void {
  try {
    void work(getIO());
  } catch (err) {
    logger.debug({ err }, 'Skipped realtime emit');
  }
}

/** "Something about this meeting changed" — each listed user's lists and calendar refetch. */
export function emitMeetingChanged(userIds: string[], meetingId: string): void {
  if (userIds.length === 0) return;
  const payload: MeetingEventPayload = { meetingId };
  withIO((io) => io.to(userIds.map(userRoom)).emit(SOCKET_EVENTS.MEETING_CHANGED, payload));
}

export function ring(userIds: string[], payload: MeetingRingPayload): void {
  if (userIds.length === 0) return;
  withIO((io) => io.to(userIds.map(userRoom)).emit(SOCKET_EVENTS.MEETING_RING, payload));
}

export function cancelRing(userIds: string[], meetingId: string): void {
  if (userIds.length === 0) return;
  const payload: MeetingEventPayload = { meetingId };
  withIO((io) => io.to(userIds.map(userRoom)).emit(SOCKET_EVENTS.MEETING_RING_CANCEL, payload));
}
