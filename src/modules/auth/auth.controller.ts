import type { Request, Response } from 'express';
import type { CookieOptions } from 'express';
import type { AuthTokens, LoginResponse } from '../../shared/index.js';
import { isProduction } from '../../config/env.js';
import * as authService from './auth.service.js';
import type { LoginInput } from './auth.validators.js';
import * as organizationsService from '../organizations/organizations.service.js';
import type {
  AcceptInviteInput,
  RegisterOrganizationInput,
} from '../organizations/organizations.validators.js';
import { sendSuccess } from '../../common/utils/apiResponse.js';
import { HTTP_STATUS, type HttpStatus } from '../../common/constants/httpStatus.js';
import { RESPONSE_MESSAGES } from '../../common/constants/responseMessages.js';

export const REFRESH_COOKIE_NAME = 'devhub_rt';

function refreshCookieOptions(maxAgeMs: number): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    // Hosted, the web app and API are on different sites (vercel.app vs the API's host), so the
    // browser only sends the cookie with SameSite=None (which requires Secure).
    sameSite: isProduction ? 'none' : 'lax',
    path: '/api/auth',
    maxAge: maxAgeMs,
  };
}

function toTokens(accessToken: string): AuthTokens {
  return {
    accessToken,
    accessTokenExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  };
}

export async function login(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body as LoginInput;
  const result = await authService.login(email, password, {
    deviceId: req.deviceId!,
    deviceName: req.body.deviceName ?? null,
    userAgent: req.headers['user-agent'] ?? null,
  });
  sendSession(res, HTTP_STATUS.OK, result, RESPONSE_MESSAGES.LOGIN_SUCCESS);
}

function sendSession(
  res: Response,
  status: HttpStatus,
  result: Awaited<ReturnType<typeof authService.login>>,
  message: string,
): void {
  res.cookie(
    REFRESH_COOKIE_NAME,
    result.refreshToken,
    refreshCookieOptions(result.refreshTokenExpiresAt.getTime() - Date.now()),
  );
  const body: LoginResponse = { user: result.user, tokens: toTokens(result.accessToken) };
  sendSuccess(res, status, body, { message });
}

export async function register(req: Request, res: Response): Promise<void> {
  const input = req.body as RegisterOrganizationInput;
  const result = await authService.registerOrganization(input, {
    deviceId: req.deviceId!,
    deviceName: input.deviceName ?? null,
    userAgent: req.headers['user-agent'] ?? null,
  });
  sendSession(res, HTTP_STATUS.CREATED, result, RESPONSE_MESSAGES.REGISTER_SUCCESS);
}

export async function previewInvite(req: Request, res: Response): Promise<void> {
  const preview = await organizationsService.previewInvite((req.body as { token: string }).token);
  sendSuccess(res, HTTP_STATUS.OK, preview);
}

export async function acceptInvite(req: Request, res: Response): Promise<void> {
  const input = req.body as AcceptInviteInput;
  const result = await authService.acceptInvite(input, {
    deviceId: req.deviceId!,
    deviceName: input.deviceName ?? null,
    userAgent: req.headers['user-agent'] ?? null,
  });
  sendSession(res, HTTP_STATUS.CREATED, result, RESPONSE_MESSAGES.INVITE_ACCEPTED);
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const rawRefreshToken = req.cookies[REFRESH_COOKIE_NAME] as string | undefined;
  if (!rawRefreshToken) {
    res.status(HTTP_STATUS.UNAUTHORIZED).json({
      success: false,
      error: { code: 'TOKEN_INVALID', message: 'No active session' },
    });
    return;
  }

  const result = await authService.refresh(rawRefreshToken, {
    deviceId: req.deviceId!,
    userAgent: req.headers['user-agent'] ?? null,
  });

  res.cookie(
    REFRESH_COOKIE_NAME,
    result.refreshToken,
    refreshCookieOptions(result.refreshTokenExpiresAt.getTime() - Date.now()),
  );

  const body: LoginResponse = { user: result.user, tokens: toTokens(result.accessToken) };
  sendSuccess(res, HTTP_STATUS.OK, body, { message: RESPONSE_MESSAGES.TOKEN_REFRESHED });
}

export async function logout(req: Request, res: Response): Promise<void> {
  const rawRefreshToken = req.cookies[REFRESH_COOKIE_NAME] as string | undefined;
  await authService.logout(rawRefreshToken);
  res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/auth' });
  sendSuccess(res, HTTP_STATUS.OK, null, { message: RESPONSE_MESSAGES.LOGOUT_SUCCESS });
}

export async function me(req: Request, res: Response): Promise<void> {
  sendSuccess(res, HTTP_STATUS.OK, req.user);
}
