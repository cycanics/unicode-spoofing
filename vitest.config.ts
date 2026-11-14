import { defineConfig, configDefaults } from 'vitest/config';

const PERF = 'test/performance.test.ts';

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
    // Timing tests run alone, after every other file has finished: parallel
    // neighbours skew their wall-clock ratios.
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['test/**/*.test.ts'],
          // Known-gap cases are documented and runnable, but are not part of the
          // pass/fail contract — run them on demand with `pnpm test:gaps`.
          exclude: [...configDefaults.exclude, 'test/known-gaps.test.ts', PERF],
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: 'performance',
          include: [PERF],
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
