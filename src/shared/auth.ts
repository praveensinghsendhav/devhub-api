import type { Permission, PresenceStatus, Role } from './enums.js';
import type { OrganizationSummary } from './organization.js';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  /** Null only for platform-level accounts (e.g. the seeded super admin) that don't belong to an org. */
  organization: OrganizationSummary | null;
  roles: Role[];
  permissions: Permission[];
  status: PresenceStatus;
  customStatus: string | null;
}

export interface AuthTokens {
  accessToken: string;
  accessTokenExpiresAt: string;
}

export interface LoginRequest {
  email: string;
  password: string;
  /** Human-readable label for this device/session (e.g. "Chrome on macOS"). The device's identity itself travels as the `x-device-id` header, not the body. */
  deviceName?: string;
}

export interface LoginResponse {
  user: AuthUser;
  tokens: AuthTokens;
}
