/**
 * Decision 40d (owner, 2026-11-17): everything uses the requested targets (the
 * call's `targetLanguages`) with all applied pair changes; supported but
 * unrequested languages and the unmodified twin table only build data.
 * One block per finding of requested-targets-audit.md (V1–V12, L1): a
 * restricted `targetLanguages` and an added or removed pair, outputs asserted.
 */
import { describe, expect, it } from 'vitest';
import { analyze, buildLookalikes, type AnalyzeOptions } from '../src';
import type { TargetLanguage } from '../src/languages';

const T = (...targetLanguages: TargetLanguage[]): AnalyzeOptions => ({
  confusionModel: 'alphabet',
  targetLanguages,
});
const ER = T('English', 'Russian');
const N = { neutralAlphabet: true };
const norm = (t: string, o: AnalyzeOptions) => analyze(t, o).normalized;
const spoofed = (t: string, o: AnalyzeOptions) => analyze(t, o).spoofed;
const add = (p: NonNullable<Parameters<typeof buildLookalikes>[0]>['add']) =>
  buildLookalikes({ add: p });
const remove = (p: NonNullable<Parameters<typeof buildLookalikes>[0]>['remove']) =>
  buildLookalikes({ remove: p });

describe('decision 40d', () => {
  it('V1: a case anomaly folds into Latin only when Latin is requested', () => {
    expect(norm('Это palI тест', T('Russian'))).toBe('Это palI тест');
    expect(norm('Это palI тест', T('Russian', 'English'))).toBe('Это pall тест');
  });
  it('V2: only requested languages make a word legitimate', () => {
    expect(norm('сір', ER)).toBe('cip');
    expect(norm('сір', T('English', 'Russian', 'Ukrainian'))).toBe('сір');
    expect(norm('јор', ER)).toBe('jop');
    expect(norm('јор', T('English', 'Serbian'))).toBe('јор');
  });
  it('V3: the palochka digraph exception belongs to a requested language that has it', () => {
    expect(norm('рахӀ', ER)).toBe('paxl');
    expect(norm('рахӀ', T('English', 'Russian', 'Caucasian'))).toBe('рахӀ');
  });
  it('V4: words of unrequested scripts cast no window vote', () => {
    // The window no longer decides `coр`: 36e (ordering B): two requested alphabets: no whole-word mapping; the last
    // one-letter piece is reported, not converted.
    expect(norm('соль αβγδεζηθ coр', ER)).toBe('соль αβγδεζηθ coр');
    expect(norm('соль αβγδεζηθ coр', T('English', 'Russian', 'Greek'))).toBe('соль αβγδεζηθ coр');
  });
  it('V5: European letters are donors unless European is requested; a removed pair is no donor', () => {
    expect(norm('þaypal', ER)).toBe('paypal');
    expect(norm('þaypal', T('English', 'European'))).toBe('þaypal');
    expect(norm('þaypal', { ...ER, lookalikes: remove({ English: [['þ', 'p']] }) })).toBe('þaypal');
  });
  it('V6: a neutral’s plain form is English letters; inside a requested target’s word, its twins', () => {
    expect(norm('𝐩𝐚𝐲𝐩𝐚𝐥', { ...T('Russian'), ...N })).toBe('paypal');
    expect(norm('Ⅻ', { ...T('Russian'), ...N })).toBe('XII');
    expect(norm('пⓐпа', { ...T('Russian'), ...N })).toBe('папа');
  });
  it('V7: the twin step reads the effective mapping (removed pairs)', () => {
    const noA = remove({
      Russian: [
        ['a', 'а'],
        ['A', 'А'],
      ],
    });
    expect(norm('пⓐпа', { ...T('Russian'), ...N, lookalikes: noA })).toBe('пaпа');
    const noX = remove({
      Russian: [
        ['X', 'Х'],
        ['x', 'х'],
      ],
    });
    expect(norm('Ⅹорошо', { ...T('Russian'), ...N })).toBe('Хорошо');
    expect(norm('Ⅹорошо', { ...T('Russian'), ...N, lookalikes: noX })).toBe('Xорошо');
  });
  it('V8: proof letters come from the effective mapping', () => {
    // 36e (ordering B): two requested alphabets: no whole-word mapping; `coр` is reported, whatever the
    // context words' proof letters.
    expect(norm('ԁом ԁом coр', ER)).toBe('ԁом ԁом coр');
    expect(norm('ԁом ԁом coр', { ...ER, lookalikes: remove({ English: [['ԁ', 'd']] }) })).toBe(
      'ԁом ԁом coр',
    );
  });
  it('V9: under the alphabet model only the resolver folds letters (no static skeleton)', () => {
    expect(norm('cɑt', ER)).toBe('cat');
    expect(norm('cɑt', T('Russian'))).toBe('cɑt');
    expect(norm('cɑt', { ...ER, lookalikes: remove({ English: [['ɑ', 'a']] }) })).toBe('cɑt');
    expect(norm('ꞵeta', ER)).toBe('ꞵeta');
    expect(norm('ꞵeta', { ...ER, lookalikes: add({ English: [['ꞵ', 'b']] }) })).toBe('beta');
  });
  it('V10: "holds a target letter" reads the requested scripts', () => {
    expect(analyze('αβγაბგ', ER).words).toEqual([]);
    expect(analyze('αβγაბგ', T('English', 'Greek')).words[0]!.signals).toEqual([
      'mixed_non_legitimate',
    ]);
  });
  it('V11: 41b’s target characters are the requested scripts’', () => {
    expect(norm('কলকাতা ৪α কলকাতা', ER)).toBe('কলকাতা ৪α কলকাতা');
    expect(norm('কলকাতা ৪α কলকাতা', T('English', 'Greek'))).toBe('কলকাতা 8α কলকাতা');
  });
  it('V12: Russian case endings apply only when Russian is requested', () => {
    expect(norm("pаypal'ах", ER)).toBe("paypal'ах");
    expect(norm("pаypal'ах", T('English'))).toBe("paypal'ax");
  });
  it('L1: the suffix lists are read under the effective mapping; a convertible chunk is no affix', () => {
    const m = add({ Russian: [['m', 'м']] });
    // 36e: the two-letter last piece `om` is reported, not converted, with or without m~м.
    expect(norm('это ψтестom так', { ...ER, lookalikes: m })).toBe('это ψтестom так');
    expect(spoofed('это ψтестom так', { ...ER, lookalikes: m })).toBe(false);
    expect(norm('это ψтестom так', ER)).toBe('это ψтестom так');
  });

  it('a removed pair changes a whole-word fold too', () => {
    // 36e (ordering B): two requested alphabets: no whole-word mapping; `Windowsах` stays either way.
    expect(norm('Windowsах', ER)).toBe('Windowsах');
    expect(norm('Windowsах', { ...ER, lookalikes: remove({ English: [['х', 'x']] }) })).toBe(
      'Windowsах',
    );
  });
});

describe('decision 41e: several valid targets and no context: the primary target', () => {
  it('a tied mixed word: the primary target, else the next requested', () => {
    // 36e (ordering B): two requested alphabets: no whole-word mapping; a tie of one-letter pieces is
    // reported (no side holds more letters).
    for (const o of [T('English', 'Russian', 'Greek'), T('Russian', 'English', 'Greek')])
      expect(norm('aа', o)).toBe('aа');
  });
  it('a donor word several targets take: the primary target, else the next requested', () => {
    expect(norm('ᴀᴅᴍɪɴ', T('English', 'Russian'))).toBe('admin');
  });
});

describe('decision 40e: language rules are not enforced, they only narrow targets', () => {
  it('a whole word of a requested script that breaks a rule stays (no evidence)', () => {
    for (const order of [
      T('English', 'Russian', 'Greek'),
      T('Russian', 'English', 'Greek'),
      T('Greek', 'Russian', 'English'),
    ]) {
      expect(norm('σσ', order)).toBe('σσ');
      expect(norm('προσ', order)).toBe('προσ');
      expect(norm('το σσ είναι', order)).toBe('το σσ είναι');
    }
    expect(norm('Ьр', T('English', 'Russian'))).toBe('Ьр');
  });
  it('a rule still narrows a fold’s target (`paᏏy` → no Cyrillic `раЬу`)', () => {
    expect(norm('paᏏy', ER)).toBe('paᏏy');
  });
  it('case-anomaly evidence is no language rule: kept', () => {
    expect(norm('раураӏ', ER)).toBe('paypal');
  });
});

describe('decision 40f: pairs into a target of the donor’s own script; ſ and ϲ are ordinary donors', () => {
  const S: AnalyzeOptions = { hiddenChars: 'strict', confusionModel: 'alphabet' };
  it('the long s folds into English s, a spoof', () => {
    expect(norm('ſecure', S)).toBe('secure');
    expect(spoofed('ſecure', S)).toBe(true);
    expect(norm('Waſſer', S)).toBe('Wasser');
  });
  it('the lunate sigma: English c, Russian/Ukrainian с, Greek σ (no final form invented)', () => {
    expect(norm('ϲat', S)).toBe('cat');
    expect(norm('Ϲat', S)).toBe('Cat');
    expect(norm('ϲлон', S)).toBe('слон');
    expect(norm('λογοϲ', S)).toBe('λογοσ');
    expect(norm('ΣΟϹ', S)).toBe('ΣΟΣ');
    expect(spoofed('ϲat', S)).toBe(true);
  });
  it('they follow the requested targets and applied pairs (40d)', () => {
    expect(norm('ſecure', { ...S, targetLanguages: ['Russian'] })).toBe('ſecure');
    expect(norm('ϲat', { ...S, lookalikes: remove({ English: [['ϲ', 'c']] }) })).toBe('ϲat');
    expect(norm('λογοϲ', { ...S, targetLanguages: ['English', 'Russian'] })).toBe('λογοϲ');
  });
  it('a lone ſ converts like any donor (41d), a spoof', () => {
    expect(norm('ſ', S)).toBe('s');
    expect(spoofed('ſ', S)).toBe(true);
    expect(norm('a ſ b', S)).toBe('a s b');
    expect(norm('ſ', { ...S, targetLanguages: ['Russian'] })).toBe('ſ');
  });
  it('the long s reads s on every path, the default (upstream) one too', () => {
    expect(norm('ſecure', { hiddenChars: 'strict' })).toBe('secure');
    expect(spoofed('ſecure', { hiddenChars: 'strict' })).toBe(true);
    expect(norm('ſ', { hiddenChars: 'strict' })).toBe('s');
    expect(norm('ſecure', {})).toBe('secure');
    expect(spoofed('ſecure', {})).toBe(true);
    expect(norm('Waſſer', {})).toBe('Wasser');
  });
  it('the loop guard: a donor in a pack is never a letter of that language', () => {
    const european = buildLookalikes().pack.European ?? [];
    expect(european.some(([d]) => d === 'ı')).toBe(false);
    expect((buildLookalikes().pack.English ?? []).some(([d, y]) => d === 'ı' && y === 'i')).toBe(
      true,
    );
  });
});

describe('decision 41m: word majority needs a sizable majority', () => {
  it('fewer than 3 letters or 2/3 of the word: the request order decides', () => {
    // 36e (ordering B): two requested alphabets: no whole-word mapping; the inner one-letter piece converts
    // toward the alphabet holding more letters, whatever the request order.
    expect(norm('сoр', T('English', 'Russian'))).toBe('сор');
    expect(norm('Тoр', T('English', 'Russian'))).toBe('Тор');
    expect(norm('сoр', T('Russian', 'English'))).toBe('сор');
    expect(norm('Тoр', T('Russian', 'English'))).toBe('Тор');
  });
  it('a sizable majority still decides', () => {
    expect(norm('pаypal', T('Russian', 'English'))).toBe('paypal');
    // 36e (ordering B): two requested alphabets: no whole-word mapping; the last piece is reported.
    expect(norm('Москвa', T('English', 'Russian'))).toBe('Москвa');
  });
  it('the thresholds are options (`ladder`)', () => {
    const o = {
      ...T('English', 'Russian'),
      ladder: { wordMajorityMinLetters: 2, wordMajorityMinShare: 0.5 },
    };
    expect(norm('сoр', o)).toBe('сор');
  });
});

describe('decision 41n: a mixed word converts only into a target holding one of its letters', () => {
  const orders = [
    ['English', 'Russian', 'Ukrainian', 'Greek'],
    ['Ukrainian', 'Russian', 'English', 'Greek'],
    ['Greek', 'Ukrainian', 'English', 'Russian'],
  ] as const;
  it.each(orders)('%s first: Greek+Latin math words go to Greek, never Cyrillic', (...tl) => {
    const o = T(...tl);
    // 36e (ordering B): two requested alphabets: no whole-word mapping; Greek+Latin words are reported.
    expect(norm('where ΠI is', o)).toBe('where ΠI is');
    expect(norm('where τA is', o)).toBe('where τA is');
    expect(norm('where iπ is', o)).toBe('where iπ is');
    expect(norm('ᎪᏢᏢꓡꓰ', o)).toBe('APPLE');
  });
  it('no target holding a letter: the chunk rule (kept, not a spoof)', () => {
    const o = T('English', 'Russian');
    for (const t of ['where ΠI is', 'where τA is', 'where iπ is']) expect(norm(t, o), t).toBe(t);
    expect(norm('ᎪᏢᏢꓡꓰ', o)).toBe('APPLE');
  });
});
