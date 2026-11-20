/**
 * Strict hidden-character cleanup (src/hidden.ts): the rows of
 * docs/confusion-model.md §6.1, parity with the prototype
 * (scripts/prototype-cleanup.mjs) on the corpus and the realistic benchmark
 * text, the legitimate-text sweep of test/invisible.test.ts, and the
 * per-class options.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  analyze,
  cleanHidden,
  STRICT_HIDDEN_RULES,
  type HiddenCharRules,
  type Mark,
  type OutputRecord,
} from '../src';
import { compatCleanHidden } from './helpers/compat';
import { growth, LINEAR, timed } from './helpers/growth';

const NO_SEAMS = { ...STRICT_HIDDEN_RULES, seamSpaces: false };
/** v0.6.0's strict defaults: no seam rule (D11), run threshold 4 (D28a), ligature breaks counted (D27). */
const V060 = {
  seamSpaces: false,
  zeroWidthRunThreshold: 4,
  possibleLigatureBreak: 'remove-counted',
} as const;

/** `cleanHidden` with every report call and output record collected. */
function clean(text: string, rules: Readonly<HiddenCharRules> = STRICT_HIDDEN_RULES) {
  const marks: Mark[] = [];
  const records: OutputRecord[] = [];
  const cleaned = cleanHidden(text, rules, {
    onReport: (m) => void marks.push(m),
    onRecord: (r) => void records.push(r),
  });
  return { cleaned, marks, records };
}
/** A consumer's counter (D17, D17a): report counts summed by kind. */
function countByKind(marks: readonly Mark[], kinds?: ReadonlySet<string>) {
  const n: Record<string, number> = {};
  for (const m of marks) if (!kinds || kinds.has(m.kind)) n[m.kind] = (n[m.kind] ?? 0) + m.count;
  return n;
}
/** Output records that change the source. */
const changes = (text: string, records: readonly OutputRecord[]) =>
  records.filter((r) => r.text !== text.slice(r.start, r.start + r.length));
/** Strict `analyze`'s hidden-word findings: [index, word] of the words with the `invisible` signal. */
const hiddenWords = (text: string, rules: Partial<HiddenCharRules> = {}) =>
  analyze(text, { hiddenChars: 'strict', hiddenCharRules: rules })
    .words.filter((w) => w.signals.includes('invisible'))
    .map((w) => [w.index, w.word]);

const proto = (await import(
  join(__dirname, '..', 'scripts', 'prototype-cleanup.mjs') as string
)) as {
  cleanup: (t: string) => {
    cleaned: string;
    hiddenWords: number;
    findings: { index: number }[];
    payloads: { kind: string; decoded: string | null; bytesHex?: string }[];
    removed: { counted: Record<string, number>; silent: Record<string, number> };
  };
};
const realistic = (await import(
  join(__dirname, '..', 'scripts', 'realistic-text.mjs') as string
)) as {
  buildRealisticMarkdown: (o: object) => string;
};
const corpus = (
  JSON.parse(readFileSync(join(__dirname, 'fixtures', 'cases.json'), 'utf8')) as { input: string }[]
).map((c) => c.input);

const tags = (s: string) =>
  [...s].map((c) => String.fromCodePoint(0xe0000 + c.codePointAt(0)!)).join('');
const vsenc = (s: string) =>
  [...new TextEncoder().encode(s)]
    .map((b) => String.fromCodePoint(b < 16 ? 0xfe00 + b : 0xe0100 + b - 16))
    .join('');
const zwenc = (s: string) =>
  [...new TextEncoder().encode(s)]
    .map((b) => b.toString(2).padStart(8, '0').replace(/0/g, '\u200B').replace(/1/g, '\u200C'))
    .join('');

/**
 * [name, input, cleaned ('=' unchanged), strict analyze's hidden words, report
 * counts by kind, hidden parts beyond the characters themselves] — §6.1.
 * Decision 12a: a payload's hidden part is its own characters (tags, selectors,
 * zero-width binary are not decoded), so only spans such as a bidi override's
 * text show here; the decoded payloads are checked against the prototype below.
 */
const ROWS: [string, string, string, number, string, string][] = [
  ['shy', 'co\u00ADoperate', 'cooperate', 0, 'softHyphen=1', ''],
  ['wj', 'a\u2060b', 'ab', 1, 'zeroWidthInWord=1', ''],
  ['bomMid', 'ab\uFEFFcd', 'abcd', 1, 'zeroWidthInWord=1', ''],
  ['zwspLatin', 'fr\u200Bee', 'free', 1, 'zeroWidthInWord=1', ''],
  ['zwnjLatin', 'fo\u200Co', 'foo', 1, 'joinerInWord=1', ''],
  ['zwnjPersian', 'می\u200Cخواهم', '=', 0, '', ''],
  ['zwnjDeva', 'क्\u200Cष', '=', 0, '', ''],
  ['emojiZwj', '👨\u200D👩\u200D👧', '=', 0, '', ''],
  ['flagSco', '🏴' + tags('gbsct') + '\u{E007F}', '=', 0, '', ''],
  ['tagSmuggle', 'hi' + tags('ABC'), 'hi', 1, 'tags=3', ''],
  // bidiOverrideSpan: a new rule, 'keep' = reported, the span in logical order.
  [
    'rlo',
    'abc\u202Edef',
    'abcdef',
    1,
    'bidiOverrideSpan=4,bidiOverrides=1',
    'bidiOverrideSpan:"def"',
  ],
  ['lrmInEnglish', 'hello\u200E world', 'hello world', 1, 'bidiMarks=1', ''],
  // bidiMarksInRtlText 'keep' = report mode: reported, kept (D3, D12).
  ['rlmInHebrew', 'שלום\u200F abc', '=', 0, 'bidiMarksInRtlText=1', ''],
  ['vsRun', 'a\uFE0F\uFE0F\uFE0F', 'a', 1, 'variationSelectors=3', ''],
  ['vsHeart', '❤\uFE0F', '=', 0, '', ''],
  ['ivs', '辻\u{E0100}', '=', 0, '', ''],
  ['vsPayload', 'x\u{E0110}\u{E0120}\u{E0130}', 'x', 1, 'variationSelectors=3', ''],
  ['mixed', 'busіnеss', '=', 0, '', ''],
  ['fullwidth', 'Ｇｅｔ', '=', 0, '', ''],
  ['vsSuppSingle', 'x\u{E0110}', 'x', 1, 'variationSelectors=1', ''],
  ['emojiVsPayload', '😀' + vsenc('hi!'), '😀', 1, 'variationSelectors=3', ''],
  ['tagAfterEmoji', '😀' + tags('ignore'), '😀', 1, 'tags=6', ''],
  ['zwBinary', 'ok ' + zwenc('pwn') + ' ok', 'ok  ok', 1, 'zeroWidthRun=24', ''],
  ['zwIsolated', 'a \u200B b', 'a  b', 0, 'isolatedZeroWidth=1', ''],
  ['bomStart', '\uFEFFhello', 'hello', 0, 'leadingBom=1', ''],
  ['hebrewRLO', 'של\u202Eום', 'שלום', 1, 'bidiOverrides=1', ''],
  ['arabicTag', 'مي' + tags('hi') + 'خ', 'ميخ', 1, 'tags=2', ''],
  ['persianZWSPrun', 'می' + '\u200B'.repeat(5) + 'خواهم', 'میخواهم', 1, 'zeroWidthRun=5', ''],
  ['zwnjBetweenSpaces', 'a \u200C b', 'a  b', 0, 'isolatedZeroWidth=1', ''],
  ['keycap', '1\uFE0F⃣', '=', 0, '', ''],
  // bidiMarksInRtlText 'keep' = report mode: reported, kept (D3, D12).
  ['rliHebrew', 'abc \u2067שלום\u2069 def', '=', 0, 'bidiMarksInRtlText=2', ''],
  ['rliNoRtl', 'abc \u2067def\u2069', 'abc def', 1, 'bidiMarks=2', ''],
  ['nbsp', 'a\u00A0b\u2009c', '=', 0, '', ''],
  ['shyCyr', 'ко\u00ADшка', 'кошка', 0, 'softHyphen=1', ''],
  [
    'twoWords',
    'fr\u200Bee mon\u200Bey ' + tags('x'.repeat(200)),
    'free money ',
    3,
    'tags=200,zeroWidthInWord=2',
    '',
  ],
  ['arabicNumberSign', '\u0600١٢٣', '=', 0, '', ''],
  ['fnApp', 'adm\u2061in', 'admin', 1, 'otherInvisibles=1', ''],
  ['ivs3', '辻\u{E0100}\u{E0101}\u{E0102}', '辻\u{E0100}', 1, 'variationSelectors=2', ''],
  ['emojiVs16', '☺\uFE0F', '=', 0, '', ''],
  ['vs16OnLetter', 'a\uFE0F', 'a', 1, 'variationSelectors=1', ''],
  ['clickBlank', 'click\u2800here admin\u3164', 'click here admin', 2, 'blankFillers=2', ''],
];
const fmt = (o: Record<string, number>) =>
  Object.entries(o)
    .sort()
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
/** A mark's hidden part when it is more than the characters themselves (a payload, a span). */
const hiddenPart = (text: string, m: Mark) =>
  m.extracted !== null && m.extracted !== text.slice(m.start, m.start + m.length);

describe('§6.1 rows (strict defaults)', () => {
  // main's rows, without the seam rule (decision 11, tested in finding-callback.test.ts).
  it.each(ROWS)('%s', (_n, input, cleaned, words, reports, pay) => {
    const r = clean(input, NO_SEAMS);
    expect(r.cleaned).toBe(cleaned === '=' ? input : cleaned);
    expect(hiddenWords(input, { seamSpaces: false })).toHaveLength(words);
    expect(fmt(countByKind(r.marks))).toBe(reports);
    expect(
      r.marks
        .filter((m) => hiddenPart(input, m))
        .map(
          (m) =>
            `${m.kind}:${JSON.stringify(m.extracted!.length > 24 ? m.extracted!.slice(0, 24) + '…' : m.extracted)}`,
        )
        .join(' '),
    ).toBe(pay);
  });

  it('reports each mark, and lists hidden words per word in strict analyze', () => {
    const t = 'fr\u200Bee mon\u200Bey';
    const r = clean(t);
    expect(r.marks).toEqual([
      { kind: 'zeroWidthInWord', start: 2, length: 1, extracted: '\u200B', count: 1 },
      { kind: 'zeroWidthInWord', start: 9, length: 1, extracted: '\u200B', count: 1 },
    ]);
    expect(changes(t, r.records)).toEqual([
      { start: 2, length: 1, text: '' },
      { start: 9, length: 1, text: '' },
    ]);
    expect(hiddenWords(t)).toEqual([
      [0, 'fr\u200Bee'],
      [6, 'mon\u200Bey'],
    ]);
  });
});

/** Invisible code points src/hidden.ts removes beyond the prototype (upstream already flagged them). */
const BEYOND_PROTOTYPE =
  /[\u17B4\u17B5\u{110B1}\u{13430}-\u{1343F}\u{1BCA0}-\u{1BCA3}\u{1D173}-\u{1D17A}]/u;

/** Bidi marks (decision 42g judges them per bidi paragraph) and a right-to-left letter. */
const PER_PARAGRAPH = /[\u200E\u200F\u061C\u2066-\u2069]/u;
const PER_PARAGRAPH_G = new RegExp(PER_PARAGRAPH.source, 'gu');
const RTL_TEXT = /[\p{Script=Hebrew}\p{Script=Arabic}]/u;

/** The prototype's removal classes by report kind. */
const PROTO_CLASS: Record<string, string> = {
  softHyphen: 'softHyphen',
  leadingBom: 'bom',
  isolatedZeroWidth: 'zeroWidth',
  wordBreakHint: 'zeroWidth',
  joinerInWord: 'zeroWidthInWord',
  possibleLigatureBreak: 'zeroWidthInWord',
  zeroWidthInWord: 'zeroWidthInWord',
  zeroWidthRun: 'zeroWidthRun',
  bidiOverrides: 'bidiOverride',
  bidiMarks: 'bidiMark',
  bidiMarksInRtlText: 'bidiMark',
  variationSelectors: 'variationSelector',
  tags: 'tag',
  blankFillers: 'blankFiller',
  otherInvisibles: 'otherInvisible',
};
const PROTO_PAYLOAD: Record<string, string> = {
  tag: 'tags',
  'variation-selector': 'variationSelectors',
  'zero-width-binary': 'zeroWidthRun',
};

describe('parity with the prototype', () => {
  // The prototype has no control-character rule, none for mark stacks, nor the
  // seam rule; it has v0.6.0's run threshold and ligature-break handling.
  const rules: HiddenCharRules = {
    ...STRICT_HIDDEN_RULES,
    ...V060,
    controlChars: 'keep',
    markStacks: 'keep',
    markStacksOther: 'keep',
  };
  const removing = new Set(
    Object.keys(PROTO_CLASS).filter((k) =>
      String((rules as unknown as Record<string, string>)[k]).startsWith('remove'),
    ),
  );
  const same = (input: string) => {
    if (BEYOND_PROTOTYPE.test(input)) return;
    // Decision 42g: the prototype reads "in right-to-left text" over the whole text, the
    // library per bidi paragraph; both read the text with its bidi marks taken out alike.
    const t =
      PER_PARAGRAPH.test(input) && RTL_TEXT.test(input)
        ? input.replace(PER_PARAGRAPH_G, '')
        : input;
    const a = clean(t, rules);
    const b = proto.cleanup(t);
    const at = JSON.stringify(t);
    expect(a.cleaned, at).toBe(b.cleaned);
    // Removals by class: the prototype's counted and silent, the library's cleanup kinds.
    const removed: Record<string, number> = {};
    for (const [k, v] of Object.entries(countByKind(a.marks, removing)))
      removed[PROTO_CLASS[k]!] = (removed[PROTO_CLASS[k]!] ?? 0) + v;
    const protoRemoved: Record<string, number> = {};
    for (const o of [b.removed.counted, b.removed.silent])
      for (const [k, v] of Object.entries(o)) if (v) protoRemoved[k] = (protoRemoved[k] ?? 0) + v;
    expect(fmt(removed), at).toBe(fmt(protoRemoved));
    // Payloads (decision 12a: the library reports the raw characters; the
    // consumer decodes): decoded text, or hex of the bytes, by the consumer
    // decode of test/helpers/compat.ts.
    expect(
      compatCleanHidden(t, rules)
        .payloads.filter((p) => p.kind in PROTO_PAYLOAD)
        .map((p) => [PROTO_PAYLOAD[p.kind]!, p.decoded ?? p.bytesHex]),
      at,
    ).toEqual(b.payloads.map((p) => [PROTO_PAYLOAD[p.kind]!, p.decoded ?? p.bytesHex]));
    // Hidden words: strict analyze under the same rules.
    expect(
      hiddenWords(t, { ...V060, markStacks: 'keep' }).map(([i]) => i),
      at,
    ).toEqual(b.findings.map((f) => f.index));
  };
  it('every §6.1 row and every corpus input', () => {
    for (const [, input] of ROWS) same(input);
    for (const t of corpus) same(t);
  });
  it('the realistic benchmark text', () => {
    const cases = corpus.filter((t) => !BEYOND_PROTOTYPE.test(t));
    const text = realistic.buildRealisticMarkdown({ targetBytes: 300_000, seed: 3, cases });
    expect(BEYOND_PROTOTYPE.test(text)).toBe(false);
    same(text);
  }, 60_000);
});

describe('legitimate text stays untouched', () => {
  const LEGITIMATE = [
    'Bonjour\u00A0! Ça va\u202F? Oui\u00A0: très bien.',
    '日本語\u3000テスト\u3000です',
    'p\u2009=\u20090.05, n\u2009=\u200912',
    'क्\u200Cष हिन्दी वाक्य',
    'می\u200Cخواهم کتاب بخوانم',
    'ᠮᠣᠩᠭᠣᠯ ᠬᠡᠯᠡ',
    'ភាសាខ្មែរ សួស្ដី',
    '辻\uFE00さんと葛\uFE01城',
    '👋🏽 hello 👨🏿\u200D💻 and 👩🏻\u200D🚀',
    'press 1\uFE0F⃣ then #\uFE0F⃣',
    'copyright ©\uFE0F trademark ™\uFE0F info ℹ\uFE0F',
    '🇩🇪 🇯🇵 🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F} 🏳\uFE0F\u200D🌈 🏴\u200D☠\uFE0F',
    'const x = foo("bar") // ok\n\ttabbed\r\n',
  ];
  it.each(LEGITIMATE)('%s', (s) => {
    const r = clean(s);
    expect(r.cleaned).toBe(s);
    expect(r.marks).toEqual([]);
    expect(hiddenWords(s)).toEqual([]);
  });
  it('cleans the Trojan Source line', () => {
    const r = clean('if (level != "user\u202E \u2066// admin check\u2069 \u2066") {');
    expect(r.cleaned).toBe('if (level != "user // admin check ") {');
  });
});

describe('per-class options', () => {
  const opt = (o: Partial<HiddenCharRules>) => ({ ...STRICT_HIDDEN_RULES, ...o });
  it('soft hyphen: remove-silent | remove-counted | keep', () => {
    const t = 'pay\u00ADpal.com';
    // Silent and counted report alike (D17a); only strict analyze's hidden words differ.
    expect(clean(t).marks.map((m) => m.kind)).toEqual(['softHyphen']);
    expect(hiddenWords(t)).toEqual([]);
    expect(clean(t, opt({ softHyphen: 'remove-counted' })).cleaned).toBe('paypal.com');
    expect(hiddenWords(t, { softHyphen: 'remove-counted' })).toEqual([[0, t]]);
    const kept = clean(t, opt({ softHyphen: 'keep' }));
    expect(kept.cleaned).toBe(t);
    expect(kept.marks.map((m) => [m.kind, m.start])).toEqual([['softHyphen', 3]]);
  });
  it('word-break hints: keep', () => {
    const thai = 'ภาษา\u200Bไทย';
    expect(cleanHidden(thai)).toBe('ภาษาไทย');
    expect(cleanHidden(thai, opt({ wordBreakHint: 'keep' }))).toBe(thai);
  });
  it('joiner inside a Latin/Cyrillic word: keep', () => {
    const t = 'Auf\u200Clage ко\u200Dт';
    // D27: the ZWNJ between f and l is a possible ligature break, removed under its own kind.
    expect(clean(t).marks.map((m) => m.kind)).toEqual(['possibleLigatureBreak', 'joinerInWord']);
    expect(cleanHidden(t, opt({ joinerInWord: 'keep' }))).toBe('Auflage ко\u200Dт');
    expect(cleanHidden(t, opt({ joinerInWord: 'keep', possibleLigatureBreak: 'keep' }))).toBe(t);
    // other zero-width characters inside a word are still removed
    expect(cleanHidden('fr\u200Bee', opt({ joinerInWord: 'keep' }))).toBe('free');
  });
  it('zero-width run threshold and isolated runs', () => {
    const three = `a ${'\u200B'.repeat(3)} b`;
    // D28a: threshold 2, so three in a row are a run wherever they sit.
    expect(clean(three).marks.map((m) => m.kind)).toEqual(['zeroWidthRun']);
    expect(hiddenWords(three)).toEqual([[2, '\u200B'.repeat(3)]]);
    // Below the threshold an isolated run goes silently.
    const four = opt({ zeroWidthRunThreshold: 4 });
    expect(clean(three, four).marks.map((m) => m.kind)).toEqual(['isolatedZeroWidth']);
    expect(hiddenWords(three, { zeroWidthRunThreshold: 4 })).toEqual([]);
    expect(cleanHidden(three, { ...four, isolatedZeroWidth: 'keep' })).toBe(three);
  });
  it('bidi: embeddings and overrides reported apart from marks and isolates', () => {
    const removals = (t: string, o: Partial<HiddenCharRules> = {}) =>
      countByKind(
        clean(t, opt(o)).marks,
        new Set(['bidiOverrides', 'bidiMarks', 'bidiMarksInRtlText']),
      );
    for (const c of ['\u202A', '\u202B', '\u202C', '\u202D', '\u202E']) {
      expect(removals(`abc${c}def`)).toEqual({ bidiOverrides: 1 });
    }
    for (const c of ['\u200E', '\u200F', '\u2066', '\u2067', '\u2068', '\u2069']) {
      expect(removals(`abc${c}def`)).toEqual({ bidiMarks: 1 });
    }
    expect(removals('a\u202Eb\u200Ec')).toEqual({ bidiOverrides: 1, bidiMarks: 1 });
    // remove-silent: still reported (D17a); strict analyze lists no hidden word.
    expect(removals('a\u202Eb\u200Ec', { bidiMarks: 'remove-silent' })).toEqual({
      bidiOverrides: 1,
      bidiMarks: 1,
    });
    expect(hiddenWords('abc\u200Edef')).toEqual([[0, 'abc\u200Edef']]);
    expect(hiddenWords('abc\u200Edef', { bidiMarks: 'remove-silent' })).toEqual([]);
    expect(removals('של\u200Fום\u202E', { bidiMarksInRtlText: 'remove-counted' })).toEqual({
      bidiOverrides: 1,
      bidiMarksInRtlText: 1,
    });
  });

  it('bidi marks in RTL text, overrides, tags, selectors', () => {
    expect(cleanHidden('שלום\u200F abc', opt({ bidiMarksInRtlText: 'remove-counted' }))).toBe(
      'שלום abc',
    );
    const kept = clean('abc\u202Edef', opt({ bidiOverrides: 'keep' }));
    expect(kept.cleaned).toBe('abc\u202Edef');
    expect(changes('abc\u202Edef', kept.records)).toEqual([]);
    expect(hiddenWords('abc\u202Edef', { bidiOverrides: 'keep' })).toEqual([]);
    const smuggled = 'hi' + tags('ABC');
    const tagsKept = clean(smuggled, opt({ tags: 'keep' }));
    expect(tagsKept.cleaned).toBe(smuggled);
    expect(tagsKept.marks).toEqual([
      { kind: 'tags', start: 2, length: 6, extracted: tags('ABC'), count: 3 },
    ]);
    expect(hiddenWords('x\u{E0110}', { variationSelectors: 'remove-silent' })).toEqual([]);
  });
  it('removes the invisible format characters upstream flags and the prototype misses', () => {
    const r = clean('a\u{1BCA0}b\u{1D173}c\u{13430}d');
    expect(r.cleaned).toBe('abcd');
    expect(countByKind(r.marks)).toEqual({ otherInvisibles: 3 });
  });
  it('invisible vowel signs: kept in their own script only', () => {
    expect(cleanHidden('a\u17B4b')).toBe('ab');
    expect(cleanHidden('ក\u17B4')).toBe('ក\u17B4');
  });
});

describe('control characters', () => {
  it.each([
    ['control_char-001', 'It was norml\bal.', 'It was normlal.'],
    ['control_char-003', 'abc\u001b[31mred\u001b[0m', 'abcred'],
    ['hidden_format-009', '￾', ''],
    ['NUL, lone ESC', 'a\u0000b\u001bc', 'abc'],
    ['DEL', 'a\u007fb', 'ab'],
    ['C1 edges', 'a\u0080b\u009fc', 'abc'],
    ['C1 CSI goes whole', 'a\u009b31mb', 'ab'],
  ])('%s: removed', (_n, input, want) => {
    expect(cleanHidden(input)).toBe(want);
  });

  it('tab, LF and CR stay; VT and FF become a space', () => {
    const t = 'a\tb\nc\r\nd';
    const r = clean(t);
    expect(r.cleaned).toBe(t);
    expect(r.marks).toEqual([]);
    expect(changes(t, r.records)).toEqual([]);
    expect(cleanHidden('end\fstart\vx\u0085y')).toBe('end start x y');
  });

  it('reported per character, a hidden word once; silent and keep by rule', () => {
    const t = 'fr\bee a\u0007b\u0007 plain';
    expect(countByKind(clean(t).marks)).toEqual({ controlChars: 3 });
    // Strict analyze runs controls as `illegal`; with the control rule on they are hidden words.
    // (Without the terminal layer, which strict analyze runs by default, decision 7b.)
    expect(hiddenWords(t, { controlChars: 'remove-counted', terminal: undefined })).toEqual([
      [0, 'free'],
      [6, 'ab'],
    ]);
    const s = clean('a\bb', { ...STRICT_HIDDEN_RULES, controlChars: 'remove-silent' });
    expect(s.cleaned).toBe('ab');
    expect(s.marks.map((m) => [m.kind, m.count])).toEqual([['controlChars', 1]]);
    expect(hiddenWords('a\bb', { controlChars: 'remove-silent' })).toEqual([]);
    expect(cleanHidden('a\bb', { ...STRICT_HIDDEN_RULES, controlChars: 'keep' })).toBe('a\bb');
    expect(hiddenWords('a\b\u200Bb')).toHaveLength(1);
  });

  it("a control can't split a run past the run rules", () => {
    const r = clean('a\u200B\b\u200B\b\u200B\b\u200Bb');
    expect(r.cleaned).toBe('ab');
    expect(countByKind(r.marks)).toEqual({ zeroWidthRun: 4, controlChars: 3 });
  });

  it('output records are on input offsets and rebuild the cleaned text', () => {
    const input = 'one\u0007 tw\u200Bo\u001b[1m three\u202E fo\bur';
    const r = clean(input);
    expect(r.cleaned).toBe('one two three four');
    let cursor = 0;
    for (const rec of r.records) {
      expect(rec.start).toBe(cursor);
      cursor = rec.start + rec.length;
    }
    expect(cursor).toBe(input.length);
    expect(r.records.map((rec) => rec.text).join('')).toBe(r.cleaned);
  });

  it('many controls', () => {
    expect(cleanHidden('a\b'.repeat(1000))).toBe('a'.repeat(1000));
  });
  timed(
    'linear on many controls',
    () => {
      expect(growth((n) => cleanHidden('a\b'.repeat(n)), 100_000)).toBeLessThan(LINEAR);
    },
    30_000,
  );
});
