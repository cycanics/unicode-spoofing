/**
 * Look-alike packs (decisions 40–40c), the curated donor rows,
 * characters that look like an ASCII digit
 * (41, 41a), capital-only look-alikes (37), and decision 0a.
 */
import { describe, expect, it } from 'vitest';
import {
  analyze,
  buildLookalikes,
  DEFAULT_ADDITIONAL_PACKS,
  defaultLookalikes,
  defaultPacks,
  type AnalyzeOptions,
  type LookalikePair,
} from '../src';
import type { TargetLanguage } from '../src/languages';

const A: AnalyzeOptions = { hiddenChars: 'strict', confusionModel: 'language' };
const norm = (t: string, o: AnalyzeOptions = A) => analyze(t, o).normalized;
const has = (L: TargetLanguage, p: LookalikePair, packs = defaultPacks()) =>
  (packs[L] ?? []).some(([d, y]) => d === p[0] && y === p[1]);

/** Curated rows: donor, target letter, target language, pack. */
const ROWS: readonly [string, string, TargetLanguage, 'default' | 'optional'][] = [
  ['ꚡ', 'И', 'Russian', 'default'], // Bamum Letter Ka
  ['ꛟ', 'V', 'English', 'default'], // Bamum Letter Ko
  ['ᐃ', 'Δ', 'Greek', 'default'], // Canadian Syllabics I
  ['ᐯ', 'V', 'English', 'default'], // Canadian Syllabics Pe
  ['ᒥ', 'Γ', 'Greek', 'default'], // Canadian Syllabics Mi
  ['ᒥ', 'Г', 'Russian', 'default'], // Canadian Syllabics Mi
  ['ᒪ', 'L', 'English', 'default'], // Canadian Syllabics Ma
  ['ᕼ', 'H', 'English', 'default'], // Canadian Syllabics Nunavut H
  ['ᖇ', 'R', 'English', 'default'], // Canadian Syllabics Tlhi
  ['ᗅ', 'A', 'English', 'default'], // Canadian Syllabics Carrier Gho
  ['ᗞ', 'D', 'English', 'default'], // Canadian Syllabics Carrier The
  ['ᗷ', 'B', 'English', 'default'], // Canadian Syllabics Carrier Khe
  ['ᘯ', 'Ω', 'Greek', 'default'], // Canadian Syllabics Carrier Lho
  ['𐊠', 'A', 'English', 'default'], // Carian Letter A
  ['𐊡', 'B', 'English', 'default'], // Carian Letter P2
  ['𐊢', 'C', 'English', 'default'], // Carian Letter D
  ['𐊣', 'Δ', 'Greek', 'default'], // Carian Letter L
  ['𐊫', 'O', 'English', 'default'], // Carian Letter O
  ['𐊱', 'T', 'English', 'default'], // Carian Letter C-18
  ['𐊲', 'Y', 'English', 'default'], // Carian Letter U
  ['𐊴', 'X', 'English', 'default'], // Carian Letter X
  ['𐊶', 'Ω', 'Greek', 'default'], // Carian Letter Tt2
  ['𐋏', 'H', 'English', 'default'], // Carian Letter E2
  ['𐐕', 'C', 'English', 'default'], // Deseret Capital Letter Chee
  ['𐐛', 'L', 'English', 'default'], // Deseret Capital Letter Eth
  ['𐐠', 'S', 'English', 'default'], // Deseret Capital Letter Zhee
  ['𐔘', 'к', 'Russian', 'default'], // Elbasan Letter Qe
  ['𐔝', 'v', 'English', 'default'], // Elbasan Letter Te
  ['𐔦', 'L', 'English', 'default'], // Elbasan Letter Ghamma
  ['𐔧', 'x', 'English', 'default'], // Elbasan Letter Khe
  ['〇', 'O', 'English', 'default'], // Ideographic Number Zero
  ['೦', 'O', 'English', 'default'], // Kannada Digit Zero
  ['ꓐ', 'B', 'English', 'default'], // Lisu Letter Ba
  ['ꓑ', 'P', 'English', 'default'], // Lisu Letter Pa
  ['ꓓ', 'D', 'English', 'default'], // Lisu Letter Da
  ['ꓔ', 'T', 'English', 'default'], // Lisu Letter Ta
  ['ꓖ', 'G', 'English', 'default'], // Lisu Letter Ga
  ['ꓗ', 'K', 'English', 'default'], // Lisu Letter Ka
  ['ꓙ', 'J', 'English', 'default'], // Lisu Letter Ja
  ['ꓚ', 'C', 'English', 'default'], // Lisu Letter Ca
  ['ꓜ', 'Z', 'English', 'default'], // Lisu Letter Dza
  ['ꓝ', 'F', 'English', 'default'], // Lisu Letter Tsa
  ['ꓟ', 'M', 'English', 'default'], // Lisu Letter Ma
  ['ꓠ', 'N', 'English', 'default'], // Lisu Letter Na
  ['ꓡ', 'L', 'English', 'default'], // Lisu Letter La
  ['ꓢ', 'S', 'English', 'default'], // Lisu Letter Sa
  ['ꓣ', 'R', 'English', 'default'], // Lisu Letter Zha
  ['ꓦ', 'V', 'English', 'default'], // Lisu Letter Ha
  ['ꓧ', 'H', 'English', 'default'], // Lisu Letter Xa
  ['ꓪ', 'W', 'English', 'default'], // Lisu Letter Wa
  ['ꓫ', 'X', 'English', 'default'], // Lisu Letter Sha
  ['ꓬ', 'Y', 'English', 'default'], // Lisu Letter Ya
  ['ꓮ', 'A', 'English', 'default'], // Lisu Letter A
  ['ꓰ', 'E', 'English', 'default'], // Lisu Letter E
  ['ꓳ', 'O', 'English', 'default'], // Lisu Letter O
  ['ꓴ', 'U', 'English', 'default'], // Lisu Letter U
  ['𐊂', 'B', 'English', 'default'], // Lycian Letter B
  ['𐊅', 'Δ', 'Greek', 'default'], // Lycian Letter D
  ['𐊆', 'E', 'English', 'default'], // Lycian Letter I
  ['𐊇', 'F', 'English', 'default'], // Lycian Letter W
  ['𐊐', 'X', 'English', 'default'], // Lycian Letter Mm
  ['𐊒', 'O', 'English', 'default'], // Lycian Letter U
  ['𐊕', 'P', 'English', 'default'], // Lycian Letter R
  ['𐊗', 'T', 'English', 'default'], // Lycian Letter T
  ['𖼇', 'Γ', 'Greek', 'default'], // Miao Letter Fa
  ['𖼇', 'Г', 'Russian', 'default'], // Miao Letter Fa
  ['𖼈', 'V', 'English', 'default'], // Miao Letter Va
  ['𖼊', 'T', 'English', 'default'], // Miao Letter Ta
  ['𖼖', 'L', 'English', 'default'], // Miao Letter La
  ['𖼚', 'Δ', 'Greek', 'default'], // Miao Letter Tlha
  ['𖼵', 'R', 'English', 'default'], // Miao Letter Zha
  ['𖼺', 'S', 'English', 'default'], // Miao Letter Sa
  ['𖽀', 'A', 'English', 'default'], // Miao Letter Zzya
  ['𖽂', 'U', 'English', 'default'], // Miao Letter Wa
  ['𖽃', 'Y', 'English', 'default'], // Miao Letter Ah
  ['𐌁', 'B', 'English', 'default'], // Old Italic Letter Be
  ['𐌗', 'X', 'English', 'default'], // Old Italic Letter Eks
  ['𐌢', 'X', 'English', 'default'], // Old Italic Numeral Ten
  ['ଠ', 'O', 'English', 'default'], // Oriya Letter Ttha
  ['𐓂', 'O', 'English', 'default'], // Osage Capital Letter O
  ['𐓎', 'U', 'English', 'default'], // Osage Capital Letter U
  ['𐓑', 'Ψ', 'Greek', 'default'], // Osage Capital Letter Gha
  ['ᚷ', 'X', 'English', 'default'], // Runic Letter Gebo Gyfu G
  ['ⴸ', 'V', 'English', 'default'], // Tifinagh Letter Yadh
  ['ⴹ', 'E', 'English', 'default'], // Tifinagh Letter Yadd
  ['ⵔ', 'O', 'English', 'default'], // Tifinagh Letter Yar
  ['ⵝ', 'X', 'English', 'default'], // Tifinagh Letter Yath
  ['ⵠ', 'Δ', 'Greek', 'default'], // Tifinagh Letter Yav
  ['𑢠', 'V', 'English', 'default'], // Warang Citi Capital Letter Ngaa
  ['𑢣', 'L', 'English', 'default'], // Warang Citi Capital Letter Yu
  ['𑢩', 'Z', 'English', 'default'], // Warang Citi Capital Letter O
  ['𑢮', 'E', 'English', 'default'], // Warang Citi Capital Letter Yuj
  ['𑢵', 'O', 'English', 'default'], // Warang Citi Capital Letter At
  ['𑢸', 'U', 'English', 'default'], // Warang Citi Capital Letter Pu
  ['𑢼', 'T', 'English', 'default'], // Warang Citi Capital Letter Har
  ['𑣩', 'c', 'English', 'default'], // Warang Citi Digit Nine
  ['ᗪ', 'D', 'English', 'default'], // Canadian Syllabics Carrier Pe
  ['𑢦', 'E', 'English', 'default'], // Warang Citi Capital Letter Ii
  ['ᖴ', 'F', 'English', 'default'], // Canadian Syllabics Blackfoot We
  ['𐊥', 'F', 'English', 'default'], // Carian Letter R
  ['𐔥', 'F', 'English', 'default'], // Elbasan Letter Ghe
  ['𑢢', 'F', 'English', 'default'], // Warang Citi Capital Letter Wi
  ['𑣂', 'f', 'English', 'default'], // Warang Citi Small Letter Wi
  ['ᒍ', 'J', 'English', 'default'], // Canadian Syllabics Co
  ['ᛕ', 'K', 'English', 'default'], // Runic Letter Open-P
  ['𑢲', 'L', 'English', 'default'], // Warang Citi Capital Letter Tte
  ['ᗰ', 'M', 'English', 'default'], // Canadian Syllabics Carrier Go
  ['𐊰', 'M', 'English', 'default'], // Carian Letter S
  ['𐌑', 'M', 'English', 'default'], // Old Italic Letter She
  ['ᛖ', 'M', 'English', 'default'], // Runic Letter Ehwaz Eh E
  ['𐐄', 'O', 'English', 'default'], // Deseret Capital Letter Long O
  ['߀', 'O', 'English', 'default'], // Nko Digit Zero
  ['𐔖', 'o', 'English', 'default'], // Elbasan Letter O
  ['ዐ', 'O', 'English', 'default'], // Ethiopic Syllable Pharyngeal A
  ['𑣠', 'o', 'English', 'default'], // Warang Citi Digit Zero
  ['ᑭ', 'P', 'English', 'default'], // Canadian Syllabics Ki
  ['ⵕ', 'Q', 'English', 'default'], // Tifinagh Letter Yarr
  ['𐒴', 'R', 'English', 'default'], // Osage Capital Letter Bra
  ['ᑌ', 'U', 'English', 'default'], // Canadian Syllabics Te
  ['ሀ', 'U', 'English', 'default'], // Ethiopic Syllable Ha
  ['𑣦', 'W', 'English', 'default'], // Warang Citi Digit Six
  ['𑢤', 'Y', 'English', 'default'], // Warang Citi Capital Letter Ya
  ['𐔓', 'n', 'English', 'optional'], // Elbasan Letter Ne; optional
  ['𐊖', 's', 'English', 'optional'], // Lycian Letter S; optional
  ['𑣬', 'X', 'English', 'optional'], // Warang Citi Number Thirty; optional
  ['𑣥', 'z', 'English', 'optional'], // Warang Citi Digit Five; optional
  ['𐓍', 'Ћ', 'Serbian', 'default'], // Osage Capital Letter Dha; Ћ only
  ['𐐥', 'И', 'Russian', 'default'], // Deseret Capital Letter Eng
  ['ꛛ', 'П', 'Russian', 'default'], // Bamum Letter Na; Russian П, not Greek Π
  ['ᛰ', 'Φ', 'Greek', 'default'], // Runic Belgthor Symbol
  ['ᛰ', 'Ф', 'Russian', 'default'], // Runic Belgthor Symbol
  ['𐊳', 'Φ', 'Greek', 'default'], // Carian Letter Nn
  ['𐊳', 'Ф', 'Russian', 'default'], // Carian Letter Nn
  ['ቀ', 'Φ', 'Greek', 'default'], // Ethiopic Syllable Qa
  ['ቀ', 'Ф', 'Russian', 'default'], // Ethiopic Syllable Qa
  ['ᛘ', 'Ψ', 'Greek', 'default'], // Runic Letter Long-Branch-Madr M
  ['٧', 'V', 'English', 'default'], // Arabic-Indic Digit Seven; digit
  ['۷', 'V', 'English', 'default'], // Extended Arabic-Indic Digit Seven; digit
  ['ו', 'i', 'English', 'default'], // Hebrew Letter Vav
  ['ן', 'l', 'English', 'default'], // Hebrew Letter Final Nun
  ['ا', 'l', 'English', 'default'], // Arabic Letter Alef
  ['င', 'c', 'English', 'default'], // Myanmar Letter Nga
  ['ꓒ', 'd', 'English', 'default'], // Lisu Letter Pha
  ['𑣃', 'i', 'English', 'default'], // Warang Citi Small Letter Yu
  ['ه', 'o', 'English', 'default'], // Arabic Letter Heh
  ['ہ', 'o', 'English', 'default'], // Arabic Letter Heh Goal
  ['ە', 'o', 'English', 'default'], // Arabic Letter Ae
  ['ಂ', 'o', 'English', 'default'], // Kannada Sign Anusvara
  ['ം', 'o', 'English', 'default'], // Malayalam Sign Anusvara
  ['ഠ', 'o', 'English', 'default'], // Malayalam Letter Ttha
  ['ං', 'o', 'English', 'default'], // Sinhala Sign Anusvaraya
  ['ం', 'o', 'English', 'default'], // Telugu Sign Anusvara
  ['𑣈', 'o', 'English', 'default'], // Warang Citi Small Letter E
  ['ട', 's', 'English', 'default'], // Malayalam Letter Tta
  ['𑣁', 's', 'English', 'default'], // Warang Citi Small Letter A
  ['𑣘', 'u', 'English', 'default'], // Warang Citi Small Letter Pu
  ['𑜆', 'v', 'English', 'default'], // Ahom Letter Pa
  ['ט', 'v', 'English', 'default'], // Hebrew Letter Tet
  ['𑜊', 'w', 'English', 'default'], // Ahom Letter Ja
  ['𑜎', 'w', 'English', 'default'], // Ahom Letter La
  ['𑜏', 'w', 'English', 'default'], // Ahom Letter Sa
  ['ყ', 'y', 'English', 'default'], // Georgian Letter Qar
  ['𑣄', 'z', 'English', 'default'], // Warang Citi Small Letter Ya
  ['પ', 'ч', 'Russian', 'default'], // Gujarati Letter Pa
  ['𐓛', 'λ', 'Greek', 'default'], // Osage Small Letter Ah
  ['𐓹', 'ψ', 'Greek', 'default'], // Osage Small Letter Gha
  ['𑣜', 'γ', 'Greek', 'optional'], // Warang Citi Small Letter Har
  ['٥', 'o', 'English', 'default'], // Arabic-Indic Digit Five; digit
  ['०', 'o', 'English', 'default'], // Devanagari Digit Zero; digit
  ['૦', 'o', 'English', 'default'], // Gujarati Digit Zero; digit
  ['౦', 'o', 'English', 'default'], // Telugu Digit Zero; digit
  ['૫', 'ч', 'Russian', 'default'], // Gujarati Digit Five; digit
  ['۱', 'l', 'English', 'default'], // Extended Arabic-Indic Digit One; decision 0a: digit
  ['൦', 'o', 'English', 'default'], // Malayalam Digit Zero; digit
  ['Ⳝ', 'δ', 'Greek', 'default'], // Coptic Capital Letter Old Nubian Shima
  ['Ϭ', 'б', 'Russian', 'default'], // Coptic Capital Letter Shima
  ['ᖯ', 'b', 'English', 'default'], // Canadian Syllabics Aivilik B
  ['ᑲ', 'b', 'English', 'default'], // Canadian Syllabics Ka
  ['𐐽', 'c', 'English', 'default'], // Deseret Small Letter Chee
  ['ᑯ', 'd', 'English', 'default'], // Canadian Syllabics Ko
  ['ߊ', 'l', 'English', 'default'], // Nko Letter A
  ['ꓲ', 'I', 'English', 'default'], // Lisu Letter I; 37: caseless, its capital
  ['𞣇', 'l', 'English', 'default'], // Mende Kikakui Digit One
  ['𖼨', 'l', 'English', 'default'], // Miao Letter Gha
  ['𐌉', 'l', 'English', 'default'], // Old Italic Letter I
  ['𐌠', 'l', 'English', 'default'], // Old Italic Numeral One
  ['ᛁ', 'l', 'English', 'default'], // Runic Letter Isaz Is Iss I
  ['ⵏ', 'l', 'English', 'default'], // Tifinagh Letter Yan
  ['𐊊', 'l', 'English', 'default'], // Lycian Letter J
  ['ჿ', 'o', 'English', 'default'], // Georgian Letter Labial Sign
  ['ס', 'o', 'English', 'default'], // Hebrew Letter Samekh
  ['𐐬', 'o', 'English', 'default'], // Deseret Small Letter Long O
  ['𐓪', 'o', 'English', 'default'], // Osage Small Letter O
  ['ဝ', 'o', 'English', 'default'], // Myanmar Letter Wa
  ['𑣗', 'o', 'English', 'default'], // Warang Citi Small Letter Bu
  ['𐑈', 's', 'English', 'default'], // Deseret Small Letter Zhee
  ['𐓶', 'u', 'English', 'default'], // Osage Small Letter U
  ['𑣀', 'v', 'English', 'default'], // Warang Citi Small Letter Ngaa
  ['١', 'l', 'English', 'default'], // Arabic-Indic Digit One
  ['໐', 'o', 'English', 'default'], // Lao Digit Zero
  ['၀', 'o', 'English', 'default'], // Myanmar Digit Zero
  ['௦', 'o', 'English', 'default'], // Tamil Digit Zero
  ['០', 'o', 'English', 'default'], // Khmer Digit Zero
  ['๐', 'o', 'English', 'default'], // Thai Digit Zero
  ['০', 'o', 'English', 'default'], // Bengali Digit Zero
  ['੦', 'o', 'English', 'default'], // Gurmukhi Digit Zero
  ['୦', 'o', 'English', 'default'], // Oriya Digit Zero
  ['𑓐', 'o', 'English', 'default'], // Tirhuta Digit Zero
];

/** Not confusable (or not with that target): in no pack. */
const NOT_CONFUSABLE: readonly [string, string][] = [
  ['𐌂', 'C'],
  ['𐔜', 'c'],
  ['𑣲', 'c'],
  ['𐌕', 'T'],
  ['𑣯', 'W'],
  ['𐊵', 'Ψ'],
  ['ᘵ', 'Ω'],
  ['ၚ', 'c'],
  ['ھ', 'o'],
  ['ᕁ', 'x'],
  ['ᕽ', 'x'],
  ['𑣜', 'y'],
  ['۵', 'o'],
];

/** A word around the donor in the target's script, in a sentence of that script. */
const SAMPLE: Record<string, (d: string) => [string, (y: string) => string]> = {
  English: (d) => [`the ab${d}cd word`, (y) => `the ab${y}cd word`],
  Russian: (d) => [`это до${d}ма вот`, (y) => `это до${y}ма вот`],
  Greek: (d) => [`και κα${d}λα και`, (y) => `και κα${y}λα και`],
  Serbian: (d) => [`то је до${d}ма тамо`, (y) => `то је до${y}ма тамо`],
};

describe('decision 40: one directional pack per target language', () => {
  it('two-way pair: one entry per pack direction', () => {
    expect(has('English', ['а', 'a'])).toBe(true);
    expect(has('Russian', ['a', 'а'])).toBe(true);
    // A donor only reads as the target: no pack maps a target letter into a donor script.
    expect(has('English', ['l', 'ꓡ'])).toBe(false);
    expect(
      Object.values(defaultPacks())
        .flat()
        .some(([, y]) => y === 'ꓡ'),
    ).toBe(false);
  });
});

describe('decision 40a: default packs, overrides in either direction, additional packs', () => {
  it('the default packs: the twin table, ı → i, the curated rows', () => {
    expect(has('English', ['ı', 'i'])).toBe(true);
    expect(norm('Click the lınk to pıng me')).toBe('Click the link to ping me');
    expect(DEFAULT_ADDITIONAL_PACKS).toEqual(['χ~x', 'χ~х', 'ҳ~x', 'ҳ~χ']);
  });
  it('a removed pair does not fold; its reverse direction stays', () => {
    const noA = buildLookalikes({ remove: { English: [['а', 'a']] } });
    expect(norm('pаypal', { ...A, lookalikes: noA })).not.toBe('paypal');
    expect(norm('pаypal')).toBe('paypal');
    expect(has('Russian', ['a', 'а'], noA.pack as never)).toBe(true);
  });
  it('an added pair folds', () => {
    const w = buildLookalikes({ add: { English: [['ж', 'x']] } });
    expect(norm('the eжtra one', { ...A, lookalikes: w })).toBe('the extra one');
    expect(norm('the eжtra one')).not.toBe('the extra one');
  });
  it('additional packs: the optional curated rows are off by default', () => {
    const opt = buildLookalikes({ additional: [...DEFAULT_ADDITIONAL_PACKS, 'optional'] });
    expect(norm('the 𐔓ame here')).not.toBe('the name here');
    expect(norm('the 𐔓ame here', { ...A, lookalikes: opt })).toBe('the name here');
  });
  it('today’s conditional twins are additional packs with today’s defaults', () => {
    const none = buildLookalikes({ additional: [] });
    expect(norm('the eχtra one')).toBe('the extra one');
    expect(norm('the eχtra one', { ...A, lookalikes: none })).not.toBe('the extra one');
    const italic = buildLookalikes({ additional: ['и~u'] });
    expect(norm('the иnit here', { ...A, lookalikes: italic })).toBe('the unit here');
  });
});

describe('§3.3: an intra-Latin fold needs a word of a Latin target language', () => {
  it('lınk → link; Turkish words stay', () => {
    const r = analyze('Click the lınk to pıng me', A);
    expect(r.normalized).toBe('Click the link to ping me');
    expect(r.spoofed).toBe(true);
    const t = 'In winter (kışın) we flew to Iğdır and ığdır';
    expect(analyze(t, A)).toMatchObject({ normalized: t, spoofed: false });
    expect(analyze("İstanbul'da ışık, ğağ", A).spoofed).toBe(false);
    const off = buildLookalikes({ remove: { English: [['ı', 'i']], European: [['ı', 'i']] } });
    expect(analyze('Click the lınk', { ...A, lookalikes: off })).toMatchObject({
      normalized: 'Click the lınk',
      spoofed: false,
    });
  });
});

describe('decision 40c: mapping built ahead of text processing', () => {
  it('a configuration is built once and passed in', () => {
    const c = { add: { English: [['ж', 'x']] as LookalikePair[] } };
    expect(buildLookalikes(c)).toBe(buildLookalikes(c));
    expect(defaultLookalikes()).toBe(defaultLookalikes());
    expect(norm('the eжtra', { ...A, lookalikes: defaultLookalikes() })).toBe(norm('the eжtra'));
  });
  it('an unknown pack or language is an error', () => {
    expect(() => buildLookalikes({ additional: ['nope' as never] })).toThrow();
    expect(() => buildLookalikes({ add: { Klingon: [] } as never })).toThrow();
  });
});

describe('curated donor rows: into the named target', () => {
  /** Rows the fold does not reach as judged: ו has two targets, it reads i; ꓲ reads by its neighbours. */
  const REACH: Record<string, string> = {
    'ו>l': 'i',
    // Decision 37: Lisu `ꓲ` between lowercase letters reads `l`.
    'ꓲ>I': 'l',
  };
  it.each(ROWS.filter((v) => v[3] === 'default'))('%s → %s (%s)', (d, y, L) => {
    expect(has(L, [d, y])).toBe(true);
    y = REACH[`${d}>${y}`] ?? y;
    const targetLanguages: TargetLanguage[] =
      L === 'Serbian' ? ['English', 'Serbian'] : ['English', 'Russian', 'Ukrainian', 'Greek'];
    const [text, out] = SAMPLE[L]!(d);
    expect(norm(text, { ...A, targetLanguages })).toBe(out(y));
  });
  it.each(ROWS.filter((v) => v[3] === 'optional'))(
    '%s → %s (%s): optional, off by default',
    (d, y, L) => {
      expect(has(L, [d, y])).toBe(false);
      const opt = buildLookalikes({ additional: ['optional'] });
      expect(has(L, [d, y], opt.pack as never)).toBe(true);
    },
  );
  it.each(NOT_CONFUSABLE)('%s is not mapped to %s', (d, y) => {
    for (const L of Object.keys(defaultPacks()) as TargetLanguage[])
      expect(has(L, [d, y])).toBe(false);
  });
  it('a donor alone in a sentence of its own script stays (one letter, no context)', () => {
    expect(norm('שלום ו עולם')).toBe('שלום ו עולם');
  });
  it('a donor among letters of its own script stays: the word cannot be mapped', () => {
    for (const t of ['שלום', 'הוא', 'မြန်မာ ငါး']) expect(norm(t)).toBe(t);
    // Alone, with no context, a donor letter with its own vowel signs converts (41d, 41e).
    expect(norm('ငါး')).toBe('cါး');
  });
  it('a word whose every letter is a donor or a target letter folds', () => {
    expect(norm('login to ꓑꓮꓬꓑꓮꓡ now')).toBe('login to PAYPAL now');
    expect(norm('g൦൦gle')).toBe('google');
    expect(norm('methodها')).toBe('methodol');
  });
});

describe('decision 0a: ۱ → l; ۵ unmapped', () => {
  it('۱۵ unchanged', () => {
    expect(norm('۱۵')).toBe('۱۵');
    expect(norm('in ۱۵ days')).toBe('in ۱۵ days');
    expect(norm('۲۰۲۴-۱۱-۱۵')).toBe('۲۰۲۴-۱۱-۱۵');
  });
  it('۱ folds where its word can be mapped', () => {
    expect(norm('the paypa۱ page')).toBe('the paypal page');
  });
  it('a digit of another script keeps a look-alike word from passing unflagged', () => {
    expect(analyze('pa١pal', A).spoofed).toBe(true);
    // 36e: letters of two requested languages, no whole-word mapping; the last one-letter piece is
    // reported, not converted.
    expect(norm('раураl٢')).toBe('раураl٢');
    expect(analyze('раураl٢', A).words[0]!.signals).toContain('mixed_non_legitimate');
  });
});

describe('decisions 41, 41c: ASCII-digit look-alikes convert, spoof', () => {
  const DIGITS: [string, string][] = [
    ['ꛯ', '2'],
    ['Ϩ', '2'],
    ['Ⲝ', '3'],
    ['Ⳅ', '3'],
    ['३', '3'],
    ['૩', '3'],
    ['𖼻', '3'],
    ['𑣊', '3'],
    ['𑢯', '4'],
    ['𑢻', '5'],
    ['Ꮾ', '6'],
    ['Ϭ', '6'],
    ['𑣕', '6'],
    ['𐓒', '7'],
    ['𑣆', '7'],
    ['୨', '9'],
    ['৭', '9'],
    ['ⳋ', '9'],
    ['੧', '9'],
    ['𑢬', '9'],
    ['𑣌', '9'],
    ['Ꮞ', '4'],
    ['৪', '8'],
    ['ᒿ', '2'],
    ['Ⳍ', '3'],
    ['ⳓ', '6'],
    ['Ⳓ', '6'],
    ['𞣋', '8'],
    ['𐌚', '8'],
    ['੪', '8'],
    ['Ⳋ', '9'],
  ];
  it.each(DIGITS)('%s → %s, standalone too, a spoof', (c, d) => {
    const r = analyze(`code ${c} here`, A);
    expect(r.normalized).toBe(`code ${d} here`);
    expect(r.spoofed).toBe(true);
    expect(norm(c)).toBe(d);
  });
  it('error Ꮞ04 → error 404', () => {
    expect(norm('error Ꮞ04')).toBe('error 404');
    expect(norm('Ꮞever')).toBe('4ever');
  });
  it('the Latin-fold model too', () => {
    expect(norm('error Ꮞ04', { hiddenChars: 'strict' })).toBe('error 404');
  });
  it('not judged or judged not: unchanged (Ⳝ is no 6, ൭ no 7, 𑣖 no 9)', () => {
    for (const c of ['Ⳝ', '൭', '𑣖', '۵']) expect(norm(`code ${c} here`)).not.toMatch(/\d/);
  });
  it('the default path (lenient rules, Latin fold) leaves it as written', () => {
    expect(analyze('error Ꮞ04').normalized).toBe('error Ꮞ04');
  });
});

describe('decision 37: a capital-only look-alike folds to the capital, in a lowercase word too', () => {
  it('pꓮypal → pAypal, reported', () => {
    const r = analyze('pꓮypal', A);
    expect(r.normalized).toBe('pAypal');
    expect(r.spoofed).toBe(true);
    expect(norm('ꓡisu')).toBe('Lisu');
  });
  it('the capital-only rows fold to the capital', () => {
    for (const [d, y] of [
      ['ᗪ', 'D'],
      ['ᛕ', 'K'],
      ['ᑭ', 'P'],
      ['ᗰ', 'M'],
    ])
      expect(norm(`the ab${d}cd word`)).toBe(`the ab${y}cd word`);
  });
});

describe('decisions 41i, 41: donors of a non-target script, format characters in place', () => {
  it('defect 1: a donor of its own script is a foreign entry of the placement check', () => {
    for (const t of ['اما', 'هذه', 'هذا', 'انا', 'וגו', 'کتابها']) {
      const r = analyze(t, A);
      expect(r.normalized, t).toBe(t);
      expect(r.spoofed, t).toBe(false);
    }
  });
  it('decision 41i: donors of a word’s non-target script stay', () => {
    for (const t of [
      'paypaוש',
      'paypaןש',
      'paypaاء',
      'gooهب',
      'שוpaypal',
      'باA2DP',
      'صمیمانهs',
      'المثالa',
    ])
      expect(norm(t), t).toBe(t);
    // No target letter: unchanged, no finding (decision 0a).
    for (const t of ['۱۵', 'שלום']) expect(analyze(t, A).spoofed, t).toBe(false);
  });
  it('defect 5: format characters stay where they were', () => {
    for (const t of ['پیاده‌سازی‌های', 'اچ‌آی‌وی', 'بی‌دی‌اس‌ام', 'برنامه‌ریزی‌شده'])
      expect(norm(t), t).toBe(t);
    expect(norm('پیاده‌سازی‌های株')).toBe('پیاده‌سازی‌های株');
  });
});
