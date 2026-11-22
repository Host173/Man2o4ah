import { smtpConfig } from './smtp-config.js';

const enabled = {
  SMTP_ENABLED: 'true',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  SMTP_SECURE: 'false',
  SMTP_FROM: 'platform@example.test',
  SMTP_TEST_INBOX: 'inbox@example.test',
};

describe('SMTP configuration (GEN-01-B)', () => {
  it('defaults to disabled and ignores irrelevant settings', () => {
    expect(smtpConfig({ SMTP_HOST: 'bad host' })).toEqual({ enabled: false });
    expect(smtpConfig({ SMTP_ENABLED: 'false', SMTP_PORT: 'bad' })).toEqual({
      enabled: false,
    });
  });

  it('requires the development test inbox and prevents production fallback', () => {
    expect(() =>
      smtpConfig({ ...enabled, SMTP_TEST_INBOX: undefined }),
    ).toThrow(/SMTP_TEST_INBOX/);
    expect(smtpConfig(enabled)).toMatchObject({
      enabled: true,
      testInbox: enabled.SMTP_TEST_INBOX,
      requireTLS: false,
    });
    expect(smtpConfig({ ...enabled, NODE_ENV: 'production' })).toMatchObject({
      requireTLS: true,
    });
    expect(
      smtpConfig({ ...enabled, NODE_ENV: 'production' }),
    ).not.toHaveProperty('testInbox');
    expect(
      smtpConfig({ ...enabled, NODE_ENV: 'production', SMTP_SECURE: 'true' }),
    ).toMatchObject({ secure: true, requireTLS: false });
  });

  it.each([
    ['SMTP_ENABLED', 'yes'],
    ['SMTP_HOST', 'smtp://private'],
    ['SMTP_PORT', '0'],
    ['SMTP_PORT', '65536'],
    ['SMTP_PORT', '1.5'],
    ['SMTP_SECURE', 'yes'],
    ['SMTP_FROM', 'a@example.test\r\nBcc: b@example.test'],
    ['SMTP_TEST_INBOX', 'not-mail'],
    ['SMTP_USER', 'user'],
    ['SMTP_PASSWORD', 'password'],
  ])('rejects invalid %s without exposing its value', (key, value) => {
    expect(() => smtpConfig({ ...enabled, [key]: value })).toThrow(
      new RegExp(key),
    );
    try {
      smtpConfig({ ...enabled, [key]: value });
    } catch (error) {
      expect(String(error)).not.toContain(value);
    }
  });

  it('accepts paired auth and port boundaries', () => {
    expect(
      smtpConfig({
        ...enabled,
        SMTP_PORT: '65535',
        SMTP_USER: 'user',
        SMTP_PASSWORD: 'password',
      }),
    ).toMatchObject({ port: 65535, auth: { user: 'user', pass: 'password' } });
    expect(smtpConfig({ ...enabled, SMTP_PORT: 1 })).toMatchObject({ port: 1 });
  });
});
