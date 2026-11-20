import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/data/**'],
      reporter: ['text', 'html', 'lcov'],
    },
    include: ['test/**/*.test.ts'],
    // Whole-corpus comparisons take seconds each; a loaded machine must not fail them.
    testTimeout: 60_000,
    // Known-gap cases are documented and runnable, but are not part of the
    // pass/fail contract: run them on demand with `pnpm test:gaps`. The timing
    // tests depend on the machine and its load: run them with `pnpm test:perf`
    // (test/performance.test.ts, and the `timed` tests of the other files, skipped here).
    exclude: [...configDefaults.exclude, 'test/known-gaps.test.ts', 'test/performance.test.ts'],
  },
});
