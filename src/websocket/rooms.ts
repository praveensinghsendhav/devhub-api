/** Room naming lives in one place so emitters and joiners can't drift apart. */

export function conversationRoom(conversationId: string): string {
  return `conversation:${conversationId}`;
}

/** Every socket of a user joins this, so server code can reach "all of X's devices". */
export function userRoom(userId: string): string {
  return `user:${userId}`;
}

/** Presence is scoped per organization; platform accounts (no org) share one room. */
export function presenceRoom(organizationId: string | null): string {
  return `presence:${organizationId ?? 'platform'}`;
}

/** Everyone connected to a live call. Being in this room is what "in the call" means. */
export function meetingRoom(meetingId: string): string {
  return `meeting:${meetingId}`;
}
