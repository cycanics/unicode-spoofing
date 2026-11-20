/**
 * Strict hidden-character cleanup (docs/confusion-model.md §6, §15, §17): one
 * rule per class of invisible character, removal counters by word, decoded
 * payloads. `cleanHidden` is phase 1 (src/core.ts) with the library's default
 * rules plus a stats recorder: the recorder rebuilds today's result fields from
 * the marks; the callbacks see every mark and region as they stream.
 *
 * Legitimate uses — joiners between letters of a joining script, one valid
 * variation selector, RGI emoji sequences — are always kept, except RTL marks
 * in RTL text, which have their own rule.
 */

import { CONTROL_SOURCE, controlMarks } from './controls';
import { mojibakeMarks } from './mojibake';
import { Phase1, Tee, View, type CleanupCallbacks, type RawMark } from './core';
import {
  bidiSpans,
  CONSTRUCT_LIMIT,
  DetectCtx,
  encodingDamage,
  extractOf,
  illegalChars,
  invisibleOutsideWord,
  invisibles,
  markStacks,
  modeOf,
  READER,
  zeroWidthRuns,
} from './detectors';
import {
  BackspaceScan,
  TERMINAL_RULES,
  terminalMarks,
  terminalRules,
  type TerminalRules,
} from './terminal';
import type { PseudoScript, ScriptName } from './scripts';

export { MARK_STACK_DEFAULT_LIMIT, MARK_STACK_LIMITS } from './detectors';
export { CONTROL_SOURCE };

/** What to do with a hidden character the rules do not keep. `'ignored'`: the detector does not run (no report either). */
export type HiddenAction =
  'remove-counted' | 'remove-silent' | 'keep' | 'ignored' | 'report' | 'cleanup';

/**
 * The action of a rule whose characters can hide content. 'remove-with-content'
 * removes the content too: for `bidiOverrides` the reordered span with its
 * controls; for `tags`, `variationSelectors` and `zeroWidthRun` the run is the
 * content, so it acts as 'remove-counted'.
 */
export type HiddenContentAction = HiddenAction | 'remove-with-content';

export interface HiddenCharRules {
  /** U+00AD. Default 'remove-silent'; lenient `analyze` uses 'remove-counted'; the corpus wants 'keep' in German compounds. */
  softHyphen: HiddenAction;
  /** U+FEFF at the start of the text. Default 'remove-silent'. */
  leadingBom: HiddenAction;
  /** A zero-width run (shorter than the threshold) with whitespace or a text edge on both sides. Default 'remove-silent'. */
  isolatedZeroWidth: HiddenAction;
  /** A zero-width run between Thai/Lao/Khmer/Myanmar/Tibetan/CJK letters (a word-break hint). Default 'remove-silent'. */
  wordBreakHint: HiddenAction;
  /** A single ZWNJ/ZWJ between two letters outside a joining script. Default 'remove-counted'. */
  joinerInWord: HiddenAction;
  /**
   * A single ZWNJ between `f` and `f`, `i`, `l` or `t`: possibly a valid ligature
   * break (German `Auf‌lage`, decision 27). Default 'remove-silent'.
   */
  possibleLigatureBreak: HiddenAction;
  /** Any other zero-width run touching a word on either side. Default 'remove-counted'. */
  zeroWidthInWord: HiddenAction;
  /** A zero-width run of at least `zeroWidthRunThreshold` code points (steganography). Default 'remove-counted'. */
  zeroWidthRun: HiddenContentAction;
  /** Run length from which a zero-width run is a payload, wherever it sits. Default 2 (decision 28a; the lenient path uses 4). */
  zeroWidthRunThreshold: number;
  /**
   * Decision 42e: how far a phase-1 construct reaches, in code points (default 4,096): the
   * lookahead of "in right-to-left text" (42g), the hidden-character chunks, the bidi frames,
   * the backspace erase. A positive integer.
   */
  constructLimit?: number;
  /**
   * A run of at least `zeroWidthRunThreshold` carriers (soft hyphens, bidi
   * controls, fillers, invisible operators …), not all zero-width, read as bits.
   * Default 'keep' (reported); a removal takes the run whole.
   */
  invisibleRun: HiddenAction;
  /** U+202A–202E embeddings/overrides. Default 'remove-counted'. 'remove-with-content' also removes what an LRO/RLO reorders. */
  bidiOverrides: HiddenContentAction;
  /**
   * A span an LRO/RLO shows in another order than the text has (§15.2), its
   * letters in logical order in `extracted`. Default 'keep' (reported);
   * `bidiOverrides: 'remove-with-content'` removes it.
   */
  bidiOverrideSpan: HiddenAction;
  /** A span an RTL embedding or isolate reorders through an RLM/ALM (§15.2). Default 'keep' (reported). */
  bidiReorderSpan: HiddenAction;
  /** LRM, RLM, ALM, isolates in a text with no RTL letters. Default 'remove-counted'. */
  bidiMarks: HiddenAction;
  /** The same marks in a text with RTL letters. Default 'keep'. */
  bidiMarksInRtlText: HiddenAction;
  /** Selectors beyond the first valid one, and orphans (a supplement selector the IVD does not register for its base). Default 'remove-counted'. */
  variationSelectors: HiddenContentAction;
  /** Tag characters outside RGI emoji tag sequences. Default 'remove-counted'. */
  tags: HiddenContentAction;
  /** Hangul fillers, Braille blank, U+1D159: a space between visible characters, else removed. Default 'remove-counted'. */
  blankFillers: HiddenAction;
  /** U+180E, U+2061–2065, CGJ, U+206A–206F, U+FFF0–FFFB, U+E0080–E00FF, U+E01F0–E0FFF and the remaining invisible format characters. Default 'remove-counted'. */
  otherInvisibles: HiddenAction;
  /** Math switch 2 (decision 30h): the invisible math operators U+2061–2064 under a rule of their own, e.g. 'keep' for math. Absent: they are `otherInvisibles`. */
  invisibleMathOperators?: HiddenAction;
  /**
   * C0 controls except tab, LF, CR; DEL; C1 controls; U+FFFE. A CSI sequence (`ESC[31m`,
   * U+009B) as one. Default 'remove-counted'. VT, FF and NEL: in `cleanHidden` they become a
   * space; in strict `analyze` they are removed, except that with the language model VT and FF
   * are written as LF.
   */
  controlChars: HiddenAction;
  /** Marks past the limit on a base of a script that stacks marks ({@link MARK_STACK_LIMITS}): kept up to the limit. Default 'remove-counted'. */
  markStacks: HiddenContentAction;
  /** The same on a base of a script that does not (Latin, Cyrillic, Greek, …). Default 'remove-counted'; strict `analyze` leaves them to its `zalgo` signal. */
  markStacksOther: HiddenContentAction;
  /**
   * `analyze`'s findings between words (decision 3; the `illegal`
   * findings): C0/C1 controls except tab, LF, CR; DEL; noncharacters. A removal
   * separates words. Default 'ignored' here;
   * `analyze` runs it as 'remove-counted'.
   */
  illegal: HiddenAction;
  /** `analyze`'s U+FFFD runs (`encoding_damage`): never repaired. Default 'ignored' here; `analyze` runs it as 'keep'. */
  encodingDamage: HiddenAction;
  /**
   * Invisible runs outside every word (lenient `analyze` only, the
   * `invisible` findings between words). Default 'ignored' here; lenient
   * `analyze` runs it as 'remove-counted'.
   */
  invisibleOutsideWord: HiddenAction;
  /**
   * Decision 42: mojibake, UTF-8 read as Windows-1252 / Latin-1 or Windows-1251
   * (`donâ€™t`, `вЂњ`), found on the source before control characters are
   * removed; `extracted` is the text it encodes. Reported, never repaired.
   * Default 'ignored' here; strict `analyze` runs it as 'keep'.
   */
  mojibake?: HiddenAction;
  /** Per-script overrides of {@link MARK_STACK_LIMITS}. */
  markStackLimits?: Partial<Record<ScriptName | PseudoScript, number>>;
  /**
   * Terminal controls (§16, §17.6), off when absent: escape sequences are parsed
   * whole by the ECMA-48 grammar and judged by class ({@link TerminalRules};
   * `{}` = {@link TERMINAL_RULES}), backspace erases what it backs over, and
   * bare CR goes by `bareCR`. The rest of the control characters stay with `controlChars`.
   */
  terminal?: Partial<TerminalRules>;
  /**
   * Seam rule (decision 11): where a removal leaves `<before><space>` +
   * `<space><after>`, one space stays; the dropped space is an output record of its own.
   * On unless set to false (decision 11).
   */
  seamSpaces?: boolean;
}

/** The strict rule set (§6.1): `hiddenChars: 'strict'` without overrides. */
export const STRICT_HIDDEN_RULES: Readonly<HiddenCharRules> = {
  softHyphen: 'remove-silent',
  leadingBom: 'remove-silent',
  isolatedZeroWidth: 'remove-silent',
  wordBreakHint: 'remove-silent',
  joinerInWord: 'remove-counted',
  possibleLigatureBreak: 'remove-silent',
  zeroWidthInWord: 'remove-counted',
  zeroWidthRun: 'remove-counted',
  zeroWidthRunThreshold: 2,
  invisibleRun: 'keep',
  bidiOverrides: 'remove-counted',
  bidiOverrideSpan: 'keep',
  bidiReorderSpan: 'keep',
  bidiMarks: 'remove-counted',
  bidiMarksInRtlText: 'keep',
  variationSelectors: 'remove-counted',
  tags: 'remove-counted',
  blankFillers: 'remove-counted',
  otherInvisibles: 'remove-counted',
  controlChars: 'remove-counted',
  markStacks: 'remove-counted',
  markStacksOther: 'remove-counted',
  illegal: 'ignored',
  encodingDamage: 'ignored',
  invisibleOutsideWord: 'ignored',
  seamSpaces: true,
};

// --- Phase 1 under hidden-character rules ---------------------------------------------

/** Every character the control or terminal layer can remove or replace. */
// eslint-disable-next-line no-control-regex -- control characters are the point
const LAYER_CANDIDATE_RE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\uFFFE]/;

/** Detector options: a report callback listens; `always`: rules whose report-mode marks are wanted anyway. */
export interface DetectOptions {
  listen: boolean;
  always?: ReadonlySet<string>;
  /** A lost-bound callback listens (decision 42e): the bidi frames are read for it. */
  lostBounds?: boolean;
}

/** The detectors of `rules`, control layer first (it is read through a tee by the view). */
export function hiddenDetectors(
  text: string,
  rules: Readonly<HiddenCharRules>,
  opts: DetectOptions,
): Iterator<RawMark>[] {
  const controlAction = rules.controlChars ?? 'remove-counted';
  if (rules.terminal) {
    const trules = terminalRules(rules.terminal);
    const erases = modeOf(trules.backspace) !== null || modeOf(trules.backspaceFlood) !== null;
    const scan =
      erases && text.includes('\b')
        ? new BackspaceScan(
            text,
            trules.backspaceLineStop,
            erases,
            rules.constructLimit ?? CONSTRUCT_LIMIT,
            trules.stringLimit,
          )
        : null;
    return detectorsOver(
      text,
      rules,
      opts,
      terminalMarks(
        text,
        trules,
        controlAction,
        layerListens(rules, opts),
        scan,
        rules.constructLimit ?? CONSTRUCT_LIMIT,
      ),
      erases,
    );
  }
  return detectorsOver(text, rules, opts, controlMarks(text, controlAction, opts.listen), false);
}

/**
 * The terminal layer makes its report-mode marks when a report callback
 * listens, and when rule `illegal` runs: a sequence the rules keep is the
 * layer's, never an illegal character (the result must not depend on listening).
 */
const layerListens = (rules: Readonly<HiddenCharRules>, opts: DetectOptions) =>
  opts.listen || (rules.illegal !== undefined && rules.illegal !== 'ignored');

function detectorsOver(
  text: string,
  rules: Readonly<HiddenCharRules>,
  opts: DetectOptions,
  layerGen: Iterator<RawMark>,
  /** The terminal layer erases backspaces (a backspace is then the layer's, decision 7b). */
  erases: boolean,
): Iterator<RawMark>[] {
  const tee = new Tee(layerGen, 2);
  const view = new View(text, tee.reader(1));
  const ctx = new DetectCtx(
    text,
    view,
    { ...STRICT_HIDDEN_RULES, ...rules },
    {
      ...opts,
      layerFree: !LAYER_CANDIDATE_RE.test(text),
    },
  );
  const withContent = rules.bidiOverrides === 'remove-with-content';
  const spans =
    withContent ||
    modeOf(ctx.rules.bidiOverrideSpan) === 'cleanup' ||
    modeOf(ctx.rules.bidiReorderSpan) === 'cleanup' ||
    (opts.listen &&
      (modeOf(ctx.rules.bidiOverrideSpan) !== null ||
        modeOf(ctx.rules.bidiReorderSpan) !== null)) ||
    opts.lostBounds === true;
  view.register(READER.invisibles);
  view.register(READER.zeroWidth);
  view.register(READER.stacks);
  if (spans) view.register(READER.spans);
  const gens: Iterator<RawMark>[] = [
    // Decision 42: on the source, before the control layer removes anything.
    ...(rules.mojibake !== undefined && ctx.wants('mojibake', rules.mojibake)
      ? [mojibakeMarks(text, rules.constructLimit ?? CONSTRUCT_LIMIT)]
      : []),
    tee.reader(0),
    invisibles(ctx),
    zeroWidthRuns(ctx),
    markStacks(ctx),
  ];
  if (spans) gens.push(bidiSpans(ctx, withContent));
  // analyze's findings between words (decision 3), when their rules run.
  if (ctx.wants('illegal', ctx.rules.illegal)) {
    view.register(READER.illegal);
    // A backspace is the terminal layer's only when it erases (decision 7b runs the parser without).
    gens.push(illegalChars(ctx, erases));
  }
  if (ctx.wants('encodingDamage', ctx.rules.encodingDamage)) {
    view.register(READER.damage);
    gens.push(encodingDamage(ctx));
  }
  if (ctx.wants('invisibleOutsideWord', ctx.rules.invisibleOutsideWord))
    gens.push(invisibleOutsideWord(ctx));
  return gens;
}

const ACTIONS = new Set([
  'remove-counted',
  'remove-silent',
  'keep',
  'ignored',
  'report',
  'cleanup',
]);
const CONTENT_ACTIONS = new Set([...ACTIONS, 'remove-with-content']);
const CONTENT_RULES = new Set([
  'zeroWidthRun',
  'bidiOverrides',
  'variationSelectors',
  'tags',
  'markStacks',
  'markStacksOther',
]);
const BARE_CR = new Set(['keep', 'report', 'newline', 'ignored']);

/**
 * Checks `rules` and returns them with decision 3's mode names read: `'report'`
 * is `'keep'`; `'cleanup'` is the rule's own default cleanup (its strict
 * default when that removes, else `'remove-counted'`). A value no rule knows is
 * a RangeError (a typo would otherwise act as some mode).
 */
export function readRules<T extends object>(rules: T, where: string): T {
  const out = { ...rules } as Record<string, unknown>;
  const mode = (v: unknown, dflt: unknown) =>
    v === 'report'
      ? 'keep'
      : v === 'cleanup'
        ? String(dflt).startsWith('remove')
          ? dflt
          : 'remove-counted'
        : v;
  const bad = (k: string, v: unknown) => {
    throw new RangeError(`${where}: rule ${k} cannot be ${JSON.stringify(v)}`);
  };
  for (const [k, v] of Object.entries(rules)) {
    if (v === undefined) continue;
    if (k === 'zeroWidthRunThreshold' || k === 'constructLimit') {
      if (!Number.isInteger(v) || (v as number) < 1) bad(k, v);
    } else if (k === 'seamSpaces') {
      if (typeof v !== 'boolean') bad(k, v);
    } else if (k === 'markStackLimits') {
      if (typeof v !== 'object' || v === null) bad(k, v);
    } else if (k === 'terminal') {
      if (typeof v !== 'object' || v === null) bad(k, v);
      for (const [t, w] of Object.entries(v as object)) {
        if (w === undefined) continue;
        if (t === 'backspaceLineStop') {
          if (typeof w !== 'boolean') bad(`terminal.${t}`, w);
        } else if (t === 'stringLimit') {
          if (!Number.isInteger(w) || (w as number) < 1) bad(`terminal.${t}`, w);
        } else if (t === 'bareCR') {
          if (!BARE_CR.has(w as string)) bad(`terminal.${t}`, w);
        } else if (!(t === 'stringSequence' ? CONTENT_ACTIONS : ACTIONS).has(w as string))
          bad(`terminal.${t}`, w);
      }
    } else if (!(CONTENT_RULES.has(k) ? CONTENT_ACTIONS : ACTIONS).has(v as string)) bad(k, v);
    else out[k] = mode(v, (STRICT_HIDDEN_RULES as unknown as Record<string, unknown>)[k]);
  }
  if (out.terminal) {
    const t: Record<string, unknown> = { ...(out.terminal as object) };
    for (const [k, v] of Object.entries(t))
      if (k !== 'bareCR' && k !== 'backspaceLineStop' && k !== 'stringLimit')
        t[k] = mode(v, (TERMINAL_RULES as unknown as Record<string, unknown>)[k]);
    out.terminal = t;
  }
  return out as T;
}

/** Callbacks of `cleanHidden`; `analyze` takes these and a word callback. */
export type HiddenCallbacks = CleanupCallbacks;

/**
 * Hidden-character cleanup of `text` under `rules` (defaults:
 * {@link STRICT_HIDDEN_RULES}): the cleaned text. Every mark, region and output
 * record streams through the callbacks; the text is the library's defaults
 * whatever they return (decision 15). After an abort: the text up to the last
 * finished region.
 */
export function cleanHidden(
  text: string,
  rules: Readonly<HiddenCharRules> = STRICT_HIDDEN_RULES,
  callbacks: CleanupCallbacks = {},
): string {
  if (typeof text !== 'string') throw new TypeError('cleanHidden: text must be a string');
  rules = readRules(rules, 'cleanHidden');
  const listen = callbacks.onReport !== undefined;
  let cleaned = '';
  const lostBounds = callbacks.onLostBound !== undefined;
  new Phase1(text, hiddenDetectors(text, rules, { listen, lostBounds }), {
    callbacks,
    seams: rules.seamSpaces ?? true,
    extract: extractOf,
    out: (_s, _e, t) => {
      cleaned += t;
    },
  }).run();
  return cleaned;
}

/** Every hidden-character rule off: what is left is the terminal layer. */
const TERMINAL_ONLY: HiddenCharRules = {
  ...STRICT_HIDDEN_RULES,
  softHyphen: 'ignored',
  leadingBom: 'ignored',
  isolatedZeroWidth: 'ignored',
  wordBreakHint: 'ignored',
  joinerInWord: 'ignored',
  possibleLigatureBreak: 'ignored',
  zeroWidthInWord: 'ignored',
  zeroWidthRun: 'ignored',
  invisibleRun: 'ignored',
  bidiOverrides: 'ignored',
  bidiOverrideSpan: 'ignored',
  bidiReorderSpan: 'ignored',
  bidiMarks: 'ignored',
  bidiMarksInRtlText: 'ignored',
  variationSelectors: 'ignored',
  tags: 'ignored',
  blankFillers: 'ignored',
  otherInvisibles: 'ignored',
  controlChars: 'ignored',
  markStacks: 'ignored',
  markStacksOther: 'ignored',
};

/**
 * Terminal controls alone (§16): escape sequences, backspace, bare CR under
 * `rules` (defaults {@link TERMINAL_RULES}); every other hidden-character rule
 * off, other control characters left as they are.
 */
export function cleanTerminal(
  text: string,
  rules: Readonly<Partial<TerminalRules>> = {},
  callbacks: CleanupCallbacks = {},
): string {
  return cleanHidden(text, { ...TERMINAL_ONLY, terminal: rules }, callbacks);
}
