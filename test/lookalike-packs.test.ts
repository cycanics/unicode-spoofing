/**
 * Look-alike packs (decisions 40–40c), the owner's verdicts as donor rows
 * (owner-judgements.md, 2026-11-15), characters that look like an ASCII digit
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

const A: AnalyzeOptions = { hiddenChars: 'strict', confusionModel: 'alphabet' };
const norm = (t: string, o: AnalyzeOptions = A) => analyze(t, o).normalized;
const has = (L: TargetLanguage, p: LookalikePair, packs = defaultPacks()) =>
  (packs[L] ?? []).some(([d, y]) => d === p[0] && y === p[1]);

/** The owner's verdicts: donor, target letter, target language, pack. */
const VERDICTS: readonly [string, string, TargetLanguage, 'default' | 'optional'][] = [
  ['ꚡ', 'И', 'Russian', 'default'], // Bamum Letter Ka; same-shape pages
  ['ꛟ', 'V', 'English', 'default'], // Bamum Letter Ko; same-shape pages
  ['ᐃ', 'Δ', 'Greek', 'default'], // Canadian Syllabics I; same-shape pages
  ['ᐯ', 'V', 'English', 'default'], // Canadian Syllabics Pe; same-shape pages
  ['ᒥ', 'Γ', 'Greek', 'default'], // Canadian Syllabics Mi; same-shape pages
  ['ᒥ', 'Г', 'Russian', 'default'], // Canadian Syllabics Mi; same-shape pages
  ['ᒪ', 'L', 'English', 'default'], // Canadian Syllabics Ma; same-shape pages
  ['ᕼ', 'H', 'English', 'default'], // Canadian Syllabics Nunavut H; same-shape pages
  ['ᖇ', 'R', 'English', 'default'], // Canadian Syllabics Tlhi; same-shape pages
  ['ᗅ', 'A', 'English', 'default'], // Canadian Syllabics Carrier Gho; same-shape pages
  ['ᗞ', 'D', 'English', 'default'], // Canadian Syllabics Carrier The; same-shape pages
  ['ᗷ', 'B', 'English', 'default'], // Canadian Syllabics Carrier Khe; same-shape pages
  ['ᘯ', 'Ω', 'Greek', 'default'], // Canadian Syllabics Carrier Lho; same-shape pages
  ['𐊠', 'A', 'English', 'default'], // Carian Letter A; same-shape pages
  ['𐊡', 'B', 'English', 'default'], // Carian Letter P2; same-shape pages
  ['𐊢', 'C', 'English', 'default'], // Carian Letter D; same-shape pages
  ['𐊣', 'Δ', 'Greek', 'default'], // Carian Letter L; same-shape pages
  ['𐊫', 'O', 'English', 'default'], // Carian Letter O; same-shape pages
  ['𐊱', 'T', 'English', 'default'], // Carian Letter C-18; same-shape pages
  ['𐊲', 'Y', 'English', 'default'], // Carian Letter U; same-shape pages
  ['𐊴', 'X', 'English', 'default'], // Carian Letter X; same-shape pages
  ['𐊶', 'Ω', 'Greek', 'default'], // Carian Letter Tt2; same-shape pages
  ['𐋏', 'H', 'English', 'default'], // Carian Letter E2; same-shape pages
  ['𐐕', 'C', 'English', 'default'], // Deseret Capital Letter Chee; same-shape pages
  ['𐐛', 'L', 'English', 'default'], // Deseret Capital Letter Eth; same-shape pages
  ['𐐠', 'S', 'English', 'default'], // Deseret Capital Letter Zhee; same-shape pages
  ['𐔘', 'к', 'Russian', 'default'], // Elbasan Letter Qe; same-shape pages
  ['𐔝', 'v', 'English', 'default'], // Elbasan Letter Te; same-shape pages
  ['𐔦', 'L', 'English', 'default'], // Elbasan Letter Ghamma; same-shape pages
  ['𐔧', 'x', 'English', 'default'], // Elbasan Letter Khe; same-shape pages
  ['〇', 'O', 'English', 'default'], // Ideographic Number Zero; same-shape pages
  ['೦', 'O', 'English', 'default'], // Kannada Digit Zero; same-shape pages
  ['ꓐ', 'B', 'English', 'default'], // Lisu Letter Ba; same-shape pages
  ['ꓑ', 'P', 'English', 'default'], // Lisu Letter Pa; same-shape pages
  ['ꓓ', 'D', 'English', 'default'], // Lisu Letter Da; same-shape pages
  ['ꓔ', 'T', 'English', 'default'], // Lisu Letter Ta; same-shape pages
  ['ꓖ', 'G', 'English', 'default'], // Lisu Letter Ga; same-shape pages
  ['ꓗ', 'K', 'English', 'default'], // Lisu Letter Ka; same-shape pages
  ['ꓙ', 'J', 'English', 'default'], // Lisu Letter Ja; same-shape pages
  ['ꓚ', 'C', 'English', 'default'], // Lisu Letter Ca; same-shape pages
  ['ꓜ', 'Z', 'English', 'default'], // Lisu Letter Dza; same-shape pages
  ['ꓝ', 'F', 'English', 'default'], // Lisu Letter Tsa; same-shape pages
  ['ꓟ', 'M', 'English', 'default'], // Lisu Letter Ma; same-shape pages
  ['ꓠ', 'N', 'English', 'default'], // Lisu Letter Na; same-shape pages
  ['ꓡ', 'L', 'English', 'default'], // Lisu Letter La; same-shape pages
  ['ꓢ', 'S', 'English', 'default'], // Lisu Letter Sa; same-shape pages
  ['ꓣ', 'R', 'English', 'default'], // Lisu Letter Zha; same-shape pages
  ['ꓦ', 'V', 'English', 'default'], // Lisu Letter Ha; same-shape pages
  ['ꓧ', 'H', 'English', 'default'], // Lisu Letter Xa; same-shape pages
  ['ꓪ', 'W', 'English', 'default'], // Lisu Letter Wa; same-shape pages
  ['ꓫ', 'X', 'English', 'default'], // Lisu Letter Sha; same-shape pages
  ['ꓬ', 'Y', 'English', 'default'], // Lisu Letter Ya; same-shape pages
  ['ꓮ', 'A', 'English', 'default'], // Lisu Letter A; same-shape pages
  ['ꓰ', 'E', 'English', 'default'], // Lisu Letter E; same-shape pages
  ['ꓳ', 'O', 'English', 'default'], // Lisu Letter O; same-shape pages
  ['ꓴ', 'U', 'English', 'default'], // Lisu Letter U; same-shape pages
  ['𐊂', 'B', 'English', 'default'], // Lycian Letter B; same-shape pages
  ['𐊅', 'Δ', 'Greek', 'default'], // Lycian Letter D; same-shape pages
  ['𐊆', 'E', 'English', 'default'], // Lycian Letter I; same-shape pages
  ['𐊇', 'F', 'English', 'default'], // Lycian Letter W; same-shape pages
  ['𐊐', 'X', 'English', 'default'], // Lycian Letter Mm; same-shape pages
  ['𐊒', 'O', 'English', 'default'], // Lycian Letter U; same-shape pages
  ['𐊕', 'P', 'English', 'default'], // Lycian Letter R; same-shape pages
  ['𐊗', 'T', 'English', 'default'], // Lycian Letter T; same-shape pages
  ['𖼇', 'Γ', 'Greek', 'default'], // Miao Letter Fa; same-shape pages
  ['𖼇', 'Г', 'Russian', 'default'], // Miao Letter Fa; same-shape pages
  ['𖼈', 'V', 'English', 'default'], // Miao Letter Va; same-shape pages
  ['𖼊', 'T', 'English', 'default'], // Miao Letter Ta; same-shape pages
  ['𖼖', 'L', 'English', 'default'], // Miao Letter La; same-shape pages
  ['𖼚', 'Δ', 'Greek', 'default'], // Miao Letter Tlha; same-shape pages
  ['𖼵', 'R', 'English', 'default'], // Miao Letter Zha; same-shape pages
  ['𖼺', 'S', 'English', 'default'], // Miao Letter Sa; same-shape pages
  ['𖽀', 'A', 'English', 'default'], // Miao Letter Zzya; same-shape pages
  ['𖽂', 'U', 'English', 'default'], // Miao Letter Wa; same-shape pages
  ['𖽃', 'Y', 'English', 'default'], // Miao Letter Ah; same-shape pages
  ['𐌁', 'B', 'English', 'default'], // Old Italic Letter Be; same-shape pages
  ['𐌗', 'X', 'English', 'default'], // Old Italic Letter Eks; same-shape pages
  ['𐌢', 'X', 'English', 'default'], // Old Italic Numeral Ten; same-shape pages
  ['ଠ', 'O', 'English', 'default'], // Oriya Letter Ttha; same-shape pages
  ['𐓂', 'O', 'English', 'default'], // Osage Capital Letter O; same-shape pages
  ['𐓎', 'U', 'English', 'default'], // Osage Capital Letter U; same-shape pages
  ['𐓑', 'Ψ', 'Greek', 'default'], // Osage Capital Letter Gha; same-shape pages
  ['ᚷ', 'X', 'English', 'default'], // Runic Letter Gebo Gyfu G; same-shape pages
  ['ⴸ', 'V', 'English', 'default'], // Tifinagh Letter Yadh; same-shape pages
  ['ⴹ', 'E', 'English', 'default'], // Tifinagh Letter Yadd; same-shape pages
  ['ⵔ', 'O', 'English', 'default'], // Tifinagh Letter Yar; same-shape pages
  ['ⵝ', 'X', 'English', 'default'], // Tifinagh Letter Yath; same-shape pages
  ['ⵠ', 'Δ', 'Greek', 'default'], // Tifinagh Letter Yav; same-shape pages
  ['𑢠', 'V', 'English', 'default'], // Warang Citi Capital Letter Ngaa; same-shape pages
  ['𑢣', 'L', 'English', 'default'], // Warang Citi Capital Letter Yu; same-shape pages
  ['𑢩', 'Z', 'English', 'default'], // Warang Citi Capital Letter O; same-shape pages
  ['𑢮', 'E', 'English', 'default'], // Warang Citi Capital Letter Yuj; same-shape pages
  ['𑢵', 'O', 'English', 'default'], // Warang Citi Capital Letter At; same-shape pages
  ['𑢸', 'U', 'English', 'default'], // Warang Citi Capital Letter Pu; same-shape pages
  ['𑢼', 'T', 'English', 'default'], // Warang Citi Capital Letter Har; same-shape pages
  ['𑣩', 'c', 'English', 'default'], // Warang Citi Digit Nine; capital review
  ['ᗪ', 'D', 'English', 'default'], // Canadian Syllabics Carrier Pe; capital review
  ['𑢦', 'E', 'English', 'default'], // Warang Citi Capital Letter Ii; capital review
  ['ᖴ', 'F', 'English', 'default'], // Canadian Syllabics Blackfoot We; capital review
  ['𐊥', 'F', 'English', 'default'], // Carian Letter R; capital review
  ['𐔥', 'F', 'English', 'default'], // Elbasan Letter Ghe; capital review
  ['𑢢', 'F', 'English', 'default'], // Warang Citi Capital Letter Wi; capital review
  ['𑣂', 'f', 'English', 'default'], // Warang Citi Small Letter Wi; capital review
  ['ᒍ', 'J', 'English', 'default'], // Canadian Syllabics Co; capital review
  ['ᛕ', 'K', 'English', 'default'], // Runic Letter Open-P; capital review
  ['𑢲', 'L', 'English', 'default'], // Warang Citi Capital Letter Tte; capital review
  ['ᗰ', 'M', 'English', 'default'], // Canadian Syllabics Carrier Go; capital review
  ['𐊰', 'M', 'English', 'default'], // Carian Letter S; capital review
  ['𐌑', 'M', 'English', 'default'], // Old Italic Letter She; capital review
  ['ᛖ', 'M', 'English', 'default'], // Runic Letter Ehwaz Eh E; capital review
  ['𐐄', 'O', 'English', 'default'], // Deseret Capital Letter Long O; capital review
  ['߀', 'O', 'English', 'default'], // Nko Digit Zero; capital review
  ['𐔖', 'o', 'English', 'default'], // Elbasan Letter O; capital review
  ['ዐ', 'O', 'English', 'default'], // Ethiopic Syllable Pharyngeal A; capital review
  ['𑣠', 'o', 'English', 'default'], // Warang Citi Digit Zero; capital review
  ['ᑭ', 'P', 'English', 'default'], // Canadian Syllabics Ki; capital review
  ['ⵕ', 'Q', 'English', 'default'], // Tifinagh Letter Yarr; capital review
  ['𐒴', 'R', 'English', 'default'], // Osage Capital Letter Bra; capital review
  ['ᑌ', 'U', 'English', 'default'], // Canadian Syllabics Te; capital review
  ['ሀ', 'U', 'English', 'default'], // Ethiopic Syllable Ha; capital review
  ['𑣦', 'W', 'English', 'default'], // Warang Citi Digit Six; capital review
  ['𑢤', 'Y', 'English', 'default'], // Warang Citi Capital Letter Ya; capital review
  ['𐔓', 'n', 'English', 'optional'], // Elbasan Letter Ne; capital review: optional
  ['𐊖', 's', 'English', 'optional'], // Lycian Letter S; capital review: optional
  ['𑣬', 'X', 'English', 'optional'], // Warang Citi Number Thirty; capital review: optional
  ['𑣥', 'z', 'English', 'optional'], // Warang Citi Digit Five; capital review: optional
  ['𐓍', 'Ћ', 'Serbian', 'default'], // Osage Capital Letter Dha; capital review: Ћ only
  ['𐐥', 'И', 'Russian', 'default'], // Deseret Capital Letter Eng; capital review
  ['ꛛ', 'П', 'Russian', 'default'], // Bamum Letter Na; capital review: Russian П, not Greek Π
  ['ᛰ', 'Φ', 'Greek', 'default'], // Runic Belgthor Symbol; owner-02
  ['ᛰ', 'Ф', 'Russian', 'default'], // Runic Belgthor Symbol; owner-02
  ['𐊳', 'Φ', 'Greek', 'default'], // Carian Letter Nn; owner-02
  ['𐊳', 'Ф', 'Russian', 'default'], // Carian Letter Nn; owner-02
  ['ቀ', 'Φ', 'Greek', 'default'], // Ethiopic Syllable Qa; owner-02
  ['ቀ', 'Ф', 'Russian', 'default'], // Ethiopic Syllable Qa; owner-02
  ['ᛘ', 'Ψ', 'Greek', 'default'], // Runic Letter Long-Branch-Madr M; owner-02
  ['٧', 'V', 'English', 'default'], // Arabic-Indic Digit Seven; owner-02: digit
  ['۷', 'V', 'English', 'default'], // Extended Arabic-Indic Digit Seven; owner-02: digit
  ['ו', 'i', 'English', 'default'], // Hebrew Letter Vav; strokes
  ['ן', 'l', 'English', 'default'], // Hebrew Letter Final Nun; strokes
  ['ا', 'l', 'English', 'default'], // Arabic Letter Alef; strokes
  ['င', 'c', 'English', 'default'], // Myanmar Letter Nga; set a
  ['ꓒ', 'd', 'English', 'default'], // Lisu Letter Pha; set a
  ['𑣃', 'i', 'English', 'default'], // Warang Citi Small Letter Yu; set a
  ['ه', 'o', 'English', 'default'], // Arabic Letter Heh; set a
  ['ہ', 'o', 'English', 'default'], // Arabic Letter Heh Goal; set a
  ['ە', 'o', 'English', 'default'], // Arabic Letter Ae; set a
  ['ಂ', 'o', 'English', 'default'], // Kannada Sign Anusvara; set a
  ['ം', 'o', 'English', 'default'], // Malayalam Sign Anusvara; set a
  ['ഠ', 'o', 'English', 'default'], // Malayalam Letter Ttha; set a
  ['ං', 'o', 'English', 'default'], // Sinhala Sign Anusvaraya; set a
  ['ం', 'o', 'English', 'default'], // Telugu Sign Anusvara; set a
  ['𑣈', 'o', 'English', 'default'], // Warang Citi Small Letter E; set a
  ['ട', 's', 'English', 'default'], // Malayalam Letter Tta; set a
  ['𑣁', 's', 'English', 'default'], // Warang Citi Small Letter A; set a
  ['𑣘', 'u', 'English', 'default'], // Warang Citi Small Letter Pu; set a
  ['𑜆', 'v', 'English', 'default'], // Ahom Letter Pa; set a
  ['ט', 'v', 'English', 'default'], // Hebrew Letter Tet; set a
  ['𑜊', 'w', 'English', 'default'], // Ahom Letter Ja; set a
  ['𑜎', 'w', 'English', 'default'], // Ahom Letter La; set a
  ['𑜏', 'w', 'English', 'default'], // Ahom Letter Sa; set a
  ['ყ', 'y', 'English', 'default'], // Georgian Letter Qar; set a
  ['𑣄', 'z', 'English', 'default'], // Warang Citi Small Letter Ya; set a
  ['પ', 'ч', 'Russian', 'default'], // Gujarati Letter Pa; set a
  ['𐓛', 'λ', 'Greek', 'default'], // Osage Small Letter Ah; set a
  ['𐓹', 'ψ', 'Greek', 'default'], // Osage Small Letter Gha; set a
  ['𑣜', 'γ', 'Greek', 'optional'], // Warang Citi Small Letter Har; set a: "maybe"
  ['٥', 'o', 'English', 'default'], // Arabic-Indic Digit Five; set b: digit
  ['०', 'o', 'English', 'default'], // Devanagari Digit Zero; set b: digit
  ['૦', 'o', 'English', 'default'], // Gujarati Digit Zero; set b: digit
  ['౦', 'o', 'English', 'default'], // Telugu Digit Zero; set b: digit
  ['૫', 'ч', 'Russian', 'default'], // Gujarati Digit Five; set b: digit
  ['۱', 'l', 'English', 'default'], // Extended Arabic-Indic Digit One; decision 0a: digit
  ['൦', 'o', 'English', 'default'], // Malayalam Digit Zero; owner: digit
  ['Ⳝ', 'δ', 'Greek', 'default'], // Coptic Capital Letter Old Nubian Shima; set c12
  ['Ϭ', 'б', 'Russian', 'default'], // Coptic Capital Letter Shima; set c13
  ['ᖯ', 'b', 'English', 'default'], // Canadian Syllabics Aivilik B; review 2 same-shape
  ['ᑲ', 'b', 'English', 'default'], // Canadian Syllabics Ka; review 2 same-shape
  ['𐐽', 'c', 'English', 'default'], // Deseret Small Letter Chee; review 2 same-shape
  ['ᑯ', 'd', 'English', 'default'], // Canadian Syllabics Ko; review 2 same-shape
  ['ߊ', 'l', 'English', 'default'], // Nko Letter A; review 2 same-shape
  ['ꓲ', 'I', 'English', 'default'], // Lisu Letter I; review 2 same-shape; 37 (review 22): caseless, its capital
  ['𞣇', 'l', 'English', 'default'], // Mende Kikakui Digit One; review 2 same-shape
  ['𖼨', 'l', 'English', 'default'], // Miao Letter Gha; review 2 same-shape
  ['𐌉', 'l', 'English', 'default'], // Old Italic Letter I; review 2 same-shape
  ['𐌠', 'l', 'English', 'default'], // Old Italic Numeral One; review 2 same-shape
  ['ᛁ', 'l', 'English', 'default'], // Runic Letter Isaz Is Iss I; review 2 same-shape
  ['ⵏ', 'l', 'English', 'default'], // Tifinagh Letter Yan; review 2 same-shape
  ['𐊊', 'l', 'English', 'default'], // Lycian Letter J; review 2 same-shape
  ['ჿ', 'o', 'English', 'default'], // Georgian Letter Labial Sign; review 2 same-shape
  ['ס', 'o', 'English', 'default'], // Hebrew Letter Samekh; review 2 same-shape
  ['𐐬', 'o', 'English', 'default'], // Deseret Small Letter Long O; review 2 same-shape
  ['𐓪', 'o', 'English', 'default'], // Osage Small Letter O; review 2 same-shape
  ['ဝ', 'o', 'English', 'default'], // Myanmar Letter Wa; review 2 same-shape
  ['𑣗', 'o', 'English', 'default'], // Warang Citi Small Letter Bu; review 2 same-shape
  ['𐑈', 's', 'English', 'default'], // Deseret Small Letter Zhee; review 2 same-shape
  ['𐓶', 'u', 'English', 'default'], // Osage Small Letter U; review 2 same-shape
  ['𑣀', 'v', 'English', 'default'], // Warang Citi Small Letter Ngaa; review 2 same-shape
  ['١', 'l', 'English', 'default'], // Arabic-Indic Digit One; review 2 same-shape
  ['໐', 'o', 'English', 'default'], // Lao Digit Zero; review 2 same-shape
  ['၀', 'o', 'English', 'default'], // Myanmar Digit Zero; review 2 same-shape
  ['௦', 'o', 'English', 'default'], // Tamil Digit Zero; review 2 same-shape
  ['០', 'o', 'English', 'default'], // Khmer Digit Zero; review 2 same-shape
  ['๐', 'o', 'English', 'default'], // Thai Digit Zero; review 2 same-shape
  ['০', 'o', 'English', 'default'], // Bengali Digit Zero; review 2 same-shape
  ['੦', 'o', 'English', 'default'], // Gurmukhi Digit Zero; review 2 same-shape
  ['୦', 'o', 'English', 'default'], // Oriya Digit Zero; review 2 same-shape
  ['𑓐', 'o', 'English', 'default'], // Tirhuta Digit Zero; review 2 same-shape
];

/** Verdict "not confusable" (or not to that target): in no pack. */
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
  it('a pair confused both ways is in both packs, each in its own direction', () => {
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
  it('the default packs: the twin table, ı → i, the owner’s verdicts', () => {
    expect(has('English', ['ı', 'i'])).toBe(true);
    expect(norm('Click the lınk to pıng me')).toBe('Click the link to ping me');
    expect(DEFAULT_ADDITIONAL_PACKS).toEqual(['χ~x', 'χ~х', 'ҳ~x', 'ҳ~χ']);
  });
  it('a removed pair no longer folds; its reverse direction stays', () => {
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
  it('additional packs: the owner’s optional verdicts are off by default', () => {
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

describe('decision 40c: the mapping is built outside the text processing', () => {
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

describe('owner verdicts (owner-judgements.md): donor rows into the named target', () => {
  /** Rows the fold does not reach as judged: ו has two targets, the owner's choice is i; ꓲ reads by its neighbours. */
  const REACH: Record<string, string> = {
    'ו>l': 'i',
    // Decision 37: Lisu `ꓲ` between lowercase letters reads `l`.
    'ꓲ>I': 'l',
  };
  it.each(VERDICTS.filter((v) => v[3] === 'default'))('%s → %s (%s)', (d, y, L) => {
    expect(has(L, [d, y])).toBe(true);
    y = REACH[`${d}>${y}`] ?? y;
    const targetLanguages: TargetLanguage[] =
      L === 'Serbian' ? ['English', 'Serbian'] : ['English', 'Russian', 'Ukrainian', 'Greek'];
    const [text, out] = SAMPLE[L]!(d);
    expect(norm(text, { ...A, targetLanguages })).toBe(out(y));
  });
  it.each(VERDICTS.filter((v) => v[3] === 'optional'))(
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

describe('decision 0a: ۱ is a look-alike of l, ۵ is not', () => {
  it('۱۵ is not converted: ۵ has no mapping', () => {
    expect(norm('۱۵')).toBe('۱۵');
    expect(norm('in ۱۵ days')).toBe('in ۱۵ days');
    expect(norm('۲۰۲۴-۱۱-۱۵')).toBe('۲۰۲۴-۱۱-۱۵');
  });
  it('۱ folds where its word can be mapped', () => {
    expect(norm('the paypa۱ page')).toBe('the paypal page');
  });
  it('a digit of another script keeps a look-alike word from passing unflagged', () => {
    expect(analyze('pa١pal', A).spoofed).toBe(true);
    // 36e: two requested alphabets, no whole-word mapping; the last one-letter piece is
    // reported, not converted.
    expect(norm('раураl٢')).toBe('раураl٢');
    expect(analyze('раураl٢', A).words[0]!.signals).toContain('mixed_non_legitimate');
  });
});

describe('decisions 41, 41c: characters that look like an ASCII digit are always converted, a spoof', () => {
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
    ['ᒿ', '2'], // review 2 same-c
    ['Ⳍ', '3'], // review 2 same-c
    ['ⳓ', '6'], // review 2 same-c
    ['Ⳓ', '6'], // review 2 same-c
    ['𞣋', '8'], // review 2 same-c
    ['𐌚', '8'], // review 2 same-c
    ['੪', '8'], // review 2 same-c
    ['Ⳋ', '9'], // review 2 same-c
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
  it('the Latin model too', () => {
    expect(norm('error Ꮞ04', { hiddenChars: 'strict' })).toBe('error 404');
  });
  it('not judged or judged not: unchanged (Ⳝ is no 6, ൭ no 7, 𑣖 no 9)', () => {
    for (const c of ['Ⳝ', '൭', '𑣖', '۵']) expect(norm(`code ${c} here`)).not.toMatch(/\d/);
  });
  it('upstream’s path is untouched', () => {
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
  it('the owner’s capital-only verdicts fold to the capital', () => {
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
