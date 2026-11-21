import { defineConfig } from 'vitest/config';

// TST-03: the whole-system stress suite. Never run by CI (`npm run verify`):
// it is slow and its specs under test/stress/findings/ fail on purpose until
// each finding is fixed.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.stress-spec.ts'],
    testTimeout: 180_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
});
