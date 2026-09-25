import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import * as Sentry from '@sentry/node';
import { createAdapter } from '@socket.io/redis-adapter';
import { clientOrigins } from '../config/env.js';
import { logger } from '../config/logger.js';
import { redis } from '../config/redis.js';
import { socketAuthMiddleware } from './socketAuth.js';
import { registerPresenceHandlers } from './handlers/presenceHandlers.js';
import { registerChatHandlers } from './handlers/chatHandlers.js';
import { registerMeetingHandlers } from './handlers/meetingHandlers.js';
import { userRoom } from './rooms.js';
import { traceSocketEvent } from './tracing.js';

let io: Server | undefined;

export function initSocketServer(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    // Browsers reach this through the web app's /socket.io rewrite, which has no trailing slash.
    addTrailingSlash: false,
    cors: { origin: clientOrigins, credentials: true },
    adapter: createAdapter(redis.duplicate(), redis.duplicate()),
  });

  io.use(socketAuthMiddleware);

  io.on('connection', (socket) => {
    logger.debug({ userId: socket.data.userId, socketId: socket.id }, 'Socket connected');
    Sentry.metrics.count('socket.connections');
    void socket.join(userRoom(socket.data.userId as string));
    registerPresenceHandlers(io as Server, socket);
    registerMeetingHandlers(socket);
    traceSocketEvent(socket, 'chat:setup', 'Failed to set up chat for socket', () =>
      registerChatHandlers(socket),
    );
  });

  return io;
}

export function getIO(): Server {
  if (!io) throw new Error('Socket server not initialized yet');
  return io;
}
