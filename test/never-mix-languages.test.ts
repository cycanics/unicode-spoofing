/**
 * NEVER MIX LANGUAGES (owner, 2026-11-19): targets, folds, contexts and votes are languages,
 * never alphabets; Russian and Ukrainian are two languages.
 */
import { describe, expect, it } from 'vitest';
import { analyze, resolveWord, type AnalyzeOptions } from '../src';

const A: AnalyzeOptions = { hiddenChars: 'strict', confusionModel: 'alphabet' };
const ER: AnalyzeOptions = { ...A, targetLanguages: ['English', 'Russian'] };
const word = (t: string, o = A) => analyze(t, o).words[0];

describe('never mix languages: context votes are languages', () => {
  it('decision 37: a lone cap-height stroke is the Roman numeral I in any context, before the ladder', () => {
    // Shared-letter Russian words vote Russian and Ukrainian: still no Ukrainian `І` (review 27 B1).
    for (const t of ['Он ǀ она', 'Пётр ǀ пришёл', 'там ǀ там', 'Петро ǀ прийшов', 'Он ꓲ она']) {
      const w = word(t);
      expect(w?.normalized, t).toBe('I');
      expect(w?.resolution, t).toMatchObject({ language: 'English', rule: 'one-target' });
    }
  });
  it('decision 37 (owner): with no Latin language requested a lone stroke is kept and reported', () => {
    for (const tl of [['Russian', 'Ukrainian'], ['Ukrainian'], ['Greek']] as const)
      for (const t of ['Он ǀ она', 'Он ꓲ она']) {
        const r = analyze(t, { ...A, targetLanguages: tl });
        expect(r.normalized, `${t} ${tl.join('+')}`).toBe(t);
        expect(r.spoofed, `${t} ${tl.join('+')}`).toBe(true);
        expect(
          r.words.map((w) => w.signals),
          `${t} ${tl.join('+')}`,
        ).toEqual([['confusable_word']]);
      }
    // A stroke of another writing in text of its own script stays unreported (41b).
    expect(analyze('هذا ا كتاب', { ...A, targetLanguages: ['Russian'] }).words).toEqual([]);
  });
  it('a precomposed letter an alphabet lists is a letter of its own: `ё` is Russian only', () => {
    // Review 27 B3: `ё` never passes as Ukrainian `е`.
    expect(word('Ещё ǀ всё')?.resolution?.context.neighbours).toEqual(['Russian']);
    expect(analyze('Ещё ΙΗ всё', A).normalized).toBe('Ещё ΙΗ всё');
    // Written decomposed (`е` + U+0308) it is the same letter.
    expect(word('Еще\u0308 ǀ все\u0308')?.resolution?.context.neighbours).toEqual(['Russian']);
    const UK = { ...A, targetLanguages: ['Ukrainian'] } as AnalyzeOptions;
    expect(analyze('Ещё Ⅱ всё', UK).normalized).toBe('Ещё II всё');
  });
  it('a word votes for the requested languages holding all its letters', () => {
    // Ukrainian-only letters: Ukrainian; Russian-only: Russian; shared: both.
    expect(word('Петро ǀ пішов')?.resolution?.context.neighbours).toEqual(['Ukrainian']);
    expect(word('Мы ǀ там')?.resolution?.context.neighbours).toEqual(['Russian']);
    expect(word('там ǀ там')?.resolution?.context.neighbours).toEqual(['Russian', 'Ukrainian']);
  });
  it('Ukrainian words are no Russian context when Ukrainian is not requested', () => {
    const w = word('Петро ǀ пішов', ER);
    expect(w?.resolution?.context.neighbours).toEqual([]);
  });
  it('a mixed word votes for no language', () => {
    // `management‑доступ` is no one language's: no neighbours step; the Russian window keeps `по`.
    const t =
      'виртуальные линк соединения между ними; management‑доступ по SSH. Адресацию и всё остальное';
    expect(analyze(t, A).normalized).toBe(t);
  });
  it('resolveWord takes the context as languages; an alphabet name throws', () => {
    expect(resolveWord('НОТ', { neighbours: 'English' })).toMatchObject({ language: 'English' });
    expect(resolveWord('НОТ', { neighbours: ['English'], window: 'English' })?.normalized).toBe(
      'HOT',
    );
    expect(() => resolveWord('НОТ', { neighbours: 'Latin' as never })).toThrow(RangeError);
    expect(() => resolveWord('НОТ', { window: 'Cyrillic' as never })).toThrow(RangeError);
    // At entry, whatever the word (no early exit first).
    expect(() => resolveWord('hello', { neighbours: 'Cyrillic' as never })).toThrow(RangeError);
  });
});

describe('never mix languages: ordering B and 36e count languages', () => {
  it('a Cyrillic word of Russian-only and Ukrainian-only letters holds two languages', () => {
    // Ordering B: 36e only, no whole-word fold; one alphabet, no border: left as written.
    expect(analyze('мыі', A).normalized).toBe('мыі');
  });
});

describe("never mix languages: neutrals, donors and 36e twins come from the word's language", () => {
  it('no Ukrainian letter into a Russian word', () => {
    // `ы` makes the word Russian: Russian has no twin of `i`, so nothing converts (41j: reported).
    expect(analyze('былⓘ', A).normalized).toBe('былi');
    expect(analyze('выⅰграть', A).normalized).toBe('выiграть');
    expect(analyze('мыiр', A).normalized).toBe('мыiр');
    // A word of letters Russian and Ukrainian share fits both: Ukrainian takes `i`.
    expect(analyze('сьогоднⓘ', A).normalized).toBe('сьогодні');
    expect(analyze('мiр', A).normalized).toBe('мір');
  });
  it('a donor folds into the language its own letters are (letters of none aside)', () => {
    expect(analyze('það', A).normalized).toBe('pað');
  });
});

describe('review 27: toLang, unrequested languages, lone foreign letters, lenient affixes', () => {
  const words = (t: string, o: AnalyzeOptions) => {
    const out: [string, string, string | null | undefined, readonly string[] | undefined][] = [];
    analyze(t, o, { onWord: (_s, _e, c, r, why) => out.push([c, r, why.toLang, why.signals]) });
    return out;
  };
  it('a conversion with no letter carries no language (41l: digits carry no target)', () => {
    expect(words('Ꮞ04', A)).toEqual([['Ꮞ04', '404', null, ['confusable_word']]]);
    expect(words('Ошибка ৪০৪ тут', ER)[0]?.[2]).toBeNull();
  });
  it('no fold into an unrequested language: the Kelvin sign converts, the stroke stays (40d)', () => {
    const RU = { ...A, targetLanguages: ['Russian', 'Ukrainian'] } as AnalyzeOptions;
    expect(words('\u212aǀ', RU)).toEqual([['\u212aǀ', 'Kǀ', 'English', ['confusable_word']]]);
    // 40d: a neutral's own output names its language whatever is requested (`ℂ` → `C`, English).
    expect(words('ℂ', RU)).toEqual([['ℂ', 'C', 'English', ['confusable_word']]]);
  });
  it('NFC and NFD input read alike: decomposed `ё` is Russian only', () => {
    for (const t of ['Ещё ǀ всё', 'Ещё ΙΗ всё', 'Я її знаю', 'её', 'Пëтр'])
      for (const tl of [
        undefined,
        ['English', 'Russian'],
        ['Russian', 'Ukrainian'],
        ['Ukrainian'],
      ]) {
        const o = { ...A, ...(tl ? { targetLanguages: tl } : {}) } as AnalyzeOptions;
        const a = analyze(t.normalize('NFC'), o);
        const b = analyze(t.normalize('NFD'), o);
        expect(b.normalized.normalize('NFC'), t).toBe(a.normalized.normalize('NFC'));
        expect(b.spoofed, t).toBe(a.spoofed);
      }
    expect(words('Я її знаю', ER)[0]?.[1]).toBe('ïï');
  });
  it('lenient: the affix step reads the word with its invisible characters removed', () => {
    const LA: AnalyzeOptions = { confusionModel: 'alphabet' };
    for (const t of [
      'the a\u00adPа here',
      'the eypаl\u200bPа here',
      'the \u200deypаl\u200bPа\ufeff here',
    ])
      expect(analyze(t, LA).normalized, t).not.toMatch(/\u00ad|\u200b|\u200d|\ufeff/);
  });
});

describe('decision 41b by language: a word of one unrequested language in text of that language', () => {
  const EN = { ...A, targetLanguages: ['English'] } as AnalyzeOptions;
  const RU = { ...A, targetLanguages: ['Russian'] } as AnalyzeOptions;
  it('stays as written, unreported', () => {
    for (const [t, o] of [
      ['выполняет их по порядку', EN],
      ['Это НОТ новость', EN],
      ['the new on top', RU],
    ] as const) {
      const r = analyze(t, o);
      expect(r.normalized, t).toBe(t);
      expect(
        r.words.filter((w) => w.word !== 'раураl'),
        t,
      ).toEqual([]);
    }
  });
  it('a converted word is no own-language context: it votes as converted (41b)', () => {
    expect(analyze('read the ВООК НОТ now', EN).normalized).toBe('read the BOOK HOT now');
    expect(analyze('please сор хор now', EN).normalized).toBe('please cop xop now');
    expect(analyze('please ореп асе сосо now', EN).normalized).toBe('please open ace coco now');
    expect(analyze('the ΤΟΡ ΗΟΤ list', EN).normalized).toBe('the TOP HOT list');
  });
  it('the window counts per language, never merged (`мышь` Russian, `їжак` Ukrainian)', () => {
    expect(analyze('мышь the по cat їжак', EN).normalized).toBe('мышь the no cat їжак');
    expect(analyze('ђак the сор cat мышь', EN).normalized).toBe('ђак the cop cat мышь');
  });
  it('41b edge (owner): kept but reported unless both nearest words are of its own language', () => {
    const lookalike = (t: string, o: AnalyzeOptions) => {
      const r = analyze(t, o);
      expect(r.normalized, t).toBe(t);
      return r.words.map((w) => [w.word, w.signals]);
    };
    const WWL = ['whole_word_lookalike'];
    expect(lookalike('pay via Рау сейчас', EN)).toEqual([['Рау', WWL]]);
    expect(lookalike('run ехес сейчас rm', EN)).toEqual([['ехес', WWL]]);
    expect(lookalike('he said "по тебе скучаю" and left', EN)).toEqual([['по', WWL]]);
    // Kept by the window alone, both nearest words English: reported.
    expect(
      lookalike(
        'очень длинное русское предложение the рау is которое продолжается дальше здесь',
        EN,
      ),
    ).toEqual([['рау', WWL]]);
    expect(lookalike('это наш pay the счёт', RU)).toEqual([['pay', WWL]]);
    // The two nearest words must share one own language: Russian `мышь`, Macedonian `уеѕ`.
    // (`уеѕ` then sits between `сор` and `тут`, both Macedonian too: silent.)
    expect(lookalike('the мышь сор уеѕ тут ok', EN)).toEqual([['сор', WWL]]);
    // Between two words of its own language: silent.
    expect(lookalike('выполняет их по порядку', EN)).toEqual([]);
    expect(lookalike('the new on top', RU)).toEqual([]);
  });
  it('a word with a letter of a requested language, or in other text, still folds', () => {
    expect(analyze('This is НОТ news', EN).normalized).toBe('This is HOT news');
    expect(analyze('go to раураl now', EN).normalized).toBe('go to paypal now');
    expect(analyze('по', EN).normalized).toBe('no');
  });
});
