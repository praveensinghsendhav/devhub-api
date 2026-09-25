import { db } from '../db/knex.js';
import { queryFactory } from '../db/factory/queryFactory.js';

export interface DeviceRow {
  id: string;
  user_id: string;
  device_id: string;
  device_name: string | null;
  user_agent: string | null;
  last_seen_at: Date;
  created_at: Date;
}

const TABLE = 'devices';

export const DeviceModel = {
  /** One row per (user, client-generated device id) — created or refreshed on every login. */
  async upsert(params: {
    userId: string;
    deviceId: string;
    deviceName?: string | null;
    userAgent?: string | null;
  }): Promise<DeviceRow> {
    return queryFactory.upsert<DeviceRow>(
      TABLE,
      {
        user_id: params.userId,
        device_id: params.deviceId,
        device_name: params.deviceName ?? null,
        user_agent: params.userAgent ?? null,
        last_seen_at: db.fn.now(),
      },
      ['user_id', 'device_id'],
      ['device_name', 'user_agent', 'last_seen_at'],
    );
  },

  async findByUserAndDeviceId(userId: string, deviceId: string): Promise<DeviceRow | undefined> {
    return db<DeviceRow>(TABLE).where({ user_id: userId, device_id: deviceId }).first();
  },

  async listForUser(userId: string): Promise<DeviceRow[]> {
    return db<DeviceRow>(TABLE).where({ user_id: userId }).orderBy('last_seen_at', 'desc');
  },

  async touch(id: string): Promise<void> {
    await db<DeviceRow>(TABLE).where({ id }).update({ last_seen_at: db.fn.now() });
  },
};
