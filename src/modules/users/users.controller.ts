import type { Request, Response } from 'express';
import { UserModel } from '../../models/user.model.js';
import { sendSuccess } from '../../common/utils/apiResponse.js';
import { HTTP_STATUS } from '../../common/constants/httpStatus.js';

export async function listUsers(req: Request, res: Response): Promise<void> {
  const users = await UserModel.listActive(req.user!.organization?.id ?? null);
  sendSuccess(
    res,
    HTTP_STATUS.OK,
    users.map((u) => ({ id: u.id, name: u.name, email: u.email, avatarUrl: u.avatar_url })),
  );
}
