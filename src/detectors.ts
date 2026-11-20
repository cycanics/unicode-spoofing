/**
 * Hidden-character detectors (docs/confusion-model.md §6, §15, §17.2): each a
 * generator over the source yielding marks in position order (decision 1). They
 * read past the control layer's removals through a {@link View} (decision 5):
 * `ZW <ctl> ZW` is one run, a removed control is no neighbour, an emitted
 * default (VT → ' ') is seen as the space it becomes.
 */

import {
  charAt,
  charBefore,
  cpLen,
  EMOJI_RE,
  EMOJI_SEQ_RE,
  HAN_RE,
  isBidi,
  isBidiEmbed,
  isBidiSoft,
  isBlank,
  isCarrier,
  isOtherInvisible,
  isTag,
  isVS,
  isWS,
  isZW,
  JOINER_RE,
  KAITHI_RE,
  KHMER_RE,
  LETTER_RE,
  MARK_RE,
  MATH_RE,
  MONGOLIAN_RE,
  rgi,
  RTL_RE,
  VIRAMA_RE,
  ZWSP_HINT_RE,
} from './chars';
import type { RawMark, View } from './core';
import { ivdRegistered } from './ivd';
import { isParaSep } from './bidi';
import { primaryScript } from './scripts';
import {
  CP_INVISIBLE,
  CP_LETTER,
  CP_MARK,
  CP_TOKEN,
  CP_VARIATION,
  cpFlags,
  ZERO_WIDTH_INERT_RUN,
} from './token';
import type { PseudoScript, ScriptName } from './scripts';

/** A rule's action: today's actions plus `'ignored'` (decision 3). */
export type Action =
  | 'remove-counted'
  | 'remove-silent'
  | 'keep'
  | 'remove-with-content'
  | 'ignored'
  | 'report'
  | 'cleanup';

/** Mode and counter of an action: keep = report, remove-* = cleanup, ignored = no mark. */
export function modeOf(action: Action | undefined): RawMark['mode'] | null {
  if (action === 'ignored') return null;
  return action === 'keep' ? 'report' : 'cleanup';
}

/** The rules the detectors read (a subset of `HiddenCharRules`). */
export interface DetectorRules {
  softHyphen: Action;
  leadingBom: Action;
  isolatedZeroWidth: Action;
  wordBreakHint: Action;
  joinerInWord: Action;
  possibleLigatureBreak: Action;
  zeroWidthInWord: Action;
  zeroWidthRun: Action;
  zeroWidthRunThreshold: number;
  invisibleRun: Action;
  bidiOverrides: Action;
  bidiOverrideSpan: Action;
  bidiReorderSpan: Action;
  bidiMarks: Action;
  bidiMarksInRtlText: Action;
  variationSelectors: Action;
  tags: Action;
  blankFillers: Action;
  otherInvisibles: Action;
  invisibleMathOperators?: Action | undefined;
  markStacks: Action;
  markStacksOther: Action;
  illegal: Action;
  encodingDamage: Action;
  invisibleOutsideWord: Action;
  markStackLimits?: Partial<Record<ScriptName | PseudoScript, number>>;
  /** Decision 42e: how far phase-1 constructs reach, in code points (default {@link CONSTRUCT_LIMIT}). */
  constructLimit?: number | undefined;
}

/** Decision 42e's default reach of a phase-1 construct, in code points. */
export const CONSTRUCT_LIMIT = 4096;
/** A bidi paragraph separator (UAX #9 class B), as a search. */
// eslint-disable-next-line no-control-regex -- FS, GS, RS are paragraph separators
const PARA_SEP_G = /[\n\r\u001c-\u001e\u0085\u2029]/g;

/** What the detectors share for one text. */
export class DetectCtx {
  /** The text has no character the control layer can remove. */
  readonly layerFree: boolean;
  /** Report-mode marks are wanted (a report callback listens). */
  readonly listen: boolean;
  /** Rules whose report-mode marks are wanted whoever listens (`analyze`'s result reads them). */
  readonly always: ReadonlySet<string>;
  private prot: Uint8Array | null = null;
  private protFrom = Infinity;
  private protTo = -1;
  constructor(
    readonly source: string,
    readonly view: View,
    readonly rules: Readonly<DetectorRules>,
    opts: { listen: boolean; layerFree?: boolean; always?: ReadonlySet<string> },
  ) {
    this.layerFree = opts.layerFree === true;
    this.listen = opts.listen;
    this.always = opts.always ?? NONE;
  }
  /** Marks of `action` are produced (a report-mode rule only for a listener). */
  wants(rule: string, action: Action): boolean {
    const mode = modeOf(action);
    return mode === 'cleanup' || (mode === 'report' && (this.listen || this.always.has(rule)));
  }
  /** Decision 42g: a reader of "in right-to-left text" for one detector (ascending positions). */
  rtlParagraphs(): RtlParagraphs {
    return new RtlParagraphs(this.source, this.view, this.rules.constructLimit ?? CONSTRUCT_LIMIT);
  }
  /** A mark under `action`, or null when the rule is ignored or only reports to nobody. */
  mark(
    rule: string,
    cls: string,
    action: Action,
    start: number,
    end: number,
    n: number,
    value = '',
  ): RawMark | null {
    // Cleanup: always; report: for a listener or a rule `analyze` reads.
    const cleanup = action !== 'keep' && action !== 'ignored'; // as modeOf
    if (!cleanup && (action === 'ignored' || !(this.listen || this.always.has(rule)))) return null;
    return {
      rule,
      cls,
      start,
      end,
      n,
      value,
      mode: cleanup ? 'cleanup' : 'report',
      counted: action !== 'remove-silent',
    };
  }
  /** Marks RGI emoji sequences around [i, j) (lazily, only near emoji characters). */
  protectAround(i: number, j: number): void {
    const text = this.source;
    let s = i;
    for (let k = 0; k < 16 && s > 0 && EMOJI_SEQ_RE.test(charBefore(text, s)); k++)
      s -= charBefore(text, s).length;
    let e = j;
    for (let k = 0; k < 16 && e < text.length && EMOJI_SEQ_RE.test(charAt(text, e)); k++)
      e += charAt(text, e).length;
    if (s >= this.protFrom && e <= this.protTo) return;
    const prot = (this.prot ??= new Uint8Array(text.length));
    const r = rgi();
    for (let p = s; p < e;) {
      r.lastIndex = p;
      const mm = r.exec(text);
      if (mm && mm[0].length) {
        prot.fill(1, p, p + mm[0].length);
        p += mm[0].length;
      } else p += cpLen(text.codePointAt(p)!);
    }
    this.protFrom = s;
    this.protTo = e;
  }
  isProt(i: number): boolean {
    return this.prot !== null && this.prot[i] === 1;
  }
  nearEmoji(i: number, j: number): boolean {
    const b = this.view.beforeCp(i);
    if (b >= 0 && emojiSeq(b)) return true;
    const a = this.view.afterCp(j);
    return a >= 0 && emojiSeq(a);
  }
  /** Code points of the last {@link runEnd}. */
  readonly buf: number[] = [];
  /** End of the visible run of `pred` from i (stops at protected units); its code points in {@link buf}. */
  runEnd(i: number, pred: (cp: number) => boolean): number {
    const buf = this.buf;
    buf.length = 0;
    const v = this.view;
    let j = i;
    // Decision 42e: a run is read in chunks of at most `constructLimit` code points.
    const limit = this.rules.constructLimit ?? CONSTRUCT_LIMIT;
    while (buf.length < limit) {
      const cp = v.afterCp(j);
      if (cp < 0 || !pred(cp) || this.isProt(v.at)) break;
      buf.push(cp);
      j = v.next;
    }
    return j;
  }
  /** Code points of the visible run of `pred` from i (stops at protected units): source end and carriers. */
  run(i: number, pred: (cp: number) => boolean): { j: number; cps: number[] } {
    const cps: number[] = [];
    const v = this.view;
    let j = i;
    const limit = this.rules.constructLimit ?? CONSTRUCT_LIMIT;
    while (cps.length < limit) {
      // An emitted default (' ', '\n') fails every predicate here: it ends the run.
      const ch = v.after(j);
      if (ch === '') break;
      const cp = ch.codePointAt(0)!;
      if (!pred(cp) || this.isProt(v.at)) break;
      cps.push(cp);
      j = v.next;
    }
    return { j, cps };
  }
  /** Shared protection step of a candidate: true when it is inside an RGI emoji sequence. */
  protectedCandidate(i: number, c: number, next: number): boolean {
    if (this.nearEmoji(i, next) || (isZW(c) && this.nearEmoji(i, this.runEnd(i, isZW))))
      this.protectAround(i, next);
    return this.isProt(i);
  }
}

const NONE: ReadonlySet<string> = new Set();

/** A per-code-point cache of a regex test (BMP in a table, astral in a map). */
function cpTest(re: RegExp): (cp: number) => boolean {
  const bmp = new Uint8Array(0x10000);
  const astral = new Map<number, boolean>();
  return (cp) => {
    if (cp < 0x10000) {
      const v = bmp[cp]!;
      if (v) return v === 2;
      const r = re.test(String.fromCharCode(cp));
      bmp[cp] = r ? 2 : 1;
      return r;
    }
    let r = astral.get(cp);
    if (r === undefined) astral.set(cp, (r = re.test(String.fromCodePoint(cp))));
    return r;
  };
}
const emojiSeq = cpTest(EMOJI_SEQ_RE);
const wordBreakScript = cpTest(ZWSP_HINT_RE);

/** Candidate code points (UTF-16 level, no `u` flag): every class below. */
const CANDIDATE_SOURCE =
  '[\\u00AD\\u034F\\u061C\\u115F\\u1160\\u17B4\\u17B5\\u180B-\\u180F\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u206F\\u2800\\u3164\\uFE00-\\uFE0F\\uFEFF\\uFFA0\\uFFF0-\\uFFFB]|\\uDB40[\\uDC00-\\uDFFF]|[\\uDB41-\\uDB43][\\uDC00-\\uDFFF]|\\uD834[\\uDD59\\uDD73-\\uDD7A]|\\uD82F[\\uDCA0-\\uDCA3]|\\uD80D[\\uDC30-\\uDC3F]|\\uD804\\uDCB1';
const ZW_SOURCE = '[\\u200B-\\u200D\\u2060\\uFEFF]';
/** The same without the zero-width characters (the zero-width generator's). */
const CANDIDATE_NO_ZW_SOURCE = CANDIDATE_SOURCE.replace('\\u200B-\\u200F', '\\u200E\\u200F')
  .replace('\\u2060-\\u206F', '\\u2061-\\u206F')
  .replace('\\uFEFF', '');

/** Reader ids of the view (each detector tells it what it still looks at). */
export const READER = {
  invisibles: 0,
  zeroWidth: 1,
  stacks: 2,
  spans: 3,
  illegal: 4,
  damage: 5,
} as const;

/**
 * Single hidden characters and runs other than zero-width runs: soft hyphen,
 * blank fillers, other invisibles, bidi controls and marks, tag runs, selector
 * runs; and rule `invisibleRun`: carriers at least the zero-width threshold
 * long, not all zero-width (the zero-width generator's), not all bidi marks in
 * RTL text.
 */
export function* invisibles(ctx: DetectCtx): Generator<RawMark> {
  try {
    yield* invisiblesOf(ctx);
  } finally {
    ctx.view.release(READER.invisibles, Infinity);
  }
}
function* invisiblesOf(ctx: DetectCtx): Generator<RawMark> {
  const { source: text, view, rules } = ctx;
  const rtl = ctx.rtlParagraphs();

  // Zero-width characters are visited only to find invisible runs.
  const runs = ctx.wants('invisibleRun', rules.invisibleRun);
  const re = new RegExp(runs ? CANDIDATE_SOURCE : CANDIDATE_NO_ZW_SOURCE, 'g');
  let invisibleRunEnd = 0;
  let m = re.exec(text);
  while (m) {
    const i = m.index;
    const removed = view.removedEnd(i);
    if (removed >= 0) {
      re.lastIndex = removed;
      m = re.exec(text);
      continue;
    }
    view.release(READER.invisibles, i);
    const c = text.codePointAt(i)!;
    let next = i + cpLen(c);
    if (ctx.protectedCandidate(i, c, next)) {
      re.lastIndex = next;
      m = re.exec(text);
      continue;
    }
    if (runs && i >= invisibleRunEnd && isCarrier(c)) {
      const r = ctx.run(i, isCarrier);
      invisibleRunEnd = r.j;
      if (
        r.cps.length >= rules.zeroWidthRunThreshold &&
        !r.cps.every(isZW) &&
        // Word processors pile up marks in RTL text; the rules keep them there too.
        !(r.cps.every(isBidi) && rtl.at(i))
      ) {
        const run = ctx.mark(
          'invisibleRun',
          'invisibleRun',
          rules.invisibleRun,
          i,
          r.j,
          r.cps.length,
        );
        if (run) {
          run.cps = r.cps;
          yield run;
        }
      }
    }
    let mk: RawMark | null = null;
    if (c === 0x00ad) mk = ctx.mark('softHyphen', 'softHyphen', rules.softHyphen, i, next, 1);
    else if (isBlank(c)) {
      // Between two visible characters it stands for a space ("click⠀here");
      // at a word edge it only pads the word ("admin⠀") and is dropped.
      const a = view.before(i);
      const b = view.after(next);
      const space = a !== '' && b !== '' && !isWS(a.codePointAt(0)!) && !isWS(b.codePointAt(0)!);
      mk = ctx.mark(
        'blankFillers',
        'blankFiller',
        rules.blankFillers,
        i,
        next,
        1,
        space ? ' ' : '',
      );
    } else if (c === 0x17b4 || c === 0x17b5 || c === 0x110b1) {
      // Invisible vowel signs: native in their script, hidden anywhere else.
      const prev = view.before(i);
      if (!(c === 0x110b1 ? KAITHI_RE : KHMER_RE).test(prev))
        mk = ctx.mark('otherInvisibles', 'otherInvisible', rules.otherInvisibles, i, next, 1);
    } else if (c >= 0x2061 && c <= 0x2064 && rules.invisibleMathOperators !== undefined)
      mk = ctx.mark(
        'invisibleMathOperators',
        'invisibleMathOperator',
        rules.invisibleMathOperators,
        i,
        next,
        1,
      );
    else if (isOtherInvisible(c))
      mk = ctx.mark('otherInvisibles', 'otherInvisible', rules.otherInvisibles, i, next, 1);
    else if (isBidiEmbed(c))
      mk = ctx.mark('bidiOverrides', 'bidiOverride', rules.bidiOverrides, i, next, 1);
    else if (isBidiSoft(c)) {
      const inRtl = rtl.at(i);
      mk = ctx.mark(
        inRtl ? 'bidiMarksInRtlText' : 'bidiMarks',
        'bidiMark',
        inRtl ? rules.bidiMarksInRtlText : rules.bidiMarks,
        i,
        next,
        1,
      );
    } else if (isTag(c)) {
      const r = ctx.run(i, isTag);
      next = r.j;
      mk = ctx.mark('tags', 'tag', rules.tags, i, next, r.cps.length);
      if (mk) mk.cps = r.cps;
    } else if (isVS(c)) {
      const r = ctx.run(i, isVS);
      next = r.j;
      // Valid: exactly one selector on a base that takes it.
      const base = view.before(i);
      const validSingle = base !== '' && validSelector(c, base);
      const from = validSingle ? i + cpLen(c) : i;
      const n = r.cps.length - (validSingle ? 1 : 0);
      if (n > 0) {
        mk = ctx.mark(
          'variationSelectors',
          'variationSelector',
          rules.variationSelectors,
          from,
          next,
          n,
        );
        if (mk) mk.cps = validSingle ? r.cps.slice(1) : r.cps;
      }
    } else if (isZW(c)) {
      // The zero-width generator's: skip the run.
      next = ctx.runEnd(i, isZW);
    }
    if (mk) yield mk;
    re.lastIndex = next;
    m = re.exec(text);
  }
}

/** One selector on `base` that selects a glyph (§15.5): emoji presentation, a registered IVS, Mongolian, standardized. */
function validSelector(c: number, base: string): boolean {
  return (
    ((c === 0xfe0e || c === 0xfe0f) && EMOJI_RE.test(base)) ||
    (c >= 0xe0100 && ivdRegistered(base.codePointAt(0)!, c)) ||
    (c >= 0x180b && c <= 0x180f && MONGOLIAN_RE.test(base)) ||
    (c >= 0xfe00 && c <= 0xfe02 && (HAN_RE.test(base) || MATH_RE.test(base)))
  );
}

/** `f` + ZWNJ + one of these: a ligature-breaking position (decision 27). */
const LIGATURE_NEXT = new Set([0x66, 0x69, 0x6c, 0x74]);

/**
 * Zero-width runs (decision 5): reads past the control layer, classifies each
 * run itself and yields it at its start. Legitimate joiners yield nothing.
 */
export function* zeroWidthRuns(ctx: DetectCtx): Generator<RawMark> {
  try {
    yield* zeroWidthRunsOf(ctx);
  } finally {
    ctx.view.release(READER.zeroWidth, Infinity);
  }
}
function* zeroWidthRunsOf(ctx: DetectCtx): Generator<RawMark> {
  const { source: text, view, rules } = ctx;
  const re = new RegExp(ZW_SOURCE, 'g');
  let m = re.exec(text);
  while (m) {
    const i = m.index;
    const removed = view.removedEnd(i);
    if (removed >= 0) {
      re.lastIndex = removed;
      m = re.exec(text);
      continue;
    }
    view.release(READER.zeroWidth, i);
    const c = text.charCodeAt(i);
    if (ctx.protectedCandidate(i, c, i + 1)) {
      re.lastIndex = i + 1;
      m = re.exec(text);
      continue;
    }
    const next = ctx.runEnd(i, isZW);
    const cps = ctx.buf;
    const n = cps.length;
    const prevCp = view.beforeCp(i);
    const afterCp = view.afterCp(next);
    let joinerOnly = true;
    let allBom = true;
    for (let k = 0; k < n; k++) {
      const x = cps[k]!;
      if (x !== 0x200c && x !== 0x200d) joinerOnly = false;
      if (x !== 0xfeff) allBom = false;
    }
    const prevLetter = prevCp >= 0 && (cpFlags(prevCp) & CP_LETTER) !== 0;
    const nextLetter = afterCp >= 0 && (cpFlags(afterCp) & CP_LETTER) !== 0;
    let legitJoiner = false;
    if (joinerOnly && n === 1 && (prevLetter || (prevCp >= 0 && cpFlags(prevCp) & CP_MARK))) {
      const prev = String.fromCodePoint(prevCp);
      legitJoiner = JOINER_RE.some(
        (jr) =>
          jr.test(prev) &&
          (nextLetter
            ? jr.test(String.fromCodePoint(afterCp))
            : cps[0] === 0x200d && VIRAMA_RE.test(prev)),
      );
    }
    let mk: RawMark | null = null;
    if (legitJoiner) {
      // orthography: no mark
    } else if (n >= rules.zeroWidthRunThreshold)
      mk = ctx.mark('zeroWidthRun', 'zeroWidthRun', rules.zeroWidthRun, i, next, n);
    else if (prevCp < 0 && allBom) mk = ctx.mark('leadingBom', 'bom', rules.leadingBom, i, next, n);
    else if ((prevCp < 0 || isWS(prevCp)) && (afterCp < 0 || isWS(afterCp)))
      mk = ctx.mark('isolatedZeroWidth', 'zeroWidth', rules.isolatedZeroWidth, i, next, n);
    else if (prevCp >= 0 && afterCp >= 0 && wordBreakScript(prevCp) && wordBreakScript(afterCp))
      mk = ctx.mark('wordBreakHint', 'zeroWidth', rules.wordBreakHint, i, next, n);
    else if (n === 1 && cps[0] === 0x200c && prevCp === 0x66 && LIGATURE_NEXT.has(afterCp))
      mk = ctx.mark('possibleLigatureBreak', 'zeroWidth', rules.possibleLigatureBreak, i, next, n);
    else if (joinerOnly && n === 1 && prevLetter && nextLetter)
      mk = ctx.mark('joinerInWord', 'zeroWidthInWord', rules.joinerInWord, i, next, n);
    else mk = ctx.mark('zeroWidthInWord', 'zeroWidthInWord', rules.zeroWidthInWord, i, next, n);
    if (mk) {
      // The carriers are only read for the report callback's decode.
      if (ctx.listen) mk.cps = cps.slice();
      yield mk;
    }
    re.lastIndex = next;
    m = re.exec(text);
  }
}

// --- Mark stacks ------------------------------------------------------------

/**
 * Most marks one base keeps, by the script of the base; above it the marks stop
 * being writing and the line stops being readable. Set above what real text
 * writes (§15.7): a Thai vowel and tone, a Hebrew letter with dagesh, vowel and
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

/** Marks and format characters: a stack's characters (three in a row is the fewest that can pass a limit of 2). */
const STACK_CHAR_RE = /^[\p{M}\p{Cf}]/u;
const isStackChar = cpTest(STACK_CHAR_RE);
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
  return base === 'ـ' ? 'Arabic' : primaryScript(base);
}

/**
 * Trims stacks past their limit, counting through hidden characters (and past
 * the control layer) so nothing can split a stack: one mark per range of
 * excess marks. The first range of a stack carries the stack (`info`).
 */
export function* markStacks(ctx: DetectCtx): Generator<RawMark> {
  try {
    yield* markStacksOf(ctx);
  } finally {
    ctx.view.release(READER.stacks, Infinity);
  }
}
function* markStacksOf(ctx: DetectCtx): Generator<RawMark> {
  const { source: text, view, rules } = ctx;
  // With nothing for the control layer to remove, a stack is a run of three or more.
  const min = ctx.layerFree ? 3 : 1;
  const n = text.length;
  // Runs of marks and format characters, by code unit (below U+0300 only U+00AD is one).
  let scan = 0;
  let mStart = -1;
  let mEnd = -1;
  const nextRun = (): boolean => {
    let i = scan;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c < 0x300 && c !== 0xad) {
        i++;
        continue;
      }
      let cp = c;
      let w = 1;
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < n) {
        const d = text.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) {
          cp = (c - 0xd800) * 0x400 + (d - 0xdc00) + 0x10000;
          w = 2;
        }
      }
      if (!isStackChar(cp)) {
        i += w;
        continue;
      }
      // A run: extend it.
      let j = i + w;
      let k = 1;
      while (j < n) {
        const e = text.codePointAt(j)!;
        if (e < 0x300 ? e !== 0xad : !isStackChar(e)) break;
        j += e > 0xffff ? 2 : 1;
        k++;
      }
      if (k >= min) {
        mStart = i;
        mEnd = j;
        scan = j;
        return true;
      }
      i = j;
    }
    scan = n;
    return false;
  };
  while (nextRun()) {
    const start = mStart;
    let end = mEnd;
    // The run, past the control layer: visible stack characters from `start`.
    let chars: { ch: string; at: number }[];
    if (view.clear(start, mEnd)) {
      if (mEnd - start < 3) continue;
      chars = [];
      for (let q = start; q < mEnd;) {
        const ch = charAt(text, q);
        chars.push({ ch, at: q });
        q += ch.length;
      }
    } else {
      chars = [];
      for (let p = start; ;) {
        const ch = view.after(p);
        if (ch === '' || !STACK_CHAR_RE.test(ch)) break;
        chars.push({ ch, at: view.at });
        end = view.next;
        p = view.next;
      }
    }
    scan = Math.max(end, mEnd);
    view.release(READER.stacks, start);
    if (chars.length < 3) continue;
    const base = view.before(start);
    const script = stackScript(base);
    const limit =
      rules.markStackLimits?.[script] ?? MARK_STACK_LIMITS[script] ?? MARK_STACK_DEFAULT_LIMIT;
    const action =
      (LOW_STACK_SCRIPTS.has(script) ? rules.markStacksOther : rules.markStacks) ??
      'remove-counted';
    const rule = LOW_STACK_SCRIPTS.has(script) ? 'markStacksOther' : 'markStacks';
    let marks = 0;
    let from = -1;
    let n = 0;
    let excessEnd = -1;
    const ranges: [number, number, number][] = [];
    // A range ends after its last excess mark, before whatever stops it.
    const flush = () => {
      if (from < 0) return;
      ranges.push([from, excessEnd, n]);
      from = -1;
      n = 0;
    };
    for (const { ch, at } of chars) {
      const cp = ch.codePointAt(0)!;
      const real = MARK_RE.test(ch) && !isHiddenMark(cp);
      if (real) {
        marks += 1;
        if (marks > limit) {
          if (from < 0) from = at;
          n += 1;
          excessEnd = at + ch.length;
        }
      } else flush();
    }
    flush();
    if (marks > limit) {
      // One mark per range of excess marks; its characters are the hidden part.
      for (const [s, e, k] of ranges) {
        const mk = ctx.mark(rule, 'markStack', action as Action, s, e, k);
        if (mk) yield mk;
      }
    }
  }
}

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
export const BIDI_CONTROLS_RE = /[؜‎‏‪-‮⁦-⁩]/g;
/** Controls and paragraph separators (Bidi_Class B) the frame stack reacts to. */
const BIDI_EVENT_SOURCE = '[\\n\\r\\u001C-\\u001E\\u0085\\u2029\\u202A-\\u202E\\u2066-\\u2069]';

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
  against: number;
  reverses: boolean;
  visible: number;
  hasR: boolean;
  hasL: boolean;
  hasD: boolean;
  rtlBase: boolean;
  markAfterL: boolean;
  swapsWords: boolean;
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

/**
 * The spans whose letters the screen shows in another order than the text has,
 * by the explicit-level rules of UAX #9 (X1–X8) without the depth limit: a
 * frame ends at its PDF, at the PDI of an enclosing isolate, or at the end of
 * the paragraph; embeddings and isolates inside an override are one unit to it.
 *
 * - LRO/RLO reverse: two letters or digits in a row against the forced direction
 *   (`‮gnp.exe`). An RLO with no RTL letter reverses any two visible characters.
 * - An RTL embedding or isolate swaps words of Latin letters only through an RLM/ALM, in a
 *   span without RTL letters (`‫abc‏ def‬`).
 *
 * Nested spans of one kind: the outermost. Paragraph by paragraph: every frame
 * closes at a paragraph separator, so a paragraph's spans are yielded when it ends.
 * A separator removed by the control layer still ends the paragraph (Bidi_Class B
 * ends it on screen, whatever becomes of the character).
 */
export function* bidiSpans(ctx: DetectCtx, withContent: boolean): Generator<RawMark> {
  try {
    yield* bidiSpansOf(ctx, withContent);
  } finally {
    ctx.view.release(READER.spans, Infinity);
  }
}
function* bidiSpansOf(ctx: DetectCtx, withContent: boolean): Generator<RawMark> {
  const { source: text, view } = ctx;
  if (!/[‪-‮⁦-⁨]/.test(text)) return;
  // 'remove-with-content' on the controls removes the overridden spans too.
  const overrideAction: Action = withContent ? 'remove-counted' : ctx.rules.bidiOverrideSpan;
  const spans: { kind: 'bidi-override' | 'bidi-mark-reorder'; start: number; end: number }[] = [];
  const stack: BidiFrame[] = [];
  let isolates = 0;
  const close = (end: number) => {
    const f = stack.pop()!;
    if (isIsolate(f.cp)) isolates -= 1;
    const e = view.visibleEnd(end);
    if (f.cp === LRO || f.cp === RLO) {
      if (f.reverses || (f.cp === RLO && !f.hasR && f.visible >= 2))
        spans.push({ kind: 'bidi-override', start: f.start, end: e });
    } else if (
      (f.cp === RLE || f.cp === RLI || (f.cp === FSI && f.rtlBase)) &&
      f.swapsWords &&
      !f.hasR
    )
      spans.push({ kind: 'bidi-mark-reorder', start: f.start, end: e });
    const parent = stack[stack.length - 1];
    if (parent) {
      const u = f.hasR ? 'R' : f.hasL ? 'L' : f.hasD ? 'D' : f.visible > 0 ? 'N' : null;
      if (u) note(parent, u);
    }
  };
  const closeAll = (end: number) => {
    while (stack.length) close(end);
  };
  /** Feed the visible characters of [from, to) to the innermost frame. */
  const feed = (from: number, to: number) => {
    const top = stack[stack.length - 1];
    if (!top || from >= to) return;
    if (view.clear(from, to)) {
      for (const c of text.slice(from, to)) {
        const u = bidiUnit(c);
        if (u) note(top, u);
      }
      return;
    }
    for (let p = from; p < to;) {
      const ch = view.after(p);
      if (ch === '' || view.at >= to) break;
      const u = bidiUnit(ch);
      if (u) note(top, u);
      p = view.next;
    }
  };
  const flush = function* (): Generator<RawMark> {
    if (!spans.length && !lost.length) return;
    spans.sort((x, y) => x.start - y.start || y.end - x.end);
    const reach = { 'bidi-override': -1, 'bidi-mark-reorder': -1 };
    let q = 0;
    for (const s of spans) {
      // Lost bounds (42e) in position order with the spans.
      for (; q < lost.length && lost[q]!.start <= s.start; q++) yield lost[q]!;
      if (s.start < reach[s.kind]) continue;
      reach[s.kind] = s.end;
      const override = s.kind === 'bidi-override';
      const mk = override
        ? ctx.mark('bidiOverrideSpan', 'bidiOverrideSpan', overrideAction, s.start, s.end, 0)
        : ctx.mark(
            'bidiReorderSpan',
            'bidiOverrideSpan',
            ctx.rules.bidiReorderSpan,
            s.start,
            s.end,
            0,
          );
      if (!mk) continue;
      const visible = view.slice(s.start, s.end);
      mk.n = [...visible].length;
      mk.extracted = visible.replace(BIDI_CONTROLS_RE, '');
      yield mk;
    }
    for (; q < lost.length; q++) yield lost[q]!;
    spans.length = 0;
    lost.length = 0;
  };
  // Decision 42e: a frame not closed within `constructLimit` code points is closed there,
  // its lost bound reported; the frames inside it close with it.
  const limit = ctx.rules.constructLimit ?? CONSTRUCT_LIMIT;
  const limitEnd = (a: number, to: number): number => {
    if (to - a <= limit) return -1;
    let p = a;
    for (let k = 0; k < limit && p < to; k++) p += cpLen(text.codePointAt(p)!);
    return p < to ? p : -1;
  };
  const lost: RawMark[] = [];
  const bound = function* (to: number): Generator<RawMark> {
    const e = stack.length ? limitEnd(stack[0]!.start, to) : -1;
    if (e < 0) return;
    feed(cursor, e);
    cursor = Math.max(cursor, e);
    for (const f of stack)
      lost.push({
        rule: 'lostBound',
        cls: 'lostBound',
        start: f.start,
        end: e,
        n: 0,
        value: '',
        mode: 'report',
        counted: false,
        lost: 'bidiFrame',
      });
    closeAll(e);
    yield* flush();
  };
  const re = new RegExp(BIDI_EVENT_SOURCE, 'g');
  let cursor = 0;
  let m = re.exec(text);
  while (m) {
    const i = m.index;
    const c = text.charCodeAt(i);
    const removed = view.removedEnd(i);
    if (removed >= 0 && !isParaSep(c)) {
      re.lastIndex = removed;
      m = re.exec(text);
      continue;
    }
    yield* bound(i);
    view.release(READER.spans, stack.length ? stack[0]!.start : i);
    feed(cursor, i);
    cursor = i + 1;
    if (c >= 0x202a && c <= 0x202e && c !== PDF) stack.push(frame(c, i));
    else if (isIsolate(c)) {
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
    } else {
      if (stack.length) closeAll(i);
      yield* flush();
    }
    m = re.exec(text);
  }
  yield* bound(text.length);
  feed(cursor, text.length);
  closeAll(text.length);
  yield* flush();
}

// --- analyze's findings between words (decision 3) ---------------------------------

/**
 * Illegal code points (`isIllegalCodePoint`): C0 but tab, LF, CR;
 * DEL; C1; noncharacters. One class: an astral noncharacter is found by its
 * low surrogate (U+DFFE/U+DFFF after a plane's last high surrogate).
 */
const ILLEGAL_SOURCE =
  '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F\\uFDD0-\\uFDEF\\uFFFE\\uFFFF\\uDFFE\\uDFFF]';

/* eslint-disable no-control-regex -- ESC is what this pattern matches */
/**
 * An ECMA-48 control sequence (CSI): ESC "[", parameter bytes 0x30–0x3F,
 * intermediate bytes 0x20–0x2F, one final byte 0x40–0x7E (lenient path: a
 * well-formed sequence goes whole, not just its ESC).
 */
const CONTROL_SEQUENCE_RE = /\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/y;
/* eslint-enable no-control-regex */

/** `text` with its control sequences blanked to spaces of the same length (offsets stay valid). */
function blankControlSequences(text: string): string {
  if (!text.includes('\x1b')) return text;
  return text.replace(new RegExp(CONTROL_SEQUENCE_RE.source, 'g'), (q) => ' '.repeat(q.length));
}

/**
 * Rule `illegal`: each illegal code point the control layer leaves (a removal
 * separates words). With the terminal layer a
 * backspace is the backspace rule's, and a sequence it reports is its own.
 * `sequences` (lenient `analyze`): an ESC that starts a
 * well-formed control sequence is one finding with the whole sequence; the
 * word phase reads its bytes as blanks.
 */
export function* illegalChars(
  ctx: DetectCtx,
  terminal: boolean,
  sequences = false,
): Generator<RawMark> {
  try {
    const { source: text, view, rules } = ctx;
    if (!ctx.wants('illegal', rules.illegal)) return;
    const re = new RegExp(ILLEGAL_SOURCE, 'g');
    for (let m = re.exec(text); m; m = re.exec(text)) {
      let i = m.index;
      let len = 1;
      const u = text.charCodeAt(i);
      if (u >= 0xdc00) {
        // U+xFFFE / U+xFFFF of planes 1–16: the high surrogate ends in 0x3F.
        const h = i > 0 ? text.charCodeAt(i - 1) : 0;
        if (u < 0xfdd0 && !(h >= 0xd800 && h <= 0xdbff && (h & 0x3f) === 0x3f)) continue;
        if (u < 0xfdd0) {
          i -= 1;
          len = 2;
        }
      }
      const covered = view.coveredEnd(i);
      if (covered >= 0) {
        re.lastIndex = covered;
        continue;
      }
      view.release(READER.illegal, i);
      if (terminal && text.charCodeAt(i) === 0x08) continue;
      if (sequences && u === 0x1b) {
        CONTROL_SEQUENCE_RE.lastIndex = i;
        if (CONTROL_SEQUENCE_RE.test(text)) {
          len = CONTROL_SEQUENCE_RE.lastIndex - i;
          re.lastIndex = i + len;
        }
      }
      const mk = ctx.mark('illegal', 'illegal', rules.illegal, i, i + len, 1);
      if (mk) {
        mk.split = true;
        yield mk;
      }
    }
  } finally {
    ctx.view.release(READER.illegal, Infinity);
  }
}

/**
 * Decision 42g: whether a position (asked in ascending order) is in right-to-left text: its
 * bidi paragraph (UAX #9 separators) has a right-to-left letter the control layer leaves (an
 * erased letter is no text) before it, or one within the next `limit` code points (42e; each
 * position its own lookahead); past the paragraph's end or that reach it is not.
 */
export class RtlParagraphs {
  private readonly rtlRe = new RegExp(RTL_RE.source, 'gu');
  private readonly sepRe = new RegExp(PARA_SEP_G.source, 'g');
  /** The paragraph holding the last position asked: its end, and its first RTL letter that stays. */
  private paraEnd = -1;
  private firstRtl = Infinity;
  /** The next RTL letter at or after the last paragraph read (Infinity: none left). */
  private rtlNext = -1;
  constructor(
    private readonly source: string,
    private readonly view: View,
    private readonly limit: number,
  ) {}
  private search(re: RegExp, from: number): number {
    re.lastIndex = from;
    const m = re.exec(this.source);
    return m ? m.index : Infinity;
  }
  at(i: number): boolean {
    if (i >= this.paraEnd) {
      // A new paragraph: from the separator before i to the next one.
      let start = i;
      while (start > 0 && !isParaSep(this.source.charCodeAt(start - 1))) start--;
      this.paraEnd = this.search(this.sepRe, i);
      this.firstRtl = Infinity;
      // The next RTL letter is kept across paragraphs: each letter is found once (linear).
      if (this.rtlNext < start) this.rtlNext = this.search(this.rtlRe, start);
      while (this.rtlNext < this.paraEnd) {
        if (this.view.removedEnd(this.rtlNext) < 0) {
          this.firstRtl = this.rtlNext;
          break;
        }
        const p = this.rtlNext;
        this.rtlNext = this.search(this.rtlRe, p + (this.source.codePointAt(p)! > 0xffff ? 2 : 1));
      }
    }
    const p = this.firstRtl;
    if (p < i) return true;
    if (p >= this.paraEnd) return false;
    // The lookahead (each position its own): within the reach.
    const { limit } = this;
    return !(p - i > 2 * limit || (p - i > limit && [...this.source.slice(i, p)].length > limit));
  }
}

/** [i, j) holds bidi marks only (LRM, RLM, ALM, isolates). */
function onlyBidiMarks(text: string, i: number, j: number): boolean {
  for (let p = i; p < j;) {
    const cp = text.codePointAt(p)!;
    if (!isBidiSoft(cp)) return false;
    p += cpLen(cp);
  }
  return true;
}

/** Rule `encodingDamage`: each run of U+FFFD, read past the control layer. */
export function* encodingDamage(ctx: DetectCtx): Generator<RawMark> {
  try {
    const { source: text, view, rules } = ctx;
    if (!ctx.wants('encodingDamage', rules.encodingDamage)) return;
    for (let i = text.indexOf('\uFFFD'); i >= 0;) {
      const removed = view.removedEnd(i);
      if (removed >= 0) {
        i = text.indexOf('\uFFFD', removed);
        continue;
      }
      view.release(READER.damage, i);
      const r = ctx.run(i, (cp) => cp === 0xfffd);
      const mk = ctx.mark(
        'encodingDamage',
        'encodingDamage',
        rules.encodingDamage,
        i,
        r.j,
        r.cps.length,
      );
      if (mk) yield mk;
      i = text.indexOf('\uFFFD', r.j);
    }
  } finally {
    ctx.view.release(READER.damage, Infinity);
  }
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

const isZeroWidthChar = (c: number) =>
  c === 0x200b || c === 0x200c || c === 0x200d || c === 0x2060 || c === 0xfeff;
const SPACE_RE = /\s/;

/**
 * Rule `invisibleOutsideWord` (lenient standalone pass): a run of
 * invisible characters or selectors outside every word with a letter, not an
 * inert zero-width run (whitespace or a text edge on both sides, at most
 * {@link ZERO_WIDTH_INERT_RUN} long), not inside an emoji sequence (UTS #51). Reads the source: lenient `analyze` has no control layer.
 */
export function* invisibleOutsideWord(ctx: DetectCtx, sequences = false): Generator<RawMark> {
  yield* betweenWords(ctx, sequences, false);
}

/**
 * Candidates of the lenient scan, by UTF-16 code unit (review 7, one scan):
 * bit 1 the illegal class ({@link ILLEGAL_SOURCE}), bit 2 the outside-word
 * class (`\p{Cf}`, blank fillers, invisible marks, variation selectors;
 * astral candidates by their high surrogate). A
 * prefilter: each candidate is checked again.
 */
const LENIENT_TAB = (() => {
  const tab = new Uint8Array(0x10000);
  const fill = (bit: number, ranges: readonly number[][]) => {
    for (const [a, b = a] of ranges) for (let c = a!; c <= b; c++) tab[c]! |= bit;
  };
  fill(1, [
    [0x00, 0x08],
    [0x0b, 0x0c],
    [0x0e, 0x1f],
    [0x7f, 0x9f],
    [0xfdd0, 0xfdef],
    [0xfffe, 0xffff],
    [0xdffe, 0xdfff],
  ]);
  // \p{Cf} and the listed invisibles and selectors of the BMP (Unicode 17).
  fill(2, [
    [0xad],
    [0x34f],
    [0x600, 0x605],
    [0x61c],
    [0x6dd],
    [0x70f],
    [0x890, 0x891],
    [0x8e2],
    [0x115f, 0x1160],
    [0x17b4, 0x17b5],
    [0x180b, 0x180e],
    [0x200b, 0x200f],
    [0x202a, 0x202e],
    [0x2060, 0x2064],
    [0x2066, 0x206f],
    [0x2800],
    [0x3164],
    [0xfe00, 0xfe0f],
    [0xfeff],
    [0xffa0],
    [0xfff9, 0xfffb],
  ]);
  // Astral: U+110xx, U+134xx, U+1BCxx, U+1D1xx, U+E00xx–E01xx.
  fill(2, [[0xd804], [0xd80d], [0xd82f], [0xd834], [0xdb40]]);
  return tab;
})();

/**
 * The lenient path's findings between words in one scan (review 7): rule
 * `illegal` (with `withIllegal`, as {@link illegalChars} with `sequences`) and
 * rule `invisibleOutsideWord`, each in position order.
 */
export function* lenientBetweenWords(ctx: DetectCtx): Generator<RawMark> {
  try {
    yield* betweenWords(ctx, true, true);
  } finally {
    ctx.view.release(READER.illegal, Infinity);
  }
}

function* betweenWords(
  ctx: DetectCtx,
  sequences: boolean,
  withIllegal: boolean,
): Generator<RawMark> {
  const { source: text, rules, view } = ctx;
  const wantOutside = ctx.wants('invisibleOutsideWord', rules.invisibleOutsideWord);
  const wantIllegal = withIllegal && ctx.wants('illegal', rules.illegal);
  if (!wantOutside && !wantIllegal) return;
  const mask = (wantIllegal ? 1 : 0) | (wantOutside ? 2 : 0);
  // Lenient `analyze`: a control sequence's bytes are blanks between words ({@link illegalChars}).
  const words = sequences ? blankControlSequences(text) : text;
  // The token around a position, and whether it has a letter (cached: candidates ascend).
  let ta = -1;
  let tb = -1;
  let tl = false;
  const isToken = (cp: number) => (cpFlags(cp) & CP_TOKEN) !== 0;
  const inWord = (i: number): boolean => {
    if (i >= ta && i < tb) return tl;
    if (!isToken(words.codePointAt(i)!)) return false;
    // The token around i, by code units (no slices), and whether it has a letter.
    let letter = false;
    let a = i;
    while (a > 0) {
      let p = a - 1;
      let cp = words.charCodeAt(p);
      if (cp >= 0xdc00 && cp <= 0xdfff && p > 0) {
        const h = words.charCodeAt(p - 1);
        if (h >= 0xd800 && h <= 0xdbff) {
          p -= 1;
          cp = (h - 0xd800) * 0x400 + (cp - 0xdc00) + 0x10000;
        }
      }
      const f = cpFlags(cp);
      if (!(f & CP_TOKEN)) break;
      if (f & CP_LETTER) letter = true;
      a = p;
    }
    let b = i;
    while (b < words.length) {
      const cp = words.codePointAt(b)!;
      const f = cpFlags(cp);
      if (!(f & CP_TOKEN)) break;
      if (f & CP_LETTER) letter = true;
      b += cpLen(cp);
    }
    ta = a;
    tb = b;
    tl = letter;
    return tl;
  };
  let ia = -1;
  let ib = -1;
  let iok = false;
  const inert = (i: number): boolean => {
    if (!isZeroWidthChar(text.charCodeAt(i))) return false;
    if (i < ia || i >= ib) {
      let a = i;
      while (a > 0 && isZeroWidthChar(text.charCodeAt(a - 1))) a--;
      let b = i + 1;
      while (b < text.length && isZeroWidthChar(text.charCodeAt(b))) b++;
      ia = a;
      ib = b;
      iok =
        (a === 0 || SPACE_RE.test(text[a - 1]!)) &&
        (b === text.length || SPACE_RE.test(text[b]!)) &&
        b - a <= ZERO_WIDTH_INERT_RUN;
    }
    return iok;
  };
  const hidden = (cp: number) => (cpFlags(cp) & (CP_INVISIBLE | CP_VARIATION)) !== 0;
  // Invisibles inside an emoji sequence are its own (ZWJ, VS15/VS16, keycap, RGI tag flag).
  const inSequence = emojiSequenceLookup(text);
  const rtl = ctx.rtlParagraphs();
  const total = text.length;
  let from = 0;
  for (;;) {
    let i = from;
    while (i < total && (LENIENT_TAB[text.charCodeAt(i)]! & mask) === 0) i++;
    if (i >= total) return;
    from = i + 1;
    const u = text.charCodeAt(i);
    if (LENIENT_TAB[u]! & mask & 1) {
      // Rule `illegal`: an astral noncharacter is found by its low surrogate.
      let len = 1;
      if (u >= 0xdc00 && u < 0xfdd0) {
        const h = i > 0 ? text.charCodeAt(i - 1) : 0;
        if (!(h >= 0xd800 && h <= 0xdbff && (h & 0x3f) === 0x3f)) continue;
        i -= 1;
        len = 2;
      }
      view.release(READER.illegal, i);
      if (sequences && u === 0x1b) {
        CONTROL_SEQUENCE_RE.lastIndex = i;
        if (CONTROL_SEQUENCE_RE.test(text)) len = CONTROL_SEQUENCE_RE.lastIndex - i;
      }
      from = i + len;
      const mk = ctx.mark('illegal', 'illegal', rules.illegal, i, i + len, 1);
      if (mk) {
        mk.split = true;
        yield mk;
      }
      continue;
    }
    if (!wantOutside) continue;
    const cp = text.codePointAt(i)!;
    if (!hidden(cp) || inWord(i) || inert(i) || inSequence(i)) continue;
    // The whole invisible run, so a payload reports as one finding.
    let end = i + cpLen(cp);
    let n = 1;
    while (end < text.length) {
      const next = text.codePointAt(end)!;
      if (!hidden(next) || inWord(end) || inert(end) || inSequence(end)) break;
      end += cpLen(next);
      n++;
    }
    // Decision 42g: bidi marks in right-to-left text are its own (its paragraph's).
    if (onlyBidiMarks(text, i, end) && rtl.at(i)) {
      from = end;
      continue;
    }
    from = end;
    const mk = ctx.mark(
      'invisibleOutsideWord',
      'invisibleRun',
      rules.invisibleOutsideWord,
      i,
      end,
      n,
    );
    if (mk) {
      mk.split = true;
      yield mk;
    }
  }
}

// --- Extracted parts ------------------------------------------------------------

/** Rules whose marks' characters are the hidden part (decisions 12a, 29). */
const CARRIER_RULES = new Set([
  'softHyphen',
  'leadingBom',
  'isolatedZeroWidth',
  'wordBreakHint',
  'joinerInWord',
  'possibleLigatureBreak',
  'zeroWidthInWord',
  'zeroWidthRun',
  'invisibleRun',
  'bidiOverrides',
  'bidiMarks',
  'bidiMarksInRtlText',
  'blankFillers',
  'otherInvisibles',
  'invisibleMathOperators',
  'invisibleOutsideWord',
  'variationSelectors',
  'tags',
  'markStacks',
  'markStacksOther',
]);

const cpsText = (cps: readonly number[]) => {
  let out = '';
  for (const c of cps) out += String.fromCodePoint(c);
  return out;
};

/**
 * The hidden part of a mark for the report callback (decision 12a): the hidden
 * characters as the input has them — a run's characters (read past the control
 * layer), a carrier, a selector or tag run — or what the detector extracted (a
 * body without its delimiters, a span in logical order, erased letters). No
 * decoding.
 */
export function extractOf(m: RawMark, source: string): string | null {
  if (m.extracted !== undefined) return m.extracted;
  if (m.cps) return cpsText(m.cps);
  return CARRIER_RULES.has(m.rule) ? source.slice(m.start, m.end) : null;
}
