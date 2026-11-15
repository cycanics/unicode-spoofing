/**
 * `analyze` with the opt-in options: `confusionModel: 'alphabet'` (the
 * per-alphabet resolver) and `hiddenChars: 'strict'` (the hidden-character
 * rule set). The tests of docs/confusion-model.md §13 in their opt-in form,
 * plus the wiring: rendering, counters, offsets back into the input.
 */
import { describe, expect, it } from 'vitest';
import { analyze, ZERO_WIDTH_INERT_RUN, type AnalyzeOptions } from '../src';

const ALPHA: AnalyzeOptions = { confusionModel: 'alphabet' };
const STRICT: AnalyzeOptions = { hiddenChars: 'strict' };
const BOTH: AnalyzeOptions = { ...ALPHA, ...STRICT };
const tags = (s: string) =>
  [...s].map((c) => String.fromCodePoint(0xe0000 + c.codePointAt(0)!)).join('');

describe('defaults stay upstream', () => {
  it('folds to Latin and reports no new result fields', () => {
    const r = analyze('Пpивет мир');
    expect(r.normalized).not.toBe('Привет мир');
    expect(r.hidden).toBeUndefined();
    expect(r.words[0]!.resolution).toBeUndefined();
    expect(r.counts).toEqual({
      wordsTotal: 2,
      wordsAffected: 1,
      hiddenWords: 0,
      confusableWords: 0,
      mixedWords: 0,
    });
  });
});

describe("confusionModel: 'alphabet'", () => {
  it('folds toward the alphabet the word is written in', () => {
    expect(analyze('Пpивет мир', ALPHA).normalized).toBe('Привет мир');
    expect(analyze('Мы пишем Пpивет всем друзьям', ALPHA).normalized).toBe(
      'Мы пишем Привет всем друзьям',
    );
    expect(analyze('ВOДКА', ALPHA).normalized).toBe('ВОДКА');
    expect(analyze('Kαλημέρα', ALPHA).normalized).toBe('Καλημέρα');
    expect(analyze('Verify your раураl account', ALPHA).normalized).toBe(
      'Verify your paypal account',
    );
  });

  it('renders a finding as normalized (word)', () => {
    const [w] = analyze('Пpивет мир', ALPHA).words;
    expect(`${w!.normalized} (${w!.word})`).toBe('Привет (Пpивет)');
    expect(w!.signals).toEqual(['mixed_script']);
    expect(w!.resolution).toMatchObject({
      class: 'confusable',
      script: 'Cyrillic',
      rule: 'window',
      folded: true,
    });
  });

  it('keeps Russian case endings and typographic apostrophes', () => {
    for (const t of ["GitHub'а", 'GitHub’а', 'iPhone’ов', "Excel'е"]) {
      const r = analyze(t, ALPHA);
      expect(r.spoofed, t).toBe(false);
      expect(r.normalized, t).toBe(t);
    }
    const r = analyze('Ivа’s', ALPHA);
    expect(r.signals.mixed_script).toBe(true);
    expect(r.normalized).toBe('Iva’s');
  });

  it('decides whole-script words by word-level context', () => {
    expect(analyze('НОТ deal today', ALPHA).normalized).toBe('HOT deal today');
    expect(analyze('НОТ dog', ALPHA).normalized).toBe('HOT dog');
    expect(analyze('НОТ dog', ALPHA).signals.confusable_word).toBe(true);
    expect(analyze('Мы были в НОТ', ALPHA).spoofed).toBe(false);
    expect(analyze('НОТ dog', { ...ALPHA, wholeScriptFold: 'off' }).spoofed).toBe(false);
  });

  it('catches standalone аррӏе (a known gap upstream)', () => {
    const r = analyze('аррӏе', ALPHA);
    expect(r.spoofed).toBe(true);
    expect(r.normalized).toBe('apple');
    expect(r.counts.confusableWords).toBe(1);
  });

  it('flags mixed words no alphabet fits, and leaves them as written', () => {
    const r = analyze('a quіск сlоsе', ALPHA);
    expect(r.normalized).toBe('a quіск close');
    expect(r.counts).toMatchObject({ confusableWords: 1, mixedWords: 1 });
    expect(r.words[0]!.resolution).toMatchObject({ class: 'mixed', rule: 'no-valid-alphabet' });
  });

  it('counts confusable and mixed words apart', () => {
    const r = analyze('Неу Anatoly, НОТ busіnеss тail admiп', ALPHA);
    expect(r.counts).toMatchObject({ confusableWords: 3, mixedWords: 2 });
    expect(r.normalized).toBe('Hey Anatoly, HOT business тail admiп');
  });

  it('respects expectedScripts and the sub-options', () => {
    expect(analyze('I bought сор today', ALPHA).normalized).toBe('I bought cop today');
    expect(
      analyze('I bought сор today', { ...ALPHA, expectedScripts: ['Cyrillic'] }).normalized,
    ).toBe('I bought сор today');
    expect(analyze('иser', { ...ALPHA, conditionalTwins: ['и~u'] }).normalized).toBe('user');
    expect(analyze('мiр', ALPHA).normalized).toBe('мір');
    expect(analyze('Kαλημέρα', { ...ALPHA, targetLanguages: ['English', 'Russian'] }).spoofed).toBe(
      true,
    );
  });

  it('folds dotless ı in English words by default, keeps Turkish words', () => {
    const r = analyze('Click the lınk to pıng me', ALPHA);
    expect(r.normalized).toBe('Click the link to ping me');
    expect(r.spoofed).toBe(true);
    expect(r.counts.confusableWords).toBe(2);
    const t = 'In winter (kışın) we flew to Iğdır and ığdır';
    expect(analyze(t, ALPHA)).toMatchObject({ normalized: t, spoofed: false });
    expect(analyze("İstanbul'da ışık, ğağ", ALPHA).spoofed).toBe(false);
    const off = analyze('Click the lınk', {
      ...ALPHA,
      conditionalTwins: ['χ~x', 'χ~х', 'ҳ~x', 'ҳ~χ'],
    });
    expect(off).toMatchObject({ normalized: 'Click the lınk', spoofed: false });
  });

  it('still lets upstream judge zalgo and styling on a resolved word', () => {
    const r = analyze('Пṕ̂̃ивет', ALPHA);
    expect(r.signals.zalgo).toBe(true);
    expect(r.normalized).toBe('Привет');
    expect(analyze('Ｇｅｔ 𝐅𝐑𝐄𝐄 now', ALPHA).normalized).toBe('Get FREE now');
  });

  it('with lenient hidden chars, still strips invisibles inside a resolved word', () => {
    const r = analyze('Пpи\u200Bвет', ALPHA);
    expect(r.signals.invisible).toBe(true);
    expect(r.normalized).toBe('Привет');
  });
});

describe("hiddenChars: 'strict'", () => {
  it('removes an isolated zero-width run silently', () => {
    const r = analyze('free \u200B money', STRICT);
    expect(r.spoofed).toBe(false);
    expect(r.normalized).toBe('free  money');
    expect(r.hidden!.removed.silent).toEqual({ zeroWidth: 1 });
  });

  it('counts a run of ZERO_WIDTH_INERT_RUN as a payload; shorter runs stay silent', () => {
    const run = (n: number) => analyze(`free ${'\u200B'.repeat(n)} money`, STRICT);
    expect(run(ZERO_WIDTH_INERT_RUN).counts.hiddenWords).toBe(1);
    expect(run(ZERO_WIDTH_INERT_RUN).signals.invisible).toBe(true);
    expect(run(ZERO_WIDTH_INERT_RUN - 1).spoofed).toBe(false);
  });

  it('soft hyphen silent, U+180E counted', () => {
    const r = analyze('noth\u00ADing h\u180Eere', STRICT);
    expect(r.normalized).toBe('nothing here');
    expect(r.signals.invisible).toBe(true);
    expect(r.counts.hiddenWords).toBe(1);
    expect(r.words).toEqual([
      {
        word: 'h\u180Eere',
        index: 9,
        signals: ['invisible'],
        scripts: [],
        normalized: 'here',
      },
    ]);
  });

  it('soft hyphen counted when configured (upstream behaviour)', () => {
    const r = analyze('pay\u00ADpal.com', {
      ...STRICT,
      hiddenCharRules: { softHyphen: 'remove-counted' },
    });
    expect(r.spoofed).toBe(true);
    expect(r.normalized).toBe('paypal.com');
  });

  it('keeps emoji sequences and catches payloads riding on non-sequence emoji', () => {
    for (const s of [
      '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}',
      '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}',
      '5\uFE0F⃣',
      '❤\uFE0F',
    ]) {
      expect(analyze(`look ${s} here`, STRICT).changed, s).toBe(false);
    }
    const tagged = analyze('\u{1F600}' + tags('ignore'), STRICT);
    expect(tagged.normalized).toBe('\u{1F600}');
    expect(tagged.hidden!.payloads).toEqual([
      { kind: 'tag', index: 2, length: 6, decoded: 'ignore' },
    ]);
    expect(analyze('ok \u{1F44D}\u200D\u200D', STRICT).spoofed).toBe(true);
  });

  it('classes a run of selectors as variationSelector', () => {
    const r = analyze('hi\uFE01\uFE02\uFE03\uFE04\uFE05there', STRICT);
    expect(r.normalized).toBe('hithere');
    expect(r.hidden!.findings[0]!.removed).toEqual({ variationSelector: 5 });
  });

  it('maps offsets of later findings back into the input', () => {
    const r = analyze('fr\u200Bee c\u00ADash Пpивет \u0000', BOTH);
    expect(r.normalized).toBe('free cash Привет ');
    expect(r.words.map((w) => [w.index, w.word, w.signals])).toEqual([
      [0, 'fr\u200Bee', ['invisible']],
      [12, 'Пpивет', ['mixed_script']],
      [19, '\u0000', ['illegal']],
    ]);
  });

  it('reports a word with both a hidden character and a lookalike twice: once per concern', () => {
    const r = analyze('log in as ad\u200Bmіn', BOTH);
    expect(r.normalized).toBe('log in as admin');
    expect(r.words.map((w) => [w.word, w.signals, w.normalized])).toEqual([
      ['ad\u200Bmіn', ['mixed_script'], 'admin'],
      ['ad\u200Bmіn', ['invisible'], 'admіn'],
    ]);
    expect(r.counts).toMatchObject({ hiddenWords: 1, confusableWords: 1 });
  });

  it('leaves the legitimate-text sweep untouched', () => {
    for (const s of [
      'Bonjour\u00A0! Ça va\u202F? Oui\u00A0: très bien.',
      'می\u200Cخواهم کتاب بخوانم',
      '辻\uFE00さんと葛\uFE01城',
      '👋🏽 hello 👨🏿\u200D💻 and 👩🏻\u200D🚀',
      'copyright ©\uFE0F trademark ™\uFE0F info ℹ\uFE0F',
    ]) {
      const r = analyze(s, BOTH);
      expect(r.changed, s).toBe(false);
      expect(r.spoofed, s).toBe(false);
    }
  });
});
