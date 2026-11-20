/**
 * The neutral dictionary (decisions 30–32, 30a–30i, 31a, 32a): characters not
 * related to any language that stand for letters (or words) of the target
 * alphabets. It is never a target. Each character has one category of
 * decision 30b, which fixes its behaviour:
 *
 * 1. `visibleStyle` (circled `ⓐ`, parenthesized `⒜`, squared `🄰`, fullwidth
 *    `Ｐ`, ligatures `ﬁ` → `fi`): alone kept; in a word it follows the word's
 *    conversion; no spoof (the word call reports the conversion).
 * 2. `disguise` (math letters of the Mathematical Alphanumeric and Letterlike
 *    blocks, math Greek, the Greek symbol variants of 30i): always converted to
 *    the plain letter, alone too, before the word is judged; a spoof. Math
 *    switch 1 (30h) keeps them as written. The lunate sigma `ϲ` and the long
 *    s `ſ` are ordinary donors of the packs (decision 40f).
 * 3. `sameReading` (Roman numerals U+2160–2188): always converted to their
 *    Latin letters; a spoof only inside a word of a script written with spaces.
 * 4. `separator` (`№`): a word boundary on both sides; never converted or reported.
 * 5. `tailMark` (`© ® ™ ℠`): a word boundary after it, so always at a word's
 *    end; never converted or reported.
 * 6. `unit` (`ℓ ℃ ℉`, the squared Latin abbreviations `㎏ ㎡ …`): alone and at a
 *    word's end kept; at its start or in its middle it follows the word's
 *    conversion and the word call reports it.
 * 7. `wordSign` (`℡` → `TEL`, `℻` → `FAX`): always replaced, before the word is
 *    judged; a spoof when it touches anything but a separator, a digit or a
 *    letter of a script written without spaces.
 *
 * Abbreviation symbols no decision places (`℅ ℀ ₨ 🅪 …`) are
 * `undecided`: kept as written wherever they sit.
 *
 * Not neutral: superscripts, subscripts, ordinal indicators and modifier
 * letters (30c); canonical duplicates of letters (the kelvin, ångström and
 * ohm signs are `K`, `Å`, `Ω`); characters of real scripts, look-alikes
 * included (they are donors of the look-alike packs, decision 40).
 */

import { twinPairs, type ConfusionAlphabet } from './confusion';
import { CP_STYLED, cpFlags } from './token';

/** The categories of decision 30b (plus the undecided symbols). */
export type NeutralCategory =
  | 'visibleStyle'
  | 'disguise'
  | 'sameReading'
  | 'separator'
  | 'tailMark'
  | 'unit'
  | 'wordSign'
  | 'japaneseSquare'
  | 'unitPrefix'
  | 'undecided';

/** How a neutral character takes part in judging its word. */
export type NeutralRole =
  /** Written as its base before the word is judged (categories 2, 3, 7). */
  | 'convert'
  /** Under the alphabet model written in the word's alphabet after judging (categories 1, 6). */
  | 'follow'
  /** Kept as written (categories 4, 5; 6 at a word's end; undecided). */
  | 'keep';

export interface NeutralInfo {
  category: NeutralCategory;
  /** The letters it stands for; '' when it is only kept. */
  base: string;
  /** Script of `base`: 'Latin', 'Cyrillic' or 'Greek'; '' when kept. */
  baseScript: string;
  /** Converted when it stands alone (decision 32a; the default is the category's). */
  standalone: boolean;
}

/** Brand and trademark marks (decision 30b, category 5; `🅪 🅫 🅬` owner 2026-11-15): a word boundary after them. */
export const TAIL_MARKS: ReadonlySet<number> = new Set([
  0x00a9, 0x00ae, 0x2122, 0x2120, 0x1f16a, 0x1f16b, 0x1f16c,
]);
/** Separator symbols (category 4): `№`; Japanese words in a square, `㍻ ㍼ ㍽ ㍾ ㍿` (owner 2026-11-15). */
const SEPARATORS: ReadonlySet<number> = new Set([0x2116, 0x337b, 0x337c, 0x337d, 0x337e, 0x337f]);
/**
 * Word signs (category 7), replaced into English: `℡ ℻`; the English word
 * abbreviations of neutral-symbols-review.md (owner 2026-11-15), as NFKC writes them.
 */
const WORD_SIGNS: ReadonlyMap<number, string> = new Map([
  [0x2121, 'TEL'],
  [0x213b, 'FAX'],
  ...[
    0x33c2, // ㏂ a.m.
    0x33d8, // ㏘ p.m.
    0x33c7, // ㏇ Co.
    0x33d2, // ㏒ log
    0x33d1, // ㏑ ln
    0x2105, // ℅ c/o
    0x2100, // ℀ a/c
    0x2101, // ℁ a/s
    0x20a8, // ₨ Rs
    0x32cf, // ㋏ LTD
    0x3250, // ㉐ PTE
    0x1f190, // 🆐 DJ
    0x2106, // ℆ c/u
  ].map((cp) => [cp, String.fromCodePoint(cp).normalize('NFKC')] as [number, string]),
]);
/** Squared or circled Latin letter pairs (category 1, owner 2026-11-15): `🄭 🄮 🅊–🅏`. */
const LETTER_PAIRS: ReadonlySet<number> = new Set([
  0x1f12d, 0x1f12e, 0x1f14a, 0x1f14b, 0x1f14c, 0x1f14d, 0x1f14e, 0x1f14f,
]);
/**
 * Squared abbreviations of Japanese usage (`㍵` oV, `㏍` KK, `㏚` PR; owner
 * 2026-11-15): converted through their Latin letters, a spoof outside Japanese
 * text, judged as category 3 judges its word.
 */
const JAPANESE_SQUARES: ReadonlySet<number> = new Set([0x3375, 0x33cd, 0x33da]);
/** `🄪` 〔S〕 (owner 2026-11-15): category 1, the letter S. */
const TORTOISE_S = 0x1f12a;
/** The micro sign (category 8, unit prefix). */
const MICRO = 0xb5;
/** The micro sign elsewhere in a word, per target alphabet (30b category 8); no Cyrillic one is decided. */
const MICRO_BY_TARGET: Readonly<Record<string, string>> = { Latin: 'u', Greek: '\u03bc' };
/** Greek symbol variants (decision 30i): exactly the listed eight. */
const GREEK_VARIANTS = new Set([0x3d5, 0x3f5, 0x3d1, 0x3f0, 0x3f1, 0x3d6, 0x3d0, 0x3d2]);

/** Unit symbols (category 6): `ℓ ℃ ℉`, the squared Latin abbreviations, `㋌ ㋍ ㋎`. */
function isUnit(cp: number): boolean {
  return (
    cp === 0x2113 ||
    cp === 0x2103 ||
    cp === 0x2109 ||
    (cp >= 0x3371 && cp <= 0x33df) ||
    cp === 0x33ff ||
    (cp >= 0x32cc && cp <= 0x32ce)
  );
}

const IS_LETTER_RE = /^\p{L}/u;
const IS_LM_RE = /^\p{Lm}/u;
const EMOJI_RE = /^\p{Emoji}/u;
const ASCII_LETTERS_RE = /^[A-Za-z]+$/;
const ASCII_LETTER_RE = /^[A-Za-z]$/;
const HAS_ASCII_LETTER_RE = /[A-Za-z]/;
/** A styled letter's compatibility form: one ASCII letter, maybe in parentheses (`ⓐ`, `⒜`, `🄰`). */
const STYLED_RE = /^\(?([A-Za-z])\)?$/;

/** A single letter of a target alphabet's core (ASCII, Cyrillic, Greek), with its script. */
function targetLetter(s: string): string | null {
  if ([...s].length !== 1) return null;
  if (ASCII_LETTER_RE.test(s)) return 'Latin';
  const cp = s.codePointAt(0)!;
  if ((cp >= 0x400 && cp <= 0x45f) || cp === 0x490 || cp === 0x491) return 'Cyrillic';
  if (cp >= 0x391 && cp <= 0x3c9) return 'Greek';
  return null;
}

const cache = new Map<number, NeutralInfo | null>();
const bmp = new Uint8Array(0x10000);

/** The neutral dictionary's entry for a code point, or null. */
export function neutralInfo(cp: number): NeutralInfo | null {
  if (cp < 0x80) return null;
  if (cp < 0x10000 && bmp[cp] === 1) return null;
  let e = cache.get(cp);
  if (e === undefined) {
    e = classify(cp);
    if (e === null && cp < 0x10000) bmp[cp] = 1;
    else cache.set(cp, e);
  }
  return e;
}

/** A neutral character (BMP answers cached in a table). */
export const isNeutral = (cp: number): boolean => neutralInfo(cp) !== null;

/** Converted alone by default (decision 32a: the category decides). */
const STANDALONE: Readonly<Record<NeutralCategory, boolean>> = {
  visibleStyle: false,
  disguise: true,
  sameReading: true,
  separator: false,
  tailMark: false,
  unit: false,
  wordSign: true,
  japaneseSquare: true,
  unitPrefix: false,
  undecided: false,
};

function entry(category: NeutralCategory, base: string, baseScript: string): NeutralInfo {
  return { category, base, baseScript, standalone: STANDALONE[category] };
}

function classify(cp: number): NeutralInfo | null {
  const ch = String.fromCodePoint(cp);
  if (TAIL_MARKS.has(cp)) return entry('tailMark', '', '');
  if (SEPARATORS.has(cp)) return entry('separator', '', '');
  const sign = WORD_SIGNS.get(cp);
  if (sign) return entry('wordSign', sign, 'Latin');
  // Decision 40f: the long s and the lunate sigma are ordinary donors (packs), not neutrals.
  if (cp === 0x17f || cp === 0x3f2 || cp === 0x3f9) return null;
  if (cp === MICRO) return entry('unitPrefix', 'u', 'Latin');
  if (JAPANESE_SQUARES.has(cp)) return entry('japaneseSquare', ch.normalize('NFKC'), 'Latin');
  if (cp === TORTOISE_S) return entry('visibleStyle', 'S', 'Latin');
  // Negative squared and circled Latin capitals (`🅰 🅿 🅐`) and regional indicators
  // used as letters (`🇦`; a flag pair stays, the scanner's): visible style (owner 2026-11-16).
  if (cp >= 0x1f150 && cp <= 0x1f169)
    return entry('visibleStyle', String.fromCharCode(cp - 0x1f150 + 0x41), 'Latin');
  if (cp >= 0x1f1e6 && cp <= 0x1f1ff)
    return entry('visibleStyle', String.fromCharCode(cp - 0x1f1e6 + 0x41), 'Latin');
  if (cp >= 0x1f170 && cp <= 0x1f189)
    return entry('visibleStyle', String.fromCharCode(cp - 0x1f170 + 0x41), 'Latin');
  if (LETTER_PAIRS.has(cp)) return entry('visibleStyle', ch.normalize('NFKC'), 'Latin');
  // Canonical duplicates (kelvin, ångström, ohm signs) are the letters themselves.
  if (ch.normalize('NFC') !== ch) return null;
  const nf = ch.normalize('NFKC');
  if (isUnit(cp)) return HAS_ASCII_LETTER_RE.test(nf) ? entry('unit', nf, 'Latin') : null;
  const letter = IS_LETTER_RE.test(ch);
  // 30c: superscripts, subscripts, ordinal indicators, modifier letters.
  if (IS_LM_RE.test(ch) || cp === 0xaa || cp === 0xba || (cp >= 0x2070 && cp <= 0x209f))
    return null;
  // 38 / 30b category 3: Roman numerals.
  if (cp >= 0x2160 && cp <= 0x2188)
    return ASCII_LETTERS_RE.test(nf) ? entry('sameReading', nf, 'Latin') : null;
  // 30i: the Greek symbol variants, like math letters.
  if (GREEK_VARIANTS.has(cp)) {
    const base = nf.normalize('NFC');
    const ts = targetLetter(base);
    return ts ? entry('disguise', base, ts) : null;
  }
  // 30g: math letters of the Mathematical Alphanumeric and Letterlike blocks, math Greek included.
  const mathBlock = (cp >= 0x1d400 && cp <= 0x1d7ff) || (cp >= 0x2100 && cp <= 0x214f);
  // An emoji letter (`ℹ`, the information source) is a symbol, not a math letter.
  if (mathBlock && letter && EMOJI_RE.test(ch)) return null;
  if (mathBlock && letter && nf !== ch) {
    const base = nf.normalize('NFC');
    const ts = targetLetter(base);
    return ts ? entry('disguise', base, ts) : null;
  }
  if (letter && nf !== ch && ASCII_LETTERS_RE.test(nf)) return entry('visibleStyle', nf, 'Latin');
  if (!letter && nf !== ch && HAS_ASCII_LETTER_RE.test(nf)) {
    const m = STYLED_RE.exec(nf);
    if (m && cpFlags(cp) & CP_STYLED) return entry('visibleStyle', m[1]!, 'Latin');
    return entry('undecided', '', '');
  }
  return null;
}

/** The base of a neutral character in alphabet `to` (the micro sign, 30b category 8). */
export function baseIn(cp: number, e: NeutralInfo, to: string | null): string | null {
  if (cp === MICRO) return to === null ? e.base : (MICRO_BY_TARGET[to] ?? null);
  return e.base;
}

let twins: Map<string, Map<string, string>> | null = null;

/** Letter → its same-case twin per alphabet (UTS #39 and curated pairs), both directions. */
function twinTable(): Map<string, Map<string, string>> {
  if (twins) return twins;
  twins = new Map();
  for (const { a, b, tag } of twinPairs()) {
    if (tag === 'x') continue;
    for (const [l, o] of [
      [a, b],
      [b, a],
    ] as const) {
      const ls = targetLetter(l);
      const os = targetLetter(o);
      if (!ls || !os || ls === os) continue;
      const per = twins.get(l) ?? new Map<string, string>();
      if (!per.has(os)) per.set(os, o);
      twins.set(l, per);
    }
  }
  return twins;
}

/**
 * A following neutral character (categories 1, 6) written in alphabet `to`:
 * its base when that is the alphabet, else the base's same-case twin in `to`;
 * null when it has none (it stays as written).
 */
export function neutralIn(e: NeutralInfo, to: ConfusionAlphabet | 'Latin'): string | null {
  if (e.base === '') return null;
  if (e.baseScript === to) return e.base;
  let out = '';
  for (const l of e.base) {
    const t = /[A-Za-z]/.test(l) ? twinTable().get(l)?.get(to) : l;
    if (t === undefined) return null;
    out += t;
  }
  return out;
}
