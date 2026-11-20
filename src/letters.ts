/**
 * Phase 2, the word phase (docs/confusion-model.md §17.4). It reads phase 1's
 * output only (decision 14): a re-chunker (decision 18) turns phase 1's records
 * into chunks — the text before a word (its leading gap) and the word as phase 1
 * output it, with its source positions; trailing text forms a final wordless
 * chunk (decision 18a). Words wait in a ring for their context
 * (decisions 20–22), are judged, and go out in source order with the word
 * callback. Per-word state lives in typed arrays indexed by ring slot; window
 * metrics are running sums (a word added on arrival, taken off when it leaves).
 */

import type { ConfusionAlphabet, ConfusionModel } from './confusion';
import { skeleton } from './confusables';
import type { LibRecord } from './core';
import { displayOrder, firstStrongRtl, isParaSep, RTL_CHAR_RE } from './bidi';
import { CONFUSION_ALPHABETS, KIND_DONOR, KIND_MASK, KIND_NONE } from './confusion';
import { moderatelyRestrictive } from './foreign';
import { CASE_STROKES, DIGIT_LOOKALIKES, DIGIT_READINGS } from './data/donor-rows';
import { baseIn, neutralIn, neutralInfo, type NeutralInfo, type NeutralRole } from './neutral';
import { HIGHLY_RESTRICTIVE, isSpaceless } from './scriptinfo';
import { PRECOMPOSED_LETTERS, TARGET_LANGUAGES, letterKey, type TargetLanguage } from './languages';
import {
  isHyphen,
  isJsSpace,
  TokenClassifier,
  type PendingWord,
  type ResolutionRule,
  type WholeScriptFold,
  type WordResolution,
} from './resolve';
import { analyzeWordScripts, primaryScript, type ScriptName } from './scripts';
import {
  analyzeToken,
  ASCII_LETTER_RE,
  ASCII_PRINTABLE_RE,
  CP_INVISIBLE,
  CP_LETTER,
  CP_MARK,
  CP_STYLED,
  CP_TOKEN,
  CP_VARIATION,
  cpFlags,
  hasLetter,
  isInvisibleChar,
  isPlainNonLatin,
  LETTER_RE,
  N_SCRIPTS,
  NO_MASK,
  SCRIPT_LIST,
  scriptIndexOf,
  type TokenAnalysis,
  type TokenFlags,
} from './token';
import type { SpoofSignal } from './types';

/** Longest word judged (decision 19): past it the word is `tooBig` and stays as phase 1 output it. */
export const WORD_CAP = 250;

/** Why the word callback was called (decision 14). */
export interface WordReason {
  /** Signals the word carries. */
  readonly signals?: readonly SpoofSignal[];
  /** The confusion model folded it (`replacement` is the fold). */
  readonly converted?: boolean;
  /** The requested language whose letters the output is written in; null when kept or mixed, when no requested language holds the output, and under the Latin-fold model. */
  readonly toLang?: TargetLanguage | null;
  /** The ladder step that decided. */
  readonly rule?: ResolutionRule;
  /** Longer than {@link WORD_CAP}: not judged, `replacement` = `cleaned`. */
  readonly tooBig?: true;
}

/**
 * The word callback (decision 14): source positions of the word, the word as
 * phase 1 output it, the library's output for it, and why.
 */
export type WordCallback = (
  start: number,
  end: number,
  cleaned: string,
  replacement: string,
  reason: WordReason,
) => void;

/** A judged word (or a styled run), as `analyze`'s result lists it. */
export interface LetterFinding {
  kind: 'word' | 'styled';
  start: number;
  end: number;
  /** The word as phase 1 output it. */
  cleaned: string;
  result: TokenAnalysis;
  resolved: WordResolution | null;
  replacement: string;
  /** The script of the converted letters when the word was converted without the ladder (neutral letters, the Latin-fold model); its language is `toLang`. */
  to?: ConfusionAlphabet | 'Latin' | null;
  /** Normalisation only (English `x` between digits as `×`, decision 36e): output, no call, no finding. */
  quiet?: boolean;
}

export interface LetterOptions {
  source: string;
  strict: boolean;
  model: ConfusionModel | null;
  /** The languages the input is written in: their whole words are never converted as a whole (`inputLanguages`). */
  inputLanguages: readonly TargetLanguage[];
  wholeScriptFold: WholeScriptFold;
  /** Ring size in words (decision 20). */
  contextBuffer: number;
  /** Step-2 majority window, ± words (decision 22). */
  majorityWindow: number;
  /** Span of the dominant script and "any word is mixed" (decision 21): the ring, or every word. */
  breadth: 'window' | 'all';
  /** Styled and compatibility letters are a neutral alphabet inside words (decisions 30–33, 30a, 31a). */
  neutral: boolean;
  /** Math switch 1 (decision 30h): math letters are kept as written, words of math letters (and Greek) are not judged. */
  keepMath?: boolean | undefined;
  /** Decision 36c option: affix chunks kept and set off by this string instead of converted. */
  affixSeparator?: string | undefined;
  /** Decision 36c: languages whose one-letter dash edge part is an affix (default none). */
  oneLetterDashAffix?: readonly TargetLanguage[] | undefined;
  /** Decision 36e: the hostile-input setting (a last one-letter twin piece converts too). */
  hostileInput?: boolean | undefined;
  /** Decision 36c/36e: pieces of a word with a right-to-left letter in on-screen order (default true). */
  rtlAwareness?: boolean | undefined;
  /** Math switch 3 (decision 30h.3): the Math target language. */
  mathTarget?: boolean | undefined;
  /** Decision 41m: the word-majority thresholds (defaults in resolve.ts). */
  wordMajorityMinLetters?: number | undefined;
  wordMajorityMinShare?: number | undefined;
  /** The word cap applies (decision 19): not on the default path, which judges every word. */
  wordCap: boolean;
  onWord?: WordCallback | undefined;
  /** Early stop (decision 16): checked before each word is judged. */
  signal?: AbortSignal | undefined;
  /** The library's output, chunk by chunk in source order. */
  out: (text: string) => void;
  /** Decision 41o: the source is the input with its HTML character references decoded. */
  refs?: LetterRefs | undefined;
  /** Every word with a signal, in order (the result's `words`). */
  finding: ((f: LetterFinding) => void) | null;
  /** A judged word (the result's counts). */
  counted: ((hasLetter: boolean, resolved: WordResolution | null) => void) | null;
  /** Test only: false runs every word through the full judge (the fast lane's equivalence test). */
  fastLane?: boolean | undefined;
  /** Test only: each word's ring state once it is judged ({@link TokenState}). */
  onTokenState?: ((t: number, state: TokenState) => void) | undefined;
}

const F_ASCII = 1;
const F_LETTER = 2;
const F_EXACT = 4;
const F_TOOBIG = 8;
const F_MIXED = 16;
/** Decision 24: the paragraph marker — a blank line before this word (the ladder's context stops there). */
const F_PARA = 32;
const F_HYPH = 64;
/** The fast lane's plain word ({@link LetterPhase.closeToken}): judged as it closed, no finding. */
const F_PLAIN = 128;
/** Per-word class flags (`fx`): neutral letters or tail marks; foreign letters; a foreign mix not allowed. */
const X_NEUTRAL = 1;
const X_FOREIGN = 2;
const X_BAD = 4;
/** A letter outside the model and the dictionary, of script Common or Inherited: kept (review 7 D). */
const X_KEPT = 8;
/** A kelvin, ångström or ohm sign (strict language model): judged by the token judge too. */
const X_SIGN = 16;
/** A character that looks like an ASCII digit (decision 41). */
const X_DIGIT = 32;

/**
 * Characters that look like an ASCII digit (decision 41; the curated rows):
 * a class of their own, always converted to the digit, alone too, and a spoof.
 */
const DIGIT_OF: ReadonlyMap<number, string> = new Map(DIGIT_LOOKALIKES);
/** Decision 41l: digit donors' digit readings (the zeros), taken inside a number. */
const READING_OF: ReadonlyMap<number, string> = new Map(DIGIT_READINGS);
const digitOf = (cp: number) => DIGIT_OF.get(cp) ?? READING_OF.get(cp)!;
const READING_BMP = new Uint8Array(0x10000);
for (const [cp] of DIGIT_READINGS) if (cp < 0x10000) READING_BMP[cp] = 1;
const hasReading = (cp: number) => (cp < 0x10000 ? READING_BMP[cp] === 1 : READING_OF.has(cp));
const CASE_STROKE: ReadonlySet<string> = new Set(CASE_STROKES.map((c) => String.fromCodePoint(c)));
const CASE_STROKE_CPS: ReadonlySet<number> = new Set(CASE_STROKES);
const hasCaseStroke = (t: string) => {
  for (const c of t) if (CASE_STROKE.has(c)) return true;
  return false;
};
/**
 * Decision 37: a caseless cap-height stroke ({@link CASE_STROKES}) that
 * reads English `I` or `l` reads by its neighbours in the output: `I` with an uppercase letter
 * on both sides, or on one side and the word's edge (or a non-letter) on the other, or alone
 * (the edge on both sides: `ꓲ am`); at the word's start before a lowercase letter, `I` when
 * the word has one or two more letters (`ꓲf` → `If`), `l` otherwise (`ꓲike` → `like`; a word start
 * is the text's start or a separator, not an inner apostrophe, dash or digit: `we'ꓲl` → `we'll`);
 * `l` in every other case (`pꓲxel` → `plxel`, `Aꓲb` → `Alb`). `cleaned` and `out` align by
 * character.
 */
/** Inside a word: an apostrophe, a dash or a digit (no word start after them, 37). */
const INNER_JOIN_RE = /^[\p{Nd}\p{Pd}'\u2019\u02bc]$/u;
function strokeCase(cleaned: string, out: string): string {
  // A fold writes NFC: the word is read composed (NFC and NFD input alike).
  const a = [...cleaned.normalize('NFC')];
  const b = [...out];
  if (a.length !== b.length) return out;
  const letter = (c: string | undefined) => c !== undefined && /\p{L}/u.test(c);
  const upper = (c: string | undefined) => c !== undefined && /\p{Lu}/u.test(c);
  for (let i = 0; i < a.length; i++) {
    if (!CASE_STROKE.has(a[i]!) || (b[i] !== 'I' && b[i] !== 'l')) continue;
    const p = b[i - 1];
    const n = b[i + 1];
    let I: boolean;
    if (upper(p)) I = upper(n) || !letter(n);
    else if (letter(p)) I = false;
    else if (!letter(n) || upper(n)) I = true;
    else if (p !== undefined && INNER_JOIN_RE.test(p)) {
      // After an inner apostrophe, dash or digit it is no word start (`we'ꓲl`, `well-ꓲit`, `5ꓲb`).
      I = false;
    } else {
      // The word's start, then lowercase (English reading): `If`, `It` but `like`.
      let k = i + 1;
      while (k < b.length && letter(b[k])) k++;
      I = k - i - 1 <= 2;
    }
    b[i] = I ? 'I' : 'l';
  }
  return b.join('');
}

/** The characters of `a` that `b` (as long) has differently. */
function diffChars(a: string, b: string): string {
  const x = [...a];
  const y = [...b];
  return x.filter((c, i) => c !== y[i]).join('');
}

/** The last code point of `t` ('' when empty). */
function lastCharOf(t: string): string {
  if (t === '') return '';
  const u = t.charCodeAt(t.length - 1);
  return u >= 0xdc00 && u <= 0xdfff && t.length > 1 ? t.slice(-2) : t[t.length - 1]!;
}

/** Decision 36e: a dash (Unicode Dash: `-`, `–`, `−`) or a connector (`_`, `＿`) next to the numbers blocks `×`. */
const DASH_OR_LOW_LINE_RE = /^[\p{Dash}\p{Pc}]$/u;

/**
 * A decimal digit's value (its place in its run of ten; `٣` → 3, `𝟘` → 0) or a digit
 * look-alike's digit (41); -1 for any other character.
 */
function digitValue(c: string): number {
  const cp = c.codePointAt(0)!;
  if (cp >= 0x30 && cp <= 0x39) return cp - 0x30;
  if (cp < 0x10000 && DIGIT_VALUE_BMP[cp] !== -2) return DIGIT_VALUE_BMP[cp]!;
  let v = -1;
  if (DIGIT_RE.test(c)) {
    let z = cp;
    while (DIGIT_RE.test(String.fromCodePoint(z - 1))) z--;
    v = (cp - z) % 10;
  } else if (isDigitLookalike(cp)) v = Number(DIGIT_OF.get(cp));
  if (cp < 0x10000) DIGIT_VALUE_BMP[cp] = v;
  return v;
}
/** `t[a, b)` holds a digit-like character ({@link digitValue}); a scan of code units. */
function hasDigit(t: string, a: number, b: number): boolean {
  for (let i = a; i < b; i++) {
    const u = t.charCodeAt(i);
    if (u < 0x80 ? u >= 0x30 && u <= 0x39 : u >= 0xd800 || digitValue(t[i]!) >= 0) return true;
  }
  return false;
}

/** {@link digitValue} for the BMP, filled on use (-2: not yet). */
const DIGIT_VALUE_BMP = new Int8Array(0x10000).fill(-2);

/**
 * A word's scripts from its letters. An invisible letter (a Hangul filler, U+3164, U+115F)
 * belongs to no script here: it is a hidden character the word carries, not a letter of it.
 */
function wordScripts(text: string): ReturnType<typeof analyzeWordScripts> {
  return analyzeWordScripts([...text].filter((c) => LETTER_RE.test(c) && !isInvisibleChar(c)));
}

/** {@link LetterPhase.dashJoin}: the dash is gap text, joins the token, or waits for the next record. */
const DASH_GAP = 0;
const DASH_JOINS = 1;
const DASH_WAITS = 2;
/** {@link LetterPhase.holdWhileWaiting}: the open token waits for nothing, a dash's join, its closing. */
const WAIT_NONE = 0;
const WAIT_DASH = 1;
const WAIT_CLOSE = 2;
/** A C0 or C1 control (an escape sequence's ESC too) at source position p. */
function isControlAt(src: string, p: number): boolean {
  const u = src.charCodeAt(p);
  return u < 0x20 || (u >= 0x7f && u <= 0x9f);
}
/** Any number character (36e: digits are ignored between pieces). */
const ANY_NUMBER_RE = /\p{N}/u;
/** A character of a number (41l): a decimal digit, a digit look-alike, a digit donor. */
const NUMBER_CHAR_RE = /\p{Nd}/u;
/** {@link DIGIT_OF}'s BMP members as a table, and whether any is astral: the scan's test. */
const DIGIT_BMP = new Uint8Array(0x10000);
for (const [cp] of DIGIT_LOOKALIKES) if (cp < 0x10000) DIGIT_BMP[cp] = 1;
const isDigitLookalike = (cp: number) => (cp < 0x10000 ? DIGIT_BMP[cp] === 1 : DIGIT_OF.has(cp));
/**
 * A code point's side for phase 3's cut (decisions 39, 42b):
 * 2 a script written without spaces, 1 another script, 0 Common / Inherited / Unknown.
 */
const SPLIT_SIDE = new Int8Array(SCRIPT_LIST.length).map((_, k) => {
  const n = SCRIPT_LIST[k]!;
  return n === 'Common' || n === 'Inherited' || n === 'Unknown' ? 0 : isSpaceless(n) ? 2 : 1;
});
const sideOf = (cp: number): number => {
  if (cp < 0x80) return (cp | 0x20) >= 0x61 && (cp | 0x20) <= 0x7a ? 1 : 0;
  const k = scriptIndexOf(cp);
  return k >= 0 ? SPLIT_SIDE[k]! : 0;
};
/**
 * Clusters a phase-3 cut never splits, without Intl.Segmenter: a base with
 * the marks, joiners, variation selectors, emoji modifiers and tags after it;
 * a character after a ZWJ; regional indicators in pairs.
 */
function* clusters(w: string): Generator<{ index: number; segment: string }> {
  let start = 0;
  let prevZwj = false;
  let ri = 0;
  for (let q = 0; q < w.length;) {
    const cp = w.codePointAt(q)!;
    const n = cp > 0xffff ? 2 : 1;
    const isRI = cp >= 0x1f1e6 && cp <= 0x1f1ff;
    const ext =
      q > 0 &&
      (prevZwj ||
        cp === 0x200d ||
        (cpFlags(cp) & CP_MARK) !== 0 ||
        (cp >= 0xfe00 && cp <= 0xfe0f) ||
        (cp >= 0xe0100 && cp <= 0xe01ef) ||
        (cp >= 0x1f3fb && cp <= 0x1f3ff) ||
        (cp >= 0xe0020 && cp <= 0xe007f) ||
        (isRI && ri % 2 === 1));
    if (!ext && q > 0) {
      yield { index: start, segment: w.slice(start, q) };
      start = q;
    }
    ri = isRI ? ri + 1 : 0;
    prevZwj = cp === 0x200d;
    q += n;
  }
  if (w.length) yield { index: start, segment: w.slice(start) };
}
/** What the judge reads of a word: a whole token's slot, or a phase-3 piece of one (decision 42b). */
interface WordView {
  fl: number;
  x: number;
  pend: PendingWord | null;
  /** The judged text (the core) and the word as phase 1 output it; null: the source range [a, b) ({@link LetterPhase.vTx}). */
  tx: string | null;
  full: string | null;
  a: number;
  b: number;
  pn: Plan | null;
  inM: number;
  /** A piece: the nearest voting sibling piece's script on each side; -2 none (the token's neighbours decide), -1 on the right: a sibling needing conversion ends the search. */
  sibL: number;
  sibR: number;
  /** A piece: its sibling pieces' scripts and letter counts [alphabet, n, …] for nearest-word selection; the window sums their languages (42b). */
  win: number[] | null;
  piece: boolean;
  /** Out: the script of the converted form when the judge folded the word (nearest-word selection only; its language is `finL`), -1 otherwise. */
  fin: number;
  /** Out: the language (bit mask) the judge folded the word into, 0 otherwise. */
  finL: number;
}

/** Grammar endings with the adjective stems `н` / `шн` before them (36c: `-(ш)н-` + ending). */
const adjectives = (endings: string) => endings.split(' ').flatMap((e) => ['н' + e, 'шн' + e]);
/**
 * Decision 36c: the suffix lists, built from grammar:
 * endings on foreign stems that mark gender, case or number only. Used by the
 * affix rules, for requested languages only (40d).
 */
const CHUNK_SUFFIXES: Partial<Record<TargetLanguage, ReadonlySet<string>>> = {
  English: new Set('s es ed ing er est'.split(' ')),
  Russian: new Set([
    ...'а я у ю е и ы ом ем ой ей ов ев ам ям ами ями ах ях'.split(' '),
    ...adjectives('ый ий ой ая яя ое ее ые ие ого его ому ему ым им ую юю ых их ыми ими'),
  ]),
  Ukrainian: new Set([
    ...'а я у ю і ї е и о ом ем ів їв ам ям ами ями ах ях ові еві ою ею єю єм єві'.split(' '),
    ...adjectives('ий ій а я е є і ї ого ього ому ьому им ім ою ьою ої ьої у ю их іх ими іми'),
  ]),
  Greek: new Set(
    'ος ός ου ού ο ό ε έ οι οί ων ών ους ούς α ά ας άς ες ές η ή ης ής ι ί ια ιά ιού ιών μα ματα ματος μάτων'.split(
      ' ',
    ),
  ),
};
/** A chunk of a word (decision 36c): letters of one script, code-point indices [i0, i1), and the non-letters before it. */
interface Chunk {
  sc: string;
  i0: number;
  i1: number;
  sep: string;
}
/** A letter as the alphabets list it, lowercase ({@link letterKey}: `ё` itself, `é` → `e`). */
const BASE_LOWER = new Map<string, string>();
/** {@link letterKey}, memoised: language checks call it per letter. */
/** `cs[i]` with the combining marks after it (a letter as written, `е` + U+0308 = `ё`). */
const withMarks = (cs: readonly string[], i: number): string => {
  let s = cs[i]!;
  for (let j = i + 1; j < cs.length && cpFlags(cs[j]!.codePointAt(0)!) & CP_MARK; j++) s += cs[j]!;
  return s;
};
/**
 * The word with each base + mark that composes to a letter an alphabet lists written composed
 * (`е` + U+0308 → `ё`), for language membership only (NFC and NFD input read alike).
 */
const composeListed = (w: string): string =>
  /\p{M}/u.test(w)
    ? w.replace(/(\p{L})(\p{M})/gu, (m, b: string, k: string) => {
        const c = (b + k).normalize('NFC');
        return [...c].length === 1 && PRECOMPOSED_LETTERS.has(c.toLowerCase()) ? c : m;
      })
    : w;
/** The characters of cs[i0, i1), each with its marks (marks no character of their own). */
const clusterLetters = (cs: readonly string[], i0: number, i1: number): string[] => {
  const out: string[] = [];
  for (let i = i0; i < i1; i++) {
    if (cpFlags(cs[i]!.codePointAt(0)!) & CP_MARK) {
      if (out.length) out[out.length - 1] += cs[i]!;
      continue;
    }
    out.push(cs[i]!);
  }
  return out;
};
const baseLower = (c: string): string => {
  let b = BASE_LOWER.get(c);
  if (b === undefined) {
    b = letterKey(c);
    if (BASE_LOWER.size < 65536) BASE_LOWER.set(c, b);
  }
  return b;
};

/**
 * Decision 36a: scripts that may share a word: at most one written with
 * spaces among scripts written without (39), or a UTS #39 Highly Restrictive
 * set (`Smith는`: Latin + Hangul).
 */
function legitimateMix(scripts: readonly string[]): boolean {
  let spaced = 0;
  for (const sc of scripts) if (!isSpaceless(sc)) spaced++;
  if (spaced <= 1) return true;
  return HIGHLY_RESTRICTIVE.some((h) => scripts.every((sc) => h.has(sc)));
}

/** Decision 42: a token's mojibake spans, [a, b, …] in its cleaned text, and the text each encodes. */
interface Moj {
  off: number[];
  dec: string[];
}

/** `w` with the ranges [a, b, …] left out. */
function withoutSpans(w: string, off: readonly number[]): string {
  let out = '';
  let p = 0;
  for (let k = 0; k < off.length; k += 2) {
    out += w.slice(p, off[k]);
    p = off[k + 1]!;
  }
  return out + w.slice(p);
}

/**
 * A piece's output with its encoded mojibake text (at `keep` in `text`, found
 * again in order in `out`) written back as the spans `spans`; and the output
 * without it. Null when the output lost some of it.
 */
function restore(
  text: string,
  out: string,
  keep: readonly number[],
  spans: readonly string[],
): { text: string; rest: string } | null {
  let res = '';
  let rest = '';
  let cur = 0;
  for (let k = 0; k < keep.length; k += 2) {
    const dec = text.slice(keep[k], keep[k + 1]);
    const at = out.indexOf(dec, cur);
    if (at < 0) return null;
    res += out.slice(cur, at) + spans[k >> 1]!;
    rest += out.slice(cur, at);
    cur = at + dec.length;
  }
  return { text: res + out.slice(cur), rest: rest + out.slice(cur) };
}

/** The word with its converted neutral characters as their plain letters, nothing else changed (36c). */
function plainOf(plan: Plan | null, cleaned: string): string {
  if (!plan) return cleaned;
  let out = '';
  for (let i = 0; i < plan.chars.length; i++)
    out +=
      plan.cls[i] === C_DROP
        ? ''
        : plan.cls[i] === C_CONV && plan.bases[i] !== null
          ? plan.bases[i]
          : plan.cls[i] === C_FOLLOW && plan.infos[i]
            ? plan.infos[i]!.base
            : plan.chars[i];
  return out;
}

/** Decision 40f under the Latin-fold model: the long s reads `s`. */
const LONG_S_LATIN: NeutralInfo = Object.freeze({
  category: 'disguise',
  base: 's',
  baseScript: 'Latin',
  standalone: true,
});

/** A phase-3 piece of a token (decision 42b): [a, b) in the token's text. */
interface Piece {
  a: number;
  b: number;
  /** Decision 36c: a dash-separated affix part, kept (not judged). */
  keep?: boolean;
}

/** Decision 42/36c: a dash token's parts (UTF-16 offsets), computed once per token text. */
interface DashPart {
  a: number;
  b: number;
  /** A real affix of the token (36c): no vote in the window. */
  affix: boolean;
  /** A real suffix (36c): kept as written, like one after an apostrophe. */
  suffix: boolean;
  /** The requested languages holding all its letters (empty: none, or not letters only). */
  langs: TargetLanguage[];
  /** Clean and nothing to judge: no other requested language can take it, no case anomaly. */
  safe: boolean;
}

interface DashLayout {
  parts: DashPart[];
  /** Its pieces for phase 3 (groups of one language, the dashes between); null: judged whole. */
  pieces: Piece[] | null;
  /** Nothing to judge: every group is a kept suffix or a safe clean part. */
  quiet: boolean;
  /** Its parts as words of the context window: [script, letters]…; null: the token's own. */
  win: number[] | null;
}

/**
 * Phase 3's pieces of a token (decision 42b): split at each spaced/spaceless
 * script border (39), never inside a grapheme
 * cluster (base + marks, emoji sequences) or a range of `keep` ([a, b, …]: the
 * text mojibake spans encode, sided by its first letter). Characters of
 * neither side between the two letters go with the spaced side.
 */
function piecesOf(w: string, keep: readonly number[] | null): Piece[] {
  const ua: number[] = [];
  const ub: number[] = [];
  const us: number[] = [];
  let mi = 0;
  let open = -1; // the unit of the keep range being read
  for (const g of clusters(w)) {
    const a = g.index;
    const b = a + g.segment.length;
    while (keep && mi < keep.length && keep[mi + 1]! <= a) {
      mi += 2;
      open = -1;
    }
    const side = sideOf(g.segment.codePointAt(0)!);
    if (keep && mi < keep.length && keep[mi]! < b) {
      // In (or overlapping) a keep range: one unit.
      if (open >= 0) {
        ub[open] = b;
        if (us[open] === 0) us[open] = side;
        continue;
      }
      open = ua.length;
    }
    ua.push(a);
    ub.push(b);
    us.push(side);
  }
  const out: Piece[] = [];
  let start = 0;
  let ll = 0; // the open piece's last lettered side
  let lastLetterEnd = -1; // the last lettered unit of the open piece
  for (let u = 0; u < us.length; u++) {
    const sd = us[u]!;
    if (sd === 0) continue;
    if (ll !== 0 && ll !== sd) {
      // spaced → spaceless: cut before this unit; spaceless → spaced: after the last spaceless unit.
      const cut = sd === 2 ? ua[u]! : ub[lastLetterEnd]!;
      if (cut > start) {
        out.push({ a: start, b: cut });
        start = cut;
      }
    }
    ll = sd;
    lastLetterEnd = u;
  }
  if (start < w.length) out.push({ a: start, b: w.length });
  return out;
}

/**
 * 30b category 8's unit list: what may follow a unit prefix at a unit's start
 * (SI and common units, digits or a power after them: `µm²`, `µs⁻¹`); nothing
 * (a lone prefix).
 */
const UNIT_AFTER_PREFIX_RE =
  /^(?:(?:sec|m|s|g|l|\u2113|L|A|V|W|F|H|K|J|N|Pa|Hz|mol|M|\u03a9|\u2126|Sv|Gy|cd|lm|lx|Wb|T|C|bar|in|S|Bq|eV|rad|sr|Ci|Torr|atm|cal|Da|kat|b|ohm)[0-9\u00b2\u00b3\u00b9\u2070\u2074-\u207b]*)?$/u;

/**
 * Separators inside a visibility token (decisions 42, 36c): a dash or an apostrophe between
 * letters joins the token, and its parts are words of their own.
 */
const JOIN_DASHES = '-\u2010\u2011';
const JOIN_APOSTROPHES = "'’ʼ";
const PART_SEP_RE = new RegExp(`[${JOIN_DASHES}${JOIN_APOSTROPHES}]`);
/** An apostrophe between letters. */
const APOS_JOIN_RE = new RegExp(`\\p{L}\\p{M}*[${JOIN_APOSTROPHES}]\\p{L}`, 'u');
/** `t` holds an apostrophe of {@link JOIN_APOSTROPHES} (a code-unit scan, per token). */
function hasApostrophe(t: string): boolean {
  for (let i = 0; i < t.length; i++) {
    const u = t.charCodeAt(i);
    if (u === 0x27 || u === 0x2019 || u === 0x2bc) return true;
  }
  return false;
}

/** 30b.8: Greek `μ` at a unit's start (after its digits), and what follows it. */
const GREEK_MU_UNIT_RE = /^[0-9]*\u03bc(.*)$/su;

/** 30b.8: `text` is Greek `μ` (after digits) directly before a unit of the unit list. */
function muUnit(text: string): boolean {
  const m = GREEK_MU_UNIT_RE.exec(text);
  return m !== null && m[1] !== '' && UNIT_AFTER_PREFIX_RE.test(m[1]!);
}

/** Position classes of a word's plan ({@link LetterPhase.split}). */
const C_CORE = 0;
const C_CONV = 1;
const C_FOLLOW = 2;
const C_KEEP = 3;
const C_FOREIGN = 4;
/** Dropped with the conversion before it (an emoji presentation selector on a converted neutral). */
const C_DROP = 5;

/** A word's characters by class, decided once when it closes (review 7 B). */
interface Plan {
  chars: string[];
  cls: Uint8Array;
  infos: (NeutralInfo | null)[];
  /** Base written into the core for converted positions. */
  bases: (string | null)[];
  /** The text the judge reads. */
  core: string;
  x: number;
  /** A conversion is a spoof (decision 30b). */
  spoof: boolean;
  /** Multi-target digit look-alikes kept in the core (decision 41f), positions. */
  alt: number[] | null;
  /** A word of neutrals only holding a language-set neutral (decision 41k): kept when its nearest words are of the set. */
  lset: boolean;
  /** A leftover neutral (decision 41j): reported even when the word stays as written. */
  leftover: boolean;
}

/** How a neutral character takes part in its word (decision 30b). */
function roleOf(e: NeutralInfo): NeutralRole {
  switch (e.category) {
    case 'disguise':
    case 'sameReading':
    case 'wordSign':
    case 'japaneseSquare':
    case 'unitPrefix':
      return 'convert';
    case 'visibleStyle':
    case 'unit':
      return 'follow';
    default:
      return 'keep';
  }
}

/**
 * The kelvin, ångström and ohm signs: canonical duplicates of `K`, `Å`, `Ω`.
 * The model reads them as those letters; the word is also judged by the token
 * judge, which flags them (`p⟨K⟩ypal`).
 */
const CANONICAL_SIGNS: ReadonlySet<number> = new Set([0x2126, 0x212a, 0x212b]);

const DIGIT_RE = /^\p{Nd}/u;
let FLAG_RE: RegExp | undefined;
/** 30b category 5: `© ® ™ №` read as letters when a letter follows. */
const BOUNDARY_LETTERS: ReadonlyMap<number, string> = new Map([
  [0x00a9, 'c'],
  [0x00ae, 'R'],
  [0x2122, 'TM'],
  [0x2120, 'SM'],
  [0x2116, 'No'],
]);
const MIXED_CATEGORIES: ReadonlySet<string> = new Set([
  'mixed_spoof',
  'mixed_legitimate',
  'mixed_non_legitimate',
]);
/** Decision 41k: the CJK language set and its blocks (CJK Compatibility, Enclosed CJK Letters and Months). */
const LANG_SET: ReadonlySet<string> = new Set(['Han', 'Hiragana', 'Katakana', 'Hangul']);
const inLangBlock = (ch: string) => {
  const cp = ch.codePointAt(0)!;
  return cp >= 0x3200 && cp <= 0x33ff;
};
/**
 * 30b category 6: the run right before a unit at a word's end: a number
 * (digits with `.` `,` `'` and thin spaces) and an SI prefix, either optional,
 * after the word's start, a non-letter or a letter of a script written without
 * spaces (review 10: `23日最高零下6℃`).
 */
const UNIT_BEFORE_RE =
  /(?:^|[^\p{L}\p{N}]|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}\p{Script=Tibetan}])(?:\p{Nd}[\p{Nd}.,'\u2009\u202f]*)?(?:da|[yzafpnµumcdhkMGTPEZY])?$/u;
const TARGET_ALPHABETS: readonly ConfusionAlphabet[] = ['Latin', 'Cyrillic', 'Greek'];
/** Turkish letters no other target language written in Latin letters has (decision 41g). */
const TURKISH_RE = /[ğĞşŞİ]/;
/** Alphabet id of a script index (the model's alphabets), -1 for any other. */
const ALPHABET_OF_SCRIPT = new Map(
  ['Latin', 'Cyrillic', 'Greek', 'Armenian', 'Cherokee', 'Coptic'].map(
    (n, a) => [SCRIPT_LIST.indexOf(n as ScriptName), a] as const,
  ),
);
/** The window's majority language bit: strictly most letters, -1 on none or a tie. */
function langMajority(sums: readonly number[]): number {
  let best = -1;
  let tie = false;
  for (let b = 0; b < sums.length; b++) {
    if (!sums[b]) continue;
    if (best < 0 || sums[b]! > sums[best]!) [best, tie] = [b, false];
    else if (sums[b] === sums[best]) tie = true;
  }
  return tie ? -1 : best;
}
const alphabetOfScript = (k: number) => (k < 0 ? -1 : (ALPHABET_OF_SCRIPT.get(k) ?? -1));
const ARABIC_SCX_RE = /^\p{Script_Extensions=Arabic}/u;
const ARABIC_IDX = SCRIPT_LIST.indexOf('Arabic');
/**
 * A character's script for decision 41b: its script, and Arabic for the
 * Arabic-Indic digits and signs (script Common, used by Arabic, U+0660–0669).
 */
function ownScriptOf(cp: number): number {
  const k = scriptIndexOf(cp);
  if (SCRIPT_LIST[k] === 'Common' && cp > 0x7f && ARABIC_SCX_RE.test(String.fromCodePoint(cp)))
    return ARABIC_IDX;
  return k;
}
/** A word sign's neighbour that is no spoof (category 7): none, a separator, a digit, a letter of a script written without spaces. */
function signNeighbourOk(ch: string | undefined): boolean {
  if (ch === undefined || ch === "'" || ch === '\u2019' || DIGIT_RE.test(ch)) return true;
  if (!LETTER_RE.test(ch)) return !(cpFlags(ch.codePointAt(0)!) & CP_TOKEN);
  return isSpaceless(primaryScript(ch));
}

/** Decision 41o: the references of a decoded source, and the output written over the input. */
export interface LetterRefs {
  /** Their decoded spans, flat `[start, end, …]`. */
  spans: readonly number[];
  /** Source [a, b) output as written. */
  range(a: number, b: number): void;
  /** `text` output for source [a, b) (a word, a gap). */
  word(text: string, a: number, b: number): void;
}

/** A word's judgement: its finding, and its count for the result (letters? resolution). */
interface Judged {
  f: LetterFinding | null;
  count: [boolean, WordResolution | null] | null;
}

/**
 * Test only: a word's ring state once it is judged ({@link LetterOptions.onTokenState}), as the
 * words around it read it: flags, class, counts, vote, its converted-form script and finding,
 * and its own context (window sums, nearest words).
 */
export interface TokenState {
  /** Judged by the fast lane (the only field the lane changes). */
  fastLane: boolean;
  start: number;
  end: number;
  flags: number;
  classFlags: number;
  pending: boolean;
  cleanScript: number;
  cleanLetters: number;
  inModel: number;
  paragraph: number;
  dash: number;
  plain: number;
  slowVote: number;
  counts: number[];
  cachedVote: number;
  vote: { vote: number; converts: boolean };
  folded: number;
  finding: LetterFinding | null;
  windowSums: number[];
  nearest: { left: number; right: number };
}

/** What {@link LetterPhase.reassemble} keeps or replaces by position (decisions 41b, 41f). */
interface Rebuild {
  stay: Uint8Array | null;
  alt: Map<number, string> | null;
}

/** A leading gap: one untouched source range [r0, r1) (r0 -1: empty), or its text when phase 1 changed it. */
interface Gap {
  r0: number;
  r1: number;
  txt: string | null;
  /** With references: the gap's pieces, source ranges `a, b` and phase-1 text, in order. */
  pcs: (number | string)[] | null;
}

/** A styled run's chunk (the findings between words): its leading gap and the run. */
interface StyledChunk {
  gap: Gap;
  f: LetterFinding;
}

/** The token judge's judgement (`analyzeToken`). */
const TOKEN_FLAGS: TokenFlags = {
  detectInvisible: true,
  suppressModel: false,
  stacksByBase: false,
};
/** Strict, Latin-fold model: the hidden-character pass removed invisibles and trimmed stacks (decision 28b). */
const TOKEN_FLAGS_STRICT: TokenFlags = {
  detectInvisible: false,
  suppressModel: false,
  stacksByBase: true,
  zalgo: false,
};
/** Lenient language model: the resolver decides letters; the token judge the rest. */
const MODEL_FLAGS_LENIENT: TokenFlags = {
  detectInvisible: true,
  suppressModel: true,
  stacksByBase: false,
};

/**
 * The word phase. Feed it phase 1's records (`record`), then `finish()`.
 */
export class LetterPhase {
  private readonly src: string;
  private readonly o: LetterOptions;
  // Ring.
  private cap: number;
  private readonly mask: number;
  private readonly bounded: boolean;
  private readonly ahead: number;
  private readonly W: number;
  private st: Int32Array;
  private en: Int32Array;
  private fl: Uint8Array;
  private cS: Int8Array;
  private cN: Uint16Array;
  private inM: Uint8Array;
  private para: Int32Array;
  /** Decision 41b: the script a judged word was folded into (its converted form), -1 otherwise. */
  private fin: Int16Array;
  /** Per-language rule: the language bits a word votes for — clean (`cL`), converted (`finL`), any (`wL`, lazily; -1 unknown). */
  private cL: Uint16Array;
  private finL: Uint16Array;
  private wL: Int32Array;
  /** {@link langVote} over every known language (decision 41b), lazily; -1 unknown. */
  private wLA: Int32Array;
  /** A word's 41b vote, computed once: (vote + 2) * 2 + converts; 0 = not yet. */
  private vot: Int16Array;
  /** The word's vote needs its text (donors, digits, neutral characters, or no letter counts). */
  private slowVote: Uint8Array;
  /** Per slot: 1 = a token joined by a dash between letters (decision 42). */
  private dsh: Uint8Array;
  private tDonor = false;
  /** Text the judge reads (null: the source slice); the word's output text when it differs (neutral, too big). */
  private tx: (string | null)[];
  private full: (string | null)[];
  /** Each word's leading gap (decision 18a): a source range, or its text. */
  private g0: Int32Array;
  private g1: Int32Array;
  private gT: (string | null)[];
  /** 1: the chunk is untouched source, [gap start or word start, word end) (output by range). */
  private pl: Uint8Array;
  /** Class flags of the word's letters (X_*). */
  private fx: Uint8Array;
  private pend: (PendingWord | null)[];
  /** The word's plan when it has neutral, kept or foreign characters. */
  private pn: (Plan | null)[];
  // Per-slot script counts (window breadth): two inline pairs, the rest in a map.
  private sA: Int16Array;
  private nA: Int32Array;
  private sB: Int16Array;
  private nB: Int32Array;
  private more = new Map<number, Map<number, number>>();
  private found: (LetterFinding | null)[];
  /** Tokens arrived, judged. */
  private nTok = 0;
  private judged = 0;
  private stopped = false;
  // Whole text.
  private readonly counts: Int32Array;
  private readonly order: number[] = [];
  private anyMixed = false;
  // Paragraph and left neighbour state (decision 24).
  private paraId = 0;
  /** Decision 42: phase 1's mojibake spans [s, e, …] (source), what each encodes, the scan's span index. */
  private mS: number[] = [];
  private mDec: string[] = [];
  private mI = 0;
  /** Phase 3 (decision 42b) runs: strict, language model. */
  private readonly p3: boolean;
  /** The open token's mojibake spans in its cleaned text [a, b, …] and what they encode; per slot once it closed. */
  private tMoj: number[] | null = null;
  private tMojDec: string[] | null = null;
  private readonly mjm = new Map<number, Moj>();
  /** The open token holds a dash between letters (decision 42); per slot once it closed. */
  private tDashed = false;
  /** The open token holds Greek `μ` (30b.8). */
  private tMu = false;
  /** The open token may hold a digit or an apostrophe (closeToken's `×` and apostrophe checks run). */
  private tDigitOrApos = false;
  /** Decision 42 (36c): a dash token's parts as words of the context window, [script, letters]… per slot. */
  private readonly dashWin = new Map<number, number[]>();
  // Token being read: its text is tBuf + source[tSeg, tEnd) (tSeg -1: none open).
  private tOpen = false;
  private tStart = 0;
  private tEnd = 0;
  private tAscii = true;
  private tLetter = false;
  private tSplit = false;
  private tBuf = '';
  private tSeg = -1;
  private tCps = 0;
  private tSkip = false;
  /** Skip mode: the kept source ranges of the word, flat [s, e, …] (decision 19: positions, not text). */
  private tKept: number[] = [];
  private tNeutral = false;
  /** The word has a neutral letter or a letter outside the model (split at close). */
  private tNeed = false;
  /** Words are split by letter class (the neutral alphabet or the language model is on). */
  private readonly classed: boolean;
  private tS1 = -1;
  private tMulti = false;
  private tCountsA = -1;
  private tCountsNA = 0;
  private tCountsB = -1;
  private tCountsNB = 0;
  private tMore: Map<number, number> | null = null;
  // Gap since the last chunk: the pieces so far (gR0/gR1 or gTxt), and an open source run from aSeg.
  private gR0 = -1;
  private gR1 = -1;
  private gTxt: string | null = null;
  private gPcs: (number | string)[] | null = null;
  /** With references: each word's leading gap pieces (by token index). */
  private readonly gapPcs = new Map<number, (number | string)[]>();
  private aSeg = -1;
  private gNl = false;
  /** The gap's last character was a CR (an LF right after it is the same line break). */
  private gCR = false;
  private gBlank = false;
  private gLen = 0;
  private gFirst = 0;
  // A styled run in the gap (the findings between words; without the neutral alphabet).
  private yStart = -1;
  private yEnd = 0;
  private yText = '';
  private yCount = 0;
  private yGap: Gap | null = null;
  /** Styled chunks waiting for the next word; and those before word t. */
  private styledNow: StyledChunk[] = [];
  private readonly styledBefore = new Map<number, StyledChunk[]>();
  // Output: words go out from outT; a pending untouched source range [oS, oE).
  private outT = 0;
  private oS = -1;
  private oE = -1;
  private readonly cls: TokenClassifier | null;
  private readonly sums = new Array<number>(16);
  private wholeDom: ScriptName | null | undefined = undefined;

  /** {@link WORD_CAP}, or no cap on the default path. */
  private readonly cap250: number;

  constructor(o: LetterOptions) {
    this.o = o;
    this.cap250 = o.wordCap ? WORD_CAP : Infinity;
    this.tOrder = o.model
      ? [...new Set(o.model.targetLanguages.map((n) => TARGET_LANGUAGES[n].script))]
      : ['Latin', 'Cyrillic', 'Greek'];
    this.tMask = o.model ? o.model.targetMask : 0xff;
    this.p3 = o.model !== null && o.strict;
    this.classed = o.neutral || o.model !== null;
    this.src = o.source;
    this.W = o.majorityWindow;
    this.bounded = o.breadth === 'window';
    // Every word: start near the word count a text of this length has.
    this.cap = this.bounded
      ? o.contextBuffer
      : Math.max(1024, Math.min(1 << 20, o.source.length >> 2));
    this.ahead = this.bounded ? o.contextBuffer - 1 - this.W : Infinity;
    const c = this.bounded ? 1 << (32 - Math.clz32(this.cap - 1)) : this.cap;
    this.mask = c - 1;
    this.st = new Int32Array(c);
    this.en = new Int32Array(c);
    this.fl = new Uint8Array(c);
    this.cS = new Int8Array(c);
    this.cN = new Uint16Array(c);
    this.inM = new Uint8Array(c);
    this.para = new Int32Array(c);
    this.fin = new Int16Array(c);
    this.cL = new Uint16Array(c);
    this.finL = new Uint16Array(c);
    this.wL = new Int32Array(c);
    this.wLA = new Int32Array(c);
    this.vot = new Int16Array(c);
    this.slowVote = new Uint8Array(c);
    this.dsh = new Uint8Array(c);
    this.tx = new Array<string | null>(c);
    this.full = new Array<string | null>(c);
    this.g0 = new Int32Array(c);
    this.g1 = new Int32Array(c);
    this.pl = new Uint8Array(c);
    this.fx = new Uint8Array(c);
    this.gT = new Array<string | null>(c);
    this.pend = new Array<PendingWord | null>(c);
    this.pn = new Array<Plan | null>(c);
    this.found = new Array<LetterFinding | null>(c);
    this.sA = new Int16Array(c);
    this.nA = new Int32Array(c);
    this.sB = new Int16Array(c);
    this.nB = new Int32Array(c);
    this.counts = new Int32Array(N_SCRIPTS);
    this.cls = o.model
      ? new TokenClassifier(o.model, {
          wholeScriptFold: o.wholeScriptFold,
          inputLanguages: o.inputLanguages,
          ...(o.wordMajorityMinLetters !== undefined && {
            wordMajorityMinLetters: o.wordMajorityMinLetters,
          }),
          ...(o.wordMajorityMinShare !== undefined && {
            wordMajorityMinShare: o.wordMajorityMinShare,
          }),
        })
      : null;
  }

  // --- Decision 40d: the requested targets -----------------------------------------

  /** Scripts of the requested target languages, in `targetLanguages` order (all three without the model). */
  private readonly tOrder: ('Latin' | 'Cyrillic' | 'Greek')[];
  /** Alphabet mask of the requested targets (every alphabet without the model). */
  private readonly tMask: number;

  /** A script of a requested target language. */
  private isTarget(sc: string): boolean {
    return (this.tOrder as string[]).includes(sc);
  }

  /** A letter of the script of a requested language (or, with `digits`, an ASCII digit). */
  private targetChar(c: string, digits: boolean): boolean {
    const u = c.charCodeAt(0);
    if (digits && u >= 0x30 && u <= 0x39) return true;
    return LETTER_RE.test(c) && this.isTarget(primaryScript(c));
  }

  /**
   * A following neutral written in alphabet `to` (decisions 31, 40d): its base
   * when that is the alphabet, else each letter's twin in `to` in the effective
   * mapping; null when `to` is no requested target or a letter has no twin.
   */
  private nIn(e: NeutralInfo, to: string, lang: TargetLanguage | null): string | null {
    const model = this.o.model;
    if (!model) return neutralIn(e, to as ConfusionAlphabet);
    if (e.base === '') return null;
    // The plain form is the base (English, or Greek for the Greek-based ones) whatever is requested.
    if (e.baseScript === to) return e.base;
    // Per-language rule: twins of the word's language only (no Ukrainian letter into a Russian word).
    if (!this.isTarget(to) || lang === null) return null;
    let out = '';
    for (const l of e.base) {
      if (!LETTER_RE.test(l)) {
        out += l;
        continue;
      }
      const t = primaryScript(l) === to ? l : this.twinL(l, lang);
      if (t === null) return null;
      out += t;
    }
    return out;
  }

  /** Latin letters written in alphabet `to` through their effective twins in language `lang` (40d); a letter with none stays Latin. */
  private throughTwins(base: string, to: string, lang: TargetLanguage | null): string {
    let out = '';
    for (const l of base) {
      const w = /[A-Za-z]/.test(l)
        ? this.nIn(
            { category: 'visibleStyle', base: l, baseScript: 'Latin', standalone: false },
            to,
            lang,
          )
        : null;
      out += w ?? l;
    }
    return out;
  }

  /** A letter's twin among requested language `n`'s letters only (never another language of its alphabet). */
  private twinL(c: string, n: TargetLanguage): string | null {
    const model = this.o.model!;
    const l = model.languages.find((x) => x.name === n);
    return l ? model.twinInLang(c, l.bit) : null;
  }

  /**
   * Per-language rule: the requested language a word of alphabet `alpha` is written in —
   * in request order (`first`, when it qualifies, before the rest), the first holding all the
   * word's letters of `alpha` and passing `ok`, else the first holding them; null when no
   * requested language of `alpha` holds them.
   */
  private wordLang(
    alpha: string,
    text: string,
    ok: ((n: TargetLanguage) => boolean) | null = null,
    first: TargetLanguage | null = null,
  ): TargetLanguage | null {
    const ls = [...composeListed(text)].filter(
      (c) => LETTER_RE.test(c) && primaryScript(c) === alpha,
    );
    const holders = this.langsOf(alpha).filter((n) => ls.every((c) => this.holds(n, c)));
    if (first && holders.includes(first)) holders.unshift(first);
    return (ok && holders.find(ok)) || (holders[0] ?? null);
  }

  /** The script of the word's language: its fold's, else the one script of its letters a requested language is written in, else none (the language itself: {@link wordLang}). */
  private targetOf(
    core: string,
    resolved: WordResolution | null,
  ): ConfusionAlphabet | 'Latin' | null {
    if (resolved) return resolved.language ? TARGET_LANGUAGES[resolved.language].script : null;
    let script: string | null = null;
    for (const ch of core) {
      if (!LETTER_RE.test(ch)) continue;
      const p = primaryScript(ch);
      if (script === null) script = p;
      else if (script !== p) return null;
    }
    return script === 'Latin' || script === 'Cyrillic' || script === 'Greek' ? script : null;
  }

  private slot(t: number): number {
    return this.bounded ? t & this.mask : t;
  }

  private grow(): void {
    const c = this.cap * 2;
    const g = <T extends Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array>(
      a: T,
    ): T => {
      const b = new (a.constructor as new (n: number) => T)(c);
      b.set(a);
      return b;
    };
    this.st = g(this.st);
    this.en = g(this.en);
    this.para = g(this.para);
    this.fin = g(this.fin);
    this.cL = g(this.cL);
    this.finL = g(this.finL);
    this.wL = g(this.wL);
    this.wLA = g(this.wLA);
    this.vot = g(this.vot);
    this.slowVote = g(this.slowVote);
    this.dsh = g(this.dsh);
    this.nA = g(this.nA);
    this.nB = g(this.nB);
    this.g0 = g(this.g0);
    this.g1 = g(this.g1);
    this.fl = g(this.fl);
    this.inM = g(this.inM);
    this.pl = g(this.pl);
    this.fx = g(this.fx);
    this.cS = g(this.cS);
    this.cN = g(this.cN);
    this.sA = g(this.sA);
    this.sB = g(this.sB);
    for (const arr of [this.tx, this.full, this.gT, this.pend, this.pn, this.found] as unknown[][])
      arr.length = c;
    this.cap = c;
  }

  // --- Input: the re-chunker (decisions 18, 18a) ----------------------------------

  /** One phase-1 record: source [start, end) became `text` (`keep`: the source itself). */
  record(start: number, end: number, text: string, kind: LibRecord['kind']): void {
    if (this.stopped || this.o.signal?.aborted) {
      this.stopped = true;
      return;
    }
    // A replayed record can start a new wait (lenient): this record then decides that one too.
    while (this.wait !== WAIT_NONE) if (this.holdWhileWaiting(start, end, text, kind)) return;
    if (kind === 'keep') {
      this.scanSource(start, end);
      return;
    }
    if (kind === 'split') {
      // A removal the tokenizer still reads (illegal code points): its
      // characters separate or form words, its text is gone. Lenient: the source
      // runs go on and the output leaves it out.
      if (!this.o.strict) {
        // Lenient language model: a control closes the open token, and 36e reads the
        // character phase 1 outputs after it (decision 14): the token waits for it.
        if (this.o.model && this.tOpen && this.tDigitOrApos && isControlAt(this.src, start)) {
          this.wait = WAIT_CLOSE;
          this.holdWhileWaiting(start, end, text, kind);
          return;
        }
        // Lenient: read like the source; the output drops it by position.
        this.addDrop(start, end);
        // A whole control sequence: its bytes are blanks between words.
        if (end - start > 1 && this.src.charCodeAt(start) === 0x1b) this.blankSource(start, end);
        else this.scanSource(start, end);
        return;
      }
      this.cutRuns(start);
      // Decision 42: a control removed inside a mojibake span does not cut the span's token.
      if (this.mS.length && this.inMoj(start)) return;
      // Decision 14 (language model): the word phase reads phase 1's output, where the
      // removed control is gone: it joins its neighbours like any removal (`с⟨BEL⟩-onstant`).
      if (this.o.model) {
        this.noteRemoval(start, end);
        return;
      }
      this.ghost = true;
      this.scanSource(start, end);
      this.ghost = false;
      return;
    }
    // Phase 1 changed [start, end): the open source runs stop before it.
    this.cutRuns(start);
    if (text === '') {
      // A removal joins its neighbours; 42/42c: an inner dash beside it too (language model).
      this.noteRemoval(start, end);
      return;
    }
    // A default emission (' ', '\n'): text between words.
    for (let i = 0; i < text.length; i++) this.gapChar(text.charCodeAt(i), 1);
    if (this.yStart >= 0) this.endStyled();
    this.addText(text);
  }

  /** Source [a, b) read as blanks: gap text that separates words. */
  private blankSource(a: number, b: number): void {
    if (this.yStart >= 0) this.endStyled();
    this.gapAt(a, 0x20);
    for (let i = a; i < b; i++) this.gapChar(0x20, 1);
  }

  /** Adds source [a, b) to the gap. */
  private addRange(a: number, b: number): void {
    if (b <= a) return;
    if (this.gTxt !== null) {
      this.gTxt += this.src.slice(a, b);
      this.gPcs?.push(a, b);
    } else if (this.gR0 < 0) {
      this.gR0 = a;
      this.gR1 = b;
    } else if (this.gR1 === a) this.gR1 = b;
    else {
      this.gTxt = this.src.slice(this.gR0, this.gR1) + this.src.slice(a, b);
      if (this.o.refs) this.gPcs = [this.gR0, this.gR1, a, b];
    }
  }

  /** Adds phase 1's text to the gap. */
  private addText(t: string): void {
    // With references, a gap with phase-1 text keeps its pieces (its source as written).
    if (this.o.refs)
      (this.gPcs ??= this.gTxt === null && this.gR0 >= 0 ? [this.gR0, this.gR1] : []).push(t);
    if (this.gTxt !== null) this.gTxt += t;
    else this.gTxt = (this.gR0 >= 0 ? this.src.slice(this.gR0, this.gR1) : '') + t;
  }

  /** The gap so far, taken (the next chunk's gap starts empty). */
  private takeGap(): Gap {
    const g: Gap = { r0: this.gR0, r1: this.gR1, txt: this.gTxt, pcs: this.gPcs };
    this.gR0 = this.gR1 = -1;
    this.gTxt = null;
    this.gPcs = null;
    return g;
  }

  private putGap(g: Gap): void {
    if (g.pcs) {
      for (let k = 0; k < g.pcs.length; k++) {
        const x = g.pcs[k]!;
        if (typeof x === 'string') this.addText(x);
        else this.addRange(x, g.pcs[++k] as number);
      }
    } else if (g.txt !== null) this.addText(g.txt);
    else if (g.r0 >= 0) this.addRange(g.r0, g.r1);
  }

  /** Scanning a removal's characters: they shape the words, they add no text. */
  private ghost = false;

  /** Ends the open source runs of the token and the gap at `p`. */
  private cutRuns(p: number): void {
    if (this.tOpen && this.tSeg >= 0) {
      if (this.tSkip) this.tKept.push(this.tSeg, p);
      else this.tBuf += this.src.slice(this.tSeg, p);
      this.tSeg = -1;
    }
    if (this.aSeg >= 0) {
      this.addRange(this.aSeg, p);
      this.aSeg = -1;
    }
  }

  private scanSource(from: number, to: number): void {
    const text = this.src;
    const counts = this.counts;
    const neutral = this.o.neutral;
    const signal = this.o.signal;
    let check = from + 4096;
    for (let i = from; i < to;) {
      // Early stop (decision 16): the scan itself stops, not only the callbacks.
      if (i >= check && signal) {
        check = i + 4096;
        if (signal.aborted) {
          this.stopped = true;
          return;
        }
      }
      const unit = text.charCodeAt(i);
      if (unit < 0x80) {
        const lower = unit | 0x20;
        if ((lower >= 0x61 && lower <= 0x7a) || (unit >= 0x30 && unit <= 0x39) || unit === 0x27) {
          // A run of ASCII token characters, taken at once.
          if (this.yStart >= 0) this.endStyled();
          let j = i;
          let letters = 0;
          let other = false;
          for (; j < to; j++) {
            const u = text.charCodeAt(j);
            const l = u | 0x20;
            if (l >= 0x61 && l <= 0x7a) letters++;
            else if ((u >= 0x30 && u <= 0x39) || u === 0x27) other = true;
            else break;
          }
          if (letters && counts[0] === 0) this.order.push(0);
          counts[0] += letters;
          this.asciiRun(i, j, letters);
          // Digits and apostrophes: what closeToken's `×` and apostrophe checks look for.
          if (other) this.tDigitOrApos = true;
          i = j;
          continue;
        }
        // Decision 42: an inner dash between letters joins the visibility token (`NTLM-хеш`).
        if (unit === 0x2d) {
          const d = this.dashJoin(i, to);
          if (d !== DASH_GAP) {
            if (d === DASH_JOINS) this.tokenChar(i, i + 1, false, -1, -1);
            i += 1;
            continue;
          }
        }
        // A run of other ASCII characters: gap text, taken at once.
        if (this.yStart >= 0) this.endStyled();
        if (this.tOpen) this.closeToken(unit);
        if (this.aSeg < 0 && !this.ghost) this.aSeg = i;
        let j = i;
        for (; j < to; j++) {
          const u = text.charCodeAt(j);
          if (u >= 0x80) break;
          const l = u | 0x20;
          if ((l >= 0x61 && l <= 0x7a) || (u >= 0x30 && u <= 0x39) || u === 0x27) break;
          // gapChar for ASCII: JS whitespace is TAB–CR and space.
          if (u === 0x0a || u === 0x0d) this.gapBreak(u);
          else {
            this.gCR = false;
            if (!(u === 0x20 || (u >= 0x09 && u <= 0x0c))) this.gNl = false;
          }
          if (this.gLen === 0) this.gFirst = u;
          this.gLen += 1;
        }
        i = j;
        continue;
      }
      const cp = text.codePointAt(i)!;
      const width = cp > 0xffff ? 2 : 1;
      if (cp === 0x2010 || cp === 0x2011) {
        const d = this.dashJoin(i, to);
        if (d !== DASH_GAP) {
          if (this.yStart >= 0) this.endStyled();
          if (d === DASH_JOINS) this.tokenChar(i, i + 1, false, -1, -1);
          i += 1;
          continue;
        }
      }
      if (this.mS.length && this.inMoj(i)) {
        // Decision 42: a character of a mojibake span, part of the token; its letters cast no vote (42b).
        this.mojChar(i, width, cp);
        i += width;
        continue;
      }
      const f = cpFlags(cp);
      let k = -1;
      let lk = -1;
      let ne: NeutralInfo | null;
      if (f & CP_LETTER) {
        lk = scriptIndexOf(cp);
        if (!(f & CP_INVISIBLE) && lk < N_SCRIPTS) {
          k = lk;
          if (counts[k]!++ === 0) this.order.push(k);
        }
      }
      if (f & CP_TOKEN) {
        if (this.yStart >= 0) this.endStyled();
        // tokenChar, inlined for the common case.
        if (!this.tOpen) this.openToken(i);
        else if (this.tSeg < 0 && !this.ghost) this.tSeg = i;
        this.tEnd = i + width;
        this.tAscii = false;
        if (cp === 0x3bc) this.tMu = true;
        // (Language model only: the checks it gates are.)
        if (
          !this.tDigitOrApos &&
          this.o.model !== null &&
          (cp > 0xffff || cp === 0x2019 || cp === 0x2bc || digitValue(String.fromCharCode(cp)) >= 0)
        )
          this.tDigitOrApos = true;
        if (f & CP_LETTER) {
          this.tLetter = true;
          if (lk >= 0 && lk < N_SCRIPTS) {
            if (this.tS1 < 0) this.tS1 = lk;
            else if (this.tS1 !== lk) this.tMulti = true;
          }
        }
        if (k >= 0 && this.bounded) this.countToken(k);
        if (!this.tSkip && ++this.tCps > this.cap250) this.skip();
        // A neutral letter or a letter outside the model: the word needs its letters split.
        if (!this.tNeed && this.classed) {
          if (isDigitLookalike(cp) || (this.o.model && hasReading(cp))) this.tNeed = true;
          else if (neutral && this.nInfo(cp)) this.tNeed = true;
          else if (neutral && (cp === 0x2126 || cp === 0x212a || cp === 0x212b) && this.o.model)
            this.tNeed = true;
          else if (this.o.model) {
            // A letter (or a digit of another script, decision 0a) outside the model.
            let v = cp < 0x10000 ? this.o.model.bmpInfo[cp]! : 0;
            if (v === 0) v = this.o.model.info(cp);
            const kd = v & KIND_MASK;
            if (kd === KIND_NONE) this.tNeed = true;
            else if (kd === KIND_DONOR) this.tDonor = true;
          }
        }
      } else if (
        neutral &&
        (ne = this.nInfo(cp)) !== null &&
        !(cp >= 0x1f1e6 && cp <= 0x1f1ff && this.flagAt(i)) &&
        this.joins(ne, i + width)
      ) {
        // A styled letter, a unit symbol, a word sign: part of the word; a tail
        // mark ends it (decision 30b).
        if (this.yStart >= 0) this.endStyled();
        this.tNeutralNext(i);
        this.tokenChar(i, i + width, false, -1, -1);
        // The mark is the token's last character: 36e reads no character after it.
        if (ne.category === 'tailMark' && !this.letterAt(i + width)) this.closeToken(-1);
      } else {
        // Styled DIGITS (①②③ -> 123) fail ASCII_LETTER_RE and so never join a run.
        const styled = !neutral && (f & CP_STYLED) !== 0;
        if (!styled && this.yStart >= 0) this.endStyled();
        // 36e reads what the reader sees after the token: kept invisible characters are skipped.
        this.gapAt(i, f & CP_INVISIBLE ? this.visibleFrom(i, to) : cp);
        this.gapChar(cp, width);
        if (styled) {
          if (this.yStart < 0) {
            // The gap so far stays before the run.
            this.cutRuns(i);
            this.yGap = this.takeGap();
            if (!this.ghost) this.aSeg = i;
            this.yStart = i;
            this.yText = '';
            this.yCount = 0;
          }
          this.yText += width === 1 ? text[i]! : text.slice(i, i + 2);
          this.yEnd = i + width;
          this.yCount += 1;
        }
      }
      i += width;
    }
  }

  /**
   * Phase 1's mojibake span [start, end) encoding `decoded` (decision 42): a
   * non-breaking part of the token it sits in. Spans arrive in source order,
   * before the records that cover them. A span encoding a space stays a gap.
   */
  mojibake(start: number, end: number, decoded: string): void {
    if (!this.o.strict || /\s/u.test(decoded)) return;
    this.mS.push(start, end);
    this.mDec.push(decoded);
  }

  /** 41o: per word holding references (by start), the offsets in its text of what they encode. */
  private readonly refOff = new Map<number, number[]>();
  private refI = 0;

  /** Notes the offsets in a closing word's text (`cleaned`, or the source) of reference characters. */
  private noteRefs(start: number, end: number, cleaned: string | null): void {
    const r = this.o.refs!.spans;
    while (this.refI < r.length && r[this.refI + 1]! <= start) this.refI += 2;
    const at: number[] = [];
    for (let k = this.refI; k < r.length && r[k]! < end; k += 2)
      for (let x = Math.max(start, r[k]!); x < Math.min(end, r[k + 1]!); x++) at.push(x);
    if (!at.length) return;
    if (cleaned === null) {
      this.refOff.set(
        start,
        at.map((x) => x - start),
      );
      return;
    }
    // Removals inside: the word's text is the source with characters left out, in order.
    const off: number[] = [];
    for (let x = start, j = 0, k = 0; x < end && j < cleaned.length; x++)
      if (this.src.charCodeAt(x) === cleaned.charCodeAt(j)) {
        if (at[k] === x) {
          off.push(j);
          k++;
        }
        j++;
      } else if (at[k] === x) k++;
    if (off.length) this.refOff.set(start, off);
  }

  /** A word's text without the characters its references encode (41o: no vote, no neighbour). */
  private withoutRefs(start: number, text: string): string {
    const off = this.refOff.size ? this.refOff.get(start) : undefined;
    if (!off) return text;
    let out = '';
    for (let j = 0, k = 0; j < text.length; j++)
      if (off[k] === j) k++;
      else out += text[j];
    return out;
  }

  /** Source position i is in a mojibake span (positions only grow). */
  private inMoj(i: number): boolean {
    const m = this.mS;
    while (this.mI < m.length && m[this.mI + 1]! <= i) this.mI += 2;
    return this.mI < m.length && m[this.mI]! <= i;
  }

  /** Source span the open token's last mojibake offset range came from. */
  private tMojSrc = -1;

  /** A character of a mojibake span: a non-breaking part of the visibility token (decision 42). */
  private mojChar(i: number, width: number, cp: number): void {
    if (this.yStart >= 0) this.endStyled();
    if (!this.tOpen) this.openToken(i);
    else if (this.tSeg < 0 && !this.ghost) this.tSeg = i;
    const off = this.tBuf.length + (this.tSeg >= 0 ? i - this.tSeg : 0);
    this.tEnd = i + width;
    this.tAscii = false;
    this.tDigitOrApos = true;
    const f = cpFlags(cp);
    if (f & CP_LETTER) {
      this.tLetter = true;
      const lk = scriptIndexOf(cp);
      if (lk >= 0 && lk < N_SCRIPTS) {
        if (this.tS1 < 0) this.tS1 = lk;
        else if (this.tS1 !== lk) this.tMulti = true;
      }
    }
    this.tNeed = true;
    const m = (this.tMoj ??= []);
    const d = (this.tMojDec ??= []);
    const src = this.mI >> 1;
    if (m.length && m[m.length - 1] === off) {
      m[m.length - 1] = off + width;
      if (src !== this.tMojSrc) d[d.length - 1] += this.mDec[src]!;
    } else {
      m.push(off, off + width);
      d.push(this.mDec[src]!);
    }
    this.tMojSrc = src;
    if (!this.tSkip && ++this.tCps > this.cap250) this.skip();
  }

  /** A neutral character's dictionary entry, disguises left out under math switch 1 (decision 30h). */
  private nInfo(cp: number): NeutralInfo | null {
    // Decision 40f under the Latin-fold model (no packs): the long s reads `s`, converted, a spoof.
    if (cp === 0x17f && !this.o.model) return LONG_S_LATIN;
    const e = neutralInfo(cp);
    return e !== null && e.category === 'disguise' && this.o.keepMath ? null : e;
  }

  /**
   * Whether a neutral character outside the token class joins the word at
   * this point (decision 30b): a separator never (a boundary on both sides),
   * a tail mark and an undecided symbol only an open word (the tail mark then
   * ends it), the rest always.
   */
  private joins(e: NeutralInfo, p: number): boolean {
    // Decision 41j: a boundary symbol directly followed by a letter joins it (and is reported).
    if (e.category === 'separator') return this.letterAt(p);
    if (e.category === 'tailMark') return this.tOpen || this.letterAt(p);
    if (e.category === 'undecided') return this.tOpen;
    return true;
  }

  /** The regional-indicator run {@link flagAt} last read: its start, and where it goes on. */
  private riStart = -1;
  private riNext = -1;

  /**
   * A regional indicator at i is half of a flag: regional indicators pair from
   * the start of their run, and the pair is an RGI flag sequence (a valid
   * pair is a flag emoji and stays).
   */
  private flagAt(i: number): boolean {
    const src = this.src;
    const isRI = (p: number) => {
      const c = src.codePointAt(p);
      return c !== undefined && c >= 0x1f1e6 && c <= 0x1f1ff;
    };
    // The run's start, carried along the run (review 11: linear in the run).
    let start = i;
    if (i === this.riNext && i > 0) start = this.riStart;
    else while (start >= 2 && isRI(start - 2)) start -= 2;
    this.riStart = start;
    this.riNext = i + 2;
    const first = (i - start) % 4 === 0 ? i : i - 2;
    if (!isRI(first + 2) && first === i) return false;
    FLAG_RE ??= new RegExp('^\\p{RGI_Emoji_Flag_Sequence}$', 'v');
    return FLAG_RE.test(src.slice(first, first + 4));
  }

  /**
   * Decision 42 (strict, language model): whether the dash at i joins the open token with
   * the next word: a letter right before it (the token's last character) and the next
   * character phase 1 outputs a letter. Removed characters are no characters (decision 14):
   * before the dash they are known (the last removal run); after it they come as the next
   * records, so a dash that ends the record (`to`) waits for the character after them.
   */
  private dashJoin(i: number, to: number): number {
    if (this.dashDecided === i) {
      if (!this.dashJoins) return DASH_GAP;
      this.tDashed = true;
      return DASH_JOINS;
    }
    // 42/42c (language model): removed characters right before the dash do not cut the token.
    const i0 = this.o.model !== null && this.remE === i && this.tEnd === this.remS ? this.remS : i;
    if (!this.p3 || !this.tOpen || this.tEnd !== i0 || i0 === 0) return DASH_GAP;
    const src = this.src;
    let k = i0 - 1;
    if (k > 0 && (src.charCodeAt(k) & 0xfc00) === 0xdc00) k--;
    // Marks stay with their letter (`е́-mail`): the letter before them decides.
    while (k > 0 && cpFlags(src.codePointAt(k)!) & CP_MARK) {
      k--;
      if (k > 0 && (src.charCodeAt(k) & 0xfc00) === 0xdc00) k--;
    }
    // Decision 42c: a neutral that reads as a letter (`ⓐ`, `ⅰ`, `𝐨`) is a letter of the token;
    // 41o: so is a reference that encodes one.
    if (!this.letterLike(src.codePointAt(k)!) || i + 1 >= src.length) return DASH_GAP;
    if (i + 1 === to) {
      this.dashAt = i;
      this.wait = WAIT_DASH;
      return DASH_WAITS;
    }
    if (!this.letterAfter(i + 1)) return DASH_GAP;
    this.tDashed = true;
    return DASH_JOINS;
  }

  /**
   * A record while the open token waits for the next character phase 1 outputs (a dash at
   * the end of a record, {@link dashJoin}; a lenient control after the token): a removal is
   * held; anything else ends the wait ({@link endWait}). True when the record was held.
   */
  private holdWhileWaiting(
    start: number,
    end: number,
    text: string,
    kind: LibRecord['kind'],
  ): boolean {
    // A split record is no output (lenient: source the scan reads, held to keep its order).
    const removal = kind === 'split' || (kind !== 'keep' && text === '');
    if (removal) {
      const held = this.heldRecords;
      const last = held[held.length - 1];
      // Strict: a removal outside mojibake is read as cutRuns + noteRemoval whatever its kind,
      // so a run of them is held as one range (a long run costs no memory per record).
      if (
        this.o.strict &&
        last !== undefined &&
        last[1] === start &&
        last[3] === 'rem' &&
        !(this.mS.length && this.inMoj(start))
      )
        last[1] = end;
      else
        held.push([
          start,
          end,
          text,
          this.o.strict && !(this.mS.length && this.inMoj(start)) ? 'rem' : kind,
        ]);
      return true;
    }
    this.endWait(
      kind === 'keep' ? this.src.codePointAt(start)! : text === '' ? -1 : text.codePointAt(0)!,
    );
    return false;
  }

  /**
   * Ends the wait with `next`, the code point phase 1 outputs next (-1 at the end): the dash
   * joins when it is a letter, or the token closes; then the held removals are read in order.
   */
  private endWait(next: number): void {
    if (this.wait === WAIT_DASH) {
      const i = this.dashAt;
      this.dashAt = -1;
      this.dashDecided = i;
      this.dashJoins = next >= 0 && this.letterLike(next);
      this.scanSource(i, i + 1);
      this.dashDecided = -1;
    } else this.closeToken(next);
    this.wait = WAIT_NONE;
    const held = this.heldRecords;
    this.heldRecords = [];
    for (const [a, b, text, kind] of held) this.record(a, b, text, kind);
  }

  /** What the open token waits for ({@link holdWhileWaiting}): nothing, a dash's join, its closing. */
  private wait = WAIT_NONE;
  /** The records held while it waits. */
  private heldRecords: [number, number, string, LibRecord['kind']][] = [];
  /** The waiting dash ({@link WAIT_DASH}). */
  private dashAt = -1;
  /** The dash being read again once decided, and whether it joins. */
  private dashDecided = -1;
  private dashJoins = false;
  /** The code point phase 1 outputs after the token being closed (-1: none, the end). */
  private tNext = -1;

  private noteRemoval(start: number, end: number): void {
    if (start === this.remE) this.remE = end;
    else {
      this.remS = start;
      this.remE = end;
    }
  }

  /** The last run of removed characters [remS, remE) (phase 1 records with no text). */
  private remS = -1;
  private remE = -1;

  /** A letter-like character starts at source position `p`. */
  private letterAfter(p: number): boolean {
    return p < this.src.length && this.letterLike(this.src.codePointAt(p)!);
  }

  private hasLetterLike(text: string): boolean {
    for (const ch of text) if (this.letterLike(ch.codePointAt(0)!)) return true;
    return false;
  }

  private letterLike(cp: number): boolean {
    if (cpFlags(cp) & CP_LETTER) return true;
    if (!this.o.neutral) return false;
    const e = this.nInfo(cp);
    return (
      e !== null &&
      (e.category === 'visibleStyle' || e.category === 'disguise' || e.category === 'sameReading')
    );
  }

  /** A letter starts at source position p. */
  private letterAt(p: number): boolean {
    if (p >= this.src.length) return false;
    return (cpFlags(this.src.codePointAt(p)!) & CP_LETTER) !== 0;
  }

  private tNeutralNext(i: number): void {
    if (!this.tOpen) this.openToken(i);
    this.tNeutral = true;
  }

  /** The first code point in source [i, to) that is no invisible character, -1 when none. */
  private visibleFrom(i: number, to: number): number {
    while (i < to) {
      const cp = this.src.codePointAt(i)!;
      if (!(cpFlags(cp) & CP_INVISIBLE)) return cp;
      i += cp > 0xffff ? 2 : 1;
    }
    return -1;
  }

  /** A gap character at source position i: the token before it closes, `next` read after it. */
  private gapAt(i: number, next: number): void {
    if (this.tOpen) this.closeToken(next);
    if (this.aSeg < 0 && !this.ghost) this.aSeg = i;
  }

  private tokenChar(
    i: number,
    end: number,
    letter: boolean,
    countScript: number,
    letterScript: number,
  ): void {
    if (!this.tOpen) this.openToken(i);
    else if (this.tSeg < 0 && !this.ghost) this.tSeg = i;
    this.tEnd = end;
    this.tAscii = false;
    this.tDigitOrApos = true; // rare paths (dashes, styled): the checks run
    if (letter) {
      this.tLetter = true;
      if (letterScript >= 0 && letterScript < N_SCRIPTS) {
        if (this.tS1 < 0) this.tS1 = letterScript;
        else if (this.tS1 !== letterScript) this.tMulti = true;
      }
    }
    if (countScript >= 0 && this.bounded) this.countToken(countScript);
    if (this.tSkip) return;
    this.tCps += 1;
    if (this.tCps > this.cap250) this.skip();
  }

  /** ASCII token characters [i, j), `letters` of them Latin letters. */
  private asciiRun(i: number, j: number, letters: number): void {
    if (!this.tOpen) this.openToken(i);
    else if (this.tSeg < 0 && !this.ghost) this.tSeg = i;
    this.tEnd = j;
    if (letters) {
      this.tLetter = true;
      if (this.tS1 < 0) this.tS1 = 0;
      else if (this.tS1 !== 0) this.tMulti = true;
      if (this.bounded) this.countToken(0, letters);
    }
    if (this.tSkip) return;
    this.tCps += j - i;
    if (this.tCps > this.cap250) this.skip();
  }

  /** Skip mode (decision 19): the word's text is no longer kept, only where its pieces are. */
  private skip(): void {
    this.tSkip = true;
    if (this.tKept.length) this.tKept.length = 0;
    // The text so far is rebuilt from the source at output: keep its ranges instead.
    this.tKeptPrefix = this.tBuf;
    this.tBuf = '';
  }
  /** Skip mode: the text before skipping (phase 1's output of the first part). */
  private tKeptPrefix = '';

  private countToken(k: number, n = 1): void {
    if (this.tCountsA === k) this.tCountsNA += n;
    else if (this.tCountsA < 0) {
      this.tCountsA = k;
      this.tCountsNA = n;
    } else if (this.tCountsB === k) this.tCountsNB += n;
    else if (this.tCountsB < 0) {
      this.tCountsB = k;
      this.tCountsNB = n;
    } else {
      const m = (this.tMore ??= new Map());
      m.set(k, (m.get(k) ?? 0) + n);
    }
  }

  private openToken(i: number): void {
    // The gap so far is the new word's leading gap.
    this.cutRuns(i);
    this.tOpen = true;
    this.tStart = i;
    this.tAscii = true;
    this.tDigitOrApos = false;
    this.tLetter = false;
    this.tSplit = false;
    this.tBuf = '';
    this.tSeg = this.ghost ? -1 : i;
    this.tCps = 0;
    this.tSkip = false;
    if (this.tKept.length) this.tKept.length = 0;
    this.tKeptPrefix = '';
    this.tNeutral = false;
    this.tNeed = false;
    this.tDonor = false;
    this.tS1 = -1;
    this.tMulti = false;
    this.tCountsA = this.tCountsB = -1;
    this.tCountsNA = this.tCountsNB = 0;
    this.tMore = null;
    this.tMoj = null;
    this.tMojDec = null;
    this.tMojSrc = -1;
    this.tDashed = false;
    this.tMu = false;
  }

  private gapChar(cp: number, width: number): void {
    if (this.tOpen) this.closeToken(cp);
    if (cp === 0x0a || cp === 0x0d) this.gapBreak(cp);
    else {
      this.gCR = false;
      if (!isJsSpace(cp)) this.gNl = false;
    }
    if (this.gLen === 0) this.gFirst = cp;
    this.gLen += width;
  }

  /** Decision 25a: CR, LF and CRLF are each one line break; two make a blank line (24). */
  private gapBreak(u: number): void {
    if (u === 0x0a && this.gCR) {
      this.gCR = false;
      return;
    }
    if (this.gNl) this.gBlank = true;
    this.gNl = true;
    this.gCR = u === 0x0d;
  }

  private endStyled(): void {
    const y = this.yStart;
    this.yStart = -1;
    this.cutRuns(this.yEnd);
    const before = this.yGap!;
    this.yGap = null;
    const fold = this.yText.normalize('NFKC').normalize('NFC');
    if (this.yCount < 2 || !(ASCII_PRINTABLE_RE.test(fold) && ASCII_LETTER_RE.test(fold))) {
      // No finding: the run is gap text after the gap before it.
      const run = this.takeGap();
      this.putGap(before);
      this.putGap(run);
      return;
    }
    // A styled run is a chunk of its own: the gap before it, the run.
    this.takeGap();
    this.styledNow.push({
      gap: before,
      f: {
        kind: 'styled',
        start: y,
        end: this.yEnd,
        cleaned: this.yText,
        result: { signals: ['confusable_word'], scripts: [], skeleton: fold, normalized: fold },
        resolved: null,
        replacement: fold,
      },
    });
  }

  /** Closes the open token; `next`: the code point phase 1 outputs after it (-1 at the end). */
  private closeToken(next: number): void {
    this.tOpen = false;
    this.tNext = next;
    // Untouched: the word is the source range, no text kept.
    let exact = false;
    if (this.tSeg >= 0) {
      if (this.tSkip) this.tKept.push(this.tSeg, this.tEnd);
      else if (this.tBuf === '' && this.tSeg === this.tStart) exact = true;
      else this.tBuf += this.src.slice(this.tSeg, this.tEnd);
      this.tSeg = -1;
    }
    if (this.nTok > 0 && this.bounded && this.nTok >= this.cap) this.evict(this.nTok - this.cap);
    if (!this.bounded && this.nTok >= this.cap) this.grow();
    const t = this.nTok++;
    const s = this.slot(t);
    const start = this.tStart;
    const end = this.tEnd;
    let f = 0;
    if (this.tAscii) f |= F_ASCII;
    if (this.tLetter) f |= F_LETTER;
    let cleaned: string | null = null;
    if (this.tSkip) {
      f |= F_TOOBIG;
      cleaned = this.keptText();
    } else if (exact) f |= F_EXACT;
    else cleaned = this.tBuf;
    if (this.refOff.size) this.refOff.delete(start);
    if (this.o.refs && !(f & F_TOOBIG)) this.noteRefs(start, end, cleaned);
    // Decision 36e: an `x` between two numbers is written `×` before the word is judged.
    if (this.xOrig.size) this.xOrig.delete(start);
    if (
      this.o.model &&
      !(f & F_TOOBIG) &&
      this.tDigitOrApos &&
      hasDigit(cleaned ?? this.src, cleaned ? 0 : start, cleaned ? cleaned.length : end)
    ) {
      const w = cleaned ?? this.src.slice(start, end);
      const x = this.timesOf(w, start);
      if (x !== null) {
        this.xOrig.set(start, w);
        cleaned = x;
        f &= ~(F_EXACT | F_ASCII);
      }
    }
    if (t > 0 && this.gBlank) {
      f |= F_PARA;
      this.paraId++;
    }
    if (t > 0 && this.gLen === 1 && isHyphen(this.gFirst)) f |= F_HYPH;
    this.gNl = this.gBlank = this.gCR = false;
    this.gLen = 0;
    // The leading gap goes with the word (decision 18a).
    this.g0[s] = this.gR0;
    this.g1[s] = this.gR1;
    this.gT[s] = this.gTxt;
    if (this.gPcs && this.gTxt !== null) this.gapPcs.set(t, this.gPcs);
    let plain = this.gTxt === null && (this.gR0 < 0 || this.gR1 === start) ? 1 : 0;
    this.gR0 = this.gR1 = -1;
    this.gTxt = null;
    this.gPcs = null;
    if (this.styledNow.length) {
      this.styledBefore.set(t, this.styledNow);
      this.styledNow = [];
      plain = 0;
    }
    if (cleaned !== null || f & F_TOOBIG) plain = 0;
    this.pl[s] = plain;
    this.st[s] = start;
    this.en[s] = end;
    this.full[s] = cleaned;
    this.found[s] = null;
    // The judge reads the word's core (decisions 31, 31a, 33, 34): under the
    // language model without neutral letters, tail marks and foreign letters;
    // under the Latin-fold model with neutral letters made Latin.
    let judgeText = cleaned;
    let x = 0;
    let plan: Plan | null = null;
    const moj: Moj | null =
      this.tMoj && !(f & F_TOOBIG) ? { off: this.tMoj, dec: this.tMojDec! } : null;
    if (moj) this.mjm.set(s, moj);
    else if (this.mjm.size) this.mjm.delete(s);
    if (!(f & (F_ASCII | F_TOOBIG)) && (this.tNeed || this.tNeutral)) {
      plan = this.split(cleaned ?? this.src.slice(start, end), moj?.off ?? null);
      if (plan) {
        x = plan.x;
        judgeText = plan.core;
      }
    }
    this.pn[s] = plan;
    // Decision 41b's vote can come from the letter counts when nothing in the word needs a closer look.
    this.vot[s] = 0;
    // 41o: a word holding references votes without their letters (no count shortcut).
    const refs = this.refOff.size > 0 && this.refOff.has(start);
    this.slowVote[s] = !this.bounded || this.tNeed || this.tNeutral || this.tDonor || refs ? 1 : 0;
    this.fx[s] = x;
    this.tx[s] = judgeText;
    this.para[s] = this.paraId;
    this.fin[s] = -1;
    this.finL[s] = 0;
    this.wL[s] = -1;
    this.wLA[s] = -1;
    this.vot[s] = 0;
    this.pend[s] = null;
    let cS = -1;
    let cN = 0;
    let cL = 0;
    let inM = 0;
    if (this.cls && !(f & F_TOOBIG)) {
      if (moj) {
        // Decision 42b: letters inside mojibake spans cast no vote (the window's majority).
        const rest = withoutSpans(cleaned ?? this.src.slice(start, end), moj.off);
        this.cls.classify(rest, 0, rest.length);
        cS = this.cls.cleanS;
        cN = this.cls.cleanN;
        cL = this.cls.cleanL;
      }
      if (judgeText === null) this.cls.classify(this.src, start, end);
      else this.cls.classify(judgeText, 0, judgeText.length);
      if (!moj) {
        cS = this.cls.cleanS;
        cN = this.cls.cleanN;
        cL = this.cls.cleanL;
      }
      inM = this.cls.inModel;
      this.pend[s] = this.cls.pending;
    }
    // 41o: letters a reference encodes cast no vote (the window's majority).
    if (this.cls && refs) {
      const rest = this.withoutRefs(start, cleaned ?? this.src.slice(start, end));
      this.cls.classify(rest, 0, rest.length);
      cS = this.cls.cleanS;
      cN = this.cls.cleanN;
      cL = this.cls.cleanL;
    }
    this.cS[s] = cS;
    this.cN[s] = cN;
    this.cL[s] = cL;
    this.inM[s] = inM;
    if (this.dsh[s]! & 1) this.dashWin.delete(s);
    // 36c/36e: apostrophe parts are separate words like dash parts.
    if (!this.tDashed && this.p3 && !(f & (F_ASCII | F_TOOBIG))) {
      const tok = judgeText ?? this.src.slice(start, end);
      if (this.tDigitOrApos && hasApostrophe(tok) && APOS_JOIN_RE.test(tok)) this.tDashed = true;
    }
    this.dsh[s] = (this.tDashed ? 1 : 0) | (this.tMu ? 2 : 0);
    if (this.tDashed) {
      if (this.cls && !moj && !(f & (F_ASCII | F_TOOBIG))) {
        const win = this.dashLayout(judgeText ?? this.src.slice(start, end), start).win;
        if (win) this.dashWin.set(s, win);
      }
    }
    // Mixed scripts (for "any word is mixed"): only a token with letters of two scripts can be.
    if (!(f & F_ASCII) && this.tMulti && !(f & F_TOOBIG)) {
      const tok = judgeText ?? this.src.slice(start, end);
      let mixed = this.mixedCache.get(tok);
      if (mixed === undefined) {
        mixed = wordScripts(tok).mixed;
        if (this.mixedCache.size >= 4096) this.mixedCache.clear();
        this.mixedCache.set(tok, mixed);
      }
      if (mixed) {
        f |= F_MIXED;
        this.anyMixed = true;
      }
    }
    // The fast lane. Invariant: for an ASCII word (not past the word cap) the classifier left
    // nothing pending, the full path stores the ring state above as for any word and its judge
    // (judgeFull, judgeWord) returns "no finding, counted as a word"; the lane keeps that ring
    // state, classification included (from the memo), and gives the judgement directly. The rest
    // follows from the two flags: a digit `x` written `×`, a dash, a mojibake span or any non-ASCII
    // letter clears F_ASCII; a case anomaly or a word the context may fold is pending; removals
    // and references inside leave an ASCII word whose votes and window sums are stored as usual.
    if (
      (f & (F_ASCII | F_TOOBIG)) === F_ASCII &&
      this.pend[s] === null &&
      this.o.fastLane !== false
    )
      f |= F_PLAIN;
    this.fl[s] = f;
    if (this.bounded) {
      this.sA[s] = this.tCountsA;
      this.nA[s] = this.tCountsNA;
      this.sB[s] = this.tCountsB;
      this.nB[s] = this.tCountsNB;
      if (this.tMore) this.more.set(s, this.tMore);
      else if (this.more.size) this.more.delete(s);
      // Judge what the read-ahead now covers.
      while (this.judged <= t - this.ahead && !this.stopped) this.judge(this.judged++);
      this.flush();
    }
  }

  /** Skip mode: the word's text, rebuilt from its kept source ranges. */
  private keptText(): string {
    let out = this.tKeptPrefix;
    const k = this.tKept;
    for (let q = 0; q < k.length; q += 2) out += this.src.slice(k[q]!, k[q + 1]!);
    return out;
  }

  private evict(t: number): void {
    const s = this.slot(t);
    if (this.more.size) this.more.delete(s);
    this.tx[s] = null;
    this.full[s] = null;
    this.gT[s] = null;
    if (this.refOff.size) this.refOff.delete(this.st[s]!);
    this.pend[s] = null;
    this.pn[s] = null;
    this.found[s] = null;
  }

  // --- Judgement --------------------------------------------------------------

  /**
   * The context window of word t (decisions 21, 22, 24): ±majorityWindow words
   * within its paragraph, from the ring. Every window metric reads it.
   */
  private windowOf(t: number): [number, number] {
    const lowest = this.bounded ? Math.max(0, this.nTok - this.cap) : 0;
    return [Math.max(lowest, t - this.W), Math.min(this.nTok - 1, t + this.W)];
  }

  private readonly bc = new Int32Array(N_SCRIPTS);

  /**
   * Dominant script and any-mixed over the context window of word t (or every word, breadth
   * 'all'): the token judge (`analyzeToken`) and the Latin-fold model's neutral alphabet,
   * by script. Under the language model no target choice reads it: the ladder
   * and the neutrals' language read the context by language ({@link contextOf},
   * {@link ctxLanguage}; per-language rule).
   */
  private breadth(t: number): { dom: ScriptName | null; mixed: boolean } {
    if (!this.bounded) {
      // Every word: judged once the text is read, so one value.
      if (this.wholeDom === undefined) this.wholeDom = this.wholeDominant();
      return { dom: this.wholeDom, mixed: this.anyMixed };
    }
    const bc = this.bc;
    bc.fill(0);
    const pa = this.para[this.slot(t)]!;
    const [lo, hi] = this.windowOf(t);
    let mixed = false;
    // Most letters; a tie goes to the script seen first in the window.
    let best = -1;
    const add = (k: number, n: number) => {
      bc[k] += n;
      if (best < 0 || bc[k]! > bc[best]!) best = k;
    };
    for (let j = lo; j <= hi; j++) {
      const sj = this.slot(j);
      if (this.para[sj] !== pa) continue;
      if (this.fl[sj]! & F_MIXED) mixed = true;
      if (this.sA[sj]! >= 0) add(this.sA[sj]!, this.nA[sj]!);
      if (this.sB[sj]! >= 0) add(this.sB[sj]!, this.nB[sj]!);
      if (this.more.size) {
        const m = this.more.get(sj);
        if (m) for (const [k, n] of m) add(k, n);
      }
    }
    // `best` is the first to reach the top count, so a tie goes to the earlier one.
    let top = -1;
    for (let j = lo; j <= hi && top < 0; j++) {
      const sj = this.slot(j);
      if (this.para[sj] !== pa) continue;
      for (const k of this.scriptsOf(sj))
        if (bc[k] === bc[best]!) {
          top = k;
          break;
        }
    }
    return { dom: top < 0 ? null : (SCRIPT_LIST[top] as ScriptName), mixed };
  }

  /** The scripts a word's letters were counted under, in the order they came. */
  private scriptsOf(sj: number): number[] {
    const out: number[] = [];
    if (this.sA[sj]! >= 0) out.push(this.sA[sj]!);
    if (this.sB[sj]! >= 0) out.push(this.sB[sj]!);
    const m = this.more.get(sj);
    if (m) out.push(...m.keys());
    return out;
  }

  /** Whole-text dominant script: most letters, ties to the first seen. */
  wholeDominant(): ScriptName | null {
    let dom: ScriptName | null = null;
    let dc = 0;
    for (const k of this.order) {
      if (this.counts[k]! > dc) {
        dom = SCRIPT_LIST[k] as ScriptName;
        dc = this.counts[k]!;
      }
    }
    return dom;
  }

  private judgeText(s: number): string {
    return this.tx[s] ?? this.src.slice(this.st[s]!, this.en[s]!);
  }

  /** The word as phase 1 output it. */
  private cleanedOf(s: number): string {
    return this.full[s] ?? this.src.slice(this.st[s]!, this.en[s]!);
  }

  /** Context of a pending word (§4.2 steps 1–2) from the ring, within its paragraph. */
  private resolveAt(t: number, v: WordView): WordResolution | null {
    return this.cls!.resolve(v.pend!, this.contextOf(t, v));
  }

  /**
   * {@link judgeWord}: the word is one decision 37 stroke and no language written in Latin letters is requested;
   * a stroke of another writing in text of its own script stays unreported (41b: `هذا ا كتاب`).
   */
  private loneStrokeKept(t: number, v: WordView): boolean {
    if (!this.o.model || this.isTarget('Latin')) return false;
    // A stroke is one or two UTF-16 units: a longer word is no lone stroke (a cheap exit).
    const s = this.slot(t);
    const a = this.st[s]!;
    const e = this.en[s]!;
    if (e - a > 8) return false;
    let any = false;
    for (let i = a; i < e && !any; i++) {
      const cp = this.src.codePointAt(i)!;
      if (CASE_STROKE_CPS.has(cp)) any = true;
    }
    if (!any) return false;
    let one: string | null = null;
    for (const c of this.vFull(v)) {
      if (!LETTER_RE.test(c)) continue;
      if (one !== null) return false;
      one = c;
    }
    if (one === null || !CASE_STROKE.has(one)) return false;
    const sc = primaryScript(one);
    if (sc === 'Latin' || sc === 'Cyrillic' || sc === 'Greek') return true;
    return !this.ownContext(t, ownScriptOf(one.codePointAt(0)!), v);
  }

  /**
   * Decision 41b by language: word t is written only in letters of unrequested languages, and
   * a nearest word on either side, or the window's majority of letters, is one of them.
   */
  private foreignOwnContext(t: number, v: WordView): boolean {
    const model = this.o.model!;
    this.foreignEdge = false;
    // The word as written: its donors (letters and digit look-alikes alike) must be letters of
    // that language too (`𐊱he`, `P١anck` in English text are no English words).
    // The whole visibility token, not a piece of it (`ငan`: `an` alone is no word of its own).
    const w = v.piece ? this.cleanedOf(this.slot(t)) : this.vFull(v);
    for (const c of w) {
      const cp = c.codePointAt(0)!;
      // Letters are judged by language below; any other donor (a digit look-alike, a number of
      // another script, a mark of a script's own: `P١anck`, `𑣩an`, `on𐌠y`, `ంne`) is no letter
      // of that language.
      if (LETTER_RE.test(c)) continue;
      if (isDigitLookalike(cp) || hasReading(cp) || this.kindOf(cp) === KIND_DONOR) return false;
      if ((cp > 0x7f && /\p{N}/u.test(c)) || (/\p{M}/u.test(c) && !/\p{Script=Inherited}/u.test(c)))
        return false;
    }
    const U = model.foreignLangsOf(w);
    if (!U) return false;
    // A nearest word of one of those languages, by its vote (a converted word as converted).
    const { l, r } = this.nearestAt(t);
    const lv = l >= 0 ? this.langVote(this.slot(l), true) : 0;
    const rv = r >= 0 ? this.langVote(this.slot(r), true) : 0;
    if (lv & U || rv & U) {
      // 41b edge: no report if both nearest words share its language;
      // otherwise kept and reported as whole_word_lookalike. The right word as
      // written here (`выполняет их по порядку`: `порядку` is still to be judged).
      const r2 = r >= 0 ? r : this.nearestAt(t, true).r;
      const rv2 = r2 >= 0 ? this.langVote(this.slot(r2), true) : 0;
      // Both share one own language (`мышь сор уеѕ`: Russian left, Macedonian right: reported).
      this.foreignEdge = !(lv & rv2 & U);
      return true;
    }
    // The window, per language (per-language rule): one of them holds more letters than all
    // the other voting words together. Kept by the window alone: reported (41b edge).
    const sums = this.windowSums(t, true);
    for (let b = 0, m = U; m; b++, m >>>= 1)
      if (m & 1 && sums[b]! > this.winTotal - sums[b]!) {
        this.foreignEdge = true;
        return true;
      }
    return false;
  }

  /** {@link foreignOwnContext}'s last answer: kept, but not between two words of its own language (reported). */
  private foreignEdge = false;

  /** The context's language of word t (per-language rule): the first both nearest words share, else the window's. */
  private ctxLanguage(t: number, v: WordView | null): TargetLanguage | null {
    const model = this.o.model;
    if (!model) return null;
    const c = this.contextOf(t, v);
    const near = model.languages.find((l) => c.near & (1 << l.bit));
    if (near) return near.name;
    return model.languages.find((l) => l.bit === c.window)?.name ?? null;
  }

  /** The ladder's context of word t: step 1 (hyphen partners or the nearest words) and step 2 (the window's majority). */
  private contextOf(
    t: number,
    v: WordView | null,
  ): { near: number; window: number; hyphen: boolean } {
    // Per-language rule: the context is languages, never alphabets.
    // Step 1: the languages both nearest words (decision 41b's definition) are written in; from
    // outside the visibility token (42b: its parts are never context for each other).
    void v;
    const { l, r } = this.nearestAt(t);
    const near = l < 0 || r < 0 ? 0 : this.langVote(this.slot(l)) & this.langVote(this.slot(r));
    return { near, window: langMajority(this.windowSums(t)), hyphen: false };
  }

  /** The languages (bits) word slot `s` votes for: its converted form's, else those holding all its letters. */
  private langVote(s: number, all = false): number {
    // Converted: the language it was converted into (41b: a word votes as converted).
    if (this.finL[s]) return this.finL[s]!;
    if (all) {
      // A word with a letter of a requested language is that language's word, never an
      // unrequested one's (`Я` beside `її`: Russian, though Ukrainian has `я` too).
      let m = this.wLA[s]!;
      if (m < 0) {
        const text = this.judgeText(s);
        m = this.o.model!.foreignLangsOf(text) || this.o.model!.langsOf(text);
        this.wLA[s] = m;
      }
      return m;
    }
    if (this.cS[s]! >= 0) return this.cL[s]!;
    let m = this.wL[s]!;
    if (m < 0) this.wL[s] = m = this.o.model!.langsOf(this.judgeText(s));
    return m;
  }

  /** {@link windowSums}' letter total over the words that vote for some language (`all` mode). */
  private winTotal = 0;

  /**
   * Step 2's letter sums of word t's window, per requested language (bit), from the clean words
   * around it. `all` (decision 41b): per known language, every word by its {@link langVote}
   * (a converted word as converted; a word of no requested language by the unrequested
   * languages holding it), with the total of the words that vote in {@link winTotal}.
   */
  private windowSums(t: number, all = false): number[] {
    const pa = this.para[this.slot(t)]!;
    const sums = this.sums;
    sums.fill(0);
    this.winTotal = 0;
    const add = (mask: number, n: number) => {
      for (let b = 0; mask; b++, mask >>>= 1) if (mask & 1) sums[b] += n;
    };
    const [lo, hi] = this.windowOf(t);
    for (let j = lo; j <= hi; j++) {
      if (j === t) continue;
      const sj = this.slot(j);
      if (this.para[sj] !== pa) continue;
      if (all) {
        const m = this.langVote(sj, true);
        if (!m) continue;
        let n = 0;
        for (const c of this.judgeText(sj)) if (LETTER_RE.test(c)) n++;
        add(m, n);
        this.winTotal += n;
        continue;
      }
      const dw = this.dsh[sj]! & 1 ? this.dashWin.get(sj) : undefined;
      if (dw) for (let k = 0; k < dw.length; k += 2) add(dw[k]!, dw[k + 1]!);
      else if (this.cL[sj]) add(this.cL[sj]!, this.cN[sj]!);
    }
    return sums;
  }

  // --- Decision 41b: the context of a donor in a word with no target character ---

  /** Model kind of a code point (0 without a model). */
  private kindOf(cp: number): number {
    const model = this.o.model;
    if (!model) return -1;
    let v = cp < 0x10000 ? model.bmpInfo[cp]! : 0;
    if (v === 0) v = model.info(cp);
    return v & KIND_MASK;
  }

  /** Script index of the word's first donor, -1 if none. */
  private donorScript(token: string): number {
    for (const ch of token) {
      const cp = ch.codePointAt(0)!;
      if (this.kindOf(cp) === KIND_DONOR) return ownScriptOf(cp);
    }
    return -1;
  }

  private readonly vc = new Int32Array(SCRIPT_LIST.length);

  /**
   * A word's vote (decision 41b): the script with most of its letters and
   * non-Latin digits, donors and digit look-alikes not counted; -1 when it has
   * none. `donor` is set when the word holds a donor (it needs a conversion).
   */
  /**
   * Which nearest words count and whether one needs a conversion (decision 41b), by the script
   * of most of its letters: read only for that selection and for donor-script contexts outside
   * the target languages (41b digits, 41k's CJK set). The vote for a target language is
   * {@link langVote} (per-language rule).
   */
  private voteOf(sj: number): { vote: number; converts: boolean } {
    const c = this.vot[sj]!;
    if (c !== 0) return { vote: (c >> 1) - 2, converts: (c & 1) === 1 };
    const r = this.voteOfUncached(sj);
    this.vot[sj] = ((r.vote + 2) << 1) | (r.converts ? 1 : 0);
    return r;
  }

  private voteOfUncached(sj: number): { vote: number; converts: boolean } {
    // A word the resolver may convert, or a mixed one, needs a conversion.
    const pending = this.pend[sj] !== null || (this.fl[sj]! & F_MIXED) !== 0;
    // An ASCII word: Latin when it has a letter (no donor, no other script).
    if (this.fl[sj]! & F_ASCII)
      return { vote: this.fl[sj]! & F_LETTER ? 0 : -1, converts: pending };
    if (!this.slowVote[sj]) {
      // From the letter counts: the script with most letters.
      let best = -1;
      let bn = 0;
      if (this.sA[sj]! >= 0) [best, bn] = [this.sA[sj]!, this.nA[sj]!];
      if (this.sB[sj]! >= 0 && this.nB[sj]! > bn) [best, bn] = [this.sB[sj]!, this.nB[sj]!];
      const m = this.more.size ? this.more.get(sj) : undefined;
      if (m) for (const [k, n] of m) if (n > bn) [best, bn] = [k, n];
      return { vote: best, converts: pending };
    }
    const moj = this.mjm.size ? this.mjm.get(sj) : undefined;
    // Decision 42b: letters inside mojibake spans cast no vote.
    const { vote, donor } = this.letterVote(
      moj
        ? withoutSpans(this.cleanedOf(sj), moj.off)
        : this.withoutRefs(this.st[sj]!, this.cleanedOf(sj)),
    );
    // It needs a conversion when it holds a donor its own letters do not keep (decision 41b).
    return { vote, converts: pending || (donor !== -2 && vote !== donor) };
  }

  /** A phase-3 piece's vote (decisions 41b, 42b), as {@link voteOf} gives a word's. */
  private voteOfText(text: string, v: WordView | null): { vote: number; converts: boolean } {
    const { vote, donor } = this.letterVote(text);
    const pending = v !== null && (v.pend !== null || (v.fl & F_MIXED) !== 0);
    return { vote, converts: pending || (donor !== -2 && vote !== donor) };
  }

  /** The script with most of the text's letters and non-Latin digits (-1: none), donors left out; the first donor's script (-2: none). */
  private letterVote(text: string): { vote: number; donor: number } {
    const vc = this.vc;
    vc.fill(0);
    let donor = -2;
    let any = false;
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      const f = cpFlags(cp);
      if (isDigitLookalike(cp) || this.kindOf(cp) === KIND_DONOR) {
        if (donor === -2) donor = ownScriptOf(cp);
        continue;
      }
      if (f & CP_LETTER && !(f & CP_INVISIBLE)) {
        vc[scriptIndexOf(cp)]++;
        any = true;
      } else if (cp > 0x7f && DIGIT_RE.test(ch)) {
        vc[ownScriptOf(cp)]++;
        any = true;
      }
    }
    let best = -1;
    if (any) {
      best = 0;
      for (let k = 1; k < vc.length; k++) if (vc[k]! > vc[best]!) best = k;
    }
    return { vote: best, donor };
  }

  /** Decision 41g: another word of t's context window holds ğ, ş or İ (either case). */
  private turkishNear(t: number): boolean {
    const pa = this.para[this.slot(t)]!;
    const [lo, hi] = this.windowOf(t);
    for (let j = lo; j <= hi; j++) {
      if (j === t) continue;
      const sj = this.slot(j);
      if (this.para[sj] === pa && TURKISH_RE.test(this.cleanedOf(sj))) return true;
    }
    return false;
  }

  /**
   * Decision 36a (language model), for a word holding a letter of a requested
   * language: a word with letters of two scripts or more (as written, its
   * neutrals as their letters) carries one category in place of
   * `mixed_script`. `mixed_spoof` when look-alikes were converted, or when it
   * still holds another requested language's letter with a twin in the word's
   * target (review 10: `pаypalя`; those letters are converted when the word's
   * target is clear: most of its target letters); `mixed_legitimate` when one
   * requested language's letters stand with scripts written without spaces (39);
   * `mixed_non_legitimate` otherwise. A word with no target letter gets none
   * (`外部リンク`).
   */
  private mixedCategory(
    result: TokenAnalysis,
    cleaned: string,
    replacement: string,
    resolved: WordResolution | null,
    plan: Plan | null,
    t: number,
    v: WordView,
    piecesCorrected = false,
  ): { result: TokenAnalysis; replacement: string; quiet?: boolean } {
    const signals = result.signals.filter((y) => y !== 'mixed_script' && !MIXED_CATEGORIES.has(y));
    const letters = (w: string) =>
      [...w].filter((ch) => LETTER_RE.test(ch) && !isInvisibleChar(ch));
    const converted =
      replacement !== cleaned &&
      (piecesCorrected || resolved?.folded === true || (plan !== null && plan.spoof));
    const scripts = [
      ...new Set([
        ...wordScripts(cleaned).scripts,
        // The word as written, and the letters its neutrals were converted to (its core).
        ...(plan ? wordScripts(plan.core).scripts : []),
      ]),
    ];
    const isTarget = (sc: string) => this.isTarget(sc);
    // A target letter as written, or in the output of a converted word (`ᎪᏢᏢꓡꓰ` →
    // `APPLE`, review 11): the categories only add, they never drop a fold or a flag.
    const target =
      scripts.some(isTarget) || (converted && wordScripts(replacement).scripts.some(isTarget));
    // A mixed word of look-alikes only, kept as written (`wholeScriptFold: 'off'`): still flagged.
    const kept =
      !target &&
      scripts.length >= 2 &&
      // Twins by base letter (NFC and NFD alike: `ë` as `e` + mark).
      letters(cleaned.normalize('NFD')).every((ch) =>
        TARGET_ALPHABETS.some((T) => this.o.model!.twinIn(ch, T) !== null),
      );
    if ((!target && !kept) || scripts.length < 2)
      return { result: { ...result, signals }, replacement };
    let cat: SpoofSignal;
    const folded = converted && resolved?.folded === true;
    const plain0 = plainOf(plan, cleaned);
    // Lenient: phase 1 left the word's hidden characters in, and the token judge dropped them
    // (its replacement); the affix step reads the word with its invisible characters removed.
    const judged = (w: string) =>
      this.o.strict ? w : [...w].filter((c) => !isInvisibleChar(c)).join('');
    const plain = judged(plain0);
    // Decision 36c: with `affixSeparator`, the affix logic first; by default the whole-word
    // conversion first and the affix logic only for a word that is not converted whole.
    const sep = this.o.affixSeparator;
    // 36c: neutral characters inside a suffix are converted into the suffix's language
    // (`Facebook𝐨м` → `Facebookом`, `iPhone'ⓐх` → `iPhone'ах`); such a word takes the affix path.
    const pos = this.st[this.slot(t)]!;
    const nAff0 = kept ? null : this.suffixNeutrals(plan, plain0, this.dirOf(plain0, pos));
    const nAff = nAff0 === null ? null : judged(nAff0);
    const aff = nAff
      ? this.affixLogic(t, v, nAff, nAff, false, sep ?? null)
      : kept || (sep === undefined && folded)
        ? null
        : this.affixLogic(t, v, plain, replacement, folded, sep ?? null);
    if (aff && sep === '' && !aff.spoof && aff.out === cleaned && !signals.length)
      return { result, replacement: cleaned, quiet: true };
    if (aff) {
      replacement = aff.out;
      if (!aff.spoof && !(converted && !folded) && !aff.detected && !aff.glued)
        return { result: { ...result, signals, normalized: replacement }, replacement };
      cat =
        aff.spoof || (converted && !folded)
          ? 'mixed_spoof'
          : aff.detected
            ? 'mixed_non_legitimate'
            : legitimateMix(scripts)
              ? 'mixed_legitimate'
              : 'mixed_non_legitimate';
    } else if (folded || kept) cat = 'mixed_spoof';
    else {
      // Decision 36e: no whole-word conversion: detection, correction (one-letter twin
      // pieces) and reporting, also after the neutral characters converted.
      const r = this.mixedPieces(t, replacement, null);
      if (r.out !== replacement) {
        cat = 'mixed_spoof';
        replacement = r.out;
      } else if (converted) cat = 'mixed_spoof';
      else if (r.detected) cat = 'mixed_non_legitimate';
      // Scripts never glued (only across an apostrophe, a dash or a digit): no mixed word.
      else if (!r.glued) return { result: { ...result, signals }, replacement };
      else cat = legitimateMix(scripts) ? 'mixed_legitimate' : 'mixed_non_legitimate';
    }
    return {
      result: { ...result, signals: [cat, ...signals], normalized: replacement },
      replacement,
    };
  }

  /** Decision 41k: a nearest word of t is of the CJK language set. */
  private langSetNear(t: number, v: WordView): boolean {
    const { left, right } = this.nearest(t, v);
    const inSet = (k: number) => k >= 0 && LANG_SET.has(SCRIPT_LIST[k] as string);
    return inSet(left) || inSet(right);
  }

  /**
   * Decision 41b: whether the context of word t is the script `own`. The
   * nearest voting word on the left votes by its converted form; the nearest on
   * the right votes only when it needs no conversion (holds no donor), from the
   * words ahead the ring has read. Within the paragraph (decision 24).
   */
  private ownContext(t: number, own: number, v: WordView): boolean {
    // By script, deliberately: `own` is a donor's own writing outside the target languages
    // (Arabic, Devanagari, Bengali digits…), not a target language, so no language is mixed.
    const { left, right } = this.nearest(t, v);
    return left === own || right === own;
  }

  /**
   * The nearest words of word t (decision 41b; the ladder's step 1 too): the
   * nearest voting word on the left by its converted form, the nearest on the
   * right only when it needs no conversion, within the paragraph (decision 24)
   * and the ring. Script indices, -1 for no vote.
   */
  private nearest(t: number, v: WordView | null = null): { left: number; right: number } {
    // Decision 42b: a piece's nearest valid neighbours are its sibling pieces first.
    const sibL = v && v.piece ? v.sibL : -2;
    const sibR = v && v.piece ? v.sibR : -2;
    if (sibL !== -2 && sibR !== -2) return { left: sibL, right: sibR };
    const out = this.nearestOf(t);
    return { left: sibL !== -2 ? sibL : out.left, right: sibR !== -2 ? sibR : out.right };
  }

  private nearestOf(t: number): { left: number; right: number } {
    const { l, r } = this.nearestAt(t);
    return {
      left:
        l < 0
          ? -1
          : this.fin[this.slot(l)]! >= 0
            ? this.fin[this.slot(l)]!
            : this.voteOf(this.slot(l)).vote,
      right: r < 0 ? -1 : this.voteOf(this.slot(r)).vote,
    };
  }

  /** The nearest words of word t ({@link nearestOf}): their indices, -1 for none; `asWritten`: the right one also when it needs a conversion. */
  private nearestAt(t: number, asWritten = false): { l: number; r: number } {
    const s = this.slot(t);
    const pa = this.para[s]!;
    // Within the paragraph and ±majorityWindow words, in every mode: the ring always
    // holds them, so the reach does not depend on the text that follows (review 10).
    const reach = this.W;
    const lowest = Math.max(0, t - reach);
    let l = -1;
    for (let j = t - 1; j >= lowest; j--) {
      const sj = this.slot(j);
      if (this.para[sj] !== pa) break;
      const v = this.fin[sj]! >= 0 ? this.fin[sj]! : this.voteOf(sj).vote;
      if (v < 0) continue;
      l = j;
      break;
    }
    let r = -1;
    const highest = Math.min(this.nTok - 1, t + reach);
    for (let j = t + 1; j <= highest; j++) {
      const sj = this.slot(j);
      if (this.para[sj] !== pa) break;
      const w = this.voteOf(sj);
      if (w.converts && !asWritten) break;
      if (w.vote < 0) continue;
      r = j;
      break;
    }
    return { l, r };
  }

  // --- Decision 36c: chunks of one script, the word's language ---------------------

  /** Target languages of script `sc`, in `targetLanguages` order. */
  private langsOf(sc: string): TargetLanguage[] {
    return this.o.model!.targetLanguages.filter((n) => TARGET_LANGUAGES[n].script === sc);
  }

  /** Decision 42a: per character, the requested languages whose alphabet holds it (bit k: the k-th), built once per call. */
  private readonly masks = new Map<string, number>();
  private langMask(c: string): number {
    let m = this.masks.get(c);
    if (m === undefined) {
      m = 0;
      const b = baseLower(c);
      const ls = this.o.model!.targetLanguages;
      for (let k = 0; k < ls.length; k++)
        if (TARGET_LANGUAGES[ls[k]!].letters.includes(b)) m |= 1 << k;
      this.masks.set(c, m);
    }
    return m;
  }

  /** The requested languages of script `sc`, as {@link langMask} bits. */
  private scriptMask(sc: string): number {
    const ls = this.o.model!.targetLanguages;
    let m = 0;
    for (let k = 0; k < ls.length; k++) if (TARGET_LANGUAGES[ls[k]!].script === sc) m |= 1 << k;
    return m;
  }

  /** Requested language `n`'s alphabet holds `c`. */
  private holds(n: TargetLanguage, c: string): boolean {
    const k = this.o.model!.targetLanguages.indexOf(n);
    return k >= 0 && (this.langMask(c) & (1 << k)) !== 0;
  }

  /** Decision 36c: the word's chunks of one script; null when it holds a letter of a script written without spaces. */
  private chunksOf(cs: readonly string[], dir: number): Chunk[] | null {
    const chunks: Chunk[] = [];
    let cur: Chunk | null = null;
    let sep = '';
    // One splitter: 36e's reading, on-screen order with digits ignored.
    const order = dir >= 0 ? displayOrder(cs, dir === 1) : null;
    for (let q = 0; q < cs.length; q++) {
      const i = order ? order[q]! : q;
      const ch = cs[i]!;
      const f = cpFlags(ch.codePointAt(0)!);
      if (f & CP_MARK) {
        if (cur && sep === '') {
          cur.i0 = Math.min(cur.i0, i);
          cur.i1 = Math.max(cur.i1, i + 1);
        }
        continue;
      }
      const sc = f & CP_LETTER && !(f & CP_INVISIBLE) ? primaryScript(ch) : '';
      if (!sc || sc === 'Common' || sc === 'Inherited') {
        // Digits are ignored: letters on both sides of them touch (36e).
        if (!ANY_NUMBER_RE.test(ch)) sep += ch;
        continue;
      }
      if (isSpaceless(sc)) return null;
      if (cur && cur.sc === sc) {
        cur.i0 = Math.min(cur.i0, i);
        cur.i1 = Math.max(cur.i1, i + 1);
        sep = '';
        continue;
      }
      chunks.push((cur = { sc, i0: i, i1: i + 1, sep }));
      sep = '';
    }
    // Roles go by reading order: the first piece by its first stored letter, the last by its last.
    if (order) chunks.sort((x, y) => x.i0 - y.i0);
    return chunks;
  }

  /**
   * The direction a word's pieces are read in (36c/36e): -1 stored order (no right-to-left
   * letter, or RTL awareness off), 1 a right-to-left paragraph, 0 a left-to-right one.
   */
  private dirOf(word: string, pos: number): number {
    if (this.o.rtlAwareness === false || !RTL_CHAR_RE.test(word)) return -1;
    return this.rtlAt(pos) ? 1 : 0;
  }

  /** Decision 36e: a letter that converts to English `x` (`x`, `х`, `χ`, other donors of it). */
  private readonly xLike = new Map<string, boolean>();
  private isXLike(c: string): boolean {
    let r = this.xLike.get(c);
    if (r === undefined) {
      const cp = c.codePointAt(0)!;
      // `x`, a letter whose Latin twin is `x`, or a styled, fullwidth or math `x` (a neutral reading `x`).
      r =
        c === 'x' ||
        (LETTER_RE.test(c) && this.o.model!.twinIn(c, 'Latin') === 'x') ||
        this.nInfo(cp)?.base === 'x' ||
        // 30c: a subscript or modifier `x` (`ₓ`, `ˣ`) is never converted.
        (!/\p{Lm}/u.test(c) && c.normalize('NFKC') === 'x');
      this.xLike.set(c, r);
    }
    return r;
  }

  /** Decision 36e: per word whose `x` was written `×` (by start), its text as phase 1 output it. */
  private readonly xOrig = new Map<number, string>();

  /**
   * Decision 36e: `w` with each `x`-like letter between two numbers
   * written `×` (`300х300`, `1920x1080`, `1০x2০`), or null when it has none. Numbers are
   * runs of decimal digits and digit look-alikes. Blocked by a letter, dash or underscore
   * right before the first number, a dash or underscore right after the second, and a
   * first number that is a lone zero (a hex prefix: `0x1F`); the word starts at source `start`.
   */
  private timesOf(w: string, start: number): string | null {
    // A cheap gate: a digit-like character, an `x`-like one, a digit-like one, in a row.
    let gate = false;
    for (let i = 0, prev = false, mid = false; i < w.length && !gate;) {
      const cp = w.codePointAt(i)!;
      const c = cp < 0x80 ? w[i]! : String.fromCodePoint(cp);
      const digit = cp < 0x80 ? cp >= 0x30 && cp <= 0x39 : digitValue(c) >= 0;
      gate = mid && digit;
      mid = prev && (cp === 0x78 || (cp >= 0x80 && this.isXLike(c)));
      prev = digit;
      i += cp > 0xffff ? 2 : 1;
    }
    if (!gate) return null;
    const cs = [...w];
    let changed = false;
    for (let i = 1; i + 1 < cs.length; i++) {
      if (!this.isXLike(cs[i]!) || digitValue(cs[i - 1]!) < 0 || digitValue(cs[i + 1]!) < 0)
        continue;
      let j = i - 1;
      while (j > 0 && digitValue(cs[j - 1]!) >= 0) j--;
      if (i - j === 1 && digitValue(cs[j]!) === 0) continue;
      // The edges as the reader sees them: kept invisible characters are skipped.
      let jb = j - 1;
      while (jb >= 0 && isInvisibleChar(cs[jb]!)) jb--;
      const b = jb >= 0 ? cs[jb]! : this.charBeforeToken(start);
      // An `x` already written `×` is no letter (`1x1x1`).
      if (
        b !== '\u00d7' &&
        (DASH_OR_LOW_LINE_RE.test(b) || (b !== '' && this.letterLike(b.codePointAt(0)!)))
      )
        continue;
      let k = i + 1;
      while (k < cs.length && digitValue(cs[k]!) >= 0) k++;
      while (k < cs.length && isInvisibleChar(cs[k]!)) k++;
      const after =
        k < cs.length ? cs[k]! : this.tNext >= 0 ? String.fromCodePoint(this.tNext) : '';
      if (DASH_OR_LOW_LINE_RE.test(after)) continue;
      cs[i] = '\u00d7';
      changed = true;
    }
    return changed ? cs.join('') : null;
  }

  /** The character before the closing token as phase 1 output it (its gap, else the source). */
  private charBeforeToken(start: number): string {
    if (this.gTxt !== null && this.gTxt !== '') return lastCharOf(this.gTxt);
    const p = this.gR0 >= 0 ? this.gR1 : start;
    return p > 0 ? lastCharOf(this.src.slice(Math.max(0, p - 2), p)) : '';
  }

  /**
   * Decision 14: the language of a word converted without the ladder, whose converted letters
   * are of script `A` (a letter fact): the first requested language, in request order, whose
   * letters hold every letter of `A` in `out`. A language is never derived from a script: no
   * requested language holding the output (an unrequested language's letters, letters no
   * language has), the Latin-fold model (no languages) and an output with no letter of `A`
   * (digits, 41l) give none.
   */
  private languageOf(A: string | null, out: string): TargetLanguage | null {
    if (A === null || !this.o.model) return null;
    const ls = [...composeListed(out)].filter((c) => LETTER_RE.test(c) && primaryScript(c) === A);
    if (!ls.length) return null;
    return (
      this.o.model.targetLanguages.find(
        (n) => TARGET_LANGUAGES[n].script === A && ls.every((c) => this.holds(n, c)),
      ) ?? null
    );
  }

  private ownLanguages(w: string): TargetLanguage[] {
    const ls = [...composeListed(w)].filter((c) => LETTER_RE.test(c));
    if (!ls.length) return [];
    const sc = primaryScript(ls[0]!) as string;
    if (!ls.every((c) => primaryScript(c) === sc)) return [];
    return this.langsOf(sc).filter((n) => ls.every((c) => this.holds(n, c)));
  }

  /**
   * Decision 41o: a nearest word of t on either side (within the paragraph; words without a
   * letter, such as numbers, skipped) is a clean word of a language holding every letter of
   * `w`: written wholly in that language's letters, and taken whole by no other requested
   * alphabet (its clean vote is its own script).
   */
  private cleanNeighbour(t: number, w: string): boolean {
    const own = this.ownLanguages(w);
    if (!own.length) return false;
    const sc = primaryScript([...w].find((c) => LETTER_RE.test(c))!) as string;
    const S = CONFUSION_ALPHABETS.indexOf(sc as ConfusionAlphabet);
    const pa = this.para[this.slot(t)]!;
    const lowest = this.bounded ? Math.max(0, this.nTok - this.cap) : 0;
    for (const step of [-1, 1]) {
      for (let j = t + step; j >= lowest && j < this.nTok && Math.abs(j - t) <= this.W; j += step) {
        const sj = this.slot(j);
        if (this.para[sj] !== pa) break;
        // Letters a reference encodes are skipped (41o): a word of references only is no word.
        const text = this.withoutRefs(this.st[sj]!, this.cleanedOf(sj));
        if (!hasLetter(text)) continue;
        if (this.cS[sj] === S && this.ownLanguages(text).some((n) => own.includes(n))) return true;
        break;
      }
    }
    return false;
  }

  /**
   * Decision 36e (ordering B): a dash part of `w` holds letters of two or more requested
   * LANGUAGES — no one requested language has all its requested-language letters (Russian
   * and Ukrainian count as two: per-language rule).
   */
  private twoRequested(w: string): boolean {
    for (const part of composeListed(w).split(PART_SEP_RE)) {
      let and = -1;
      for (const c of part) {
        if (!LETTER_RE.test(c)) continue;
        // A letter of a requested language (a donor of another language is none).
        const m = this.langMask(c);
        if (!m) continue;
        and &= m;
        if (and === 0) return true;
      }
    }
    return false;
  }

  /** The last paragraph looked up: [start, end) and its direction (UAX #9 P1–P3). */
  private paraS = -1;
  private paraE = -1;
  private paraRtl = false;

  /**
   * Whether the paragraph holding source position `pos` is right to left: its first
   * strong character (P2, isolates skipped). A paragraph ends at CR, LF, U+2029, NEL and
   * FS/GS/RS (UAX #9 class B), and at VT and FF, which phase 1 writes as a line feed
   * (decision 42d); one lookup per paragraph.
   */
  private rtlAt(pos: number): boolean {
    if (pos >= this.paraS && pos < this.paraE) return this.paraRtl;
    const src = this.src;
    const ends = (u: number) => isParaSep(u) || u === 0x0b || u === 0x0c;
    let s = pos;
    while (s > 0 && !ends(src.charCodeAt(s - 1))) s--;
    let e = pos;
    while (e < src.length && !ends(src.charCodeAt(e))) e++;
    this.paraS = s;
    this.paraE = Math.max(e, pos + 1);
    this.paraRtl = firstStrongRtl(src, s, e);
    return this.paraRtl;
  }

  /**
   * A letter's twin in alphabet `Y` in a requested language of `Y` (decisions 36e,
   * 40d), or null; a precomposed letter by its base, its marks kept (36f: `ó` → `о́`).
   */
  private twinOf(c: string, Y: string, mask: number): string | null {
    // Per-language rule: a twin among one language's letters, a language (request-order
    // bits `mask`) the other side is written in.
    const langs = this.o.model!.languages;
    const one = (x: string) => {
      for (let k = 0; k < langs.length; k++) {
        if (!(mask & (1 << k))) continue;
        const y = this.o.model!.twinInLang(x, langs[k]!.bit);
        if (y !== null && primaryScript(y) === Y) return y;
      }
      return null;
    };
    const y = one(c);
    if (y !== null) return y;
    const d = c.normalize('NFD');
    if (d === c) return null;
    // A singleton decomposition (U+1FBE → ι) is the letter itself.
    const b = [...d][0]!;
    const yb = one(b);
    return yb !== null ? yb + d.slice(b.length) : null;
  }

  /**
   * Decision 36e: detection, correction and reporting of a mixed word (`word`, its
   * neutral characters converted; one entry per code point). Pieces are adjacent
   * letters of one alphabet in display order (UAX #9, the paragraph's direction); a
   * border is two pieces adjacent on screen with no character between them. The word
   * is detected when a border letter has a twin in a requested language written in the
   * other side's alphabet (either side). Correction: a one-letter piece (marks aside)
   * that is not the last on screen (with `hostileInput` the last too), or a piece of any
   * length between two pieces, every letter of which has a twin in a glued neighbour's
   * requested language holding more of the word's letters, takes those twins
   * (`Cпросите` → `Спросите`, `gооgle` → `google`). `keep`: positions never
   * converted (real affixes). `out` in stored order.
   */
  private mixedPieces(
    t: number,
    word: string,
    keep: ReadonlySet<number> | null,
  ): { detected: boolean; glued: boolean; out: string; slots: string[] } {
    const cs = [...word];
    // Clusters: a letter (or other character) with its marks.
    const base: number[] = [];
    for (let i = 0; i < cs.length; i++)
      if (!(cpFlags(cs[i]!.codePointAt(0)!) & CP_MARK) || !base.length) base.push(i);
    const alpha = (i: number): string | null => {
      const c = cs[i]!;
      if (!(cpFlags(c.codePointAt(0)!) & CP_LETTER) || isInvisibleChar(c)) return null;
      const sc = primaryScript(c) as string;
      return sc === 'Common' || sc === 'Inherited' ? null : sc;
    };
    // Display order of the clusters (only a word with a right-to-left character needs it).
    let vis = base;
    const pos = this.st[this.slot(t)]!;
    if (this.o.rtlAwareness !== false && RTL_CHAR_RE.test(word)) {
      const ord = displayOrder(cs, this.rtlAt(pos));
      vis = ord.filter((i) => base.includes(i));
    }
    type P = { a: string; idx: number[]; glued: boolean; m: number };
    const pieces: P[] = [];
    let gap = false;
    for (const i of vis) {
      const a = alpha(i);
      if (a === null) {
        // Digits are ignored: letters on both sides of them touch.
        if (!/\p{N}/u.test(cs[i]!)) gap = true;
        continue;
      }
      const cur = pieces[pieces.length - 1];
      if (cur && cur.a === a) {
        cur.idx.push(i);
        gap = false;
        continue;
      }
      pieces.push({ a, idx: [i], glued: cur !== undefined && !gap, m: -1 });
      gap = false;
    }
    // Each side's languages: the requested languages holding all the word's requested-language
    // letters of that piece's alphabet (`мыiр`: `р` is Russian here, as `ы` is; per-language rule).
    const sideMask = new Map<string, number>();
    for (const p of pieces) {
      let m = sideMask.get(p.a) ?? -1;
      for (const i of p.idx) {
        const k = this.langMask(withMarks(cs, i));
        if (k) m &= k;
      }
      sideMask.set(p.a, m);
    }
    for (const p of pieces) p.m = Math.max(0, sideMask.get(p.a)!);
    const glued = pieces.some((p) => p.glued);
    if (pieces.length < 2) return { detected: false, glued, out: word, slots: cs };
    // Detection: a glued border with a twin letter, checked both ways.
    let detected = false;
    for (let k = 1; k < pieces.length && !detected; k++) {
      const P0 = pieces[k - 1]!;
      const Q = pieces[k]!;
      if (!Q.glued) continue;
      if (
        this.twinOf(cs[P0.idx[P0.idx.length - 1]!]!, Q.a, Q.m) !== null ||
        this.twinOf(cs[Q.idx[0]!]!, P0.a, P0.m) !== null
      )
        detected = true;
    }
    if (!detected) return { detected: false, glued, out: word, slots: cs };
    const count = new Map<string, number>();
    for (const p of pieces) count.set(p.a, (count.get(p.a) ?? 0) + p.idx.length);
    const out = cs.slice();
    const n = pieces.length;
    // The last piece in the word's own reading order: the one holding its last letter as stored
    // (UAX #9: logical order is reading order; a word with no right-to-left letter: the rightmost).
    let lastK = 0;
    for (let k = 1; k < n; k++)
      if (Math.max(...pieces[k]!.idx) > Math.max(...pieces[lastK]!.idx)) lastK = k;
    for (let k = 0; k < n; k++) {
      const p = pieces[k]!;
      const between = k > 0 && k < n - 1;
      // A one-letter piece unless last (hostile input: last too); a longer one only between two
      // pieces (`gооgle` → `google`).
      if (p.idx.length === 1 ? k === lastK && !this.o.hostileInput : !between) continue;
      if (p.idx.some((i) => keep?.has(i))) continue;
      const nb: P[] = [];
      if (k > 0 && p.glued) nb.push(pieces[k - 1]!);
      if (k < n - 1 && pieces[k + 1]!.glued) nb.push(pieces[k + 1]!);
      const cands = nb
        .filter((q) => q.a !== p.a && this.isTarget(q.a) && count.get(q.a)! > count.get(p.a)!)
        .sort((a, b) => count.get(b.a)! - count.get(a.a)!);
      for (const q of cands) {
        const ys = p.idx.map((i) => this.twinOf(cs[i]!, q.a, q.m));
        if (ys.some((y) => y === null)) continue;
        // Each letter with its marks, composed where Unicode composes them (`а́` → `á`).
        p.idx.forEach((i, q) => {
          let e = i + 1;
          while (e < cs.length && cpFlags(cs[e]!.codePointAt(0)!) & CP_MARK) e++;
          out[i] = (ys[q]! + cs.slice(i + 1, e).join('')).normalize('NFC');
          for (let m = i + 1; m < e; m++) out[m] = '';
        });
        break;
      }
    }
    return { detected: true, glued, out: out.join(''), slots: out };
  }

  /**
   * Decision 36c: the word's plain text with the neutral characters of its trailing run read
   * in that run's script, when that makes the run a real suffix; null otherwise.
   */
  private suffixNeutrals(plan: Plan | null, plain: string, dir: number): string | null {
    if (!plan || plan.chars.length !== [...plain].length) return null;
    const cs = [...plain];
    const neu = (i: number) =>
      (plan.cls[i] === C_CONV || plan.cls[i] === C_FOLLOW) && plan.infos[i] !== null;
    let X: string | null = null;
    let j = cs.length - 1;
    let nNeu = 0;
    for (; j >= 0; j--) {
      const c = cs[j]!;
      if (cpFlags(c.codePointAt(0)!) & CP_MARK) continue;
      if (neu(j)) {
        nNeu++;
        continue;
      }
      if (!LETTER_RE.test(c)) break;
      const sc = primaryScript(c);
      if (X === null) X = sc;
      else if (sc !== X) break;
    }
    if (!nNeu || X === null || !this.isTarget(X)) return null;
    // Per-language rule: the run's language (its letters'), the first taking every neutral.
    const run = cs.slice(j + 1).filter((c, q) => !neu(j + 1 + q));
    const lang = this.wordLang(X, run.join(''), (n) =>
      cs.every((c, i) => i <= j || !neu(i) || this.twinL(c, n) !== null),
    );
    if (lang === null) return null;
    const out = cs.slice();
    for (let i = j + 1; i < cs.length; i++) {
      if (!neu(i)) continue;
      const y = this.twinL(cs[i]!, lang);
      if (y === null) return null;
      out[i] = y;
    }
    const chunks = this.chunksOf(out, dir);
    if (!chunks || chunks.length < 2) return null;
    const lettersOf = (k: Chunk) => clusterLetters(out, k.i0, k.i1);
    const a = this.affixesOf(out, chunks, lettersOf);
    let fn = j + 1;
    while (!neu(fn)) fn++;
    return a?.suf && a.suf.i0 <= fn ? out.join('') : null;
  }

  private readonly dashCache = new Map<string, DashLayout>();
  /** Whether a token's letters are of mixed scripts, per token text (repeated words). */
  private readonly mixedCache = new Map<string, boolean>();

  /**
   * Decision 42/36c: a dash token's parts. Affixes come first (36c):
   * a dash-separated real affix is kept like an apostrophe-separated one. In a token of
   * several scripts, each non-affix part votes as its own word in the neighbours' window
   * (`GPS-прибора` votes Russian). Cached per token text.
   */
  private dashLayout(tok: string, pos: number): DashLayout {
    const dir = this.dirOf(tok, pos);
    const key = dir < 0 ? tok : (dir ? 'R\u0000' : 'L\u0000') + tok;
    const hit = this.dashCache.get(key);
    if (hit) return hit;
    const cs = [...tok];
    const chunks = this.chunksOf(cs, dir);
    const multi = chunks !== null && new Set(chunks.map((k) => k.sc)).size > 1;
    const lettersOf = (k: Chunk) => clusterLetters(cs, k.i0, k.i1);
    const aff = multi ? this.affixesOf(cs, chunks, lettersOf) : null;
    const parts: DashPart[] = [];
    const win: number[] | null = multi ? [] : null;
    let i0 = 0;
    let u0 = 0;
    let u = 0;
    for (let i = 0; i <= cs.length; i++) {
      if (i < cs.length && !PART_SEP_RE.test(cs[i]!)) {
        u += cs[i]!.length;
        continue;
      }
      const inAffix = (k: Chunk | null) => k !== null && i0 >= k.i0 && i <= k.i1;
      const suffix = aff !== null && i > i0 && inAffix(aff.suf);
      const affix = suffix || (aff !== null && i > i0 && inAffix(aff.pre));
      const text = tok.slice(u0, u);
      const langs = this.partLanguages(text);
      parts.push({
        a: u0,
        b: u,
        affix,
        suffix,
        langs,
        // 30b.8: a `μ` unit part is kept (`μs-pulse`).
        safe: muUnit(text) || (langs.length > 0 && this.partSafe(text, langs)),
      });
      if (win && i > i0 && !affix) {
        this.cls!.classify(text, 0, text.length);
        if (this.cls!.cleanL) win.push(this.cls!.cleanL, this.cls!.cleanN);
      }
      u += 1;
      u0 = u;
      i0 = i + 1;
    }
    // 36c: a one-letter part at the start or end whose letter has a twin in the other part's
    // language is part of the word unless its language's setting is on (default off for every
    // language): grouped with that part (`Р-aypal`, `plan-В` convert).
    const lp = parts.filter((p) => p.b > p.a);
    for (const [e, nb, isPrefix] of lp.length > 1
      ? ([
          [lp[0]!, lp[1]!, true],
          [lp[lp.length - 1]!, lp[lp.length - 2]!, false],
        ] as const)
      : []) {
      // The part is one letter (its marks aside): `128K-` is no one-letter part.
      const cs = [...tok.slice(e.a, e.b)].filter((c) => !(cpFlags(c.codePointAt(0)!) & CP_MARK));
      const ls = cs.filter((c) => LETTER_RE.test(c));
      if (ls.length !== 1 || cs.length !== 1 || e.suffix) continue;
      // A letter of no requested language is an affix of none: part of the word when its script
      // is a model alphabet (`Ρ-hysical` with English and Russian); a pack donor of another
      // writing (`ו-iTunes`) is judged alone by its outside context.
      if (!e.langs.length && this.kindOf(ls[0]!.codePointAt(0)!) === KIND_DONOR) continue;
      // The setting covers prefixes only; an end part counts only on a suffix list.
      if (isPrefix && e.langs.some((n) => this.o.oneLetterDashAffix?.includes(n))) continue;
      const twinLangs = nb.langs.filter((n) => {
        const { script } = TARGET_LANGUAGES[n];
        if (script === primaryScript(ls[0]!)) return false;
        // Per-language rule: a twin among n's own letters.
        return this.twinL(ls[0]!, n) !== null;
      });
      if (twinLangs.length) {
        e.langs = twinLangs;
        e.safe = false;
        // Read in the suffix's language, the part is no body of another language: no affix
        // (`В-est` is `Best`, a spoof).
        if (nb.suffix) nb.suffix = nb.affix = false;
      }
    }
    // Parts of one language are judged together as one word, of different languages apart
    //; a kept suffix is never grouped.
    const groups: {
      a: number;
      b: number;
      langs: TargetLanguage[];
      keep: boolean;
      safe: boolean;
    }[] = [];
    for (const p of parts) {
      const g = groups[groups.length - 1];
      const shared = g && !g.keep && !p.suffix ? g.langs.filter((n) => p.langs.includes(n)) : [];
      if (g && shared.length) {
        g.b = p.b;
        g.langs = shared;
        g.safe &&= p.safe;
      } else groups.push({ a: p.a, b: p.b, langs: p.langs, keep: p.suffix, safe: p.safe });
    }
    const quiet = groups.every((g) => g.keep || g.safe || g.b === g.a);
    let pieces: Piece[] | null = null;
    if (groups.length > 1) {
      pieces = [];
      for (let k = 0; k < groups.length; k++) {
        const g = groups[k]!;
        if (g.b > g.a) pieces.push({ a: g.a, b: g.b, keep: g.keep || g.safe });
        if (k + 1 < groups.length) pieces.push({ a: g.b, b: g.b + 1 });
      }
    }
    const out = { parts, win, pieces, quiet };
    if (this.dashCache.size >= 4096) this.dashCache.clear();
    this.dashCache.set(key, out);
    return out;
  }

  /**
   * A clean part with nothing to judge: letters only, no other requested language can take
   * it (native or by twins), and its last letter is no I-shaped one (case anomaly, §4.6).
   */
  private partSafe(text: string, langs: readonly TargetLanguage[]): boolean {
    const model = this.o.model!;
    const ls: string[] = [];
    for (const ch of composeListed(text)) {
      if (cpFlags(ch.codePointAt(0)!) & CP_MARK) continue;
      if (!LETTER_RE.test(ch)) return false;
      ls.push(ch);
    }
    if (/[Il|ıіӀӏ1]/u.test(ls[ls.length - 1] ?? '')) return false;
    return model.targetLanguages.every((m) => {
      if (langs.includes(m)) return true;
      const { script } = TARGET_LANGUAGES[m];
      return !ls.every((c) => {
        if (primaryScript(c) === script) return this.holds(m, c);
        // Per-language rule: a twin among m's own letters.
        return this.twinL(c, m) !== null;
      });
    });
  }

  /** The requested languages holding every letter of `text` (none: a part of no one language). */
  private partLanguages(text: string): TargetLanguage[] {
    const ls: string[] = [];
    for (const ch of composeListed(text)) {
      const cp = ch.codePointAt(0)!;
      if (cpFlags(cp) & CP_MARK) continue;
      if (isDigitLookalike(cp)) return [];
      if (LETTER_RE.test(ch)) ls.push(ch);
    }
    if (!ls.length) return [];
    return this.o.model!.targetLanguages.filter((n) => ls.every((c) => this.holds(n, c)));
  }

  /**
   * Decision 36c's affixes: an affix is written in
   * one script, all its letters in one requested language of it (its letters may
   * have twins elsewhere: `IP-`, `HTTP-`, `α-`); a suffix is the last chunk, on the
   * grammar list of that language; a prefix stands first, shorter than the body,
   * the word holding at most one dash besides the suffix's and the prefix ending on
   * it. An affix counts only when no language of it holds the whole body too (all
   * parts of one language: no affix, `Wi-Fi`, `кое-кто`).
   */
  private affixesOf(
    cs: readonly string[],
    chunks: readonly Chunk[],
    lettersOf: (k: Chunk) => string[],
  ): { pre: Chunk | null; suf: Chunk | null; langs: Set<TargetLanguage> } | null {
    if (chunks.length < 2) return null;
    const langsHolding = (ls: readonly string[], sc: string) =>
      this.langsOf(sc).filter((n) => ls.every((c) => this.holds(n, c)));
    const lastK = chunks[chunks.length - 1]!;
    const sufText = lettersOf(lastK).join('').normalize('NFC').toLowerCase();
    const sufLangs = langsHolding(lettersOf(lastK), lastK.sc).filter(
      (n) => CHUNK_SUFFIXES[n]?.has(sufText) === true,
    );
    let suf: Chunk | null = sufLangs.length ? lastK : null;
    // A one-letter suffix with a twin in the body's language needs a dash or an apostrophe
    // before it (`iPhone'а`; glued `Applе` is none).
    if (suf && lettersOf(suf).length === 1 && !PART_SEP_RE.test(suf.sep)) {
      const prev = chunks[chunks.length - 2]!;
      // Per-language rule: a twin in a language the body is written in.
      const c = lettersOf(suf)[0]!;
      const prevLs = lettersOf(prev).filter((x) => LETTER_RE.test(x));
      if (langsHolding(prevLs, prev.sc).some((n) => this.twinL(c, n) !== null)) suf = null;
    }
    const firstK = chunks[0]!;
    let preLangs: TargetLanguage[] = [];
    let pre: Chunk | null = null;
    if (firstK !== suf && firstK.sep === '') {
      preLangs = langsHolding(lettersOf(firstK), firstK.sc);
      if (preLangs.length) pre = firstK;
    }
    if (pre) {
      const end = suf ? suf.i0 - suf.sep.length : cs.length;
      const rest = cs.slice(0, end);
      const dashes = rest.filter((c) => c === '-' || c === '\u2010' || c === '\u2011').length;
      const body = rest.slice(pre.i1).filter((c) => LETTER_RE.test(c)).length;
      // No prefix lists exist: a prefix applies only when a dash sets it off (36c).
      if (dashes !== 1 || !/[-\u2010\u2011]/.test(chunks[1]!.sep) || lettersOf(pre).length >= body)
        pre = null;
    }
    // 36c setting: a one-letter prefix with a twin in the body's language is an affix only
    // with its language's setting on (default off), in every mode.
    if (
      pre &&
      cs.slice(pre.i0, pre.i1).filter((c) => !(cpFlags(c.codePointAt(0)!) & CP_MARK)).length === 1
    ) {
      const c = lettersOf(pre)[0]!;
      const body = chunks[1]!;
      // Per-language rule: a twin in a language the body is written in.
      if (
        langsHolding(
          lettersOf(body).filter((x) => LETTER_RE.test(x)),
          body.sc,
        ).some((n) => this.twinL(c, n) !== null) &&
        !preLangs.some((n) => this.o.oneLetterDashAffix?.includes(n))
      )
        pre = null;
    }
    // The body: what the affixes leave; an affix of a language that holds the body too is none.
    const bodyLetters = chunks.filter((k) => k !== pre && k !== suf).flatMap(lettersOf);
    if (!bodyLetters.length) return null;
    // The affix is of another language than the body: that language does not hold the whole
    // body (a look-alike in the body does not make it the affix's language: `рhysicalя`).
    const sameLanguage = (n: TargetLanguage) =>
      bodyLetters.every((c) => isDigitLookalike(c.codePointAt(0)!) || this.holds(n, c));
    if (suf && sufLangs.some(sameLanguage)) suf = null;
    if (pre && preLangs.some(sameLanguage)) pre = null;
    if (!pre && !suf) return null;
    return { pre, suf, langs: new Set([...(suf ? sufLangs : []), ...(pre ? preLangs : [])]) };
  }

  /**
   * Decision 36c's affix logic: the affixes stay as written (their neutral
   * characters converted; `sep`, with `affixSeparator`, inserted after an
   * unseparated prefix and before an unseparated suffix). The body: when exactly
   * one requested language other than the affixes' can take it, it is written in
   * that language; otherwise it follows the normal ladder (`rs`: the fold, when
   * `folded`; else the chunk rule). Null when the word has no affix.
   */
  private affixLogic(
    t: number,
    v: WordView,
    plain: string,
    rs: string,
    folded: boolean,
    sep: string | null,
  ): { out: string; spoof: boolean; detected: boolean; glued: boolean } | null {
    const cs = [...plain];
    const chunks = this.chunksOf(cs, this.dirOf(plain, this.st[this.slot(t)]!));
    if (!chunks || new Set(chunks.map((k) => k.sc)).size < 2) return null;
    // A word 36e corrects into one language has no affix (`ударéние` → `ударе́ние`).
    if (!folded) {
      const sc = new Set(
        [...this.mixedPieces(t, plain, null).out]
          .filter((c) => LETTER_RE.test(c))
          .map((c) => primaryScript(c) as string),
      );
      if (sc.size < 2) return null;
    }
    const lettersOf = (k: Chunk) => clusterLetters(cs, k.i0, k.i1);
    const a = this.affixesOf(cs, chunks, lettersOf);
    if (!a) return null;
    const { pre, suf } = a;
    const inAffix = (i: number) =>
      (pre !== null && i >= pre.i0 && i < pre.i1) || (suf !== null && i >= suf.i0 && i < suf.i1);
    // The body: the fold when the word was converted whole, else 36e's correction (the
    // affixes kept).
    let bodyOut: string[];
    let detected = false;
    let glued = true;
    if (folded && [...rs].length === cs.length) bodyOut = [...rs];
    else {
      const keep = new Set<number>();
      for (let i = 0; i < cs.length; i++) if (inAffix(i)) keep.add(i);
      const r = this.mixedPieces(t, plain, keep);
      detected = r.detected;
      glued = r.glued;
      bodyOut = r.slots;
    }
    let out = '';
    let spoof = false;
    for (let i = 0; i < cs.length; i++) {
      if (sep !== null && suf && i === suf.i0 && suf.sep === '') out += sep;
      const ch = inAffix(i) ? cs[i]! : bodyOut[i]!;
      if (ch !== cs[i]) spoof = true;
      out += ch;
      if (sep !== null && pre && i === pre.i1 - 1 && chunks[1]!.sep === '') out += sep;
    }
    return { out, spoof, detected, glued };
  }

  /**
   * Each donor letter of a one-script word (a letter the model counts in another
   * alphabet than its script's: Latin extras `þ`) written as its twin in its
   * script's requested target; the rest as written.
   */
  private donorFold(w: string): string {
    const cs = [...w];
    const isDonor = (c: string, sc: string) => {
      const a = alphabetOfScript(SCRIPT_LIST.indexOf(sc as ScriptName));
      const k = this.kindOf(c.codePointAt(0)!);
      return a >= 0 && k >= 0 && k < KIND_NONE && k !== a && this.isTarget(sc);
    };
    // Per-language rule: per script, the language its own letters are (the first in request
    // order taking every donor of the script), its letters only.
    const langOf = new Map<string, TargetLanguage | null>();
    const lang = (sc: string) => {
      if (!langOf.has(sc)) {
        // Its own letters a requested language has (`ð` of `það` is none: no one language's word).
        const own = [...composeListed(w)].filter(
          (c) =>
            LETTER_RE.test(c) &&
            primaryScript(c) === sc &&
            !isDonor(c, sc) &&
            this.langsOf(sc).some((n) => this.holds(n, c)),
        );
        const donors = cs.filter(
          (c) => LETTER_RE.test(c) && primaryScript(c) === sc && isDonor(c, sc),
        );
        langOf.set(
          sc,
          this.wordLang(sc, own.join(''), (n) => donors.every((c) => this.twinL(c, n) !== null)),
        );
      }
      return langOf.get(sc)!;
    };
    let out = '';
    for (const c of cs) {
      const sc = LETTER_RE.test(c) ? primaryScript(c) : '';
      const n = sc && isDonor(c, sc) ? lang(sc) : null;
      out += n ? (this.twinL(c, n) ?? c) : c;
    }
    return out;
  }

  /**
   * Decision 41f: each multi-target digit look-alike of the plan, written as
   * its word's target takes it — left to the resolver when its fold covers it,
   * else the context's alphabet when it has a row there, else the digit.
   */
  private altOf(
    t: number,
    p: Plan,
    resolved: WordResolution | null,
    v: WordView,
  ): Map<number, string> | null {
    const model = this.o.model!;
    let out: Map<number, string> | null = null;
    let ctx: number | undefined;
    // The word's script: its fold's, else the one alphabet of its core letters (its language: next line).
    const own = resolved?.folded ? this.targetOf(p.core, resolved) : this.targetOf(p.core, null);
    // Per-language rule: the word's language (its fold's, else its letters').
    const ownLang = own
      ? ((resolved?.folded ? resolved.language : null) ?? this.wordLang(own, p.core))
      : null;
    for (const i of p.alt!) {
      const ch = p.chars[i]!;
      let twin = ownLang ? this.twinL(ch, ownLang) : null;
      if (!twin && !own) {
        // No letter decides (a lone `Ϭ`): the context's language (never another of its script).
        if (ctx === undefined) {
          const c = this.contextOf(t, v);
          const near = model.languages.find((l) => c.near & (1 << l.bit));
          ctx = near ? near.bit : c.window;
        }
        twin = ctx >= 0 ? model.twinInLang(ch, ctx) : null;
      }
      (out ??= new Map()).set(i, twin ?? DIGIT_OF.get(ch.codePointAt(0)!)!);
    }
    return out;
  }

  /** Decision 41b for digit look-alikes: per position, whether one stays as written. */
  private digitStay(t: number, p: Plan, v: WordView): Uint8Array | null {
    const { chars, cls, infos } = p;
    const isDigit = (i: number) => cls[i] === C_CONV && !infos[i];
    // Among target characters (a target letter, an ASCII digit) it converts.
    for (let i = 0; i < chars.length; i++)
      if (!isDigit(i) && this.targetChar(chars[i]!, true)) return null;
    let out: Uint8Array | null = null;
    for (let i = 0; i < chars.length; i++) {
      if (!isDigit(i)) continue;
      const own = ownScriptOf(chars[i]!.codePointAt(0)!);
      // (Another character of its own script in the word: kept by the plan already.)
      const stay = this.ownContext(t, own, v);
      if (stay) (out ??= new Uint8Array(chars.length))[i] = 1;
    }
    return out;
  }

  /** The judge's view of word t's slot (reused: one judgement at a time). */
  private readonly sv: WordView = {
    fl: 0,
    x: 0,
    pend: null,
    tx: null,
    full: null,
    a: 0,
    b: 0,
    pn: null,
    inM: 0,
    sibL: -2,
    sibR: -2,
    win: null,
    piece: false,
    fin: -1,
    finL: 0,
  };

  /** The view's judged text. */
  private vTx(v: WordView): string {
    return v.tx ?? v.full ?? this.src.slice(v.a, v.b);
  }

  /** The view's word as phase 1 output it. */
  private vFull(v: WordView): string {
    return v.full ?? this.src.slice(v.a, v.b);
  }

  private slotView(s: number): WordView {
    const v = this.sv;
    v.fl = this.fl[s]!;
    v.x = this.fx[s]!;
    v.pend = this.pend[s] ?? null;
    v.full = this.full[s] ?? null;
    v.tx = this.tx[s] ?? null;
    v.a = this.st[s]!;
    v.b = this.en[s]!;
    v.pn = this.pn[s] ?? null;
    v.inM = this.inM[s]!;
    v.fin = -1;
    v.finL = 0;
    return v;
  }

  /** Judges word t: a plain word by the fast lane, any other by {@link judgeFull}. */
  private judge(t: number): void {
    const s = this.slot(t);
    if (this.fl[s]! & F_PLAIN) {
      // The fast lane (closeToken): what the full judge gives such a word, its early stop included.
      if (this.o.signal?.aborted) this.stopped = true;
      else this.o.counted?.((this.fl[s]! & F_LETTER) !== 0, null);
    } else this.judgeFull(t, s);
    if (this.o.onTokenState) this.o.onTokenState(t, this.tokenState(t, s));
  }

  /** Test only: word t's ring state ({@link TokenState}). */
  private tokenState(t: number, s: number): TokenState {
    const more = this.more.get(s);
    const cachedVote = this.vot[s]!;
    return {
      fastLane: (this.fl[s]! & F_PLAIN) !== 0,
      start: this.st[s]!,
      end: this.en[s]!,
      flags: this.fl[s]! & ~F_PLAIN,
      classFlags: this.fx[s]!,
      pending: this.pend[s] !== null,
      cleanScript: this.cS[s]!,
      cleanLetters: this.cN[s]!,
      inModel: this.inM[s]!,
      paragraph: this.para[s]!,
      dash: this.dsh[s]!,
      plain: this.pl[s]!,
      slowVote: this.slowVote[s]!,
      counts: [
        this.sA[s]!,
        this.nA[s]!,
        this.sB[s]!,
        this.nB[s]!,
        ...(more ? [...more].flat() : []),
      ],
      cachedVote,
      vote: this.voteOf(s),
      folded: this.fin[s]!,
      finding: this.found[s] ?? null,
      windowSums: [...this.windowSums(t)],
      nearest: this.nearestOf(t),
    };
  }

  /**
   * Phases 2 and 3 (decisions 42a–42c). A token whose letters, mojibake
   * included, map into one target is one word (phase 2), judged whole. A token
   * phase 2 cannot map (a letter no target takes, or a mixed word holding a
   * mojibake span) is split at each spaced/spaceless script border
   * ({@link piecesOf}), each mojibake span read as the
   * text it encodes; each piece is judged with its nearest valid neighbours,
   * sibling pieces included, and the token is reported once ({@link judgePieces}).
   */
  private judgeFull(t: number, s: number): void {
    const v = this.slotView(s);
    if (!this.p3 || v.fl & F_TOOBIG || this.o.signal?.aborted) return this.judgeWhole(t, s, v);
    // Decision 30b.8: Greek `μ` directly before a unit of the unit list is a unit prefix, kept.
    if (this.dsh[s]! & 2) {
      const full = this.vFull(v);
      if (muUnit(full)) {
        this.o.counted?.(true, null);
        return;
      }
    }
    const moj = this.mjm.size ? (this.mjm.get(s) ?? null) : null;
    // An ASCII dash token is one language throughout (English): one word, judged whole.
    if (!moj && !(v.fl & F_ASCII) && this.dsh[s]! & 1) {
      // Decision 42 (corrected): the token is the unit of context and report only; each
      // dash-separated part is mapped as its own word, with context from outside the token.
      const full = this.vFull(v);
      // 36c F8: a lone styled part is part of the word: the token is
      // judged as its unstyled form, styled letters written as their letters.
      const plain = v.x & X_NEUTRAL ? this.unstyledDashToken(full) : null;
      const tok = plain ?? full;
      const { pieces, quiet } = this.dashLayout(tok, this.st[s]!);
      if (plain !== null)
        return this.judgePieces(
          t,
          s,
          plain,
          plain,
          null,
          null,
          quiet || !pieces ? [{ a: 0, b: plain.length }] : pieces,
          true,
          full,
        );
      if (quiet) {
        this.o.counted?.(hasLetter(full), null);
        return;
      }
      if (!pieces) return this.judgeWhole(t, s, v);
      return this.judgePieces(t, s, full, full, null, null, pieces, true);
    }
    if (!moj && !(v.x & X_FOREIGN)) return this.judgeWhole(t, s, v);
    const cleaned = this.vFull(v);
    if (!(v.x & X_FOREIGN)) {
      // Decision 42a: mojibake letters map with the word; a word that maps is one word.
      if (!v.pend || this.resolveAt(t, v)?.class !== 'mixed') return this.judgeWhole(t, s, v);
    } else if (!moj) {
      // Only a token with letters of both sides can be cut: a cheap scan first.
      let sides = 0;
      for (let q = 0; q < cleaned.length && sides !== 3;) {
        const cp = cleaned.codePointAt(q)!;
        sides |= sideOf(cp);
        q += cp > 0xffff ? 2 : 1;
      }
      if (sides !== 3) return this.judgeWhole(t, s, v);
    }
    // Decision 42b: each mojibake span read as the text it encodes.
    let sub = cleaned;
    let keep: number[] | null = null;
    if (moj) {
      sub = '';
      keep = [];
      let p = 0;
      for (let k = 0; k < moj.off.length; k += 2) {
        sub += cleaned.slice(p, moj.off[k]);
        keep.push(sub.length);
        sub += moj.dec[k >> 1]!;
        keep.push(sub.length);
        p = moj.off[k + 1]!;
      }
      sub += cleaned.slice(p);
    }
    const pieces = piecesOf(sub, keep);
    if (pieces.length < 2 && !moj) return this.judgeWhole(t, s, v);
    this.judgePieces(t, s, cleaned, sub, keep, moj, pieces);
  }

  private judgeWhole(t: number, s: number, v: WordView): void {
    const { f, count } = this.judgeWord(t, v);
    this.found[s] = f;
    if (count && !v.piece) this.o.counted?.(count[0], count[1]);
    if (v.fin >= 0) this.fin[s] = v.fin;
    if (v.finL) this.finL[s] = v.finL;
  }

  /**
   * 36c F8: the dash token with its styled letters (neutral `visibleStyle`) written as their
   * letters, when a part of it is a lone styled letter and another part holds a letter;
   * null otherwise (each part is then judged as written).
   */
  private unstyledDashToken(tok: string): string | null {
    if (!this.o.neutral) return null;
    // A lone styled part, and a letter in another part (another lone styled one too).
    let lone = 0;
    let other = false;
    for (const part of tok.split(PART_SEP_RE)) {
      const cs = [...part].filter((c) => !(cpFlags(c.codePointAt(0)!) & CP_MARK));
      if (cs.length === 1 && this.nInfo(cs[0]!.codePointAt(0)!)?.category === 'visibleStyle')
        lone++;
      else if (cs.some((c) => this.letterLike(c.codePointAt(0)!))) other = true;
    }
    if (!lone || (!other && lone < 2)) return null;
    let out = '';
    for (const c of tok) {
      const e = this.nInfo(c.codePointAt(0)!);
      out += e?.category === 'visibleStyle' && e.base !== '' ? e.base : c;
    }
    return out === tok ? null : out;
  }

  /** A word's finding that only writes it otherwise, with no signal (a conversion, 30b). */
  private conversionOnly(s: number, cleaned: string, replacement: string): LetterFinding {
    return {
      kind: 'word',
      start: this.st[s]!,
      end: this.en[s]!,
      cleaned,
      result: { signals: [], scripts: wordScripts(cleaned).scripts, normalized: replacement },
      resolved: null,
      replacement,
      to: null,
    };
  }

  /** A piece's view (decision 42b); `keep` [a, b, …]: its mojibake, kept as written. */
  private pieceView(w: string, keep: readonly number[] | null, fl: number): WordView {
    let ascii = true;
    for (let q = 0; q < w.length && ascii; q++) {
      const u = w.charCodeAt(q);
      const l = u | 0x20;
      if (!((l >= 0x61 && l <= 0x7a) || (u >= 0x30 && u <= 0x39) || u === 0x27)) ascii = false;
    }
    let pf = (fl & (F_HYPH | F_PARA)) | (ascii ? F_ASCII : 0) | (hasLetter(w) ? F_LETTER : 0);
    const plan = ascii ? null : this.split(w, keep);
    const core = plan ? plan.core : w;
    let pend: PendingWord | null = null;
    let inM = 0;
    if (this.cls) {
      this.cls.classify(core, 0, core.length);
      pend = this.cls.pending;
      inM = this.cls.inModel;
    }
    if (!ascii && wordScripts(core).mixed) pf |= F_MIXED;
    return {
      fl: pf,
      x: plan ? plan.x : 0,
      pend,
      tx: core,
      full: w,
      a: 0,
      b: 0,
      pn: plan,
      inM,
      sibL: -2,
      sibR: -2,
      win: null,
      piece: true,
      fin: -1,
      finL: 0,
    };
  }

  /**
   * Phase 3 (decisions 42b, 42c): each piece of `sub` (the token, its mojibake
   * spans read as the text they encode at `keep`) judged as a word, the
   * encoded text kept and written back as the span; the token is reported
   * once: its pieces' outputs joined, their signals merged, one 36a category.
   */
  private judgePieces(
    t: number,
    s: number,
    cleaned: string,
    sub: string,
    keep: number[] | null,
    moj: Moj | null,
    pieces: Piece[],
    dashParts = false,
    /** The token as written when `cleaned` is its unstyled form (36c F8). */
    written: string | null = null,
  ): void {
    const fl = this.fl[s]!;
    this.o.counted?.(hasLetter(written ?? cleaned), null);
    const n = pieces.length;
    // Per piece: its text, its keep ranges (local), its text as written (spans as in the token).
    const texts: string[] = new Array(n);
    const locals: (number[] | null)[] = new Array(n).fill(null);
    const views: (WordView | null)[] = new Array(n).fill(null);
    const votes = new Int16Array(n).fill(-1);
    const converts = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const p = pieces[i]!;
      const text = sub.slice(p.a, p.b);
      texts[i] = text;
      let loc: number[] | null = null;
      if (keep)
        for (let k = 0; k < keep.length; k += 2)
          if (keep[k]! >= p.a && keep[k + 1]! <= p.b)
            (loc ??= []).push(keep[k]! - p.a, keep[k + 1]! - p.a);
      locals[i] = loc;
      // A piece of spaceless letters outside the model only (no donor, no neutral) has nothing
      // to judge; nor has a dash between the parts of a token.
      let plain = loc === null && (!dashParts || this.hasLetterLike(text));
      if (dashParts && (!this.hasLetterLike(text) || p.keep)) {
        views[i] = null;
        continue;
      }
      for (let q = 0; q < text.length && plain;) {
        const cp = text.codePointAt(q)!;
        if (
          sideOf(cp) !== 2 ||
          this.kindOf(cp) !== KIND_NONE ||
          isDigitLookalike(cp) ||
          (this.o.neutral && this.nInfo(cp))
        )
          plain = false;
        q += cp > 0xffff ? 2 : 1;
      }
      const view = plain ? null : this.pieceView(text, loc, fl);
      views[i] = view;
      // Decision 42b: letters inside mojibake spans cast no vote.
      const r = this.voteOfText(loc ? withoutSpans(text, loc) : text, view);
      votes[i] = r.vote;
      converts[i] = r.converts ? 1 : 0;
    }
    // The span texts in order, and each piece's first one.
    const origs: string[] = [];
    if (moj)
      for (let k = 0; k < moj.off.length; k += 2)
        origs.push(cleaned.slice(moj.off[k], moj.off[k + 1]));
    let spanAt = 0;
    let replacement = '';
    let replLetters = '';
    const signals = new Set<SpoofSignal>();
    let spoofed = false;
    let converted = false;
    let first = null as LetterFinding | null;
    const fins = new Int16Array(n).fill(-1);
    for (let i = 0; i < n; i++) {
      const text = texts[i]!;
      const loc = locals[i];
      const nSpans = loc ? loc.length >> 1 : 0;
      const spans = origs.slice(spanAt, spanAt + nSpans);
      spanAt += nSpans;
      // The piece as written: its spans as in the token.
      const written = loc ? restore(text, text, loc, spans)!.text : text;
      const view = views[i];
      if (!view) {
        replacement += written;
        replLetters += text;
        continue;
      }
      // Decision 42b: a piece's context comes from outside its token, never from its siblings.
      view.sibL = -2;
      view.sibR = -2;
      view.win = null;
      let f = this.judgeOne(t, view);
      let out = f ? f.replacement : text;
      let letters = loc ? withoutSpans(out, loc) : out;
      if (loc) {
        const r = restore(text, out, loc, spans);
        if (r) {
          out = r.text;
          letters = r.rest;
        } else {
          // The encoded text changed with the piece: judged as written (its spans kept).
          const wl: number[] = [];
          let q = 0;
          let w = 0;
          for (let k = 0; k < loc.length; k += 2) {
            w += loc[k]! - q;
            wl.push(w);
            w += spans[k >> 1]!.length;
            wl.push(w);
            q = loc[k + 1]!;
          }
          const bare = this.pieceView(written, wl, fl);
          bare.sibL = view.sibL;
          bare.sibR = view.sibR;
          bare.win = view.win;
          f = this.judgeOne(t, bare);
          out = f ? f.replacement : written;
          letters = withoutSpans(out, wl);
          view.fin = bare.fin;
        }
      }
      fins[i] = view.fin;
      if (f) {
        first ??= f;
        for (const y of f.result.signals) signals.add(y);
        if (out !== written) {
          converted = true;
          // 30b.3: a Roman numeral part of a dash token merged with letters of a script
          // written with spaces is a spoof, as in a glued word (`ⅰ-phone`).
          if (
            dashParts &&
            [...text].some((ch) => this.nInfo(ch.codePointAt(0)!)?.category === 'sameReading') &&
            [...(cleaned.slice(0, pieces[i]!.a) + cleaned.slice(pieces[i]!.b))].some((ch) => {
              if (!LETTER_RE.test(ch)) return false;
              const sc = primaryScript(ch);
              return sc !== 'Common' && sc !== 'Inherited' && !isSpaceless(sc);
            })
          ) {
            signals.add('confusable_word');
            spoofed = true;
          }
          if (f.result.signals.some((y) => y === 'confusable_word' || y === 'mixed_spoof'))
            spoofed = true;
        }
      }
      replacement += out;
      replLetters += letters;
    }
    this.found[s] = null;
    // Decision 41b: a converted token votes by its converted form's letters (mojibake left out).
    this.fin[s] = -1;
    if (converted) {
      const vc = new Map<number, number>();
      for (const ch of replLetters)
        if (LETTER_RE.test(ch)) {
          const k = scriptIndexOf(ch.codePointAt(0)!);
          vc.set(k, (vc.get(k) ?? 0) + 1);
        }
      let best = -1;
      let bn = 0;
      for (const [k, c] of vc) if (c > bn) [best, bn] = [k, c];
      this.fin[s] = best;
      this.finL[s] = this.o.model ? this.o.model.langsOf(replLetters) : 0;
    }
    // Decision 42c: one 36a category for the whole token (mojibake left out): a spoof
    // when a piece converted look-alikes; non-legitimate when a piece glues scripts
    // that may not share a word (also across a mojibake span); else legitimate.
    // Decision 42: clean parts are never judged; a dash token with nothing found in its parts
    // gets no report (`IP-адрес`, `NTLM-хеш`).
    // F8: the styled letters written as their letters are a conversion; the category is the
    // unstyled form's (none when its parts have nothing).
    const restyled = written !== null && replacement !== written;
    if (dashParts && !first && !converted) {
      if (restyled) this.found[s] = this.conversionOnly(s, written, replacement);
      return;
    }
    const pieceNonLegit = signals.has('mixed_non_legitimate');
    for (const y of MIXED_CATEGORIES) signals.delete(y as SpoofSignal);
    const lettersOf = moj ? withoutSpans(cleaned, moj.off) : cleaned;
    // As written and as converted (a Roman numeral is a letter once converted: `情報Ⅰ`).
    const scripts = wordScripts(lettersOf + replLetters).scripts as string[];
    const sig = [...signals];
    if (scripts.some((x) => this.isTarget(x)) && scripts.length >= 2) {
      let glued = pieceNonLegit;
      if (!glued)
        for (const q of piecesOf(lettersOf, null)) {
          const sc = wordScripts(lettersOf.slice(q.a, q.b)).scripts as string[];
          if (!legitimateMix(sc)) glued = true;
        }
      sig.unshift(spoofed ? 'mixed_spoof' : glued ? 'mixed_non_legitimate' : 'mixed_legitimate');
    }
    if (!sig.length && !converted && !restyled) return;
    this.found[s] = {
      kind: 'word',
      start: this.st[s]!,
      end: this.en[s]!,
      cleaned: written ?? cleaned,
      result: {
        signals: sig,
        scripts: scripts as ScriptName[],
        normalized: replacement,
        ...(first?.result.skeleton !== undefined && { skeleton: first.result.skeleton }),
      } as TokenAnalysis,
      resolved: first?.resolved ?? null,
      replacement,
      to: first?.to ?? null,
    };
  }

  /** Word t judged through view `v` (its slot, or a phase-3 piece): the finding, or null; pieces are not counted, their token is (42b). */
  private judgeOne(t: number, v: WordView): LetterFinding | null {
    return this.judgeWord(t, v).f;
  }

  /** A word's finding (null: nothing to report), and its count for the result (null: none). */
  private judgeWord(t: number, v: WordView): Judged {
    if (this.o.signal?.aborted) {
      this.stopped = true;
      return { f: null, count: null };
    }
    const s = this.slot(t);
    const fl = v.fl;
    if (fl & F_TOOBIG) {
      return { f: null, count: [(fl & F_LETTER) !== 0, null] };
    }
    const x = v.x;
    // Math switch 3 (decision 30h.3): a word of Math letters is native to Math.
    if (this.o.mathTarget && this.o.model && !(fl & F_ASCII)) {
      const m = mathWord(this.vFull(v));
      if (m === 'native') {
        return { f: null, count: [true, null] };
      }
      if (m === 'mixed') {
        const cleaned = this.vFull(v);
        return {
          count: [true, null],
          f: {
            kind: 'word',
            start: this.st[s]!,
            end: this.en[s]!,
            cleaned,
            result: {
              signals: ['mixed_legitimate'],
              scripts: wordScripts(cleaned).scripts,
              normalized: cleaned,
            },
            resolved: null,
            replacement: cleaned,
            to: null,
          },
        };
      }
    }
    let resolved = v.pend ? this.resolveAt(t, v) : null;
    // Decision 41o: a whole word of a requested language's letters is not folded by context
    // when a nearest word (numbers ignored) is a clean word of its own language; reported.
    let keptByCleanNeighbour = false;
    if (
      resolved?.folded &&
      resolved.wholeScript &&
      (resolved.rule === 'neighbours' || resolved.rule === 'window') &&
      this.cleanNeighbour(t, this.vTx(v))
    ) {
      resolved = null;
      keptByCleanNeighbour = true;
    }
    // Decision 36e, ordering B: a word (per dash part) mixing the letters of two or more
    // requested languages is left to 36e alone; it is never mapped as a whole.
    const twoLanguageWord =
      this.o.model !== null && !(fl & F_ASCII) && (resolved !== null || fl & F_MIXED)
        ? // The word as written: a styled or math letter is no letter of a requested language (30b, 40d).
          this.twoRequested(this.vFull(v))
        : false;
    if (twoLanguageWord) resolved = null;
    if (resolved?.folded) {
      // Decision 41b: a word of donors only stays when its context is the donor's script.
      const ins = v.pend!.ins;
      if (ins.scripts.size === 1 && ins.scripts.has(KIND_DONOR)) {
        const own = this.donorScript(this.vTx(v));
        if (own >= 0 && this.ownContext(t, own, v)) resolved = null;
      }
      // Decision 41b by language: a word whose letters, donors and plain
      // letters alike, are all of one unrequested language stays as written when its context
      // is that language (`по` in Russian text with English requested; `new` in English text
      // with Russian requested). A word with a letter of a requested language is unaffected.
      if (resolved?.folded && this.foreignOwnContext(t, v)) {
        resolved = null;
        if (this.foreignEdge) keptByCleanNeighbour = true;
      }
    }
    if (resolved?.folded && resolved.rule === 'conditional-twin' && this.vTx(v).includes('ı')) {
      // Decision 41g: Turkish ı stays when a word of the context window holds ğ, ş or İ, or
      // another part of its own visibility token does (`Çağı'nın`).
      if (this.turkishNear(t) || (v.piece && TURKISH_RE.test(this.cleanedOf(s)))) resolved = null;
    }
    if (resolved?.folded && resolved.language) {
      v.fin = SCRIPT_LIST.indexOf(TARGET_LANGUAGES[resolved.language].script as ScriptName);
      const lb = resolved.language
        ? this.o.model!.languages.find((x) => x.name === resolved!.language)
        : undefined;
      v.finL = lb ? 1 << lb.bit : 0;
    }
    if (!resolved && fl & F_ASCII && !keptByCleanNeighbour) {
      // An ASCII token is one word of Latin letters with no invisible, mark, style or lookalike.
      return { f: null, count: [(fl & F_LETTER) !== 0, null] };
    }
    const token = this.vTx(v);
    // Decision 37: a lone cap-height stroke with no language written in
    // Latin letters requested stays as written and is reported; it is not converted
    // into any other language.
    const strokeKept = !resolved && this.loneStrokeKept(t, v);
    // A word the resolver left alone, with a non-Latin letter and nothing else the token judge flags.
    if (
      !resolved &&
      !twoLanguageWord &&
      !keptByCleanNeighbour &&
      !strokeKept &&
      !x &&
      v.inM &&
      !(fl & F_MIXED && ![...token].some((c) => this.targetChar(c, false))) &&
      isPlainNonLatin(token, 0, token.length)
    ) {
      return { f: null, count: [true, null] };
    }
    const cleaned = this.vFull(v);
    const count: Judged['count'] = [hasLetter(x ? cleaned : token), resolved];
    // Math switch 1 (decision 30h): a word of math letters, or math letters and Greek, is not judged.
    if (this.o.keepMath && isMathWord(cleaned)) return { f: null, count };
    const strict = this.o.strict;
    const model = this.o.model !== null;
    const { dom, mixed } = this.breadth(t);
    let plan = v.pn;
    // Decision 41k: a lone language-set neutral among words of its set stays as written.
    if (plan?.lset && this.langSetNear(t, v)) return { f: null, count };
    let result: TokenAnalysis;
    if (model && strict) {
      // Strict language model: the resolver alone. Zalgo is phase 1's (decision
      // 28b), styling the neutral alphabet's (30a), foreign scripts 34–36's.
      if (resolved) {
        const ws = wordScripts(token);
        let normalized = resolved.normalized;
        let flag = true;
        if (!resolved.folded && resolved.class === 'mixed' && !ws.mixed) {
          // A word of one script no requested language takes whole (`það`: `ð` has no twin): its donors
          // fold as donors (40d), or, with none that folds, it is not flagged (review 13).
          normalized = this.donorFold(token);
          flag = normalized !== token;
        }
        result = {
          signals: flag ? [ws.mixed ? 'mixed_script' : 'confusable_word'] : [],
          scripts: ws.scripts,
          skeleton: skeleton(token),
          normalized,
        };
      } else if (x & X_SIGN) {
        result = analyzeToken(
          token,
          dom,
          mixed,
          this.o.inputLanguages,
          NO_MASK,
          0,
          TOKEN_FLAGS_STRICT,
        );
        // 40d: with no language written in Latin letters requested, the token judge's Latin folds of the other letters are
        // folds into an unrequested language: only the signs convert, through their own output
        // (`Kǀ` with Russian and Ukrainian → `Kǀ`, reported; review 27 N4).
        if (!this.isTarget('Latin')) {
          let out = '';
          for (const c of token)
            out += CANONICAL_SIGNS.has(c.codePointAt(0)!) ? c.normalize('NFC') : c;
          result = { ...result, normalized: out };
        }
      } else result = { signals: [], scripts: [], normalized: token };
    } else if (resolved) {
      // The resolver folded (or flagged) the word; the token judge still judges what
      // the model does not cover (zalgo, styling) on the folded form.
      const rest = analyzeToken(
        resolved.normalized,
        dom,
        mixed,
        this.o.inputLanguages,
        NO_MASK,
        0,
        MODEL_FLAGS_LENIENT,
      );
      const ws = wordScripts(token);
      const own: SpoofSignal = ws.mixed ? 'mixed_script' : 'confusable_word';
      result = {
        signals: [own, ...rest.signals.filter((y) => y !== own)],
        scripts: ws.scripts,
        skeleton: skeleton(token),
        normalized: rest.signals.length ? rest.normalized : resolved.normalized,
      };
    } else if (model && plan && !(x & (X_NEUTRAL | X_DIGIT)) && x & X_FOREIGN) {
      // Lenient, foreign letters and nothing to fold: the token judge reads the
      // whole word, so hidden characters are judged by the letters around them
      // (its per-letter exemption); letters are decisions 34–36's.
      result = analyzeToken(
        cleaned,
        dom,
        mixed,
        this.o.inputLanguages,
        NO_MASK,
        0,
        MODEL_FLAGS_LENIENT,
      );
      plan = null;
    } else if (token === '') {
      result = { signals: [], scripts: [], normalized: '' };
    } else {
      // Under the language model foreign scripts are decisions 34–36's, not the token judge's.
      // Decision 40d: letters are the resolver's (requested targets, effective mapping), never
      // the static UTS #39 skeleton.
      const flags = model ? MODEL_FLAGS_LENIENT : strict ? TOKEN_FLAGS_STRICT : TOKEN_FLAGS;
      result = analyzeToken(token, dom, mixed, this.o.inputLanguages, NO_MASK, 0, flags);
    }
    // Decision 36e (ordering B): a word mixing two requested languagesâ letters is fixed here, before
    // its neutral characters follow the corrected word (31).
    let piecesCorrected = false;
    if (twoLanguageWord && !resolved && model) {
      // The core when the plan rebuilds the word around it, else the word as judged.
      const correctionBase = plan ? token : result.normalized;
      const corrected = this.mixedPieces(t, correctionBase, null);
      if (corrected.out !== correctionBase) {
        result = { ...result, normalized: corrected.out };
        piecesCorrected = true;
      }
    }
    // A foreign mix the language model does not allow (decisions 35, 36); the
    // word's scripts are those of all its letters.
    if (x & X_BAD && !result.signals.includes('mixed_script'))
      result = { ...result, signals: ['mixed_script', ...result.signals] };
    if (x & X_FOREIGN && result.signals.length)
      result = {
        ...result,
        scripts: wordScripts(cleaned).scripts,
      };
    let replacement = result.normalized;
    let to: ConfusionAlphabet | 'Latin' | null = model
      ? this.targetOf(piecesCorrected ? result.normalized : token, resolved)
      : 'Latin';
    let converted = false;
    if (plan) {
      const r = this.reassemble(
        plan,
        result.normalized,
        resolved,
        dom,
        {
          stay: x & X_DIGIT ? this.digitStay(t, plan, v) : null,
          alt: plan.alt ? this.altOf(t, plan, resolved, v) : null,
        },
        () => this.ctxLanguage(t, v),
      );
      replacement = r.text;
      to = model ? r.to : 'Latin';
      // Decision 30b: whether converting a neutral character is a spoof is its category's.
      if (x & (X_NEUTRAL | X_DIGIT) && replacement !== cleaned) {
        converted = true;
        if (plan.spoof && !result.signals.includes('confusable_word'))
          result = { ...result, signals: [...result.signals, 'confusable_word'] };
      } else if (plan.leftover && !result.signals.includes('confusable_word')) {
        // Decision 41j: a leftover neutral the word keeps as written is still reported.
        result = { ...result, signals: [...result.signals, 'confusable_word'] };
      }
      result = { ...result, normalized: replacement };
    }
    if (model) {
      const m = this.mixedCategory(
        result,
        cleaned,
        replacement,
        resolved,
        plan,
        t,
        v,
        piecesCorrected,
      );
      // 36c, `affixSeparator: ''`: a word kept by its affix is unchanged and not reported.
      if (m.quiet) return { f: null, count };
      result = m.result;
      if (m.replacement !== replacement) {
        replacement = m.replacement;
        converted = true;
      }
    }
    // A fold is never dropped (review 11).
    if (resolved?.folded && replacement !== cleaned) converted = true;
    // 41o: a word its clean neighbour keeps is reported as a whole-word look-alike, not converted.
    if (keptByCleanNeighbour && result.signals.length === 0 && !converted)
      result = { ...result, signals: ['whole_word_lookalike'] };
    if (strokeKept && result.signals.length === 0 && !converted)
      result = { ...result, signals: ['confusable_word'] };
    if (result.signals.length === 0 && !converted) return { f: null, count };
    return {
      count,
      f: {
        kind: 'word',
        start: this.st[s]!,
        end: this.en[s]!,
        cleaned,
        result,
        resolved,
        replacement,
        to,
      },
    };
  }

  /**
   * A word's characters by class (decisions 30b, 31, 31a, 34–36; review 7 B,
   * D), decided once when the word closes, with no context: each position is
   * core (judged), converted (a neutral character written as its base in the
   * core before judging), following (a neutral character the language model
   * writes in the word's language after judging), kept (as written: tail marks,
   * a unit at the word's end, undecided symbols, letters of script Common or
   * Inherited outside the model and the dictionary) or foreign (alphabet
   * model: a letter of a script outside the model). A mark goes with the
   * character before it. The core is the judged text; foreign letters are
   * checked against decisions 35 and 36. One neutral character alone is
   * converted only when the dictionary says so (32a).
   */
  private split(word: string, moj: readonly number[] | null = null): Plan | null {
    const model = this.o.model;
    const chars = [...word];
    const n = chars.length;
    const cls = new Uint8Array(n);
    const infos: (NeutralInfo | null)[] = new Array(n).fill(null);
    if (this.o.neutral)
      for (let i = 0; i < n; i++) infos[i] = this.nInfo(chars[i]!.codePointAt(0)!);
    // Decision 42a: inside a mojibake span letters are judged with the word; the
    // other characters (neutral letters too: `µ` in `Ðµ`) are encoded bytes, not
    // symbols: kept as written, out of the core.
    let inSpan: Uint8Array | null = null;
    if (moj) {
      inSpan = new Uint8Array(n);
      for (let i = 0, u = 0, k = 0; i < n; u += chars[i]!.length, i++) {
        while (k < moj.length && moj[k + 1]! <= u) k += 2;
        if (k < moj.length && moj[k]! <= u && (infos[i] || !LETTER_RE.test(chars[i]!))) {
          inSpan[i] = 1;
          infos[i] = null;
          cls[i] = C_KEEP;
        }
      }
    }
    // A unit followed only by kept neutral characters is at the word's end (category 6):
    // exempt only after a number, an SI prefix, or a spaceless letter before the number;
    // otherwise it converts, a finding.
    let end = true;
    let leftover = false;
    for (let i = n - 1; i >= 0; i--) {
      const e = infos[i];
      if (e && roleOf(e) === 'keep') continue;
      if (e && e.category === 'unit' && end) {
        if (i === 0 || UNIT_BEFORE_RE.test(chars.slice(0, i).join(''))) cls[i] = C_KEEP;
        // (the run right before the unit decides: `23日最高零下6℃`, review 10)
        else leftover = true;
        end = false;
        continue;
      }
      if (!(cpFlags(chars[i]!.codePointAt(0)!) & CP_MARK)) end = false;
    }
    // One neutral alone (marks and selectors on it aside) converts only when the dictionary says so (32a).
    if (
      infos[0] &&
      !infos[0].standalone &&
      chars.every((c, i) => i === 0 || cpFlags(c.codePointAt(0)!) & CP_MARK)
    )
      return null;
    // Decision 41k: a neutral of a language set (the CJK blocks) in a word whose
    // letters are of that set is kept as written, not reported.
    let lset = false;
    if (this.o.neutral && infos.some((e, i) => e && inLangBlock(chars[i]!))) {
      let letters = 0;
      let inSet = true;
      for (let i = 0; i < n; i++) {
        if (infos[i] || !LETTER_RE.test(chars[i]!)) continue;
        letters++;
        if (!LANG_SET.has(primaryScript(chars[i]!))) inSet = false;
      }
      if (letters && inSet) {
        for (let i = 0; i < n; i++) if (infos[i] && inLangBlock(chars[i]!)) infos[i] = null;
        if (infos.every((e) => !e)) return null;
      } else if (!letters) lset = true;
    }
    // Decision 41l: inside a number a digit donor reads as a digit. Numbers are runs of
    // digits, digit look-alikes and digit donors; a donor-only run counts only with no
    // adjacent letter (`০` next to letters keeps its letter reading).
    let numAt: Uint8Array | null = null;
    if (model && chars.some((c) => hasReading(c.codePointAt(0)!))) {
      const isNum = (c: string) => {
        const cp = c.codePointAt(0)!;
        return NUMBER_CHAR_RE.test(c) || isDigitLookalike(cp) || hasReading(cp);
      };
      for (let i = 0; i < n;) {
        if (!isNum(chars[i]!)) {
          i++;
          continue;
        }
        let j = i;
        let digit = false;
        while (j < n && isNum(chars[j]!)) {
          // An ASCII digit or a digit-only look-alike (`৪`, `Ꮞ`; not `Ϭ`).
          const c = chars[j]!;
          const cpj = c.codePointAt(0)!;
          if (
            !hasReading(cpj) &&
            (isDigitLookalike(cpj)
              ? !TARGET_ALPHABETS.some((T) => model.twinIn(c, T))
              : this.kindOf(cpj) !== KIND_DONOR)
          )
            digit = true;
          j++;
        }
        // An `x` between numbers (36e's `×`) is no letter touching it (`1x١` → `1×1`).
        const touches =
          (i > 0 && LETTER_RE.test(chars[i - 1]!)) || (j < n && LETTER_RE.test(chars[j]!));
        if (digit || !touches)
          for (let k = i; k < j; k++)
            if (hasReading(chars[k]!.codePointAt(0)!)) (numAt ??= new Uint8Array(n))[k] = 1;
        i = j;
      }
    }
    let x = 0;
    const scripts: string[] = [];
    let prev = C_CORE;
    for (let i = 0; i < n; i++) {
      if (inSpan && inSpan[i]) {
        x |= X_KEPT;
        prev = C_KEEP;
        continue;
      }
      const ch = chars[i]!;
      const cp = ch.codePointAt(0)!;
      const f = cpFlags(cp);
      const e = infos[i];
      if (isDigitLookalike(cp) || (numAt && numAt[i])) {
        x |= X_DIGIT;
        prev = cls[i] = C_CONV;
        continue;
      }
      if (e) {
        x |= X_NEUTRAL;
        // Category 8: a unit prefix at a word's start, or right after its digits
        // (the unit's start, `5µm`), is kept when the rest of the word is a unit of
        // the unit list (`µm`, `µHz`); the rest is judged without it.
        const role =
          cls[i] === C_KEEP ||
          (e.category === 'unitPrefix' &&
            chars.slice(0, i).every((c) => DIGIT_RE.test(c)) &&
            UNIT_AFTER_PREFIX_RE.test(chars.slice(i + 1).join('')))
            ? 'keep'
            : roleOf(e);
        // 31a: the Latin-fold model writes following characters as their (Latin) base too.
        cls[i] = role === 'keep' ? C_KEEP : role === 'convert' || !model ? C_CONV : C_FOLLOW;
        // 30b category 5, 41j: a tail mark or separator directly followed by a letter
        // is converted and reported as a visible-style letter of the word's target.
        if ((e.category === 'tailMark' || e.category === 'separator') && i < n - 1) {
          let base = BOUNDARY_LETTERS.get(chars[i]!.codePointAt(0)!);
          // `©` takes the case of the letters next to it (`©LICK` → `CLICK`).
          if (base === 'c') {
            const nb = [chars[i + 1], chars[i - 1]].find(
              (c) => c !== undefined && LETTER_RE.test(c),
            );
            if (nb && nb !== nb.toLowerCase()) base = 'C';
          }
          if (base) {
            infos[i] = { ...e, category: 'visibleStyle', base, baseScript: 'Latin' };
            cls[i] = model ? C_FOLLOW : C_CONV;
          }
          leftover = true;
        }
        prev = cls[i]!;
        continue;
      }
      // Review 10: the emoji presentation selector of a converted neutral (`🅿️`) goes with it.
      if (f & CP_VARIATION && i > 0 && infos[i - 1] && (prev === C_CONV || prev === C_FOLLOW)) {
        cls[i] = C_DROP;
        continue;
      }
      if (f & CP_MARK && prev !== C_CORE && prev !== C_CONV) {
        cls[i] = C_KEEP; // a mark goes with the character before it, as written
        continue;
      }
      prev = C_CORE;
      if (model && this.o.neutral && CANONICAL_SIGNS.has(cp)) x |= X_SIGN;
      if (model && !(f & CP_LETTER) && cp > 0x7f && !(f & CP_INVISIBLE)) {
        // Decision 0a: a digit of another script with no mapping stays as written, out of the core.
        let v = cp < 0x10000 ? model.bmpInfo[cp]! : 0;
        if (v === 0) v = model.info(cp);
        if ((v & KIND_MASK) === KIND_NONE) {
          // Bound to its script like a foreign letter: placed like one (decision 36).
          x |= X_FOREIGN;
          prev = cls[i] = C_FOREIGN;
          scripts.push(primaryScript(chars[i]!));
          continue;
        }
      }
      if (model && f & CP_LETTER && !(f & CP_INVISIBLE)) {
        let v = cp < 0x10000 ? model.bmpInfo[cp]! : 0;
        if (v === 0) v = model.info(cp);
        const k = v & KIND_MASK;
        const sc = primaryScript(ch);
        if (k === KIND_NONE) {
          if (sc !== 'Common' && sc !== 'Inherited') {
            x |= X_FOREIGN;
            prev = cls[i] = C_FOREIGN;
            scripts.push(sc);
          } else if (this.o.neutral) {
            // Review 7 D: a letter outside the model and the dictionary is kept, not judged.
            x |= X_KEPT;
            prev = cls[i] = C_KEEP;
          }
          continue;
        }
        if (k < KIND_NONE) {
          scripts.push(sc);
        }
      }
      cls[i] = C_CORE;
    }
    if (x === 0) return null;
    // A donor in a word with a letter (or digit) of its own non-target script is
    // that script's writing, not a look-alike, and stays as written (decision 0a).
    if (model && x & X_FOREIGN) {
      const kindAt = (i: number) => {
        const cp = chars[i]!.codePointAt(0)!;
        let v = cp < 0x10000 ? model.bmpInfo[cp]! : 0;
        if (v === 0) v = model.info(cp);
        return v & KIND_MASK;
      };
      // Target letters in the word change nothing (`paypaוש`, `صمیمانهs`).
      const own = new Set<string>();
      for (let i = 0; i < n; i++) if (cls[i] === C_FOREIGN) own.add(primaryScript(chars[i]!));
      for (let i = 0; i < n && own.size; i++) {
        // A digit donor read as a digit (41l) is a donor of its script too (`2०११`).
        const reading = cls[i] === C_CONV && numAt !== null && numAt[i] === 1;
        if (cls[i] !== C_CORE && !reading) continue;
        if (kindAt(i) === KIND_DONOR && own.has(primaryScript(chars[i]!))) {
          cls[i] = C_FOREIGN;
          if (reading) numAt![i] = 0;
          // A donor digit had no script entry yet (decision 35's set).
          if (!(cpFlags(chars[i]!.codePointAt(0)!) & CP_LETTER))
            scripts.push(primaryScript(chars[i]!));
          for (let j = i + 1; j < n && cpFlags(chars[j]!.codePointAt(0)!) & CP_MARK; j++)
            if (cls[j] === C_CORE) cls[j] = C_KEEP;
        }
      }
    }
    if (numAt && x & X_DIGIT && !chars.some((c, i) => cls[i] === C_CONV && !infos[i]))
      x &= ~X_DIGIT;
    // Decision 41b in the word: with no target character, a digit look-alike next
    // to another character of its own script stays, and so does every donor of
    // that script in the word (`৪০`, `१९३५`: one judgement per number, review 9).
    if (
      x & X_DIGIT &&
      !chars.some((ch, i) => !(cls[i] === C_CONV && !infos[i]) && this.targetChar(ch, true))
    ) {
      const isDigit = (i: number) => cls[i] === C_CONV && !infos[i];
      const keepScripts = new Set<number>();
      for (let i = 0; i < n; i++) {
        if (!isDigit(i)) continue;
        const own = ownScriptOf(chars[i]!.codePointAt(0)!);
        // Only a character of its script that is no donor keeps it (`१९३५`); a word of
        // donors only goes to the context step (`error ৪০৪`, review 10).
        for (let j = 0; j < n; j++)
          if (
            j !== i &&
            !isDigit(j) &&
            ownScriptOf(chars[j]!.codePointAt(0)!) === own &&
            this.kindOf(chars[j]!.codePointAt(0)!) !== KIND_DONOR
          ) {
            keepScripts.add(own);
            break;
          }
      }
      if (keepScripts.size) {
        let digits = 0;
        for (let i = 0; i < n; i++) {
          const k = ownScriptOf(chars[i]!.codePointAt(0)!);
          if (!keepScripts.has(k)) {
            if (isDigit(i)) digits++;
            continue;
          }
          if (isDigit(i)) cls[i] = C_KEEP;
          else if (cls[i] === C_CORE && this.kindOf(chars[i]!.codePointAt(0)!) === KIND_DONOR)
            cls[i] = C_KEEP;
        }
        x |= X_KEPT;
        if (!digits) x &= ~X_DIGIT;
      }
    }
    // The core: core characters, and converted ones as their base (the micro sign by the word's letters).
    let wordScript: string | null = null;
    for (let i = 0; i < n; i++) {
      if (cls[i] !== C_CORE || !LETTER_RE.test(chars[i]!)) continue;
      const sc = primaryScript(chars[i]!);
      wordScript = wordScript === null || wordScript === sc ? sc : '';
    }
    // The plain form of a neutral is English (Greek for the Greek-based ones, 30i), whatever
    // is requested; the word's target takes it on through the effective twins (40d).
    const baseScript = wordScript === 'Cyrillic' || wordScript === 'Greek' ? wordScript : 'Latin';
    // Per-language rule: the word's language (its core letters'), the first in request order
    // in which every following neutral has its letters.
    let langDone = !model;
    let langV: TargetLanguage | null = null;
    const langOfWord = (): TargetLanguage | null => {
      if (langDone) return langV;
      langDone = true;
      let coreLetters = '';
      for (let i = 0; i < n; i++) if (cls[i] === C_CORE) coreLetters += chars[i]!;
      langV = this.wordLang(baseScript, coreLetters, (l) =>
        infos.every((e, i) => cls[i] !== C_FOLLOW || !e || this.nIn(e, baseScript, l) !== null),
      );
      return langV;
    };
    // Decision 41f: a digit look-alike that is also a donor row of a target
    // (`Ϭ` → `6`, → `б`) stays in the core; the word's target decides at judgement.
    let alt: number[] | null = null;
    if (x & X_DIGIT && model) {
      let digits = 0;
      for (let i = 0; i < n; i++) {
        if (cls[i] !== C_CONV || infos[i] || hasReading(chars[i]!.codePointAt(0)!)) continue;
        if (TARGET_ALPHABETS.some((T) => model.twinIn(chars[i]!, T))) {
          // Out of the core: the word is judged without it, then it follows the word.
          cls[i] = C_KEEP;
          (alt ??= []).push(i);
        } else digits++;
      }
      void digits;
    }
    // Decision 41j: a following character with no twin in the word's language is
    // replaced by its base letter and the word is judged (mixed: `приⓖет`).
    if (model && baseScript !== 'Latin')
      for (let i = 0; i < n; i++)
        if (cls[i] === C_FOLLOW && this.nIn(infos[i]!, baseScript, langOfWord()) === null)
          cls[i] = C_CONV;
    let core = '';
    const bases: (string | null)[] = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      if (cls[i] === C_CORE) core += chars[i]!;
      else if (cls[i] === C_CONV && !infos[i]) {
        bases[i] = digitOf(chars[i]!.codePointAt(0)!);
        core += bases[i];
      } else if (cls[i] === C_CONV) {
        const b = baseIn(
          chars[i]!.codePointAt(0)!,
          infos[i]!,
          model ? langOfWord() : undefined,
          baseScript,
        );
        if (b === null) {
          // No replacement decided for this target (the micro sign in a Russian or Ukrainian word):
          // as written, and reported (decision 41j).
          cls[i] = C_KEEP;
          leftover = true;
          continue;
        }
        // 30b categories 3, 7 (and the Japanese squares): inside a word of another
        // target, written through their Latin letters into it (`Ⅹорошо` → `Хорошо`).
        const cat = infos[i]!.category;
        const w =
          baseScript !== 'Latin' &&
          (cat === 'sameReading' || cat === 'wordSign' || cat === 'japaneseSquare')
            ? this.throughTwins(b, baseScript, langOfWord())
            : b;
        bases[i] = w;
        core += w;
      }
    }
    if (x & X_FOREIGN) {
      const set = new Set(scripts.filter((y) => y !== 'Common' && y !== 'Inherited'));
      if (!moderatelyRestrictive(set)) x |= X_BAD;
    }
    const spoof =
      leftover || (x & X_DIGIT) !== 0 || alt !== null || this.conversionSpoof(chars, cls, infos);
    return { chars, cls, infos, bases, core, x, spoof, lset, alt, leftover };
  }

  /**
   * Whether the word's conversions are a spoof (decision 30b): a disguise
   * (math letter, Greek symbol variant) converted; a Roman numeral in a word of
   * a script written with spaces (category 3); a word sign next to a character
   * other than a separator, a digit or a spaceless-script letter (category 7). Visible style and
   * units are no spoof.
   */
  private conversionSpoof(
    chars: readonly string[],
    cls: Uint8Array,
    infos: readonly (NeutralInfo | null)[],
  ): boolean {
    let spaced: boolean | null = null;
    for (let i = 0; i < chars.length; i++) {
      const e = infos[i];
      if (!e || cls[i] !== C_CONV || roleOf(e) !== 'convert') continue;
      switch (e.category) {
        case 'disguise':
        case 'unitPrefix':
        case 'japaneseSquare':
          // A Japanese square outside its language set is reported (41k keeps it inside).
          return true;
        case 'sameReading':
          spaced ??= chars.some((ch, j) => {
            if (infos[j] !== null || cls[j] === C_KEEP || !LETTER_RE.test(ch)) return false;
            const sc = primaryScript(ch);
            return sc !== 'Common' && sc !== 'Inherited' && !isSpaceless(sc);
          });
          if (spaced) return true;
          break;
        case 'wordSign':
          if (!signNeighbourOk(chars[i - 1]) || !signNeighbourOk(chars[i + 1])) return true;
          break;
      }
    }
    return false;
  }

  /**
   * A word's output from its plan (review 7 B: by position): each core and
   * converted position takes its own units of the core's output (a unit is a
   * character with the marks and invisible characters after it), each
   * following character is written in the word's language, kept and foreign
   * characters stay where they were. When the core's output has another
   * number of units the word stays as written. A word with no core and no
   * foreign letter is written in an alphabet all its following characters
   * map into ({@link pickTo}). `fix.stay`: digit look-alikes kept by decision 41b;
   * `fix.alt`: decision 41f's replacements, by position. Returns the text and the
   * alphabet the following characters were written in.
   */
  private reassemble(
    p: Plan,
    coreNormalized: string,
    resolved: WordResolution | null,
    dom: string | null,
    fix: Rebuild,
    ctxLang: () => TargetLanguage | null = () => null,
  ): { text: string; to: ConfusionAlphabet | 'Latin' | null } {
    const { chars, cls, infos, bases } = p;
    const cleaned = chars.join('');
    let foreign = false;
    for (let i = 0; i < chars.length; i++) if (cls[i] === C_FOREIGN) foreign = true;
    if (p.core === '' && !foreign) return this.neutralOnly(p, dom, fix.alt, ctxLang);
    // The core as judged (36e may have corrected it) decides where the neutrals follow,
    // and in which language (per-language rule).
    let to: ConfusionAlphabet | 'Latin' | null;
    let lang: TargetLanguage | null = null;
    if (hasLetter(p.core)) {
      const core = resolved ? p.core : coreNormalized;
      to = this.targetOf(core, resolved);
      if (to && this.o.model)
        lang =
          (resolved?.folded ? resolved.language : null) ??
          this.wordLang(to, resolved?.folded ? resolved.normalized : core, (l) =>
            infos.every((e, i) => cls[i] !== C_FOLLOW || !e || this.nIn(e, to!, l) !== null),
          );
    } else [to, lang] = this.pickTo(p, dom, ctxLang);
    // A format character is a unit of its own, so it stays where it was (review 8);
    // when the core's output dropped some, it joins the unit before it.
    let attach = CP_MARK;
    let nu = units(coreNormalized, attach);
    const totalOf = (mask: number) => {
      let total = 0;
      for (let i = 0; i < chars.length; i++)
        if (cls[i] === C_CORE || cls[i] === C_CONV)
          total += unitCount(cls[i] === C_CONV ? bases[i]! : chars[i]!, total === 0, mask);
      return total;
    };
    if (totalOf(attach) !== nu.length) {
      attach = CP_MARK | CP_INVISIBLE;
      nu = units(coreNormalized, attach);
      if (totalOf(attach) !== nu.length) return { text: cleaned, to: null };
    }
    let k = 0;
    let out = '';
    let seen = false;
    for (let i = 0; i < chars.length; i++) {
      const c = cls[i]!;
      const a = fix.alt?.get(i);
      if (a !== undefined) {
        // Decision 41f: the multi-target digit look-alike as the word's target (or context) decides.
        out += a;
        continue;
      }
      if (c === C_CORE || c === C_CONV) {
        const m = unitCount(c === C_CONV ? bases[i]! : chars[i]!, !seen, attach);
        seen = true;
        if (fix.stay && fix.stay[i]) {
          // Decision 41b: the digit look-alike stays as written; its units of the core are passed over.
          k += m;
          out += chars[i]!;
          continue;
        }
        for (let q = 0; q < m && k < nu.length; q++) out += nu[k++]!;
      } else if (c === C_FOLLOW)
        out += to ? (this.nIn(infos[i]!, to, lang) ?? chars[i]!) : chars[i]!;
      else if (c !== C_DROP) out += chars[i]!;
    }
    while (k < nu.length) out += nu[k++]!;
    return { text: out, to };
  }

  /**
   * The language a word's following characters are written in when no letter
   * of the word decides (decision 31), with the script of its letters. Under the
   * model: of the requested languages all of them map into, the one of their own
   * letters, else the context's, else the requested languages in request order;
   * null when none. The Latin-fold model has no languages: the
   * script their own letters share, else the dominant script, else Latin
   * letters, Cyrillic letters, Greek letters in that order.
   */
  private pickTo(
    p: Plan,
    dom: string | null,
    ctxLang: () => TargetLanguage | null,
  ): [ConfusionAlphabet | 'Latin' | null, TargetLanguage | null] {
    const { cls, infos } = p;
    // No following character: nothing is written in any alphabet (and no context is read).
    if (!cls.includes(C_FOLLOW)) return [null, null];
    let own: string | null = null;
    for (let i = 0; i < infos.length; i++) {
      const e = infos[i];
      if (!e || cls[i] !== C_FOLLOW) continue;
      if (own === null) own = e.baseScript;
      else if (own !== e.baseScript) own = '';
    }
    const fits = (to: string, lang: TargetLanguage | null) => {
      for (let i = 0; i < infos.length; i++)
        if (cls[i] === C_FOLLOW && this.nIn(infos[i]!, to, lang) === null) return false;
      return true;
    };
    const order: string[] = [];
    if (own) order.push(own);
    const model = this.o.model;
    if (!model) {
      // The Latin-fold model: the dominant script.
      if (dom === 'Latin' || dom === 'Cyrillic' || dom === 'Greek') order.push(dom);
      order.push('Latin', 'Cyrillic', 'Greek');
      for (const to of order as (ConfusionAlphabet | 'Latin')[])
        if (fits(to, null)) return [to, null];
      return [null, null];
    }
    // Per language: the requested languages written in the neutrals' own letters, the context's
    // language, then every requested language, each group in request order.
    const tries: [string, TargetLanguage | null][] = [];
    if (own) {
      const ns = this.langsOf(own);
      // The neutrals' own letters with no language of them requested: their base as written.
      if (!ns.length) tries.push([own, null]);
      for (const n of ns) tries.push([own, n]);
    }
    const c = ctxLang();
    if (c) tries.push([TARGET_LANGUAGES[c].script, c]);
    for (const n of model.targetLanguages) tries.push([TARGET_LANGUAGES[n].script, n]);
    for (const [to, n] of tries) if (fits(to, n)) return [to as ConfusionAlphabet | 'Latin', n];
    return [null, null];
  }

  /** {@link reassemble} for a word of following and kept characters only: written in {@link pickTo}'s alphabet. */
  private neutralOnly(
    p: Plan,
    dom: string | null,
    alt: Map<number, string> | null,
    ctxLang: () => TargetLanguage | null,
  ): { text: string; to: ConfusionAlphabet | 'Latin' | null } {
    const { chars, cls, infos } = p;
    let n = 0;
    for (let i = 0; i < chars.length; i++) if (cls[i] === C_FOLLOW) n++;
    const cleaned = chars.join('');
    const [to, lang] = n ? this.pickTo(p, dom, ctxLang) : [null, null];
    if (to === null && !alt) return { text: cleaned, to: null };
    let out = '';
    for (let i = 0; i < chars.length; i++)
      out +=
        alt?.get(i) ??
        (cls[i] === C_DROP
          ? ''
          : cls[i] === C_FOLLOW && to
            ? (this.nIn(infos[i]!, to, lang) ?? chars[i]!)
            : chars[i]!);
    return { text: out.normalize('NFC'), to };
  }

  // --- Lenient: invisible runs outside words (the standalone pass) ------------------

  /** Removals the lenient output leaves out, ascending: [dS, dE). */
  private readonly dS: number[] = [];
  private readonly dE: number[] = [];
  private dHead = 0;

  private addDrop(s: number, e: number): void {
    const { dS, dE } = this;
    let k = dS.length;
    while (k > this.dHead && dS[k - 1]! > s) k--;
    if (k === dS.length) {
      dS.push(s);
      dE.push(e);
    } else {
      dS.splice(k, 0, s);
      dE.splice(k, 0, e);
    }
  }

  // --- Output ---------------------------------------------------------------------

  /** Output of a source range, the lenient path's removals left out. */
  private outRange(a: number, b: number): void {
    const { dS, dE } = this;
    while (a < b) {
      while (this.dHead < dS.length && dE[this.dHead]! <= a) this.dHead++;
      const ds = this.dHead < dS.length ? dS[this.dHead]! : Infinity;
      if (ds >= b) break;
      if (ds > a) this.rangeOut(a, ds);
      a = dE[this.dHead]!;
    }
    this.rangeOut(a, b);
  }

  /** Output of an untouched source range: joined with the pending one when they touch. */
  private rangeOut(a: number, b: number): void {
    if (b <= a) return;
    if (this.oS >= 0 && this.oE === a) this.oE = b;
    else {
      this.outFlush();
      this.oS = a;
      this.oE = b;
    }
  }

  private outText(t: string): void {
    if (t === '') return;
    this.outFlush();
    this.o.out(t);
  }

  /** A word's (or a gap's) text, for source [a, b). */
  private outWord(t: string, a: number, b: number): void {
    if (!this.o.refs) return this.outText(t);
    this.outFlush();
    this.o.refs.word(t, a, b);
  }

  /** A gap: phase 1's text as it is, source ranges as written. */
  private outPieces(pcs: readonly (number | string)[]): void {
    for (let k = 0; k < pcs.length; k++) {
      const x = pcs[k]!;
      if (typeof x === 'string') this.outText(x);
      else this.outRange(x, pcs[++k] as number);
    }
  }

  private outFlush(): void {
    if (this.oS >= 0) {
      if (this.o.refs) this.o.refs.range(this.oS, this.oE);
      else this.o.out(this.src.slice(this.oS, this.oE));
      this.oS = this.oE = -1;
    }
  }

  private outGap(g: Gap): void {
    if (g.pcs && g.txt !== null) this.outPieces(g.pcs);
    else if (g.txt !== null) this.outText(g.txt);
    else if (g.r0 >= 0) this.outRange(g.r0, g.r1);
  }

  /** Emits the chunks whose words are judged, in source order. */
  private flush(): void {
    const signal = this.o.signal;
    while (this.outT < this.judged && this.outT < this.nTok) {
      if (signal?.aborted) {
        this.stopped = true;
        return;
      }
      const s = this.slot(this.outT);
      const t = this.outT++;
      if (this.pl[s] && this.found[s] === null) {
        // Untouched source: the pending range grows.
        const a = this.g0[s]! >= 0 ? this.g0[s]! : this.st[s]!;
        const e = this.en[s]!;
        if (
          this.oS >= 0 &&
          this.oE === a &&
          (this.dHead >= this.dS.length || this.dS[this.dHead]! >= e)
        )
          this.oE = e;
        else this.outRange(a, e);
        continue;
      }
      if (this.styledBefore.size) {
        const sc = this.styledBefore.get(t);
        if (sc) {
          this.styledBefore.delete(t);
          for (const c of sc) this.emitStyled(c);
        }
      }
      const pcs = this.gapPcs.size ? this.gapPcs.get(t) : undefined;
      if (pcs) {
        this.gapPcs.delete(t);
        this.outPieces(pcs);
      } else if (this.gT[s] !== null) this.outText(this.gT[s]!);
      else if (this.g0[s]! >= 0) this.outRange(this.g0[s]!, this.g1[s]!);
      let f = this.found[s];
      const orig = this.xOrig.size ? this.xOrig.get(this.st[s]!) : undefined;
      if (orig !== undefined) {
        this.xOrig.delete(this.st[s]!);
        // Decision 36e: the word as phase 1 output it is what the callbacks name; an English
        // `x` written `×` is normalisation (no call), a donor (`х`, `χ`) a reported conversion.
        if (f && f.start === this.st[s]) f = { ...f, cleaned: orig };
        else if (!f && /[^x\u00d7]/u.test(diffChars(orig, this.full[s]!)))
          f = {
            kind: 'word',
            start: this.st[s]!,
            end: this.en[s]!,
            cleaned: orig,
            result: { signals: [], scripts: [], normalized: this.full[s]! },
            resolved: null,
            replacement: this.full[s]!,
            to: null,
          };
      }
      if (f) {
        this.emitFinding(f);
        continue;
      }
      const full = this.full[s];
      if (this.fl[s]! & F_TOOBIG) {
        // Past the word cap: not judged, left as phase 1 output it.
        this.o.onWord?.(this.st[s]!, this.en[s]!, full!, full!, TOO_BIG);
      }
      if (full !== null) this.outWord(full, this.st[s]!, this.en[s]!);
      else this.outRange(this.st[s]!, this.en[s]!);
    }
  }

  private emitStyled(c: StyledChunk): void {
    this.outGap(c.gap);
    this.emitFinding(c.f);
  }

  private emitFinding(f: LetterFinding): void {
    // Decision 37 (language model; the Latin-fold model keeps its confusable `l`).
    if (this.o.model && hasCaseStroke(f.cleaned))
      f = { ...f, replacement: strokeCase(f.cleaned, f.replacement) };
    if (f.quiet) {
      this.outWord(f.replacement, f.start, f.end);
      return;
    }
    const r = f.resolved;
    // Decision 14: converted under both models, toLang only for a requested language; the ladder's rule under the language model.
    const converted = f.replacement !== f.cleaned;
    const reason: WordReason = {
      signals: f.result.signals,
      ...(r
        ? {
            converted: r.folded || converted,
            toLang: r.language,
            rule: r.rule,
          }
        : f.kind === 'word' && {
            converted,
            toLang: converted ? this.languageOf(f.to ?? null, f.replacement) : null,
          }),
    };
    this.o.onWord?.(f.start, f.end, f.cleaned, f.replacement, Object.freeze(reason));
    // A conversion with no signal (decision 30b) goes to the word callback only.
    if (f.result.signals.length) this.o.finding?.(f);
    this.outWord(f.replacement, f.start, f.end);
  }

  /** The end of the text: the last word, then the chunk with no word. */
  finish(): void {
    if (this.stopped) return;
    if (this.wait !== WAIT_NONE) this.endWait(-1);
    if (this.tOpen) this.closeToken(-1);
    if (this.yStart >= 0) this.endStyled();
    this.cutRuns(this.src.length);
    while (this.judged < this.nTok && !this.stopped) this.judge(this.judged++);
    if (this.stopped) return;
    this.flush();
    if (this.stopped) return;
    // The chunk with no word: styled runs and the text after the last word.
    for (const c of this.styledNow) this.emitStyled(c);
    this.outGap(this.takeGap());
    this.outFlush();
  }
}

const TOO_BIG: WordReason = Object.freeze({ tooBig: true });

const GREEK_RE = /^\p{Script=Greek}/u;

/**
 * Math switch 3 (decision 30h.3): `'mixed'` for a word whose letters are all
 * Math letters (Latin, Greek, math letters, `µ`, `ℓ`) mixing Latin and Greek;
 * `'native'` for any other word of Math letters (`ρσ`, `xℓ`); null otherwise
 * (judged as usual).
 */
function mathWord(word: string): 'mixed' | 'native' | null {
  let lat = false;
  let gr = false;
  let math = false;
  for (const ch of word) {
    const cp = ch.codePointAt(0)!;
    const e = neutralInfo(cp);
    // A neutral that is no Math letter (`ⅽ`, `ⓐ`, `🄰`, `©`) converts and reports as usual (review 13).
    if (e && e.category !== 'disguise' && cp !== 0xb5 && cp !== 0x2113) return null;
    if (!LETTER_RE.test(ch)) continue;
    if (cp === 0xb5 || cp === 0x2113 || e?.category === 'disguise') {
      math = true;
      continue;
    }
    const b = ch.normalize('NFD').codePointAt(0)!;
    if ((b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a)) lat = true;
    else if ((b >= 0x391 && b <= 0x3c9 && b !== 0x3a2) || b === 0x3f3 || b === 0x37f) gr = true;
    else return null;
  }
  if (lat && gr) return 'mixed';
  return lat || gr || math ? 'native' : null;
}

/** A word whose letters are math letters, or math letters and Greek (decision 30h, switch 1). */
function isMathWord(word: string): boolean {
  let math = false;
  for (const ch of word) {
    if (!LETTER_RE.test(ch)) continue;
    const e = neutralInfo(ch.codePointAt(0)!);
    if (e?.category === 'disguise') math = true;
    else if (!GREEK_RE.test(ch)) return false;
  }
  return math;
}

/** A unit of a word's output: a character with the characters of class `attach` after it (review 7 B). */
const startsUnit = (ch: string, attach: number) => !(cpFlags(ch.codePointAt(0)!) & attach);

/** A text's units; the first starts the first unit whatever it is. */
function units(text: string, attach: number): string[] {
  const out: string[] = [];
  for (const ch of text) {
    if (out.length === 0 || startsUnit(ch, attach)) out.push(ch);
    else out[out.length - 1] += ch;
  }
  return out;
}

/** How many units `text` adds to the units before it (`first`: nothing comes before). */
function unitCount(text: string, first: boolean, attach: number): number {
  let n = 0;
  for (const ch of text) if ((first && n === 0) || startsUnit(ch, attach)) n++;
  return n;
}
