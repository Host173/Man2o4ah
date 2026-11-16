/** Cookie names (auth.md §2). Changing them is a shared-contract change. */
export const ACCESS_TOKEN_COOKIE = 'access_token';
export const REFRESH_TOKEN_COOKIE = 'refresh_token';

/** Access tokens are HS256 and live 15 minutes (auth.md §2). */
export const ACCESS_TOKEN_ALGORITHM = 'HS256';
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** The access cookie lives exactly as long as its token (auth.md §2). */
export const ACCESS_TOKEN_COOKIE_MAX_AGE_MS = ACCESS_TOKEN_TTL_SECONDS * 1000;

/**
 * The refresh cookie's absolute lifetime (auth.md §2). The session behind it
 * still dies after 30 idle minutes.
 */
export const REFRESH_TOKEN_COOKIE_MAX_AGE_MS = 7 * DAY_MS;

/** Random bytes in a refresh token (base64url in the cookie, auth.md §2). */
export const REFRESH_TOKEN_BYTES = 48;

/** A session dies after 30 minutes without an authenticated request (ACC-06). */
export const SESSION_IDLE_MS = 30 * MINUTE_MS;

/** The guard slides a session's activity at most once per minute (auth.md §3). */
export const SESSION_SLIDE_INTERVAL_MS = MINUTE_MS;

/**
 * The only routes an account with `mustChangePassword` may call
 * (ACC-07a, ACC-13; auth.md §4). Matched on method and full path.
 */
export const PASSWORD_CHANGE_ALLOW_LIST: readonly {
  method: string;
  path: string;
}[] = [
  { method: 'GET', path: '/api/auth/me' },
  { method: 'PATCH', path: '/api/auth/change-password' },
  { method: 'POST', path: '/api/auth/logout' },
];
