/**
 * The word phase's fast lane (letters.ts, `closeToken`): an ASCII word the
 * classifier left nothing pending is judged as it closes, "no finding, counted
 * as a word", which is what the full judge gives it. Equivalence: the lane on
 * and off (`fastLane: false`, test only) give the same output, findings, word
 * calls, records and counts, and the same ring state for every word (flags,
 * class, counts, votes, window sums, nearest words, finding), on the fixture
 * corpus, parity.test.ts's probe sentences and the ~1 MB realistic text, in a
 * representative set of the tests' modes, with the default targets and English
 * + Russian (helpers/fast-lane.ts).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeWith } from '../src/analyze';
import { DONOR_MIX, LONG, MARK_HEAVY, randomStrings } from './helpers/random';
import { expectSame, MODES, SA } from './helpers/fast-lane';

const corpus = (
  JSON.parse(readFileSync(join(__dirname, 'fixtures', 'cases.json'), 'utf8')) as { input: string }[]
).map((c) => c.input);
/** parity.test.ts's inputs besides the corpus. */
const probes = [
  ...randomStrings(3000),
  ...randomStrings(800, MARK_HEAVY, 11),
  ...LONG,
  ...DONOR_MIX,
];

describe('fast lane: lane on and off give the same results and ring state', () => {
  it.each(MODES)(
    '%s: fixture corpus and parity probes',
    (_n, o) => {
      let lane = 0;
      for (const t of corpus) lane += expectSame(t, o, true);
      for (const t of probes) lane += expectSame(t, o, false);
      expect(lane).toBeGreaterThan(0);
    },
    60_000,
  );

  it('an ASCII word the classifier leaves pending (a case anomaly) goes to the full judge', () => {
    const lane: boolean[] = [];
    const r = analyzeWith(
      'paypaI login',
      SA,
      {},
      {
        onTokenState: (_t, st) => void lane.push(st.fastLane),
      },
    );
    expect(lane).toEqual([false, true]);
    expect(r.normalized).toBe('paypal login');
  });
});
