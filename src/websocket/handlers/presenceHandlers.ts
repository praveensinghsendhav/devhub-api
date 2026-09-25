import type { Server, Socket } from 'socket.io';
import { SOCKET_EVENTS, type StatusUpdateRequest } from '../../shared/index.js';
import * as presenceService from '../../modules/presence/presence.service.js';
import { updateStatusSchema } from '../../modules/auth/auth.validators.js';
import type { SocketData } from '../socketAuth.js';
import { presenceRoom } from '../rooms.js';
import { traceSocketEvent } from '../tracing.js';

/** Presence is broadcast only within the user's organization. */
export function registerPresenceHandlers(io: Server, socket: Socket): void {
  const { userId, organizationId } = socket.data as SocketData;
  const room = presenceRoom(organizationId);

  traceSocketEvent(socket, 'presence:register', 'Failed to register presence', async () => {
    await socket.join(room);
    const payload = await presenceService.registerConnection(userId, socket.id);
    io.to(room).emit(SOCKET_EVENTS.PRESENCE_UPDATE, payload);
  });

  socket.on(SOCKET_EVENTS.STATUS_UPDATE, (raw: unknown) => {
    // Same rules as PATCH /presence/status — socket payloads are untrusted too.
    const parsed = updateStatusSchema.safeParse(raw);
    if (!parsed.success) return;
    const request: StatusUpdateRequest = parsed.data;
    traceSocketEvent(
      socket,
      SOCKET_EVENTS.STATUS_UPDATE,
      'Failed to update status over socket',
      async () => {
        const payload = await presenceService.setManualStatus(
          userId,
          request.status,
          request.customStatus ?? null,
        );
        io.to(room).emit(SOCKET_EVENTS.PRESENCE_UPDATE, payload);
      },
    );
  });

  socket.on('disconnect', () => {
    void presenceService.deregisterConnection(userId, socket.id, (payload) => {
      io.to(room).emit(SOCKET_EVENTS.PRESENCE_UPDATE, payload);
    });
  });
}
