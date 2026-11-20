import {
  isValidPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_RULE,
} from './password-rule.js';

// ACC-01: 8 to 72 characters (cap: 17 Nov, #126), at least one letter and one digit.
describe('password rule (ACC-01)', () => {
  describe('length boundary', () => {
    it('rejects 7 characters even with a letter and a digit', () => {
      expect(isValidPassword('abcdef1')).toBe(false);
    });

    it('accepts exactly 8 characters with a letter and a digit', () => {
      expect(isValidPassword('abcdefg1')).toBe(true);
    });

    it('accepts exactly 72 characters (the bcrypt limit)', () => {
      expect(isValidPassword(`${'a'.repeat(71)}1`)).toBe(true);
    });

    it('rejects 73 characters', () => {
      expect(isValidPassword(`${'a'.repeat(72)}1`)).toBe(false);
    });

    it('exposes the limits the rule uses', () => {
      expect(PASSWORD_MIN_LENGTH).toBe(8);
      expect(PASSWORD_MAX_LENGTH).toBe(72);
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
