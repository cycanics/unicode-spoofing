import { defineConfig } from 'vitest/config';

// Runs the timing tests: test/performance.test.ts (time budgets, growth ratios,
// comparisons with the reference bundle) and the `timed` tests of the other
// files (test/helpers/growth.ts), which `pnpm test` skips. Their results depend
// on the machine and its load, so they are no release check. Invoked via
// `pnpm test:perf`, on an idle machine; files run one after another, so no other
// test skews a wall-clock ratio.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: { UNSPOOF_TIMING: '1' },
    include: [
      'test/performance.test.ts',
      'test/analyze.test.ts',
      'test/hidden.test.ts',
      'test/hidden-content.test.ts',
      'test/terminal.test.ts',
      'test/decisions-42-phases.test.ts',
      'test/decisions-7b-30b8-41c.test.ts',
      'test/finding-callback.test.ts',
    ],
    fileParallelism: false,
    testTimeout: 60_000,
  },
});
