export const ROLES = ['SUPER_ADMIN', 'ADMIN', 'MEMBER', 'GUEST'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
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
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** `in_meeting` is set automatically while you're in a call and is never picked by hand. */
export const PRESENCE_STATUSES = [
  'online',
  'away',
  'busy',
  'dnd',
  'in_meeting',
  'offline',
] as const;
export type PresenceStatus = (typeof PRESENCE_STATUSES)[number];
