import { createParamDecorator, SetMetadata } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest, AuthUser, Role } from './auth.types.js';

export const IS_PUBLIC = 'isPublic';
export const ROLES = 'roles';

/**
 * Opens a route (or a whole controller) to guests. Every other route needs a
 * logged-in account: the guards are global, so a forgotten decorator can't
 * expose an endpoint (auth.md §5).
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Limits a route to these roles; others get 403 FORBIDDEN_ROLE. No `@Roles` = any logged-in account. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

/** Reads the user from the request, for `@CurrentUser()` (exported for unit tests). */
export function currentUserFrom(ctx: ExecutionContext): AuthUser | undefined {
  return ctx.switchToHttp().getRequest<AuthenticatedRequest>().user;
}

/**
 * The logged-in account (`{ id, role, providerId?, sid }`). Always set on
 * protected routes; on `@Public()` routes it is `undefined` for guests.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => currentUserFrom(ctx),
);
