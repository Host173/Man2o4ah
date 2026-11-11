export function validate(config: Record<string, unknown>) {
  if (!config.MONGODB_URI) {
    throw new Error(
      'MONGODB_URI is not set. Add it to backend/.env (see .env.example).',
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
  return config;
}
