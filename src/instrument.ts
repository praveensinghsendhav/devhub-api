/**
 * Sentry bootstrap. Loaded with `--import` before the app (see package.json scripts) so the SDK can
 * patch http, express, pg (knex), ioredis and pino as they're imported. Import nothing here that
 * pulls in those libraries — only env config.
 */
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { env, isProduction } from './config/env.js';

const defaultSampleRate = isProduction ? 0.2 : 1;
const tracesSampleRate = env.SENTRY_TRACES_SAMPLE_RATE ?? defaultSampleRate;

Sentry.init({
  dsn: env.SENTRY_DSN,
  enabled: Boolean(env.SENTRY_DSN),
  environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
  release: env.SENTRY_RELEASE,

  integrations: [
    nodeProfilingIntegration(),
    // Pino logs → Sentry Logs. Exceptions are captured explicitly, so no log level creates issues.
    Sentry.pinoIntegration({ log: { levels: ['info', 'warn', 'error', 'fatal'] } }),
    // CPU, memory and event-loop metrics every 30s.
    Sentry.nodeRuntimeMetricsIntegration(),
  ],

  // Tracing: every request except health checks, which would drown out real traffic.
  tracesSampler: ({ name, inheritOrSampleWith }) =>
    name.includes('/health') ? 0 : inheritOrSampleWith(tracesSampleRate),

  // Profiling: attached to sampled traces.
  profileSessionSampleRate: env.SENTRY_PROFILE_SESSION_SAMPLE_RATE ?? defaultSampleRate,
  profileLifecycle: 'trace',

  // Privacy: this API handles passwords, tokens and encrypted message bodies — keep them out of Sentry.
  dataCollection: {
    cookies: false,
    httpBodies: [],
    httpHeaders: {
      request: { allow: ['user-agent', 'content-type', 'x-request-id'] },
      response: false,
    },
    urlQueryParams: false,
    databaseQueryData: false,
    stackFrameVariables: false,
  },
});
