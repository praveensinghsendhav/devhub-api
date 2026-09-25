import { Router } from 'express';
import * as chatController from './chat.controller.js';
import {
  addMembersSchema,
  createBroadcastSchema,
  createDirectConversationSchema,
  createGroupSchema,
  editMessageSchema,
  reactionSchema,
  sendMessageSchema,
  setRoleSchema,
  updateConversationSchema,
} from './chat.validators.js';
import { validate } from '../../common/middlewares/validate.js';
import { authenticate } from '../../common/middlewares/authenticate.js';
import { authorize } from '../../common/middlewares/authorize.js';

export const chatRouter = Router();

const C = '/conversations/:conversationId';

chatRouter.use(authenticate);

// Conversations
chatRouter.get('/conversations', authorize('chat:read'), chatController.listConversations);
chatRouter.post(
  '/conversations/direct',
  authorize('chat:create'),
  validate(createDirectConversationSchema),
  chatController.createDirectConversation,
);
chatRouter.post(
  '/conversations/group',
  authorize('chat:create'),
  validate(createGroupSchema),
  chatController.createGroup,
);
// Broadcasts are announcement channels, so creating one is an org-level (chat:manage) power.
chatRouter.post(
  '/conversations/broadcast',
  authorize('chat:manage'),
  validate(createBroadcastSchema),
  chatController.createBroadcast,
);
chatRouter.get(C, authorize('chat:read'), chatController.getConversation);
chatRouter.patch(
  C,
  authorize('chat:read'),
  validate(updateConversationSchema),
  chatController.updateConversation,
);

// Members — per-conversation admin checks happen in the service.
chatRouter.post(
  `${C}/members`,
  authorize('chat:read'),
  validate(addMembersSchema),
  chatController.addMembers,
);
chatRouter.patch(
  `${C}/members/:userId`,
  authorize('chat:read'),
  validate(setRoleSchema),
  chatController.setMemberRole,
);
chatRouter.delete(`${C}/members/:userId`, authorize('chat:read'), chatController.removeMember);

// Messages
chatRouter.get(`${C}/messages`, authorize('chat:read'), chatController.getMessages);
chatRouter.post(
  `${C}/messages`,
  authorize('chat:create'),
  validate(sendMessageSchema),
  chatController.sendMessage,
);
chatRouter.patch(
  `${C}/messages/:messageId`,
  authorize('chat:create'),
  validate(editMessageSchema),
  chatController.editMessage,
);
chatRouter.delete(`${C}/messages/:messageId`, authorize('chat:read'), chatController.deleteMessage);
chatRouter.post(
  `${C}/messages/:messageId/reactions`,
  authorize('chat:read'),
  validate(reactionSchema),
  chatController.toggleReaction,
);
chatRouter.post(`${C}/read`, authorize('chat:read'), chatController.markRead);
