import knexFactory from 'knex';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

export const db = knexFactory({
  client: 'pg',
  connection: env.DATABASE_URL,
  pool: { min: 2, max: 10 },
});

export async function connectDatabase(): Promise<void> {
  await db.raw('select 1');
  logger.info('PostgreSQL connected');
}

export async function disconnectDatabase(): Promise<void> {
  await db.destroy();
}
