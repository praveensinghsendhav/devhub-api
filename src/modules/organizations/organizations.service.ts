import { randomBytes, createHash } from 'node:crypto';
import type {
  AuthUser,
  CreateInvitesResponse,
  InvitePreview,
  InviteStatus,
  Organization,
  OrganizationInvite,
  OrganizationMember,
  Role,
} from '../../shared/index.js';
import { env } from '../../config/env.js';
import { appUrl } from '../../config/appUrl.js';
import { OrganizationModel, type OrganizationRow } from '../../models/organization.model.js';
import {
  OrganizationInviteModel,
  type OrganizationInviteWithInviter,
} from '../../models/organizationInvite.model.js';
import { UserModel } from '../../models/user.model.js';
import { AppError } from '../../common/errors/AppError.js';
import { ERROR_CODES } from '../../common/constants/errorCodes.js';
import { HTTP_STATUS } from '../../common/constants/httpStatus.js';
import type { CreateInvitesInput } from './organizations.validators.js';

const INVITE_TOKEN_BYTES = 32;

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function toOrganization(row: OrganizationRow): Organization {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    email: row.email,
    website: row.website,
    industry: row.industry,
    size: row.size,
    country: row.country,
    createdAt: row.created_at.toISOString(),
  };
}

function inviteStatus(row: OrganizationInviteWithInviter): InviteStatus {
  if (row.accepted_at) return 'accepted';
  if (row.revoked_at) return 'revoked';
  if (row.expires_at.getTime() <= Date.now()) return 'expired';
  return 'pending';
}

function toInvite(row: OrganizationInviteWithInviter): OrganizationInvite {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: inviteStatus(row),
    invitedBy: row.invited_by ? { id: row.invited_by, name: row.inviter_name ?? 'Unknown' } : null,
    expiresAt: row.expires_at.toISOString(),
    createdAt: row.created_at.toISOString(),
  };
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120) || 'org'
  );
}

/** A URL-safe unique slug; collisions get a short random suffix instead of a retry loop over counters. */
export async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  if (!(await OrganizationModel.existsBySlug(base))) return base;
  return `${base}-${randomBytes(3).toString('hex')}`;
}

function requireOrganizationId(user: AuthUser): string {
  if (!user.organization) {
    throw new AppError(
      HTTP_STATUS.FORBIDDEN,
      ERROR_CODES.FORBIDDEN,
      'Your account is not part of an organization',
    );
  }
  return user.organization.id;
}

export async function getCurrentOrganization(user: AuthUser): Promise<Organization> {
  const row = await OrganizationModel.findByIdOrThrow(requireOrganizationId(user));
  return toOrganization(row);
}

export async function listMembers(user: AuthUser): Promise<OrganizationMember[]> {
  const rows = await UserModel.listMembersWithRoles(requireOrganizationId(user));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    avatarUrl: row.avatar_url,
    roles: (row.role_names ?? []) as Role[],
    joinedAt: new Date(row.created_at).toISOString(),
  }));
}

export async function listInvites(user: AuthUser): Promise<OrganizationInvite[]> {
  const rows = await OrganizationInviteModel.listForOrganization(requireOrganizationId(user));
  return rows.map(toInvite);
}

export async function createInvites(
  user: AuthUser,
  input: CreateInvitesInput,
): Promise<CreateInvitesResponse> {
  const organizationId = requireOrganizationId(user);
  const result: CreateInvitesResponse = { invited: [], skipped: [] };

  for (const email of input.emails) {
    const existingUser = await UserModel.findByEmail(email);
    if (existingUser) {
      result.skipped.push({
        email,
        reason:
          existingUser.organization_id === organizationId
            ? 'Already a member of your organization'
            : 'This email already has a DevHub account',
      });
      continue;
    }

    // Re-inviting replaces any older link, so only the newest email works.
    await OrganizationInviteModel.revokePendingForEmail(organizationId, email);

    const rawToken = randomBytes(INVITE_TOKEN_BYTES).toString('hex');
    const expiresAt = new Date(Date.now() + env.INVITE_TTL_HOURS * 60 * 60 * 1000);
    const row = await OrganizationInviteModel.create({
      organizationId,
      email,
      role: input.role,
      tokenHash: hashInviteToken(rawToken),
      invitedBy: user.id,
      expiresAt,
    });

    // No email is sent: the admin copies this link and shares it with the invitee themselves.
    result.invited.push({
      ...toInvite({ ...row, inviter_name: user.name }),
      inviteUrl: appUrl(`/invite?token=${rawToken}`),
    });
  }

  return result;
}

export async function revokeInvite(user: AuthUser, inviteId: string): Promise<void> {
  const revoked = await OrganizationInviteModel.revoke(inviteId, requireOrganizationId(user));
  if (!revoked) {
    throw new AppError(
      HTTP_STATUS.NOT_FOUND,
      ERROR_CODES.NOT_FOUND,
      'Invite not found or no longer pending',
    );
  }
}

/** Resolves a raw invite token to its pending invite, or a single generic error for any failure. */
export async function findPendingInviteOrThrow(rawToken: string) {
  const invite = await OrganizationInviteModel.findPendingByTokenHash(hashInviteToken(rawToken));
  if (!invite) {
    throw new AppError(
      HTTP_STATUS.NOT_FOUND,
      ERROR_CODES.NOT_FOUND,
      'This invite link is invalid, expired, or has already been used',
    );
  }
  return invite;
}

export async function previewInvite(rawToken: string): Promise<InvitePreview> {
  const invite = await findPendingInviteOrThrow(rawToken);
  const organization = await OrganizationModel.findByIdOrThrow(invite.organization_id);
  return {
    email: invite.email,
    role: invite.role,
    organization: { id: organization.id, name: organization.name, slug: organization.slug },
    invitedByName: invite.inviter_name,
    expiresAt: invite.expires_at.toISOString(),
  };
}
