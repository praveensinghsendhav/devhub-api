import type { PresenceStatus } from '../shared/index.js';
import { db } from '../db/knex.js';
import { queryFactory } from '../db/factory/queryFactory.js';

export interface UserStatusRow {
  user_id: string;
  status: PresenceStatus;
  custom_status: string | null;
  last_seen_at: Date;
  updated_at: Date;
}

const TABLE = 'user_status';

export const UserStatusModel = {
  async upsert(userId: string, status: PresenceStatus, customStatus: string | null) {
    return queryFactory.upsert<UserStatusRow>(
      TABLE,
      {
        user_id: userId,
        status,
        custom_status: customStatus,
        last_seen_at: db.fn.now(),
        updated_at: db.fn.now(),
      },
      ['user_id'],
      ['status', 'custom_status', 'last_seen_at', 'updated_at'],
    );
  },

  async touchLastSeen(userId: string): Promise<void> {
    await db<UserStatusRow>(TABLE).where({ user_id: userId }).update({ last_seen_at: db.fn.now() });
  },

  async getByUserId(userId: string): Promise<UserStatusRow | undefined> {
    return db<UserStatusRow>(TABLE).where({ user_id: userId }).first();
  },

  async getByUserIds(userIds: string[]): Promise<UserStatusRow[]> {
    if (userIds.length === 0) return [];
    return db<UserStatusRow>(TABLE).whereIn('user_id', userIds);
  },
};
