/**
 * Decisions 7b (strict runs the escape-sequence
 * parser), 30b category 8 (the micro sign), 41c (a digit look-alike is a spoof),
 * the symbol categories of neutral-symbols-review.md, `ו` → `i`.
 */
import { describe, expect, it } from 'vitest';
import { timed } from './helpers/growth';
import { analyze, type AnalyzeOptions } from '../src';
import { neutralInfo } from '../src/neutral';
import type { WordReason } from '../src/letters';

const A: AnalyzeOptions = { hiddenChars: 'strict', confusionModel: 'language' };

describe('decision 7b: strict analyze parses escape sequences', () => {
  it('removes whole control sequences', () => {
    expect(analyze('abc\x1b[31mred\x1b[0m', A).normalized).toBe('abcred');
    expect(analyze('ok \x1b[31mred\x1b[0m done', A).normalized).toBe('ok red done');
    expect(analyze('ok \x1b[31mred\x1b[0m done', { hiddenChars: 'strict' }).normalized).toBe(
      'ok red done',
    );
  });
  it('a backspace stays an illegal character (no erase)', () => {
    const r = analyze('It was norml\bal.', A);
    expect(r.normalized).toBe('It was normlal.');
    expect(r.signals.illegal).toBe(true);
  });
});

const L: AnalyzeOptions = { hiddenChars: 'strict' };
const norm = (t: string, o: AnalyzeOptions = A) => analyze(t, o).normalized;
const calls = (t: string, o: AnalyzeOptions = A) => {
  const out: [string, string, WordReason][] = [];
  analyze(t, o, { onWord: (_s, _e, c, r, why) => void out.push([c, r, why]) });
  return out;
};
const category = (ch: string) => neutralInfo(ch.codePointAt(0)!)?.category ?? null;

describe('decision 30b category 8: the micro sign is a unit prefix', () => {
  it.each([
    ['language', A],
    ['latin-fold', L],
  ] as const)('%s: at a word’s start and alone kept, not reported, the rest judged', (_m, o) => {
    for (const t of ['µs', 'µm', 'µℓ', 'µ', '5 µs here']) {
      expect(norm(t, o)).toBe(t);
      expect(calls(t, o)).toEqual([]);
    }
    expect(analyze('µраураl', o).spoofed).toBe(true);
  });
  it('elsewhere: English target u, Greek target μ, both a spoof', () => {
    expect(norm('caµera')).toBe('cauera');
    expect(analyze('caµera', A).spoofed).toBe(true);
    expect(norm('ϰαµα')).toBe('καμα');
    expect(analyze('αµα', A).spoofed).toBe(true);
  });
});

describe('decision 41c: digit look-alike conversion flags spoof', () => {
  it('Ꮞ, ৪, ੪', () => {
    for (const [c, d] of [
      ['Ꮞ', '4'],
      ['৪', '8'],
      ['੪', '8'],
    ]) {
      const r = analyze(`code ${c} here`, A);
      expect(r.normalized).toBe(`code ${d} here`);
      expect(r.spoofed).toBe(true);
    }
  });
});

describe('neutral-symbols-review.md: one category per group', () => {
  // List A: every row a unit (6) but the groups below.
  const NOT_UNIT = new Map<number, string>([
    [0x337b, 'separator'],
    [0x337c, 'separator'],
    [0x337d, 'separator'],
    [0x337e, 'separator'],
    [0x337f, 'separator'],
    [0x33c2, 'wordSign'],
    [0x33c7, 'wordSign'],
    [0x33d1, 'wordSign'],
    [0x33d2, 'wordSign'],
    [0x33d8, 'wordSign'],
    // Japanese squared abbreviations (oV, KK, PR).
    [0x3375, 'japaneseSquare'],
    [0x33cd, 'japaneseSquare'],
    [0x33da, 'japaneseSquare'],
  ]);
  const A_ROWS = [
    ...Array.from({ length: 0x33df - 0x3371 + 1 }, (_, k) => 0x3371 + k),
    0x32cc,
    0x32cd,
    0x32ce,
    0x2113,
    0x2103,
    0x2109,
  ];
  it.each(A_ROWS.map((cp) => [String.fromCodePoint(cp), NOT_UNIT.get(cp) ?? 'unit']))(
    'list A: %s is %s',
    (ch, c) => expect(category(ch)).toBe(c),
  );
  it.each([
    ['₨', 'wordSign'],
    ['℀', 'wordSign'],
    ['℁', 'wordSign'],
    ['℅', 'wordSign'],
    ['℆', 'wordSign'], // c/u
    ['㉐', 'wordSign'],
    ['㋏', 'wordSign'],
    ['🄪', 'visibleStyle'], // 〔S〕
    ['🄭', 'visibleStyle'],
    ['🄮', 'visibleStyle'],
    ['🅊', 'visibleStyle'],
    ['🅋', 'visibleStyle'],
    ['🅌', 'visibleStyle'],
    ['🅍', 'visibleStyle'],
    ['🅎', 'visibleStyle'],
    ['🅏', 'visibleStyle'],
    ['🅪', 'tailMark'],
    ['🅫', 'tailMark'],
    ['🅬', 'tailMark'],
    ['🆐', 'wordSign'],
  ])('list B: %s is %s', (ch, c) => expect(category(ch)).toBe(c));
  it('behaviour by category', () => {
    expect(norm('at 10㏂')).toBe('at 10a.m.');
    expect(norm('see ℅ me')).toBe('see c/o me');
    expect(norm('平成㍻年')).toBe('平成㍻年');
    expect(norm('Brand🅪 now')).toBe('Brand🅪 now');
    expect(norm('see 🄭 here')).toBe('see 🄭 here');
    expect(norm('x🄭y')).toBe('xCDy');
  });
});

describe('ו folds to i, not l', () => {
  it('paypaו → paypai', () => {
    expect(norm('paypaו')).toBe('paypai');
  });
});

describe('decision 41b: donor-only word next to its own script stays', () => {
  it('own-script neighbour on either side: stays', () => {
    for (const t of [
      'سال ۱۱ است',
      '↑ ۱۱٫۰ ۱۱٫۱ Bhushan Kumar',
      '- اتاق ۱۱\n- اتاق ۱۷\n- room 12',
      'در سال ۱۱ با iPhone 11 و ۱۷ نفر',
      'room ३ कमरा is',
      'שלום ו עולם',
    ])
      expect(norm(t), t).toBe(t);
  });
  it('native digits vote for their script (Jun. ۱۷, ۲۰۰۸)', () => {
    expect(norm('Jun. ۱۷, ۲۰۰۸')).toBe('Jun. ۱۷, ۲۰۰۸');
  });
  it('the left neighbour votes as converted; a right neighbour holding a donor does not vote', () => {
    expect(norm('call וו וו וו now')).toBe('call ii ii ii now');
  });
  it('a digit look-alike next to its own script in the word stays (१९३५)', () => {
    expect(norm('The year १९३५ in Devanagari')).toBe('The year १९३५ in Devanagari');
  });
  it('among target characters it always converts', () => {
    expect(norm('error ৪04')).toBe('error 804');
    expect(norm('paypaו here')).toBe('paypai here');
  });
  it('the context stops at the paragraph (decision 24)', () => {
    expect(norm('سال است\n\nroom ۱۱')).toBe('سال است\n\nroom 11'); // a number: 41l's digit reading
  });
});

describe('decision 41d: a donor converts standalone', () => {
  it('one donor letter or digit word folds', () => {
    expect(norm('in ו')).toBe('in i');
    expect(norm('the letter ꓮ')).toBe('the letter A');
    expect(norm('room ۱۱')).toBe('room 11'); // a number: 41l's digit reading
    expect(norm('room ۷۷')).toBe('room VV');
  });
});

describe('decision 41e: one target takes it, else the primary target', () => {
  it('single possible target wins regardless of context', () => {
    expect(norm('Мы видим ۷۷ здесь')).toBe('Мы видим VV здесь');
    expect(norm('это ꛛ тут')).toBe('это П тут');
    expect(norm('the ꛛ here')).toBe('the П here');
  });
  it('a text that is only a donor word: folded', () => {
    expect(norm('۷۷')).toBe('VV');
    expect(analyze('۷۷', A).words[0]!.resolution!.rule).toBe('one-target');
  });
  it('several targets and no context target: the primary target', () => {
    // ᛰ → Φ (Greek) and Ф (Russian): no context, the primary (English) cannot take it,
    // so the first of the targets that can is not chosen by order; with Russian first it is Ф.
    const ru: AnalyzeOptions = { ...A, targetLanguages: ['Russian', 'Greek', 'English'] };
    expect(norm('ᛰ', ru)).toBe('Ф');
    const el: AnalyzeOptions = { ...A, targetLanguages: ['Greek', 'Russian', 'English'] };
    expect(norm('ᛰ', el)).toBe('Φ');
  });
});

describe('decision 41b: a right neighbour whose donors its own letters keep needs no conversion', () => {
  it('a Persian word with ا or ه votes Persian', () => {
    expect(norm('Retrieved 2022-06-20. ↑ [۱] بایگانی‌شده در')).toBe(
      'Retrieved 2022-06-20. ↑ [۱] بایگانی‌شده در',
    );
    expect(norm('Reuters. ۱۷ شهریور ۱۴۰۵')).toBe('Reuters. ۱۷ شهریور ۱۴۰۵');
  });
  it('Arabic-Indic digits are Arabic (script Common, Arabic extension)', () => {
    expect(norm('شان دي. ٥:- دنايتروجن')).toBe('شان دي. ٥:- دنايتروجن');
    expect(norm('the ٥ here')).toBe('the 0 here'); // a lone number: 41l's digit reading
  });
});

describe('decisions 21, 22, 24: one context window, paragraph-bounded (context-scales audit)', () => {
  it('the dominant script reads ±majorityWindow words of the paragraph, not the whole ring', () => {
    // Russian text ahead, beyond ±10 words, does not make the dominant script Cyrillic.
    const t = 'the HОT one ' + Array(30).fill('слово').join(' ');
    expect(norm(t, { confusionModel: 'language' })).toContain('the HOT one');
  });
});

describe('decision 41b nearest words: one definition, the ladder uses it too', () => {
  it('a right neighbour that needs a conversion gives the ladder no vote', () => {
    const r = analyze('the сор pаypal sat', { confusionModel: 'language' });
    expect(r.words[0]!.resolution!.context.neighbours).toEqual([]);
    const q = analyze('the сор sat on', { confusionModel: 'language' });
    expect(q.words[0]!.resolution!.context.neighbours).toEqual(['English']);
  });
});

describe('decision 7c: each removed colour code is a finding in strict analyze', () => {
  it('abc⟨SGR⟩red⟨SGR⟩ → abcred, spoofed, illegal', () => {
    const r = analyze('abc\x1b[31mred\x1b[0m', A);
    expect(r.normalized).toBe('abcred');
    expect(r.spoofed).toBe(true);
    expect(r.signals.illegal).toBe(true);
    const kinds: string[] = [];
    analyze('abc\x1b[31mred\x1b[0m', A, { onReport: (m) => void kinds.push(m.kind) });
    expect(kinds.filter((k) => k === 'sgr')).toHaveLength(2);
  });
});

describe('decision 30b category 8: a unit prefix right after digits is the unit’s start', () => {
  it('5µm stays; in a target with no mapping (Russian) it stays', () => {
    expect(norm('5µm')).toBe('5µm');
    expect(calls('5µm')).toEqual([]);
    expect(norm('саµа')).toBe('саµа');
  });
});

describe('decision 41f: a multi-target donor follows the word’s target', () => {
  it('Ϭ → б in a Russian word, → 6 alone or in an English context', () => {
    expect(norm('это доϬма вот')).toBe('это добма вот');
    expect(norm('Ϭ')).toBe('6');
    expect(norm('code Ϭ here')).toBe('code 6 here');
  });
});

describe('decision 41g: Turkish ı by the same word and the context window', () => {
  it('another Turkish letter in the word keeps it', () => {
    expect(norm('kışın')).toBe('kışın');
  });
  it('Turkish letters in the window keep ı', () => {
    expect(norm('Osmanlı İmparatorluğu yıl')).toBe('Osmanlı İmparatorluğu yıl');
  });
  it('without one it folds (lınk → link)', () => {
    expect(norm('Click the lınk now')).toBe('Click the link now');
    expect(norm('Osmanlı yıl anlamına')).toBe('Osmanli yil anlamina');
  });
});

describe('decision 30b categories 3, 7: into the word’s target through their Latin letters', () => {
  it('a Roman numeral in a Russian word', () => {
    expect(norm('Ⅹорошо')).toBe('Хорошо');
    expect(analyze('Ⅹорошо', A).spoofed).toBe(true);
  });
  it('a word sign: a separate word stays Latin, inside a word it follows the word', () => {
    expect(norm('call ℡ now')).toBe('call TEL now');
    expect(norm('з℡')).toBe('зТЕL');
    expect(analyze('з℡', A).spoofed).toBe(true);
  });
});

describe('the last symbols (neutral-symbols-review.md)', () => {
  it('㏍ ㏚ ㍵: converted via Latin letters; a finding outside Japanese text, standalone too', () => {
    expect(norm('the ㏍ here')).toBe('the KK here');
    expect(analyze('the ㏍ here', A).spoofed).toBe(true);
    // Decision 41k: among words of its language set it stays as written.
    expect(analyze('トヨタ ㏍ です', A).spoofed).toBe(false);
    expect(norm('トヨタ ㏍ です')).toBe('トヨタ ㏍ です');
    expect(norm('株式会社㏍')).toBe('株式会社㏍'); // 41k
    expect(analyze('株式会社㏍', A).spoofed).toBe(false);
    expect(analyze('a㏍b', A).spoofed).toBe(true);
    expect(norm('Ⅹ㏚')).not.toBe('Ⅹ㏚');
  });
  it('🄪 is a visible style S; ℆ is a word sign c/u', () => {
    expect(norm('x🄪y')).toBe('xSy');
    expect(norm('see 🄪 here')).toBe('see 🄪 here');
    expect(norm('℆')).toBe('c/u');
  });
});

describe('decisions 7b, 41b, 41c: linear scans, donor numbers, escape-sequence findings', () => {
  timed('1: the nearest-word scan is linear with breadth all', () => {
    const t = (n: number) => 'سلام ' + '۱۱ '.repeat(n);
    const o: AnalyzeOptions = { ...A, breadth: 'all' };
    analyze(t(500), o);
    const a = performance.now();
    analyze(t(2000), o);
    const small = performance.now() - a;
    const b = performance.now();
    analyze(t(8000), o);
    expect(performance.now() - b).toBeLessThan(small * 8);
  });
  it('3: a native number of donors only is judged by its context, as one', () => {
    // Only a non-donor character of its script keeps it in the word (१९३५); `০ ৪ ३ ०` are donors.
    expect(norm('বাংলা ৪০৪ ঠিকানা')).toBe('বাংলা ৪০৪ ঠিকানা');
    expect(norm('error ০৪')).toBe('error 08'); // 41l: the zero inside a number reads 0
    expect(norm('error ৪০৪')).toBe('error 808');
    expect(norm('room ३०३')).toBe('room 303');
    expect(analyze('error ৪০৪', A).spoofed).toBe(true);
    expect(norm('The year १९३५ in')).toBe('The year १९३५ in');
  });
  it('4: every removed escape sequence is a finding', () => {
    for (const t of ['x\x1b[?25ly', 'x\x1b(By', 'x\x1b[Ky', 'bad\x1b[31']) {
      const r = analyze(t, A);
      expect(r.spoofed, t).toBe(true);
      expect(r.signals.illegal, t).toBe(true);
    }
  });
  it('5: a finding per colour code', () => {
    const r = analyze('abc\x1b[31mred\x1b[0m', A);
    expect(r.words.map((w) => w.word)).toEqual(['\x1b[31m', '\x1b[0m']);
    expect(r.counts.wordsAffected).toBe(2);
  });
  it('6: Ϭ follows the word’s resolved target, alone the context', () => {
    // 36e (ordering B): `кa` holds letters of two requested languages, no whole-word target: Ϭ reads 6.
    expect(norm('кaϬ')).toBe('кa6');
    expect(norm('Привет Ϭ мир')).toBe('Привет б мир');
    expect(norm('καϬα')).toBe('κα6α');
    expect(norm('Ϭall')).toBe('6all');
  });
});

describe('decision 41i: donors of a word’s non-target script stay', () => {
  it('as written, the mix is the reader’s', () => {
    for (const t of ['صمیمانهs', 'المثالa', 'paypaוש']) expect(norm(t), t).toBe(t);
  });
});

describe('decision 41j: leftover neutrals are reported', () => {
  it('µ in a Russian word', () => {
    const r = analyze('приµет', A);
    expect(r.normalized).toBe('приµет');
    expect(r.spoofed).toBe(true);
  });
  it('styled/unit char without twin: base letter, mixed word', () => {
    // In Russian text (alone the primary English makes `е` a touching look-alike, 36c).
    const r = analyze('это приⓖет так', A);
    expect(r.normalized).toBe('это приgет так');
    expect(r.words[0]!.signals).toContain('mixed_non_legitimate'); // decision 36a
  });
  it('a symbol inside a word', () => {
    expect(analyze('bac㏍', A).spoofed).toBe(true);
  });
  it('© ® ™ № directly followed by a letter: a visible-style letter of the word, reported (30b cat. 5)', () => {
    for (const [t, out] of [
      ['©lick', 'click'],
      ['©LICK', 'CLICK'],
      ['a℠b', 'aSMb'],
      ['pay®eal', 'payReal'],
      ['a™b', 'aTMb'],
      ['№vember', 'November'],
      ['a№b', 'aNob'],
    ]) {
      const r = analyze(t!, A);
      expect(r.normalized, t).toBe(out);
      expect(r.spoofed, t).toBe(true);
      expect(norm(t!, { hiddenChars: 'strict' }), t).toBe(out);
    }
    for (const t of ['Brand® now', '©2026', '№5']) {
      expect(norm(t), t).toBe(t);
      expect(analyze(t, A).spoofed, t).toBe(false);
    }
  });
});

describe('decision 41k: a language-set neutral among letters of its set stays', () => {
  it('kept, not reported', () => {
    for (const t of ['株式会社㏍', 'トヨタ ㏍ です', '1㎢당']) {
      expect(norm(t), t).toBe(t);
      expect(analyze(t, A).spoofed, t).toBe(false);
    }
  });
  it('outside the set: converted and reported', () => {
    expect(norm('the ㏍ here')).toBe('the KK here');
    expect(analyze('the ㏍ here', A).spoofed).toBe(true);
    expect(analyze('ภาษา ㏍ ไทย', A).spoofed).toBe(true);
  });
});

describe('decision 30b category 6: a unit at the word’s end only after a number', () => {
  it('exempt after a number, an SI prefix, or a spaceless letter before the number', () => {
    for (const t of ['5ℓ', '10mℓ', 'kℓ', 'dℓ', '2.5ℓ', '10㎏', '最高40℃', '1,5ℓ'])
      expect(norm(t), t).toBe(t);
  });
  it('otherwise converted, a finding', () => {
    for (const [t, out] of [
      ['paypaℓ', 'paypal'],
      ['l0ℓ', 'l0l'],
      ['M0µℓ', 'M0ul'],
    ]) {
      const r = analyze(t!, A);
      expect(r.normalized, t).toBe(out);
      expect(r.spoofed, t).toBe(true);
    }
  });
});

describe('decision 30b category 1: negative squared letters are visible style', () => {
  it('🅰 🅿 follow the word, no spoof', () => {
    expect(norm('p🅰ypal')).toBe('pAypal');
    expect(norm('🅿aypal')).toBe('Paypal');
    expect(analyze('p🅰ypal', A).spoofed).toBe(false);
  });
});

describe('decision 36a: three categories of mixed-script words', () => {
  it('mixed_spoof: converted look-alikes, a spoof', () => {
    // 36e: a one-letter piece that is not the last, converted toward the requested language holding more of the word's letters.
    const r = analyze('pаypal', A);
    expect(r.normalized).toBe('paypal');
    expect(r.words[0]!.signals).toEqual(['mixed_spoof']);
    expect(r.spoofed).toBe(true);
    expect(r.signals.mixed_spoof).toBe(true);
  });
  it('mixed_legitimate: next to a spaceless script', () => {
    for (const t of ['iPhone用', 'AppleはiPhone', 'ABC株式会社XYZ', 'pa株ypal']) {
      const r = analyze(t, A);
      expect(r.words[0]!.signals, t).toEqual(['mixed_legitimate']);
      expect(r.spoofed, t).toBe(false);
    }
  });
  it('mixed_non_legitimate: spaced scripts glued, nothing converted; reported, not a spoof', () => {
    for (const t of ['paypaוש', 'صمیمانهs']) {
      const r = analyze(t, A);
      expect(r.words[0]!.signals, t).toEqual(['mixed_non_legitimate']);
      expect(r.spoofed, t).toBe(false);
    }
  });
  it('the default path (lenient rules, Latin fold) keeps mixed_script and its result shape', () => {
    const r = analyze('pаypal');
    expect(r.words[0]!.signals).toContain('mixed_script');
    expect('mixed_spoof' in r.signals).toBe(false);
  });
});

describe('decisions 36a, 41c: categories, units after numbers, mixed-word counts', () => {
  it('1, 36a: an unconverted look-alike of another requested language makes the word mixed_spoof', () => {
    // Decision 36c: the fully convertible chunks convert.
    for (const [t, out] of [
      ['Log in to pаypalя now', 'Log in to paypalя now'],
      ['Μicrosoftλ', 'Microsoftλ'],
    ]) {
      const r = analyze(t!, A);
      expect(r.normalized, t).toBe(out);
      expect(r.spoofed, t).toBe(true);
      expect(r.words[0]!.signals, t).toContain('mixed_spoof');
    }
    for (const t of ['тime', 'вank', 'paypaוש']) {
      const r = analyze(t, A);
      expect(r.words[0]!.signals, t).toEqual(['mixed_non_legitimate']);
      expect(r.spoofed, t).toBe(false);
    }
  });
  it('3: the run right before a unit decides (23日最高零下6℃ stays)', () => {
    for (const t of ['23日最高零下6℃', '为7月首次上40℃', '最高40℃']) expect(norm(t), t).toBe(t);
    expect(norm('paypaℓ')).toBe('paypal');
  });
  it('4: a word with no target letter gets no category', () => {
    for (const t of ['外部リンク', '東京タワー', 'ひらがなとカタカナ']) {
      const r = analyze(t, A);
      expect(r.words, t).toEqual([]);
      expect(r.counts.wordsAffected, t).toBe(0);
    }
  });
  it('5: counts.mixedWords counts the words with a category', () => {
    expect(analyze('iPhone用', A).counts.mixedWords).toBe(1);
    expect(analyze('paypaוש', A).counts.mixedWords).toBe(1);
    expect(analyze('pаypal', A).counts.mixedWords).toBe(1);
    expect(analyze('外部リンク', A).counts.mixedWords).toBe(0);
  });
  it('5: no mixed_script under the language model', () => {
    for (const t of ['приⓖет', 'αⓖβ', 'P𝚨YP𝚨L'])
      expect(
        analyze(t, A).words.flatMap((w) => w.signals),
        t,
      ).not.toContain('mixed_script');
  });
  it('7: the nearest-word reach does not depend on the text after it', () => {
    const t = 'سلام ' + '۱۱ '.repeat(15) + 'است';
    const a = norm(t);
    const b = norm(t + '\n\n' + 'word '.repeat(100)).split('\n\n')[0];
    expect(b).toBe(a);
  });
  it('8: a converted neutral loses its emoji presentation selector', () => {
    expect(norm('p🅿️al')).toBe('pPal');
    expect(norm('🅿️▶')).toBe('🅿️▶');
  });
});

describe('decision 30b category 1: negative circled letters and regional indicators as letters', () => {
  it('visible style in a word, no spoof', () => {
    for (const [t, out] of [
      ['🅐pple', 'Apple'],
      ['p🇦ypal', 'pAypal'],
      ['p🇦🇦ypal', 'pAAypal'],
    ]) {
      const r = analyze(t!, A);
      expect(r.normalized, t).toBe(out);
      expect(r.spoofed, t).toBe(false);
    }
  });
  it('a valid flag pair is a flag emoji and stays', () => {
    for (const t of ['🇺🇸 flag', 'go 🇺🇸🇩🇪 now']) expect(norm(t), t).toBe(t);
  });
});
