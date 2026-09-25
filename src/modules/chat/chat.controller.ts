import type { Request, Response } from 'express';
import * as chatService from './chat.service.js';
import { idParam, listMessagesQuerySchema } from './chat.validators.js';
import { sendSuccess } from '../../common/utils/apiResponse.js';
import { HTTP_STATUS } from '../../common/constants/httpStatus.js';
import { getParam } from '../../common/utils/requestParams.js';

const conversationIdOf = (req: Request) =>
  idParam('conversation id').parse(getParam(req, 'conversationId'));
const messageIdOf = (req: Request) => idParam('message id').parse(getParam(req, 'messageId'));
const userIdOf = (req: Request) => idParam('user id').parse(getParam(req, 'userId'));

export async function listConversations(req: Request, res: Response): Promise<void> {
  sendSuccess(res, HTTP_STATUS.OK, await chatService.listConversations(req.user!.id));
}

export async function getConversation(req: Request, res: Response): Promise<void> {
  sendSuccess(
    res,
    HTTP_STATUS.OK,
    await chatService.getConversation(conversationIdOf(req), req.user!.id),
  );
}

export async function createDirectConversation(req: Request, res: Response): Promise<void> {
  const conversation = await chatService.createDirectConversation(req.user!, req.body.userId);
  sendSuccess(res, HTTP_STATUS.CREATED, conversation);
}

export async function createGroup(req: Request, res: Response): Promise<void> {
  sendSuccess(res, HTTP_STATUS.CREATED, await chatService.createGroup(req.user!, req.body));
}

export async function createBroadcast(req: Request, res: Response): Promise<void> {
  sendSuccess(res, HTTP_STATUS.CREATED, await chatService.createBroadcast(req.user!, req.body));
}

export async function updateConversation(req: Request, res: Response): Promise<void> {
  const conversation = await chatService.updateConversation(
    req.user!,
    conversationIdOf(req),
    req.body,
  );
  sendSuccess(res, HTTP_STATUS.OK, conversation);
}

export async function addMembers(req: Request, res: Response): Promise<void> {
  const conversation = await chatService.addMembers(
    req.user!,
    conversationIdOf(req),
    req.body.userIds,
  );
  sendSuccess(res, HTTP_STATUS.OK, conversation);
}

export async function removeMember(req: Request, res: Response): Promise<void> {
  await chatService.removeMember(req.user!, conversationIdOf(req), userIdOf(req));
  sendSuccess(res, HTTP_STATUS.OK, null);
}

export async function setMemberRole(req: Request, res: Response): Promise<void> {
  const conversation = await chatService.setMemberRole(
    req.user!,
    conversationIdOf(req),
    userIdOf(req),
    req.body.role,
  );
  sendSuccess(res, HTTP_STATUS.OK, conversation);
}

export async function getMessages(req: Request, res: Response): Promise<void> {
  const { before, limit } = listMessagesQuerySchema.parse(req.query);
  const page = await chatService.getMessages(conversationIdOf(req), req.user!.id, limit, before);
  sendSuccess(res, HTTP_STATUS.OK, page);
}

export async function sendMessage(req: Request, res: Response): Promise<void> {
  const message = await chatService.sendMessage(req.user!, conversationIdOf(req), req.body);
  sendSuccess(res, HTTP_STATUS.CREATED, message);
}

export async function editMessage(req: Request, res: Response): Promise<void> {
  const message = await chatService.editMessage(
    req.user!,
    conversationIdOf(req),
    messageIdOf(req),
    req.body.body,
  );
  sendSuccess(res, HTTP_STATUS.OK, message);
}

export async function deleteMessage(req: Request, res: Response): Promise<void> {
  const message = await chatService.deleteMessage(
    req.user!,
    conversationIdOf(req),
    messageIdOf(req),
  );
  sendSuccess(res, HTTP_STATUS.OK, message);
}

export async function toggleReaction(req: Request, res: Response): Promise<void> {
  const message = await chatService.toggleReaction(
    req.user!,
    conversationIdOf(req),
    messageIdOf(req),
    req.body.emoji,
  );
  sendSuccess(res, HTTP_STATUS.OK, message);
}

export async function markRead(req: Request, res: Response): Promise<void> {
  await chatService.markRead(conversationIdOf(req), req.user!.id);
  sendSuccess(res, HTTP_STATUS.OK, null);
}
