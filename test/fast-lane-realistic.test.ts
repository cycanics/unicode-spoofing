/** The fast lane's equivalence (fast-lane.test.ts) on the ~1 MB realistic text. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectSame, REALISTIC_MODES } from './helpers/fast-lane';

const corpus = (
  JSON.parse(readFileSync(join(__dirname, 'fixtures', 'cases.json'), 'utf8')) as { input: string }[]
).map((c) => c.input);

describe('fast lane: lane on and off agree on the ~1 MB realistic text', () => {
  let text = '';
  beforeAll(async () => {
    const { buildRealisticMarkdown } = (await import(
      join(__dirname, '..', 'scripts', 'realistic-text.mjs') as string
    )) as { buildRealisticMarkdown: (o: object) => string };
    text = buildRealisticMarkdown({ targetBytes: 1 << 20, seed: 1, cases: corpus });
  });
  it.each(REALISTIC_MODES)(
    '%s',
    (_n, o) => expect(expectSame(text, o, true)).toBeGreaterThan(10_000),
    60_000,
  );
});
