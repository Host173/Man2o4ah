/**
 * The password rule (ACC-01): 8 to 72 characters, including at least one
 * letter and one digit. Checked on the plain password before hashing, in the
 * DTO, never in the schema (the schema only sees the hash). ACC-07a, ACC-08
 * and ACC-13 use the same rule.
 *
 * The 72-character cap (team leader, 17 Nov, #126): bcrypt ignores everything
 * after 72 bytes, so without it two long passwords sharing their first 72
 * bytes would both work.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;

export const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,72}$/;

export const PASSWORD_RULE_MESSAGE =
  'password must have 8 to 72 characters, including at least one letter and one digit';

export function isValidPassword(password: string): boolean {
  return PASSWORD_RULE.test(password);
}
