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
  // The Stripe variables are optional (the app and the tests run without
  // Stripe; an empty line counts as unset), but a set key must be a test-mode one: the course forbids live
  // mode (PAY-01). The message never repeats the value.
  const stripeKey = config.STRIPE_SECRET_KEY;
  if (
    stripeKey !== undefined &&
    stripeKey !== '' &&
    !(
      typeof stripeKey === 'string' &&
      (stripeKey.startsWith('sk_test_') || stripeKey.startsWith('rk_test_'))
    )
  ) {
    throw new Error(
      'STRIPE_SECRET_KEY must be a test-mode key (sk_test_… or rk_test_…).',
    );
  }
  const webhookSecret = config.STRIPE_WEBHOOK_SECRET;
  if (
    webhookSecret !== undefined &&
    webhookSecret !== '' &&
    !(typeof webhookSecret === 'string' && webhookSecret.startsWith('whsec_'))
  ) {
    throw new Error('STRIPE_WEBHOOK_SECRET must start with whsec_.');
  }
  return config;
}
