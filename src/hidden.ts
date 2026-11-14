/**
 * Strict hidden-character cleanup (docs/confusion-model.md §7): one rule per
 * class of invisible character, removal counters by word, and decoded
 * payloads. Reference behaviour: `cleanup` in scripts/prototype-cleanup.mjs.
 *
 * Every class's action is configurable (`HiddenCharRules`); the defaults are
 * the owner's rule set of §7.1. Legitimate uses — joiners between letters of
 * a joining script, one valid variation selector, RGI emoji sequences — are
 * always kept, except RTL marks in RTL text, which have their own rule.
 *
 * Cost: a sparse regex finds candidate code points; text without any costs
 * one regex scan. RGI emoji matching runs only around a hidden run that
 * touches an emoji character.
 *
 * Hidden content (§18): with `reportContent`, or with 'remove-with-content' on
 * a rule, `content` lists what was hidden, decoded or in logical order. Without
 * either, none of that code runs.
 */

import { primaryScript } from './scripts';
import type { PseudoScript, ScriptName } from './scripts';

/** What to do with a hidden character the rules do not keep. */
export type HiddenAction = 'remove-counted' | 'remove-silent' | 'keep';

/**
 * The action of a rule whose characters can hide content. 'remove-with-content'
 * removes the content too: for `bidiOverrides` the reordered span with its
 * controls; for `tags`, `variationSelectors` and `zeroWidthRun` the run is the
 * content, so it acts as 'remove-counted'. Either way `content` is reported.
 */
export type HiddenContentAction = HiddenAction | 'remove-with-content';

export interface HiddenCharRules {
  /** U+00AD. Default 'remove-silent'. Upstream behaviour: 'remove-counted'; corpus wants 'keep' in German compounds. */
  softHyphen: HiddenAction;
  /** U+FEFF at the start of the text. Default 'remove-silent'. */
  leadingBom: HiddenAction;
  /** A zero-width run (shorter than the threshold) with whitespace or a text edge on both sides. Default 'remove-silent'. */
  isolatedZeroWidth: HiddenAction;
  /** A zero-width run between Thai/Lao/Khmer/Myanmar/Tibetan/CJK letters (a word-break hint). Default 'remove-silent'. */
  wordBreakHint: HiddenAction;
  /** A single ZWNJ/ZWJ between two letters outside a joining script (German `Auf\u200Clage`). Default 'remove-counted'. */
  joinerInWord: HiddenAction;
  /** Any other zero-width run touching a word on either side. Default 'remove-counted'. */
  zeroWidthInWord: HiddenAction;
  /** A zero-width run of at least `zeroWidthRunThreshold` code points (steganography). Default 'remove-counted'. */
  zeroWidthRun: HiddenContentAction;
  /** Run length from which a zero-width run is a payload, wherever it sits. Default 4. */
  zeroWidthRunThreshold: number;
  /** U+202A–202E embeddings/overrides. Default 'remove-counted'. 'remove-with-content' also removes what an LRO/RLO reorders. */
  bidiOverrides: HiddenContentAction;
  /** LRM, RLM, ALM, isolates in a text with no RTL letters. Default 'remove-counted'. */
  bidiMarks: HiddenAction;
  /** The same marks in a text with RTL letters. Default 'keep'. */
  bidiMarksInRtlText: HiddenAction;
  /** Selectors beyond the first valid one, and orphans. Default 'remove-counted'. */
  variationSelectors: HiddenContentAction;
  /** Tag characters outside RGI emoji tag sequences. Default 'remove-counted'. */
  tags: HiddenContentAction;
  /** Hangul fillers, Braille blank, U+1D159: a space between visible characters, else removed. Default 'remove-counted'. */
  blankFillers: HiddenAction;
  /** U+180E, U+2061–2065, CGJ, U+206A–206F, U+FFF0–FFFB, U+E0080–E00FF, U+E01F0–E0FFF and the remaining invisible format characters. Default 'remove-counted'. */
  otherInvisibles: HiddenAction;
  /** C0 controls except tab, LF, CR; DEL; C1 controls; U+FFFE. A CSI sequence (`ESC[31m`, U+009B) as one. VT, FF and NEL become a space. Default 'remove-counted'. */
  controlChars: HiddenAction;
  /** Marks past the limit on a base of a script that stacks marks ({@link MARK_STACK_LIMITS}): kept up to the limit. Default 'remove-counted'. */
  markStacks: HiddenContentAction;
  /** The same on a base of a script that does not (Latin, Cyrillic, Greek, …). Default 'remove-counted'; strict `analyze` leaves them to its `zalgo` signal. */
  markStacksOther: HiddenContentAction;
  /** Per-script overrides of {@link MARK_STACK_LIMITS}. */
  markStackLimits?: Partial<Record<ScriptName | PseudoScript, number>>;
  /** Decode tag / variation-selector / zero-width-binary payloads of removed runs. Default true. */
  decodePayloads: boolean;
  /** Report `content`, the list of what was hidden. Default false; on whenever a rule is 'remove-with-content'. */
  reportContent?: boolean;
}

/** The owner's rule set (§7.1): `hiddenChars: 'strict'` without overrides. */
export const STRICT_HIDDEN_RULES: Readonly<HiddenCharRules> = {
  softHyphen: 'remove-silent',
  leadingBom: 'remove-silent',
  isolatedZeroWidth: 'remove-silent',
  wordBreakHint: 'remove-silent',
  joinerInWord: 'remove-counted',
  zeroWidthInWord: 'remove-counted',
  zeroWidthRun: 'remove-counted',
  zeroWidthRunThreshold: 4,
  bidiOverrides: 'remove-counted',
  bidiMarks: 'remove-counted',
  bidiMarksInRtlText: 'keep',
  variationSelectors: 'remove-counted',
  tags: 'remove-counted',
  blankFillers: 'remove-counted',
  otherInvisibles: 'remove-counted',
  controlChars: 'remove-counted',
  markStacks: 'remove-counted',
  markStacksOther: 'remove-counted',
  decodePayloads: true,
  reportContent: false,
};

export type HiddenClass =
  /** U+202A–202E: embeddings and overrides. */
  | 'bidiOverride'
  /** Marks past the limit of their base's script. */
  | 'markStack'
  /** Every code point of a span removed by 'remove-with-content', its controls included. */
  | 'bidiOverrideSpan'
  /** LRM, RLM, ALM, isolates. */
  | 'bidiMark'
  | 'tag'
  | 'variationSelector'
  | 'zeroWidthRun'
  | 'zeroWidthInWord'
  | 'otherInvisible'
  | 'controlChar'
  | 'blankFiller'
  | 'softHyphen'
  | 'zeroWidth'
  | 'bom';

export interface HiddenFinding {
  /** The whitespace-delimited chunk as written. */
  word: string;
  /** UTF-16 offset of the chunk. */
  index: number;
  /** Code points removed from the chunk, by class (silent ones included). */
  removed: Partial<Record<HiddenClass, number>>;
}

export interface HiddenPayload {
  kind: 'tag' | 'variation-selector' | 'zero-width-binary';
  /** UTF-16 offset of the run. */
  index: number;
  /** Code points in the run. */
  length: number;
  /** Printable decoded text, or null. */
  decoded: string | null;
  /** When `decoded` is null: the first {@link PAYLOAD_HEX_CAP} bytes as hex, '…' if longer. */
  bytesHex?: string;
}

export type HiddenContentKind =
  /** Tag characters, decoded as ASCII. */
  | 'tag'
  /** Selectors decoded as bytes. */
  | 'variation-selector'
  /** A two-symbol zero-width run decoded as bits. */
  | 'zero-width-binary'
  /** A zero-width run with no byte reading. */
  | 'zero-width-run'
  /** A run mixing other invisible characters (U+2062/U+2064 bits, fillers, soft hyphens); decoded as bits if it has two symbols. */
  | 'invisible-run'
  /** Letters with more marks than their script writes, which makes the line unreadable: `text` is the letters with the marks kept. */
  | 'mark-stack'
  /** An LRO/RLO that reverses letters or digits: `text` is the logical order, the screen shows another. */
  | 'bidi-override'
  /** An RTL embedding or isolate whose RLM/ALM swaps Latin words in a span with no RTL letter. */
  | 'bidi-mark-reorder';

/** One hidden thing. All offsets are UTF-16 offsets into the input. */
export interface HiddenContent {
  kind: HiddenContentKind;
  /** Start of the construct. */
  index: number;
  /** End of the construct (exclusive). */
  end: number;
  /** Code points: the carriers of an encoded run; the whole span of a bidi or mark-stack entry. */
  length: number;
  /** Decoded text, or the span in logical order without bidi controls. Null when there is no reading. */
  text: string | null;
  /** `text` is printable (encoded kinds) or has a visible character (bidi, mark-stack). */
  readable: boolean;
  /** The construct is gone from `cleaned`. A kept entry is still there. */
  removed: boolean;
  /** When an encoded run has no text: the first {@link PAYLOAD_HEX_CAP} bytes as hex, '…' if longer. */
  bytesHex?: string;
  /** One payload spread over several runs (one selector per letter): the ranges of its carriers. `text` is all of them joined. */
  parts?: { start: number; end: number }[];
}

export interface HiddenReport {
  findings: HiddenFinding[];
  payloads: HiddenPayload[];
  /** What was hidden, in input order. Only with `reportContent` or a 'remove-with-content' rule. */
  content?: HiddenContent[];
  /** Code points removed over the whole text, by class. */
  removed: {
    counted: Partial<Record<HiddenClass, number>>;
    silent: Partial<Record<HiddenClass, number>>;
  };
}

/** One cleanup edit: input range [start, end) (UTF-16 offsets) replaced by `value` ('' or ' '). */
export interface HiddenEdit {
  start: number;
  end: number;
  value: string;
}

export interface HiddenCleanup extends HiddenReport {
  cleaned: string;
  /** Edits in input order, non-overlapping. Use them to map input offsets onto `cleaned`. */
  edits: HiddenEdit[];
}

/** Raw bytes of an undecodable payload are reported up to this many. */
export const PAYLOAD_HEX_CAP = 32;

// ---------------------------------------------------------------------------

/** Candidate code points (UTF-16 level, no `u` flag): every class below. */
const CANDIDATE_RE =
  // eslint-disable-next-line no-misleading-character-class -- a code point list, not graphemes
  /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u2800\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF0-\uFFFB]|\uDB40[\uDC00-\uDFFF]|[\uDB41-\uDB43][\uDC00-\uDFFF]|\uD834[\uDD59\uDD73-\uDD7A]|\uD82F[\uDCA0-\uDCA3]|\uD80D[\uDC30-\uDC3F]|\uD804\uDCB1/g;

/** An RTL character. U+061C is a mark with Script=Arabic: it says nothing about the text it sits in. */
const RTL_RE =
  /(?!\u061C)[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Adlam}\p{Script=Samaritan}\p{Script=Mandaic}]/u;
const LETTER_RE = /^\p{L}/u;
const MARK_RE = /^\p{M}/u;
const EMOJI_RE = /^\p{Emoji}/u;
const MATH_RE = /^\p{Sm}/u;
const HAN_RE = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const MONGOLIAN_RE = /^\p{Script_Extensions=Mongolian}/u;
const PRINTABLE_RE = /[\p{L}\p{N}\p{P}\p{Zs}]/u;
const ZWSP_HINT_RE =
  /^[\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}\p{Script=Tibetan}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const VIRAMA_RE =
  /^[\u094d\u09cd\u0a4d\u0acd\u0b4d\u0bcd\u0c4d\u0ccd\u0d4d\u0dca\u1039\u103a\u17d2]/u;
/** Scripts whose orthography uses ZWNJ/ZWJ between letters. */
const JOINER_RE = [
  'Arabic',
  'Syriac',
  'Nko',
  'Mongolian',
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
  'Khmer',
  'Myanmar',
  'Tibetan',
  'Kaithi',
].map((s) => new RegExp(`^\\p{Script_Extensions=${s}}`, 'u'));
const KHMER_RE = /^\p{Script_Extensions=Khmer}/u;
const KAITHI_RE = /^\p{Script_Extensions=Kaithi}/u;
/** Characters an emoji sequence is built from; a hidden run touching one may be inside a sequence. */
const EMOJI_SEQ_RE =
  // eslint-disable-next-line no-misleading-character-class -- a code point list, not graphemes
  /^[\p{Emoji}\p{Emoji_Component}\p{Emoji_Modifier}\u200D\uFE0F\u20E3\u{E0020}-\u{E007F}]/u;
let rgiRe: RegExp | null = null;
const rgi = () => (rgiRe ??= new RegExp('\\p{RGI_Emoji}', 'vy'));

const isZW = (cp: number) =>
  cp === 0x200b || cp === 0x200c || cp === 0x200d || cp === 0x2060 || cp === 0xfeff;
const isBidiEmbed = (cp: number) => cp >= 0x202a && cp <= 0x202e;
const isBidiSoft = (cp: number) =>
  cp === 0x200e || cp === 0x200f || cp === 0x061c || (cp >= 0x2066 && cp <= 0x2069);
const isVS = (cp: number) =>
  (cp >= 0xfe00 && cp <= 0xfe0f) ||
  (cp >= 0xe0100 && cp <= 0xe01ef) ||
  (cp >= 0x180b && cp <= 0x180d) ||
  cp === 0x180f;
const isTag = (cp: number) => cp >= 0xe0000 && cp <= 0xe007f;
const isOtherInvisible = (cp: number) =>
  cp === 0x180e ||
  (cp >= 0x2061 && cp <= 0x2065) ||
  cp === 0x034f ||
  (cp >= 0x206a && cp <= 0x206f) ||
  (cp >= 0xfff0 && cp <= 0xfffb) ||
  (cp >= 0x1d173 && cp <= 0x1d17a) ||
  (cp >= 0x1bca0 && cp <= 0x1bca3) ||
  (cp >= 0x13430 && cp <= 0x1343f) ||
  (cp >= 0xe0080 && cp <= 0xe00ff) ||
  (cp >= 0xe01f0 && cp <= 0xe0fff);
const isBidi = (cp: number) => isBidiEmbed(cp) || isBidiSoft(cp);
/** Characters that can carry a run of bits; tags and selectors have their own encodings. */
const isCarrier = (cp: number) =>
  isZW(cp) ||
  cp === 0x00ad ||
  isBidiEmbed(cp) ||
  isBidiSoft(cp) ||
  isBlank(cp) ||
  isOtherInvisible(cp);
const isBlank = (cp: number) =>
  cp === 0x115f ||
  cp === 0x1160 ||
  cp === 0x3164 ||
  cp === 0xffa0 ||
  cp === 0x2800 ||
  cp === 0x1d159;
/** JS `\s` minus U+FEFF (a hidden character here, not a separator). */
const isWS = (cp: number) =>
  cp === 0x20 ||
  (cp >= 0x09 && cp <= 0x0d) ||
  cp === 0xa0 ||
  cp === 0x1680 ||
  (cp >= 0x2000 && cp <= 0x200a) ||
  cp === 0x2028 ||
  cp === 0x2029 ||
  cp === 0x202f ||
  cp === 0x205f ||
  cp === 0x3000;

const vsByte = (cp: number) =>
  cp >= 0xfe00 && cp <= 0xfe0f ? cp - 0xfe00 : cp >= 0xe0100 ? cp - 0xe0100 + 16 : -1;
function printable(s: string): boolean {
  let n = 0;
  let ok = 0;
  for (const c of s) {
    n++;
    if (PRINTABLE_RE.test(c)) ok++;
  }
  return n > 0 && ok / n >= 0.9;
}
const utf8 = new TextDecoder('utf-8', { fatal: false });
const hex = (bytes: number[]) =>
  bytes
    .slice(0, PAYLOAD_HEX_CAP)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('') + (bytes.length > PAYLOAD_HEX_CAP ? '…' : '');

type Decoded = { decoded: string } | { decoded: null; bytes: number[] } | null;
function decodeVS(cps: number[]): Decoded {
  const bytes = cps.map(vsByte).filter((b) => b >= 0);
  if (bytes.length < 2) return null;
  const s = utf8.decode(Uint8Array.from(bytes));
  return printable(s) ? { decoded: s } : { decoded: null, bytes };
}
function decodeTags(cps: number[]): Decoded {
  let s = '';
  for (const c of cps) if (c > 0xe0000 && c < 0xe007f) s += String.fromCharCode(c - 0xe0000);
  return s.length ? { decoded: s } : null;
}
/** Two-symbol binary over a zero-width run; both polarities, 8-bit MSB-first. */
function decodeZW(cps: number[]): Decoded {
  const syms = [...new Set(cps)];
  if (cps.length < 8 || syms.length !== 2) return null;
  const bytesFor = (zero: number) => {
    const bytes: number[] = [];
    for (let i = 0; i + 8 <= cps.length; i += 8) {
      let b = 0;
      for (let k = 0; k < 8; k++) b = (b << 1) | (cps[i + k] === zero ? 0 : 1);
      bytes.push(b);
    }
    return bytes;
  };
  for (const zero of syms) {
    const s = utf8.decode(Uint8Array.from(bytesFor(zero)));
    if (printable(s)) return { decoded: s };
  }
  return { decoded: null, bytes: bytesFor(syms[0]!) };
}

/** The whole character ending at code unit `i` (exclusive), or ''. */
function charBefore(text: string, i: number): string {
  if (i <= 0) return '';
  const u = text.charCodeAt(i - 1);
  if (u >= 0xdc00 && u <= 0xdfff && i >= 2) {
    const h = text.charCodeAt(i - 2);
    if (h >= 0xd800 && h <= 0xdbff) return text.slice(i - 2, i);
  }
  return text[i - 1]!;
}
function charAt(text: string, i: number): string {
  if (i >= text.length) return '';
  const cp = text.codePointAt(i)!;
  return cp > 0xffff ? text.slice(i, i + 2) : text[i]!;
}
const cpLen = (cp: number) => (cp > 0xffff ? 2 : 1);

// --- Bidi spans ------------------------------------------------------------

const RTL_MARK = new Set([0x200f, 0x061c]);
/** Bidi_Class R/AL blocks (their default class, UAX #44); only letters are asked about. */
const isRtlBlock = (cp: number) =>
  (cp >= 0x0590 && cp <= 0x08ff) ||
  (cp >= 0xfb1d && cp <= 0xfdff) ||
  (cp >= 0xfe70 && cp <= 0xfefc) ||
  (cp >= 0x10800 && cp <= 0x10fff) ||
  (cp >= 0x1e800 && cp <= 0x1efff);
const SKIP_RE = /^[\p{M}\p{Cf}\p{Z}\p{Cc}]/u;
const NUMBER_RE = /^\p{N}/u;
const BIDI_CONTROLS_RE = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
const VISIBLE_RE = /[^\s\p{M}\p{Cf}\p{Cc}]/u;
/** Controls and paragraph separators (Bidi_Class B) the frame stack reacts to. */
// eslint-disable-next-line no-control-regex -- paragraph separators
const BIDI_EVENT_RE = /[\n\r\u001C-\u001E\u0085\u2029\u202A-\u202E\u2066-\u2069]/g;

const RLE = 0x202b;
const PDF = 0x202c;
const LRO = 0x202d;
const RLO = 0x202e;
const RLI = 0x2067;
const FSI = 0x2068;
const PDI = 0x2069;
const isIsolate = (cp: number) => cp >= 0x2066 && cp <= 0x2068;

/** A strong right-to-left letter, a strong left-to-right one, a number, other visible, an RLM/ALM. */
type BidiUnit = 'R' | 'L' | 'D' | 'N' | 'M';

function bidiUnit(c: string): BidiUnit | null {
  const cp = c.codePointAt(0)!;
  if (RTL_MARK.has(cp)) return 'M';
  if (SKIP_RE.test(c)) return null;
  if (NUMBER_RE.test(c)) return 'D';
  if (!LETTER_RE.test(c)) return 'N';
  return isRtlBlock(cp) ? 'R' : 'L';
}

interface BidiFrame {
  cp: number;
  start: number;
  /** Letters or digits against the forced direction since the last letter with it. */
  against: number;
  reverses: boolean;
  visible: number;
  hasR: boolean;
  hasL: boolean;
  hasD: boolean;
  /** For an FSI: its first strong character was right-to-left. */
  rtlBase: boolean;
  /** An RLM/ALM after a Latin letter; a Latin letter after that. */
  markAfterL: boolean;
  swapsWords: boolean;
}

function note(f: BidiFrame, u: BidiUnit): void {
  if (u === 'M') {
    if (f.cp === FSI && !f.hasL && !f.hasR) f.rtlBase = true;
    f.markAfterL ||= f.hasL;
    return;
  }
  f.visible += 1;
  if (u === 'R') {
    if (f.cp === FSI && !f.hasL && !f.hasR) f.rtlBase = true;
    f.hasR = true;
  } else if (u === 'L') {
    f.hasL = true;
    if (f.markAfterL) f.swapsWords = true;
  } else if (u === 'D') f.hasD = true;
  if (f.cp === RLO) {
    if (u === 'L' || u === 'D') {
      f.against += 1;
      if (f.against >= 2) f.reverses = true;
    } else if (u === 'R') f.against = 0;
  } else if (f.cp === LRO) {
    if (u === 'R') {
      f.against += 1;
      if (f.against >= 2) f.reverses = true;
    } else if (u === 'L') f.against = 0;
  }
}

interface BidiSpan {
  kind: 'bidi-override' | 'bidi-mark-reorder';
  start: number;
  end: number;
}

/**
 * The spans whose letters the screen shows in another order than the text has,
 * by the explicit-level rules of UAX #9 (X1–X8) without the depth limit: a
 * frame ends at its PDF, at the PDI of an enclosing isolate, or at the end of
 * the paragraph; embeddings and isolates inside an override are one unit to it.
 *
 * - LRO/RLO reverse: two letters or digits in a row against the forced direction
 *   (`\u202Egnp.exe`). Same-direction text is shown as it would be anyway, so
 *   `\u202Eשלום\u202C` is not a span; one letter alone has no order to reverse.
 *   An RLO with no RTL letter reverses any two visible characters.
 * - An RTL embedding or isolate swaps Latin words only through an RLM/ALM, in a
 *   span without RTL letters (`\u202Babc\u200F def\u202C`).
 *
 * Nested spans of one kind: the outermost. `extraBreaks`: offsets that were
 * paragraph separators in the input, ascending.
 */
function scanBidi(text: string, extraBreaks: readonly number[]): BidiSpan[] {
  if (!/[\u202A-\u202E\u2066-\u2068]/.test(text)) return [];
  const spans: BidiSpan[] = [];
  const stack: BidiFrame[] = [];
  let isolates = 0;

  const close = (end: number) => {
    const f = stack.pop()!;
    if (isIsolate(f.cp)) isolates -= 1;
    if (f.cp === LRO || f.cp === RLO) {
      if (f.reverses || (f.cp === RLO && !f.hasR && f.visible >= 2))
        spans.push({ kind: 'bidi-override', start: f.start, end });
    } else if (
      (f.cp === RLE || f.cp === RLI || (f.cp === FSI && f.rtlBase)) &&
      f.swapsWords &&
      !f.hasR
    )
      spans.push({ kind: 'bidi-mark-reorder', start: f.start, end });
    const parent = stack[stack.length - 1];
    if (parent) {
      const u = f.hasR ? 'R' : f.hasL ? 'L' : f.hasD ? 'D' : f.visible > 0 ? 'N' : null;
      if (u) note(parent, u);
    }
  };
  const closeAll = (end: number) => {
    while (stack.length) close(end);
  };
  /** Feed [from, to) to the innermost frame. */
  const feed = (from: number, to: number) => {
    const top = stack[stack.length - 1];
    if (!top) return;
    for (const c of text.slice(from, to)) {
      const u = bidiUnit(c);
      if (u) note(top, u);
    }
  };

  let cursor = 0;
  let b = 0;
  const flushBreaks = (upTo: number) => {
    for (; b < extraBreaks.length && extraBreaks[b]! <= upTo; b++) {
      feed(cursor, extraBreaks[b]!);
      cursor = extraBreaks[b]!;
      closeAll(cursor);
    }
  };
  for (const m of text.matchAll(BIDI_EVENT_RE)) {
    const i = m.index;
    flushBreaks(i);
    feed(cursor, i);
    cursor = i + 1;
    const c = text.charCodeAt(i);
    if (c >= 0x202a && c <= 0x202e && c !== PDF) {
      stack.push(frame(c, i));
    } else if (isIsolate(c)) {
      stack.push(frame(c, i));
      isolates += 1;
    } else if (c === PDF) {
      const top = stack[stack.length - 1];
      if (top && !isIsolate(top.cp)) close(i + 1);
    } else if (c === PDI) {
      if (isolates > 0) {
        while (!isIsolate(stack[stack.length - 1]!.cp)) close(i);
        close(i + 1);
      }
    } else if (stack.length) closeAll(i);
  }
  flushBreaks(text.length);
  feed(cursor, text.length);
  closeAll(text.length);

  spans.sort((x, y) => x.start - y.start || y.end - x.end);
  const reach = { 'bidi-override': -1, 'bidi-mark-reorder': -1 };
  return spans.filter((s) => {
    if (s.start < reach[s.kind]) return false;
    reach[s.kind] = s.end;
    return true;
  });
}

const frame = (cp: number, start: number): BidiFrame => ({
  cp,
  start,
  against: 0,
  reverses: false,
  visible: 0,
  hasR: false,
  hasL: false,
  hasD: false,
  rtlBase: false,
  markAfterL: false,
  swapsWords: false,
});

// --- Mark stacks ------------------------------------------------------------

/**
 * Most marks one base keeps, by the script of the base; above it the marks stop
 * being writing and the line stops being readable. Set above what real text
 * writes (§18.6): a Thai vowel and tone, a Hebrew letter with dagesh, vowel and
 * cantillation, a Tibetan mantra stack, a Vietnamese vowel in NFD. A script not
 * listed gets {@link MARK_STACK_DEFAULT_LIMIT}.
 */
export const MARK_STACK_LIMITS: Readonly<Partial<Record<ScriptName | PseudoScript, number>>> = {
  // Scripts that stack marks.
  Arabic: 5,
  Syriac: 5,
  Nko: 5,
  Mongolian: 5,
  Thaana: 5,
  Devanagari: 5,
  Bengali: 5,
  Gurmukhi: 5,
  Gujarati: 5,
  Oriya: 5,
  Tamil: 5,
  Telugu: 5,
  Kannada: 5,
  Malayalam: 5,
  Sinhala: 5,
  Thai: 3,
  Lao: 3,
  Myanmar: 5,
  Khmer: 5,
  Tibetan: 10,
  Hebrew: 5,
  Kaithi: 5,
  // Scripts that do not: rule `markStacksOther`.
  Latin: 2,
  Cyrillic: 2,
  Greek: 3,
  Armenian: 2,
  Georgian: 2,
  Cherokee: 2,
  Han: 2,
  Hiragana: 2,
  Katakana: 2,
  Hangul: 2,
  Common: 2,
  Inherited: 2,
};
export const MARK_STACK_DEFAULT_LIMIT = 5;

/** Marks on these go by `markStacksOther`: `analyze` has its zalgo signal for them. */
const LOW_STACK_SCRIPTS = new Set<ScriptName | PseudoScript>([
  'Latin',
  'Cyrillic',
  'Greek',
  'Armenian',
  'Georgian',
  'Cherokee',
  'Han',
  'Hiragana',
  'Katakana',
  'Hangul',
  'Common',
  'Inherited',
]);

/** Three marks or format characters in a row: the fewest that can pass a limit of 2. */
const STACK_RE = /[\p{M}\p{Cf}]{3,}/gu;
const MARK_RE_G = /^\p{M}/u;
/** Marks that count as hidden characters, not as ink; a format character is no mark either. */
const isHiddenMark = (cp: number) =>
  isVS(cp) ||
  cp === 0x034f ||
  cp === 0x17b4 ||
  cp === 0x17b5 ||
  cp === 0x110b1 ||
  cp === 0x1d159 ||
  isOtherInvisible(cp);

function stackScript(base: string): ScriptName | PseudoScript {
  // The kashida is Common, and carries Arabic marks.
  return base === '\u0640' ? 'Arabic' : primaryScript(base);
}

/**
 * Trims stacks past their limit, counting through hidden characters so one
 * can't split a stack: `remove(start, end, marks, action)` for each range of
 * excess marks, outside `gone` spans. `raw`, when reporting, gets one entry per stack.
 */
function trimMarkStacks(
  text: string,
  rules: Readonly<HiddenCharRules>,
  gone: readonly BidiSpan[],
  raw: RawContent[] | null,
  remove: (start: number, end: number, marks: number, action: HiddenContentAction) => void,
): void {
  let sp = 0;
  for (const m of text.matchAll(STACK_RE)) {
    const base = charBefore(text, m.index);
    const script = stackScript(base);
    const limit =
      rules.markStackLimits?.[script] ?? MARK_STACK_LIMITS[script] ?? MARK_STACK_DEFAULT_LIMIT;
    const action =
      (LOW_STACK_SCRIPTS.has(script) ? rules.markStacksOther : rules.markStacks) ??
      STRICT_HIDDEN_RULES.markStacks;
    let marks = 0;
    let keptEnd = m.index;
    let last = m.index;
    let from = -1;
    let n = 0;
    let keptText = base;
    const flush = (end: number) => {
      if (from < 0) return;
      while (sp < gone.length && gone[sp]!.end <= from) sp++;
      const span = gone[sp];
      if (!(span && span.start <= from && from < span.end)) remove(from, end, n, action);
      from = -1;
      n = 0;
    };
    let at = m.index;
    for (const c of m[0]) {
      const cp = c.codePointAt(0)!;
      const real = MARK_RE_G.test(c) && !isHiddenMark(cp);
      if (real) {
        marks += 1;
        last = at + c.length;
        if (marks <= limit) {
          keptEnd = last;
          keptText += c;
        } else if (action !== 'keep') {
          if (from < 0) from = at;
          n += 1;
        }
      } else flush(at);
      at += c.length;
    }
    flush(last);
    if (marks > limit && raw) {
      const start = m.index - base.length;
      raw.push({ kind: 'mark-stack', start, end: last, kept: keptEnd - start, text: keptText });
    }
  }
}

// --- Hidden content list ----------------------------------------------------

/** Most code units between two small runs of one payload; one carrier per word still fits. */
const SCATTER_GAP = 32;

type EncodedKind = 'tag' | 'variation-selector' | 'zero-width-binary';

interface RawContent {
  kind: HiddenContentKind;
  start: number;
  end: number;
  /** Carriers of an encoded run. */
  cps?: number[];
  /** Leading code units that stay: a valid first selector; a base with the marks it keeps. */
  kept: number;
  /** Text of a mark stack: the base with the marks it keeps. */
  text?: string;
}

/** A selector run or scattered selectors: bytes even for a single one. */
function decodeContent(kind: HiddenContentKind, cps: number[]): Decoded {
  if (kind === 'tag') return decodeTags(cps);
  if (kind === 'variation-selector') {
    const r = decodeVS(cps);
    if (r) return r;
    const bytes = cps.map(vsByte).filter((v) => v >= 0);
    return bytes.length ? { decoded: null, bytes } : null;
  }
  return decodeZW(cps);
}

const isSmallRun = (kind: EncodedKind, r: RawContent) =>
  r.cps!.length <= (kind === 'zero-width-binary' ? 16 : 2);

/**
 * The finished list: in input order, runs of one scattered payload merged, and
 * `removed` read off the edits.
 */
function buildContent(
  raw: RawContent[],
  text: string,
  edits: readonly HiddenEdit[],
): HiddenContent[] {
  raw.sort((a, b) => a.start - b.start || b.end - a.end);
  /** Whether edits cover [from, to). */
  const covered = (from: number, to: number) => {
    let lo = 0;
    let hi = edits.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (edits[mid]!.end <= from) lo = mid + 1;
      else hi = mid;
    }
    let at = from;
    for (let e = lo; at < to && e < edits.length && edits[e]!.start <= at; e++) at = edits[e]!.end;
    return at >= to;
  };

  const last: Partial<Record<EncodedKind, { run: RawContent; entry: HiddenContent }>> = {};
  const carriers = new Map<HiddenContent, number[]>();
  const out: HiddenContent[] = [];
  for (const r of raw) {
    const removed = covered(r.start + r.kept, r.end);
    if (r.kind === 'bidi-override' || r.kind === 'bidi-mark-reorder') {
      const logical = text.slice(r.start, r.end).replace(BIDI_CONTROLS_RE, '');
      out.push({
        kind: r.kind,
        index: r.start,
        end: r.end,
        length: [...text.slice(r.start, r.end)].length,
        text: logical,
        readable: VISIBLE_RE.test(logical),
        removed,
      });
      continue;
    }
    if (r.kind === 'mark-stack') {
      // Stacks letter after letter are one entry.
      const prev = out[out.length - 1];
      const n = [...text.slice(r.start, r.end)].length;
      if (prev?.kind === 'mark-stack' && prev.end === r.start) {
        prev.end = r.end;
        prev.length += n;
        prev.text += r.text!;
        prev.removed &&= removed;
      } else {
        out.push({
          kind: r.kind,
          index: r.start,
          end: r.end,
          length: n,
          text: r.text!,
          readable: VISIBLE_RE.test(r.text!),
          removed,
        });
      }
      continue;
    }
    const kind = r.kind as EncodedKind;
    const prev = last[kind];
    if (
      prev &&
      isSmallRun(kind, r) &&
      isSmallRun(kind, prev.run) &&
      r.start - prev.run.end <= SCATTER_GAP
    ) {
      const e = prev.entry;
      e.parts ??= [{ start: e.index, end: e.end }];
      e.parts.push({ start: r.start, end: r.end });
      e.end = r.end;
      e.length += r.cps!.length;
      e.removed &&= removed;
      for (const cp of r.cps!) carriers.get(e)!.push(cp);
      prev.run = r;
      continue;
    }
    const entry: HiddenContent = {
      kind: r.kind,
      index: r.start,
      end: r.end,
      length: r.cps!.length,
      text: null,
      readable: false,
      removed,
    };
    carriers.set(entry, [...r.cps!]);
    out.push(entry);
    last[kind] = { run: r, entry };
  }
  for (const [e, cps] of carriers) {
    const d = decodeContent(e.kind, cps);
    e.text = d?.decoded ?? null;
    e.readable = e.text !== null && printable(e.text);
    if (d && d.decoded === null) e.bytesHex = hex(d.bytes);
  }
  return out;
}

/** Control characters; built from a string, the literal would trip no-control-regex. */
const CONTROL_SOURCE =
  '(?:\\u001B\\[|\\u009B)[0-?]*[ -/]*[@-~]|[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F\\uFFFE]';
/** VT, FF and NEL separate words, as in extracted PDF text. */
const CONTROL_SPACE_RE = /^[\v\f\u0085]$/;
/** The controls with Bidi_Class B: they end a paragraph on screen, whatever becomes of them here. */
// eslint-disable-next-line no-control-regex -- paragraph separators
const CONTROL_PARAGRAPH_RE = /^[\u001C-\u001E\u0085]$/;

/**
 * Hidden-character cleanup of `text` under `rules` (defaults: {@link STRICT_HIDDEN_RULES}).
 * Controls go first, so one can't split a zero-width or tag run past the run rules.
 * Edits, findings and counters describe the input.
 */
export function cleanHidden(
  text: string,
  rules: Readonly<HiddenCharRules> = STRICT_HIDDEN_RULES,
): HiddenCleanup {
  const action = rules.controlChars ?? STRICT_HIDDEN_RULES.controlChars;
  const controls: HiddenEdit[] = [];
  const breaks: number[] = [];
  let stripped = '';
  if (action !== 'keep') {
    let cursor = 0;
    for (const m of text.matchAll(new RegExp(CONTROL_SOURCE, 'g'))) {
      const value = CONTROL_SPACE_RE.test(m[0]) ? ' ' : '';
      controls.push({ start: m.index, end: m.index + m[0].length, value });
      stripped += text.slice(cursor, m.index);
      if (CONTROL_PARAGRAPH_RE.test(m[0])) breaks.push(stripped.length);
      stripped += value;
      cursor = m.index + m[0].length;
    }
    stripped += text.slice(cursor);
  }
  if (controls.length === 0) return cleanInvisible(text, rules);
  const r = cleanInvisible(stripped, rules, breaks);

  // Where each control edit lands in the stripped text, and the shift to the input from there on.
  const landsAt: number[] = [];
  const shifts: number[] = [];
  let shift = 0;
  for (const e of controls) {
    landsAt.push(e.start - shift + e.value.length);
    shift += e.end - e.start - e.value.length;
    shifts.push(shift);
  }
  const toInput = (offset: number) => {
    let lo = 0;
    let hi = landsAt.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (landsAt[mid]! <= offset) lo = mid + 1;
      else hi = mid;
    }
    return offset + (lo === 0 ? 0 : shifts[lo - 1]!);
  };
  const hidden = r.edits.map((e) => ({
    start: toInput(e.start),
    end: toInput(e.end - 1) + 1,
    value: e.value,
  }));
  // Both lists are in order. A control inside a removed run is part of that edit.
  const edits: HiddenEdit[] = [];
  let h = 0;
  for (const c of controls) {
    while (h < hidden.length && hidden[h]!.end <= c.start) edits.push(hidden[h++]!);
    if (!(h < hidden.length && hidden[h]!.start <= c.start)) edits.push(c);
  }
  edits.push(...hidden.slice(h));

  const counted = action === 'remove-counted';
  const n = controls.length;
  const removed = {
    counted: counted ? { ...r.removed.counted, controlChar: n } : r.removed.counted,
    silent: counted ? r.removed.silent : { ...r.removed.silent, controlChar: n },
  };
  // A word counts once, whichever rules touched it.
  const findings = r.findings.map((f) => ({ ...f, index: toInput(f.index) }));
  if (counted) {
    const known = new Set(findings.map((f) => f.index));
    let k = 0;
    for (const w of stripped.matchAll(/\S+/g)) {
      while (k < landsAt.length && landsAt[k]! < w.index) k++;
      const index = toInput(w.index);
      if (k < landsAt.length && landsAt[k]! <= w.index + w[0].length && !known.has(index)) {
        findings.push({ word: w[0], index, removed: { controlChar: 1 } });
      }
    }
    findings.sort((x, y) => x.index - y.index);
  }
  return {
    cleaned: r.cleaned,
    edits,
    findings,
    payloads: r.payloads.map((p) => ({ ...p, index: toInput(p.index) })),
    ...(r.content && {
      content: r.content.map((c) => ({
        ...c,
        index: toInput(c.index),
        end: toInput(c.end - 1) + 1,
        ...(c.parts && {
          parts: c.parts.map((p) => ({ start: toInput(p.start), end: toInput(p.end - 1) + 1 })),
        }),
      })),
    }),
    removed,
  };
}

function cleanInvisible(
  text: string,
  rules: Readonly<HiddenCharRules>,
  breaks: readonly number[] = [],
): HiddenCleanup {
  const counted: Partial<Record<HiddenClass, number>> = {};
  const silent: Partial<Record<HiddenClass, number>> = {};
  const edits: HiddenCleanup['edits'] = [];
  const payloads: HiddenPayload[] = [];
  // Removals for the per-word findings: [start, end) code units, class, counted, code points.
  const rem: { start: number; end: number; cls: HiddenClass; counted: boolean; n: number }[] = [];
  const withContent = rules.bidiOverrides === 'remove-with-content';
  const report =
    rules.reportContent === true ||
    withContent ||
    rules.tags === 'remove-with-content' ||
    rules.variationSelectors === 'remove-with-content' ||
    rules.zeroWidthRun === 'remove-with-content' ||
    rules.markStacks === 'remove-with-content' ||
    rules.markStacksOther === 'remove-with-content';
  const re = CANDIDATE_RE;
  re.lastIndex = 0;
  let m = re.exec(text);

  const raw: RawContent[] = [];
  const bidi = report && m ? scanBidi(text, breaks) : [];
  for (const s of bidi) raw.push({ ...s, kept: 0 });
  /** Spans that go whole; `sp` is the one at or after the current candidate. */
  const gone = withContent ? bidi.filter((s) => s.kind === 'bidi-override') : [];
  let sp = 0;
  let invisibleRunEnd = 0;
  let sortEdits = false;

  let hasRTL: boolean | null = null;
  let prot: Uint8Array | null = null;
  let protFrom = Infinity;
  let protTo = -1;
  /** Marks RGI emoji sequences around [i, j) (lazily, only near emoji characters). */
  const protectAround = (i: number, j: number) => {
    let s = i;
    for (let k = 0; k < 16 && s > 0 && EMOJI_SEQ_RE.test(charBefore(text, s)); k++)
      s -= charBefore(text, s).length;
    let e = j;
    for (let k = 0; k < 16 && e < text.length && EMOJI_SEQ_RE.test(charAt(text, e)); k++)
      e += charAt(text, e).length;
    if (s >= protFrom && e <= protTo) return;
    prot ??= new Uint8Array(text.length);
    const r = rgi();
    for (let p = s; p < e;) {
      r.lastIndex = p;
      const mm = r.exec(text);
      if (mm && mm[0].length) {
        prot.fill(1, p, p + mm[0].length);
        p += mm[0].length;
      } else p += cpLen(text.codePointAt(p)!);
    }
    protFrom = s;
    protTo = e;
  };
  const isProt = (i: number) => prot !== null && prot[i] === 1;
  const nearEmoji = (i: number, j: number) =>
    EMOJI_SEQ_RE.test(charBefore(text, i)) || EMOJI_SEQ_RE.test(charAt(text, j));

  const drop = (
    i: number,
    j: number,
    cls: HiddenClass,
    action: HiddenContentAction,
    n: number,
    value = '',
  ) => {
    if (action === 'keep') return false;
    // Inside a span that goes whole: already an edit. A run that outlasts the span goes on from its end.
    const span = gone[sp];
    if (span && span.start <= i && i < span.end) {
      if (j <= span.end) return true;
      i = span.end;
    }
    const isCounted = action !== 'remove-silent';
    const bucket = isCounted ? counted : silent;
    bucket[cls] = (bucket[cls] ?? 0) + n;
    edits.push({ start: i, end: j, value });
    rem.push({ start: i, end: j, cls, counted: isCounted, n });
    return true;
  };
  const payload = (kind: HiddenPayload['kind'], i: number, n: number, r: Decoded) => {
    if (!r || !rules.decodePayloads) return;
    const p: HiddenPayload = { kind, index: i, length: n, decoded: r.decoded };
    if (r.decoded === null) p.bytesHex = hex(r.bytes);
    payloads.push(p);
  };
  /** Code points of the run of `pred` starting at i (stops at protected units). */
  const run = (i: number, pred: (cp: number) => boolean) => {
    const cps: number[] = [];
    let j = i;
    while (j < text.length) {
      const cp = text.codePointAt(j)!;
      if (!pred(cp) || isProt(j)) break;
      cps.push(cp);
      j += cpLen(cp);
    }
    return { j, cps };
  };

  while (m) {
    const i = m.index;
    const c = text.codePointAt(i)!;
    let next = i + cpLen(c);
    while (sp < gone.length && gone[sp]!.end <= i) sp++;
    if (gone[sp]?.start === i) {
      const end = gone[sp]!.end;
      const n = [...text.slice(i, end)].length;
      counted.bidiOverrideSpan = (counted.bidiOverrideSpan ?? 0) + n;
      edits.push({ start: i, end, value: '' });
      rem.push({ start: i, end, cls: 'bidiOverrideSpan', counted: true, n });
    }
    if (nearEmoji(i, next) || (isZW(c) && nearEmoji(i, run(i, isZW).j))) protectAround(i, next);
    if (isProt(i)) {
      re.lastIndex = next;
      m = re.exec(text);
      continue;
    }
    if (report && i >= invisibleRunEnd && isCarrier(c)) {
      const r = run(i, isCarrier);
      invisibleRunEnd = r.j;
      if (
        r.cps.length >= rules.zeroWidthRunThreshold &&
        !r.cps.every(isZW) &&
        // Word processors pile up marks in RTL text; the rules keep them there too.
        !(r.cps.every(isBidi) && (hasRTL ??= RTL_RE.test(text)))
      )
        raw.push({ kind: 'invisible-run', start: i, end: r.j, cps: r.cps, kept: 0 });
    }
    if (c === 0x00ad) drop(i, next, 'softHyphen', rules.softHyphen, 1);
    else if (isBlank(c)) {
      // Between two visible characters it stands for a space ("click\u2800here");
      // at a word edge it only pads the word ("admin\u2800") and is dropped.
      const a = charBefore(text, i);
      const b = charAt(text, next);
      const space = a !== '' && b !== '' && !isWS(a.codePointAt(0)!) && !isWS(b.codePointAt(0)!);
      drop(i, next, 'blankFiller', rules.blankFillers, 1, space ? ' ' : '');
    } else if (c === 0x17b4 || c === 0x17b5 || c === 0x110b1) {
      // Invisible vowel signs: native in their script, hidden anywhere else.
      const prev = charBefore(text, i);
      if (!(c === 0x110b1 ? KAITHI_RE : KHMER_RE).test(prev))
        drop(i, next, 'otherInvisible', rules.otherInvisibles, 1);
    } else if (isOtherInvisible(c)) drop(i, next, 'otherInvisible', rules.otherInvisibles, 1);
    else if (isBidiEmbed(c)) drop(i, next, 'bidiOverride', rules.bidiOverrides, 1);
    else if (isBidiSoft(c)) {
      hasRTL ??= RTL_RE.test(text);
      drop(i, next, 'bidiMark', hasRTL ? rules.bidiMarksInRtlText : rules.bidiMarks, 1);
    } else if (isTag(c)) {
      const r = run(i, isTag);
      next = r.j;
      if (report) raw.push({ kind: 'tag', start: i, end: next, cps: r.cps, kept: 0 });
      if (drop(i, next, 'tag', rules.tags, r.cps.length))
        payload('tag', i, r.cps.length, decodeTags(r.cps));
    } else if (isVS(c)) {
      const r = run(i, isVS);
      next = r.j;
      // Valid: exactly one selector on a base that takes it.
      const base = charBefore(text, i);
      const validSingle =
        base !== '' &&
        (((c === 0xfe0e || c === 0xfe0f) && EMOJI_RE.test(base)) ||
          (c >= 0xe0100 && HAN_RE.test(base)) ||
          (c >= 0x180b && c <= 0x180f && MONGOLIAN_RE.test(base)) ||
          (c >= 0xfe00 && c <= 0xfe02 && (HAN_RE.test(base) || MATH_RE.test(base))));
      const from = validSingle ? i + cpLen(c) : i;
      const n = r.cps.length - (validSingle ? 1 : 0);
      if (report && n > 0)
        raw.push({
          kind: 'variation-selector',
          start: i,
          end: next,
          cps: r.cps,
          kept: from - i,
        });
      if (n > 0 && drop(from, next, 'variationSelector', rules.variationSelectors, n))
        payload('variation-selector', i, r.cps.length, decodeVS(r.cps));
    } else if (isZW(c)) {
      const r = run(i, isZW);
      next = r.j;
      const prev = charBefore(text, i);
      const after = charAt(text, next);
      const n = r.cps.length;
      const joinerOnly = r.cps.every((x) => x === 0x200c || x === 0x200d);
      const prevLetter = LETTER_RE.test(prev);
      const nextLetter = LETTER_RE.test(after);
      const legitJoiner =
        joinerOnly &&
        n === 1 &&
        (prevLetter || MARK_RE.test(prev)) &&
        JOINER_RE.some(
          (jr) =>
            jr.test(prev) &&
            (nextLetter ? jr.test(after) : r.cps[0] === 0x200d && VIRAMA_RE.test(prev)),
        );
      const edge = (s: string) => s === '' || isWS(s.codePointAt(0)!);
      if (legitJoiner) {
        // orthography: kept
      } else if (n >= rules.zeroWidthRunThreshold) {
        if (report)
          raw.push({
            kind: decodeZW(r.cps) ? 'zero-width-binary' : 'zero-width-run',
            start: i,
            end: next,
            cps: r.cps,
            kept: 0,
          });
        if (drop(i, next, 'zeroWidthRun', rules.zeroWidthRun, n))
          payload('zero-width-binary', i, n, decodeZW(r.cps));
      } else if (i === 0 && r.cps.every((x) => x === 0xfeff))
        drop(i, next, 'bom', rules.leadingBom, n);
      else if (edge(prev) && edge(after)) drop(i, next, 'zeroWidth', rules.isolatedZeroWidth, n);
      else if (ZWSP_HINT_RE.test(prev) && ZWSP_HINT_RE.test(after))
        drop(i, next, 'zeroWidth', rules.wordBreakHint, n);
      else if (joinerOnly && n === 1 && prevLetter && nextLetter)
        drop(i, next, 'zeroWidthInWord', rules.joinerInWord, n);
      else drop(i, next, 'zeroWidthInWord', rules.zeroWidthInWord, n);
    }
    re.lastIndex = next;
    m = re.exec(text);
  }

  trimMarkStacks(text, rules, gone, report ? raw : null, (start, end, n, action) => {
    const isCounted = action !== 'remove-silent';
    const bucket = isCounted ? counted : silent;
    bucket.markStack = (bucket.markStack ?? 0) + n;
    edits.push({ start, end, value: '' });
    rem.push({ start, end, cls: 'markStack', counted: isCounted, n });
    sortEdits = true;
  });
  if (sortEdits) {
    edits.sort((a, b) => a.start - b.start);
    rem.sort((a, b) => a.start - b.start);
  }

  let cleaned = text;
  if (edits.length) {
    let out = '';
    let cursor = 0;
    for (const e of edits) {
      out += text.slice(cursor, e.start) + e.value;
      cursor = e.end;
    }
    cleaned = out + text.slice(cursor);
  }

  // Counting unit = words: a whitespace-delimited chunk with at least one
  // COUNTED removal counts once, however long its payload (§7.2).
  const findings: HiddenFinding[] = [];
  let k = 0;
  while (k < rem.length) {
    let s = rem[k]!.start;
    while (s > 0) {
      const p = charBefore(text, s);
      if (isWS(p.codePointAt(0)!)) break;
      s -= p.length;
    }
    let e = rem[k]!.end;
    while (e < text.length) {
      const cp = text.codePointAt(e)!;
      if (isWS(cp)) break;
      e += cpLen(cp);
    }
    const removed: Partial<Record<HiddenClass, number>> = {};
    let hit = false;
    for (; k < rem.length && rem[k]!.start < e; k++) {
      const r = rem[k]!;
      removed[r.cls] = (removed[r.cls] ?? 0) + r.n;
      hit ||= r.counted;
    }
    if (hit) findings.push({ word: text.slice(s, e), index: s, removed });
  }
  return {
    cleaned,
    edits,
    findings,
    payloads,
    ...(report && { content: buildContent(raw, text, edits) }),
    removed: { counted, silent },
  };
}
