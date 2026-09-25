import type { Socket } from 'socket.io';
import type { PeerMediaState } from '../shared/index.js';
import { verifyAccessToken } from '../common/utils/jwt.js';
import { UserModel } from '../models/user.model.js';

export interface SocketData {
  userId: string;
  deviceId: string;
  name: string;
  organizationId: string | null;
  avatarUrl: string | null;
  /** Set while this socket is in a call. Only trusted together with membership of the meeting room. */
  meeting?: { meetingId: string; state: PeerMediaState; joinedAt: string };
}

/** Mirrors the REST `authenticate` middleware for the socket handshake — same token, same rules. */
export function socketAuthMiddleware(
  socket: Socket<Record<string, never>, Record<string, never>, Record<string, never>, SocketData>,
  next: (err?: Error) => void,
): void {
  const token = socket.handshake.auth?.token as string | undefined;
  if (!token) {
    next(new Error('Missing access token'));
    return;
  }

  let payload: ReturnType<typeof verifyAccessToken>;
  try {
    payload = verifyAccessToken(token);
  } catch {
    next(new Error('Invalid or expired access token'));
    return;
  }

  // Load the user once per connection so handlers know their name + organization.
  UserModel.findById(payload.sub)
    .then((user) => {
      if (!user || !user.is_active) {
        next(new Error('Account not found'));
        return;
      }
      socket.data.userId = user.id;
      socket.data.deviceId = payload.deviceId;
      socket.data.name = user.name;
      socket.data.organizationId = user.organization_id;
      socket.data.avatarUrl = user.avatar_url;
      next();
    })
    .catch(() => next(new Error('Could not verify account')));
}
