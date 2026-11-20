/**
 * Owner decisions of 2026-11-16/17: phases 42–42c (visibility tokens, mojibake
 * in phase 1, phase-2 mapping, phase-3 cut), 30b category 8's unit list for
 * the micro sign, 36a's Highly Restrictive sets, 41i.
 */
import { describe, expect, it } from 'vitest';
import { timed } from './helpers/growth';
import { analyze, cleanHidden, type AnalyzeOptions } from '../src';
import type { Mark } from '../src/core';

const A: AnalyzeOptions = { hiddenChars: 'strict', confusionModel: 'alphabet' };
const norm = (t: string, o: AnalyzeOptions = A) => analyze(t, o).normalized;
const mojibake = (t: string, o: AnalyzeOptions = A) => {
  const out: [string, string | null][] = [];
  analyze(t, o, {
    onReport: (m: Mark) => {
      if (m.kind === 'mojibake') out.push([t.slice(m.start, m.start + m.length), m.extracted]);
    },
  });
  return out;
};
const words = (t: string, o: AnalyzeOptions = A) =>
  analyze(t, o).words.map((w) => [w.word, w.signals.join(','), w.normalized ?? null]);
const onWord = (t: string) => {
  const out: [number, number, string, string][] = [];
  analyze(t, A, { onWord: (s, e, c, r) => void out.push([s, e, c, r]) });
  return out;
};

describe('decision 42: phase 1 reports mojibake, before control characters are removed', () => {
  it('UTF-8 read as Windows-1252 (strict), with the text it encodes', () => {
    expect(mojibake('I donâ€™t know')).toEqual([['â€™', '’']]);
    expect(mojibake('Â© 2018 â€œquotedâ€')).toEqual([
      ['Â©', '©'],
      ['â€œ', '“'],
    ]);
    expect(mojibake('maÃ®tre')).toEqual([['Ã®', 'î']]);
  });
  it('the Latin-1 form with C1 controls is found on the source', () => {
    expect(mojibake('operationsâ\u0080\u0094that')).toEqual([['â\u0080\u0094', '—']]);
  });
  it('Windows-1252 mirrored: Latin-looking garbage among Cyrillic words', () => {
    expect(mojibake('Ð¿Ñ€Ð¸Ð²ÐµÑ‚ мир')).toEqual([['Ð¿Ñ€Ð¸Ð²ÐµÑ‚', 'привет']]);
  });
  it('UTF-8 read as Windows-1251: strict2, script context, the curly quotes', () => {
    expect(mojibake('I donвЂ™t know')).toEqual([['вЂ™', '’']]);
    expect(mojibake('tГ©lГ©commande')).toEqual([
      ['Г©', 'é'],
      ['Г©', 'é'],
    ]);
    expect(mojibake('cialis ВЈ 5')).toEqual([['ВЈ', '£']]);
    expect(mojibake('вЂњquotedвЂќ')).toEqual([
      ['вЂњ', '“'],
      ['вЂќ', '”'],
    ]);
  });
  it('real letters are no mojibake', () => {
    for (const t of ['São NÃO não', 'Від’ємними числами', 'Віктор МІНІСТЕРСТВО', 'привет мир'])
      expect(mojibake(t)).toEqual([]);
  });
  it('a rule of strict analyze; cleanHidden leaves it off', () => {
    expect(mojibake('donâ€™t', {})).toEqual([]);
    const seen: string[] = [];
    cleanHidden('donâ€™t', undefined, { onReport: (m) => void seen.push(m.kind) });
    expect(seen).toEqual([]);
  });
});

describe('decision 42: a mojibake span is a non-breaking part of its token', () => {
  it('no false spoof from the encoded bytes (`™` before a letter)', () => {
    for (const t of ['todayâ€™s', 'I donâ€™t know', 'Â®Brand', 'MicrosoftÂ®', 'maÃ®tre']) {
      expect(norm(t)).toBe(t);
      expect(analyze(t, A).words).toEqual([]);
    }
    expect(norm('Ð¿Ñ€Ð¸Ð²ÐµÑ‚ Ð¼Ð¸Ñ€ привет')).toBe('Ð¿Ñ€Ð¸Ð²ÐµÑ‚ Ð¼Ð¸Ñ€ привет');
  });
  it('controls removed inside a span do not cut the word', () => {
    const r = analyze('donâ\u0080\u0099t know', A);
    expect(r.normalized).toBe('donât know');
    expect(r.signals.confusable_word).toBe(false);
  });
});

describe('decision 42a: phase 2 maps the whole token, mojibake included', () => {
  it('a mojibake span made of look-alikes maps (a spoof)', () => {
    expect(norm('ВІРЅ')).toBe('BIPS');
    expect(analyze('ВІРЅ', A).spoofed).toBe(true);
    expect(mojibake('ВІРЅ')).toEqual([['ВІРЅ', '²н']]);
  });
  it('mojibake beside look-alikes hides no spoof', () => {
    expect(norm('pаypalâ€™s')).toBe('paypalâ€™s');
    expect(analyze('pаypalâ€™s', A).spoofed).toBe(true);
    expect(norm('todayâ€™ѕ')).toBe('todayâ€™s');
    expect(analyze('todayâ€™ѕ', A).spoofed).toBe(true);
    expect(norm('Ⅰâ€™m here')).toBe('Iâ€™m here');
    expect(analyze('Ⅰâ€™m here', A).spoofed).toBe(true);
  });
});

describe('decision 42b: phase 3 cuts a token phase 2 cannot map', () => {
  it('a mojibake span counts as the character it encodes (`Ⅰâ€™m` judged as `Ⅰ’m`)', () => {
    expect(norm('用Ⅰâ€™m')).toBe('用Iâ€™m');
    expect(analyze('用Ⅰâ€™m', A).spoofed).toBe(true);
    expect(norm('用pаypalâ€™s')).toBe('用paypalâ€™s');
    expect(analyze('用pаypalâ€™s', A).spoofed).toBe(true);
  });
  it('a mixed word holding mojibake is read through the encoded text', () => {
    for (const t of ['I donвЂ™t know', 'tГ©lГ©commande', '用donвЂ™t']) {
      expect(norm(t)).toBe(t);
      expect(analyze(t, A).spoofed).toBe(false);
    }
  });
  it('a symbol between the two scripts goes with the spaced side', () => {
    // `click©` + `用`: the tail mark ends its piece and stays.
    expect(norm('click©用')).toBe('click©用');
    expect(analyze('click©用', A).spoofed).toBe(false);
    // `用` + `µsername`: the micro sign starts its piece; the rest is no unit (30b 8).
    expect(norm('用µsername')).toBe('用username');
    expect(analyze('用µsername', A).spoofed).toBe(true);
    expect(norm('用µm')).toBe('用µm');
    expect(analyze('用µm', A).spoofed).toBe(false);
  });

  it('letters inside mojibake spans cast no vote', () => {
    // `ää` on both sides would vote Latin (`ää сор ää` → `ää cop ää`).
    expect(norm('ää сор ää')).toBe('ää cop ää');
    expect(norm('Ã¤Ã¤ сор Ã¤Ã¤')).toBe('Ã¤Ã¤ сор Ã¤Ã¤');
    // Words of mojibake only are passed over: the next voting words decide.
    expect(norm('the Ã¤Ã¤ сор Ã¤Ã¤ is')).toBe('the Ã¤Ã¤ cop Ã¤Ã¤ is');
  });
});

describe('decision 42c: reports name the whole visibility token', () => {
  it('one finding and one word call for a cut token, with the 36a category its pieces produce', () => {
    expect(words('ok 用pаypalâ€™s ok')).toEqual([['用pаypalâ€™s', 'mixed_spoof', '用paypalâ€™s']]);
    expect(onWord('ok 用pаypalâ€™s ok')).toEqual([[3, 14, '用pаypalâ€™s', '用paypalâ€™s']]);
    expect(words('iPhone用')).toEqual([['iPhone用', 'mixed_legitimate', 'iPhone用']]);
    expect(words('pa株ypal')).toEqual([['pa株ypal', 'mixed_legitimate', 'pa株ypal']]);
  });
});

describe('decision 30b category 8: the micro sign at a word’s start is a prefix only before a unit', () => {
  it('before a unit of the list, alone, after digits: kept, not reported', () => {
    for (const t of ['µm', 'µs', 'µg', 'µℓ', 'µA', 'µHz', 'µs⁻¹', 'µm²', 'µ', '5µm', '5 µs here']) {
      expect(norm(t)).toBe(t);
      expect(analyze(t, A).words).toEqual([]);
    }
  });
  it('otherwise the general replacement, a spoof', () => {
    expect(norm('µsername')).toBe('username');
    expect(analyze('µsername', A).spoofed).toBe(true);
    expect(norm('Please µpdate your account')).toBe('Please update your account');
    expect(norm('5µx')).toBe('5ux');
  });
  it('a Greek word: no exception (`µε` → `με`)', () => {
    expect(norm('µε')).toBe('με');
    expect(analyze('µε', A).spoofed).toBe(true);
    expect(norm('ποιος µε')).toBe('ποιος με');
  });
});

describe('decision 36a: legitimate = spaceless, or a UTS #39 Highly Restrictive set', () => {
  it('Latin + Hangul (Latin, Han, Hangul) is legitimate; Cyrillic + Hangul is not', () => {
    expect(words('Smith는')).toEqual([['Smith는', 'mixed_legitimate', 'Smith는']]);
    expect(words('Иван는')).toEqual([['Иван는', 'mixed_non_legitimate', 'Иван는']]);
    expect(analyze('Smith는', A).spoofed).toBe(false);
  });
});

describe('decision 41i: donors of a non-target script in a word holding its other letters stay', () => {
  it('stay with letters of their script that are no donors; convert when all are donors', () => {
    expect(norm('paypaוש')).toBe('paypaוש');
    expect(norm('صمیمانهs')).toBe('صمیمانهs');
    expect(norm('APIها')).not.toBe('APIها');
    expect(analyze('APIها', A).spoofed).toBe(true);
  });
});

describe('decision 36a: the categories only add to signals', () => {
  it('words of look-alikes from two or more non-target scripts fold and are flagged', () => {
    for (const [t, out] of [
      ['Visit ᎪᏢᏢꓡꓰ today', 'Visit APPLE today'],
      ['Login to ꓑꓮᎩꓑꓮꓡ now', 'Login to PAYPAL now'],
      ['ᏀꓳꓳᏀꓡꓰ', 'GOOGLE'],
      ['ᑲყ', 'by'],
      ['a 𐐽ס𑣘וᑯ b', 'a couid b'],
    ]) {
      const r = analyze(t, A);
      expect(r.normalized).toBe(out);
      expect(r.spoofed).toBe(true);
    }
  });
  it('kept as written under wholeScriptFold off, still flagged', () => {
    expect(analyze('ᑲყ', { ...A, wholeScriptFold: 'off' }).spoofed).toBe(true);
  });
});

describe('decision 42: one long token is judged in linear time', () => {
  const ms = (s: string) => {
    const a = performance.now();
    analyze(s, A);
    return performance.now() - a;
  };
  timed.each([
    ['mojibake `Â©`', (n: number) => 'Â©'.repeat(n)],
    ['mojibake `â€™`', (n: number) => 'x' + 'â€™'.repeat(n) + 'y'],
    ['regional indicators', (n: number) => 'p' + '🇦'.repeat(n) + 'y'],
    ['flags', (n: number) => '🇺🇸'.repeat(n)],
  ] as const)('%s: 32k units well under a second', (_n, f) => {
    ms(f(2000));
    expect(ms(f(32000))).toBeLessThan(1000);
  });
});

describe('decision 36c: a mixed word no target takes as a whole is judged by chunks of one script', () => {
  it('no chunk maps into the word’s language: mixed_non_legitimate, unchanged', () => {
    for (const t of ['ESPшный', 'URLам', 'Facebookом', 'xmlфайла', 'ДашбордReact', 'dimπρ']) {
      expect(norm(t), t).toBe(t);
      expect(analyze(t, A).spoofed, t).toBe(false);
    }
  });
  it('a fully convertible chunk converts, a spoof (single letters too)', () => {
    for (const [t, out] of [
      ['Log in to pаypalя now', 'Log in to paypalя now'],
      ['жpаypal', 'жpaypal'],
      ['Μicrosoftλ', 'Microsoftλ'],
      ['pꓮypalя', 'pAypalя'],
    ]) {
      expect(norm(t!), t).toBe(out);
      expect(analyze(t!, A).spoofed, t).toBe(true);
    }
  });
  it('the word’s language from the target steps, not a majority: Latin `i` in Russian text stays', () => {
    expect(norm('это объектаi так')).toBe('это объектаi так');
    expect(analyze('это объектаi так', A).spoofed).toBe(false);
    // Whole-word folds keep 41e (the language binding is undecided, removed 2026-11-17).
    expect(norm('мiр')).toBe('мір');
  });
  it('36e: a word of two requested alphabets is never converted whole', () => {
    expect(norm('в Windowsах')).toBe('в Windowsах');
    expect(analyze('в Windowsах', A).spoofed).toBe(false);
    expect(analyze('в Windowsах', A).words[0]!.signals).toEqual(['mixed_non_legitimate']);
  });
  it('a dash-separated prefix fully convertible is converted', () => {
    expect(norm('Use рау-pal now')).toBe('Use pay-pal now');
    expect(analyze('Use рау-pal now', A).spoofed).toBe(true);
  });
  it('a one-letter Hebrew part follows its outside context (42, 42b, 41b)', () => {
    expect(norm('Appstore ו-iTunes and more')).toBe('Appstore i-iTunes and more');
    expect(analyze('Appstore ו-iTunes and more', A).spoofed).toBe(true);
    const he = 'מחשבון, פתקים, הגדרות, Appstore ו-iTunes. זאת בנוסף';
    expect(norm(he)).toBe(he);
    expect(analyze(he, A).spoofed).toBe(false);
  });
});

describe('decision 41l: a digit donor inside a number takes its digit reading', () => {
  it('inside a number: the zero reads 0', () => {
    expect(norm('error ৪০৪')).toBe('error 808');
    expect(norm('error৪০৪')).toBe('error808');
    expect(norm('PIN ৪০৪০')).toBe('PIN 8080');
    expect(norm('PIN ০০')).toBe('PIN 00');
    expect(norm('x০1')).toBe('x01');
    for (const z of ['൦', '߀', '𑣠', '〇']) expect(norm(`x${z}1`), z).toBe('x01');
    expect(norm('code ০ here')).toBe('code 0 here');
    expect(norm('p. ۷۱')).toBe('p. V1');
    expect(analyze('error ৪০৪', A).spoofed).toBe(true);
  });
  it('next to letters, without a digit: the letter reading', () => {
    expect(norm('g০০gle')).toBe('google');
    expect(norm('l০l')).toBe('lol');
    expect(norm('g๐๐gle')).toBe('google');
  });
  it('41b context and own-script rules unchanged', () => {
    for (const t of [
      'বাংলা ৪০৪',
      'ঠিকানা ৪০৪ নম্বর',
      'error ४०४',
      'The year १९३५',
      '2०११',
      '۰۶۳۱۱۸۳۸۵X',
    ])
      expect(norm(t)).toBe(t);
  });
  it('`١ ۱` read 1, `٥` reads 0; `٧ ۷` have no digit reading', () => {
    expect(norm('x١1')).toBe('x11');
    expect(norm('x۱1')).toBe('x11');
    expect(norm('x٥1')).toBe('x01');
    expect(norm('x٧1')).toBe('xV1');
  });
});

describe('decision 41l: a run of digit donors touching letters', () => {
  it('is a number only with a real digit or a digit-only look-alike', () => {
    expect(norm('g০০gle')).toBe('google');
    expect(norm('error৪০৪')).toBe('error808');
    expect(norm('PIN ০০')).toBe('PIN 00');
    // `Ϭ` also reads `б`: no digit-only look-alike, so the run of `০` reads `o`.
    expect(norm('lϬ০l')).toBe('l6ol');
    // With English only, `Ϭ` has no letter reading (40d): a digit-only look-alike.
    expect(norm('lϬ০l', { ...A, targetLanguages: ['English'] })).toBe('l60l');
  });
});

describe('decision 30h.3: the Math target (option mathTarget)', () => {
  const M = { ...A, mathTarget: true };
  it('a word of Math letters is native; mixed Latin + Greek is mixed_legitimate', () => {
    for (const t of ['αFβγ', 'cosβcosα'])
      expect(analyze(t, M).words.map((w) => [w.word, w.signals, w.normalized])).toEqual([
        [t, ['mixed_legitimate'], t],
      ]);
    for (const t of ['ρσ', 'xℓ', 'caµera', '𝑘𝑇𝜈']) {
      expect(norm(t, M)).toBe(t);
      expect(analyze(t, M).words).toEqual([]);
    }
  });
  it('off by default; other look-alikes are judged as before', () => {
    // 36e: Greek and Latin are both requested; `α`'s neighbour `F` holds fewer letters than
    // Greek: reported, not converted.
    expect(norm('αFβγ')).toBe('αFβγ');
    expect(norm('pаypal', M)).toBe('paypal');
    expect(analyze('pаypal', M).spoofed).toBe(true);
  });
});

describe('decision 36e: detected at a border, reported, not converted (the touching signal is gone)', () => {
  it('a look-alike at a border with no one-letter piece to correct: reported, not a spoof', () => {
    for (const t of [
      'the timея here',
      'the dедnoted here',
      'the жсonstant here',
      'SEOшников',
      'добавлениеchmod',
      'ByteCodeрешили',
      '∭ΩρfdV',
    ]) {
      expect(norm(t), t).toBe(t);
      expect(analyze(t, A).spoofed, t).toBe(false);
      expect(analyze(t, A).words[0]!.signals, t).toEqual(['mixed_non_legitimate']);
    }
  });
  it('kept: the touching chunk is a suffix on a requested language’s grammar list', () => {
    for (const t of ['это ESPшный модуль', 'это Facebookом так', 'the Facebookом here']) {
      expect(norm(t), t).toBe(t);
      expect(analyze(t, A).spoofed, t).toBe(false);
      expect(analyze(t, A).words[0]!.signals, t).toEqual(['mixed_non_legitimate']);
    }
    // Not requested: no list (40d).
    const en = { ...A, targetLanguages: ['English' as const] };
    expect(analyze('the Facebookом here', en).spoofed).toBe(false);
  });
  it('the grammar lists: endings only (`-(ш)н-` + ending is one; `на`, `ки` are none)', () => {
    // `шный` (Russian adjective) is listed; `ки` is not. 36e: `LLMки` is reported either way.
    expect(analyze('это LLMки так', A).spoofed).toBe(false);
    expect(analyze('это LLMки так', A).words[0]!.signals).toEqual(['mixed_non_legitimate']);
    // Ukrainian instrumental `ою` is listed.
    expect(analyze('це Facebookою та', A).spoofed).toBe(false);
  });
});

describe('decisions 36c, 30h: affixes are parts of another script; Math leaves non-Math neutrals alone', () => {
  it('a part folded within its own script is no affix (a spoof as before)', () => {
    for (const [t, out] of [
      ['Visit secure-pɑypal now', 'Visit secure-paypal now'],
      ['Visit my-lınk now', 'Visit my-link now'],
      ['Visit log-ın now', 'Visit log-in now'],
      ['Visit secure-þaypal now', 'Visit secure-paypal now'],
    ]) {
      expect(norm(t!), t).toBe(out);
      expect(analyze(t!, A).spoofed, t).toBe(true);
    }
    expect(norm('Use ох-paypal now')).toBe('Use ox-paypal now');
  });
  it('mathTarget: neutrals that are no Math letters convert and report as usual', () => {
    const M = { ...A, mathTarget: true };
    expect(norm('Login to ⅽlick now', M)).toBe('Login to click now');
    expect(analyze('Login to ⅽlick now', M).spoofed).toBe(true);
    expect(norm('pⓐypal', M)).toBe('paypal');
    expect(norm('p🄰ypal', M)).toBe('pAypal');
    expect(norm('©lick', M)).toBe('click');
    expect(analyze('©lick', M).spoofed).toBe(true);
  });
  it('a one-script word no alphabet takes whole: its donors fold (40d), else no flag', () => {
    expect(norm('það')).toBe('pað');
    expect(analyze('það', A).spoofed).toBe(true);
    expect(norm('það', { ...A, targetLanguages: ['English', 'European'] })).toBe('það');
    expect(analyze('það', { ...A, targetLanguages: ['English', 'European'] }).spoofed).toBe(false);
  });
});

describe('decisions 42, 42b, 36c: visibility tokens, outside context, real affixes (owner, 2026-11-17)', () => {
  const S = (sep: string | undefined) => ({ ...A, affixSeparator: sep });
  it('42: words joined by an inner dash or apostrophe are one token, reported whole', () => {
    expect(analyze('Use apple-рау now', A).words.map((w) => w.word)).toEqual(['apple-рау']);
    // Clean parts are never judged: no report.
    expect(analyze('это SMS-ах так', A).words).toEqual([]);
    expect(analyze('это IP-адрес так', A).words).toEqual([]);
  });
  it('look-alike parts convert with the token: no affix', () => {
    for (const [t, out] of [
      ['Use apple-рау now', 'Use apple-pay now'],
      ['Go to secure-ВООК now', 'Go to secure-BOOK now'],
      ['Use рау-pal now', 'Use pay-pal now'],
      ['Use ох-paypal now', 'Use ox-paypal now'],
      ['Use pаy-pаl now', 'Use pay-pal now'],
    ]) {
      expect(norm(t!), t).toBe(out);
      expect(analyze(t!, A).spoofed, t).toBe(true);
    }
  });
  it('42b: context comes from outside the token; a foreign whole fold of a dashed token is none', () => {
    for (const t of [
      'это NTLM-хеш так',
      'это SMB-шару так',
      'это SMS-ах так',
      "это iPhone'ах так",
    ]) {
      expect(norm(t), t).toBe(t);
      expect(analyze(t, A).spoofed, t).toBe(false);
    }
  });
  it('42b: parts of one token are no context for each other', () => {
    // `сор` between Han pieces: the words outside (`the`) decide.
    expect(norm('мир мир мир the 株сор the мир мир мир')).toBe(
      'мир мир мир the 株cop the мир мир мир',
    );
    expect(norm('hello用сор')).toBe('hello用сор');
  });
  it('36c: with a separator only real affixes are set off; look-alike edge chunks convert', () => {
    // 36e: the last one-letter piece is reported, not converted, with any separator.
    for (const sep of ['-', '']) {
      expect(norm('Москвa', S(sep))).toBe('Москвa');
      expect(analyze('Москвa', S(sep)).spoofed).toBe(false);
    }
    // An unseparated prefix never applies (36c): `аpple` converts with or without a separator.
    expect(norm('аpple', S('-'))).toBe('apple');
    expect(norm('аpple')).toBe('apple');
    // A listed suffix in the word's own language (Russian text) is set off.
    expect(norm('в Windowsах', S('-'))).toBe('в Windows-ах');
    expect(analyze('в Windowsах', S('-')).spoofed).toBe(false);
    expect(norm('в Windowsах', S(' · '))).toBe('в Windows · ах');
    // Already separated: nothing inserted.
    expect(norm("это iPhone'ах так", S('-'))).toBe("это iPhone'ах так");
    expect(norm('это SMS-ах так', S('-'))).toBe('это SMS-ах так');
  });
});

describe('decision 36c affixes and dash parts (owner 2026-11-17)', () => {
  const R = (t: string) => {
    const r = analyze(t, A);
    return [r.normalized, r.spoofed];
  };
  it('an unseparated prefix never applies: the look-alike edge is a spoof', () => {
    // 36e: no one-letter piece to correct: reported.
    expect(R('это ЕЦChatGPT так')).toEqual(['это ЕЦChatGPT так', false]);
    expect(R('The жtimе is here')).toEqual(['The жtimе is here', false]);
  });
  it('a look-alike in the body does not make it the suffix language: the body converts', () => {
    const H = (w: string) => `Пожалуйста, подтвердите ${w} перед тем как продолжить.`;
    expect(R(H('рhysicalя'))).toEqual([H('physicalя'), true]);
    expect(R(H('nеtflixя'))).toEqual([H('netflixя'), true]);
  });
  it('a one-letter suffix with a twin in the body language counts only when set off', () => {
    // 36e: a last one-letter piece is reported (the hostile-input setting converts it).
    expect(R('Apple Applе here')).toEqual(['Apple Applе here', false]);
    const h = analyze('Apple Applе here', { ...A, hostileInput: true });
    expect([h.normalized, h.spoofed]).toEqual(['Apple Apple here', true]);
    expect(R("это iPhone'а так")).toEqual(["это iPhone'а так", false]);
  });
  it('dash parts of one language are judged together; of different languages, apart', () => {
    expect(R('the реалити-шоу show')).toEqual(['the реалити-шоу show', false]);
    expect(R('she said хе-хе and')).toEqual(['she said xe-xe and', true]);
    expect(R('Use apple-рау now')).toEqual(['Use apple-pay now', true]);
    expect(R('это IP-адрес так')).toEqual(['это IP-адрес так', false]);
    expect(R('Use pаy-pаl now')).toEqual(['Use pay-pal now', true]);
    for (const t of ['Wi-Fi', 'кое-кто', 'это Сі-код так']) expect(analyze(t, A).words).toEqual([]);
  });
  it("dash parts vote in their neighbours' window, affixes excluded", () => {
    // `GPS-прибора` votes Russian (`GPS` is a dash-separated prefix): `Могу` keeps its letters.
    const t =
      'ments from a distance using a GPS device?",\n    "prompt_ru":"Могу я отследить движения человека с расстояния с помощью GPS-прибора?",\n    "class';
    expect(analyze(t, A).normalized).toBe(t);
  });
});

describe('decisions 36c, 41n, 42: dash parts, suffixes and chunk targets', () => {
  const R = (t: string, o: object = A) => {
    const r = analyze(t, o);
    return [r.normalized, r.spoofed];
  };
  const ENRU = { ...A, targetLanguages: ['English', 'Russian'] } as const;
  it('positional checks apply per dash part: no case anomaly across a dash', () => {
    for (const t of ['a type-I error', 'the cubic-I case', 'World War-I began', 'Kamus-I ve'])
      expect(R(t), t).toEqual([t, false]);
    // Within one part it still applies.
    expect(R('go paypaI-now')).toEqual(['go paypal-now', true]);
  });
  it('a dash-separated suffix is kept like an apostrophe-separated one, in any context', () => {
    for (const t of [
      'buy SMS-ах now',
      'buy iPhone-ах now',
      'buy Windows-ах now',
      "buy SMS'ах now",
    ]) {
      expect(R(t), t).toEqual([t, false]);
      expect(analyze(t, A).words, t).toEqual([]);
    }
  });
  it('a chunk converts only into the word language: `ΠS` stays with English and Russian', () => {
    expect(R('where ΠS is', ENRU)).toEqual(['where ΠS is', false]);
  });
  it('neutral characters inside a kept suffix are converted into its script', () => {
    expect(R('это Facebook𝐨м так')[0]).toBe('это Facebookом так');
    expect(R("это iPhone'ⓐх так")[0]).toBe("это iPhone'ах так");
    expect(R('это Facebookⓞм так')[0]).toBe('это Facebookом так');
  });
  it('a lone lunate sigma folds into the primary target (41d, 41e)', () => {
    for (const o of [A, ENRU]) {
      expect(R('ϲ', o)).toEqual(['c', true]);
      expect(R('Ϲ', o)).toEqual(['C', true]);
    }
    expect(R('λογοϲ')).toEqual(['λογοσ', true]);
  });
  it("`affixSeparator: ''`: a word kept by its affix is unchanged and not reported", () => {
    const o = { ...A, affixSeparator: '' };
    expect(R('в Windowsах', o)).toEqual(['в Windowsах', false]);
    expect(analyze('в Windowsах', o).words).toEqual([]);
    expect(R('pаypalя', o)).toEqual(['paypalя', true]);
  });
});

describe('decisions 36c, 30b.8, 42c: one-letter dash parts, μ units, the token in the call', () => {
  const R = (t: string, o: object = A) => {
    const r = analyze(t, o);
    return [r.normalized, r.spoofed];
  };
  const ENRU = { ...A, targetLanguages: ['English', 'Russian'] } as const;
  it('36c: a one-letter dash part with a twin in the other part is part of the word (setting off)', () => {
    for (const o of [A, ENRU]) {
      expect(R('Pay with Р-aypal now', o)).toEqual(['Pay with P-aypal now', true]);
      expect(R('Buy А-pple now', o)).toEqual(['Buy A-pple now', true]);
      expect(R('Send е-mail now', o)).toEqual(['Send e-mail now', true]);
      expect(R('a Т-shirt here', o)).toEqual(['a T-shirt here', true]);
      expect(R('go to plan-В now', o)).toEqual(['go to plan-B now', true]);
      expect(R('это Т-34 так', o)).toEqual(['это Т-34 так', false]);
      expect(R('это А-класс так', o)).toEqual(['это А-класс так', false]);
    }
    expect(R('π-калибровка')).toEqual(['п-калибровка', true]);
  });
  it('36c: with the setting on for its language the one-letter part is an affix', () => {
    const o = { ...A, oneLetterDashAffix: ['Russian', 'Ukrainian'] };
    expect(R('Pay with Р-aypal now', o)).toEqual(['Pay with Р-aypal now', false]);
  });
  it('30b.8: Greek μ before a unit is a unit prefix, kept', () => {
    for (const o of [A, { ...A, affixSeparator: '-' }]) {
      expect(R('Δt = 5 μs', o)[0]).toBe('Δt = 5 μs');
      expect(analyze('Δt = 5 μs', o).words.map((w) => w.word)).toEqual(['Δt']);
      expect(R('5μs and μm²', o)).toEqual(['5μs and μm²', false]);
    }
  });
  it('42c: the word callback names the whole token', () => {
    const calls = (t: string) => {
      const out: string[] = [];
      analyze(t, A, { onWord: (s, e, c, r) => void out.push(`${t.slice(s, e)}|${c}→${r}`) });
      return out;
    };
    expect(calls('buy SMS-ⓐх now')).toEqual(['SMS-ⓐх|SMS-ⓐх→SMS-ах']);
    expect(calls('the ⅰ-phone is')).toEqual(['ⅰ-phone|ⅰ-phone→i-phone']);
  });
  it('36e: 41i is gone; `12σiπ` (Greek not requested) is detected and reported', () => {
    expect(R('12σiπ', ENRU)).toEqual(['12σiπ', false]);
  });
  it('36c: a one-letter part of an unrequested model script is part of the word; a pack donor is judged alone', () => {
    expect(R('Please confirm the Ρ-hysical before', ENRU)).toEqual([
      'Please confirm the P-hysical before',
      true,
    ]);
    const he = 'מחשבון, פתקים, הגדרות, Appstore ו-iTunes. זאת בנוסף';
    expect(R(he, ENRU)).toEqual([he, false]);
  });
});

describe('36c one-letter dash part: a part of one letter only', () => {
  it('a part with digits is no one-letter part', () => {
    for (const t of ['это 128K-контекста так', 'это 1C-шелл так'])
      expect(analyze(t, A).normalized, t).toBe(t);
  });
});

describe('decisions 36c, 36e, 30b.8: the one-letter setting, marks and Greek donors in dash tokens', () => {
  const R = (t: string, o: object = A) => {
    const r = analyze(t, o);
    return [r.normalized, r.spoofed];
  };
  const ENRU = { ...A, targetLanguages: ['English', 'Russian'] } as const;
  it('36c one-letter setting applies with affixSeparator too', () => {
    for (const sep of ['', '-'])
      for (const o of [A, ENRU]) {
        expect(R('Pay with Р-aypal now', { ...o, affixSeparator: sep })).toEqual([
          'Pay with P-aypal now',
          true,
        ]);
        expect(R('Send е-mail now', { ...o, affixSeparator: sep })).toEqual([
          'Send e-mail now',
          true,
        ]);
      }
  });
  it('a combining mark stays with its letter in the dash token', () => {
    expect(R('Send е́-mail now')).toEqual(['Send é-mail now', true]);
    expect(R('Buy А́-pple now')).toEqual(['Buy Á-pple now', true]);
  });
  it('36e: Greek donors next to a one-letter Latin piece are reported (English+Russian)', () => {
    for (const t of ['σiλ', 'σiδ', 'ρiλ', '12σiπ']) expect(R(t, ENRU), t).toEqual([t, false]);
  });
  it('30b.8: μℓ and μ unit dash parts stay', () => {
    for (const o of [A, ENRU]) {
      expect(R('μℓ', o)).toEqual(['μℓ', false]);
      expect(R('5μℓ', o)).toEqual(['5μℓ', false]);
      expect(analyze('a μs-pulse and μm-thick', o).words).toEqual([]);
    }
    expect(R('µsec and μsec')).toEqual(['µsec and μsec', false]);
  });
  it('a one-letter part before a listed suffix of its twin language is a spoof', () => {
    expect(R('the В-est one')).toEqual(['the B-est one', true]);
    expect(R('the Р-ing one', ENRU)).toEqual(['the P-ing one', true]);
  });
  it('the setting covers prefixes only', () => {
    const o = { ...A, oneLetterDashAffix: ['Russian', 'Ukrainian'] };
    expect(R('go to plan-В now', o)).toEqual(['go to plan-B now', true]);
    expect(R('Pay with Р-aypal now', o)).toEqual(['Pay with Р-aypal now', false]);
  });
  it('30b.3: a Roman numeral dash part on a word of a spaced script is a spoof', () => {
    expect(R('the ⅰ-phone is')).toEqual(['the i-phone is', true]);
    expect(R('the Ⅰ-phone is', ENRU)).toEqual(['the I-phone is', true]);
  });
  it('oneLetterDashAffix is validated like targetLanguages', () => {
    expect(() => analyze('x', { ...A, oneLetterDashAffix: ['Klingon' as never] })).toThrow(
      'unknown target language Klingon',
    );
    expect(() => analyze('x', { ...A, oneLetterDashAffix: 'Russian' as never })).toThrow(
      RangeError,
    );
  });
});

describe('decision 36c (owner, 2026-11-19): one splitter, RTL awareness, styled dash parts', () => {
  const calls = (t: string, o: AnalyzeOptions = A) => {
    const w: string[] = [];
    const r = analyze(t, o, {
      onWord: (_s, _e, c, p, y) => void w.push(`${c}→${p}[${(y.signals ?? []).join('+')}]`),
    });
    return [r.normalized, w.join(' ; '), r.spoofed];
  };
  it('affixes read pieces as 36e does: digits ignored, a prefix after digits', () => {
    expect(calls('Win11Рго')[1]).toBe('Win11Рго→Win11Рго[mixed_non_legitimate]');
    expect(calls('iPhone12ах')[1]).toBe('iPhone12ах→iPhone12ах[mixed_non_legitimate]');
    expect(calls('Pay with ох-paypal now')[0]).toBe('Pay with ox-paypal now');
  });
  it('a right-to-left suffix is the last piece in reading order', () => {
    // On screen `ах` is not the word's end, in reading order it is: a suffix, reported.
    expect(calls('אiPhoneах')[1]).toBe('אiPhoneах→אiPhoneах[mixed_non_legitimate]');
  });
  it('RTL awareness is a switch, on by default: off reads pieces in stored order', () => {
    const t = 'שלום iPhoneахא';
    expect(calls(t)[0]).toBe(t);
    expect(calls(t, { ...A, rtlAwareness: false })[0]).toBe('שלום iPhoneaxא');
    expect(() => analyze('x', { ...A, rtlAwareness: 'no' as never })).toThrow(RangeError);
  });
  it('a lone styled dash part is part of the word, as glued; no signal for the style', () => {
    expect(calls('buy ｉ-phone now')).toEqual(['buy i-phone now', 'ｉ-phone→i-phone[]', false]);
    expect(calls('buy ⓘ-phone now')[0]).toBe('buy i-phone now');
    expect(calls('ｉ-ｐｈｏｎｅ')[0]).toBe('i-phone');
    expect(calls('ⓦ-ⓕ')[0]).toBe('w-f');
    expect(calls('paypal-ⓐ')[0]).toBe('paypal-a');
    expect(calls('Это ｘ-ray снимок')[0]).toBe('Это x-ray снимок');
    // Math letters and Roman numerals stay spoofs; units, separators and marks stay.
    expect(calls('ⓘ-𝐩hone')).toEqual(['i-phone', 'ⓘ-𝐩hone→i-phone[confusable_word]', true]);
    for (const t of ['ⓐ-5', '©-2024', 'µ-op', 'ℓ-bottle', '㎏-pack'])
      expect(calls(t)[0], t).toBe(t);
  });
  it('its language comes from outside the token; the category is the unstyled form’s', () => {
    expect(calls('Привет мой ⓟ-ривет')).toEqual(
      calls('Привет мой p-ривет').map((x, i) => (i === 1 ? String(x).replace('p-', 'ⓟ-') : x)),
    );
    expect(calls('αβγ ⓐ-λφα')[0]).toBe('αβγ α-λφα');
    // `m-сервер` has no report: neither have the styled forms (a conversion only).
    expect(calls('Это m-сервер')[1]).toBe('');
    expect(calls('Это ⓜ-сервер')).toEqual(['Это m-сервер', 'ⓜ-сервер→m-сервер[]', false]);
    expect(calls('Это ｍ-сервер')).toEqual(['Это m-сервер', 'ｍ-сервер→m-сервер[]', false]);
  });
});
