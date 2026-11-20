/**
 * The password rule (ACC-01): 8 to 72 characters, including at least one
 * letter and one digit. Checked on the plain password before hashing, in the
 * DTO, never in the schema (the schema only sees the hash). ACC-07a, ACC-08
 * and ACC-13 use the same rule.
 *
 * The 72-character cap (team leader, 17 Nov, #126; DECISIONS §3): bcrypt
 * ignores everything after 72 bytes, so the cap stops long ASCII passwords
 * that share their first 72 bytes from both working. It counts characters,
 * not UTF-8 bytes; see DECISIONS open item 1. A non-ASCII password can still
 * pass 72 bytes: "a1" + "é"×70 and "a1" + "é"×35 + "x"×35 are both 72
 * characters, and a hash of the first accepts the second.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;

export const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,72}$/;

export const PASSWORD_RULE_MESSAGE =
  'password must have 8 to 72 characters, including at least one letter and one digit';

export function isValidPassword(password: string): boolean {
  return PASSWORD_RULE.test(password);
}
