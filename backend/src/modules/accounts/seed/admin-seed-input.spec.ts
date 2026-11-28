import { PASSWORD_RULE_MESSAGE } from '../auth/password-rule.js';
import { parseAdminSeedInput } from './admin-seed-input.js';

const VALID = {
  SEED_ADMIN_EMAIL: 'admin@example.com',
  SEED_ADMIN_PASSWORD: 'Admin12345',
};

describe('parseAdminSeedInput (ACC-18)', () => {
  it('trims and lowercases the email and keeps the password as is', () => {
    expect(
      parseAdminSeedInput({
        ...VALID,
        SEED_ADMIN_EMAIL: '  Admin@Example.COM ',
      }),
    ).toEqual({ email: 'admin@example.com', password: 'Admin12345' });
  });

  it.each([undefined, '', '   '])(
    'rejects a missing SEED_ADMIN_EMAIL %j',
    (value) => {
      expect(() =>
        parseAdminSeedInput({ ...VALID, SEED_ADMIN_EMAIL: value }),
      ).toThrow(/SEED_ADMIN_EMAIL is not set/);
    },
  );

  it.each([
    'admin',
    'admin@',
    '@example.com',
    'admin example@x.com',
    // Accepted by isEmail but not by the users.email schema rule, so they
    // must fail here, before bcrypt and the insert.
    "o'brien@example.com",
    'a!b@example.com',
  ])('rejects the invalid email %j', (value) => {
    expect(() =>
      parseAdminSeedInput({ ...VALID, SEED_ADMIN_EMAIL: value }),
    ).toThrow(/SEED_ADMIN_EMAIL must be a valid email/);
  });

  it.each([undefined, ''])(
    'rejects a missing SEED_ADMIN_PASSWORD %j',
    (value) => {
      expect(() =>
        parseAdminSeedInput({ ...VALID, SEED_ADMIN_PASSWORD: value }),
      ).toThrow(/SEED_ADMIN_PASSWORD is not set/);
    },
  );

  it.each(['short1', 'onlyletters', '12345678', 'a1'.repeat(37)])(
    'rejects the password %j without printing it',
    (password) => {
      let message = '';
      try {
        parseAdminSeedInput({ ...VALID, SEED_ADMIN_PASSWORD: password });
      } catch (error) {
        message = error instanceof Error ? error.message : '';
      }
      expect(message).toContain('SEED_ADMIN_PASSWORD');
      expect(message).toContain(PASSWORD_RULE_MESSAGE);
      expect(message).not.toContain(password);
    },
  );
});
