import type { Knex } from 'knex';
import { loadEnvFiles } from './src/config/loadEnv.js';

loadEnvFiles();

const config: Knex.Config = {
  client: 'pg',
  connection: process.env.DATABASE_URL ?? 'postgres://devhub:devhub@localhost:5432/devhub',
  pool: { min: 2, max: 10 },
  migrations: {
    directory: './src/db/migrations',
    extension: 'ts',
    tableName: 'knex_migrations',
  },
  seeds: {
    directory: './src/db/seeds',
    extension: 'ts',
  },
};

export default config;
