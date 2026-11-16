import type { Request } from 'express';
import { UserRole } from '../schemas/user.schema.js';

/**
 * The four roles (auth.md §1). One enum shared by the schema, DTOs, guards and
 * Swagger: `Role` is `UserRole`, re-exported under the name the guards use.
 */
export const Role = UserRole;
export type Role = UserRole;

/** The logged-in account, as `@CurrentUser()` returns it (auth.md §5). */
export interface AuthUser {
  /** The user's `_id` (the token's `sub`). */
  id: string;
  role: Role;
  /** Moderators only: `moderatorOf.providerId`, the airline or hotel they manage. */
  providerId?: string;
  /** The session's `_id`. */
  sid: string;
}

/** The access token's payload (auth.md §2). Nothing sensitive goes in it. */
export interface AccessTokenPayload {
  sub: string;
  role: Role;
  sid: string;
  providerId?: string;
}

/** An Express request after `JwtAuthGuard` ran. `user` is unset on public routes without a valid cookie. */
export type AuthenticatedRequest = Request & { user?: AuthUser };
