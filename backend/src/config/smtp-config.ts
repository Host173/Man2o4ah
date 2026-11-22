import { isEmail } from 'class-validator';

export const SMTP_CONFIG = Symbol('SMTP_CONFIG');
export const SMTP_CONFIG_KEYS = [
  'SMTP_ENABLED',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'SMTP_FROM',
  'SMTP_TEST_INBOX',
  'NODE_ENV',
] as const;

export type SmtpConfig =
  | { enabled: false }
  | {
      enabled: true;
      host: string;
      port: number;
      secure: boolean;
      requireTLS: boolean;
      from: string;
      testInbox?: string;
      auth?: { user: string; pass: string };
    };

function requiredString(config: Record<string, unknown>, name: string): string {
  const value = config[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be set when SMTP_ENABLED is true.`);
  }
  return value;
}

/** GEN-01-B: failures name only the setting, never its value. */
export function smtpConfig(config: Record<string, unknown>): SmtpConfig {
  const enabled = config.SMTP_ENABLED;
  if (enabled !== undefined && enabled !== 'true' && enabled !== 'false') {
    throw new Error('SMTP_ENABLED must be "true" or "false".');
  }
  if (enabled !== 'true') return { enabled: false };
  const host = requiredString(config, 'SMTP_HOST');
  if (/\s|[/@]/.test(host))
    throw new Error('SMTP_HOST must be a hostname, not a URL.');
  const rawPort = config.SMTP_PORT;
  const port =
    typeof rawPort === 'string' && /^\d+$/.test(rawPort)
      ? Number(rawPort)
      : rawPort;
  if (
    typeof port !== 'number' ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error('SMTP_PORT must be an integer from 1 to 65535.');
  }
  if (config.SMTP_SECURE !== 'true' && config.SMTP_SECURE !== 'false') {
    throw new Error('SMTP_SECURE must be "true" or "false".');
  }
  const from = requiredString(config, 'SMTP_FROM');
  if (!isEmail(from) || /[\r\n]/.test(from))
    throw new Error('SMTP_FROM must be a single email address.');
  const production = config.NODE_ENV === 'production';
  const testInbox = production
    ? undefined
    : requiredString(config, 'SMTP_TEST_INBOX');
  if (testInbox && (!isEmail(testInbox) || /[\r\n]/.test(testInbox))) {
    throw new Error('SMTP_TEST_INBOX must be a single email address.');
  }
  const user = config.SMTP_USER;
  const pass = config.SMTP_PASSWORD;
  const hasUser = user !== undefined && user !== '';
  const hasPass = pass !== undefined && pass !== '';
  if (
    hasUser !== hasPass ||
    (hasUser && (typeof user !== 'string' || typeof pass !== 'string'))
  ) {
    throw new Error(
      'SMTP_USER and SMTP_PASSWORD must both be set or both be absent.',
    );
  }
  return {
    enabled: true,
    host,
    port,
    secure: config.SMTP_SECURE === 'true',
    requireTLS: production && config.SMTP_SECURE === 'false',
    from,
    ...(testInbox ? { testInbox } : {}),
    ...(hasUser && typeof user === 'string' && typeof pass === 'string'
      ? { auth: { user, pass } }
      : {}),
  };
}
