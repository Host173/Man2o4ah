/**
 * The password rule (ACC-01): at least 8 characters, including at least one
 * letter and one digit. Checked on the plain password before hashing, in the
 * DTO, never in the schema (the schema only sees the hash). ACC-07a, ACC-08
 * and ACC-13 use the same rule.
 */
export const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

export const PASSWORD_RULE_MESSAGE =
  'password must have at least 8 characters, including at least one letter and one digit';

export function isValidPassword(password: string): boolean {
  return PASSWORD_RULE.test(password);
}
