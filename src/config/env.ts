import { z } from 'zod';
import { loadEnvFiles } from './loadEnv.js';

// This repo's .env, with `${NAME}` references expanded.
loadEnvFiles();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /**
   * The address to serve on: "localhost", or this machine's LAN IP
   * (e.g. 192.168.1.20) to open the app from other devices. localhost keeps working either way.
   */
  HOST_IP: z
    .string()
    .optional()
    .transform((value) => value?.trim() || 'localhost'),
  /** Defaults to API_PORT (the value devhub-web uses to reach this API), then 4000. */
  PORT: z.coerce
    .number()
    .int()
    .positive()
    .default(Number(process.env.API_PORT) || 4000),
  /** Port the web app (devhub-web) runs on. */
  WEB_PORT: z.coerce.number().int().positive().default(3000),
  /** Whether devhub-web is served over HTTPS locally. Unset: on for a LAN IP, off for localhost. */
  HTTPS: z
    .string()
    .optional()
    .transform((value) => value?.trim().toLowerCase())
    .pipe(z.enum(['true', 'false', '']).optional()),
  /** The web app's public origin(s), comma-separated — e.g. "https://devhub.vercel.app". */
  CLIENT_ORIGIN: z.string().default(`http://localhost:${process.env.WEB_PORT || 3000}`),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  /** Upstash Redis (console → REST API). The TCP connection is built from these; its password is the token. */
  UPSTASH_REDIS_REST_URL: z.url('UPSTASH_REDIS_REST_URL is required'),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1, 'UPSTASH_REDIS_REST_TOKEN is required'),
  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_SECRET: z.string().min(16, 'COOKIE_SECRET must be at least 16 characters'),
  /** AES-256 key (32 random bytes, base64) for encrypting message text at rest in Postgres. */
  DB_ENCRYPTION_KEY: z
    .string()
    .refine(
      (value) => Buffer.from(value, 'base64').length === 32,
      'DB_ENCRYPTION_KEY must be 32 random bytes, base64-encoded',
    ),
  /**
   * Network addresses allowed to call the REST API — i.e. where the Next.js server runs.
   * Comma-separated IPs or CIDRs (e.g. "127.0.0.1,::1,10.0.0.0/8"); "*" turns the check off.
   */
  INTERNAL_API_ALLOWED_IPS: z.string().default('127.0.0.1,::1'),
  /**
   * Shared secret the Next.js server sends as `x-internal-secret`. Needed when the web app runs
   * where its address isn't fixed (Vercel); the same value goes in the web app's env.
   */
  INTERNAL_API_SECRET: z
    .string()
    .min(32, 'INTERNAL_API_SECRET must be at least 32 characters')
    .optional(),
  /** Express `trust proxy` setting, so rate limits see the real client IP behind the Next.js proxy. */
  TRUST_PROXY: z
    .string()
    .default('loopback')
    // "1", "2"… mean hop counts; anything else is an address/subnet list (e.g. "loopback, 10.0.0.0/8").
    .transform((value) => (/^\d+$/.test(value) ? Number(value) : value)),
  /** Public web URL used to build invite links. Defaults to the first CLIENT_ORIGIN in production, else HOST_IP:WEB_PORT. */
  APP_URL: z.string().optional(),
  INVITE_TTL_HOURS: z.coerce.number().int().positive().default(72),
  /** Meetings: STUN servers (comma-separated) browsers use to discover their public address. */
  STUN_URLS: z.string().default('stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302'),
  /**
   * Optional TURN relay (e.g. coturn with `use-auth-secret`) for people behind strict NATs or
   * firewalls. Comma-separated `turn:`/`turns:` URLs; credentials are minted per user, short-lived.
   */
  TURN_URLS: z.string().optional(),
  TURN_SECRET: z.string().min(16, 'TURN_SECRET must be at least 16 characters').optional(),
  TURN_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  /** Sentry is optional: without SENTRY_DSN the SDK stays disabled and nothing is sent. */
  SENTRY_DSN: z.url().optional(),
  /** Defaults to NODE_ENV. Set it to tell staging and production apart in Sentry. */
  SENTRY_ENVIRONMENT: z.string().optional(),
  /** Release name (e.g. the git SHA) so errors map to a deploy. */
  SENTRY_RELEASE: z.string().optional(),
  /** Share of requests traced (0–1). Defaults to 1 in development, 0.2 in production. */
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).optional(),
  /** Share of process sessions profiled (0–1). Defaults to 1 in development, 0.2 in production. */
  SENTRY_PROFILE_SESSION_SAMPLE_RATE: z.coerce.number().min(0).max(1).optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
  process.exit(1);
}

const { NODE_ENV, HOST_IP, WEB_PORT, HTTPS } = parsed.data;
export const isProduction = NODE_ENV === 'production';

if (isProduction && !process.env.CLIENT_ORIGIN) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration: CLIENT_ORIGIN is required in production');
  process.exit(1);
}

const configuredOrigins = parsed.data.CLIENT_ORIGIN.split(',')
  .map((origin) => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean);

// Local only (same rule as devhub-web/sharedEnv.mjs; keep HOST_IP, WEB_PORT, HTTPS equal in both repos).
const webHttps =
  HTTPS === 'true' || (HTTPS !== 'false' && !['localhost', '127.0.0.1', '::1'].includes(HOST_IP));
const webOrigin = (host: string) => `${webHttps ? 'https' : 'http'}://${host}:${WEB_PORT}`;

/** Browser origins allowed by CORS and Socket.IO. Production trusts CLIENT_ORIGIN alone. */
export const clientOrigins = isProduction
  ? configuredOrigins
  : [...new Set([...configuredOrigins, webOrigin('localhost'), webOrigin(HOST_IP)])];

export const env = {
  ...parsed.data,
  APP_URL: parsed.data.APP_URL ?? (isProduction ? configuredOrigins[0]! : webOrigin(HOST_IP)),
};
