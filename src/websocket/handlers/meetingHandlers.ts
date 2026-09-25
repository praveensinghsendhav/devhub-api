import type { Socket } from 'socket.io';
import { SOCKET_EVENTS, type MeetingJoinResponse, type SocketAck } from '../../shared/index.js';
import * as live from '../../modules/meetings/meetings.live.js';
import {
  admitSocketSchema,
  chatSocketSchema,
  hostActionSocketSchema,
  joinSocketSchema,
  mediaSocketSchema,
  meetingOnlySocketSchema,
  reactionSocketSchema,
  signalSocketSchema,
} from '../../modules/meetings/meetings.validators.js';
import { traceSocketEvent } from '../tracing.js';

type Ack<T> = (response: T) => void;

/** Acks are optional on the wire; never call something that isn't a function. */
function ackOf<T>(maybe: unknown): Ack<T> {
  return typeof maybe === 'function' ? (maybe as Ack<T>) : () => undefined;
}

/** Long enough for a page refresh or a network blip to reconnect before a call is ended. */
const DISCONNECT_GRACE_MS = 10_000;

const INVALID: SocketAck = { ok: false, message: 'Invalid request' };
const FAILED: SocketAck = { ok: false, message: 'Something went wrong — please try again' };

/**
 * Live-call events. Every payload is validated here; authorization (am I in this call, am I a
 * host) happens in `meetings.live.ts`, which is the only code that touches meeting rooms.
 */
export function registerMeetingHandlers(socket: Socket): void {
  /** Runs an ack-returning handler inside a trace and always answers, even on a crash. */
  function withAck<T>(event: string, ack: Ack<T | SocketAck>, work: () => Promise<T>): void {
    traceSocketEvent(socket, event, `Failed to handle ${event}`, async () => {
      try {
        ack(await work());
      } catch (err) {
        ack(FAILED);
        throw err;
      }
    });
  }

  socket.on(SOCKET_EVENTS.MEETING_JOIN, (raw: unknown, maybeAck: unknown) => {
    const ack = ackOf<MeetingJoinResponse | SocketAck>(maybeAck);
    const parsed = joinSocketSchema.safeParse(raw);
    if (!parsed.success) return ack(INVALID);
    withAck(SOCKET_EVENTS.MEETING_JOIN, ack, () =>
      live.join(socket, parsed.data.meetingId, parsed.data.state),
    );
  });

  socket.on(SOCKET_EVENTS.MEETING_LEAVE, (_raw: unknown, maybeAck: unknown) => {
    withAck(SOCKET_EVENTS.MEETING_LEAVE, ackOf<SocketAck>(maybeAck), async () => {
      await live.leave(socket);
      return { ok: true } as const;
    });
  });

  socket.on(SOCKET_EVENTS.MEETING_SIGNAL, (raw: unknown) => {
    const parsed = signalSocketSchema.safeParse(raw);
    if (!parsed.success) return;
    const { meetingId, to, data } = parsed.data;
    traceSocketEvent(socket, SOCKET_EVENTS.MEETING_SIGNAL, 'Failed to relay signal', () =>
      live.relaySignal(socket, meetingId, to, data),
    );
  });

  socket.on(SOCKET_EVENTS.MEETING_MEDIA, (raw: unknown) => {
    const parsed = mediaSocketSchema.safeParse(raw);
    if (!parsed.success) return;
    traceSocketEvent(socket, SOCKET_EVENTS.MEETING_MEDIA, 'Failed to update media state', () =>
      live.updateMedia(socket, parsed.data.meetingId, parsed.data.state),
    );
  });

  socket.on(SOCKET_EVENTS.MEETING_CHAT, (raw: unknown, maybeAck: unknown) => {
    const ack = ackOf<SocketAck>(maybeAck);
    const parsed = chatSocketSchema.safeParse(raw);
    if (!parsed.success) return ack(INVALID);
    ack(live.sendChat(socket, parsed.data.meetingId, parsed.data.text));
  });

  socket.on(SOCKET_EVENTS.MEETING_REACTION, (raw: unknown) => {
    const parsed = reactionSocketSchema.safeParse(raw);
    if (parsed.success) live.sendReaction(socket, parsed.data.meetingId, parsed.data.emoji);
  });

  socket.on(SOCKET_EVENTS.MEETING_HOST_ACTION, (raw: unknown, maybeAck: unknown) => {
    const ack = ackOf<SocketAck>(maybeAck);
    const parsed = hostActionSocketSchema.safeParse(raw);
    if (!parsed.success) return ack(INVALID);
    const { meetingId, action, peerId } = parsed.data;
    withAck(SOCKET_EVENTS.MEETING_HOST_ACTION, ack, () =>
      live.hostAction(socket, meetingId, action, peerId),
    );
  });

  socket.on(SOCKET_EVENTS.MEETING_KNOCK, (raw: unknown, maybeAck: unknown) => {
    const ack = ackOf<SocketAck>(maybeAck);
    const parsed = meetingOnlySocketSchema.safeParse(raw);
    if (!parsed.success) return ack(INVALID);
    withAck(SOCKET_EVENTS.MEETING_KNOCK, ack, () => live.knock(socket, parsed.data.meetingId));
  });

  socket.on(SOCKET_EVENTS.MEETING_ADMIT, (raw: unknown, maybeAck: unknown) => {
    const ack = ackOf<SocketAck>(maybeAck);
    const parsed = admitSocketSchema.safeParse(raw);
    if (!parsed.success) return ack(INVALID);
    const { meetingId, userId, allow } = parsed.data;
    withAck(SOCKET_EVENTS.MEETING_ADMIT, ack, () => live.admit(socket, meetingId, userId, allow));
  });

  socket.on(SOCKET_EVENTS.MEETING_DECLINE, (raw: unknown) => {
    const parsed = meetingOnlySocketSchema.safeParse(raw);
    if (!parsed.success) return;
    traceSocketEvent(socket, SOCKET_EVENTS.MEETING_DECLINE, 'Failed to decline call', () =>
      live.decline(socket, parsed.data.meetingId),
    );
  });

  // Dropping off (tab closed, network gone) is leaving the call.
  socket.on('disconnect', () => {
    traceSocketEvent(socket, 'meeting:disconnect', 'Failed to leave call on disconnect', () =>
      live.leave(socket, { graceMs: DISCONNECT_GRACE_MS }),
    );
  });
}
