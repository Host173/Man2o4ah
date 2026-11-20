import type { CookieOptions, Request, Response } from 'express';
import type { UserRole } from '../schemas/user.schema.js';
import {
  ACCESS_TOKEN_COOKIE,
  ACCESS_TOKEN_COOKIE_MAX_AGE_MS,
  REFRESH_TOKEN_COOKIE,
  getSessionMaxAgeMs,
} from './auth.constants.js';

/**
 * Every auth cookie: unreadable by JavaScript (ACC-19), HTTPS only (browsers
 * accept it on http://localhost too), sent on top-level navigations, and on
 * path `/` so `proxy.ts` sees the refresh cookie on page loads (auth.md §2).
 */
const BASE: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
};

/** Sets the access and refresh cookies after a login. */
export function setAuthCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string },
  role: UserRole,
): void {
  setAccessCookie(res, tokens.accessToken);
  res.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
    ...BASE,
    maxAge: getSessionMaxAgeMs(role),
  });
}

export function readRefreshCookie(req: Request): string | undefined {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const token = cookies?.[REFRESH_TOKEN_COOKIE];
  return typeof token === 'string' ? token : undefined;
}

/** Sets only the access cookie (after a refresh; the refresh token is not rotated). */
export function setAccessCookie(res: Response, accessToken: string): void {
  res.cookie(ACCESS_TOKEN_COOKIE, accessToken, {
    ...BASE,
    maxAge: ACCESS_TOKEN_COOKIE_MAX_AGE_MS,
  });
}

/**
 * Clears both cookies (logout, dead session). The browser only removes a
 * cookie whose path matches, so this uses the same options they were set with.
 */
export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_TOKEN_COOKIE, BASE);
  res.clearCookie(REFRESH_TOKEN_COOKIE, BASE);
}
