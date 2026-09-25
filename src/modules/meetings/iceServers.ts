import { createHmac } from 'node:crypto';
import type { IceServerConfig } from '../../shared/index.js';
import { env } from '../../config/env.js';

const list = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);

/**
 * ICE servers for one user's call. TURN credentials use coturn's REST scheme: the username
 * carries an expiry, the password is an HMAC of it with a secret only the TURN server and this
 * API know, so a leaked credential stops working on its own and can't be used to mint others.
 */
export function iceServersFor(userId: string): IceServerConfig[] {
  const servers: IceServerConfig[] = [];
  const stun = list(env.STUN_URLS);
  if (stun.length > 0) servers.push({ urls: stun });

  const turn = list(env.TURN_URLS);
  if (turn.length > 0 && env.TURN_SECRET) {
    const username = `${Math.floor(Date.now() / 1000) + env.TURN_TTL_SECONDS}:${userId}`;
    const credential = createHmac('sha1', env.TURN_SECRET).update(username).digest('base64');
    servers.push({ urls: turn, username, credential });
  }
  return servers;
}
