import * as Sentry from '@sentry/node';
import type { Socket } from 'socket.io';
import { logger } from '../config/logger.js';
import type { SocketData } from './socketAuth.js';

/**
 * Socket events aren't HTTP requests, so Sentry can't trace them on its own. This runs a handler
 * in its own trace (so its DB/Redis calls show up as spans), tags it with the user, and reports
 * failures to both the log and Sentry — the socket equivalent of the Express error handler.
 */
export function traceSocketEvent(
  socket: Socket,
  event: string,
  errorMessage: string,
  handler: () => Promise<unknown>,
): void {
  const { userId } = socket.data as SocketData;

  void Sentry.withIsolationScope(async (scope) => {
    scope.setUser({ id: userId });
    await Sentry.startNewTrace(() =>
      Sentry.startSpan({ name: `socket ${event}`, op: 'websocket.server' }, async (span) => {
        try {
          await handler();
        } catch (err) {
          span.setStatus({ code: 2, message: 'internal_error' });
          logger.error({ err, userId, event }, errorMessage);
          Sentry.captureException(err, { tags: { socket_event: event } });
        }
      }),
    );
  });
}
