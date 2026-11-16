import { isValidPassword, PASSWORD_RULE } from './password-rule.js';

// ACC-01: at least 8 characters, at least one letter and at least one digit.
describe('password rule (ACC-01)', () => {
  describe('length boundary', () => {
    it('rejects 7 characters even with a letter and a digit', () => {
      expect(isValidPassword('abcdef1')).toBe(false);
    });

    it('accepts exactly 8 characters with a letter and a digit', () => {
      expect(isValidPassword('abcdefg1')).toBe(true);
    });

    it('accepts a long password', () => {
      expect(isValidPassword(`${'a'.repeat(63)}1`)).toBe(true);
    });

    it('rejects the empty string', () => {
      expect(isValidPassword('')).toBe(false);
    });
  });

  describe('character classes', () => {
    it('rejects letters only', () => {
      expect(isValidPassword('abcdefgh')).toBe(false);
    });

    it('rejects digits only', () => {
      expect(isValidPassword('12345678')).toBe(false);
    });

    it('rejects symbols only', () => {
      expect(isValidPassword('!@#$%^&*')).toBe(false);
    });

    it('rejects symbols and digits without a letter', () => {
      expect(isValidPassword('!@#$%^1*')).toBe(false);
    });

    it('rejects symbols and letters without a digit', () => {
      expect(isValidPassword('!@#$%^a*')).toBe(false);
    });

    it('accepts an uppercase letter as the letter', () => {
      expect(isValidPassword('ABCDEFG1')).toBe(true);
    });

    it('accepts the letter and digit in any position, with symbols', () => {
      expect(isValidPassword('1!@#$%^a')).toBe(true);
      expect(isValidPassword('Pa$$w0rd')).toBe(true);
    });
  });

  it('exposes the rule as a regular expression for the DTO', () => {
    expect(PASSWORD_RULE.test('abcdefg1')).toBe(true);
    expect(PASSWORD_RULE.test('abcdef1')).toBe(false);
  });
});
