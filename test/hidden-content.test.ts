/**
 * Hidden content and 'remove-with-content' (docs/confusion-model.md §15), through
 * the report calls: each mark's kind, position and `extracted` hidden part.
 * Invisible characters are written as escapes; RTL samples are ordinary words.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  analyze,
  cleanHidden,
  FORMAT_CHAR_SCRIPTS,
  MARK_STACK_LIMITS,
  STRICT_HIDDEN_RULES,
  type AnalyzeOptions,
  type HiddenCharRules,
  type LostBound,
  type Mark,
  type OutputRecord,
  type Region,
} from '../src/index';
import { growth, LINEAR, timed } from './helpers/growth';

const REMOVE: HiddenCharRules = { ...STRICT_HIDDEN_RULES, bidiOverrides: 'remove-with-content' };

/** The kinds of the hidden-content constructs: payload runs, invisible runs, bidi spans, mark stacks. */
const CONTENT = new Set([
  'tags',
  'variationSelectors',
  'zeroWidthRun',
  'invisibleRun',
  'bidiOverrideSpan',
  'bidiReorderSpan',
  'markStacks',
  'markStacksOther',
]);

/** `cleanHidden` with every report call, region and output record collected. */
function clean(text: string, rules: Readonly<HiddenCharRules> = STRICT_HIDDEN_RULES) {
  const marks: Mark[] = [];
  const regions: Region[] = [];
  const records: OutputRecord[] = [];
  const cleaned = cleanHidden(text, rules, {
    onReport: (m) => void marks.push(m),
    onCleanup: (r) => void regions.push(r),
    onRecord: (r) => void records.push(r),
  });
  const content = marks.filter((m) => CONTENT.has(m.kind));
  return { cleaned, marks, regions, records, content };
}
/** `analyze` with its report calls collected. */
function analyzeReports(text: string, options: AnalyzeOptions = {}) {
  const marks: Mark[] = [];
  const r = analyze(text, options, { onReport: (m) => void marks.push(m) });
  return { ...r, marks, content: marks.filter((m) => CONTENT.has(m.kind)) };
}
const slice = (text: string, m: { start: number; length: number }) =>
  text.slice(m.start, m.start + m.length);
/** Output records that change the source. */
const changes = (text: string, records: readonly OutputRecord[]) =>
  records.filter((r) => r.text !== slice(text, r));
const spans = (r: { start: number; length: number }[]) => r.map((x) => [x.start, x.length]);

const tags = (s: string) =>
  [...s].map((c) => String.fromCodePoint(0xe0000 + c.codePointAt(0)!)).join('');
const vsByte = (b: number) => String.fromCodePoint(b < 16 ? 0xfe00 + b : 0xe0100 + b - 16);
const vsenc = (s: string) => [...new TextEncoder().encode(s)].map(vsByte).join('');
const bitsOf = (s: string, zero: string, one: string) =>
  [...new TextEncoder().encode(s)]
    .map((b) => b.toString(2).padStart(8, '0').replace(/0/g, zero).replace(/1/g, one))
    .join('');
/** Consumer-side decoding (decision 12a: the library reports the characters, not their reading). */
const untag = (s: string) =>
  [...s].map((c) => String.fromCharCode(c.codePointAt(0)! - 0xe0000)).join('');
const unvs = (s: string) =>
  new TextDecoder().decode(
    Uint8Array.from(
      [...s].map((c) => {
        const cp = c.codePointAt(0)!;
        return cp < 0xe0100 ? cp - 0xfe00 : cp - 0xe0100 + 16;
      }),
    ),
  );
const unbits = (s: string, zero: string) => {
  const bits = [...s].map((c) => (c === zero ? '0' : '1')).join('');
  const bytes = bits.match(/.{8}/g)!.map((b) => parseInt(b, 2));
  return new TextDecoder().decode(Uint8Array.from(bytes));
};
const corpus = (
  JSON.parse(readFileSync(join(__dirname, 'fixtures', 'cases.json'), 'utf8')) as { input: string }[]
).map((c) => c.input);

/** `RLO gnp.exe PDF` reads `exe.png` on screen. */
const SPOOFED_NAME = '\u202Egnp.exe\u202C';

describe('opt-in', () => {
  it('adds no result field', () => {
    const text = `a${SPOOFED_NAME}b${tags('hi')}`;
    expect(typeof cleanHidden(text)).toBe('string');
    const fields = [
      'changed',
      'counts',
      'dominantScript',
      'normalized',
      'signals',
      'spoofed',
      'words',
    ];
    expect(Object.keys(analyze(text, { hiddenChars: 'strict' })).sort()).toEqual(fields);
    expect(Object.keys(analyze(text)).sort()).toEqual(fields);
  });

  it('listening changes nothing in the output, across the corpus', () => {
    for (const input of corpus) {
      const c = clean(input);
      expect(c.cleaned).toBe(cleanHidden(input));
      expect(c.records.map((r) => r.text).join('')).toBe(c.cleaned);
    }
  });

  it("bidi-overridden text is reported under 'keep' and stays in the output", () => {
    const c = clean(`a ${SPOOFED_NAME} b`);
    expect(c.cleaned).toBe('a gnp.exe b');
    expect(c.content).toEqual([
      { kind: 'bidiOverrideSpan', start: 2, length: 9, extracted: 'gnp.exe', count: 9 },
    ]);
    // Only the two controls go.
    expect(spans(c.regions)).toEqual([
      [2, 1],
      [10, 1],
    ]);
  });
});

describe('encoded payloads', () => {
  it('tag characters: the tag characters themselves (decision 12a), offsets into the input', () => {
    const hidden = tags('Ignore all');
    const input = `Looks fine${hidden} ok`;
    const c = clean(input);
    expect(c.content).toEqual([
      { kind: 'tags', start: 10, length: hidden.length, extracted: hidden, count: 10 },
    ]);
    expect(slice(input, c.content[0]!)).toBe(hidden);
    expect(untag(c.content[0]!.extracted!)).toBe('Ignore all');
    expect(c.cleaned).toBe('Looks fine ok');
  });

  it('variation selectors after an emoji: the selectors themselves (decision 12a)', () => {
    const c = clean(`😀${vsenc('hi there')}`);
    expect(c.content).toMatchObject([
      { kind: 'variationSelectors', start: 2, count: 8, extracted: vsenc('hi there') },
    ]);
    expect(unvs(c.content[0]!.extracted!)).toBe('hi there');
    expect(c.cleaned).toBe('😀');
  });

  it('variation selectors without text: the selectors themselves, no hex (decision 12a)', () => {
    const c = clean('a\uFE01\uFE02\uFE03');
    expect(c.content).toMatchObject([
      { kind: 'variationSelectors', extracted: '\uFE01\uFE02\uFE03' },
    ]);
  });

  it('a valid first selector stays; the rest is reported and removed', () => {
    const input = '辻\u{E0100}\u{E0101}\u{E0102}';
    const c = clean(input);
    expect(c.cleaned).toBe('辻\u{E0100}');
    // extracted (decision 12a): the selectors the mark removes, not the kept one.
    expect(c.content).toEqual([
      {
        kind: 'variationSelectors',
        start: 3,
        length: 4,
        extracted: '\u{E0101}\u{E0102}',
        count: 2,
      },
    ]);
    expect(spans(c.regions)).toEqual([[3, 4]]);
  });

  it('a lone valid selector and an RGI sequence are not hidden', () => {
    const flag = `🏴${tags('gbsct')}\u{E007F}`;
    for (const s of ['辻\u{E0100}', '❤\uFE0F', flag, '👨\u200D👩\u200D👧', '1\uFE0F⃣']) {
      expect(clean(s).marks).toEqual([]);
    }
  });

  it("zero-width binary: the run's characters (decision 12a)", () => {
    const run = bitsOf('pwn', '\u200B', '\u200C');
    const c = clean(`ok ${run} ok`);
    expect(c.content).toEqual([
      { kind: 'zeroWidthRun', start: 3, length: 24, extracted: run, count: 24 },
    ]);
    expect(unbits(c.content[0]!.extracted!, '\u200B')).toBe('pwn');
  });

  it('a zero-width run with no byte reading is still reported, its characters extracted', () => {
    const c = clean('a\u200B\u200C\u200D\u2060b');
    // D29: a carrier mark's extracted part is its characters.
    expect(c.content).toEqual([
      {
        kind: 'zeroWidthRun',
        start: 1,
        length: 4,
        extracted: '\u200B\u200C\u200D\u2060',
        count: 4,
      },
    ]);
    expect(c.cleaned).toBe('ab');
  });

  it('reported under keep, and nothing removed', () => {
    const input = `a${tags('hi')}`;
    const c = clean(input, { ...STRICT_HIDDEN_RULES, tags: 'keep' });
    expect(c.cleaned).toBe(input);
    expect(c.content).toMatchObject([{ kind: 'tags', extracted: tags('hi') }]);
    expect(c.regions).toEqual([]);
    expect(changes(input, c.records)).toEqual([]);
  });

  it("'remove-with-content' on a payload rule is 'remove-counted'", () => {
    const input = `a${tags('hi')}${vsenc('yo')} ${bitsOf('x', '\u200B', '\u200C')}`;
    const c = clean(input, {
      ...STRICT_HIDDEN_RULES,
      tags: 'remove-with-content',
      variationSelectors: 'remove-with-content',
      zeroWidthRun: 'remove-with-content',
    });
    const plain = clean(input);
    expect(c.cleaned).toBe(plain.cleaned);
    expect(c.records).toEqual(plain.records);
    expect(c.marks).toEqual(plain.marks);
    expect(c.content.map((m) => m.extracted)).toEqual([
      tags('hi'),
      vsenc('yo'),
      bitsOf('x', '\u200B', '\u200C'),
    ]);
  });

  it('a very long tag run is reported in chunks of constructLimit code points (42e, 12a)', () => {
    const c = clean(`a${tags('x').repeat(300_000)}`);
    expect(c.content).toHaveLength(Math.ceil(300_000 / 4096));
    expect(c.content.every((m) => m.extracted!.length <= 2 * 4096)).toBe(true);
    expect(c.content.map((m) => m.extracted).join('')).toBe(tags('x').repeat(300_000));
  });
});

describe('other hidden constructs', () => {
  it('one carrier per letter: a mark per carrier, at its own range', () => {
    // D29: joining scattered carriers into one payload is the consumer's.
    const input = `h${vsenc('s')}e${vsenc('e')}l${vsenc('c')}lo`;
    const c = clean(input);
    expect(c.cleaned).toBe('hello');
    expect(c.content.map((m) => [m.kind, slice(input, m), m.extracted])).toEqual([
      // Decision 12a: each carrier's extracted part is its selector.
      ['variationSelectors', vsenc('s'), vsenc('s')],
      ['variationSelectors', vsenc('e'), vsenc('e')],
      ['variationSelectors', vsenc('c'), vsenc('c')],
    ]);
  });

  it('one tag per word: a mark per run, each its tag characters (decision 12a)', () => {
    const c = clean(`one${tags('a')} two${tags('b')} three${tags('c')}`);
    expect(c.content.map((m) => [m.kind, m.extracted])).toEqual([
      ['tags', tags('a')],
      ['tags', tags('b')],
      ['tags', tags('c')],
    ]);
    expect(c.cleaned).toBe('one two three');
  });

  it('runs far apart, or long, are marks of their own', () => {
    const far = clean(`a${tags('x')}${' word'.repeat(20)}${tags('y')}`);
    expect(far.content.map((e) => untag(e.extracted!))).toEqual(['x', 'y']);
    const long = clean(`a${tags('one')} b${tags('two')}`);
    expect(long.content.map((e) => untag(e.extracted!))).toEqual(['one', 'two']);
  });

  it('a lone orphan selector is reported and removed, the selector itself (decision 12a)', () => {
    const c = clean('x\u{E0110}');
    expect(c.content).toEqual([
      { kind: 'variationSelectors', start: 1, length: 2, extracted: '\u{E0110}', count: 1 },
    ]);
    expect(c.cleaned).toBe('x');
  });

  it('bits in invisible operators: an invisible run, its characters (decision 12a)', () => {
    const run = bitsOf('hi', '\u2062', '\u2064');
    const c = clean(`a${run}b`);
    expect(c.content).toEqual([
      { kind: 'invisibleRun', start: 1, length: 16, extracted: run, count: 16 },
    ]);
    expect(unbits(c.content[0]!.extracted!, '\u2062')).toBe('hi');
    expect(c.cleaned).toBe('ab');
  });

  it('bits in fillers and in soft hyphens with a grapheme joiner: their characters (decision 12a)', () => {
    const fill = bitsOf('hi', '\u3164', '\uFFA0');
    const shy = bitsOf('hi', '\u00AD', '\u034F');
    expect(clean(fill).content[0]!.extracted).toBe(fill);
    expect(clean(`a${shy}`).content[0]!.extracted).toBe(shy);
    expect(unbits(shy, '\u00AD')).toBe('hi');
  });

  it('a mixed invisible run with no bit reading is reported with its characters', () => {
    const c = clean('a\u2062\u200B\u2064\u00ADb');
    expect(c.content).toMatchObject([
      { kind: 'invisibleRun', length: 4, extracted: '\u2062\u200B\u2064\u00AD' },
    ]);
  });

  it('a run shorter than the threshold is no invisible run', () => {
    // D28a: threshold 2, so three carriers in a row are a run.
    expect(clean('a\u2062\u2064\u2062b').content).toMatchObject([
      { kind: 'invisibleRun', start: 1, length: 3 },
    ]);
    expect(
      clean('a\u2062\u2064\u2062b', { ...STRICT_HIDDEN_RULES, zeroWidthRunThreshold: 4 }).content,
    ).toEqual([]);
  });

  it('default-ignorable code points outside the named classes count as other invisibles', () => {
    for (const cp of [0x2065, 0xfff0, 0xfff8, 0xe0080, 0xe00ff, 0xe01f0, 0xe0fff]) {
      const c = clean(`a${String.fromCodePoint(cp)}b`);
      expect(c.cleaned).toBe('ab');
      expect(c.marks.map((m) => [m.kind, m.count])).toEqual([['otherInvisibles', 1]]);
    }
    expect(cleanHidden('a\u{E0080}b', { ...STRICT_HIDDEN_RULES, otherInvisibles: 'keep' })).toBe(
      'a\u{E0080}b',
    );
  });

  it('bits in them are an invisible run', () => {
    const run = bitsOf('hi', '\u{E0080}', '\u{E0081}');
    const c = clean(`a${run}b`);
    expect(c.content).toMatchObject([{ kind: 'invisibleRun', extracted: run }]);
    expect(c.cleaned).toBe('ab');
  });

  it('every Default_Ignorable code point is either judged or reported', () => {
    const uncovered: string[] = [];
    for (let cp = 0; cp <= 0xe0fff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const ch = String.fromCodePoint(cp);
      if (!/\p{Default_Ignorable_Code_Point}/u.test(ch)) continue;
      if (clean(`${ch} a`).marks.length === 0) uncovered.push(cp.toString(16));
    }
    expect(uncovered).toEqual([]);
  });
});

describe('bidi spans against the renderer (docs/evidence/bidi-spans.json)', () => {
  const samples = JSON.parse(
    readFileSync(join(__dirname, '..', 'docs', 'evidence', 'bidi-spans.json'), 'utf8'),
  ) as { name: string; input: string; dir: string; shown: string; natural: string }[];

  it('has the samples', () => {
    expect(samples.length).toBe(50);
  });

  /** Shown differently, reported on purpose as not hidden. */
  const NOT_HIDDEN = new Set([
    // Only a neutral moves, no letter or digit.
    'rle_latin_punct',
    // The LRO keeps a number as written, against the digit groups' natural swap in RTL text.
    'lro_number_in_he',
    // An RTL isolate around real RTL letters: ordinary mixed-direction text, swapped as its author set it.
    'rli_he_mixed',
  ]);

  for (const s of samples) {
    it(`${s.name}: reported iff Chrome shows another order in the text's own direction`, () => {
      const reported = clean(s.input).marks.some(
        (m) => m.kind === 'bidiOverrideSpan' || m.kind === 'bidiReorderSpan',
      );
      expect(s.shown !== s.natural).toBe(reported || NOT_HIDDEN.has(s.name));
      expect(reported && NOT_HIDDEN.has(s.name)).toBe(false);
    });
  }
});

describe('spans', () => {
  const span = (input: string) => {
    const e = clean(input).marks.filter((m) => m.kind === 'bidiOverrideSpan');
    expect(e.length).toBeLessThanOrEqual(1);
    return e[0] ? slice(input, e[0]) : null;
  };

  it('ends at its PDF, which belongs to it', () => {
    expect(span('a\u202Ebc\u202Cd')).toBe('\u202Ebc\u202C');
  });

  it.each([
    ['LF', '\n'],
    ['CR', '\r'],
    ['U+2029', '\u2029'],
    ['NEL', '\u0085'],
    ['FS', '\u001C'],
    ['GS', '\u001D'],
    ['RS', '\u001E'],
  ])('ends before a paragraph separator: %s', (_, sep) => {
    const input = `a\u202Ebc${sep}de`;
    const c = clean(input, REMOVE);
    const [e] = c.marks.filter((m) => m.kind === 'bidiOverrideSpan');
    expect(slice(input, e!)).toBe('\u202Ebc');
    expect(e!.extracted).toBe('bc');
    expect(c.cleaned.endsWith('de')).toBe(true);
    expect(c.cleaned.startsWith('a')).toBe(true);
    expect(c.cleaned).not.toContain('bc');
  });

  it('runs on over a line separator and a tab, which do not end a paragraph', () => {
    expect(span('\u202Eab\u2028cd')).toBe('\u202Eab\u2028cd');
    expect(span('\u202Eab\tcd')).toBe('\u202Eab\tcd');
  });

  it('runs to the end of the text when unterminated', () => {
    expect(span('x\u202Eabc')).toBe('\u202Eabc');
  });

  it('a PDF inside an isolate cannot close an override outside it', () => {
    expect(span('\u202Eab\u2066c\u202Cd\u2069ef\u202Cg')).toBe(
      '\u202Eab\u2066c\u202Cd\u2069ef\u202C',
    );
  });

  it('a PDI closes an override opened inside its isolate, before the PDI', () => {
    expect(span('\u2066a\u202Ebc\u2069de')).toBe('\u202Ebc');
  });

  it('a stray PDF or PDI closes nothing', () => {
    expect(span('\u202Cab\u2069c\u202Ede')).toBe('\u202Ede');
  });

  it('nested: the outermost that reverses, with the inner controls in it', () => {
    const input = '\u202Eab \u202Ecd\u202C ef\u202Cg';
    expect(span(input)).toBe('\u202Eab \u202Ecd\u202C ef\u202C');
    expect(clean(input).marks.find((m) => m.kind === 'bidiOverrideSpan')!.extracted).toBe(
      'ab cd ef',
    );
  });

  it('an inner reversal in an outer span that agrees: only the inner', () => {
    expect(span('\u202Eשלום \u202Eabc\u202C עולם\u202C')).toBe('\u202Eabc\u202C');
    expect(cleanHidden('\u202Eשלום \u202Eabc\u202C עולם\u202C', REMOVE)).toBe('שלום עולם');
  });

  it('offsets survive controls removed before the span', () => {
    const input = 'ok\u001B[31m \u0008\u202Eabc\u202C end';
    const c = clean(input, REMOVE);
    const e = c.marks.find((m) => m.kind === 'bidiOverrideSpan')!;
    expect(slice(input, e)).toBe('\u202Eabc\u202C');
    expect(c.cleaned).toBe('ok end');
  });

  it('a control inside the span is part of it', () => {
    const input = '\u202Ea\u0007bc\u202Cd';
    const c = clean(input, REMOVE);
    expect(c.cleaned).toBe('d');
    // One region; its output may come as several records (D9).
    expect(c.regions).toEqual([{ start: 0, length: 6, original: input.slice(0, 6) }]);
    expect(c.marks.find((m) => m.kind === 'bidiOverrideSpan')).toMatchObject({
      start: 0,
      length: 6,
      extracted: 'abc',
    });
  });
});

describe("bidiOverrides: 'remove-with-content'", () => {
  it('removes the reversed span with its controls', () => {
    const input = `Open ${SPOOFED_NAME} now`;
    const c = clean(input, REMOVE);
    expect(c.cleaned).toBe('Open now');
    expect(c.regions).toEqual([{ start: 5, length: 9, original: SPOOFED_NAME }]);
    // The seam rule (D11) drops the space after the span: a record of its own.
    expect(changes(input, c.records).at(-1)).toEqual({ start: 14, length: 1, text: '' });
    // Merge order (D4/D8): at one start the control precedes the span.
    expect(c.marks.map((m) => [m.kind, m.start, m.count, m.extracted])).toEqual([
      ['bidiOverrides', 5, 1, '\u202E'],
      ['bidiOverrideSpan', 5, 9, 'gnp.exe'],
      ['bidiOverrides', 13, 1, '\u202C'],
    ]);
    const words = analyze(input, {
      hiddenChars: 'strict',
      hiddenCharRules: { bidiOverrides: 'remove-with-content' },
    }).words;
    expect(words.map((w) => [w.index, w.word, w.signals])).toEqual([
      [5, SPOOFED_NAME, ['invisible']],
    ]);
  });

  it('removes an unterminated span to the end of the line only', () => {
    expect(cleanHidden('invoice\u202Egnp.exe\nnext line', REMOVE)).toBe('invoice\nnext line');
  });

  it('removes a Trojan Source tail, isolates inside it included', () => {
    const c = clean('if (x != "user\u202E \u2066// admin\u2069 \u2066") {\nnext', REMOVE);
    expect(c.cleaned).toBe('if (x != "user\nnext');
    expect(c.marks.find((m) => m.kind === 'bidiOverrideSpan')!.extracted).toBe(' // admin ") {');
  });

  it('a payload inside the span is reported and gone, in one region', () => {
    const input = `a\u202Ebc${tags('hi')}d\u202Cz`;
    const c = clean(input, REMOVE);
    expect(c.cleaned).toBe('az');
    expect(spans(c.regions)).toEqual([[1, 9]]);
    expect(c.content.map((m) => [m.kind, m.extracted])).toEqual([
      ['bidiOverrideSpan', `bc${tags('hi')}d`],
      ['tags', tags('hi')],
    ]);
  });

  it('text with no span keeps its letters and only loses the controls', () => {
    const input = '\u202Dhello\u202C \u202Bworld\u202C';
    const c = clean(input, REMOVE);
    expect(c.content).toEqual([]);
    expect(c.records).toEqual(clean(input).records);
    expect(c.cleaned).toBe('hello world');
  });

  it('counts through analyze: spoofed, a finding, offsets on the input', () => {
    const input = `safe ${SPOOFED_NAME} wоrds`;
    const r = analyzeReports(input, {
      hiddenChars: 'strict',
      confusionModel: 'language',
      hiddenCharRules: { bidiOverrides: 'remove-with-content' },
    });
    expect(r.normalized).toBe('safe words');
    expect(r.spoofed).toBe(true);
    expect(r.words.filter((w) => w.signals.includes('invisible'))).toHaveLength(1);
    expect(r.content).toMatchObject([{ kind: 'bidiOverrideSpan', extracted: 'gnp.exe' }]);
    for (const w of r.words) expect(input.slice(w.index, w.index + w.word.length)).toBe(w.word);
    expect(r.words.map((w) => w.word)).toEqual([SPOOFED_NAME, 'wоrds']);
  });

  it('analyze keeps controls to its own signals; a span still ends at a separator', () => {
    const r = analyzeReports('a\u202Ebc\u0085de', {
      hiddenChars: 'strict',
      hiddenCharRules: { bidiOverrides: 'remove-with-content' },
    });
    expect(r.content).toMatchObject([{ start: 1, length: 3, extracted: 'bc' }]);
  });

  it('analyze with a report callback: the marks, output as without', () => {
    const input = `x${tags('hi')} ${SPOOFED_NAME}`;
    const plain = analyze(input, { hiddenChars: 'strict' });
    const r = analyzeReports(input, { hiddenChars: 'strict' });
    expect(r.normalized).toBe(plain.normalized);
    expect(r.content.map((m) => m.kind)).toEqual(['tags', 'bidiOverrideSpan']);
  });
});

describe('legitimate right-to-left text survives', () => {
  /** [what, input, cleaned]: no entry, every letter and digit kept. */
  const LEGIT: [string, string, string][] = [
    ['Hebrew', 'שלום עולם', 'שלום עולם'],
    ['Arabic', 'مرحبا بالعالم', 'مرحبا بالعالم'],
    ['Arabic with tashkeel', 'مَرْحَبًا', 'مَرْحَبًا'],
    ['Persian ZWNJ', 'می\u200Cخواهم کتاب', 'می\u200Cخواهم کتاب'],
    ['mixed direction, Hebrew first', 'שלום world עולם 123', 'שלום world עולם 123'],
    ['mixed direction, Latin first', 'hello שלום world مرحبا', 'hello שלום world مرحبا'],
    ['Hebrew with RLM', 'שלום\u200F עולם', 'שלום\u200F עולם'],
    ['Arabic with ALM', 'مرحبا\u061C بالعالم', 'مرحبا\u061C بالعالم'],
    ['isolate in Latin', 'abc \u2067שלום\u2069 def', 'abc \u2067שלום\u2069 def'],
    ['mixed isolate', 'user \u2067שלום world\u2069 left', 'user \u2067שלום world\u2069 left'],
    ['FSI around Arabic', 'x \u2068مرحبا\u2069 y', 'x \u2068مرحبا\u2069 y'],
    ['RLO on Hebrew', '\u202Eשלום עולם\u202C', 'שלום עולם'],
    ['RLO on Arabic', '\u202Eمرحبا بالعالم\u202C', 'مرحبا بالعالم'],
    ['RLO on Arabic with tashkeel', '\u202Eمَرْحَبًا\u202C', 'مَرْحَبًا'],
    ['RLO on Hebrew with one Latin letter', '\u202Eשלום a עולם\u202C', 'שלום a עולם'],
    ['RLO on Hebrew with one digit', '\u202Eמחיר 5\u202C', 'מחיר 5'],
    ['LRO around a number in Hebrew', 'טל \u202D+972-50-1234567\u202C ok', 'טל +972-50-1234567 ok'],
    ['LRO around a date in Arabic', 'يوم \u202D12/05/2024\u202C', 'يوم 12/05/2024'],
    ['LRO on Latin in Hebrew', 'שלום \u202Dabc def\u202C עולם', 'שלום abc def עולם'],
    ['RLO with a nested LRO number', '\u202Eالسعر \u202D100\u202C ريال\u202C', 'السعر 100 ريال'],
    ['RLE on Hebrew', '\u202Bשלום עולם\u202C', 'שלום עולם'],
    ['RLE on Arabic', '\u202Bمرحبا بالعالم\u202C', 'مرحبا بالعالم'],
    ['RLE on mixed Hebrew', '\u202Bשלום world עולם\u202C', 'שלום world עולם'],
    ['RLE on mixed Arabic', '\u202Bنص English نص\u202C', 'نص English نص'],
    ['RLE with digits', '\u202Bמחיר 100\u202C', 'מחיר 100'],
    ['RLE on Latin', '\u202Bhello world\u202C', 'hello world'],
    ['LRE in Arabic', 'السعر \u202A100\u202C ريال', 'السعر 100 ريال'],
    ['LRE on mixed', '\u202Aabc שלום def\u202C', 'abc שלום def'],
  ];

  it.each(LEGIT)('%s', (_, input, cleaned) => {
    const c = clean(input, REMOVE);
    expect(c.content).toEqual([]);
    expect(c.cleaned).toBe(cleaned);
  });

  it('marks piled up in RTL text are no run', () => {
    const input = 'שלום\u200F\u200F\u200F\u200F עולם';
    const c = clean(input, REMOVE);
    expect(c.content).toEqual([]);
    expect(c.cleaned).toBe(input);
  });

  it('the same marks in text of Latin letters are one', () => {
    const c = clean('abc\u200E\u200F\u200E\u200F def', REMOVE);
    expect(c.content).toMatchObject([{ kind: 'invisibleRun', start: 3, length: 4 }]);
    expect(c.cleaned).toBe('abc def');
  });

  /** [what, input, logical text]: letters against the override, shown reversed. */
  const REVERSED: [string, string, string][] = [
    ['Hebrew under LRO', '\u202Dשלום\u202C', 'שלום'],
    ['Arabic under LRO', '\u202Dمرحبا\u202C', 'مرحبا'],
    ['a word of Latin letters under RLO in Hebrew', '\u202Eשלום world\u202C', 'שלום world'],
    ['a word of Latin letters under RLO in Arabic', '\u202Eمرحبا world\u202C', 'مرحبا world'],
    ['a price under RLO', '\u202Eמחיר 100\u202C', 'מחיר 100'],
    ['Arabic digits under RLO', '\u202Eالسعر ١٠٠\u202C', 'السعر ١٠٠'],
  ];

  it.each(REVERSED)('%s goes, with its logical text reported', (_, input, text) => {
    const c = clean(input, REMOVE);
    expect(c.content).toMatchObject([{ kind: 'bidiOverrideSpan', extracted: text }]);
    expect(c.cleaned).toBe('');
  });
});

describe('U+061C and the bidi mark rules', () => {
  it('alone it is no RTL text: marks in text of Latin letters go', () => {
    const c = clean('abc\u061C def\u200E x');
    expect(c.cleaned).toBe('abc def x');
    expect(c.marks.map((m) => [m.kind, m.start])).toEqual([
      ['bidiMarks', 3],
      ['bidiMarks', 8],
    ]);
    const r = analyze('abc\u061C def\u200E x', { hiddenChars: 'strict' });
    expect(r.words.filter((w) => w.signals.includes('invisible'))).toHaveLength(2);
    expect(cleanHidden('\u061C')).toBe('');
    expect(cleanHidden('\u202Babc\u061C def\u202C')).toBe('abc def');
    expect(analyze('abc\u061C def', { hiddenChars: 'strict' }).normalized).toBe('abc def');
    expect(analyze('abc\u061C def', { hiddenChars: 'strict' }).signals.invisible).toBe(true);
  });

  it.each([
    ['Arabic with ALM', 'مرحبا\u061C بالعالم'],
    ['Arabic with ALM and RLM', 'السعر\u061C 100\u200F ريال'],
    ['Persian with ALM', 'می\u200Cخواهم\u061C کتاب'],
    ['Latin with ALM beside Arabic', 'abc\u061C def مرحبا'],
    ['Hebrew with ALM', 'שלום\u061C עולם'],
    ['isolate around Arabic', 'abc \u2067مرحبا\u061C\u2069 def'],
  ])('%s keeps its marks', (_, input) => {
    expect(cleanHidden(input)).toBe(input);
    expect(analyze(input, { hiddenChars: 'strict' }).normalized).toBe(input);
  });
});

describe('embeddings and marks are never removed with content', () => {
  it('an RLM that swaps words of Latin letters is reported; the words stay', () => {
    const c = clean('\u202Babc\u200F def\u202C', REMOVE);
    expect(c.content).toEqual([
      { kind: 'bidiReorderSpan', start: 0, length: 10, extracted: 'abc def', count: 10 },
    ]);
    expect(c.cleaned).toBe('abc def');
  });

  it('so does one in an isolate, whose controls the mark rule removes', () => {
    const c = clean('\u2067abc\u200F def\u2069', REMOVE);
    expect(c.content).toMatchObject([{ kind: 'bidiReorderSpan', extracted: 'abc def' }]);
    expect(c.cleaned).toBe('abc def');
  });

  it('with an RTL letter in the span it is ordinary mixed text', () => {
    expect(clean('\u202Babc\u200F שלום def\u202C', REMOVE).content).toEqual([]);
  });
});

describe('words broken by zero-width characters', () => {
  /** [what, input, cleaned, kind]: rejoined, no content, no letter lost. */
  it.each([
    ['ZWSP', 'fr\u200Bee', 'free', 'zeroWidthInWord'],
    ['one per letter', 'f\u200Br\u200Be\u200Be', 'free', 'zeroWidthInWord'],
    // D27: a possible ligature break, a kind of its own.
    ['ZWNJ in German', 'Auf\u200Clage', 'Auflage', 'possibleLigatureBreak'],
    ['ZWJ', 'pay\u200Dpal', 'paypal', 'joinerInWord'],
    ['word joiner', 'pay\u2060pal', 'paypal', 'zeroWidthInWord'],
    ['soft hyphen', 'co\u00ADoperate', 'cooperate', 'softHyphen'],
  ])('%s: the character goes, the word stays', (_, input, cleaned, kind) => {
    const c = clean(input, REMOVE);
    expect(c.cleaned).toBe(cleaned);
    expect(c.content).toEqual([]);
    expect(new Set(c.marks.map((m) => m.kind))).toEqual(new Set([kind]));
  });

  it('three in a row: a run, and its letters still stay', () => {
    // D28a: threshold 2, so three zero-width characters in a row are a run.
    const c = clean('fr\u200B\u200B\u200Bee', REMOVE);
    expect(c.cleaned).toBe('free');
    expect(c.content).toMatchObject([{ kind: 'zeroWidthRun', start: 2, length: 3 }]);
  });

  it('a run at the threshold is content, and its letters still stay', () => {
    const c = clean('fr\u200B\u200B\u200B\u200Bee', REMOVE);
    expect(c.cleaned).toBe('free');
    expect(c.content).toMatchObject([{ kind: 'zeroWidthRun', start: 2, length: 4 }]);
  });

  it("no zero-width rule takes the action: 'remove-with-content' there is rejected", () => {
    const rules: HiddenCharRules = {
      ...STRICT_HIDDEN_RULES,
      // @ts-expect-error -- only content rules take 'remove-with-content'
      zeroWidthInWord: 'remove-with-content',
    };
    expect(() => clean('fr\u200Bee', rules)).toThrow(RangeError);
  });
});

describe('mark stacks', () => {
  /** Real writing: every mark stays, nothing is reported, with no option and through analyze. */
  const REAL: [string, string][] = [
    ['Thai', 'สวัสดี ที่นี่ น้ำ ผู้ใหญ่ กี้ สิทธิ์ ฟื้น เพื่อน'],
    ['Lao', 'ສະບາຍດີ ຜູ້ ເຮື້ອ'],
    ['Arabic with tashkeel', 'مَرْحَبًا شَدَّةٌ مُحَمَّدٌ'],
    ['Quran', 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ ذَٰلِكَ ٱلْكِتَـٰبُ لَا رَيْبَ \u06DB فِيهِ \u06DB'],
    ['Quran, sajda and madda', 'ٱلصَّٰلِحَٰتِ جَآءَ سُوٓءَ يَسْجُدُونَ ۩ وَٱلسَّمَآءِ'],
    ['Persian', 'می\u200Cخواهم کِتاب'],
    ['Hebrew with points', 'שָׁלוֹם עוֹלָם'],
    ['Hebrew, Genesis with cantillation', 'בְּרֵאשִׁ֖ית בָּרָ֣א אֱלֹהִ֑ים אֵ֥ת הַשָּׁמַ֖יִם'],
    ['Hebrew, dagesh, shin dot, vowel, accent, meteg', 'שָּֽׁ֣'],
    ['Tibetan', 'བསྒྲུབས་པ་ བོད་ཡིག ཧཱུྃ'],
    ['Tibetan, Kalachakra mantra stack', 'ཧྐྵྨླྭྲྱཱྃ'],
    ['Devanagari', 'नमस्ते स्त्रीं क्ष्म्य हिन्दी'],
    ['Vedic accents', 'अ॒ग्निमी॑ळे पु॒रोहि॑तं'],
    ['Devanagari, nukta, vowel, candrabindu, svara', 'क़ुँ॑'],
    ['Bengali', 'বাংলা স্ত্রী কৃষ্ণ'],
    ['Tamil', 'தமிழ் ஸ்ரீ'],
    ['Telugu', 'తెలుగు శ్రీ'],
    ['Kannada', 'ಕನ್ನಡ ಶ್ರೀ'],
    ['Malayalam', 'മലയാളം ശ്രീ'],
    ['Sinhala', 'සිංහල ශ්\u200Dරී'],
    ['Myanmar', 'မြန်မာ ကျွန်ုပ် ခြွေ'],
    ['Khmer', 'ភាសាខ្មែរ ស្ត្រី'],
    ['Syriac', 'ܫܠܵܡܵܐ'],
    ['Vietnamese, NFC', 'Việt Nam người ệ ẫ ặ ở'],
    ['Vietnamese, NFD', 'Việt Nam người ệ ẫ ặ ở'.normalize('NFD')],
    ['Yoruba, NFD', 'ọ̀ ẹ́ ṣé'.normalize('NFD')],
    ['Czech and French, NFD', 'příliš žluťoučký crème'.normalize('NFD')],
    ['Church Slavonic', 'бг҃ъ а҆́'],
    ['Japanese with a combining sound mark', 'か\u3099 は\u309A'],
    ['emoji sequences', '1\uFE0F\u20E3 👨\u200D👩\u200D👧 ❤\uFE0F'],
  ];

  it.each(REAL)('%s is left alone', (_, input) => {
    const c = clean(input);
    expect(c.content).toEqual([]);
    expect(c.cleaned).toBe(input);
    const r = analyzeReports(input, { hiddenChars: 'strict' });
    expect(r.normalized).toBe(input);
    expect(r.signals.zalgo).toBe(false);
    expect(r.content).toEqual([]);
  });

  it('polytonic Greek in NFD fits its limit', () => {
    const input = 'ᾅ ᾧ ἄνθρωπος'.normalize('NFD');
    const c = clean(input);
    expect(c.cleaned).toBe(input);
    expect(c.content).toEqual([]);
  });

  it('the limits cover every script the exemption names', () => {
    for (const s of FORMAT_CHAR_SCRIPTS) expect(MARK_STACK_LIMITS[s]).toBeGreaterThanOrEqual(3);
  });

  /** [what, base, mark, limit]. */
  const OVER: [string, string, string, number][] = [
    ['Thai', 'ส', '\u0E49', 3],
    ['Lao', 'ສ', '\u0EC9', 3],
    ['Arabic', 'س', '\u064E', 5],
    ['Hebrew', 'ש', '\u0591', 5],
    ['Devanagari', 'न', '\u0951', 5],
    ['Tibetan', 'བ', '\u0FB2', 10],
    ['Latin', 'a', '\u0301', 2],
    ['Cyrillic', 'я', '\u0301', 2],
    ['Greek', 'α', '\u0301', 3],
    ['a digit', '1', '\u0301', 2],
    ['a script not named', 'ᬩ', '\u1B6B', 5],
  ];
  /** Bases that are not Latin, Cyrillic, Greek or a digit go by `markStacks`, the rest by `markStacksOther`. */
  const OTHER = new Set(['Latin', 'Cyrillic', 'Greek', 'a digit']);

  it.each(OVER)('%s: trimmed to its limit, reported', (what, base, mark, limit) => {
    const input = `x ${base}${mark.repeat(40)} y`;
    const c = clean(input);
    const kept = `${base}${mark.repeat(limit)}`;
    expect(c.cleaned).toBe(`x ${kept} y`);
    // The mark covers the marks past the limit; extracted (decision 12a): those marks.
    expect(c.content).toEqual([
      {
        kind: OTHER.has(what) ? 'markStacksOther' : 'markStacks',
        start: 2 + kept.length,
        length: 40 - limit,
        extracted: mark.repeat(40 - limit),
        count: 40 - limit,
      },
    ]);
  });

  it.each(OVER)(
    '%s: one mark past the limit is a stack, the limit is not',
    (_, base, mark, limit) => {
      expect(clean(`${base}${mark.repeat(limit)}`).content).toEqual([]);
      expect(clean(`${base}${mark.repeat(limit + 1)}`).content).toHaveLength(1);
    },
  );

  it('one RTL letter exempts nothing: marks answer to their own base', () => {
    const input = `ש${`a${'\u0301'.repeat(40)}`}`;
    expect(cleanHidden(input)).toBe('שa\u0301\u0301');
    const r = analyze(input, { hiddenChars: 'strict' });
    expect(r.signals.zalgo).toBe(true);
    // Decision 28b: phase 1 alone trims stacks; the marks within the limit stay.
    expect(r.normalized).toBe('שa\u0301\u0301'.normalize('NFC'));
  });

  it("through analyze the marks on a word's Hebrew letter survive zalgo on its Latin letter", () => {
    const r = analyze(`\u05E9\u05B8a${'\u0301'.repeat(5)}`, { hiddenChars: 'strict' });
    expect(r.signals.zalgo).toBe(true);
    expect(r.normalized).toContain('\u05B8');
    // Decision 28b: the Latin letter keeps the marks within its limit (2).
    expect(r.normalized).toBe('\u05E9\u05B8a\u0301\u0301'.normalize('NFC'));
  });

  it('lenient analyze leaves stacks on a stacking-script letter alone', () => {
    const input = `ส${'\u0E49'.repeat(40)}`;
    expect(analyze(input).normalized).toBe(input);
    expect(analyze(input).spoofed).toBe(false);
    // The exemption is judged per letter: a Hebrew letter does not exempt a
    // stack on the Latin letter next to it.
    expect(analyze(`ש${`a${'\u0301'.repeat(40)}`}`).signals.zalgo).toBe(true);
  });

  it('strict analyze trims a stacking script, as zalgo', () => {
    const stack = `ส${'\u0E49'.repeat(40)}`;
    const r = analyzeReports(`ok ${stack} ok`, { hiddenChars: 'strict' });
    expect(r.normalized).toBe('ok ส\u0E49\u0E49\u0E49 ok');
    expect(r.spoofed).toBe(true);
    expect(r.signals).toMatchObject({ zalgo: true, invisible: false });
    expect(r.words.map((w) => [w.index, w.word, w.signals])).toEqual([[3, stack, ['zalgo']]]);
    expect(r.content).toMatchObject([
      { kind: 'markStacks', start: 7, extracted: '\u0E49'.repeat(37) },
    ]);
  });

  it('strict analyze trims a Latin stack in phase 1 too, as zalgo (decision 28b)', () => {
    const r = analyzeReports(`ok a${'\u0301'.repeat(5)} ok`, { hiddenChars: 'strict' });
    expect(r.normalized).toBe('ok a\u0301\u0301 ok');
    expect(r.content).toMatchObject([{ kind: 'markStacksOther', extracted: '\u0301'.repeat(3) }]);
  });

  it('letter after letter: a mark per letter; the next word another', () => {
    const m = '\u0E49'.repeat(6);
    const c = clean(`ส${m}ว${m} ส${m}`);
    // Decision 12a: each mark's extracted part is the excess marks it removes.
    expect(c.content.map((e) => [e.start, e.extracted])).toEqual([
      [4, '\u0E49'.repeat(3)],
      [11, '\u0E49'.repeat(3)],
      [19, '\u0E49'.repeat(3)],
    ]);
  });

  it.each([
    ['CGJ', '\u034F'],
    ['ZWNJ', '\u200C'],
    ['ZWSP', '\u200B'],
    ['a selector', '\uFE0F'],
  ])('%s cannot split a stack', (_, sep) => {
    const input = `a${`\u0301\u0301${sep}`.repeat(10)}`;
    const c = clean(input);
    expect(c.cleaned).toBe('a\u0301\u0301');
    expect(c.content.map((e) => e.kind)).toContain('markStacksOther');
  });

  it('a kept mark-stack rule leaves the text and reports it', () => {
    const input = `ส${'\u0E49'.repeat(10)}`;
    const c = clean(input, { ...STRICT_HIDDEN_RULES, markStacks: 'keep' });
    expect(c.cleaned).toBe(input);
    expect(c.content).toMatchObject([{ kind: 'markStacks', extracted: '\u0E49'.repeat(7) }]);
    expect(c.regions).toEqual([]);
  });

  it('markStackLimits overrides a limit; remove-with-content removes', () => {
    const input = `ส${'\u0E49'.repeat(10)}`;
    const c = clean(input, {
      ...STRICT_HIDDEN_RULES,
      markStacks: 'remove-with-content',
      markStackLimits: { Thai: 1 },
    });
    expect(c.cleaned).toBe('ส\u0E49');
    expect(c.content).toMatchObject([{ kind: 'markStacks', extracted: '\u0E49'.repeat(9) }]);
  });

  it('a stack inside a removed bidi span joins its region', () => {
    const c = clean(`x\u202Eab${'\u0301'.repeat(9)}c\u202Cy`, REMOVE);
    expect(c.cleaned).toBe('xy');
    expect(c.regions).toHaveLength(1);
    expect(c.content.map((e) => e.kind)).toEqual(['bidiOverrideSpan', 'markStacksOther']);
  });

  it('regions stay ordered and non-overlapping with other rules, and records rebuild the text', () => {
    const input = `\u200Ba${'\u0301'.repeat(5)}\u200Bb${tags('x')}c${'\u0301'.repeat(5)}\u0007`;
    const c = clean(input);
    expect(c.cleaned).toBe('a\u0301\u0301bc\u0301\u0301');
    for (let i = 1; i < c.regions.length; i++) {
      const prev = c.regions[i - 1]!;
      expect(c.regions[i]!.start).toBeGreaterThanOrEqual(prev.start + prev.length);
    }
    let at = 0;
    for (const r of c.records) {
      expect(r.start).toBe(at);
      at += r.length;
    }
    expect(at).toBe(input.length);
    expect(c.records.map((r) => r.text).join('')).toBe(c.cleaned);
  });
});

describe('decision 42g: "in right-to-left text" is per bidi paragraph, strict and lenient', () => {
  const S = { hiddenChars: 'strict' } as const;
  it('a mark is kept when its paragraph has a right-to-left letter, before or after it', () => {
    expect(cleanHidden('abc ‏ def שלום')).toBe('abc ‏ def שלום');
    expect(cleanHidden('שלום abc ‏ def')).toBe('שלום abc ‏ def');
    // Another paragraph's letters do not count.
    expect(cleanHidden('abc ‏ def\n\nשלום')).toBe('abc def\n\nשלום');
    expect(cleanHidden('שלום\nabc ‏ def')).toBe('שלום\nabc def');
  });
  it('the lookahead reaches constructLimit code points (42e), each mark its own', () => {
    const far = 'abc ‏ ' + 'x '.repeat(3000) + 'שלום';
    expect(cleanHidden(far)).toBe(far.replace(' ‏', ''));
    expect(cleanHidden(far, { ...STRICT_HIDDEN_RULES, constructLimit: 10_000 })).toBe(far);
    expect(() => cleanHidden('x', { ...STRICT_HIDDEN_RULES, constructLimit: 0 })).toThrow(
      RangeError,
    );
  });
  timed(
    'linear on many paragraphs with a mark and no RTL letter, strict and default',
    () => {
      const t = (n: number) => 'hello\u200E world\n'.repeat(n) + 'שלום';
      expect(growth((n) => cleanHidden(t(n)), 5000)).toBeLessThan(LINEAR);
      expect(growth((n) => analyze(t(n)), 5000)).toBeLessThan(LINEAR);
      expect(growth((n) => analyze(t(n), S), 5000)).toBeLessThan(LINEAR);
    },
    30_000,
  );
  it('lenient (the default path): a mark in right-to-left text stays', () => {
    expect(analyze('שלום ‏ world').normalized).toBe('שלום ‏ world');
    expect(analyze('abc ‏ world').normalized).toBe('abc  world');
    expect(analyze('abc ‏ world\n\nשלום').normalized).toBe('abc  world\n\nשלום');
    expect(analyze('שלום ‏ world', S).normalized).toBe('שלום ‏ world');
  });
});

describe('decision 42e: limits of phase-1 constructs (constructLimit)', () => {
  it('a bidi frame not closed within constructLimit is closed there: a lost bound', () => {
    const l: LostBound[] = [];
    cleanHidden(
      `x \u202E${'ab '.repeat(10)}\u202C y`,
      { ...STRICT_HIDDEN_RULES, constructLimit: 5 },
      {
        onLostBound: (b) => void l.push(b),
      },
    );
    expect(l).toEqual([{ kind: 'bidiFrame', start: 2, length: 5 }]);
    l.length = 0;
    cleanHidden(`x \u202E${'ab '.repeat(10)}\u202C y`, STRICT_HIDDEN_RULES, {
      onLostBound: (b) => void l.push(b),
    });
    expect(l).toEqual([]);
  });
  it('a mojibake span reaches constructLimit code points; a longer one is a series of spans', () => {
    const spans = (limit?: number) => {
      const m: string[] = [];
      cleanHidden(
        'Ð¿Ñ€Ð¸Ð²ÐµÑ‚',
        { ...STRICT_HIDDEN_RULES, mojibake: 'keep', ...(limit && { constructLimit: limit }) },
        {
          onReport: (x) => void m.push(`${x.start}+${x.length}:${x.extracted}`),
        },
      );
      return m;
    };
    expect(spans()).toEqual(['0+12:привет']);
    expect(spans(6)).toEqual(['0+6:при', '6+6:вет']);
  });
  it('a long hidden run is a series of chunks, with no lost bound', () => {
    const l: LostBound[] = [];
    const marks: Mark[] = [];
    const out = cleanHidden('a' + '\u200b'.repeat(10_000) + 'b', STRICT_HIDDEN_RULES, {
      onLostBound: (b) => void l.push(b),
      onReport: (m) => void marks.push(m),
    });
    expect([out, l]).toEqual(['ab', []]);
    expect(marks.map((m) => m.length)).toEqual([4096, 4096, 1808]);
  });
});
