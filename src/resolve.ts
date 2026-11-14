/**
 * Per-word resolution of docs/confusion-model.md §4: clean context words,
 * hyphen compounds, neighbours, ±10-token window, the target ladder and the
 * whole-script modes. Reference behaviour: `resolveText` in
 * scripts/prototype-resolve.mjs.
 *
 * Cost model: one pass classifies every token from the per-code-point table
 * (no NFD, no regex); only tokens that might be resolved are inspected; the
 * context arrays are built only if at least one token needs them.
 */
import {
  CONFUSION_ALPHABETS,
  F_APOSTROPHE,
  F_I_SHAPED,
  F_INTRA_LATIN,
  F_RULE,
  F_UPPER,
  KIND_MASK,
  KIND_NONE,
  LANG_SHIFT,
  SCRIPT_LANG_MASK,
  TWIN_SHIFT,
  type ConfusionAlphabet,
  createConfusionModel,
  type ConfusionModel,
  type ConfusionModelOptions,
  type Evidence,
  type Inspection,
} from './confusion';
import { RU_CASE_ENDINGS } from './languages';

export type WholeScriptFold = 'off' | 'foreign-letters' | 'all';

/** The ladder step (or rule) that decided a word (§4.2). */
export type ResolutionRule =
  | 'hyphen'
  | 'neighbours'
  | 'window'
  | 'word-majority'
  | 'any-valid'
  | 'case-anomaly'
  | 'conditional-twin'
  | 'evidence'
  | 'no-valid-alphabet';

export interface WordResolution {
  /** confusable = some alphabet fits the whole word; mixed = none does. */
  class: 'confusable' | 'mixed';
  /** Alphabet the word was folded into; null when kept or mixed. */
  script: ConfusionAlphabet | null;
  rule: ResolutionRule;
  /** False for kept confusable words (wholeScriptFold 'off') and every mixed word. */
  folded: boolean;
  /** The word is written in one alphabet (a whole-script confusable). */
  wholeScript: boolean;
  /** Step-1 alphabet (hyphen partners or both neighbours) and step-2 window alphabet. */
  context: { neighbours: ConfusionAlphabet | null; window: ConfusionAlphabet | null };
  /** Alphabets the whole word fits. */
  candidates: ConfusionAlphabet[];
  /** Target alphabets whose fold breaks their language (letters or rule). */
  rejected: Partial<Record<ConfusionAlphabet, string>>;
  evidence?: Evidence;
  /** The word after resolution (the Russian case ending, if any, kept as written). */
  normalized: string;
}

export interface ResolveOptions {
  wholeScriptFold?: WholeScriptFold;
  expectedScripts?: ReadonlySet<string>;
}

/** Context of one word: step-1 and step-2 alphabets (ids, -1 = none). */
export interface WordContext {
  near: number;
  window: number;
  hyphen: boolean;
}

const LATIN = 0;
const CYRILLIC = 1;
const GREEK = 2;
const LATIN_EXTRA = 6;
const WINDOW = 10;
const APOSTROPHE_ENDING = /^(.*\p{Script=Latin}.*)(['’])(\p{Script=Cyrillic}{1,3})$/u;
const name = (a: number) => (a < 0 ? null : CONFUSION_ALPHABETS[a]!);

/** Stem judged for a token with an apostrophe case ending, else the token. */
export function splitEnding(token: string): { stem: string; tail: string } {
  const m = APOSTROPHE_ENDING.exec(token);
  return m && RU_CASE_ENDINGS.has(m[3]!.toLowerCase())
    ? { stem: m[1]!, tail: m[2]! + m[3]! }
    : { stem: token, tail: '' };
}

/** Number of set bits in a 7-bit mask. */
const popcount7 = (m: number) => {
  let n = 0;
  for (; m; m &= m - 1) n++;
  return n;
};

/** A context word: one model alphabet, not confusable, no evidence (§4.1 step 5). */
function cleanOf(ins: Inspection): { S: number; n: number } | null {
  const model = [...ins.scripts].filter((s) => s >= 0);
  const letters = ins.cl.letters.length;
  if (letters === 0 || model.length !== 1 || ins.evidence) return null;
  const S = model[0]!;
  if (!ins.scripts.has(-1) && ins.valid.some((T) => T !== S)) return null;
  return { S, n: ins.native[S]! };
}

/**
 * Context-free part of the ladder: does the word go past the early exits of
 * §4.3 (whole-script modes), i.e. can its resolution depend on context?
 */
function mayResolve(ins: Inspection, opts: Required<ResolveOptions>): boolean {
  const { scripts, valid, evidence } = ins;
  const letters = ins.cl.letters.length;
  if (letters === 0 || scripts.has(-1)) return false;
  if (scripts.size !== 1) return true;
  const [S] = scripts as Set<number>;
  if (letters < 2 || opts.expectedScripts.has(name(S!)!)) return false;
  if (!evidence && opts.wholeScriptFold !== 'all') return false;
  if (S === LATIN) return evidence?.kind === 'case' || evidence?.kind === 'conditional';
  let cands = valid.filter((T) => T !== S);
  if (evidence?.kind === 'case') cands = cands.filter((T) => T === LATIN);
  if (cands.length === 0) return false;
  return true;
}

/** The §4.2 ladder for one stem whose `mayResolve` is true. */
export function resolveInspected(
  model: ConfusionModel,
  ins: Inspection,
  ctx: WordContext,
  opts: Required<ResolveOptions>,
): (Omit<WordResolution, 'normalized'> & { normalized: string | null }) | null {
  const { cl, scripts, native, valid, evidence, anomaly } = ins;
  const whole = scripts.size === 1;
  const S = whole ? [...scripts][0]! : -1;
  const mode = opts.wholeScriptFold;
  const base = {
    wholeScript: whole,
    context: { neighbours: name(ctx.near), window: name(ctx.window) },
    candidates: valid.map((T) => name(T)!),
    rejected: ins.rejected,
    ...(evidence ? { evidence } : {}),
  };
  const keep = (cls: 'confusable' | 'mixed', rule: ResolutionRule) => ({
    ...base,
    class: cls,
    script: null,
    rule,
    folded: false,
    normalized: null,
  });
  const take = (T: number, rule: ResolutionRule) => ({
    ...base,
    class: 'confusable' as const,
    script: name(T),
    rule,
    folded: true,
    normalized: model.fold(cl, T, anomaly),
  });
  let cands = valid;
  if (whole) {
    if (S === LATIN) {
      const rule = evidence!.kind === 'case' ? 'case-anomaly' : 'conditional-twin';
      return mode === 'off' ? keep('confusable', rule) : take(LATIN, rule);
    }
    cands = valid.filter((T) => T !== S);
    if (evidence?.kind === 'case') cands = cands.filter((T) => T === LATIN);
    if (evidence && mode === 'off') return keep('confusable', 'evidence');
  }
  const steps: [ResolutionRule, number][] = [
    [ctx.hyphen ? 'hyphen' : 'neighbours', ctx.near],
    ['window', ctx.window],
  ];
  for (const [rule, X] of steps) {
    if (X < 0) continue;
    if (whole && X === S && !evidence) return null; // the word fits its context
    if (cands.includes(X)) return take(X, rule);
  }
  if (whole && !evidence) return null; // whole-script words fold only on context or evidence
  const ranked = [...cands].sort((a, b) => native[b]! - native[a]!);
  const lead = ranked[0];
  if (
    lead !== undefined &&
    native[lead]! > 0 &&
    (ranked.length === 1 || native[lead]! > native[ranked[1]!]!)
  )
    return take(lead, 'word-majority');
  if (cands.length) return take([...cands].sort((a, b) => cmpName(a, b))[0]!, 'any-valid');
  return keep('mixed', 'no-valid-alphabet');
}
const cmpName = (a: number, b: number) => (name(a)! < name(b)! ? -1 : name(a)! > name(b)! ? 1 : 0);

const isJsSpace = (c: number) =>
  c === 0x20 ||
  (c >= 0x09 && c <= 0x0d) ||
  c === 0xa0 ||
  c === 0x1680 ||
  (c >= 0x2000 && c <= 0x200a) ||
  c === 0x2028 ||
  c === 0x2029 ||
  c === 0x202f ||
  c === 0x205f ||
  c === 0x3000 ||
  c === 0xfeff;

/** `/\n\s*\n/` over text[from, to) without allocating. */
function hasBlankLine(text: string, from: number, to: number): boolean {
  let nl = false;
  for (let i = from; i < to; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x0a) {
      if (nl) return true;
      nl = true;
    } else if (!isJsSpace(c)) nl = false;
  }
  return false;
}
const isHyphen = (c: number) => c === 0x2d || c === 0x2010 || c === 0x2011;

/** Tokens as UTF-16 [start, end) spans of the text, in order. */
export interface TokenSpans {
  readonly starts: ArrayLike<number>;
  readonly ends: ArrayLike<number>;
}

export interface ResolvedTokens {
  /** Per token: every letter is in the model (the resolver is the authority). */
  inModel: Uint8Array;
  /** Token index → resolution, for resolved words only. */
  resolved: Map<number, WordResolution>;
}

/** Resolves every token of a text (tokens as produced by the analyzer). */
export function resolveTokens(
  text: string,
  tokens: TokenSpans,
  model: ConfusionModel,
  options: ResolveOptions = {},
): ResolvedTokens {
  const opts: Required<ResolveOptions> = {
    wholeScriptFold: options.wholeScriptFold ?? 'all',
    expectedScripts: options.expectedScripts ?? new Set(),
  };
  const { starts, ends } = tokens;
  const n = starts.length;
  const inModel = new Uint8Array(n);
  const cleanS = new Int8Array(n).fill(-1);
  const cleanN = new Uint16Array(n);
  const pending: { i: number; ins: Inspection; stem: string; tail: string }[] = [];
  const info = model.info;
  const bmpInfo = model.bmpInfo;

  for (let i = 0; i < n; i++) {
    const tokStart = starts[i]!;
    const tokEnd = ends[i]!;
    let kinds = 0;
    let letters = 0;
    let none = 0;
    let cand = 0x7f;
    let langAnd = 0x1fff;
    let slow = false;
    let apostrophe = false;
    let prev = 0;
    let innerUpper = false;
    for (let j = tokStart; j < tokEnd; j++) {
      let cp = text.charCodeAt(j);
      if (cp >= 0xd800 && cp <= 0xdbff && j + 1 < tokEnd) {
        cp = text.codePointAt(j)!;
        j++;
      }
      let v = cp < 0x10000 ? bmpInfo[cp]! : 0;
      if (v === 0) v = info(cp);
      const k = v & KIND_MASK;
      if (k > KIND_NONE) {
        if (v & F_APOSTROPHE) apostrophe = true;
        continue;
      }
      kinds |= 1 << k;
      if (k === KIND_NONE) none++;
      else cand &= ((v >>> TWIN_SHIFT) & 0x7f) | (1 << k);
      if (v & (F_RULE | F_INTRA_LATIN)) slow = true;
      langAnd &= v >>> LANG_SHIFT;
      if (letters >= 2 && prev & F_UPPER) innerUpper = true;
      prev = v;
      letters++;
    }
    if (letters === 0) continue;
    const modelKinds = kinds & 0x7f;
    inModel[i] = none === 0 ? 1 : 0;
    const single = popcount7(modelKinds) === 1;
    const ending = apostrophe && (kinds & (1 << CYRILLIC)) !== 0 && !single;
    if (ending) slow = true;
    else if (none > 0) {
      if (single) {
        cleanS[i] = 31 - Math.clz32(modelKinds);
        cleanN[i] = letters - none;
      }
      continue;
    }
    if (!slow && single) {
      const S = 31 - Math.clz32(modelKinds);
      const anomalyPossible = letters >= 4 && prev & F_I_SHAPED && !innerUpper;
      const langOk = S > GREEK || (langAnd & SCRIPT_LANG_MASK[S]!) !== 0;
      if (S !== LATIN_EXTRA && (cand & ~(1 << S)) === 0 && !anomalyPossible && langOk) {
        cleanS[i] = S;
        cleanN[i] = letters;
        continue;
      }
    }
    // Slow path: the prototype on NFD clusters (cached per stem).
    const s = text.slice(tokStart, tokEnd);
    const { stem, tail } = apostrophe ? splitEnding(s) : { stem: s, tail: '' };
    const ins = model.inspect(stem);
    const clean = cleanOf(ins);
    if (clean) {
      cleanS[i] = clean.S;
      cleanN[i] = clean.n;
    }
    if (mayResolve(ins, opts)) pending.push({ i, ins, stem, tail });
  }

  const resolved = new Map<number, WordResolution>();
  if (pending.length === 0) return { inModel, resolved };

  // Context arrays: paragraphs (blank line), hyphen links, nearest clean word.
  const para = new Uint32Array(n);
  const hyphenLink = new Uint8Array(n);
  for (let i = 1; i < n; i++) {
    const end = ends[i - 1]!;
    const start = starts[i]!;
    para[i] = para[i - 1]! + (hasBlankLine(text, end, start) ? 1 : 0);
    if (start - end === 1 && isHyphen(text.charCodeAt(end))) hyphenLink[i] = 1;
  }
  const left = new Int8Array(n);
  const right = new Int8Array(n);
  for (let i = 0, cur = -1; i < n; i++) {
    if (i > 0 && para[i] !== para[i - 1]) cur = -1;
    left[i] = cur;
    if (cleanS[i]! >= 0) cur = cleanS[i]!;
  }
  for (let i = n - 1, cur = -1; i >= 0; i--) {
    if (i < n - 1 && para[i] !== para[i + 1]) cur = -1;
    right[i] = cur;
    if (cleanS[i]! >= 0) cur = cleanS[i]!;
  }
  const sums = new Array<number>(7);
  for (const p of pending) {
    const i = p.i;
    // Step 1: clean hyphen partners if any (all one alphabet), else clean words
    // on BOTH sides that agree; at a text/paragraph edge step 2 decides.
    let partners = 0;
    for (let j = i; j > 0 && hyphenLink[j]; j--)
      if (cleanS[j - 1]! >= 0) partners |= 1 << cleanS[j - 1]!;
    for (let j = i + 1; j < n && hyphenLink[j]; j++)
      if (cleanS[j]! >= 0) partners |= 1 << cleanS[j]!;
    let near: number;
    if (partners) near = popcount7(partners) === 1 ? 31 - Math.clz32(partners) : -1;
    else near = left[i]! >= 0 && left[i] === right[i] ? left[i]! : -1;
    // Step 2: strict letter majority of clean words within ±10 tokens, same paragraph.
    sums.fill(0);
    const lo = Math.max(0, i - WINDOW);
    const hi = Math.min(n - 1, i + WINDOW);
    for (let j = lo; j <= hi; j++)
      if (j !== i && para[j] === para[i] && cleanS[j]! >= 0) sums[cleanS[j]!] += cleanN[j]!;
    let best = -1;
    let tie = false;
    for (let a = 0; a < 7; a++) {
      if (sums[a] === 0) continue;
      if (best < 0 || sums[a]! > sums[best]!) [best, tie] = [a, false];
      else if (sums[a] === sums[best]) tie = true;
    }
    const ctx: WordContext = { near, window: tie ? -1 : best, hyphen: partners !== 0 };
    const r = resolveInspected(model, p.ins, ctx, opts);
    if (r) resolved.set(i, { ...r, normalized: (r.normalized ?? p.stem) + p.tail });
  }
  return { inModel, resolved };
}

/**
 * Resolves one word on its own, given the context alphabets the caller
 * observed (step 1: hyphen partners or both neighbours; step 2: window).
 * Returns null when the word is not resolved (clean, outside the model, or a
 * whole-script word its context does not move).
 */
export function resolveWord(
  word: string,
  context: {
    neighbours?: ConfusionAlphabet | null;
    window?: ConfusionAlphabet | null;
    hyphen?: boolean;
  } = {},
  options: ConfusionModelOptions & ResolveOptions = {},
): WordResolution | null {
  const model = createConfusionModel(options);
  const opts: Required<ResolveOptions> = {
    wholeScriptFold: options.wholeScriptFold ?? 'all',
    expectedScripts: options.expectedScripts ?? new Set(),
  };
  const { stem, tail } = splitEnding(word);
  const ins = model.inspect(stem);
  if (!mayResolve(ins, opts)) return null;
  const id = (a: ConfusionAlphabet | null | undefined) => (a ? CONFUSION_ALPHABETS.indexOf(a) : -1);
  const r = resolveInspected(
    model,
    ins,
    { near: id(context.neighbours), window: id(context.window), hyphen: !!context.hyphen },
    opts,
  );
  return r && { ...r, normalized: (r.normalized ?? stem) + tail };
}
