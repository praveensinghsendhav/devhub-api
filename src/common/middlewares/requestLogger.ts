import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { logger } from '../../config/logger.js';
import { isProduction } from '../../config/env.js';

const IGNORED_PATHS = new Set(['/health']);

/**
 * One line per request: `POST /api/auth/login 200 12.4ms`. 4xx logs as warn, 5xx as error.
 * Headers, cookies and bodies are never logged, so tokens can't leak into the output.
 * Production adds structured fields (for log search); development stays a single readable line.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const existing = req.headers['x-request-id'];
  const requestId = typeof existing === 'string' && existing ? existing : randomUUID();
  res.setHeader('x-request-id', requestId);

  if (IGNORED_PATHS.has(req.path)) {
    next();
    return;
  }

  const start = process.hrtime.bigint();

  res.once('close', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const status = res.statusCode;
    const aborted = !res.writableFinished;
    const level = status >= 500 ? 'error' : status >= 400 || aborted ? 'warn' : 'info';
    const message = `${req.method} ${req.originalUrl} ${aborted ? 'ABORTED' : status} ${ms.toFixed(1)}ms`;

    if (isProduction) {
      logger[level]({ requestId, method: req.method, url: req.originalUrl, status, ms }, message);
    } else {
      logger[level](message);
    }
  });

  next();
}
