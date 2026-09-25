import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { overrideQuery } from './sanitizeRequest.js';

type RequestPart = 'body' | 'query' | 'params';

/** Validates and *replaces* the given request part with the parsed (typed, coerced) result. */
export function validate(schema: ZodType, part: RequestPart = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const parsed = schema.parse(req[part]);
    if (part === 'query') overrideQuery(req, parsed);
    else req[part] = parsed;
    next();
  };
}
