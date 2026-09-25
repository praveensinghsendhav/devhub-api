import { randomBytes, createHash } from 'node:crypto';
import argon2 from 'argon2';
import * as Sentry from '@sentry/node';
import type { AuthUser, InvitableRole } from '../../shared/index.js';
import { env } from '../../config/env.js';
import { db } from '../../db/knex.js';
import { UserModel } from '../../models/user.model.js';
import { RoleModel } from '../../models/role.model.js';
import { OrganizationModel } from '../../models/organization.model.js';
import { OrganizationInviteModel } from '../../models/organizationInvite.model.js';
import { findPendingInviteOrThrow, uniqueSlug } from '../organizations/organizations.service.js';
import type {
  AcceptInviteInput,
  RegisterOrganizationInput,
} from '../organizations/organizations.validators.js';
import { DeviceModel } from '../../models/device.model.js';
import { RefreshTokenModel } from '../../models/refreshToken.model.js';
import { UserStatusModel } from '../../models/userStatus.model.js';
import { getAuthUser } from '../users/users.service.js';
import { addUserToOrgWideBroadcasts } from '../chat/chat.service.js';
import { signAccessToken } from '../../common/utils/jwt.js';
import { AppError } from '../../common/errors/AppError.js';
import { ERROR_CODES } from '../../common/constants/errorCodes.js';
import { HTTP_STATUS } from '../../common/constants/httpStatus.js';
import { RESPONSE_MESSAGES } from '../../common/constants/responseMessages.js';

const REFRESH_TOKEN_BYTES = 64;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function refreshTokenExpiry(): Date {
  return new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

interface DeviceContext {
  deviceId: string;
  deviceName?: string | null;
  userAgent?: string | null;
}

interface AuthResult {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

async function issueSession(userId: string, device: DeviceContext): Promise<AuthResult> {
  const deviceRow = await DeviceModel.upsert({
    userId,
    deviceId: device.deviceId,
    deviceName: device.deviceName,
    userAgent: device.userAgent,
  });

  // One active refresh token per device at a time; a new login/refresh on this device supersedes the old one.
  await RefreshTokenModel.revokeAllForDevice(deviceRow.id);

  const rawRefreshToken = randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
  const expiresAt = refreshTokenExpiry();
  await RefreshTokenModel.create({
    userId,
    deviceRowId: deviceRow.id,
    tokenHash: hashToken(rawRefreshToken),
    expiresAt,
  });

  const accessToken = signAccessToken({ sub: userId, deviceId: device.deviceId });
  const user = await getAuthUser(userId);

  return { user, accessToken, refreshToken: rawRefreshToken, refreshTokenExpiresAt: expiresAt };
}

export async function login(
  email: string,
  password: string,
  device: DeviceContext,
): Promise<AuthResult> {
  const userRow = await UserModel.findByEmail(email);
  if (!userRow || !userRow.is_active) {
    Sentry.metrics.count('auth.login', 1, { attributes: { result: 'failure' } });
    throw new AppError(
      HTTP_STATUS.UNAUTHORIZED,
      ERROR_CODES.INVALID_CREDENTIALS,
      RESPONSE_MESSAGES.INVALID_CREDENTIALS,
    );
  }

  const passwordOk = await argon2.verify(userRow.password_hash, password);
  if (!passwordOk) {
    Sentry.metrics.count('auth.login', 1, { attributes: { result: 'failure' } });
    throw new AppError(
      HTTP_STATUS.UNAUTHORIZED,
      ERROR_CODES.INVALID_CREDENTIALS,
      RESPONSE_MESSAGES.INVALID_CREDENTIALS,
    );
  }

  Sentry.metrics.count('auth.login', 1, { attributes: { result: 'success' } });
  await UserStatusModel.upsert(userRow.id, 'online', null);
  return issueSession(userRow.id, device);
}

function emailTakenError(): AppError {
  return new AppError(
    HTTP_STATUS.CONFLICT,
    ERROR_CODES.CONFLICT,
    'An account with this email already exists — sign in instead',
  );
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | undefined)?.code === '23505';
}

async function roleIdOrThrow(roleName: InvitableRole): Promise<string> {
  const role = await RoleModel.findByName(roleName);
  if (!role) throw new Error(`Role ${roleName} is missing — run the database seed`);
  return role.id;
}

/**
 * Creates an organization and its owner in one transaction. The owner's login email doubles as the
 * organization's main contact email, and the owner becomes the org's first ADMIN.
 */
export async function registerOrganization(
  input: RegisterOrganizationInput,
  device: DeviceContext,
): Promise<AuthResult> {
  const { organization, owner } = input;

  if (
    (await UserModel.existsByEmail(owner.email)) ||
    (await OrganizationModel.existsByEmail(owner.email))
  ) {
    throw emailTakenError();
  }

  const [passwordHash, slug, adminRoleId] = await Promise.all([
    argon2.hash(owner.password),
    uniqueSlug(organization.name),
    roleIdOrThrow('ADMIN'),
  ]);

  let userId: string;
  try {
    userId = await db.transaction(async (trx) => {
      const org = await OrganizationModel.create(
        { ...organization, slug, email: owner.email },
        trx,
      );
      const user = await UserModel.create(
        { email: owner.email, name: owner.name, passwordHash, organizationId: org.id },
        trx,
      );
      await RoleModel.assignToUser(user.id, adminRoleId, trx);
      await OrganizationModel.setCreatedBy(org.id, user.id, trx);
      return user.id;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw emailTakenError();
    throw err;
  }

  await UserStatusModel.upsert(userId, 'online', null);
  return issueSession(userId, device);
}

/** Turns a pending invite into an account in the inviting org, with the password the invitee picks. */
export async function acceptInvite(
  input: AcceptInviteInput,
  device: DeviceContext,
): Promise<AuthResult> {
  const invite = await findPendingInviteOrThrow(input.token);
  if (await UserModel.existsByEmail(invite.email)) throw emailTakenError();

  const [passwordHash, roleId] = await Promise.all([
    argon2.hash(input.password),
    roleIdOrThrow(invite.role),
  ]);

  let userId: string;
  try {
    userId = await db.transaction(async (trx) => {
      const claimed = await OrganizationInviteModel.markAccepted(invite.id, trx);
      if (!claimed) {
        throw new AppError(
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.NOT_FOUND,
          'This invite link is invalid, expired, or has already been used',
        );
      }
      const user = await UserModel.create(
        {
          email: invite.email,
          name: input.name,
          passwordHash,
          organizationId: invite.organization_id,
        },
        trx,
      );
      await RoleModel.assignToUser(user.id, roleId, trx);
      return user.id;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw emailTakenError();
    throw err;
  }

  await addUserToOrgWideBroadcasts(userId, invite.organization_id);
  await UserStatusModel.upsert(userId, 'online', null);
  return issueSession(userId, device);
}

export async function refresh(rawRefreshToken: string, device: DeviceContext): Promise<AuthResult> {
  const tokenRow = await RefreshTokenModel.findActiveByHash(hashToken(rawRefreshToken));
  if (!tokenRow) {
    throw new AppError(
      HTTP_STATUS.UNAUTHORIZED,
      ERROR_CODES.TOKEN_INVALID,
      'Session expired, please sign in again',
    );
  }

  const deviceRow = await DeviceModel.findByUserAndDeviceId(tokenRow.user_id, device.deviceId);
  if (!deviceRow || deviceRow.id !== tokenRow.device_row_id) {
    throw new AppError(
      HTTP_STATUS.UNAUTHORIZED,
      ERROR_CODES.TOKEN_INVALID,
      'Session does not match this device',
    );
  }

  await DeviceModel.touch(deviceRow.id);
  return issueSession(tokenRow.user_id, device);
}

export async function logout(rawRefreshToken: string | undefined): Promise<void> {
  if (!rawRefreshToken) return;
  const tokenRow = await RefreshTokenModel.findActiveByHash(hashToken(rawRefreshToken));
  if (tokenRow) {
    await RefreshTokenModel.revokeById(tokenRow.id);
  }
}
