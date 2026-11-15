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
