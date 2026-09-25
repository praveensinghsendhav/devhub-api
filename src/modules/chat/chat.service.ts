import type {
  AuthUser,
  Conversation,
  ConversationMember,
  ConversationRole,
  Message,
  MessagePage,
  MessageReaction,
  ReactionEmoji,
} from '../../shared/index.js';
import * as Sentry from '@sentry/node';
import { db } from '../../db/knex.js';
import {
  ConversationModel,
  type ConversationMemberDetailRow,
  type ConversationMemberRow,
  type ConversationRow,
} from '../../models/conversation.model.js';
import {
  MessageModel,
  type MessageDetailRow,
  type ReactionRow,
} from '../../models/message.model.js';
import { UserModel } from '../../models/user.model.js';
import { AppError } from '../../common/errors/AppError.js';
import { ERROR_CODES } from '../../common/constants/errorCodes.js';
import { HTTP_STATUS } from '../../common/constants/httpStatus.js';
import * as realtime from './chat.realtime.js';
import type {
  CreateBroadcastInput,
  CreateGroupInput,
  SendMessageInput,
  UpdateConversationInput,
} from './chat.validators.js';

// ── Errors ─────────────────────────────────────────────────────────

const forbidden = (message: string) =>
  new AppError(HTTP_STATUS.FORBIDDEN, ERROR_CODES.FORBIDDEN, message);
const notFound = (message: string) =>
  new AppError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND, message);
const badRequest = (message: string) =>
  new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, message);

// ── Mapping ────────────────────────────────────────────────────────

function toMember(row: ConversationMemberDetailRow): ConversationMember {
  return {
    userId: row.user_id,
    name: row.name,
    email: row.email,
    avatarUrl: row.avatar_url,
    role: row.role,
    joinedAt: row.joined_at.toISOString(),
    lastReadAt: row.last_read_at.toISOString(),
    lastDeliveredAt: row.last_delivered_at.toISOString(),
    status: row.status ?? 'offline',
    customStatus: row.custom_status,
    lastSeenAt: row.last_seen_at ? row.last_seen_at.toISOString() : null,
  };
}

function groupReactions(rows: ReactionRow[]): Map<string, MessageReaction[]> {
  const byMessage = new Map<string, Map<ReactionEmoji, string[]>>();
  for (const row of rows) {
    const byEmoji = byMessage.get(row.message_id) ?? new Map<ReactionEmoji, string[]>();
    byEmoji.set(row.emoji, [...(byEmoji.get(row.emoji) ?? []), row.user_id]);
    byMessage.set(row.message_id, byEmoji);
  }
  return new Map(
    [...byMessage].map(([messageId, byEmoji]) => [
      messageId,
      [...byEmoji].map(([emoji, userIds]) => ({ emoji, userIds })),
    ]),
  );
}

function toMessage(row: MessageDetailRow, reactions: MessageReaction[] = []): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    type: row.type,
    senderId: row.sender_id,
    senderName: row.sender_name,
    senderAvatarUrl: row.sender_avatar_url,
    body: row.body,
    replyTo:
      row.reply_to_id && row.reply_sender_id
        ? {
            id: row.reply_to_id,
            senderId: row.reply_sender_id,
            senderName: row.reply_sender_name ?? 'Unknown',
            body: row.reply_deleted_at ? '' : (row.reply_body ?? ''),
            deleted: Boolean(row.reply_deleted_at),
          }
        : null,
    reactions,
    editedAt: row.edited_at ? row.edited_at.toISOString() : null,
    deletedAt: row.deleted_at ? row.deleted_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

async function hydrateMessages(rows: MessageDetailRow[]): Promise<Message[]> {
  const reactions = groupReactions(await MessageModel.listReactions(rows.map((r) => r.id)));
  return rows.map((row) => toMessage(row, reactions.get(row.id)));
}

async function loadMessage(messageId: string): Promise<Message> {
  const row = await MessageModel.findDetailById(messageId);
  if (!row) throw notFound('Message not found');
  const [message] = await hydrateMessages([row]);
  return message!;
}

function canPost(conversation: ConversationRow, role: ConversationRole): boolean {
  if (conversation.type === 'broadcast') return role === 'admin';
  if (conversation.type === 'group' && conversation.only_admins_can_post) return role === 'admin';
  return true;
}

// ── Conversations ──────────────────────────────────────────────────

async function buildConversations(userId: string, ids: string[]): Promise<Conversation[]> {
  if (ids.length === 0) return [];

  const [conversations, members, lastMessages, unreadCounts] = await Promise.all([
    ConversationModel.findByIds(ids),
    ConversationModel.getMembers(ids),
    ConversationModel.getLastMessages(ids),
    ConversationModel.getUnreadCounts(userId, ids),
  ]);

  const membersByConversation = new Map<string, ConversationMemberDetailRow[]>();
  for (const member of members) {
    const list = membersByConversation.get(member.conversation_id) ?? [];
    list.push(member);
    membersByConversation.set(member.conversation_id, list);
  }
  const lastByConversation = new Map(lastMessages.map((m) => [m.conversation_id, m]));

  return conversations.flatMap((conversation) => {
    const rows = membersByConversation.get(conversation.id) ?? [];
    const self = rows.find((m) => m.user_id === userId);
    if (!self) return [];
    const last = lastByConversation.get(conversation.id);
    const other = rows.find((m) => m.user_id !== userId);

    return [
      {
        id: conversation.id,
        type: conversation.type,
        name:
          conversation.type === 'direct'
            ? (other?.name ?? 'Just you')
            : (conversation.name ?? 'Untitled'),
        description: conversation.description,
        onlyAdminsCanPost: conversation.only_admins_can_post,
        isOrgWide: conversation.is_org_wide,
        createdBy: conversation.created_by,
        members: rows.map(toMember),
        myRole: self.role,
        canPost: canPost(conversation, self.role),
        lastMessage: last
          ? {
              id: last.id,
              body: last.deleted_at ? '' : last.body,
              type: last.type,
              senderId: last.sender_id,
              senderName: last.sender_name,
              deleted: Boolean(last.deleted_at),
              createdAt: new Date(last.created_at).toISOString(),
            }
          : null,
        unreadCount: unreadCounts.get(conversation.id) ?? 0,
        updatedAt: (last && last.created_at > conversation.updated_at
          ? last.created_at
          : conversation.updated_at
        ).toISOString(),
        createdAt: conversation.created_at.toISOString(),
      } satisfies Conversation,
    ];
  });
}

export async function listConversations(userId: string): Promise<Conversation[]> {
  const conversations = await buildConversations(
    userId,
    await ConversationModel.listIdsForUser(userId),
  );
  return conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getConversation(
  conversationId: string,
  userId: string,
): Promise<Conversation> {
  const [conversation] = await buildConversations(userId, [conversationId]);
  if (!conversation) throw notFound('Conversation not found');
  return conversation;
}

/** Loads the conversation + the caller's membership, or a 404 that doesn't reveal whether it exists. */
async function requireMembership(
  conversationId: string,
  userId: string,
): Promise<{ conversation: ConversationRow; member: ConversationMemberRow }> {
  const [conversation, member] = await Promise.all([
    ConversationModel.findById(conversationId),
    ConversationModel.getMember(conversationId, userId),
  ]);
  if (!conversation || !member) throw notFound('Conversation not found');
  return { conversation, member };
}

async function requireAdmin(conversationId: string, userId: string) {
  const context = await requireMembership(conversationId, userId);
  if (context.conversation.type === 'direct') {
    throw badRequest('Direct conversations have no admin settings');
  }
  if (context.member.role !== 'admin') throw forbidden('Only conversation admins can do that');
  return context;
}

/** Every user id must be an active member of the actor's organization. */
async function resolveOrgUsers(actor: AuthUser, userIds: string[]) {
  const unique = [...new Set(userIds)].filter((id) => id !== actor.id);
  const users = await UserModel.findActiveInOrganization(unique, actor.organization?.id ?? null);
  if (users.length !== unique.length) throw notFound('One or more users were not found');
  return users;
}

/** System messages are posted one statement at a time so each gets its own timestamp (stable order). */
async function postSystemMessage(
  conversationId: string,
  actorId: string,
  body: string,
): Promise<void> {
  const row = await MessageModel.create({
    conversationId,
    senderId: actorId,
    body,
    type: 'system',
  });
  await ConversationModel.touchUpdatedAt(conversationId);
  realtime.emitMessageNew(await loadMessage(row.id));
}

function nameList(names: string[]): string {
  if (names.length <= 3) return names.join(', ');
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} others`;
}

export async function createDirectConversation(
  actor: AuthUser,
  otherUserId: string,
): Promise<Conversation> {
  if (actor.id === otherUserId) throw badRequest('Cannot start a conversation with yourself');
  await resolveOrgUsers(actor, [otherUserId]);

  const existingId = await ConversationModel.findDirectBetween(actor.id, otherUserId);
  if (existingId) return getConversation(existingId, actor.id);

  const conversation = await db.transaction(async (trx) => {
    const row = await ConversationModel.create(
      {
        type: 'direct',
        name: null,
        organizationId: actor.organization?.id ?? null,
        createdBy: actor.id,
      },
      trx,
    );
    await ConversationModel.addMembers(
      row.id,
      [
        { userId: actor.id, role: 'member' },
        { userId: otherUserId, role: 'member' },
      ],
      trx,
    );
    return row;
  });

  realtime.joinUsersToConversation([actor.id, otherUserId], conversation.id);
  return getConversation(conversation.id, actor.id);
}

export async function createGroup(actor: AuthUser, input: CreateGroupInput): Promise<Conversation> {
  const users = await resolveOrgUsers(actor, input.memberIds);
  if (users.length === 0) throw badRequest('Add at least one other person to the group');

  const conversation = await db.transaction(async (trx) => {
    const row = await ConversationModel.create(
      {
        type: 'group',
        name: input.name,
        description: input.description ?? null,
        onlyAdminsCanPost: input.onlyAdminsCanPost ?? false,
        organizationId: actor.organization?.id ?? null,
        createdBy: actor.id,
      },
      trx,
    );
    await ConversationModel.addMembers(
      row.id,
      [
        { userId: actor.id, role: 'admin' },
        ...users.map((u) => ({ userId: u.id, role: 'member' as const })),
      ],
      trx,
    );
    return row;
  });

  await postSystemMessage(
    conversation.id,
    actor.id,
    `${actor.name} created the group “${input.name}”`,
  );
  realtime.joinUsersToConversation([actor.id, ...users.map((u) => u.id)], conversation.id);
  return getConversation(conversation.id, actor.id);
}

export async function createBroadcast(
  actor: AuthUser,
  input: CreateBroadcastInput,
): Promise<Conversation> {
  const organizationId = actor.organization?.id ?? null;
  const users = input.allMembers
    ? (await UserModel.listActive(organizationId)).filter((u) => u.id !== actor.id)
    : await resolveOrgUsers(actor, input.memberIds ?? []);
  if (users.length === 0) throw badRequest('Choose at least one recipient');

  const conversation = await db.transaction(async (trx) => {
    const row = await ConversationModel.create(
      {
        type: 'broadcast',
        name: input.name,
        description: input.description ?? null,
        isOrgWide: Boolean(input.allMembers && organizationId),
        organizationId,
        createdBy: actor.id,
      },
      trx,
    );
    await ConversationModel.addMembers(
      row.id,
      [
        { userId: actor.id, role: 'admin' },
        ...users.map((u) => ({ userId: u.id, role: 'member' as const })),
      ],
      trx,
    );
    return row;
  });

  await postSystemMessage(
    conversation.id,
    actor.id,
    `${actor.name} created the broadcast “${input.name}”`,
  );
  realtime.joinUsersToConversation([actor.id, ...users.map((u) => u.id)], conversation.id);
  return getConversation(conversation.id, actor.id);
}

/** New organization members join org-wide announcement channels automatically. */
export async function addUserToOrgWideBroadcasts(
  userId: string,
  organizationId: string,
): Promise<void> {
  const ids = await ConversationModel.listOrgWideBroadcastIds(organizationId);
  for (const id of ids) {
    const added = await ConversationModel.addMembers(id, [{ userId, role: 'member' }]);
    if (added.length > 0) {
      realtime.joinUsersToConversation([userId], id);
      realtime.emitConversationUpdated(id);
    }
  }
}

export async function updateConversation(
  actor: AuthUser,
  conversationId: string,
  input: UpdateConversationInput,
): Promise<Conversation> {
  const { conversation } = await requireAdmin(conversationId, actor.id);
  const kind = conversation.type === 'broadcast' ? 'broadcast' : 'group';

  const changes: Parameters<typeof ConversationModel.update>[1] = {};
  if (input.name !== undefined && input.name !== conversation.name) changes.name = input.name;
  if (input.description !== undefined) changes.description = input.description || null;
  if (
    input.onlyAdminsCanPost !== undefined &&
    conversation.type === 'group' &&
    input.onlyAdminsCanPost !== conversation.only_admins_can_post
  ) {
    changes.only_admins_can_post = input.onlyAdminsCanPost;
  }

  if (Object.keys(changes).length > 0) {
    await ConversationModel.update(conversationId, changes);
    if (changes.name) {
      await postSystemMessage(
        conversationId,
        actor.id,
        `${actor.name} renamed the ${kind} to “${changes.name}”`,
      );
    }
    if (changes.only_admins_can_post !== undefined) {
      await postSystemMessage(
        conversationId,
        actor.id,
        changes.only_admins_can_post
          ? `${actor.name} allowed only admins to send messages`
          : `${actor.name} allowed everyone to send messages`,
      );
    }
    realtime.emitConversationUpdated(conversationId);
  }

  return getConversation(conversationId, actor.id);
}

export async function addMembers(
  actor: AuthUser,
  conversationId: string,
  userIds: string[],
): Promise<Conversation> {
  await requireAdmin(conversationId, actor.id);
  const users = await resolveOrgUsers(actor, userIds);
  const addedIds = await ConversationModel.addMembers(
    conversationId,
    users.map((u) => ({ userId: u.id, role: 'member' })),
  );

  if (addedIds.length > 0) {
    const names = users.filter((u) => addedIds.includes(u.id)).map((u) => u.name);
    await postSystemMessage(conversationId, actor.id, `${actor.name} added ${nameList(names)}`);
    realtime.joinUsersToConversation(addedIds, conversationId);
    realtime.emitConversationUpdated(conversationId);
  }

  return getConversation(conversationId, actor.id);
}

/** Removes a member (admins only) or leaves (anyone, for themselves). */
export async function removeMember(
  actor: AuthUser,
  conversationId: string,
  targetUserId: string,
): Promise<void> {
  const isSelf = targetUserId === actor.id;
  const { conversation } = isSelf
    ? await requireMembership(conversationId, actor.id)
    : await requireAdmin(conversationId, actor.id);

  if (conversation.type === 'direct') throw badRequest('You can’t leave a direct conversation');
  if (isSelf && conversation.is_org_wide) {
    throw badRequest('Organization-wide announcements can’t be left');
  }

  const target = await ConversationModel.getMember(conversationId, targetUserId);
  const targetUser = await UserModel.findById(targetUserId);
  if (!target || !targetUser) throw notFound('That person isn’t in this conversation');

  await ConversationModel.removeMember(conversationId, targetUserId);
  realtime.removeUserFromConversation(targetUserId, conversationId);

  const remaining = await ConversationModel.findOldestMember(conversationId);
  if (!remaining) {
    await ConversationModel.delete(conversationId);
    return;
  }

  await postSystemMessage(
    conversationId,
    actor.id,
    isSelf ? `${actor.name} left` : `${actor.name} removed ${targetUser.name}`,
  );

  // Never leave a group without an admin: hand it to whoever has been there longest.
  if (target.role === 'admin' && (await ConversationModel.countAdmins(conversationId)) === 0) {
    await ConversationModel.setRole(conversationId, remaining.user_id, 'admin');
    const successor = await UserModel.findById(remaining.user_id);
    await postSystemMessage(
      conversationId,
      remaining.user_id,
      `${successor?.name ?? 'A member'} is now an admin`,
    );
  }

  realtime.emitConversationUpdated(conversationId);
}

export async function setMemberRole(
  actor: AuthUser,
  conversationId: string,
  targetUserId: string,
  role: ConversationRole,
): Promise<Conversation> {
  await requireAdmin(conversationId, actor.id);
  const target = await ConversationModel.getMember(conversationId, targetUserId);
  const targetUser = await UserModel.findById(targetUserId);
  if (!target || !targetUser) throw notFound('That person isn’t in this conversation');
  if (target.role === role) return getConversation(conversationId, actor.id);

  if (role === 'member' && (await ConversationModel.countAdmins(conversationId)) <= 1) {
    throw badRequest('A conversation needs at least one admin — promote someone else first');
  }

  await ConversationModel.setRole(conversationId, targetUserId, role);
  const subject = targetUserId === actor.id ? 'themselves' : targetUser.name;
  await postSystemMessage(
    conversationId,
    actor.id,
    role === 'admin'
      ? `${actor.name} made ${targetUser.name} an admin`
      : `${actor.name} removed ${subject} as admin`,
  );
  realtime.emitConversationUpdated(conversationId);
  return getConversation(conversationId, actor.id);
}

// ── Messages ───────────────────────────────────────────────────────

export async function getMessages(
  conversationId: string,
  userId: string,
  limit: number,
  before?: string,
): Promise<MessagePage> {
  await requireMembership(conversationId, userId);
  const { rows, hasMore } = await MessageModel.listByConversation(conversationId, limit, before);
  const items = await hydrateMessages(rows);
  return { items: items.reverse(), hasMore };
}

export async function sendMessage(
  actor: AuthUser,
  conversationId: string,
  input: SendMessageInput,
): Promise<Message> {
  const { conversation, member } = await requireMembership(conversationId, actor.id);
  if (!canPost(conversation, member.role)) {
    throw forbidden(
      conversation.type === 'broadcast'
        ? 'Only admins can post in a broadcast'
        : 'Only admins can send messages in this group',
    );
  }

  if (input.replyToId) {
    const parent = await MessageModel.findById(input.replyToId);
    if (!parent || parent.conversation_id !== conversationId)
      throw badRequest('Can’t reply to that message');
  }

  const row = await MessageModel.create({
    conversationId,
    senderId: actor.id,
    body: input.body,
    replyToId: input.replyToId ?? null,
  });
  await ConversationModel.touchUpdatedAt(conversationId);

  // Sending means you've read everything up to now.
  const receipt = await ConversationModel.markRead(conversationId, actor.id);
  const message = await loadMessage(row.id);
  Sentry.metrics.count('chat.message.sent', 1, {
    attributes: { conversation_type: conversation.type },
  });
  realtime.emitMessageNew(message);
  if (receipt) realtime.emitReceipt(receipt);
  return message;
}

async function requireOwnMessage(conversationId: string, messageId: string, userId: string) {
  const context = await requireMembership(conversationId, userId);
  const message = await MessageModel.findById(messageId);
  if (!message || message.conversation_id !== conversationId || message.deleted_at) {
    throw notFound('Message not found');
  }
  return { ...context, message };
}

export async function editMessage(
  actor: AuthUser,
  conversationId: string,
  messageId: string,
  body: string,
): Promise<Message> {
  const { message } = await requireOwnMessage(conversationId, messageId, actor.id);
  if (message.sender_id !== actor.id || message.type !== 'text') {
    throw forbidden('You can only edit your own messages');
  }
  if (message.body !== body) await MessageModel.updateBody(messageId, body);
  const updated = await loadMessage(messageId);
  realtime.emitMessageUpdated(updated);
  return updated;
}

export async function deleteMessage(
  actor: AuthUser,
  conversationId: string,
  messageId: string,
): Promise<Message> {
  const { message, member, conversation } = await requireOwnMessage(
    conversationId,
    messageId,
    actor.id,
  );
  const isOwn = message.sender_id === actor.id;
  const isModerator = conversation.type !== 'direct' && member.role === 'admin';
  if (message.type !== 'text' || (!isOwn && !isModerator)) {
    throw forbidden('You can’t delete this message');
  }
  await MessageModel.softDelete(messageId);
  const updated = await loadMessage(messageId);
  realtime.emitMessageUpdated(updated);
  return updated;
}

export async function toggleReaction(
  actor: AuthUser,
  conversationId: string,
  messageId: string,
  emoji: ReactionEmoji,
): Promise<Message> {
  const { message } = await requireOwnMessage(conversationId, messageId, actor.id);
  if (message.type !== 'text') throw badRequest('You can’t react to this message');
  await MessageModel.toggleReaction(messageId, actor.id, emoji);
  const updated = await loadMessage(messageId);
  realtime.emitMessageUpdated(updated);
  return updated;
}

// ── Receipts ───────────────────────────────────────────────────────

export async function markRead(conversationId: string, userId: string): Promise<void> {
  await requireMembership(conversationId, userId);
  const row = await ConversationModel.markRead(conversationId, userId);
  if (row) realtime.emitReceipt(row);
}

/** Called from the socket layer; silently ignores conversations the user isn't in. */
export async function markDelivered(conversationId: string, userId: string): Promise<void> {
  const row = await ConversationModel.markDelivered(conversationId, userId);
  if (row) realtime.emitReceipt(row);
}

/** On connect, everything sent while the user was offline has now reached a device. */
export async function markAllDelivered(userId: string): Promise<void> {
  const rows = await ConversationModel.markAllDeliveredForUser(userId);
  for (const row of rows) realtime.emitReceipt(row);
}
