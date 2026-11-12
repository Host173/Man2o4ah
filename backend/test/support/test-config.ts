/** Signs and verifies the access token in tests. Not a real secret. */
export const TEST_JWT_ACCESS_SECRET = 'test-access-secret-not-for-production';

/** The configuration `createTestApp` serves through `ConfigModule`. */
export const TEST_CONFIG = {
  JWT_ACCESS_SECRET: TEST_JWT_ACCESS_SECRET,
  PLATFORM_CURRENCY: 'USD',
  FRONTEND_URL: 'http://localhost:3000',
};
