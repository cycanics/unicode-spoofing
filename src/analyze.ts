import { createConfusionModel } from './confusion';
import { foldChar, skeleton } from './confusables';
import { cleanHidden, STRICT_HIDDEN_RULES, type HiddenCharRules } from './hidden';
import { isRestrictedIdentifierChar } from './identifier-status';
import { resolveTokens, type WordResolution } from './resolve';
import {
  analyzeWordScripts,
  primaryScript,
  PSEUDO_SCRIPTS,
  SCRIPT_NAMES,
  type PseudoScript,
  type ScriptName,
} from './scripts';
import {
  SPOOFING_SIGNALS,
  type AnalysisResult,
  type AnalyzeOptions,
  type SpoofSignal,
  type WordFinding,
} from './types';

/**
 * Tokens are runs of letters, marks, digits, format (invisible) characters,
 * and apostrophes. Punctuation and emoji sit between tokens, which keeps
 * emoji ZWJ sequences out of word analysis entirely.
 */
// const TOKEN_RE = /[\p{L}\p{M}\p{N}\p{Cf}'’]+/gu — implemented by scanText.

/** A single character of the token class above — used to find styled glyphs
 * (circled/parenthesized letters, category So) that fall OUTSIDE any token. */
const TOKEN_CHAR_RE = /[\p{L}\p{M}\p{N}\p{Cf}'’]/u;

const LETTER_RE = /\p{L}/u;
const MARK_RE = /\p{M}/u;
const FORMAT_RE = /\p{Cf}/u;
const ASCII_PRINTABLE_RE = /^[\x20-\x7e]+$/;
const ASCII_LETTER_RE = /[a-zA-Z]/;

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
 * Emoji sequences legitimately contain invisible characters: ZWJ between
 * emoji, a presentation selector (VS15/VS16) on an emoji, the selector in a
 * keycap, and the tag characters of a subdivision flag. This matches those
 * sequences (UTS #51) so the standalone pass can exempt exactly the invisibles
 * inside one — and nothing merely sitting next to an emoji, which is where an
 * ASCII-smuggling payload goes ("🎉" + tag characters). Tag sequences must be
 * RGI: any emoji followed by tags would otherwise be a free payload channel.
 * Digits, "#" and "*" are emoji only as keycap bases; on their own they are
 * text, and an invisible next to them is not part of a sequence.
 * Extended_Pictographic admits emoji newer than the engine's Unicode data.
 * One dangling ZWJ is tolerated at either end, as left by truncating a
 * sequence. Built lazily: the `v` flag needs a modern engine, and most text
 * never reaches the standalone pass.
 */
const EMOJI_ELEMENT = String.raw`(?:\p{RGI_Emoji_Tag_Sequence}|\p{RI}\p{RI}|[0-9#*]\uFE0F\u20E3|[[\p{Emoji}\p{Extended_Pictographic}]--[0-9#*]](?:\p{EMod}|[\uFE0E\uFE0F])?)`;
let emojiSequenceRe: RegExp | undefined;

/** Every code point the sequence pattern can match: no match crosses a
 * character outside this set. */
const EMOJI_PART_RE = /[\p{Emoji}\p{Emoji_Component}\p{Extended_Pictographic}\uFE0E]/u;
const isEmojiPart = (cp: number) => EMOJI_PART_RE.test(String.fromCodePoint(cp));

/**
 * Whether the UTF-16 position `i` (a code point start) lies in an emoji
 * sequence. The pattern runs only over the run of emoji-part characters
 * around a position asked about — the same matches as over the whole text,
 * since none crosses the run's edges — and the last run is kept, so the
 * standalone pass, which asks left to right, matches each run once.
 */
function emojiSequenceLookup(text: string): (i: number) => boolean {
  let runStart = 0;
  let runEnd = 0;
  let run = new Uint8Array(0);
  return (i) => {
    if (i < runStart || i >= runEnd) {
      if (!isEmojiPart(text.codePointAt(i)!)) return false;
      let a = i;
      while (a > 0) {
        let p = a - 1;
        const unit = text.charCodeAt(p);
        if (unit >= 0xdc00 && unit <= 0xdfff && p > 0) {
          const high = text.charCodeAt(p - 1);
          if (high >= 0xd800 && high <= 0xdbff) p -= 1;
        }
        if (!isEmojiPart(text.codePointAt(p)!)) break;
        a = p;
      }
      let b = i;
      while (b < text.length) {
        const cp = text.codePointAt(b)!;
        if (!isEmojiPart(cp)) break;
        b += cp > 0xffff ? 2 : 1;
      }
      runStart = a;
      runEnd = b;
      run = new Uint8Array(b - a);
      emojiSequenceRe ??= new RegExp(
        String.raw`\u200D?${EMOJI_ELEMENT}(?:\u200D${EMOJI_ELEMENT})*\u200D?`,
        'gv',
      );
      for (const m of text.slice(a, b).matchAll(emojiSequenceRe))
        run.fill(1, m.index, m.index + m[0].length);
    }
    return run[i - runStart] === 1;
  };
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
function isInvisibleChar(ch: string): boolean {
  const cp = ch.codePointAt(0)!;
  return FORMAT_RE.test(ch) || BLANK_CHARS.has(cp) || INVISIBLE_MARKS.has(cp);
}

/**
 * Per-code-point facts for the whole-text passes, computed once per code point
 * (BMP in a typed array, astral in a Map): the passes below then cost one
 * array read per character instead of several regex tests and a normalize().
 */
const CP_COMPUTED = 1;
const CP_LETTER = 2;
const CP_INVISIBLE = 4;
const CP_VARIATION = 8;
const CP_STYLED = 16;
const CP_MARK = 32;
const CP_NFKC_ASCII_LETTER = 64;
const CP_TOKEN = 128;
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
function cpFlags(cp: number): number {
  if (cp < 0x10000) {
    const f = bmpFlags[cp]!;
    return f !== 0 ? f : (bmpFlags[cp] = computeFlags(cp));
  }
  let f = astralFlags.get(cp);
  if (f === undefined) astralFlags.set(cp, (f = computeFlags(cp)));
  return f;
}
const flagOf = (ch: string) => cpFlags(ch.codePointAt(0)!);
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
function hasLetter(token: string): boolean {
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
const SCRIPT_LIST: readonly (ScriptName | PseudoScript)[] = [...SCRIPT_NAMES, ...PSEUDO_SCRIPTS];
const N_SCRIPTS = SCRIPT_NAMES.length; // indices ≥ this are pseudo scripts
function scriptIndexOf(cp: number): number {
  if (cp >= 0x10000) return SCRIPT_LIST.indexOf(primaryScript(String.fromCodePoint(cp)));
  const k = bmpScript[cp]!;
  if (k) return k - 1;
  const idx = SCRIPT_LIST.indexOf(primaryScript(String.fromCharCode(cp)));
  bmpScript[cp] = idx + 1;
  return idx;
}

/**
 * One pass over the text: tokens (exactly TOKEN_RE's matches), letter counts
 * per primary script in first-seen order, and the positions the later passes
 * report — illegal code points, U+FFFD runs, styled-letter runs (≥ 2).
 */
function scanText(text: string) {
  // Tokens as [start, end) spans: most are never sliced (ASCII words).
  const starts: number[] = [];
  const ends: number[] = [];
  const counts = new Int32Array(SCRIPT_LIST.length);
  const order: number[] = [];
  const illegal: number[] = []; // [start, width, …]
  const damage: number[] = []; // [start, end, …]
  const styled: number[] = []; // [start, end, …]
  let tokStart = -1;
  let damageStart = -1;
  let runStart = -1;
  let runCount = 0;
  const endRun = (end: number) => {
    if (runStart >= 0 && runCount >= 2) styled.push(runStart, end);
    runStart = -1;
    runCount = 0;
  };
  for (let i = 0; i < text.length;) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) {
      const lower = unit | 0x20;
      const letter = lower >= 0x61 && lower <= 0x7a;
      if (letter && counts[0]!++ === 0) order.push(0);
      const tokenChar = letter || (unit >= 0x30 && unit <= 0x39) || unit === 0x27;
      if (tokenChar) {
        if (tokStart < 0) tokStart = i;
      } else if (tokStart >= 0) {
        starts.push(tokStart);
        ends.push(i);
        tokStart = -1;
      }
      if (isIllegalCodePoint(unit)) illegal.push(i, 1);
      if (damageStart >= 0) {
        damage.push(damageStart, i);
        damageStart = -1;
      }
      if (runStart >= 0) endRun(i);
      i += 1;
      continue;
    }
    const cp = text.codePointAt(i)!;
    const width = cp > 0xffff ? 2 : 1;
    const f = cpFlags(cp);
    if ((f & (CP_LETTER | CP_INVISIBLE)) === CP_LETTER) {
      const k = scriptIndexOf(cp);
      if (k < N_SCRIPTS && counts[k]!++ === 0) order.push(k);
    }
    if (f & CP_TOKEN) {
      if (tokStart < 0) tokStart = i;
    } else if (tokStart >= 0) {
      starts.push(tokStart);
      ends.push(i);
      tokStart = -1;
    }
    if (isIllegalCodePoint(cp)) illegal.push(i, width);
    if (isEncodingDamage(cp)) {
      if (damageStart < 0) damageStart = i;
    } else if (damageStart >= 0) {
      damage.push(damageStart, i);
      damageStart = -1;
    }
    // Styled DIGITS (①②③ -> 123) fail ASCII_LETTER_RE and so never join a
    // run, keeping legitimate enclosed numbering out (CP_STYLED).
    if (f & CP_STYLED) {
      if (runStart < 0) runStart = i;
      runCount += 1;
    } else endRun(i);
    i += width;
  }
  if (tokStart >= 0) {
    starts.push(tokStart);
    ends.push(text.length);
  }
  if (damageStart >= 0) damage.push(damageStart, text.length);
  endRun(text.length);
  const scriptCounts = new Map<ScriptName, number>();
  for (const k of order) scriptCounts.set(SCRIPT_LIST[k] as ScriptName, counts[k]!);
  return { tokens: { starts, ends }, scriptCounts, illegal, damage, styled };
}
/** All code units below U+0080: no invisibles, marks, styling or other scripts. */
function isAsciiRange(text: string, start: number, end: number): boolean {
  for (let i = start; i < end; i += 1) if (text.charCodeAt(i) >= 0x80) return false;
  return true;
}
const isAsciiToken = (token: string) => isAsciiRange(token, 0, token.length);
function hasAsciiLetter(text: string, start: number, end: number): boolean {
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
function isPlainNonLatin(text: string, start: number, end: number): boolean {
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
const hasLetterRange = (text: string, start: number, end: number) =>
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
const ZERO_WIDTH_CHARS = new Set([
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
function inertZeroWidthMask(text: string): Uint8Array {
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
function isIllegalCodePoint(cp: number): boolean {
  if (cp === 0x09 || cp === 0x0a || cp === 0x0d) return false; // TAB, LF, CR
  if (cp < 0x20) return true; // C0 controls
  if (cp >= 0x7f && cp <= 0x9f) return true; // DEL + C1 controls
  if (cp >= 0xfdd0 && cp <= 0xfdef) return true; // non-characters (BMP block)
  if ((cp & 0xfffe) === 0xfffe) return true; // U+xxFFFE / U+xxFFFF in every plane
  return false;
}

/* eslint-disable no-control-regex -- ESC is what these patterns match */
/**
 * An ECMA-48 control sequence (CSI): ESC "[", parameter bytes 0x30–0x3F,
 * intermediate bytes 0x20–0x2F, one final byte 0x40–0x7E — e.g. the colour
 * code "\x1b[31m". Only ESC is an illegal code point, but removing it alone
 * would leave "[31m" in the text, so a well-formed sequence goes whole.
 */
const CONTROL_SEQUENCE_RE = /\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g;
/* eslint-enable no-control-regex */

/** `text` with control sequences blanked to spaces of the same length, so
 * their bytes ("31m") do not tokenize as words while offsets stay valid. */
function blankControlSequences(text: string): string {
  if (!text.includes('\x1b')) return text;
  return text.replace(CONTROL_SEQUENCE_RE, (seq) => ' '.repeat(seq.length));
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
function isEncodingDamage(cp: number): boolean {
  return cp === 0xfffd;
}

function emptySignals(): Record<SpoofSignal, boolean> {
  return {
    mixed_script: false,
    confusable_word: false,
    invisible: false,
    zalgo: false,
    illegal: false,
    encoding_damage: false,
  };
}

/**
 * How a token is judged. Defaults reproduce upstream. `detectInvisible: false`
 * when the strict hidden-character pass is the authority; `suppressModel`
 * when the confusion-model resolver is the authority on the token's letters
 * (no mixed_script, no skeleton fold of a word with non-Latin letters).
 */
interface TokenFlags {
  detectInvisible: boolean;
  suppressModel: boolean;
  /** Judge marks by the script of their own base, not by any letter of the word (strict). */
  stacksByBase: boolean;
}
const UPSTREAM_FLAGS: TokenFlags = {
  detectInvisible: true,
  suppressModel: false,
  stacksByBase: false,
};

interface TokenAnalysis {
  signals: SpoofSignal[];
  scripts: ScriptName[];
  skeleton?: string;
  normalized: string;
}

const isExemptBase = (ch: string) => FORMAT_CHAR_SCRIPT_SET.has(primaryScript(ch) as ScriptName);

function analyzeToken(
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
  const zalgo = maxMarkRun >= ZALGO_MARK_RUN;
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
    const modelDecides = flags.suppressModel && scripts.some((s) => s !== 'Latin');
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

export function analyze(input: string, options: AnalyzeOptions = {}): AnalysisResult {
  if (typeof input !== 'string') throw new TypeError('analyze: text must be a string');
  const strict = options.hiddenChars === 'strict';
  const model =
    options.confusionModel === 'alphabet'
      ? createConfusionModel({
          ...(options.targetLanguages && { targetLanguages: options.targetLanguages }),
          ...(options.donorAlphabets && { donorAlphabets: options.donorAlphabets }),
          ...(options.conditionalTwins && { conditionalTwins: options.conditionalTwins }),
        })
      : null;
  // Strict mode: the hidden-character pass runs first and is the authority on
  // invisibles; everything below works on the cleaned text, and offsets are
  // mapped back to the input at the end.
  const hidden = strict ? cleanHidden(input, hiddenRules(options.hiddenCharRules)) : null;
  const text = hidden ? hidden.cleaned : input;
  const tokenFlags: TokenFlags = {
    detectInvisible: !strict,
    suppressModel: false,
    stacksByBase: strict,
  };
  const modelFlags: TokenFlags = {
    detectInvisible: !strict,
    suppressModel: true,
    stacksByBase: strict,
  };

  const expectedScripts = new Set(options.expectedScripts ?? []);
  // Control sequences are blanked for the scan so their bytes ("31m") do not
  // join the neighbouring word; each is reported whole as `illegal` below.
  const scan = scanText(blankControlSequences(text));
  const tokens = scan.tokens;

  // Dominant script: most frequent primary script across all letters (ties go
  // to the first seen).
  const scriptCounts = scan.scriptCounts;
  let dominantScript: ScriptName | null = null;
  let dominantCount = 0;
  for (const [s, count] of scriptCounts) {
    if (count > dominantCount) {
      dominantScript = s;
      dominantCount = count;
    }
  }

  // First pass establishes whether any word mixes scripts — evasion context
  // that lets whole-word confusables flag even when lookalikes outnumber
  // genuine Latin letters (as in heavily obfuscated messages).
  const { starts, ends } = tokens;
  const nTokens = starts.length;
  let anyMixedInMessage = false;
  for (let t = 0; t < nTokens && !anyMixedInMessage; t += 1) {
    if (isAsciiRange(text, starts[t]!, ends[t]!)) continue;
    const token = text.slice(starts[t]!, ends[t]!);
    anyMixedInMessage = analyzeWordScripts([...token].filter((ch) => LETTER_RE.test(ch))).mixed;
  }

  const signals = emptySignals();
  const words: WordFinding[] = [];
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  const inertMask = strict ? NO_MASK : inertZeroWidthMask(text);
  let confusableWords = 0;
  let mixedWords = 0;
  const resolution = model
    ? resolveTokens(text, tokens, model, {
        wholeScriptFold: options.wholeScriptFold ?? 'all',
        expectedScripts: expectedScripts as ReadonlySet<string>,
      })
    : null;

  let wordsTotal = 0;
  for (let t = 0; t < nTokens; t += 1) {
    const start = starts[t]!;
    const end = ends[t]!;
    const resolved = resolution?.resolved.get(t);
    // An ASCII token is one Latin word with no invisible, mark, style or
    // lookalike: nothing below can fire unless the resolver took it (paypaI).
    if (!resolved && isAsciiRange(text, start, end)) {
      if (hasAsciiLetter(text, start, end)) wordsTotal += 1;
      continue;
    }
    // A word the resolver left alone, with a non-Latin letter and nothing else
    // upstream judges (marks, styled letters, invisibles): no signal can fire.
    if (!resolved && resolution?.inModel[t] && isPlainNonLatin(text, start, end)) {
      wordsTotal += 1;
      continue;
    }
    const token = text.slice(start, end);
    if (hasLetter(token)) wordsTotal += 1;
    let result: TokenAnalysis;
    if (resolved) {
      // The resolver folded (or flagged) the word; upstream still judges what
      // the model does not cover (zalgo, styling) on the folded form.
      const rest = analyzeToken(
        resolved.normalized,
        dominantScript,
        anyMixedInMessage,
        expectedScripts,
        NO_MASK,
        0,
        modelFlags,
      );
      const letters = [...token].filter((ch) => LETTER_RE.test(ch) && !isInvisibleChar(ch));
      const { scripts, mixed } = analyzeWordScripts(letters);
      const own: SpoofSignal = mixed ? 'mixed_script' : 'confusable_word';
      result = {
        signals: [own, ...rest.signals.filter((s) => s !== own)],
        scripts,
        skeleton: skeleton(token),
        normalized: rest.signals.length ? rest.normalized : resolved.normalized,
      };
      if (resolved.class === 'mixed') mixedWords += 1;
      else confusableWords += 1;
    } else {
      result = analyzeToken(
        token,
        dominantScript,
        anyMixedInMessage,
        expectedScripts,
        inertMask,
        start,
        resolution?.inModel[t] ? modelFlags : tokenFlags,
      );
    }
    if (result.signals.length === 0) continue;

    for (const s of result.signals) signals[s] = true;
    words.push({
      word: token,
      index: start,
      signals: result.signals,
      scripts: result.scripts,
      ...(result.skeleton !== undefined && { skeleton: result.skeleton }),
      ...((model || strict) && { normalized: result.normalized }),
      ...(resolved && { resolution: resolutionOf(resolved) }),
    });
    if (result.normalized !== token) {
      replacements.push({ start, end, value: result.normalized });
    }
  }

  // Invisible characters that belong to no word: between punctuation, between
  // spaces, or attached to a symbol. The per-token pass above cannot see them —
  // a lone format character forms a token of its own with no letters in it, and
  // a blank glyph is not a token character at all. This is what hides the two
  // isolates in a Trojan Source line ("user<RLO> <LRI>// admin").
  // In strict mode the hidden-character pass has judged every invisible.
  if (!strict) {
    // Positions covered by a word the token pass already judged; invisibles
    // inside one are that word's business. A mask keeps this pass linear.
    const wordMask = new Uint8Array(text.length);
    for (let t = 0; t < nTokens; t += 1) {
      if (!hasLetterRange(text, starts[t]!, ends[t]!)) continue;
      wordMask.fill(1, starts[t]!, ends[t]!);
    }
    const inWord = (i: number) => wordMask[i] === 1;
    const inSequence = emojiSequenceLookup(text);

    for (let i = 0; i < text.length;) {
      if (text.charCodeAt(i) < 0x80) {
        i += 1;
        continue;
      }
      const cp = text.codePointAt(i)!;
      const width = cp > 0xffff ? 2 : 1;
      if (
        !(cpFlags(cp) & (CP_INVISIBLE | CP_VARIATION)) ||
        inWord(i) ||
        inertMask[i] === 1 ||
        inSequence(i)
      ) {
        i += width;
        continue;
      }

      // Extend over the whole invisible run so a payload reports as one finding.
      let end = i + width;
      while (end < text.length) {
        const next = text.codePointAt(end)!;
        if (!(cpFlags(next) & (CP_INVISIBLE | CP_VARIATION)) || inWord(end)) break;
        if (inertMask[end] === 1 || inSequence(end)) break;
        end += next > 0xffff ? 2 : 1;
      }

      signals.invisible = true;
      words.push({
        word: text.slice(i, end),
        index: i,
        signals: ['invisible'],
        scripts: [],
      });
      replacements.push({ start: i, end, value: '' });
      i = end;
    }
  }

  // Illegal code points live *between* tokens (the token scanner drops them),
  // so they are found in a separate pass over the raw text. Each becomes its
  // own finding and is stripped from the normalized output, a control sequence
  // (blanked for the scan above) as a whole together with its ESC.
  const illegal = scan.illegal;
  if (text.includes('\x1b')) {
    for (const m of text.matchAll(CONTROL_SEQUENCE_RE)) illegal.push(m.index, m[0].length);
  }
  for (let k = 0; k < illegal.length; k += 2) {
    const i = illegal[k]!;
    const width = illegal[k + 1]!;
    signals.illegal = true;
    words.push({ word: text.slice(i, i + width), index: i, signals: ['illegal'], scripts: [] });
    replacements.push({ start: i, end: i + width, value: '' });
  }

  // Decode damage. A run reports as ONE finding: a single destroyed character
  // usually yields several U+FFFDs (a two-byte "é" becomes two), and per-code-
  // point findings would overstate how much of the text is broken. Nothing is
  // replaced — see `isEncodingDamage`.
  for (let k = 0; k < scan.damage.length; k += 2) {
    const i = scan.damage[k]!;
    const end = scan.damage[k + 1]!;
    signals.encoding_damage = true;
    words.push({ word: text.slice(i, end), index: i, signals: ['encoding_damage'], scripts: [] });
  }

  // Compatibility-styled letter runs the token scanner skips because the glyphs
  // are symbols, not letters (category So): circled "Ⓐⓓⓜⓘⓝ", parenthesized,
  // squared. A run of >=2 such glyphs whose NFKC form is an ASCII word is the
  // same disguised-word attack as fullwidth/math styling (which tokenize and are
  // handled per-token).
  for (let k = 0; k < scan.styled.length; k += 2) {
    const runStart = scan.styled[k]!;
    const end = scan.styled[k + 1]!;
    const fold = text.slice(runStart, end).normalize('NFKC').normalize('NFC');
    // Belt-and-braces: every character in the run already passed these two
    // tests individually, so the concatenation cannot fail them.
    if (ASCII_PRINTABLE_RE.test(fold) && ASCII_LETTER_RE.test(fold)) {
      signals.confusable_word = true;
      words.push({
        word: text.slice(runStart, end),
        index: runStart,
        signals: ['confusable_word'],
        scripts: [],
        skeleton: fold,
      });
      replacements.push({ start: runStart, end, value: fold });
    }
  }

  // Findings and replacements may now be interleaved (tokens vs. illegal code
  // points vs. styled runs); sort both into ascending order so evidence reads
  // left-to-right and the single-pass rebuild below stays valid.
  words.sort((a, b) => a.index - b.index);
  replacements.sort((a, b) => a.start - b.start);

  // Rebuild in a single left-to-right pass. Replacements are collected in
  // ascending, non-overlapping order, so we can stitch the output once instead
  // of re-slicing the whole string per replacement (which is quadratic when a
  // message has many affected tokens).
  let normalized: string;
  if (replacements.length === 0) {
    normalized = text;
  } else {
    let out = '';
    let cursor = 0;
    for (const r of replacements) {
      out += text.slice(cursor, r.start) + r.value;
      cursor = r.end;
    }
    normalized = out + text.slice(cursor);
  }

  // Strict mode: hidden findings join the word findings, and every offset
  // computed on the cleaned text is mapped back to the input.
  if (hidden) {
    if (hidden.edits.length) {
      const map = offsetMapper(hidden.edits);
      for (const w of words) {
        const start = map(w.index);
        const end = map(w.index + w.word.length - 1) + 1;
        w.word = input.slice(start, end);
        w.index = start;
      }
    }
    // A stack trimmed in the pass is zalgo, as one left to the token scan.
    if (hidden.content) {
      const zalgoWords = words.filter((w) => w.signals.includes('zalgo'));
      for (const c of hidden.content) {
        if (c.kind !== 'mark-stack' || c.removed) continue;
        c.removed = zalgoWords.some((w) => w.index <= c.index && c.index < w.index + w.word.length);
      }
    }
    for (const f of hidden.findings) {
      const only = Object.keys(f.removed).every((k) => k === 'markStack');
      if (only) signals.zalgo = true;
      else signals.invisible = true;
      words.push({
        word: f.word,
        index: f.index,
        signals: [only ? 'zalgo' : 'invisible'],
        scripts: [],
        normalized: cleanChunk(f.word, f.index, hidden.edits),
      });
    }
    words.sort((a, b) => a.index - b.index);
  }

  return {
    spoofed: SPOOFING_SIGNALS.some((s) => signals[s]),
    signals,
    words,
    counts: {
      wordsTotal,
      wordsAffected: words.length,
      hiddenWords: hidden ? hidden.findings.length : 0,
      confusableWords,
      mixedWords,
    },
    normalized,
    changed: normalized !== input,
    dominantScript,
    ...(hidden && {
      hidden: {
        findings: hidden.findings,
        payloads: hidden.payloads,
        ...(hidden.content && { content: hidden.content }),
        removed: hidden.removed,
      },
    }),
  };
}

const NO_MASK = new Uint8Array(0);

function hiddenRules(overrides: Partial<HiddenCharRules> | undefined): HiddenCharRules {
  // Controls keep their own signals here (control_char, noncharacter), and stacks
  // outside the stacking scripts the zalgo signal; cleanHidden removes both.
  return { ...STRICT_HIDDEN_RULES, controlChars: 'keep', markStacksOther: 'keep', ...overrides };
}

function resolutionOf(r: WordResolution): NonNullable<WordFinding['resolution']> {
  return {
    class: r.class,
    script: r.script,
    rule: r.rule,
    folded: r.folded,
    context: r.context,
    candidates: r.candidates,
    rejected: r.rejected,
    ...(r.evidence && { evidence: r.evidence }),
  };
}

/**
 * Maps an offset in the cleaned text to the input, given the edits that
 * produced it (input ranges replaced by '' or one character, in order).
 */
function offsetMapper(edits: readonly { start: number; end: number; value: string }[]) {
  const cleanEnd: number[] = [];
  const cleanStart: number[] = [];
  let shift = 0; // cleaned − input offset after the previous edit
  for (const e of edits) {
    cleanStart.push(e.start + shift);
    shift += e.value.length - (e.end - e.start);
    cleanEnd.push(e.end + shift);
  }
  return (p: number): number => {
    // Last edit whose replacement ends at or before p.
    let lo = 0;
    let hi = edits.length - 1;
    let k = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cleanEnd[mid]! <= p) {
        k = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    const next = edits[k + 1];
    if (next && cleanStart[k + 1]! <= p && p < cleanEnd[k + 1]!) return next.start;
    return k < 0 ? p : edits[k]!.end + (p - cleanEnd[k]!);
  };
}

/** The cleaned form of an input chunk [index, index + word.length). */
function cleanChunk(
  word: string,
  index: number,
  edits: readonly { start: number; end: number; value: string }[],
): string {
  // First edit ending after the chunk start (edits are sorted, disjoint).
  let lo = 0;
  let hi = edits.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (edits[mid]!.end <= index) lo = mid + 1;
    else hi = mid;
  }
  let out = '';
  let cursor = index;
  const end = index + word.length;
  for (let k = lo; k < edits.length; k++) {
    const e = edits[k]!;
    if (e.start >= end) break;
    out += word.slice(cursor - index, e.start - index) + e.value;
    cursor = e.end;
  }
  return out + word.slice(cursor - index);
}
