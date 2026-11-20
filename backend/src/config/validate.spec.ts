import { validate } from './validate.js';

describe('validate', () => {
  const base = {
    MONGODB_URI: 'mongodb://localhost/test',
    JWT_ACCESS_SECRET: 'a-secret',
  };

  it('accepts a 3-letter uppercase PLATFORM_CURRENCY', () => {
    expect(() => validate({ ...base, PLATFORM_CURRENCY: 'USD' })).not.toThrow();
  });

  it('accepts an unset PLATFORM_CURRENCY', () => {
    expect(() => validate(base)).not.toThrow();
  });

  it('rejects a lowercase PLATFORM_CURRENCY and names the variable', () => {
    expect(() => validate({ ...base, PLATFORM_CURRENCY: 'usd' })).toThrow(
      /PLATFORM_CURRENCY/,
    );
  });

  it('rejects a PLATFORM_CURRENCY of the wrong length', () => {
    expect(() => validate({ ...base, PLATFORM_CURRENCY: 'US' })).toThrow(
      /PLATFORM_CURRENCY/,
    );
  });

  it.each([undefined, '', 'any-key-123'])(
    'accepts FXRATES_API_KEY %j (optional, any string)',
    (key) => {
      expect(() => validate({ ...base, FXRATES_API_KEY: key })).not.toThrow();
    },
  );

  it.each([undefined, 'true', 'false'])(
    'accepts FX_AUTO_REFRESH %j',
    (value) => {
      expect(() => validate({ ...base, FX_AUTO_REFRESH: value })).not.toThrow();
    },
  );

  it.each(['yes', 'TRUE', '1', ''])(
    'rejects FX_AUTO_REFRESH %j and names the variable',
    (value) => {
      expect(() => validate({ ...base, FX_AUTO_REFRESH: value })).toThrow(
        /FX_AUTO_REFRESH/,
      );
    },
  );

  it.each([undefined, '', 'sk_test_abc123', 'rk_test_abc123'])(
    'accepts STRIPE_SECRET_KEY %j (optional, test mode only)',
    (key) => {
      expect(() => validate({ ...base, STRIPE_SECRET_KEY: key })).not.toThrow();
    },
  );

  it.each(['sk_live_abc123', 'rk_live_abc123', 'pk_test_abc123', 'abc'])(
    'rejects STRIPE_SECRET_KEY %j and names the variable',
    (key) => {
      expect(() => validate({ ...base, STRIPE_SECRET_KEY: key })).toThrow(
        /STRIPE_SECRET_KEY must be a test-mode key/,
      );
    },
  );

  it('never prints the rejected Stripe key', () => {
    let message = '';
    try {
      validate({ ...base, STRIPE_SECRET_KEY: 'sk_live_topsecret' });
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toMatch(/STRIPE_SECRET_KEY/);
    expect(message).not.toContain('topsecret');
  });

  it.each([undefined, '', 'whsec_abc123'])(
    'accepts STRIPE_WEBHOOK_SECRET %j (optional)',
    (secret) => {
      expect(() =>
        validate({ ...base, STRIPE_WEBHOOK_SECRET: secret }),
      ).not.toThrow();
    },
  );

  it.each(['sk_test_abc123', 'abc'])(
    'rejects STRIPE_WEBHOOK_SECRET %j and names the variable',
    (secret) => {
      expect(() =>
        validate({ ...base, STRIPE_WEBHOOK_SECRET: secret }),
      ).toThrow(/STRIPE_WEBHOOK_SECRET must start with whsec_/);
    },
  );

  it('still rejects a missing MONGODB_URI', () => {
    expect(() => validate({})).toThrow(/MONGODB_URI/);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['blank', '   '],
  ])(
    'rejects a %s JWT_ACCESS_SECRET and names the variable',
    (_name, value) => {
      expect(() =>
        validate({ MONGODB_URI: base.MONGODB_URI, JWT_ACCESS_SECRET: value }),
      ).toThrow(/JWT_ACCESS_SECRET/);
    },
  );
});
