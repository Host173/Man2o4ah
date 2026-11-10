import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`. Requires Vite 8, which ships this option.
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      reportsDirectory: './coverage',
      // List the source files explicitly so a service that no test imports
      // counts as 0% instead of silently dropping out of the report.
      include: ['src/**/*.ts'],
      exclude: ['**/*.spec.ts', '**/*.e2e-spec.ts'],
      thresholds: {
        // Quality gate: business logic must stay well covered. No global
        // threshold on purpose.
        'src/modules/**/*.service.ts': { lines: 80 },
      },
    },
  },
});
