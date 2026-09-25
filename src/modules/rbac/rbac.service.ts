import type { Permission, Role } from '../../shared/index.js';
import { db } from '../../db/knex.js';
import { cacheDel, cacheWrap } from '../../config/redis.js';

const PERMISSIONS_CACHE_TTL_SECONDS = 300;

function permissionsCacheKey(userId: string): string {
  return `rbac:user:${userId}:permissions`;
}

/**
 * The single place that turns "this user" into "these roles + these permissions".
 * Every authorization check in the app — the `authorize` middleware, `/auth/me`,
 * socket handshake auth — goes through this, so there is exactly one RBAC code path.
 */
export async function getUserRbac(
  userId: string,
): Promise<{ roles: Role[]; permissions: Permission[] }> {
  return cacheWrap(permissionsCacheKey(userId), PERMISSIONS_CACHE_TTL_SECONDS, async () => {
    const roleRows = await db('user_roles')
      .join('roles', 'roles.id', 'user_roles.role_id')
      .where('user_roles.user_id', userId)
      .select<{ name: Role }[]>('roles.name');

    const roles = roleRows.map((row) => row.name);
    if (roles.length === 0) return { roles: [], permissions: [] };

    const permissionRows = await db('user_roles')
      .join('role_permissions', 'role_permissions.role_id', 'user_roles.role_id')
      .join('permissions', 'permissions.id', 'role_permissions.permission_id')
      .where('user_roles.user_id', userId)
      .distinct<{ key: Permission }[]>('permissions.key');

    const permissions = permissionRows.map((row) => row.key);
    return { roles, permissions };
  });
}

export async function invalidateUserRbacCache(userId: string): Promise<void> {
  await cacheDel(permissionsCacheKey(userId));
}
