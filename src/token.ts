import { foldChar, skeleton } from './confusables';
import { isRestrictedIdentifierChar } from './identifier-status';
import {
  analyzeWordScripts,
  primaryScript,
  PSEUDO_SCRIPTS,
  SCRIPT_NAMES,
  type PseudoScript,
  type ScriptName,
} from './scripts';

/**
 * Per-token judgement of upstream and strict `analyze` (signals, the
 * de-obfuscated form), and the per-code-point tables the scanners read.
 */
import type { SpoofSignal } from './types';

/**
 * Tokens are runs of letters, marks, digits, format (invisible) characters,
 * and apostrophes. Punctuation and emoji sit between tokens, which keeps
 * emoji ZWJ sequences out of word analysis entirely.
 */
// const TOKEN_RE = /[\p{L}\p{M}\p{N}\p{Cf}'’]+/gu — implemented by scanText.

/** A single character of the token class above — used to find styled glyphs
 * (circled/parenthesized letters, category So) that fall OUTSIDE any token. */
const TOKEN_CHAR_RE = /[\p{L}\p{M}\p{N}\p{Cf}'’]/u;

export const LETTER_RE = /\p{L}/u;
const MARK_RE = /\p{M}/u;
const FORMAT_RE = /\p{Cf}/u;
export const ASCII_PRINTABLE_RE = /^[\x20-\x7e]+$/;
export const ASCII_LETTER_RE = /[a-zA-Z]/;

/**
 * TOKEN_RE deliberately keeps U+2019 inside words so contractions tokenize
 * whole. That one character is enough to make an otherwise plain-ASCII word
 * non-ASCII — and its skeleton folds straight back to "'", so "I’ll" would
 * read as an ASCII word in disguise. Judge a token's ASCII-ness against its
 * straight-apostrophe form so ordinary typographic punctuation is not evidence.
 */
function isAsciiWord(token: string): boolean {
  // Same as ASCII_PRINTABLE_RE over the token with ’ read as ', without the copy.
  if (token.length === 0) return false;
  for (let i = 0; i < token.length; i += 1) {
    const c = token.charCodeAt(i);
    if ((c < 0x20 || c > 0x7e) && c !== 0x2019) return false;
  }
  return true;
}

/**
 * Blank glyphs: they occupy space but draw nothing, and — unlike the Unicode
 * whitespace family (U+00A0, U+2000..U+200A, U+3000 …) — they are not
 * whitespace, so no downstream `\s` normalization or word split touches them.
 * That makes them a way to break a word ("fr<filler>ee") while it still reads
 * normally. The Hangul fillers are category Lo, so without this set they enter
 * words as Hangul letters and misreport as `mixed_script`.
 */
const BLANK_CHARS = new Set([
  0x115f, // HANGUL CHOSEONG FILLER
  0x1160, // HANGUL JUNGSEONG FILLER
  0x3164, // HANGUL FILLER
  0xffa0, // HALFWIDTH HANGUL FILLER
  0x2800, // BRAILLE PATTERN BLANK
  0x1d159, // MUSICAL SYMBOL NULL NOTEHEAD
]);

/**
 * Combining marks that render as nothing. They are category Mn rather than Cf,
 * so the format-character rule misses them. Each is legitimate inside its own
 * script (Khmer, Kaithi) — which the per-letter check (`isOrthographicInvisible`) preserves — and
 * pure obfuscation inside a Latin word.
 */
const INVISIBLE_MARKS = new Set([
  0x034f, // COMBINING GRAPHEME JOINER
  0x17b4, // KHMER VOWEL INHERENT AQ
  0x17b5, // KHMER VOWEL INHERENT AA
  0x110b1, // KAITHI VOWEL SIGN I
]);

/** Variation selectors (VS1–VS16, the VS17–VS256 supplement), incl. the
 * Mongolian free variation selectors. */
function isVariationSelector(cp: number): boolean {
  return (
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    (cp >= 0xe0100 && cp <= 0xe01ef) ||
    (cp >= 0x180b && cp <= 0x180d)
  );
}

/**
 * Scripts whose letters legitimately take a variation selector: ideographic
 * variation sequences (Han and the Japanese kana that mix with it) and the
 * Mongolian free variation selectors. A selector on a letter of any OTHER
 * script has no registered sequence — it renders as nothing and is a payload
 * channel ("ASCII smuggling"). Selectors on symbols (❤️, keycaps, ™️) are not
 * covered here at all: they never sit in a word.
 */
const VARIATION_BASE_SCRIPTS = new Set<ScriptName | PseudoScript>([
  'Han',
  'Hiragana',
  'Katakana',
  'Mongolian',
  'Myanmar', // dotted letter forms (StandardizedVariants.txt)
]);

/** Scripts with ideographic variation sequences: the only bases a selector
 * from the supplement (VS17–VS256) is registered on. */
const IDEOGRAPHIC_BASE_SCRIPTS = new Set<ScriptName | PseudoScript>([
  'Han',
  'Hiragana',
  'Katakana',
]);

/** A handful of characters are letters AND emoji — U+2139 "ℹ" is the common
 * one — so they take the emoji presentation selector legitimately. */
const PICTOGRAPHIC_RE = /\p{Extended_Pictographic}/u;

/** Renders as nothing, in any context. Variation selectors are contextual and
 * are judged separately, against the base character they follow. */
export function isInvisibleChar(ch: string): boolean {
  const cp = ch.codePointAt(0)!;
  return FORMAT_RE.test(ch) || BLANK_CHARS.has(cp) || INVISIBLE_MARKS.has(cp);
}

/**
 * Per-code-point facts for the whole-text passes, computed once per code point
 * (BMP in a typed array, astral in a Map): the passes below then cost one
 * array read per character instead of several regex tests and a normalize().
 */
export const CP_COMPUTED = 1;
export const CP_LETTER = 2;
export const CP_INVISIBLE = 4;
export const CP_VARIATION = 8;
export const CP_STYLED = 16;
export const CP_MARK = 32;
export const CP_NFKC_ASCII_LETTER = 64;
export const CP_TOKEN = 128;
const bmpFlags = new Uint8Array(0x10000);
const astralFlags = new Map<number, number>();
function computeFlags(cp: number): number {
  const ch = String.fromCodePoint(cp);
  let f = CP_COMPUTED;
  if (LETTER_RE.test(ch)) f |= CP_LETTER;
  if (isInvisibleChar(ch)) f |= CP_INVISIBLE;
  if (isVariationSelector(cp)) f |= CP_VARIATION;
  if (MARK_RE.test(ch)) f |= CP_MARK;
  if (TOKEN_CHAR_RE.test(ch)) f |= CP_TOKEN;
  // NFKC folds it to ASCII text with a letter (fullwidth, math, circled …);
  // outside the token class it is a styled letter (circled, parenthesized, squared).
  const nf = ch.normalize('NFKC');
  if (nf !== ch && ASCII_LETTER_RE.test(nf) && ASCII_PRINTABLE_RE.test(nf)) {
    f |= CP_NFKC_ASCII_LETTER;
    if (!(f & CP_TOKEN)) f |= CP_STYLED;
  }
  return f;
}
export function cpFlags(cp: number): number {
  if (cp < 0x10000) {
    const f = bmpFlags[cp]!;
    return f !== 0 ? f : (bmpFlags[cp] = computeFlags(cp));
  }
  let f = astralFlags.get(cp);
  if (f === undefined) astralFlags.set(cp, (f = computeFlags(cp)));
  return f;
}
export const flagOf = (ch: string) => cpFlags(ch.codePointAt(0)!);
/** UTS #39 skeleton of a token, memoized (words repeat; bounded). */
const skeletonCache = new Map<string, string>();
function tokenSkeleton(token: string): string {
  let sk = skeletonCache.get(token);
  if (sk === undefined) {
    if (skeletonCache.size >= 20000) skeletonCache.clear();
    skeletonCache.set(token, (sk = skeleton(token)));
  }
  return sk;
}
/** LETTER_RE.test(token) without the regex. */
export function hasLetter(token: string): boolean {
  for (let i = 0; i < token.length; i += 1) {
    let c = token.charCodeAt(i);
    if (c < 0x80) {
      if ((c | 0x20) >= 0x61 && (c | 0x20) <= 0x7a) return true;
      continue;
    }
    if (c >= 0xd800 && c <= 0xdbff) {
      c = token.codePointAt(i)!;
      if (c > 0xffff) i += 1;
    }
    if (cpFlags(c) & CP_LETTER) return true;
  }
  return false;
}
/** Primary script per BMP code point, as an index into SCRIPT_LIST (+1; 0 = not computed). */
const bmpScript = new Uint8Array(0x10000);
export const SCRIPT_LIST: readonly (ScriptName | PseudoScript)[] = [
  ...SCRIPT_NAMES,
  ...PSEUDO_SCRIPTS,
];
export const N_SCRIPTS = SCRIPT_NAMES.length; // indices ≥ this are pseudo scripts
export function scriptIndexOf(cp: number): number {
  if (cp >= 0x10000) return SCRIPT_LIST.indexOf(primaryScript(String.fromCodePoint(cp)));
  const k = bmpScript[cp]!;
  if (k) return k - 1;
  const idx = SCRIPT_LIST.indexOf(primaryScript(String.fromCharCode(cp)));
  bmpScript[cp] = idx + 1;
  return idx;
}

/** All code units below U+0080: no invisibles, marks, styling or other scripts. */
export function isAsciiRange(text: string, start: number, end: number): boolean {
  for (let i = start; i < end; i += 1) if (text.charCodeAt(i) >= 0x80) return false;
  return true;
}
export const isAsciiToken = (token: string) => isAsciiRange(token, 0, token.length);
export function hasAsciiLetter(text: string, start: number, end: number): boolean {
  for (let i = start; i < end; i += 1) {
    const lower = text.charCodeAt(i) | 0x20;
    if (lower >= 0x61 && lower <= 0x7a) return true;
  }
  return false;
}
/**
 * No mark, NFKC-to-ASCII letter, invisible or selector, and at least one
 * letter of a script other than Latin (the cases analyzeToken leaves to the
 * resolver under `suppressModel`).
 */
export function isPlainNonLatin(text: string, start: number, end: number): boolean {
  let nonLatin = false;
  for (let i = start; i < end; i += 1) {
    let cp = text.charCodeAt(i);
    if (cp < 0x80) continue;
    if (cp >= 0xd800 && cp <= 0xdbff) {
      cp = text.codePointAt(i)!;
      if (cp > 0xffff) i += 1;
    }
    const f = cpFlags(cp);
    if (f & (CP_MARK | CP_NFKC_ASCII_LETTER | CP_INVISIBLE | CP_VARIATION)) return false;
    if (!nonLatin && f & CP_LETTER) {
      const k = scriptIndexOf(cp);
      nonLatin = k > 0 && k < N_SCRIPTS; // 0 = Latin; ≥ N_SCRIPTS = pseudo scripts
    }
  }
  return nonLatin;
}
export const hasLetterRange = (text: string, start: number, end: number) =>
  isAsciiRange(text, start, end)
    ? hasAsciiLetter(text, start, end)
    : hasLetter(text.slice(start, end));

/**
 * Scripts in which format characters (ZWJ/ZWNJ/ZWSP…) or stacked combining
 * marks are part of normal orthography. Exemptions are judged per letter: a
 * mark stack on a letter of these scripts is never zalgo, and a single
 * joiner or zero-width space between their letters is not invisible — see
 * `isOrthographicInvisible`. The rest of the word is judged as usual.
 */
export const FORMAT_CHAR_SCRIPTS: readonly ScriptName[] = [
  'Arabic',
  'Syriac',
  'Nko',
  'Mongolian',
  'Thaana',
  'Devanagari',
  'Bengali',
  'Gurmukhi',
  'Gujarati',
  'Oriya',
  'Tamil',
  'Telugu',
  'Kannada',
  'Malayalam',
  'Sinhala',
  'Thai',
  'Lao',
  'Myanmar',
  'Khmer',
  'Tibetan',
  'Hebrew',
  'Kaithi',
];

const FORMAT_CHAR_SCRIPT_SET = new Set<ScriptName>(FORMAT_CHAR_SCRIPTS);

/** Scripts written right to left, whose text needs the implicit bidi marks. */
const RTL_SCRIPT_SET = new Set<ScriptName>(['Arabic', 'Hebrew', 'Nko', 'Syriac', 'Thaana']);

/** Script of a neighbouring letter; `undefined` when there is none. */
type NeighbourScript = ScriptName | PseudoScript | undefined;

const isFormatCharScript = (s: NeighbourScript) =>
  s !== undefined && FORMAT_CHAR_SCRIPT_SET.has(s as ScriptName);
const isRtlScript = (s: NeighbourScript) => s !== undefined && RTL_SCRIPT_SET.has(s as ScriptName);

/**
 * Joiner sequences with a defined meaning: ZWJ ZWNJ ZWJ breaks a ligature
 * while keeping cursive joining (The Unicode Standard, §23.2), and ZWJ ZWNJ
 * forces a final form (Kurdish and older Persian heh).
 */
const JOINER_IDIOMS = new Set(['\u200D\u200C\u200D', '\u200D\u200C']);

/**
 * The run of invisible characters around `i`, or `undefined` when it is longer
 * than any legitimate run (three). Bounded so a long run costs no more than a
 * short one.
 */
function shortInvisibleRun(chars: readonly string[], i: number): string | undefined {
  let start = i;
  let end = i + 1;
  while (start > 0 && isInvisibleChar(chars[start - 1]!)) {
    start -= 1;
    if (end - start > 3) return undefined;
  }
  while (end < chars.length && isInvisibleChar(chars[end]!)) {
    end += 1;
    if (end - start > 3) return undefined;
  }
  return chars.slice(start, end).join('');
}

/**
 * Whether the invisible character at `i` is part of the orthography of the
 * letters around it, given the scripts of the nearest letter before and after
 * it in the word (marks, invisibles and script-neutral letters such as the
 * tatweel skipped; `undefined` when a digit, punctuation or the word edge
 * comes first) and whether the word has letters of a FORMAT_CHAR_SCRIPTS or
 * right-to-left script at all:
 *  - a single ZWSP/ZWNJ/ZWJ (or a joiner idiom) in a word of such a script,
 *    with no letter of another script on either side (Persian ZWNJ, Indic
 *    conjunct control, Malayalam chillu, Thai/Khmer/Myanmar word breaks,
 *    also next to numerals);
 *  - a single implicit bidi mark or isolate next to a right-to-left letter,
 *    or in a right-to-left word with no letter on either side (next to a
 *    number);
 *  - a combining grapheme joiner between marks of such a letter (it orders
 *    vowel points, e.g. in Biblical Hebrew);
 *  - a format character or invisible mark of the script of a neighbouring
 *    letter (Mongolian vowel separator, Syriac abbreviation mark, the
 *    invisible Khmer vowels). Blank glyphs never: they occupy space.
 * Bidi overrides and embeddings, tag characters, runs of zero-width
 * characters or bidi marks, and anything next to letters of other scripts
 * stay invisible.
 */
function isOrthographicInvisible(
  chars: readonly string[],
  i: number,
  before: NeighbourScript,
  after: NeighbourScript,
  word: { formatChar: boolean; rtl: boolean },
): boolean {
  const ch = chars[i]!;
  const cp = ch.codePointAt(0)!;
  if (cp === 0x200b || cp === 0x200c || cp === 0x200d) {
    const run = shortInvisibleRun(chars, i);
    return (
      run !== undefined &&
      (run.length === 1 || JOINER_IDIOMS.has(run)) &&
      word.formatChar &&
      (before === undefined || isFormatCharScript(before)) &&
      (after === undefined || isFormatCharScript(after))
    );
  }
  if (cp === 0x200e || cp === 0x200f || cp === 0x061c || (cp >= 0x2066 && cp <= 0x2069)) {
    return (
      shortInvisibleRun(chars, i)?.length === 1 &&
      (isRtlScript(before) ||
        isRtlScript(after) ||
        (word.rtl && before === undefined && after === undefined))
    );
  }
  if (cp === 0x034f) {
    return isFormatCharScript(before) && i > 0 && MARK_RE.test(chars[i - 1]!);
  }
  if (BLANK_CHARS.has(cp)) return false;
  const own = primaryScript(ch);
  return (
    own !== 'Common' &&
    own !== 'Inherited' &&
    own !== 'Unknown' &&
    (own === before || own === after)
  );
}

/**
 * For each position, the script of the nearest letter in direction `step`,
 * skipping marks, invisibles and script-neutral letters (the Arabic tatweel
 * is Common); `undefined` when a non-letter or the word edge comes first.
 */
function nearestLetterScripts(chars: readonly string[], step: 1 | -1): NeighbourScript[] {
  const out = new Array<NeighbourScript>(chars.length);
  let script: NeighbourScript;
  for (let k = 0; k < chars.length; k += 1) {
    const i = step === 1 ? chars.length - 1 - k : k;
    out[i] = script;
    const cp = chars[i]!.codePointAt(0)!;
    const f = cpFlags(cp);
    if (f & (CP_MARK | CP_INVISIBLE)) continue;
    if (!(f & CP_LETTER)) {
      script = undefined;
      continue;
    }
    const s = SCRIPT_LIST[scriptIndexOf(cp)]!;
    if (s !== 'Common' && s !== 'Inherited') script = s;
  }
  return out;
}

/**
 * Zero-width AND non-reordering: these render as nothing and move nothing.
 * Deliberately excludes the other invisibles, which stay reportable wherever
 * they sit — bidi controls reorder the line (Trojan Source), tag characters
 * carry a payload (ASCII smuggling), and blank glyphs occupy space, so none of
 * them are inert just because a space is next to them.
 */
export const ZERO_WIDTH_CHARS = new Set([
  0x200b, // ZERO WIDTH SPACE
  0x200c, // ZERO WIDTH NON-JOINER
  0x200d, // ZERO WIDTH JOINER
  0x2060, // WORD JOINER
  0xfeff, // ZERO WIDTH NO-BREAK SPACE
]);

/**
 * Longest run of zero-width characters still treated as inert when it is
 * isolated in whitespace. Each position in a run carries at least a bit, so a
 * long run encodes a payload wherever it sits and is always reported.
 */
export const ZERO_WIDTH_INERT_RUN = 4;

/**
 * Marks zero-width runs that touch no text at all: whitespace (or a string
 * boundary) on BOTH sides. Such a run splits no word and joins no token — it
 * sits in a gap that already exists, so it changes neither what the text
 * renders as nor how it tokenizes, and reporting it is noise.
 *
 * Requiring both sides is the whole safety of the rule. A run touching text on
 * ONE side is still doing work: "admin<ZWSP>" renders as "admin" but compares
 * unequal to it, and "<ZWSP>Valencia" glues to the front of a token the same
 * way — both evade exact matching without splitting anything. Only complete
 * isolation makes a zero-width run inert.
 *
 * Computed over the whole text because the judgement needs both neighbours,
 * which neither the per-token nor the standalone pass can see on its own.
 */
export function inertZeroWidthMask(text: string): Uint8Array {
  const mask = new Uint8Array(text.length);
  for (let i = 0; i < text.length;) {
    const unit = text.charCodeAt(i);
    if (unit < 0x200b || !ZERO_WIDTH_CHARS.has(unit)) {
      i += 1;
      continue;
    }
    let end = i + 1;
    while (end < text.length && ZERO_WIDTH_CHARS.has(text.charCodeAt(end))) end += 1;
    // A string boundary counts as whitespace: there is no text on that side.
    const isolated =
      (i === 0 || /\s/.test(text[i - 1]!)) && (end === text.length || /\s/.test(text[end]!));
    if (isolated && end - i <= ZERO_WIDTH_INERT_RUN) mask.fill(1, i, end);
    i = end;
  }
  return mask;
}

/** Combining marks stacked deeper than this on one base = zalgo. */
export const ZALGO_MARK_RUN = 3;

/**
 * Code points that have no business appearing in ordinary text and that the
 * token scanner would otherwise silently drop (they are not letters, marks,
 * numbers or format characters, so they never enter a word): C0/C1 controls,
 * DEL and Unicode non-characters. TAB, LF and CR are the only C0 controls
 * treated as legitimate whitespace.
 *
 * U+FFFD is NOT here — see `isEncodingDamage`.
 */
export function isIllegalCodePoint(cp: number): boolean {
  if (cp === 0x09 || cp === 0x0a || cp === 0x0d) return false; // TAB, LF, CR
  if (cp < 0x20) return true; // C0 controls
  if (cp >= 0x7f && cp <= 0x9f) return true; // DEL + C1 controls
  if (cp >= 0xfdd0 && cp <= 0xfdef) return true; // non-characters (BMP block)
  if ((cp & 0xfffe) === 0xfffe) return true; // U+xxFFFE / U+xxFFFF in every plane
  return false;
}

/**
 * U+FFFD REPLACEMENT CHARACTER: a decoder emitted this because bytes it was
 * handed were not valid in the encoding it assumed — "José" arriving as
 * "Jos��". It reports a broken pipeline upstream, never intent:
 * whatever the original bytes were, they are gone by the time this character
 * exists, so no payload survives inside it for an attacker to exploit. That is
 * what makes it safe to report without calling the text spoofed, and it is why
 * this is a separate signal rather than an exemption inside `illegal`.
 *
 * It is also left in place by the normalizer. Stripping it would silently
 * repair a corrupted message into one that reads as intact.
 */
export function isEncodingDamage(cp: number): boolean {
  return cp === 0xfffd;
}

/**
 * The whole character ending at `i` — stepping back over a surrogate pair so an
 * astral neighbour (an emoji, typically) reads as itself and not as half of one.
 */
export function charBefore(text: string, i: number): string {
  const unit = text.charCodeAt(i - 1);
  if (unit >= 0xdc00 && unit <= 0xdfff && i >= 2) return text.slice(i - 2, i);
  return text[i - 1]!;
}

export function emptySignals(): Record<SpoofSignal, boolean> {
  // The decision-36a categories appear only when set (upstream's result shape stays).
  return {
    mixed_script: false,
    confusable_word: false,
    invisible: false,
    zalgo: false,
    illegal: false,
    encoding_damage: false,
  } as Record<SpoofSignal, boolean>;
}

/**
 * How a token is judged. Defaults reproduce upstream. `detectInvisible: false`
 * when the strict hidden-character pass is the authority; `suppressModel`
 * when the confusion-model resolver is the authority on the token's letters
 * (no mixed_script, no skeleton fold of a word with non-Latin letters).
 */
export interface TokenFlags {
  detectInvisible: boolean;
  suppressModel: boolean;
  /** Judge marks by the script of their own base, not by any letter of the word (strict). */
  stacksByBase: boolean;
  /** Strip and flag stacked marks (zalgo). Off in strict: phase 1 trims stacks (decision 28b). */
  zalgo?: boolean;
}
export const UPSTREAM_FLAGS: TokenFlags = {
  detectInvisible: true,
  suppressModel: false,
  stacksByBase: false,
};

export interface TokenAnalysis {
  signals: SpoofSignal[];
  scripts: ScriptName[];
  skeleton?: string;
  normalized: string;
}

const isExemptBase = (ch: string) => FORMAT_CHAR_SCRIPT_SET.has(primaryScript(ch) as ScriptName);

export function analyzeToken(
  token: string,
  dominantScript: ScriptName | null,
  anyMixedInMessage: boolean,
  expectedScripts: Set<ScriptName>,
  inertMask: Uint8Array,
  tokenStart: number,
  flags: TokenFlags = UPSTREAM_FLAGS,
): TokenAnalysis {
  // An ASCII token is one Latin word with no invisible, mark, style or
  // lookalike: none of the signals below can fire.
  if (isAsciiToken(token)) return { signals: [], scripts: [], normalized: token };
  const chars = [...token];
  // Aligned with `chars`, so the inert judgement — made over the whole text —
  // is readable per code point here. Stepping by `ch.length` keeps astral
  // characters from shifting the mapping into the UTF-16 mask.
  const inertAt: boolean[] = [];
  if (inertMask.length > 0) {
    let offset = tokenStart;
    for (const ch of chars) {
      inertAt.push(inertMask[offset] === 1);
      offset += ch.length;
    }
  }
  // Blank glyphs are excluded before script analysis: a Hangul filler is a
  // Hangul *letter* to the property tables, and counting it as one would report
  // "fr<filler>ee" as a Latin/Hangul mix rather than as a hidden character.
  const letters = chars.filter((ch) => (flagOf(ch) & (CP_LETTER | CP_INVISIBLE)) === CP_LETTER);
  const signals: SpoofSignal[] = [];

  // Letterless tokens (numbers, stray format characters between emoji) carry
  // no spoofing evidence — analyzing them only produces noise like flagging
  // the ZWJs inside an emoji family sequence.
  if (letters.length === 0) {
    return { signals, scripts: [], normalized: token };
  }

  const { scripts, mixed } = analyzeWordScripts(letters);
  // Hidden characters and marks are judged by the letters next to them; most
  // words have neither, so the neighbour scripts are only resolved on demand.
  // Strict mode judges both by its own rules (hidden-character pass, marks by
  // their own base), so the neighbour scripts are not needed there.
  const judged =
    !flags.stacksByBase && chars.some((ch) => (flagOf(ch) & (CP_MARK | CP_INVISIBLE)) !== 0);
  const letterBefore = judged ? nearestLetterScripts(chars, -1) : [];
  const letterAfter = judged ? nearestLetterScripts(chars, 1) : [];
  const wordScripts = {
    formatChar: scripts.some(isFormatCharScript),
    rtl: scripts.some(isRtlScript),
  };

  // invisible: characters that render as nothing inside a word of a script that
  // does not use them — format characters, blank glyphs, invisible marks, and
  // variation selectors sitting on a base with no registered sequence.
  const strayVariation = new Set<number>();
  for (let i = 0; i < chars.length && flags.detectInvisible; i += 1) {
    const cp = chars[i]!.codePointAt(0)!;
    if (!isVariationSelector(cp)) continue;
    const base = chars[i - 1];
    const supplement = cp >= 0xe0100;
    // At the word start the base sits outside the word: VS1–VS16 there end an
    // emoji or symbol sequence ("❤️you", "≨︀"), which is not this pass's to
    // judge; a supplement selector has no such base.
    if (base === undefined) {
      if (supplement) strayVariation.add(i);
      continue;
    }
    // A base takes one selector; one after another has no sequence to join.
    if (isVariationSelector(base.codePointAt(0)!)) {
      strayVariation.add(i);
      continue;
    }
    // A supplement selector is registered only directly on an ideograph or
    // kana letter. VS1–VS16 also form sequences with digits and symbols
    // (keycaps, slashed zero), but never with a combining mark.
    if (!LETTER_RE.test(base)) {
      if (supplement || MARK_RE.test(base)) strayVariation.add(i);
      continue;
    }
    const baseScript = primaryScript(base);
    const stray = supplement
      ? !IDEOGRAPHIC_BASE_SCRIPTS.has(baseScript)
      : !PICTOGRAPHIC_RE.test(base) && !VARIATION_BASE_SCRIPTS.has(baseScript);
    if (stray) strayVariation.add(i);
  }
  const strayInvisible = judged
    ? chars.map(
        (ch, i) =>
          (flagOf(ch) & CP_INVISIBLE) !== 0 &&
          !inertAt[i] &&
          !isOrthographicInvisible(chars, i, letterBefore[i], letterAfter[i], wordScripts),
      )
    : [];
  const hasInvisible =
    flags.detectInvisible && (strayInvisible.includes(true) || strayVariation.size > 0);
  if (hasInvisible) signals.push('invisible');

  // zalgo: combining marks stacked beyond orthographic depth. Marks on a
  // letter of a script that stacks them are orthography at any depth.
  // Strict: a mark's exemption comes from its own base, and a stack on an exempt
  // base has been trimmed by the hidden-character pass.
  // Variation selectors are category Mn too; one that forms a valid sequence
  // neither counts nor breaks a stack, a stray one counts like any other mark.
  const orthographicMark = judged
    ? chars.map((ch, i) => (flagOf(ch) & CP_MARK) !== 0 && isFormatCharScript(letterBefore[i]))
    : [];
  let markRun = 0;
  let maxMarkRun = 0;
  let baseExempt = false;
  for (let i = 0; i < chars.length; i += 1) {
    const f = flagOf(chars[i]!);
    if (f & CP_VARIATION && !strayVariation.has(i)) continue;
    if (f & CP_MARK && !orthographicMark[i]) markRun += 1;
    else {
      markRun = 0;
      if (flags.stacksByBase && !(f & CP_MARK)) baseExempt = isExemptBase(chars[i]!);
    }
    if (markRun > maxMarkRun && !baseExempt) maxMarkRun = markRun;
  }
  const zalgo = flags.zalgo !== false && maxMarkRun >= ZALGO_MARK_RUN;
  if (zalgo) signals.push('zalgo');

  if (mixed && !flags.suppressModel) signals.push('mixed_script');

  // confusable_word (cross-script): a whole word written as lookalikes of
  // Latin — e.g. all-Cyrillic "НОТ" whose skeleton is "HOT". Requires:
  //  - at least two letters (single letters are too ambiguous),
  //  - the word itself is not plain ASCII,
  //  - its UTS #39 skeleton IS plain ASCII with at least one letter,
  //  - it is not written in a script the caller expects, and
  //  - either the context suggests Latin content (message is Latin-dominant,
  //    other words already mix scripts, or the word's own script is Latin), or
  //    the caller declared the scripts they expect and this word is entirely
  //    OUTSIDE them — a whole word in an unexpected script is spoof evidence
  //    on its own, no Latin context needed.
  //
  // A word already written in Latin is the exception, and needs one more test.
  // Cross-script evidence does not exist there — nothing is impersonating Latin
  // because the word IS Latin — so all that remains is whether its skeleton
  // happens to reach ASCII. That fires on ordinary European orthography:
  // "Ægir" folds to "AEgir" and "ısıtır" to "isitir", both perfectly normal
  // words. Worse, it does so arbitrarily — "æ" is a ligature so UTS #39
  // dissolves it to "ae", while "ø" keeps its stroke as a combining mark and
  // never reaches ASCII, so "Ægir" was reported and "Ålborg" was not.
  //
  // Identifier_Status draws the line Unicode intends for exactly this question:
  // "æ ø å ß þ œ ı" are Allowed (letters of living alphabets), while "ɑ" (IPA
  // alpha) and "ﬁ" (a compatibility ligature) are Restricted. Requiring a
  // Restricted character keeps intra-Latin homoglyphs like "pɑypal" — which no
  // script check can catch — without indicting every Danish surname.
  let skeletonConfusable = false;
  if (!mixed && letters.length >= 2 && !isAsciiWord(token)) {
    const inExpectedScript = scripts.length > 0 && scripts.every((s) => expectedScripts.has(s));
    const latinContext =
      dominantScript === 'Latin' ||
      anyMixedInMessage ||
      (scripts.length > 0 && scripts.every((s) => s === 'Latin'));
    const outsideExpected =
      expectedScripts.size > 0 &&
      scripts.length > 0 &&
      scripts.every((s) => !expectedScripts.has(s));
    // Script-neutral characters (the ʻokina, digits) carry no script evidence
    // either way, so a word of Latin + Common letters is still a Latin word.
    const writtenInLatin = letters.every((ch) => {
      const s = primaryScript(ch);
      return s === 'Latin' || s === 'Common' || s === 'Inherited' || s === 'Unknown';
    });
    const carriesRestricted = chars.some((ch) => isRestrictedIdentifierChar(ch));
    // Decision 40d: under the alphabet model the resolver alone folds letters (requested targets, effective mapping).
    const modelDecides = flags.suppressModel;
    if (
      !modelDecides &&
      !inExpectedScript &&
      (latinContext || outsideExpected) &&
      (!writtenInLatin || carriesRestricted)
    ) {
      const sk = tokenSkeleton(token);
      if (ASCII_PRINTABLE_RE.test(sk) && ASCII_LETTER_RE.test(sk)) {
        signals.push('confusable_word');
        skeletonConfusable = true;
      }
    }
  }

  // confusable_word (compatibility styling): a word spelled in a pseudo-script
  // presentation form — fullwidth "ａｄｍｉｎ", circled "Ⓐⓓⓜⓘⓝ", math-alphanumeric
  // "𝗉𝗋𝖾𝗆𝗂𝗎𝗆" — that NFKC folds straight to an ASCII word. Unlike genuine
  // scripts this is never legitimate orthography, so it is not gated by script
  // context or expectedScripts. Requiring at least two styled LETTERS keeps
  // isolated compatibility symbols used in real text (m², №, ½, ℃, Ⅳ) out.
  let styledConfusable = false;
  if (!mixed && letters.length >= 2 && !isAsciiWord(token)) {
    const styledLetters = letters.filter((ch) => flagOf(ch) & CP_NFKC_ASCII_LETTER);
    if (styledLetters.length >= 2) {
      const fold = token.normalize('NFKC');
      if (fold !== token && ASCII_PRINTABLE_RE.test(fold) && ASCII_LETTER_RE.test(fold)) {
        styledConfusable = true;
        if (!signals.includes('confusable_word')) signals.push('confusable_word');
      }
    }
  }

  // De-obfuscate affected tokens only. Order matters: drop invisibles and
  // zalgo marks first, then fold lookalikes. A word that is ONLY styled folds
  // via NFKC (fullwidth/circled/math → ASCII); cross-script confusables fold
  // via the skeleton map. Using NFKC for math styles resolves the real word
  // rather than the per-glyph skeleton (e.g. "premium", not "prerniurn").
  let normalized = token;
  if (signals.length > 0) {
    const foldLookalikes = signals.includes('mixed_script') || skeletonConfusable;
    const nfkcFold = styledConfusable && !foldLookalikes;
    const dropInvisible = signals.includes('invisible');
    // Strict: a mark on a base of a stacking script is that script's writing.
    let keepMarks = false;
    normalized = chars
      .map((ch, i) => {
        if (flags.stacksByBase && !(flagOf(ch) & CP_MARK)) keepMarks = isExemptBase(ch);
        // Inert characters survive: they were not evidence, so removing them
        // would edit the message without cause.
        if (dropInvisible && (strayInvisible[i] || strayVariation.has(i))) return '';
        const validSelector = isVariationSelector(ch.codePointAt(0)!) && !strayVariation.has(i);
        if (zalgo && MARK_RE.test(ch) && !keepMarks && !orthographicMark[i] && !validSelector)
          return '';
        if (nfkcFold) return ch;
        // The apostrophe is punctuation the token admits, not a lookalike:
        // folding it would turn "Ivа’s" into "Iva's" rather than "Iva’s".
        if (ch === '’') return ch;
        return foldLookalikes ? foldChar(ch) : ch;
      })
      .join('');
    if (nfkcFold) normalized = normalized.normalize('NFKC');
    normalized = normalized.normalize('NFC');
  }

  let resolvedSkeleton: string | undefined;
  if (signals.includes('mixed_script') || skeletonConfusable) resolvedSkeleton = skeleton(token);
  else if (styledConfusable) resolvedSkeleton = token.normalize('NFKC').normalize('NFC');

  return {
    signals,
    scripts,
    skeleton: resolvedSkeleton,
    normalized,
  };
}

export const NO_MASK = new Uint8Array(0);
