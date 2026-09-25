import type { Knex } from 'knex';
import { db } from '../db/knex.js';
import { queryFactory } from '../db/factory/queryFactory.js';

export interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  avatar_url: string | null;
  is_active: boolean;
  organization_id: string | null;
  created_at: Date;
  updated_at: Date;
}

const TABLE = 'users';

/** Scopes a users query to one organization; platform accounts (no org) only ever see each other. */
function inOrganization<T extends Knex.QueryBuilder>(query: T, organizationId: string | null): T {
  return (
    organizationId
      ? query.where({ organization_id: organizationId })
      : query.whereNull('organization_id')
  ) as T;
}

export const UserModel = {
  async findByEmail(email: string): Promise<UserRow | undefined> {
    return db<UserRow>(TABLE).where({ email: email.toLowerCase() }).first();
  },

  async findById(id: string): Promise<UserRow | undefined> {
    return db<UserRow>(TABLE).where({ id }).first();
  },

  async findByIdOrThrow(id: string): Promise<UserRow> {
    return queryFactory.findOneOrThrow<UserRow>(db<UserRow>(TABLE).where({ id }), 'User not found');
  },

  async existsByEmail(email: string): Promise<boolean> {
    return queryFactory.exists(db<UserRow>(TABLE).where({ email: email.toLowerCase() }));
  },

  async create(
    data: { email: string; name: string; passwordHash: string; organizationId?: string | null },
    trx: Knex | Knex.Transaction = db,
  ): Promise<UserRow> {
    const [row] = await trx<UserRow>(TABLE)
      .insert({
        email: data.email.toLowerCase(),
        name: data.name,
        password_hash: data.passwordHash,
        organization_id: data.organizationId ?? null,
      })
      .returning('*');
    return row as UserRow;
  },

  async listActive(organizationId: string | null): Promise<UserRow[]> {
    return inOrganization(db<UserRow>(TABLE).where({ is_active: true }), organizationId).orderBy(
      'name',
      'asc',
    );
  },

  async listMembersWithRoles(
    organizationId: string,
  ): Promise<(UserRow & { role_names: string[] | null })[]> {
    return db(TABLE)
      .leftJoin('user_roles', 'user_roles.user_id', `${TABLE}.id`)
      .leftJoin('roles', 'roles.id', 'user_roles.role_id')
      .where(`${TABLE}.organization_id`, organizationId)
      .andWhere(`${TABLE}.is_active`, true)
      .groupBy(`${TABLE}.id`)
      .select(`${TABLE}.*`, db.raw('array_remove(array_agg(roles.name), NULL) as role_names'))
      .orderBy(`${TABLE}.created_at`, 'asc');
  },

  async findActiveInOrganization(ids: string[], organizationId: string | null): Promise<UserRow[]> {
    if (ids.length === 0) return [];
    return inOrganization(
      db<UserRow>(TABLE).whereIn('id', ids).where({ is_active: true }),
      organizationId,
    );
  },

  async areInSameOrganization(userId: string, otherUserId: string): Promise<boolean> {
    const rows = await db<UserRow>(TABLE)
      .whereIn('id', [userId, otherUserId])
      .select('organization_id');
    return rows.length === 2 && rows[0]!.organization_id === rows[1]!.organization_id;
  },
};
