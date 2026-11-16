import type { ProviderType, UserStatus } from './schemas/user.schema.js';
import type { Role } from './auth/auth.types.js';

/**
 * What other modules may know about any account: enough for author names,
 * "Deleted user" (ACC-12) and the author page's join date (BLG-12).
 * Never the email, password hash or login counters.
 */
export interface AccountProfile {
  id: string;
  name: string;
  status: UserStatus;
  /** Registration date. */
  createdAt: Date;
}

/** One row of the admin account list (ACC-14). */
export interface AccountListItem {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  /** Moderators only (ACC-13). */
  moderatorOf?: { providerType: ProviderType; providerId: string };
  /** Registration date. */
  createdAt: Date;
}

/** The admin account list query (ACC-14). Newest `createdAt` first. */
export interface AccountListQuery {
  page: number;
  limit: number;
  /** Case-insensitive match on name or email. */
  q?: string;
  role?: Role;
  status?: UserStatus;
}

/** The two moderator roles. */
export type ModeratorRole = Extract<
  Role,
  'airline_moderator' | 'hotel_moderator'
>;

/**
 * A new moderator (ACC-13). Admin checks the provider exists and matches the
 * role before calling (accounts can't read airlines or hotels).
 */
export interface CreateModeratorInput {
  name: string;
  email: string;
  role: ModeratorRole;
  providerId: string;
  /** Hashed by accounts; the account must change it on first login. */
  temporaryPassword: string;
}
