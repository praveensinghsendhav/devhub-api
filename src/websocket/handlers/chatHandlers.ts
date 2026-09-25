import type { Socket } from 'socket.io';
import { SOCKET_EVENTS, type TypingUpdatePayload } from '../../shared/index.js';
import { ConversationModel } from '../../models/conversation.model.js';
import * as chatService from '../../modules/chat/chat.service.js';
import { deliveredSocketSchema, typingSocketSchema } from '../../modules/chat/chat.validators.js';
import { conversationRoom } from '../rooms.js';
import { traceSocketEvent } from '../tracing.js';
import type { SocketData } from '../socketAuth.js';

/**
 * Joins the socket to every conversation it belongs to and wires typing + delivery receipts.
 * Room membership doubles as the authorization check for typing: you can only signal typing
 * into a room this socket was joined to, and it's only joined to conversations you're in.
 */
export async function registerChatHandlers(socket: Socket): Promise<void> {
  const { userId, name } = socket.data as SocketData;

  socket.on(SOCKET_EVENTS.TYPING, (raw: unknown) => {
    const parsed = typingSocketSchema.safeParse(raw);
    if (!parsed.success) return;
    const room = conversationRoom(parsed.data.conversationId);
    if (!socket.rooms.has(room)) return;
    const payload: TypingUpdatePayload = { ...parsed.data, userId, name };
    socket.to(room).emit(SOCKET_EVENTS.TYPING_UPDATE, payload);
  });

  socket.on(SOCKET_EVENTS.MESSAGE_DELIVERED, (raw: unknown) => {
    const parsed = deliveredSocketSchema.safeParse(raw);
    if (!parsed.success || !socket.rooms.has(conversationRoom(parsed.data.conversationId))) return;
    const { conversationId } = parsed.data;
    traceSocketEvent(socket, SOCKET_EVENTS.MESSAGE_DELIVERED, 'Failed to mark delivered', () =>
      chatService.markDelivered(conversationId, userId),
    );
  });

  // Stop "typing…" for everyone the moment this device drops.
  socket.on('disconnecting', () => {
    for (const room of socket.rooms) {
      if (!room.startsWith('conversation:')) continue;
      const payload: TypingUpdatePayload = {
        conversationId: room.slice('conversation:'.length),
        userId,
        name,
        isTyping: false,
      };
      socket.to(room).emit(SOCKET_EVENTS.TYPING_UPDATE, payload);
    }
  });

  const conversationIds = await ConversationModel.listIdsForUser(userId);
  await socket.join(conversationIds.map(conversationRoom));
  await chatService.markAllDelivered(userId);
}
