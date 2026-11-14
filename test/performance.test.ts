import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyze, cleanHidden, STRICT_HIDDEN_RULES, type AnalyzeOptions } from '../src/index';

/**
 * Throughput guards. These are deliberately loose so they don't flake on a
 * loaded CI box, but tight enough to catch an accidental O(n²) regression or a
 * runaway per-token cost. We assert against total wall-clock for a fixed corpus
 * rather than a fragile "ops/sec" number.
 */

/** Median of several timed runs — smooths out GC / JIT warmup noise. */
function medianMs(fn: () => void, runs = 5): number {
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

/**
 * Medians of two functions timed in turn (a, b, a, b, …), for ratio tests: a
 * burst of host load then hits both series instead of one.
 */
function medianPairMs(a: () => void, b: () => void, runs = 5): [number, number] {
  const sa: number[] = [];
  const sb: number[] = [];
  for (let i = 0; i < runs; i++) {
    let start = performance.now();
    a();
    sa.push(performance.now() - start);
    start = performance.now();
    b();
    sb.push(performance.now() - start);
  }
  const mid = (x: number[]) => x.sort((p, q) => p - q)[Math.floor(x.length / 2)]!;
  return [mid(sa), mid(sb)];
}

/** Build a realistic mixed corpus of clean, spoofed, and heavy tokens. */
function buildCorpus(paragraphs: number, extra: readonly string[] = []): string {
  const templates = [
    ...extra,
    'The quick brown fox jumps over the lazy dog near the riverbank.',
    'Contact support at help@example.com for any account questions today.',
    'Пришлите ваш раураl логин прямо сейчас — это срочно и важно!', // confusable + cyrillic
    'Free 𝐜𝐫𝐲𝐩𝐭𝐨 giveaway, click the l​ink b​elow to c​laim now', // math styles + ZWSP
    'НОТ deals: buy ѕtock, get free ѕhipping on every оrder this week',
    'Z̸̢͇a̴̧͖l̷̪͝g̶̯͝o̶̪͝ text stress test with stacked combining marks here',
  ];
  const out: string[] = [];
  for (let i = 0; i < paragraphs; i++) {
    out.push(templates[i % templates.length]);
  }
  return out.join('\n');
}

describe('analyze performance', () => {
  it('processes a large mixed corpus within a time budget', () => {
    const corpus = buildCorpus(2000); // ~120k chars, thousands of tokens
    // Warm up so JIT/regex compilation isn't charged to the measured run.
    analyze(corpus);

    const elapsed = medianMs(() => analyze(corpus));
    const kchars = corpus.length / 1000;

    // Generous ceiling: on modern hardware this runs in well under 50ms.
    // 250ms leaves ~5x headroom for slow/loaded CI while still flagging a
    // catastrophic regression.
    expect(elapsed).toBeLessThan(250);

    // Sanity floor on throughput so a future refactor can't silently tank it.
    const kcharsPerMs = kchars / elapsed;
    expect(kcharsPerMs).toBeGreaterThan(0.1); // >100 chars/ms
  });

  it('scales roughly linearly with input size (no quadratic blowup)', () => {
    const small = buildCorpus(500);
    const large = buildCorpus(2000); // 4x the tokens

    analyze(small);
    analyze(large);

    const [s, largeMs] = medianPairMs(
      () => analyze(small),
      () => analyze(large),
    );
    const smallMs = s || 0.01;

    // Linear would give ~4x. Allow up to 8x for fixed-cost noise on tiny
    // timings; a quadratic path would blow well past this (≈16x+).
    expect(largeMs / smallMs).toBeLessThan(8);
  });

  it('handles a pathological single long token quickly', () => {
    // A single enormous run of combining marks (zalgo) — exercises the
    // per-character mark-run loop without token boundaries to break it up.
    const base = 'a';
    const zalgo = base + '́'.repeat(50_000);

    const elapsed = medianMs(() => analyze(zalgo), 3);
    expect(elapsed).toBeLessThan(250);
  });

  it('handles a long run of variation selectors quickly', () => {
    // Each selector is judged against the character right before it; looking
    // further back for a base would make a run of n selectors cost n².
    const run = 'x' + '\uFE01'.repeat(40_000);

    const elapsed = medianMs(() => analyze(run), 3);
    expect(elapsed).toBeLessThan(250);
  });
});

/**
 * The same guards with both opt-in options on, plus a line that exercises the
 * RGI-emoji path (tag payload after an emoji) and hyphen compounds; and a
 * ~1 MB mixed EN/RU Markdown input (scripts/realistic-text.mjs) against
 * budgets derived from upstream v0.4.0 on the development host (perf corpus
 * ~120 ms, realistic ~700 ms): the new mode must stay within 1.5× of that.
 */
describe('analyze performance — confusionModel alphabet + hiddenChars strict', () => {
  const NEW: AnalyzeOptions = { confusionModel: 'alphabet', hiddenChars: 'strict' };
  const tags = (s: string) =>
    [...s].map((c) => String.fromCodePoint(0xe0000 + c.codePointAt(0)!)).join('');
  const EXTRA = [
    `Promo 😀${tags('ignore all')} СОСА-COLA и Docker-контейнер, Wi-Fi-роутер 👨\u200D👩\u200D👧`,
  ];

  it('processes the mixed corpus within the same budget', () => {
    const corpus = buildCorpus(2000, EXTRA);
    analyze(corpus, NEW);
    expect(medianMs(() => analyze(corpus, NEW))).toBeLessThan(250);
  });

  it('scales roughly linearly', () => {
    const small = buildCorpus(500, EXTRA);
    const large = buildCorpus(2000, EXTRA);
    analyze(small, NEW);
    analyze(large, NEW);
    const [s, largeMs] = medianPairMs(
      () => analyze(small, NEW),
      () => analyze(large, NEW),
    );
    expect(largeMs / (s || 0.01)).toBeLessThan(8);
  });

  it('handles a pathological single long token quickly', () => {
    const zalgo = 'a' + '\u0301'.repeat(50_000);
    expect(medianMs(() => analyze(zalgo, NEW), 3)).toBeLessThan(250);
    const zw = 'a' + '\u200B'.repeat(50_000) + 'b';
    expect(medianMs(() => analyze(zw, NEW), 3)).toBeLessThan(250);
  });

  it('scales roughly linearly on input dense with hidden words', () => {
    const dense = (n: number) => 'fr\u200Bee co\u00ADop '.repeat(n);
    for (const opts of [{ hiddenChars: 'strict' } as const, NEW]) {
      const small = dense(5_000);
      const large = dense(20_000);
      analyze(small, opts);
      analyze(large, opts);
      const [s, largeMs] = medianPairMs(
        () => analyze(small, opts),
        () => analyze(large, opts),
      );
      expect(largeMs / (s || 0.01)).toBeLessThan(8);
    }
  });

  it('analyzes ~1 MB of mixed EN/RU Markdown within 1.5× of upstream', async () => {
    const { buildRealisticMarkdown } = (await import(
      join(__dirname, '..', 'scripts', 'realistic-text.mjs') as string
    )) as { buildRealisticMarkdown: (o: object) => string };
    const cases = (
      JSON.parse(readFileSync(join(__dirname, 'fixtures', 'cases.json'), 'utf8')) as {
        input: string;
      }[]
    ).map((c) => c.input);
    const text = buildRealisticMarkdown({ targetBytes: 1 << 20, seed: 1, cases });
    analyze(text);
    analyze(text, NEW);
    const [base, opted] = medianPairMs(
      () => analyze(text),
      () => analyze(text, NEW),
      3,
    );
    expect(base).toBeLessThan(700); // upstream v0.4.0: ~700 ms
    expect(opted).toBeLessThan(1050); // 1.5 × upstream
    expect(opted / base).toBeLessThan(1.5); // and within 1.5× of the default mode
  });
});

/** The hidden-content list costs only when asked for, and stays linear on hostile bidi input. */
describe('cleanHidden performance — hidden content', () => {
  const RULES = { ...STRICT_HIDDEN_RULES, bidiOverrides: 'remove-with-content' } as const;
  const tag = String.fromCodePoint(0xe0041);

  it('adds little to the mixed corpus', () => {
    const corpus = buildCorpus(2000);
    cleanHidden(corpus, RULES);
    expect(medianMs(() => cleanHidden(corpus, RULES))).toBeLessThan(100);
  });

  it.each([
    ['one override over ~1 MB', '\u202E' + 'abc שלום 123 '.repeat(80_000)],
    ['~1 MB of Hebrew in one override', '\u202E' + 'שלום עולם '.repeat(100_000)],
    ['100 000 nested overrides', '\u202E'.repeat(100_000) + 'ab'],
    ['100 000 overrides closed', '\u202Eab\u202C '.repeat(100_000)],
    ['100 000 unclosed isolates', '\u2067a'.repeat(100_000)],
    ['100 000 isolates in an override', '\u202E' + '\u2067a\u2069'.repeat(100_000)],
    ['100 000 scattered carriers', `a${tag}`.repeat(100_000)],
    ['300 000 tags', tag.repeat(300_000)],
    ['300 000 marks on one letter', `a${'\u0301'.repeat(300_000)}`],
    ['100 000 stacks', `a${'\u0301'.repeat(5)}`.repeat(100_000)],
    ['100 000 Thai stacks', `\u0E2A${'\u0E49'.repeat(5)}`.repeat(100_000)],
    ['300 000 invisible operators', '\u2062\u2064'.repeat(150_000)],
  ])('%s', (_, text) => {
    expect(medianMs(() => cleanHidden(text, RULES), 3)).toBeLessThan(1500);
  });

  it('scales roughly linearly on nested overrides', () => {
    const small = '\u202Ea'.repeat(25_000);
    const large = '\u202Ea'.repeat(100_000);
    cleanHidden(small, RULES);
    const [s, largeMs] = medianPairMs(
      () => cleanHidden(small, RULES),
      () => cleanHidden(large, RULES),
    );
    expect(largeMs / (s || 0.01)).toBeLessThan(10);
  });
});
