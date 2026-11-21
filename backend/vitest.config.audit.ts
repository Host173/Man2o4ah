import { defineConfig } from 'vitest/config';

// TST-02: the Swagger audit. Never part of CI (`vitest.config.ts` includes `*.spec.ts` only).
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.audit-spec.ts'],
    testTimeout: 120_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
});
