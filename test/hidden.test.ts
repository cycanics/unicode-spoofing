/**
 * Strict hidden-character cleanup (src/hidden.ts): the rows of
 * docs/confusion-model.md §7.3, parity with the prototype
 * (scripts/prototype-cleanup.mjs) on the corpus and the realistic benchmark
 * text, the legitimate-text sweep of test/invisible.test.ts, and the
 * per-class options.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanHidden, STRICT_HIDDEN_RULES, type HiddenCharRules } from '../src/hidden';

const proto = (await import(
  join(__dirname, '..', 'scripts', 'prototype-cleanup.mjs') as string
)) as {
  cleanup: (t: string) => {
    cleaned: string;
    hiddenWords: number;
    findings: unknown[];
    payloads: unknown[];
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

/** [name, input, cleaned ('=' unchanged), hiddenWords, counted, silent, payload] — §7.3. */
const ROWS: [string, string, string, number, string, string, string][] = [
  ['shy', 'co\u00ADoperate', 'cooperate', 0, '', 'softHyphen=1', ''],
  ['wj', 'a\u2060b', 'ab', 1, 'zeroWidthInWord=1', '', ''],
  ['bomMid', 'ab\uFEFFcd', 'abcd', 1, 'zeroWidthInWord=1', '', ''],
  ['zwspLatin', 'fr\u200Bee', 'free', 1, 'zeroWidthInWord=1', '', ''],
  ['zwnjLatin', 'fo\u200Co', 'foo', 1, 'zeroWidthInWord=1', '', ''],
  ['zwnjPersian', 'می\u200Cخواهم', '=', 0, '', '', ''],
  ['zwnjDeva', 'क्\u200Cष', '=', 0, '', '', ''],
  ['emojiZwj', '👨\u200D👩\u200D👧', '=', 0, '', '', ''],
  ['flagSco', '🏴' + tags('gbsct') + '\u{E007F}', '=', 0, '', '', ''],
  ['tagSmuggle', 'hi' + tags('ABC'), 'hi', 1, 'tag=3', '', 'tag:"ABC"'],
  ['rlo', 'abc\u202Edef', 'abcdef', 1, 'bidiOverride=1', '', ''],
  ['lrmInEnglish', 'hello\u200E world', 'hello world', 1, 'bidiMark=1', '', ''],
  ['rlmInHebrew', 'שלום\u200F abc', '=', 0, '', '', ''],
  [
    'vsRun',
    'a\uFE0F\uFE0F\uFE0F',
    'a',
    1,
    'variationSelector=3',
    '',
    'variation-selector:hex 0f0f0f',
  ],
  ['vsHeart', '❤\uFE0F', '=', 0, '', '', ''],
  ['ivs', '辻\u{E0100}', '=', 0, '', '', ''],
  [
    'vsPayload',
    'x\u{E0110}\u{E0120}\u{E0130}',
    'x',
    1,
    'variationSelector=3',
    '',
    'variation-selector:" 0@"',
  ],
  ['mixed', 'busіnеss', '=', 0, '', '', ''],
  ['fullwidth', 'Ｇｅｔ', '=', 0, '', '', ''],
  ['vsSuppSingle', 'x\u{E0110}', 'x', 1, 'variationSelector=1', '', ''],
  [
    'emojiVsPayload',
    '😀' + vsenc('hi!'),
    '😀',
    1,
    'variationSelector=3',
    '',
    'variation-selector:"hi!"',
  ],
  ['tagAfterEmoji', '😀' + tags('ignore'), '😀', 1, 'tag=6', '', 'tag:"ignore"'],
  [
    'zwBinary',
    'ok ' + zwenc('pwn') + ' ok',
    'ok  ok',
    1,
    'zeroWidthRun=24',
    '',
    'zero-width-binary:"pwn"',
  ],
  ['zwIsolated', 'a \u200B b', 'a  b', 0, '', 'zeroWidth=1', ''],
  ['bomStart', '\uFEFFhello', 'hello', 0, '', 'bom=1', ''],
  ['hebrewRLO', 'של\u202Eום', 'שלום', 1, 'bidiOverride=1', '', ''],
  ['arabicTag', 'مي' + tags('hi') + 'خ', 'ميخ', 1, 'tag=2', '', 'tag:"hi"'],
  ['persianZWSPrun', 'می' + '\u200B'.repeat(5) + 'خواهم', 'میخواهم', 1, 'zeroWidthRun=5', '', ''],
  ['zwnjBetweenSpaces', 'a \u200C b', 'a  b', 0, '', 'zeroWidth=1', ''],
  ['keycap', '1\uFE0F⃣', '=', 0, '', '', ''],
  ['rliHebrew', 'abc \u2067שלום\u2069 def', '=', 0, '', '', ''],
  ['rliNoRtl', 'abc \u2067def\u2069', 'abc def', 1, 'bidiMark=2', '', ''],
  ['nbsp', 'a\u00A0b\u2009c', '=', 0, '', '', ''],
  ['shyCyr', 'ко\u00ADшка', 'кошка', 0, '', 'softHyphen=1', ''],
  [
    'twoWords',
    'fr\u200Bee mon\u200Bey ' + tags('x'.repeat(200)),
    'free money ',
    3,
    'tag=200,zeroWidthInWord=2',
    '',
    'tag:"xxxxxxxxxxxxxxxxxxxxxxxx…"',
  ],
  ['arabicNumberSign', '\u0600١٢٣', '=', 0, '', '', ''],
  ['fnApp', 'adm\u2061in', 'admin', 1, 'otherInvisible=1', '', ''],
  [
    'ivs3',
    '辻\u{E0100}\u{E0101}\u{E0102}',
    '辻\u{E0100}',
    1,
    'variationSelector=2',
    '',
    'variation-selector:hex 101112',
  ],
  ['emojiVs16', '☺\uFE0F', '=', 0, '', '', ''],
  ['vs16OnLetter', 'a\uFE0F', 'a', 1, 'variationSelector=1', '', ''],
  ['clickBlank', 'click\u2800here admin\u3164', 'click here admin', 2, 'blankFiller=2', '', ''],
];
const fmt = (o: Partial<Record<string, number>>) =>
  Object.entries(o)
    .filter(([, v]) => v)
    .sort()
    .map(([k, v]) => `${k}=${v}`)
    .join(',');

describe('§7.3 rows (strict defaults)', () => {
  it.each(ROWS)('%s', (_n, input, cleaned, words, cnt, sil, pay) => {
    const r = cleanHidden(input);
    expect(r.cleaned).toBe(cleaned === '=' ? input : cleaned);
    expect(r.findings.length).toBe(words);
    expect(fmt(r.removed.counted)).toBe(cnt);
    expect(fmt(r.removed.silent)).toBe(sil);
    expect(
      r.payloads
        .map(
          (p) =>
            `${p.kind}:${p.decoded !== null ? JSON.stringify(p.decoded.length > 24 ? p.decoded.slice(0, 24) + '…' : p.decoded) : 'hex ' + p.bytesHex}`,
        )
        .join(' '),
    ).toBe(pay);
  });

  it('reports findings per whitespace-delimited word', () => {
    const r = cleanHidden('fr\u200Bee mon\u200Bey');
    expect(r.findings).toEqual([
      { word: 'fr\u200Bee', index: 0, removed: { zeroWidthInWord: 1 } },
      { word: 'mon\u200Bey', index: 6, removed: { zeroWidthInWord: 1 } },
    ]);
    expect(r.edits).toEqual([
      { start: 2, end: 3, value: '' },
      { start: 9, end: 10, value: '' },
    ]);
  });
});

/** Invisible code points src/hidden.ts removes beyond the prototype (upstream already flagged them). */
const BEYOND_PROTOTYPE =
  /[\u17B4\u17B5\u{110B1}\u{13430}-\u{1343F}\u{1BCA0}-\u{1BCA3}\u{1D173}-\u{1D17A}]/u;

describe('parity with the prototype', () => {
  const same = (t: string) => {
    if (BEYOND_PROTOTYPE.test(t)) return;
    // The prototype has no control-character rule.
    // Nor any for mark stacks.
    const a = cleanHidden(t, {
      ...STRICT_HIDDEN_RULES,
      controlChars: 'keep',
      markStacks: 'keep',
      markStacksOther: 'keep',
    });
    const b = proto.cleanup(t);
    expect(a.cleaned, JSON.stringify(t)).toBe(b.cleaned);
    expect(a.findings, JSON.stringify(t)).toEqual(b.findings);
    expect(a.payloads, JSON.stringify(t)).toEqual(b.payloads);
    expect(fmt(a.removed.counted)).toBe(fmt(b.removed.counted));
    expect(fmt(a.removed.silent)).toBe(fmt(b.removed.silent));
  };
  it('every §7.3 row and every corpus input', () => {
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
    const r = cleanHidden(s);
    expect(r.cleaned).toBe(s);
    expect(r.findings).toEqual([]);
  });
  it('cleans the Trojan Source line', () => {
    const r = cleanHidden('if (level != "user\u202E \u2066// admin check\u2069 \u2066") {');
    expect(r.cleaned).toBe('if (level != "user // admin check ") {');
  });
});

describe('per-class options', () => {
  const opt = (o: Partial<HiddenCharRules>) => ({ ...STRICT_HIDDEN_RULES, ...o });
  it('soft hyphen: remove-silent | remove-counted | keep', () => {
    const t = 'pay\u00ADpal.com';
    expect(cleanHidden(t).findings).toHaveLength(0);
    const counted = cleanHidden(t, opt({ softHyphen: 'remove-counted' }));
    expect(counted.cleaned).toBe('paypal.com');
    expect(counted.findings).toEqual([{ word: t, index: 0, removed: { softHyphen: 1 } }]);
    expect(cleanHidden(t, opt({ softHyphen: 'keep' })).cleaned).toBe(t);
  });
  it('word-break hints: keep', () => {
    const thai = 'ภาษา\u200Bไทย';
    expect(cleanHidden(thai).cleaned).toBe('ภาษาไทย');
    expect(cleanHidden(thai, opt({ wordBreakHint: 'keep' })).cleaned).toBe(thai);
  });
  it('joiner inside a Latin/Cyrillic word: keep', () => {
    const t = 'Auf\u200Clage ко\u200Dт';
    expect(cleanHidden(t).findings).toHaveLength(2);
    expect(cleanHidden(t, opt({ joinerInWord: 'keep' })).cleaned).toBe(t);
    // other zero-width characters inside a word are still removed
    expect(cleanHidden('fr\u200Bee', opt({ joinerInWord: 'keep' })).cleaned).toBe('free');
  });
  it('zero-width run threshold and isolated runs', () => {
    const three = `a ${'\u200B'.repeat(3)} b`;
    expect(cleanHidden(three).findings).toHaveLength(0);
    expect(cleanHidden(three, opt({ zeroWidthRunThreshold: 3 })).findings).toHaveLength(1);
    expect(cleanHidden(three, opt({ isolatedZeroWidth: 'keep' })).cleaned).toBe(three);
  });
  it('bidi: embeddings and overrides counted apart from marks and isolates', () => {
    for (const c of ['\u202A', '\u202B', '\u202C', '\u202D', '\u202E']) {
      expect(cleanHidden(`abc${c}def`).removed.counted).toEqual({ bidiOverride: 1 });
    }
    for (const c of ['\u200E', '\u200F', '\u2066', '\u2067', '\u2068', '\u2069']) {
      expect(cleanHidden(`abc${c}def`).removed.counted).toEqual({ bidiMark: 1 });
    }
    expect(cleanHidden('a\u202Eb\u200Ec').removed.counted).toEqual({
      bidiOverride: 1,
      bidiMark: 1,
    });
    const silent = cleanHidden('a\u202Eb\u200Ec', opt({ bidiMarks: 'remove-silent' }));
    expect(silent.removed.counted).toEqual({ bidiOverride: 1 });
    expect(silent.removed.silent).toEqual({ bidiMark: 1 });
    expect(
      cleanHidden('של\u200Fום\u202E', opt({ bidiMarksInRtlText: 'remove-counted' })).removed
        .counted,
    ).toEqual({
      bidiOverride: 1,
      bidiMark: 1,
    });
  });

  it('bidi marks in RTL text, overrides, tags, selectors, payload decoding', () => {
    expect(
      cleanHidden('שלום\u200F abc', opt({ bidiMarksInRtlText: 'remove-counted' })).cleaned,
    ).toBe('שלום abc');
    expect(cleanHidden('abc\u202Edef', opt({ bidiOverrides: 'keep' })).findings).toHaveLength(0);
    const smuggled = 'hi' + tags('ABC');
    expect(cleanHidden(smuggled, opt({ tags: 'keep' })).cleaned).toBe(smuggled);
    expect(cleanHidden(smuggled, opt({ decodePayloads: false })).payloads).toEqual([]);
    expect(
      cleanHidden('x\u{E0110}', opt({ variationSelectors: 'remove-silent' })).findings,
    ).toEqual([]);
  });
  it('removes the invisible format characters upstream flags and the prototype misses', () => {
    const t = 'a\u{1BCA0}b\u{1D173}c\u{13430}d';
    expect(cleanHidden(t).cleaned).toBe('abcd');
    expect(cleanHidden(t).removed.counted).toEqual({ otherInvisible: 3 });
  });
  it('invisible vowel signs: kept in their own script only', () => {
    expect(cleanHidden('a\u17B4b').cleaned).toBe('ab');
    expect(cleanHidden('ក\u17B4').cleaned).toBe('ក\u17B4');
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
    expect(cleanHidden(input).cleaned).toBe(want);
  });

  it('tab, LF and CR stay; VT and FF become a space', () => {
    const r = cleanHidden('a\tb\nc\r\nd');
    expect(r.cleaned).toBe('a\tb\nc\r\nd');
    expect(r.edits).toEqual([]);
    expect(cleanHidden('end\fstart\vx\u0085y').cleaned).toBe('end start x y');
  });

  it('counted per class, a word once; silent and keep by rule', () => {
    const r = cleanHidden('fr\bee a\u0007b\u0007 plain');
    expect(r.removed.counted.controlChar).toBe(3);
    expect(r.findings.map((f) => f.index)).toEqual([0, 6]);
    const s = cleanHidden('a\bb', { ...STRICT_HIDDEN_RULES, controlChars: 'remove-silent' });
    expect(s.cleaned).toBe('ab');
    expect(s.removed.silent.controlChar).toBe(1);
    expect(s.findings).toEqual([]);
    expect(cleanHidden('a\bb', { ...STRICT_HIDDEN_RULES, controlChars: 'keep' }).cleaned).toBe(
      'a\bb',
    );
    expect(cleanHidden('a\b​b').findings).toHaveLength(1);
  });

  it("a control can't split a run past the run rules", () => {
    const r = cleanHidden('a​\b​\b​\b​b');
    expect(r.cleaned).toBe('ab');
    expect(r.removed.counted.zeroWidthRun).toBe(4);
  });

  it('edits are on input offsets and rebuild the cleaned text', () => {
    const input = 'one\u0007 tw​o\u001b[1m three‮ fo\bur';
    const r = cleanHidden(input);
    expect(r.cleaned).toBe('one two three four');
    let out = '';
    let cursor = 0;
    for (const e of r.edits) {
      expect(e.start).toBeGreaterThanOrEqual(cursor);
      out += input.slice(cursor, e.start) + e.value;
      cursor = e.end;
    }
    expect(out + input.slice(cursor)).toBe(r.cleaned);
  });

  it('linear on many controls', () => {
    const t0 = performance.now();
    expect(cleanHidden('a\b'.repeat(200_000)).cleaned).toBe('a'.repeat(200_000));
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});
