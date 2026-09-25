import {
  SOCKET_EVENTS,
  type ConversationEventPayload,
  type Message,
  type ReceiptUpdatePayload,
} from '../../shared/index.js';
import type { Server } from 'socket.io';
import { getIO } from '../../websocket/index.js';
import { conversationRoom, userRoom } from '../../websocket/rooms.js';
import type { ConversationMemberRow } from '../../models/conversation.model.js';
import { logger } from '../../config/logger.js';

/** Realtime fan-out for chat. Services call these after their DB writes succeed. */
function withIO(work: (io: Server) => unknown): void {
  try {
    void work(getIO());
  } catch (err) {
    // Socket server not running (scripts, tests) — the DB write already succeeded, so just log.
    logger.debug({ err }, 'Skipped realtime emit');
  }
}

export function emitMessageNew(message: Message): void {
  withIO((io) =>
    io.to(conversationRoom(message.conversationId)).emit(SOCKET_EVENTS.MESSAGE_NEW, message),
  );
}

export function emitMessageUpdated(message: Message): void {
  withIO((io) =>
    io.to(conversationRoom(message.conversationId)).emit(SOCKET_EVENTS.MESSAGE_UPDATED, message),
  );
}

export function emitConversationUpdated(conversationId: string): void {
  const payload: ConversationEventPayload = { conversationId };
  withIO((io) =>
    io.to(conversationRoom(conversationId)).emit(SOCKET_EVENTS.CONVERSATION_UPDATED, payload),
  );
}

/** Subscribes every live socket of these users to the conversation, then tells them to refresh. */
export function joinUsersToConversation(userIds: string[], conversationId: string): void {
  withIO((io) => {
    for (const userId of userIds)
      io.in(userRoom(userId)).socketsJoin(conversationRoom(conversationId));
    const payload: ConversationEventPayload = { conversationId };
    for (const userId of userIds)
      io.to(userRoom(userId)).emit(SOCKET_EVENTS.CONVERSATION_UPDATED, payload);
  });
}

export function removeUserFromConversation(userId: string, conversationId: string): void {
  withIO((io) => {
    io.in(userRoom(userId)).socketsLeave(conversationRoom(conversationId));
    const payload: ConversationEventPayload = { conversationId };
    io.to(userRoom(userId)).emit(SOCKET_EVENTS.CONVERSATION_REMOVED, payload);
  });
}

export function emitReceipt(row: ConversationMemberRow): void {
  const payload: ReceiptUpdatePayload = {
    conversationId: row.conversation_id,
    userId: row.user_id,
    lastReadAt: row.last_read_at.toISOString(),
    lastDeliveredAt: row.last_delivered_at.toISOString(),
  };
  withIO((io) =>
    io.to(conversationRoom(row.conversation_id)).emit(SOCKET_EVENTS.RECEIPT_UPDATE, payload),
  );
}
