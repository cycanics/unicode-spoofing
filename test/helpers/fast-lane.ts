/** The fast lane's equivalence check (fast-lane*.test.ts): lane on and off, in representative modes. */
import { isDeepStrictEqual } from 'node:util';
import { expect } from 'vitest';
import { analyzeWith } from '../../src/analyze';
import type { TokenState } from '../../src/letters';
import type { AnalyzeOptions } from '../../src';

export const SA: AnalyzeOptions = { hiddenChars: 'strict', confusionModel: 'language' };
const ENRU = { targetLanguages: ['English', 'Russian'] } as const;
/**
 * A representative set of the modes the tests use: the default path (lenient rules, Latin
 * fold); strict and lenient under the language model, with the default targets and English +
 * Russian; every word read at once
 * (breadth `all`), a ring that wraps every 32 words, and whole-word folds off (what the
 * classifier leaves pending changes with the targets and the fold setting).
 */
export const MODES: [string, AnalyzeOptions][] = [
  ['default', {}],
  ['strict', { hiddenChars: 'strict' }],
  ['language', { confusionModel: 'language' }],
  ['alphabet, EN+RU', { confusionModel: 'language', ...ENRU }],
  ['strict alphabet', SA],
  ['strict alphabet, EN+RU', { ...SA, ...ENRU }],
  ['strict alphabet, all', { ...SA, breadth: 'all' }],
  ['small ring, EN+RU', { ...SA, ...ENRU, contextBuffer: 24, majorityWindow: 5 }],
  ['fold off', { ...SA, wholeScriptFold: 'off' }],
];
/** The modes for the ~1 MB text (its run is longer). */
export const REALISTIC_MODES = MODES.filter(([n]) =>
  [
    'default',
    'language',
    'strict alphabet',
    'strict alphabet, EN+RU',
    'small ring, EN+RU',
  ].includes(n),
);

/** One run: the result, every word call and record, and (with `dump`) each word's ring state. */
export function run(text: string, o: AnalyzeOptions, fastLane: boolean, dump: boolean) {
  const calls: unknown[] = [];
  const records: unknown[] = [];
  const states: Omit<TokenState, 'fastLane'>[] = [];
  let lane = 0;
  const result = analyzeWith(
    text,
    o,
    {
      onWord: (...a) => void calls.push(a),
      onRecord: (r) => void records.push({ ...r }),
    },
    {
      fastLane,
      ...(dump && {
        onTokenState: (_t, { fastLane: byLane, ...st }) => {
          if (byLane) lane++;
          states.push(st);
        },
      }),
    },
  );
  return { result, calls, records, states, lane };
}

/** The first word whose state differs, for the message. */
function firstDiff(a: unknown[], b: unknown[]): string {
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    if (!isDeepStrictEqual(a[i], b[i]))
      return `word ${i}: ${JSON.stringify(a[i])} vs ${JSON.stringify(b[i])}`;
  return '';
}

/**
 * Lane on and off agree on `text`; `undumped`: the lane's run without the state dump (which
 * fills the vote cache early) agrees too. Returns the words the lane took.
 */
export function expectSame(text: string, o: AnalyzeOptions, undumped: boolean): number {
  const { states: a, lane, ...on } = run(text, o, true, true);
  const { states: b, lane: none, ...off } = run(text, o, false, true);
  expect(none).toBe(0);
  if (!isDeepStrictEqual(on, off)) expect(on).toEqual(off);
  if (!isDeepStrictEqual(a, b))
    expect.fail(`${JSON.stringify(text.slice(0, 80))}: ${firstDiff(a, b)}`);
  if (undumped) {
    const { states, lane: l, ...plain } = run(text, o, true, false);
    void states;
    void l;
    if (!isDeepStrictEqual(plain, on)) expect(plain).toEqual(on);
  }
  return lane;
}
