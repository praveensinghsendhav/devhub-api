import { createServer } from 'node:http';
import * as Sentry from '@sentry/node';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { connectDatabase, disconnectDatabase } from './db/knex.js';
import { redis } from './config/redis.js';
import { createApp } from './app.js';
import { initSocketServer } from './websocket/index.js';

async function main(): Promise<void> {
  // Connect to Postgres before accepting any traffic — fail fast if the DB isn't reachable.
  await connectDatabase();

  const app = createApp();
  const httpServer = createServer(app);
  initSocketServer(httpServer);

  httpServer.listen(env.PORT, () => {
    logger.info(`API listening on http://${env.HOST_IP}:${env.PORT}`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully`);
    httpServer.close();
    // Sentry.close flushes buffered errors, logs, metrics and spans before the process exits.
    await Promise.all([disconnectDatabase(), redis.quit(), Sentry.close(2000)]);
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch(async (err) => {
  logger.error({ err }, 'Failed to start API server');
  Sentry.captureException(err);
  await Sentry.flush(2000);
  process.exit(1);
});
