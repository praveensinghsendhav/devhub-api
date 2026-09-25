import type { Permission, Role } from './enums.js';

/**
 * Single source of truth for role -> default permission grants.
 * Consumed by the API's RBAC seed and by nothing else — clients must
 * always read a user's *effective* permissions from `/auth/me`, never
 * recompute them from a role name, so authorization logic stays in one place.
 */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SUPER_ADMIN: [
    'users:read',
    'users:manage',
    'roles:manage',
    'chat:read',
    'chat:create',
    'chat:manage',
    'whiteboard:read',
    'whiteboard:create',
    'whiteboard:manage',
    'meeting:read',
    'meeting:create',
    'meeting:manage',
    'admin:access',
  ],
  ADMIN: [
    'users:read',
    'users:manage',
    'chat:read',
    'chat:create',
    'chat:manage',
    'whiteboard:read',
    'whiteboard:create',
    'whiteboard:manage',
    'meeting:read',
    'meeting:create',
    'meeting:manage',
    'admin:access',
  ],
  MEMBER: [
    'users:read',
    'chat:read',
    'chat:create',
    'whiteboard:read',
    'whiteboard:create',
    'meeting:read',
    'meeting:create',
  ],
  GUEST: ['chat:read', 'whiteboard:read', 'meeting:read'],
};

export function hasPermission(
  granted: readonly Permission[] | undefined,
  required: Permission | Permission[],
): boolean {
  if (!granted || granted.length === 0) return false;
  const requiredList = Array.isArray(required) ? required : [required];
  return requiredList.every((permission) => granted.includes(permission));
}

export function hasAnyPermission(
  granted: readonly Permission[] | undefined,
  required: Permission[],
): boolean {
  if (!granted || granted.length === 0) return false;
  return required.some((permission) => granted.includes(permission));
}
