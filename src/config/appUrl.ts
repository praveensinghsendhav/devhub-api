import { env } from './env.js';

/** Absolute URL into the web app, e.g. for invite links admins share by hand. */
export function appUrl(path: string): string {
  const base = (env.APP_URL ?? env.CLIENT_ORIGIN).replace(/\/+$/, '');
  return `${base}${path}`;
}
