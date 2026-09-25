import type { PresenceStatus } from './enums.js';

export const CONVERSATION_TYPES = ['direct', 'group', 'broadcast'] as const;
export type ConversationType = (typeof CONVERSATION_TYPES)[number];

export const CONVERSATION_ROLES = ['admin', 'member'] as const;
export type ConversationRole = (typeof CONVERSATION_ROLES)[number];

/** Fixed reaction palette — keeps storage small and rendering consistent across clients. */
export const REACTION_EMOJIS = ['👍', '❤️', '😂', '🎉', '😮', '😢', '🔥', '👀'] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export const MESSAGE_MAX_LENGTH = 4000;

export interface ConversationMember {
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: ConversationRole;
  joinedAt: string;
  /** Everything at or before this instant has been read by this member. */
  lastReadAt: string;
  /** Everything at or before this instant has reached one of this member's devices. */
  lastDeliveredAt: string;
  /** Snapshot at fetch time; live updates arrive through presence events. */
  status: PresenceStatus;
  customStatus: string | null;
  lastSeenAt: string | null;
}

/** Kept for places that only need a lightweight member reference. */
export type ConversationMemberSummary = Pick<ConversationMember, 'userId' | 'name' | 'avatarUrl'>;

export interface MessagePreview {
  id: string;
  body: string;
  type: MessageType;
  senderId: string;
  senderName: string;
  deleted: boolean;
  createdAt: string;
}

export interface Conversation {
  id: string;
  type: ConversationType;
  /** Display name: the group/broadcast name, or the other person's name for a direct chat. */
  name: string;
  description: string | null;
  onlyAdminsCanPost: boolean;
  isOrgWide: boolean;
  createdBy: string;
  members: ConversationMember[];
  myRole: ConversationRole;
  canPost: boolean;
  lastMessage: MessagePreview | null;
  unreadCount: number;
  updatedAt: string;
  createdAt: string;
}

export type MessageType = 'text' | 'system';

export interface MessageReaction {
  emoji: ReactionEmoji;
  userIds: string[];
}

export interface MessageReplyPreview {
  id: string;
  senderId: string;
  senderName: string;
  body: string;
  deleted: boolean;
}

export interface Message {
  id: string;
  conversationId: string;
  type: MessageType;
  senderId: string;
  senderName: string;
  senderAvatarUrl: string | null;
  body: string;
  replyTo: MessageReplyPreview | null;
  reactions: MessageReaction[];
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
}

export interface MessagePage {
  /** Oldest first. */
  items: Message[];
  hasMore: boolean;
}

export interface CreateGroupRequest {
  name: string;
  description?: string;
  memberIds: string[];
  onlyAdminsCanPost?: boolean;
}

export interface CreateBroadcastRequest {
  name: string;
  description?: string;
  /** Ignored when `allMembers` is true. */
  memberIds?: string[];
  /** Everyone in the organization, including people who join later. */
  allMembers?: boolean;
}

export interface UpdateConversationRequest {
  name?: string;
  description?: string | null;
  onlyAdminsCanPost?: boolean;
}

export interface SendMessageRequest {
  body: string;
  replyToId?: string;
}

// ── Realtime payloads ──────────────────────────────────────────────

export interface ReceiptUpdatePayload {
  conversationId: string;
  userId: string;
  lastReadAt: string;
  lastDeliveredAt: string;
}

export interface TypingRequest {
  conversationId: string;
  isTyping: boolean;
}

export interface TypingUpdatePayload {
  conversationId: string;
  userId: string;
  name: string;
  isTyping: boolean;
}

export interface ConversationEventPayload {
  conversationId: string;
}

export interface DeliveredRequest {
  conversationId: string;
}
