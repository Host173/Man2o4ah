/** Signs and verifies the access token in tests. Not a real secret. */
export const TEST_JWT_ACCESS_SECRET = 'test-access-secret-not-for-production';

/** The configuration `createTestApp` serves through `ConfigModule`. */
export const TEST_CONFIG = {
  JWT_ACCESS_SECRET: TEST_JWT_ACCESS_SECRET,
  PLATFORM_CURRENCY: 'USD',
  FRONTEND_URL: 'http://localhost:3000',
  // No app built by a test fetches exchange rates at start-up (ITN-18).
  FX_AUTO_REFRESH: 'false',
  // Tests opt in with deterministic SMTP configuration/transport overrides.
  SMTP_ENABLED: 'false',
};
