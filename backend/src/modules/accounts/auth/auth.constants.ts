/** Cookie names (auth.md §2). Changing them is a shared-contract change. */
export const ACCESS_TOKEN_COOKIE = 'access_token';
export const REFRESH_TOKEN_COOKIE = 'refresh_token';

/** Access tokens are HS256 and live 15 minutes (auth.md §2). */
export const ACCESS_TOKEN_ALGORITHM = 'HS256';
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

const MINUTE_MS = 60_000;

/** A session dies after 30 minutes without an authenticated request (ACC-06). */
export const SESSION_IDLE_MS = 30 * MINUTE_MS;

/** The guard slides a session's activity at most once per minute (auth.md §3). */
export const SESSION_SLIDE_INTERVAL_MS = MINUTE_MS;

/**
 * TEMPORARY: routes outside accounts that must stay open but don't carry
 * `@Public()` yet. `GET /api/health` belongs to the platform package; once its
 * controller has `@Public()`, this entry is redundant and can be deleted.
 * Never add a route that returns user data here.
 */
export const TEMPORARY_PUBLIC_ROUTES: readonly {
  method: string;
  path: string;
}[] = [{ method: 'GET', path: '/api/health' }];

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
