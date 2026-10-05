import type { Role } from './enums.js';

export const ORGANIZATION_SIZES = ['1-10', '11-50', '51-200', '201-1000', '1000+'] as const;
export type OrganizationSize = (typeof ORGANIZATION_SIZES)[number];

/** Roles an org admin may hand out through an invite. SUPER_ADMIN is platform-level and never invitable. */
export const INVITABLE_ROLES = ['ADMIN', 'MEMBER', 'GUEST'] as const satisfies readonly Role[];
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
}

export interface Organization extends OrganizationSummary {
  email: string;
  website: string | null;
  industry: string | null;
  size: OrganizationSize | null;
  country: string | null;
  createdAt: string;
}

export interface RegisterOrganizationRequest {
  organization: {
    name: string;
    website?: string;
    industry?: string;
    size?: OrganizationSize;
    country?: string;
  };
  owner: {
    name: string;
    /** Used as both the organization's main contact email and the owner's login email. */
    email: string;
    password: string;
  };
  deviceName?: string;
}

export type InviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export interface OrganizationInvite {
  id: string;
  email: string;
  role: InvitableRole;
  status: InviteStatus;
  invitedBy: { id: string; name: string } | null;
  expiresAt: string;
  createdAt: string;
}

export interface CreateInvitesRequest {
  emails: string[];
  role: InvitableRole;
}

export interface CreatedInvite extends OrganizationInvite {
  /** Shareable accept link. Only returned once, at creation — the server stores just the token hash. */
  inviteUrl: string;
}

export interface CreateInvitesResponse {
  invited: CreatedInvite[];
  /** Emails that were skipped, with a human-readable reason (already a member, already invited...). */
  skipped: { email: string; reason: string }[];
}

/** What an invitee sees before choosing a password — never includes anything but public org info. */
export interface InvitePreview {
  email: string;
  role: InvitableRole;
  organization: OrganizationSummary;
  invitedByName: string | null;
  expiresAt: string;
}

export interface AcceptInviteRequest {
  token: string;
  name: string;
  password: string;
  deviceName?: string;
}

export interface OrganizationMember {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  roles: Role[];
  joinedAt: string;
}
