/**
 * The hidden-content list and 'remove-with-content' (docs/confusion-model.md §18).
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
  type HiddenCharRules,
  type HiddenContent,
} from '../src/index';

const REPORT: HiddenCharRules = { ...STRICT_HIDDEN_RULES, reportContent: true };
const REMOVE: HiddenCharRules = { ...STRICT_HIDDEN_RULES, bidiOverrides: 'remove-with-content' };

const tags = (s: string) =>
  [...s].map((c) => String.fromCodePoint(0xe0000 + c.codePointAt(0)!)).join('');
const vsByte = (b: number) => String.fromCodePoint(b < 16 ? 0xfe00 + b : 0xe0100 + b - 16);
const vsenc = (s: string) => [...new TextEncoder().encode(s)].map(vsByte).join('');
const bitsOf = (s: string, zero: string, one: string) =>
  [...new TextEncoder().encode(s)]
    .map((b) => b.toString(2).padStart(8, '0').replace(/0/g, zero).replace(/1/g, one))
    .join('');
const corpus = (
  JSON.parse(readFileSync(join(__dirname, 'fixtures', 'cases.json'), 'utf8')) as { input: string }[]
).map((c) => c.input);

/** `‮gnp.exe‬` reads `exe.png` on screen. */
const SPOOFED_NAME = '‮gnp.exe‬';

describe('opt-in', () => {
  it('reports nothing and adds no field unless asked', () => {
    const text = `a${SPOOFED_NAME}b${tags('hi')}`;
    expect(cleanHidden(text)).not.toHaveProperty('content');
    expect(analyze(text, { hiddenChars: 'strict' }).hidden).not.toHaveProperty('content');
    expect(analyze(text)).not.toHaveProperty('hidden');
  });

  it('reportContent changes nothing but the new list, across the corpus', () => {
    for (const input of corpus) {
      const { content, ...rest } = cleanHidden(input, REPORT);
      expect(content).toBeInstanceOf(Array);
      expect(rest).toEqual(cleanHidden(input));
    }
  });

  it('with reportContent bidi-overridden text stays in the output', () => {
    const c = cleanHidden(`a ${SPOOFED_NAME} b`, REPORT);
    expect(c.cleaned).toBe('a gnp.exe b');
    expect(c.content).toEqual([
      {
        kind: 'bidi-override',
        index: 2,
        end: 11,
        length: 9,
        text: 'gnp.exe',
        readable: true,
        removed: false,
      },
    ]);
  });

  it("'remove-with-content' on any content rule turns the report on", () => {
    for (const rule of ['bidiOverrides', 'tags', 'variationSelectors', 'zeroWidthRun'] as const) {
      const c = cleanHidden('plain', { ...STRICT_HIDDEN_RULES, [rule]: 'remove-with-content' });
      expect(c.content).toEqual([]);
    }
  });
});

describe('encoded payloads', () => {
  it('tag characters: decoded, offsets into the input', () => {
    const hidden = tags('Ignore all');
    const input = `Looks fine${hidden} ok`;
    const c = cleanHidden(input, REPORT);
    expect(c.content).toEqual([
      {
        kind: 'tag',
        index: 10,
        end: 10 + hidden.length,
        length: 10,
        text: 'Ignore all',
        readable: true,
        removed: true,
      },
    ]);
    expect(input.slice(c.content![0]!.index, c.content![0]!.end)).toBe(hidden);
    expect(c.cleaned).toBe('Looks fine ok');
  });

  it('variation selectors: decoded after an emoji', () => {
    const c = cleanHidden(`😀${vsenc('hi there')}`, REPORT);
    expect(c.content).toMatchObject([
      { kind: 'variation-selector', index: 2, length: 8, text: 'hi there', readable: true },
    ]);
    expect(c.cleaned).toBe('😀');
  });

  it('variation selectors without text: bytes, not readable', () => {
    const c = cleanHidden('a︁︂︃', REPORT);
    expect(c.content).toMatchObject([
      { kind: 'variation-selector', text: null, readable: false, bytesHex: '010203' },
    ]);
  });

  it('a valid first selector stays; the run is reported and counts as removed', () => {
    const c = cleanHidden('辻\u{E0100}\u{E0101}\u{E0102}', REPORT);
    expect(c.cleaned).toBe('辻\u{E0100}');
    expect(c.content).toMatchObject([{ kind: 'variation-selector', index: 1, removed: true }]);
  });

  it('a lone valid selector and an RGI sequence are not hidden', () => {
    const flag = `🏴${tags('gbsct')}\u{E007F}`;
    for (const s of ['辻\u{E0100}', '❤️', flag, '👨‍👩‍👧', '1️⃣']) {
      expect(cleanHidden(s, REPORT).content).toEqual([]);
    }
  });

  it('zero-width binary: decoded', () => {
    const c = cleanHidden(`ok ${bitsOf('pwn', '​', '‌')} ok`, REPORT);
    expect(c.content).toMatchObject([
      { kind: 'zero-width-binary', index: 3, length: 24, text: 'pwn', readable: true },
    ]);
  });

  it('a zero-width run with no byte reading is still reported', () => {
    const c = cleanHidden('a​‌‍⁠b', REPORT);
    expect(c.content).toMatchObject([
      { kind: 'zero-width-run', index: 1, length: 4, text: null, readable: false, removed: true },
    ]);
    expect(c.cleaned).toBe('ab');
  });

  it('entries are reported under keep, marked as not removed', () => {
    const c = cleanHidden(`a${tags('hi')}`, { ...REPORT, tags: 'keep' });
    expect(c.cleaned).toBe(`a${tags('hi')}`);
    expect(c.content).toMatchObject([{ kind: 'tag', text: 'hi', removed: false }]);
    expect(c.payloads).toEqual([]);
  });

  it('decodes regardless of decodePayloads, which only governs `payloads`', () => {
    const c = cleanHidden(`a${tags('hi')}`, { ...REPORT, decodePayloads: false });
    expect(c.payloads).toEqual([]);
    expect(c.content).toMatchObject([{ kind: 'tag', text: 'hi' }]);
  });

  it("'remove-with-content' on a payload rule is 'remove-counted' plus the report", () => {
    const input = `a${tags('hi')}${vsenc('yo')} ${bitsOf('x', '​', '‌')}`;
    const { content, ...rest } = cleanHidden(input, {
      ...STRICT_HIDDEN_RULES,
      tags: 'remove-with-content',
      variationSelectors: 'remove-with-content',
      zeroWidthRun: 'remove-with-content',
    });
    expect(rest).toEqual(cleanHidden(input));
    expect(content!.map((e) => e.text)).toEqual(['hi', 'yo', 'x']);
  });

  it('a very long tag run decodes', () => {
    const c = cleanHidden(`a${tags('x').repeat(300_000)}`, REPORT);
    expect(c.content![0]!.text!.length).toBe(300_000);
    expect(c.payloads[0]!.decoded!.length).toBe(300_000);
  });
});

describe('other hidden constructs', () => {
  it('one carrier per letter is one payload, with the ranges of its parts', () => {
    const input = `h${vsenc('s')}e${vsenc('e')}l${vsenc('c')}lo`;
    const c = cleanHidden(input, REPORT);
    expect(c.cleaned).toBe('hello');
    expect(c.content).toHaveLength(1);
    const e = c.content![0]!;
    expect(e).toMatchObject({ kind: 'variation-selector', text: 'sec', readable: true });
    expect(e.length).toBe(3);
    expect(e.parts!.map((p) => input.slice(p.start, p.end))).toEqual([
      vsenc('s'),
      vsenc('e'),
      vsenc('c'),
    ]);
  });

  it('one tag per word is one payload', () => {
    const c = cleanHidden(`one${tags('a')} two${tags('b')} three${tags('c')}`, REPORT);
    expect(c.content).toMatchObject([{ kind: 'tag', text: 'abc', removed: true }]);
  });

  it('runs far apart, or long, stay separate entries', () => {
    const far = cleanHidden(`a${tags('x')}${' word'.repeat(20)}${tags('y')}`, REPORT);
    expect(far.content!.map((e) => e.text)).toEqual(['x', 'y']);
    const long = cleanHidden(`a${tags('one')} b${tags('two')}`, REPORT);
    expect(long.content!.map((e) => e.text)).toEqual(['one', 'two']);
  });

  it('a lone orphan selector is a one-byte entry', () => {
    const c = cleanHidden('x\u{E0110}', REPORT);
    expect(c.content).toMatchObject([
      { kind: 'variation-selector', length: 1, text: null, bytesHex: '20' },
    ]);
  });

  it('bits in invisible operators decode', () => {
    const run = bitsOf('hi', '⁢', '⁤');
    const c = cleanHidden(`a${run}b`, REPORT);
    expect(c.content).toMatchObject([
      { kind: 'invisible-run', index: 1, length: 16, text: 'hi', readable: true, removed: true },
    ]);
    expect(c.cleaned).toBe('ab');
  });

  it('bits in fillers and in soft hyphens with a grapheme joiner decode', () => {
    expect(cleanHidden(bitsOf('hi', 'ㅤ', 'ﾠ'), REPORT).content![0]!.text).toBe('hi');
    expect(cleanHidden(`a${bitsOf('hi', '­', '͏')}`, REPORT).content![0]!.text).toBe('hi');
  });

  it('a mixed invisible run with no bit reading is reported without text', () => {
    const c = cleanHidden('a⁢​⁤­b', REPORT);
    expect(c.content).toMatchObject([{ kind: 'invisible-run', length: 4, text: null }]);
  });

  it('a run shorter than the threshold is not content', () => {
    expect(cleanHidden('a⁢⁤⁢b', REPORT).content).toEqual([]);
  });

  it('default-ignorable code points outside the named classes count as other invisibles', () => {
    for (const cp of [0x2065, 0xfff0, 0xfff8, 0xe0080, 0xe00ff, 0xe01f0, 0xe0fff]) {
      const c = cleanHidden(`a${String.fromCodePoint(cp)}b`);
      expect(c.cleaned).toBe('ab');
      expect(c.removed.counted).toEqual({ otherInvisible: 1 });
    }
    const keep = cleanHidden('a\u{E0080}b', { ...STRICT_HIDDEN_RULES, otherInvisibles: 'keep' });
    expect(keep.cleaned).toBe('a\u{E0080}b');
  });

  it('bits in them are an invisible run', () => {
    const c = cleanHidden(`a${bitsOf('hi', '\u{E0080}', '\u{E0081}')}b`, REPORT);
    expect(c.content).toMatchObject([{ kind: 'invisible-run', text: 'hi', removed: true }]);
    expect(c.cleaned).toBe('ab');
  });

  it('every Default_Ignorable code point is either judged or reported', () => {
    const uncovered: string[] = [];
    for (let cp = 0; cp <= 0xe0fff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const ch = String.fromCodePoint(cp);
      if (!/\p{Default_Ignorable_Code_Point}/u.test(ch)) continue;
      const c = cleanHidden(`${ch} a`, REPORT);
      if (c.content!.length === 0 && c.edits.length === 0) uncovered.push(cp.toString(16));
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
      const c = cleanHidden(s.input, REPORT);
      const reported = c.content!.some((e) => e.kind.startsWith('bidi-'));
      expect(s.shown !== s.natural).toBe(reported || NOT_HIDDEN.has(s.name));
      expect(reported && NOT_HIDDEN.has(s.name)).toBe(false);
    });
  }
});

describe('spans', () => {
  const span = (input: string) => {
    const e = cleanHidden(input, REPORT).content!.filter((x) => x.kind === 'bidi-override');
    expect(e.length).toBeLessThanOrEqual(1);
    return e[0] ? input.slice(e[0].index, e[0].end) : null;
  };

  it('ends at its PDF, which belongs to it', () => {
    expect(span('a‮bc‬d')).toBe('‮bc‬');
  });

  it.each([
    ['LF', '\n'],
    ['CR', '\r'],
    ['U+2029', ' '],
    ['NEL', '\u0085'],
    ['FS', '\u001C'],
    ['GS', '\u001D'],
    ['RS', '\u001E'],
  ])('ends before a paragraph separator: %s', (_, sep) => {
    const input = `a‮bc${sep}de`;
    const c = cleanHidden(input, REMOVE);
    expect(input.slice(c.content![0]!.index, c.content![0]!.end)).toBe('‮bc');
    expect(c.content![0]!.text).toBe('bc');
    expect(c.cleaned.endsWith('de')).toBe(true);
    expect(c.cleaned.startsWith('a')).toBe(true);
    expect(c.cleaned).not.toContain('bc');
  });

  it('runs on over a line separator and a tab, which do not end a paragraph', () => {
    expect(span('‮ab cd')).toBe('‮ab cd');
    expect(span('‮ab\tcd')).toBe('‮ab\tcd');
  });

  it('runs to the end of the text when unterminated', () => {
    expect(span('x‮abc')).toBe('‮abc');
  });

  it('a PDF inside an isolate cannot close an override outside it', () => {
    expect(span('‮ab⁦c‬d⁩ef‬g')).toBe('‮ab⁦c‬d⁩ef‬');
  });

  it('a PDI closes an override opened inside its isolate, before the PDI', () => {
    expect(span('⁦a‮bc⁩de')).toBe('‮bc');
  });

  it('a stray PDF or PDI closes nothing', () => {
    expect(span('‬ab⁩c‮de')).toBe('‮de');
  });

  it('nested: the outermost that reverses, with the inner controls in it', () => {
    expect(span('‮ab ‮cd‬ ef‬g')).toBe('‮ab ‮cd‬ ef‬');
    const c = cleanHidden('‮ab ‮cd‬ ef‬g', REPORT);
    expect(c.content![0]!.text).toBe('ab cd ef');
  });

  it('an inner reversal in an outer span that agrees: only the inner', () => {
    expect(span('‮שלום ‮abc‬ עולם‬')).toBe('‮abc‬');
    expect(cleanHidden('‮שלום ‮abc‬ עולם‬', REMOVE).cleaned).toBe('שלום  עולם');
  });

  it('offsets survive controls removed before the span', () => {
    const input = 'ok\u001B[31m \u0008‮abc‬ end';
    const c = cleanHidden(input, REMOVE);
    const e = c.content![0]!;
    expect(input.slice(e.index, e.end)).toBe('‮abc‬');
    expect(c.cleaned).toBe('ok  end');
  });

  it('a control inside the span is part of it', () => {
    const input = '‮a\u0007bc‬d';
    const c = cleanHidden(input, REMOVE);
    expect(c.cleaned).toBe('d');
    expect(c.edits).toEqual([{ start: 0, end: 6, value: '' }]);
    expect(c.content![0]).toMatchObject({ index: 0, end: 6, text: 'abc', removed: true });
  });
});

describe("bidiOverrides: 'remove-with-content'", () => {
  it('removes the reversed span with its controls', () => {
    const c = cleanHidden(`Open ${SPOOFED_NAME} now`, REMOVE);
    expect(c.cleaned).toBe('Open  now');
    expect(c.edits).toEqual([{ start: 5, end: 14, value: '' }]);
    expect(c.content).toMatchObject([{ kind: 'bidi-override', text: 'gnp.exe', removed: true }]);
    expect(c.removed.counted).toEqual({ bidiOverrideSpan: 9 });
    expect(c.findings).toEqual([
      { word: SPOOFED_NAME, index: 5, removed: { bidiOverrideSpan: 9 } },
    ]);
  });

  it('removes an unterminated span to the end of the line only', () => {
    expect(cleanHidden('invoice‮gnp.exe\nnext line', REMOVE).cleaned).toBe('invoice\nnext line');
  });

  it('removes a Trojan Source tail, isolates inside it included', () => {
    const c = cleanHidden('if (x != "user‮ ⁦// admin⁩ ⁦") {\nnext', REMOVE);
    expect(c.cleaned).toBe('if (x != "user\nnext');
    expect(c.content![0]!.text).toBe(' // admin ") {');
  });

  it('a payload inside the span is reported and gone, without a second edit', () => {
    const c = cleanHidden(`a‮bc${tags('hi')}d‬z`, REMOVE);
    expect(c.cleaned).toBe('az');
    expect(c.edits).toHaveLength(1);
    expect(c.content!.map((e) => [e.kind, e.removed])).toEqual([
      ['bidi-override', true],
      ['tag', true],
    ]);
    expect(c.payloads).toMatchObject([{ kind: 'tag', decoded: 'hi' }]);
    expect(c.removed.counted).toEqual({ bidiOverrideSpan: 7 });
  });

  it('text with no span keeps its letters and only loses the controls', () => {
    const input = '‭hello‬ ‫world‬';
    const { content, ...rest } = cleanHidden(input, REMOVE);
    expect(content).toEqual([]);
    expect(rest).toEqual(cleanHidden(input));
    expect(rest.cleaned).toBe('hello world');
  });

  it('counts through analyze: spoofed, a finding, offsets on the input', () => {
    const input = `safe ${SPOOFED_NAME} wоrds`;
    const r = analyze(input, {
      hiddenChars: 'strict',
      confusionModel: 'alphabet',
      hiddenCharRules: { bidiOverrides: 'remove-with-content' },
    });
    expect(r.normalized).toBe('safe  words');
    expect(r.spoofed).toBe(true);
    expect(r.counts.hiddenWords).toBe(1);
    expect(r.hidden!.content).toMatchObject([{ kind: 'bidi-override', text: 'gnp.exe' }]);
    for (const w of r.words) expect(input.slice(w.index, w.index + w.word.length)).toBe(w.word);
    expect(r.words.map((w) => w.word)).toEqual([SPOOFED_NAME, 'wоrds']);
  });

  it('analyze keeps controls to its own signals; a span still ends at a separator', () => {
    const r = analyze('a‮bc\u0085de', {
      hiddenChars: 'strict',
      hiddenCharRules: { bidiOverrides: 'remove-with-content' },
    });
    expect(r.hidden!.content).toMatchObject([{ index: 1, end: 4, text: 'bc' }]);
  });

  it('analyze with reportContent: the same list, output as without', () => {
    const input = `x${tags('hi')} ${SPOOFED_NAME}`;
    const plain = analyze(input, { hiddenChars: 'strict' });
    const r = analyze(input, { hiddenChars: 'strict', hiddenCharRules: { reportContent: true } });
    expect(r.normalized).toBe(plain.normalized);
    expect(r.hidden!.content!.map((e: HiddenContent) => e.kind)).toEqual(['tag', 'bidi-override']);
  });
});

describe('legitimate right-to-left text survives', () => {
  /** [what, input, cleaned]: no entry, every letter and digit kept. */
  const LEGIT: [string, string, string][] = [
    ['Hebrew', 'שלום עולם', 'שלום עולם'],
    ['Arabic', 'مرحبا بالعالم', 'مرحبا بالعالم'],
    ['Arabic with tashkeel', 'مَرْحَبًا', 'مَرْحَبًا'],
    ['Persian ZWNJ', 'می‌خواهم کتاب', 'می‌خواهم کتاب'],
    ['mixed direction, Hebrew first', 'שלום world עולם 123', 'שלום world עולם 123'],
    ['mixed direction, Latin first', 'hello שלום world مرحبا', 'hello שלום world مرحبا'],
    ['Hebrew with RLM', 'שלום‏ עולם', 'שלום‏ עולם'],
    ['Arabic with ALM', 'مرحبا؜ بالعالم', 'مرحبا؜ بالعالم'],
    ['isolate in Latin', 'abc ⁧שלום⁩ def', 'abc ⁧שלום⁩ def'],
    ['mixed isolate', 'user ⁧שלום world⁩ left', 'user ⁧שלום world⁩ left'],
    ['FSI around Arabic', 'x ⁨مرحبا⁩ y', 'x ⁨مرحبا⁩ y'],
    ['RLO on Hebrew', '‮שלום עולם‬', 'שלום עולם'],
    ['RLO on Arabic', '‮مرحبا بالعالم‬', 'مرحبا بالعالم'],
    ['RLO on Arabic with tashkeel', '‮مَرْحَبًا‬', 'مَرْحَبًا'],
    ['RLO on Hebrew with one Latin letter', '‮שלום a עולם‬', 'שלום a עולם'],
    ['RLO on Hebrew with one digit', '‮מחיר 5‬', 'מחיר 5'],
    ['LRO around a number in Hebrew', 'טל ‭+972-50-1234567‬ ok', 'טל +972-50-1234567 ok'],
    ['LRO around a date in Arabic', 'يوم ‭12/05/2024‬', 'يوم 12/05/2024'],
    ['LRO on Latin in Hebrew', 'שלום ‭abc def‬ עולם', 'שלום abc def עולם'],
    ['RLO with a nested LRO number', '‮السعر ‭100‬ ريال‬', 'السعر 100 ريال'],
    ['RLE on Hebrew', '‫שלום עולם‬', 'שלום עולם'],
    ['RLE on Arabic', '‫مرحبا بالعالم‬', 'مرحبا بالعالم'],
    ['RLE on mixed Hebrew', '‫שלום world עולם‬', 'שלום world עולם'],
    ['RLE on mixed Arabic', '‫نص English نص‬', 'نص English نص'],
    ['RLE with digits', '‫מחיר 100‬', 'מחיר 100'],
    ['RLE on Latin', '‫hello world‬', 'hello world'],
    ['LRE in Arabic', 'السعر ‪100‬ ريال', 'السعر 100 ريال'],
    ['LRE on mixed', '‪abc שלום def‬', 'abc שלום def'],
  ];

  it.each(LEGIT)('%s', (_, input, cleaned) => {
    const c = cleanHidden(input, REMOVE);
    expect(c.content).toEqual([]);
    expect(c.cleaned).toBe(cleaned);
  });

  it('marks piled up in RTL text are no run', () => {
    const input = 'שלום‏‏‏‏ עולם';
    const c = cleanHidden(input, REMOVE);
    expect(c.content).toEqual([]);
    expect(c.cleaned).toBe(input);
  });

  it('the same marks in Latin text are one', () => {
    expect(cleanHidden('abc‎‏‎‏ def', REMOVE).content).toMatchObject([
      { kind: 'invisible-run', length: 4, removed: true },
    ]);
  });

  /** [what, input, logical text]: letters against the override, shown reversed. */
  const REVERSED: [string, string, string][] = [
    ['Hebrew under LRO', '‭שלום‬', 'שלום'],
    ['Arabic under LRO', '‭مرحبا‬', 'مرحبا'],
    ['Latin word under RLO in Hebrew', '‮שלום world‬', 'שלום world'],
    ['Latin word under RLO in Arabic', '‮مرحبا world‬', 'مرحبا world'],
    ['a price under RLO', '‮מחיר 100‬', 'מחיר 100'],
    ['Arabic digits under RLO', '‮السعر ١٠٠‬', 'السعر ١٠٠'],
  ];

  it.each(REVERSED)('%s goes, with its logical text reported', (_, input, text) => {
    const c = cleanHidden(input, REMOVE);
    expect(c.content).toMatchObject([{ kind: 'bidi-override', text, readable: true }]);
    expect(c.cleaned).toBe('');
  });
});

describe('U+061C and the bidi mark rules', () => {
  it('alone it is no RTL text: marks in Latin text go', () => {
    const c = cleanHidden('abc\u061C def\u200E x');
    expect(c.cleaned).toBe('abc def x');
    expect(c.removed.counted).toEqual({ bidiMark: 2 });
    expect(c.findings).toHaveLength(2);
    expect(cleanHidden('\u061C').cleaned).toBe('');
    expect(cleanHidden('\u202Babc\u061C def\u202C').cleaned).toBe('abc def');
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
    expect(cleanHidden(input).cleaned).toBe(input);
    expect(analyze(input, { hiddenChars: 'strict' }).normalized).toBe(input);
  });
});

describe('embeddings and marks are never removed with content', () => {
  it('an RLM that swaps Latin words is reported; the words stay', () => {
    const c = cleanHidden('‫abc‏ def‬', REMOVE);
    expect(c.content).toEqual([
      {
        kind: 'bidi-mark-reorder',
        index: 0,
        end: 10,
        length: 10,
        text: 'abc def',
        readable: true,
        removed: false,
      },
    ]);
    expect(c.cleaned).toBe('abc def');
  });

  it('so does one in an isolate, whose controls the mark rule removes', () => {
    const c = cleanHidden('⁧abc‏ def⁩', REMOVE);
    expect(c.content).toMatchObject([{ kind: 'bidi-mark-reorder', text: 'abc def' }]);
    expect(c.cleaned).toBe('abc def');
  });

  it('with an RTL letter in the span it is ordinary mixed text', () => {
    expect(cleanHidden('‫abc‏ שלום def‬', REMOVE).content).toEqual([]);
  });
});

describe('words broken by zero-width characters', () => {
  /** [what, input, cleaned]: rejoined, nothing to report, no letter lost. */
  it.each([
    ['ZWSP', 'fr​ee', 'free'],
    ['one per letter', 'f​r​e​e', 'free'],
    ['ZWNJ in German', 'Auf‌lage', 'Auflage'],
    ['ZWJ', 'pay‍pal', 'paypal'],
    ['word joiner', 'pay⁠pal', 'paypal'],
    ['soft hyphen', 'co­operate', 'cooperate'],
    ['three in a row', 'fr​​​ee', 'free'],
  ])('%s: the character goes, the word stays', (_, input, cleaned) => {
    const c = cleanHidden(input, REMOVE);
    expect(c.cleaned).toBe(cleaned);
    expect(c.content).toEqual([]);
  });

  it('a run at the threshold is content, and its letters still stay', () => {
    const c = cleanHidden('fr​​​​ee', REMOVE);
    expect(c.cleaned).toBe('free');
    expect(c.content).toMatchObject([{ kind: 'zero-width-run', index: 2, length: 4 }]);
  });

  it("no zero-width rule takes the action, and at runtime it acts as 'remove-counted'", () => {
    const rules: HiddenCharRules = {
      ...STRICT_HIDDEN_RULES,
      // @ts-expect-error -- only content rules take 'remove-with-content'
      zeroWidthInWord: 'remove-with-content',
    };
    const c = cleanHidden('fr​ee', rules);
    expect(c.cleaned).toBe('free');
    expect(c.removed.counted).toEqual({ zeroWidthInWord: 1 });
  });
});

describe('mark stacks', () => {
  /** Real writing: every mark stays, nothing is reported, with no option and through analyze. */
  const REAL: [string, string][] = [
    ['Thai', 'สวัสดี ที่นี่ น้ำ ผู้ใหญ่ กี้ สิทธิ์ ฟื้น เพื่อน'],
    ['Lao', 'ສະບາຍດີ ຜູ້ ເຮື້ອ'],
    ['Arabic with tashkeel', 'مَرْحَبًا شَدَّةٌ مُحَمَّدٌ'],
    ['Quran', 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ ذَٰلِكَ ٱلْكِتَـٰبُ لَا رَيْبَ ۛ فِيهِ ۛ'],
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
    ['Sinhala', 'සිංහල ශ්‍රී'],
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
    const c = cleanHidden(input, REPORT);
    expect(c.content).toEqual([]);
    expect(c.cleaned).toBe(input);
    const r = analyze(input, { hiddenChars: 'strict', hiddenCharRules: { reportContent: true } });
    expect(r.normalized).toBe(input);
    expect(r.signals.zalgo).toBe(false);
    expect(r.hidden!.content).toEqual([]);
  });

  it('polytonic Greek in NFD fits its limit', () => {
    const input = 'ᾅ ᾧ ἄνθρωπος'.normalize('NFD');
    expect(cleanHidden(input, REPORT).cleaned).toBe(input);
    expect(cleanHidden(input, REPORT).content).toEqual([]);
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

  it.each(OVER)('%s: trimmed to its limit, in the list', (_, base, mark, limit) => {
    const input = `x ${base}${mark.repeat(40)} y`;
    const c = cleanHidden(input, REPORT);
    const kept = `${base}${mark.repeat(limit)}`;
    expect(c.cleaned).toBe(`x ${kept} y`);
    expect(c.removed.counted).toEqual({ markStack: 40 - limit });
    expect(c.content).toEqual([
      {
        kind: 'mark-stack',
        index: 2,
        end: 3 + base.length - 1 + 40,
        length: 41,
        text: kept,
        readable: true,
        removed: true,
      },
    ]);
  });

  it.each(OVER)(
    '%s: one mark past the limit is a stack, the limit is not',
    (_, base, mark, limit) => {
      expect(cleanHidden(`${base}${mark.repeat(limit)}`, REPORT).content).toEqual([]);
      expect(cleanHidden(`${base}${mark.repeat(limit + 1)}`, REPORT).content).toHaveLength(1);
    },
  );

  it('one RTL letter exempts nothing: marks answer to their own base', () => {
    const input = `ש${`a${'\u0301'.repeat(40)}`}`;
    expect(cleanHidden(input).cleaned).toBe('שa\u0301\u0301');
    const r = analyze(input, { hiddenChars: 'strict' });
    expect(r.signals.zalgo).toBe(true);
    expect(r.normalized).toBe('שa');
  });

  it("through analyze the marks on a word's Hebrew letter survive zalgo on its Latin letter", () => {
    const r = analyze(`\u05E9\u05B8a${'\u0301'.repeat(5)}`, { hiddenChars: 'strict' });
    expect(r.signals.zalgo).toBe(true);
    expect(r.normalized).toContain('\u05B8');
    expect(r.normalized).not.toContain('\u0301');
  });

  it('lenient analyze leaves stacks on a stacking-script letter alone', () => {
    const input = `ส${'\u0E49'.repeat(40)}`;
    expect(analyze(input).normalized).toBe(input);
    expect(analyze(input).spoofed).toBe(false);
    // The exemption is judged per letter (fix/script-exemption-per-base): a
    // Hebrew letter no longer exempts a stack on the Latin letter next to it.
    expect(analyze(`ש${`a${'\u0301'.repeat(40)}`}`).signals.zalgo).toBe(true);
  });

  it('strict analyze trims a stacking script, as zalgo', () => {
    const input = `ok ส${'\u0E49'.repeat(40)} ok`;
    const r = analyze(input, { hiddenChars: 'strict', hiddenCharRules: { reportContent: true } });
    expect(r.normalized).toBe('ok ส\u0E49\u0E49\u0E49 ok');
    expect(r.spoofed).toBe(true);
    expect(r.signals).toMatchObject({ zalgo: true, invisible: false });
    expect(r.counts.hiddenWords).toBe(1);
    expect(r.hidden!.content).toMatchObject([{ kind: 'mark-stack', index: 3, removed: true }]);
  });

  it('strict analyze reports a Latin stack it leaves to zalgo, as removed', () => {
    const r = analyze(`ok a${'\u0301'.repeat(5)} ok`, {
      hiddenChars: 'strict',
      hiddenCharRules: { reportContent: true },
    });
    expect(r.normalized).toBe('ok a ok');
    expect(r.hidden!.content).toMatchObject([
      { kind: 'mark-stack', text: 'a\u0301\u0301', removed: true },
    ]);
  });

  it('letter after letter is one entry; the next word another', () => {
    const m = '\u0E49'.repeat(6);
    const c = cleanHidden(`ส${m}ว${m} ส${m}`, REPORT);
    expect(c.content!.map((e) => e.text)).toEqual([
      'ส\u0E49\u0E49\u0E49ว\u0E49\u0E49\u0E49',
      'ส\u0E49\u0E49\u0E49',
    ]);
  });

  it.each([
    ['CGJ', '\u034F'],
    ['ZWNJ', '\u200C'],
    ['ZWSP', '\u200B'],
    ['a selector', '\uFE0F'],
  ])('%s cannot split a stack', (_, sep) => {
    const input = `a${`\u0301\u0301${sep}`.repeat(10)}`;
    const c = cleanHidden(input, REPORT);
    expect(c.cleaned).toBe('a\u0301\u0301');
    expect(c.content!.map((e) => e.kind)).toContain('mark-stack');
  });

  it('a kept mark-stack rule leaves the text and reports it', () => {
    const input = `ส${'\u0E49'.repeat(10)}`;
    const c = cleanHidden(input, { ...REPORT, markStacks: 'keep' });
    expect(c.cleaned).toBe(input);
    expect(c.content).toMatchObject([{ kind: 'mark-stack', removed: false }]);
    expect(c.removed.counted).toEqual({});
  });

  it('markStackLimits overrides a limit; remove-with-content reports', () => {
    const input = `ส${'\u0E49'.repeat(10)}`;
    const c = cleanHidden(input, {
      ...STRICT_HIDDEN_RULES,
      markStacks: 'remove-with-content',
      markStackLimits: { Thai: 1 },
    });
    expect(c.cleaned).toBe('ส\u0E49');
    expect(c.content).toMatchObject([{ kind: 'mark-stack', text: 'ส\u0E49' }]);
  });

  it('a stack inside a removed bidi span needs no edit of its own', () => {
    const c = cleanHidden(`x\u202Eab${'\u0301'.repeat(9)}c\u202Cy`, REMOVE);
    expect(c.cleaned).toBe('xy');
    expect(c.edits).toHaveLength(1);
    expect(c.content!.map((e) => e.kind)).toEqual(['bidi-override', 'mark-stack']);
  });

  it('edits stay ordered and non-overlapping with other rules, and offsets hold', () => {
    const input = `\u200Ba${'\u0301'.repeat(5)}\u200Bb${tags('x')}c${'\u0301'.repeat(5)}\u0007`;
    const c = cleanHidden(input, REPORT);
    expect(c.cleaned).toBe('a\u0301\u0301bc\u0301\u0301');
    for (let i = 1; i < c.edits.length; i++) {
      expect(c.edits[i]!.start).toBeGreaterThanOrEqual(c.edits[i - 1]!.end);
    }
    let rebuilt = '';
    let at = 0;
    for (const e of c.edits) {
      rebuilt += input.slice(at, e.start) + e.value;
      at = e.end;
    }
    expect(rebuilt + input.slice(at)).toBe(c.cleaned);
  });
});
