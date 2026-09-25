import type { AuthUser } from '../shared/index.js';

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      deviceId?: string;
      requestId?: string;
    }
  }
}

export {};
