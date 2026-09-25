import type { PresenceStatus } from './enums.js';

/** Single source of truth for socket event names — shared by server emitters and client listeners. */
export const SOCKET_EVENTS = {
  PRESENCE_UPDATE: 'presence:update',
  STATUS_UPDATE: 'status:update',
  MESSAGE_NEW: 'message:new',
  /** Edit, delete or reaction change — payload is the full updated message. */
  MESSAGE_UPDATED: 'message:updated',
  /** Client → server: "messages in this conversation reached my device". */
  MESSAGE_DELIVERED: 'message:delivered',
  RECEIPT_UPDATE: 'receipt:update',
  /** Client → server typing state. */
  TYPING: 'typing',
  /** Server → client typing state of someone else. */
  TYPING_UPDATE: 'typing:update',
  /** Members, roles or settings changed — refetch the conversation list. */
  CONVERSATION_UPDATED: 'conversation:updated',
  /** You were removed from (or left) a conversation. */
  CONVERSATION_REMOVED: 'conversation:removed',

  // ── Meetings (client → server; most take an ack callback) ──
  MEETING_JOIN: 'meeting:join',
  MEETING_LEAVE: 'meeting:leave',
  /** Both directions: SDP / ICE / quality preference relayed between two peers. */
  MEETING_SIGNAL: 'meeting:signal',
  MEETING_MEDIA: 'meeting:media',
  /** Both directions: ephemeral in-call chat (never stored). */
  MEETING_CHAT: 'meeting:chat',
  /** Both directions: floating emoji reaction. */
  MEETING_REACTION: 'meeting:reaction',
  MEETING_HOST_ACTION: 'meeting:host-action',
  /** Both directions: ask to enter a locked meeting / hosts hear the request. */
  MEETING_KNOCK: 'meeting:knock',
  MEETING_ADMIT: 'meeting:admit',
  /** Client → server: decline an incoming ring. */
  MEETING_DECLINE: 'meeting:decline',

  // ── Meetings (server → client) ──
  MEETING_PEER_JOINED: 'meeting:peer-joined',
  MEETING_PEER_LEFT: 'meeting:peer-left',
  MEETING_PEER_UPDATED: 'meeting:peer-updated',
  MEETING_HOST_COMMAND: 'meeting:host-command',
  MEETING_ROOM_STATE: 'meeting:room-state',
  MEETING_ADMITTED: 'meeting:admitted',
  MEETING_REMOVED: 'meeting:removed',
  /** Incoming call. */
  MEETING_RING: 'meeting:ring',
  /** Stop ringing: answered elsewhere, declined, or the call ended. */
  MEETING_RING_CANCEL: 'meeting:ring-cancel',
  MEETING_DECLINED: 'meeting:declined',
  /** A meeting you're part of was created, edited, cancelled or re-invited — refetch lists. */
  MEETING_CHANGED: 'meeting:changed',
  CONNECT_ERROR: 'connect_error',
} as const;

export type SocketEventName = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];

export interface PresenceUpdatePayload {
  userId: string;
  status: PresenceStatus;
  customStatus: string | null;
  lastSeenAt: string;
}

export interface StatusUpdateRequest {
  status: PresenceStatus;
  customStatus?: string | null;
}
