import { isEmail } from 'class-validator';
import {
  PASSWORD_RULE_MESSAGE,
  isValidPassword,
} from '../auth/password-rule.js';

/** What the admin seed needs (ACC-18). */
export interface AdminSeedInput {
  /** Trimmed and lowercased. */
  email: string;
  password: string;
}

/**
 * ACC-18: reads SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD and checks them
 * before anything is written. The email is trimmed and lowercased; the
 * password must follow the shared password rule (ACC-01). Errors name the
 * variable but never repeat the password.
 */
export function parseAdminSeedInput(
  env: Record<string, string | undefined>,
): AdminSeedInput {
  const email = env.SEED_ADMIN_EMAIL?.trim().toLowerCase() ?? '';
  if (email === '') {
    throw new Error(
      'SEED_ADMIN_EMAIL is not set. Add it to backend/.env (see .env.example).',
    );
  }
  if (!isEmail(email)) {
    throw new Error('SEED_ADMIN_EMAIL must be a valid email address.');
  }

  const password = env.SEED_ADMIN_PASSWORD ?? '';
  if (password === '') {
    throw new Error(
      'SEED_ADMIN_PASSWORD is not set. Add it to backend/.env (see .env.example).',
    );
  }
  if (!isValidPassword(password)) {
    throw new Error(
      `SEED_ADMIN_PASSWORD is too weak: ${PASSWORD_RULE_MESSAGE}.`,
    );
  }

  return { email, password };
}
