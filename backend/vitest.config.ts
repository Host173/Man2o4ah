import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`. Requires Vite 8, which ships this option.
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    // Vitest's default is 5 s per test. Tests that hash passwords (bcrypt cost
    // 12) or seed the database pass that limit when the full suite shares the
    // CPU on a member's machine, so they fail at random. A real hang still
    // fails, just later.
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      reportsDirectory: './coverage',
      // List the source files explicitly so a service that no test imports
      // counts as 0% instead of silently dropping out of the report.
      include: ['src/**/*.ts'],
      exclude: ['**/*.spec.ts', '**/*.e2e-spec.ts'],
      thresholds: {
        // Quality gate: every service must stay well covered, file by file, so
        // a well-tested service can't hide an untested one. No global
        // threshold on purpose, so perFile only affects the glob below.
        perFile: true,
        'src/modules/**/*.service.ts': { lines: 80 },
      },
    },
  },
});
