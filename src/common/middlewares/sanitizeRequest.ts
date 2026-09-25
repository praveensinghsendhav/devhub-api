import type { NextFunction, Request, Response } from 'express';
import { sanitizeValue } from '../utils/sanitize.js';

/**
 * Express 5 exposes `req.query` as a getter-only property, so plain assignment throws. Shadowing
 * it with an own data property on the request keeps the sanitized/parsed value visible downstream.
 */
export function overrideQuery(req: Request, value: unknown): void {
  Object.defineProperty(req, 'query', {
    value,
    writable: true,
    configurable: true,
    enumerable: true,
  });
}

export function sanitizeRequest(req: Request, _res: Response, next: NextFunction): void {
  if (req.body) req.body = sanitizeValue(req.body);
  if (req.query) overrideQuery(req, sanitizeValue(req.query));
  if (req.params) req.params = sanitizeValue(req.params) as typeof req.params;
  next();
}
