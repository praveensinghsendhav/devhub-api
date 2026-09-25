import { db } from '../db/knex.js';

export interface RefreshTokenRow {
  id: string;
  user_id: string;
  device_row_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
}

const TABLE = 'refresh_tokens';

export const RefreshTokenModel = {
  async create(params: {
    userId: string;
    deviceRowId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<RefreshTokenRow> {
    const [row] = await db<RefreshTokenRow>(TABLE)
      .insert({
        user_id: params.userId,
        device_row_id: params.deviceRowId,
        token_hash: params.tokenHash,
        expires_at: params.expiresAt,
      })
      .returning('*');
    return row as RefreshTokenRow;
  },

  /** Active (non-revoked, non-expired) token for a device, by hash. */
  async findActiveByHash(tokenHash: string): Promise<RefreshTokenRow | undefined> {
    return db<RefreshTokenRow>(TABLE)
      .where({ token_hash: tokenHash })
      .whereNull('revoked_at')
      .where('expires_at', '>', db.fn.now())
      .first();
  },

  async revokeById(id: string): Promise<void> {
    await db<RefreshTokenRow>(TABLE).where({ id }).update({ revoked_at: db.fn.now() });
  },

  async revokeAllForDevice(deviceRowId: string): Promise<void> {
    await db<RefreshTokenRow>(TABLE)
      .where({ device_row_id: deviceRowId })
      .whereNull('revoked_at')
      .update({ revoked_at: db.fn.now() });
  },

  async revokeAllForUser(userId: string): Promise<void> {
    await db<RefreshTokenRow>(TABLE)
      .where({ user_id: userId })
      .whereNull('revoked_at')
      .update({ revoked_at: db.fn.now() });
  },
};
