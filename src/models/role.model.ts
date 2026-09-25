import type { Role } from '../shared/index.js';
import { db } from '../db/knex.js';

export interface RoleRow {
  id: string;
  name: Role;
}

export const RoleModel = {
  async findByName(name: Role): Promise<RoleRow | undefined> {
    return db<RoleRow>('roles').where({ name }).first();
  },

  async assignToUser(userId: string, roleId: string, trx = db): Promise<void> {
    await trx('user_roles')
      .insert({ user_id: userId, role_id: roleId })
      .onConflict(['user_id', 'role_id'])
      .ignore();
  },

  async removeFromUser(userId: string, roleId: string): Promise<void> {
    await db('user_roles').where({ user_id: userId, role_id: roleId }).delete();
  },
};
