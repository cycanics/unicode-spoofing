/**
 * Linearity checks by growth, not wall-clock limits: the median time of `run(2n)` over the
 * median time of `run(n)`, the two interleaved. Linear work gives about 2; a quadratic one 4.
 */
export function growth(run: (n: number) => void, n: number, rounds = 3): number {
  run(n);
  run(2 * n);
  const a: number[] = [];
  const b: number[] = [];
  for (let k = 0; k < rounds; k++) {
    let t = performance.now();
    run(n);
    a.push(performance.now() - t);
    t = performance.now();
    run(2 * n);
    b.push(performance.now() - t);
  }
  const med = (x: number[]) => x.sort((p, q) => p - q)[x.length >> 1]!;
  return med(b) / Math.max(med(a), 0.05);
}
/**
 * A timing test: its result depends on the machine and its load, so it runs only under
 * `pnpm test:perf` (vitest.perf.config.ts sets UNSPOOF_TIMING) and is skipped by `pnpm test`.
 */
export const timed: typeof it.skip = process.env.UNSPOOF_TIMING === '1' ? it : it.skip;
/** The bound a linear growth stays under (2 expected; noise and GC allowed for). */
export const LINEAR = 3;
