import { defineConfig } from 'vitest/config';

// PLT-07: `npm run openapi:export` writes docs/api/openapi.json. Never part of CI
// (`vitest.config.ts` includes `*.spec.ts` only, the E2E config `*.e2e-spec.ts`).
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.openapi-spec.ts'],
    testTimeout: 120_000,
    hookTimeout: 300_000,
  },
});
