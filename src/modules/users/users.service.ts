import type { AuthUser } from '../../shared/index.js';
import { UserModel } from '../../models/user.model.js';
import { UserStatusModel } from '../../models/userStatus.model.js';
import { OrganizationModel } from '../../models/organization.model.js';
import { getUserRbac } from '../rbac/rbac.service.js';

/** Assembles the single "who is this user, what can they do, what's their status" shape used everywhere. */
export async function getAuthUser(userId: string): Promise<AuthUser> {
  const [user, rbac, status] = await Promise.all([
    UserModel.findByIdOrThrow(userId),
    getUserRbac(userId),
    UserStatusModel.getByUserId(userId),
  ]);

  const organization = user.organization_id
    ? await OrganizationModel.findById(user.organization_id)
    : undefined;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatar_url,
    organization: organization
      ? { id: organization.id, name: organization.name, slug: organization.slug }
      : null,
    roles: rbac.roles,
    permissions: rbac.permissions,
    status: status?.status ?? 'offline',
    customStatus: status?.custom_status ?? null,
  };
}
