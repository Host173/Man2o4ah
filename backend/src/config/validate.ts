export function validate(config: Record<string, unknown>) {
  if (!config.MONGODB_URI) {
    throw new Error(
      'MONGODB_URI is not set. Add it to backend/.env (see .env.example).',
    );
  }
  if (
    typeof config.JWT_ACCESS_SECRET !== 'string' ||
    config.JWT_ACCESS_SECRET.trim() === ''
  ) {
    throw new Error(
      'JWT_ACCESS_SECRET is not set. Add it to backend/.env (see .env.example).',
    );
  }
  const currency = config.PLATFORM_CURRENCY;
  if (
    currency !== undefined &&
    !(typeof currency === 'string' && /^[A-Z]{3}$/.test(currency))
  ) {
    throw new Error(
      'PLATFORM_CURRENCY must be a 3-letter uppercase currency code such as USD.',
    );
  }
  // FXRATES_API_KEY is optional and can be any string (ITN-18).
  const autoRefresh = config.FX_AUTO_REFRESH;
  if (
    autoRefresh !== undefined &&
    autoRefresh !== 'true' &&
    autoRefresh !== 'false'
  ) {
    throw new Error(
      'FX_AUTO_REFRESH must be "true" or "false" when it is set.',
    );
  }
  return config;
}
