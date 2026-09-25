import type { PresenceStatus, PresenceUpdatePayload } from '../../shared/index.js';
import { redis } from '../../config/redis.js';
import { UserStatusModel } from '../../models/userStatus.model.js';

const OFFLINE_GRACE_MS = 8_000;
const MANUAL_STATUSES: PresenceStatus[] = ['away', 'busy', 'dnd'];

function connectionSetKey(userId: string): string {
  return `presence:connections:${userId}`;
}

async function toPayload(userId: string): Promise<PresenceUpdatePayload> {
  const row = await UserStatusModel.getByUserId(userId);
  return {
    userId,
    status: row?.status ?? 'offline',
    customStatus: row?.custom_status ?? null,
    lastSeenAt: (row?.last_seen_at ?? new Date()).toISOString(),
  };
}

/** Registers a new socket connection for a user; flips them online unless they set a manual status. */
export async function registerConnection(
  userId: string,
  socketId: string,
): Promise<PresenceUpdatePayload> {
  await redis.sadd(connectionSetKey(userId), socketId);
  const current = await UserStatusModel.getByUserId(userId);
  if (!current || current.status === 'offline') {
    await UserStatusModel.upsert(userId, 'online', current?.custom_status ?? null);
  } else {
    await UserStatusModel.touchLastSeen(userId);
  }
  return toPayload(userId);
}

/** Removes a socket connection; after a short grace period, flips the user offline if nothing reconnected. */
export async function deregisterConnection(
  userId: string,
  socketId: string,
  onBecomeOffline: (payload: PresenceUpdatePayload) => void,
): Promise<void> {
  const key = connectionSetKey(userId);
  await redis.srem(key, socketId);

  setTimeout(() => {
    void (async () => {
      const remaining = await redis.scard(key);
      if (remaining > 0) return;
      await UserStatusModel.upsert(userId, 'offline', null);
      onBecomeOffline(await toPayload(userId));
    })();
  }, OFFLINE_GRACE_MS);
}

export async function setManualStatus(
  userId: string,
  status: PresenceStatus,
  customStatus: string | null,
): Promise<PresenceUpdatePayload> {
  const connectionCount = await redis.scard(connectionSetKey(userId));
  const resolvedStatus: PresenceStatus =
    connectionCount === 0 && !MANUAL_STATUSES.includes(status) ? 'offline' : status;
  await UserStatusModel.upsert(userId, resolvedStatus, customStatus);
  return toPayload(userId);
}

export async function getStatuses(userIds: string[]): Promise<PresenceUpdatePayload[]> {
  const rows = await UserStatusModel.getByUserIds(userIds);
  return rows.map((row) => ({
    userId: row.user_id,
    status: row.status,
    customStatus: row.custom_status,
    lastSeenAt: row.last_seen_at.toISOString(),
  }));
}

// ── Meetings ───────────────────────────────────────────────────────

function preMeetingKey(userId: string): string {
  return `presence:pre-meeting:${userId}`;
}

/**
 * Shows "In a meeting" while a call is open. Do-not-disturb is left alone (it's the stronger
 * signal); anything else is stashed and restored when the last call on any device ends.
 */
export async function enterMeeting(userId: string): Promise<PresenceUpdatePayload | null> {
  const current = await UserStatusModel.getByUserId(userId);
  const status = current?.status ?? 'online';
  if (status === 'dnd' || status === 'in_meeting') return null;
  await redis.set(preMeetingKey(userId), status === 'offline' ? 'online' : status, 'EX', 86_400);
  await UserStatusModel.upsert(userId, 'in_meeting', current?.custom_status ?? null);
  return toPayload(userId);
}

export async function leaveMeeting(userId: string): Promise<PresenceUpdatePayload | null> {
  const previous = (await redis.getdel(preMeetingKey(userId))) as PresenceStatus | null;
  const current = await UserStatusModel.getByUserId(userId);
  // They picked a status by hand mid-call — keep theirs.
  if (current?.status !== 'in_meeting') return null;
  const connected = (await redis.scard(connectionSetKey(userId))) > 0;
  await UserStatusModel.upsert(
    userId,
    connected ? (previous ?? 'online') : 'offline',
    current.custom_status,
  );
  return toPayload(userId);
}
