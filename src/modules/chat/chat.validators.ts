import { z } from 'zod';
import { CONVERSATION_ROLES, MESSAGE_MAX_LENGTH, REACTION_EMOJIS } from '../../shared/index.js';

const uuid = (label: string) => z.string().uuid(`Invalid ${label}`);
const conversationName = z.string().trim().min(1, 'Give it a name').max(80, 'Name is too long');
const description = z.string().trim().max(500, 'Description is too long');

export const sendMessageSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Message cannot be empty')
    .max(MESSAGE_MAX_LENGTH, 'Message is too long'),
  replyToId: uuid('message').optional(),
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const editMessageSchema = sendMessageSchema.pick({ body: true });

export const reactionSchema = z.object({ emoji: z.enum(REACTION_EMOJIS) });

export const createDirectConversationSchema = z.object({ userId: uuid('user id') });

export const createGroupSchema = z.object({
  name: conversationName,
  description: description.optional(),
  memberIds: z.array(uuid('user id')).min(1, 'Add at least one member').max(500),
  onlyAdminsCanPost: z.boolean().optional(),
});
export type CreateGroupInput = z.infer<typeof createGroupSchema>;

export const createBroadcastSchema = z
  .object({
    name: conversationName,
    description: description.optional(),
    memberIds: z.array(uuid('user id')).max(5000).optional(),
    allMembers: z.boolean().optional(),
  })
  .refine((v) => v.allMembers || (v.memberIds?.length ?? 0) > 0, {
    message: 'Choose recipients or send to everyone',
    path: ['memberIds'],
  });
export type CreateBroadcastInput = z.infer<typeof createBroadcastSchema>;

export const updateConversationSchema = z.object({
  name: conversationName.optional(),
  description: description.nullable().optional(),
  onlyAdminsCanPost: z.boolean().optional(),
});
export type UpdateConversationInput = z.infer<typeof updateConversationSchema>;

export const addMembersSchema = z.object({
  userIds: z.array(uuid('user id')).min(1, 'Choose at least one person').max(500),
});

export const setRoleSchema = z.object({ role: z.enum(CONVERSATION_ROLES) });

export const listMessagesQuerySchema = z.object({
  before: uuid('cursor').optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});

export const idParam = (label: string) => uuid(label);

/** Socket payloads are untrusted too. */
export const typingSocketSchema = z.object({
  conversationId: uuid('conversation id'),
  isTyping: z.boolean(),
});
export const deliveredSocketSchema = z.object({ conversationId: uuid('conversation id') });
