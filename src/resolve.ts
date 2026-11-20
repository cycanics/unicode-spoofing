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
  KIND_MARK,
  KIND_MASK,
  KIND_NONE,
  LANG_SHIFT,
  SCRIPT_LANG_MASK,
  LANG_ALPHA,
  TWIN_SHIFT,
  type ConfusionAlphabet,
  createConfusionModel,
  type ConfusionModel,
  type ConfusionModelOptions,
  type Evidence,
  type Inspection,
} from './confusion';
import { RU_CASE_ENDINGS, TARGET_LANGUAGES, type TargetLanguage } from './languages';
import { CASE_STROKES } from './data/owner-donors';

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
  | 'one-target'
  | 'primary-target'
  | 'no-valid-alphabet';

export interface WordResolution {
  /** confusable = some alphabet fits the whole word; mixed = none does. */
  class: 'confusable' | 'mixed';
  /** Alphabet the word was folded into; null when kept or mixed. */
  script: ConfusionAlphabet | null;
  /** The language the word was folded into (never another language of its alphabet); null when kept or mixed. */
  language: TargetLanguage | null;
  rule: ResolutionRule;
  /** False for kept confusable words (wholeScriptFold 'off') and every mixed word. */
  folded: boolean;
  /** The word is written in one alphabet (a whole-script confusable). */
  wholeScript: boolean;
  /** Step-1 languages (both neighbours') and the step-2 window language. */
  context: { neighbours: TargetLanguage[]; window: TargetLanguage | null };
  /** Languages that can take the whole word. */
  candidates: TargetLanguage[];
  /** Target alphabets whose fold breaks their language (letters or rule). */
  rejected: Partial<Record<ConfusionAlphabet, string>>;
  evidence?: Evidence;
  /** The word after resolution (the Russian case ending, if any, kept as written). */
  normalized: string;
}

/** Decision 41m defaults: word majority needs at least this many letters of the leading alphabet… */
export const WORD_MAJORITY_MIN_LETTERS = 3;
/** …and at least this share of the word's letters. */
export const WORD_MAJORITY_MIN_SHARE = 2 / 3;

export interface ResolveOptions {
  wholeScriptFold?: WholeScriptFold;
  expectedScripts?: ReadonlySet<string>;
  /** Decision 41m: the word-majority step's thresholds (`ladder.wordMajorityMinLetters`, `…MinShare`). */
  wordMajorityMinLetters?: number;
  wordMajorityMinShare?: number;
  /** Step 2's window, ± words (decision 22; `analyze`'s `majorityWindow`). Default 10. */
  majorityWindow?: number;
}

/** The ladder's options (the window is the caller's). */
type LadderOptions = Required<
  Pick<
    ResolveOptions,
    'wholeScriptFold' | 'expectedScripts' | 'wordMajorityMinLetters' | 'wordMajorityMinShare'
  >
>;

/** Context of one word: step-1 and step-2 alphabets (ids, -1 = none). */
/**
 * The ladder's context, in LANGUAGES (owner, 2026-11-19: never mix languages): `near` the
 * language bits both nearest words share (0: none), `window` the window's majority language
 * bit (-1: none).
 */
export interface WordContext {
  near: number;
  window: number;
  hyphen: boolean;
}

const LATIN = 0;
const CYRILLIC = 1;
const GREEK = 2;
const LATIN_EXTRA = 6;
/** The Donor alphabet: letters (digits, marks) of scripts outside the table that a pack maps. */
const DONOR = 7;
const APOSTROPHE_ENDING = /^(.*\p{Script=Latin}.*)(['’])(\p{Script=Cyrillic}{1,3})$/u;
const name = (a: number) => (a < 0 ? null : CONFUSION_ALPHABETS[a]!);

/**
 * Stem judged for a token with an apostrophe case ending, else the token. The
 * endings are Russian's: only when Russian is requested (decision 40d).
 */
export function splitEnding(token: string, russian = true): { stem: string; tail: string } {
  const m = russian ? APOSTROPHE_ENDING.exec(token) : null;
  return m && RU_CASE_ENDINGS.has(m[3]!.toLowerCase())
    ? { stem: m[1]!, tail: m[2]! + m[3]! }
    : { stem: token, tail: '' };
}

/** Number of set bits in an alphabet mask. */
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
  // Never mix languages: a requested language of another alphabet can take it.
  if (!ins.scripts.has(-1) && ins.validLangs.some((b) => LANG_ALPHA[b] !== S)) return null;
  return { S, n: ins.native[S]! };
}

/**
 * Context-free part of the ladder: does the word go past the early exits of
 * §4.3 (whole-script modes), i.e. can its resolution depend on context?
 */
const STROKES: ReadonlySet<string> = new Set(CASE_STROKES.map((c) => String.fromCodePoint(c)));
/** The word is one of decision 37's caseless strokes, alone. */
const loneStroke = (ins: Inspection) =>
  ins.cl.letters.length === 1 && STROKES.has(ins.cl.base[ins.cl.letters[0]!]!);

function mayResolve(ins: Inspection, opts: LadderOptions, targetMask: number): boolean {
  const { scripts, validLangs, evidence } = ins;
  const letters = ins.cl.letters.length;
  if (letters === 0 || scripts.has(-1)) return false;
  if (scripts.size !== 1) return true;
  const [S] = scripts as Set<number>;
  // Decision 41d: a donor converts standalone, so one donor letter is enough.
  // A same-script donor (40f: `ſ`, `ı`) is a donor too: one letter is enough.
  // Decision 37: a lone caseless cap-height stroke (`ǀ`) reads `I` like the other strokes.
  if (
    (letters < 2 && S !== DONOR && evidence?.kind !== 'conditional' && !loneStroke(ins)) ||
    opts.expectedScripts.has(name(S!)!)
  )
    return false;
  if (!evidence && opts.wholeScriptFold !== 'all') return false;
  // Decision 40f: a fold within the word's own (requested) script.
  if (evidence?.kind === 'conditional' && targetMask & (1 << S!)) return true;
  // Decision 40d: a Latin word folds into Latin by case or conditional evidence only when Latin is requested.
  if (S === LATIN && targetMask & (1 << LATIN))
    return evidence?.kind === 'case' || evidence?.kind === 'conditional';
  // Candidates are languages of other alphabets that can take the word (never mix languages).
  let cands = validLangs.filter((b) => LANG_ALPHA[b] !== S);
  if (evidence?.kind === 'case') cands = cands.filter((b) => LANG_ALPHA[b] === LATIN);
  return cands.length > 0;
}

/** The §4.2 ladder for one stem whose `mayResolve` is true; targets are languages (never mix). */
export function resolveInspected(
  model: ConfusionModel,
  ins: Inspection,
  ctx: WordContext,
  opts: LadderOptions,
): (Omit<WordResolution, 'normalized'> & { normalized: string | null }) | null {
  const { cl, scripts, nativeLang, validLangs, evidence, anomaly } = ins;
  const whole = scripts.size === 1;
  const S = whole ? [...scripts][0]! : -1;
  const mode = opts.wholeScriptFold;
  const langs = model.languages;
  const byBit = (bit: number) => langs.find((l) => l.bit === bit)!;
  const names = (mask: number) => langs.filter((l) => mask & (1 << l.bit)).map((l) => l.name);
  const base = {
    wholeScript: whole,
    context: {
      neighbours: names(ctx.near),
      window: ctx.window < 0 ? null : byBit(ctx.window).name,
    },
    candidates: validLangs.map((b) => byBit(b).name),
    rejected: ins.rejected,
    ...(evidence ? { evidence } : {}),
  };
  const keep = (cls: 'confusable' | 'mixed', rule: ResolutionRule) => ({
    ...base,
    class: cls,
    script: null,
    language: null,
    rule,
    folded: false,
    normalized: null,
  });
  /** Folded into language `bit`: its alphabet, its letters only. */
  const take = (bit: number, rule: ResolutionRule) => {
    const l = byBit(bit);
    return {
      ...base,
      class: 'confusable' as const,
      script: name(l.alpha),
      language: l.name,
      rule,
      folded: true,
      normalized: model.foldLang(cl, bit, anomaly),
    };
  };
  /**
   * A fold within the word's own script `T` (40f, the case anomaly), per language: the first
   * requested language of T whose letters alone fold it into that language; else, with
   * none, the first requested language of T (its letters only, the rest as written).
   */
  const takeWithin = (T: number, rule: ResolutionRule) => {
    const fit = model.fitsLanguage(cl, T, anomaly);
    const l = fit >= 0 ? byBit(fit) : langs.find((x) => x.alpha === T);
    return {
      ...base,
      class: 'confusable' as const,
      script: name(T),
      language: l ? l.name : null,
      rule,
      folded: true,
      normalized: l ? model.foldLang(cl, l.bit, anomaly) : model.fold(cl, T, anomaly),
    };
  };
  let cands = validLangs;
  // Decision 41n: a mixed word converts only into a requested language that already holds one
  // of its letters (`ΠI` → `ΠΙ`, never `ПІ`); with none of its letters in a requested
  // language (a donor word), every language that takes it stays a candidate.
  if (!whole) {
    const holding = validLangs.filter((b) => nativeLang[b]! > 0);
    cands = holding.length ? holding : langs.some((l) => nativeLang[l.bit]! > 0) ? [] : validLangs;
  }
  if (whole) {
    // Decision 40f: a fold within the word's own requested script (`λογοϲ` → `λογοσ`).
    // A word of such letters only is no word of the script: 41e's primary target below (`ϲ` → `c`).
    const lone =
      evidence?.kind === 'conditional' &&
      cl.letters.every((i) => evidence.letters.includes(cl.base[i]!));
    if (evidence?.kind === 'conditional' && !lone && model.targetMask & (1 << S))
      return mode === 'off'
        ? keep('confusable', 'conditional-twin')
        : takeWithin(S, 'conditional-twin');
    if (S === LATIN && model.targetMask & (1 << LATIN)) {
      const rule = evidence!.kind === 'case' ? 'case-anomaly' : 'conditional-twin';
      return mode === 'off' ? keep('confusable', rule) : takeWithin(LATIN, rule);
    }
    cands = validLangs.filter((b) => byBit(b).alpha !== S);
    if (evidence?.kind === 'case') cands = cands.filter((b) => byBit(b).alpha === LATIN);
    if (evidence && mode === 'off') return keep('confusable', 'evidence');
  }
  // Decision 37: a lone caseless cap-height stroke reads the Roman numeral `I` (Latin), in any
  // context, before the ladder: no Ukrainian `І` or Greek `Ι` from the context (`Он ǀ она`).
  if (whole && loneStroke(ins)) {
    const latin = cands.filter((b) => byBit(b).alpha === LATIN);
    return latin.length ? take(latin[0]!, 'one-target') : null;
  }
  // Decision 41e: a donor word only one target can take folds into it, whatever the context.
  if (whole && S === DONOR && !evidence && cands.length === 1) return take(cands[0]!, 'one-target');
  const steps: [ResolutionRule, number][] = [
    [ctx.hyphen ? 'hyphen' : 'neighbours', ctx.near],
    ['window', ctx.window < 0 ? 0 : 1 << ctx.window],
  ];
  for (const [rule, X] of steps) {
    if (X === 0) continue;
    // The word is already its context's language: it fits its context.
    if (whole && !evidence && ins.ownLangs & X) return null;
    // A context language takes it only if that language can (no other language of its script).
    const pick = cands.find((b) => X & (1 << b));
    if (pick !== undefined) return take(pick, rule);
  }
  // Decision 41e: a whole word several languages can take (a donor word, or one with
  // evidence), whose context gives none of them, folds into the primary target, else the
  // next requested language in `targetLanguages` order (cands are in that order).
  if (whole && (evidence || S === DONOR)) {
    if (cands.length) return take(cands[0]!, 'primary-target');
  }
  if (whole && !evidence) return null; // whole-script words fold only on context or evidence
  const ranked = [...cands].sort((a, b) => nativeLang[b]! - nativeLang[a]!);
  const lead = ranked[0];
  // Decision 41m: a sizable majority only (≥ minLetters and ≥ minShare of the word's letters);
  // otherwise the request order below decides.
  if (
    lead !== undefined &&
    nativeLang[lead]! >= opts.wordMajorityMinLetters &&
    nativeLang[lead]! >= opts.wordMajorityMinShare * cl.letters.length &&
    (ranked.length === 1 || nativeLang[lead]! > nativeLang[ranked[1]!]!)
  )
    return take(lead, 'word-majority');
  // Decision 41e: several languages and no context or majority decides: the primary target,
  // else the first requested language that can take it.
  if (cands.length) return take(cands[0]!, 'any-valid');
  return keep('mixed', 'no-valid-alphabet');
}

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

const isHyphen = (c: number) => c === 0x2d || c === 0x2010 || c === 0x2011;

/** One memoised classification and the token text it is for. */
interface Memo {
  key: string;
  inModel: number;
  cleanS: number;
  cleanN: number;
  cleanL: number;
  pending: PendingWord | null;
  letters: number;
}

/** A word whose resolution depends on its context: its inspection and the stem judged. */
export interface PendingWord {
  ins: Inspection;
  stem: string;
  tail: string;
}

/**
 * The context-free part of resolution for one token (one pass over its code
 * points through the model's table; the prototype's NFD path only for tokens
 * that need it): whether every letter is in the model, the clean context
 * alphabet it votes for, and the inspection when context can move it.
 */
export class TokenClassifier {
  /** Every letter is in the model (the resolver is the authority). */
  inModel = 0;
  /** Alphabet the token votes for as a clean context word, -1 = none; and its letters. */
  cleanS = -1;
  cleanN = 0;
  /** The requested languages (bits) a clean context word votes for: those holding all its letters. */
  cleanL = 0;
  /** Set when the word's resolution depends on context. */
  pending: PendingWord | null = null;
  /** The token has a letter the model judges. */
  letters = 0;
  readonly opts: LadderOptions;
  /** Decision 40d: Russian is requested (its case endings apply); Latin is a requested target. */
  private readonly russian: boolean;
  constructor(
    readonly model: ConfusionModel,
    options: ResolveOptions = {},
  ) {
    this.russian = model.targetLanguages.includes('Russian');
    this.opts = {
      wholeScriptFold: options.wholeScriptFold ?? 'all',
      expectedScripts: options.expectedScripts ?? new Set(),
      wordMajorityMinLetters: options.wordMajorityMinLetters ?? WORD_MAJORITY_MIN_LETTERS,
      wordMajorityMinShare: options.wordMajorityMinShare ?? WORD_MAJORITY_MIN_SHARE,
    };
  }
  /**
   * Results per token text (repeated words; the classification is context-free), by a hash
   * of the text read in place (no slice to hash); the stored text confirms a hit.
   */
  private readonly memo = new Map<number, Memo>();

  classify(text: string, tokStart: number, tokEnd: number): void {
    let h = tokEnd - tokStart;
    for (let i = tokStart; i < tokEnd; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
    const hit = this.memo.get(h);
    if (hit && hit.key.length === tokEnd - tokStart && text.startsWith(hit.key, tokStart)) {
      ({
        inModel: this.inModel,
        cleanS: this.cleanS,
        cleanN: this.cleanN,
        cleanL: this.cleanL,
        pending: this.pending,
        letters: this.letters,
      } = hit);
      return;
    }
    const key = tokStart === 0 && tokEnd === text.length ? text : text.slice(tokStart, tokEnd);
    this.classifyText(key, 0, key.length);
    if (this.memo.size >= 8192) this.memo.clear();
    const { inModel, cleanS, cleanN, cleanL, pending, letters } = this;
    this.memo.set(h, { key, inModel, cleanS, cleanN, cleanL, pending, letters });
  }

  private classifyText(text: string, tokStart: number, tokEnd: number): void {
    this.inModel = 0;
    this.cleanS = -1;
    this.cleanN = 0;
    this.cleanL = 0;
    this.pending = null;
    const info = this.model.info;
    const bmpInfo = this.model.bmpInfo;
    let kinds = 0;
    let letters = 0;
    let none = 0;
    let cand = 0x7f;
    let langAnd = 0x1fff;
    let slow = false;
    let apostrophe = false;
    let prev = 0;
    let innerUpper = false;
    // Decision 42: the case anomaly is per dash-separated part (`paypaI-now`, `type-I`).
    let partLetters = 0;
    let partAnomaly = false;
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
        // A mark on a Cyrillic letter may make a listed letter of its own (`е` + U+0308 = `ё`):
        // the slow path reads the composed letter (never mix languages).
        if (k === KIND_MARK && (prev & KIND_MASK) === CYRILLIC && letters > 0) slow = true;
        if (v & F_APOSTROPHE) apostrophe = true;
        else if (cp === 0x2d || cp === 0x2010 || cp === 0x2011) {
          if (partLetters >= 4 && prev & F_I_SHAPED && !innerUpper) partAnomaly = true;
          partLetters = 0;
          innerUpper = false;
          prev = 0;
        }
        continue;
      }
      kinds |= 1 << k;
      if (k === KIND_NONE) none++;
      else cand &= ((v >>> TWIN_SHIFT) & 0x7f) | (1 << k);
      if (v & (F_RULE | F_INTRA_LATIN)) slow = true;
      langAnd &= v >>> LANG_SHIFT;
      if (partLetters >= 2 && prev & F_UPPER) innerUpper = true;
      prev = v;
      letters++;
      partLetters++;
    }
    this.letters = letters;
    if (letters === 0) return;
    const modelKinds = kinds & 0xff; // the table's alphabets and Donor
    this.inModel = none === 0 ? 1 : 0;
    const single = popcount7(modelKinds) === 1;
    const ending = apostrophe && (kinds & (1 << CYRILLIC)) !== 0 && !single;
    if (ending) slow = true;
    else if (none > 0) {
      if (single) {
        this.cleanS = 31 - Math.clz32(modelKinds);
        this.cleanN = letters - none;
        // A letter no requested language has: the word is no requested language's.
        this.cleanL = 0;
      }
      return;
    }
    if (!slow && single) {
      const S = 31 - Math.clz32(modelKinds);
      const anomalyPossible =
        partAnomaly || (partLetters >= 4 && (prev & F_I_SHAPED) !== 0 && !innerUpper);
      // Decision 40d: legitimacy against the requested languages of the script.
      const langOk =
        S > GREEK ||
        !(this.model.targetMask & (1 << S)) ||
        (langAnd & SCRIPT_LANG_MASK[S]! & this.model.langMask) !== 0;
      if (S !== LATIN_EXTRA && (cand & ~(1 << S)) === 0 && !anomalyPossible && langOk) {
        this.cleanS = S;
        this.cleanN = letters;
        this.cleanL = langAnd & this.model.langMask;
        return;
      }
    }
    // Slow path: the prototype on NFD clusters (cached per stem).
    const s = text.slice(tokStart, tokEnd);
    const { stem, tail } = apostrophe ? splitEnding(s, this.russian) : { stem: s, tail: '' };
    const ins = this.model.inspect(stem);
    const clean = cleanOf(ins);
    if (clean) {
      this.cleanS = clean.S;
      this.cleanN = clean.n;
      this.cleanL = ins.ownLangs;
    }
    if (mayResolve(ins, this.opts, this.model.targetMask)) this.pending = { ins, stem, tail };
  }
  /** The ladder for a pending word under its context. */
  resolve(p: PendingWord, ctx: WordContext): WordResolution | null {
    const r = resolveInspected(this.model, p.ins, ctx, this.opts);
    return r && { ...r, normalized: (r.normalized ?? p.stem) + p.tail };
  }
}

export { isHyphen, isJsSpace };

/**
 * Resolves one word on its own, given the context languages the caller
 * observed (step 1: both neighbours; step 2: the window's majority).
 * Returns null when the word is not resolved (clean, outside the model, or a
 * whole-script word its context does not move).
 */
export function resolveWord(
  word: string,
  context: {
    /** The language(s) both neighbours are written in (never mix languages: languages, not alphabets). */
    neighbours?: TargetLanguage | readonly TargetLanguage[] | null;
    window?: TargetLanguage | null;
    hyphen?: boolean;
  } = {},
  options: ConfusionModelOptions & ResolveOptions = {},
): WordResolution | null {
  // Context names are languages (never mix languages), checked first, whatever the word: an
  // alphabet name (`'Cyrillic'`) is no context. A language not requested casts no vote.
  const nb = context.neighbours;
  const names = nb == null ? [] : typeof nb === 'string' ? [nb] : [...nb];
  if (context.window != null) names.push(context.window);
  for (const n of names)
    if (typeof n !== 'string' || !Object.prototype.hasOwnProperty.call(TARGET_LANGUAGES, n))
      throw new RangeError(`resolveWord: context ${JSON.stringify(n)} is not a target language`);
  const model = createConfusionModel(options);
  const opts: LadderOptions = {
    wholeScriptFold: options.wholeScriptFold ?? 'all',
    expectedScripts: options.expectedScripts ?? new Set(),
    wordMajorityMinLetters: options.wordMajorityMinLetters ?? WORD_MAJORITY_MIN_LETTERS,
    wordMajorityMinShare: options.wordMajorityMinShare ?? WORD_MAJORITY_MIN_SHARE,
  };
  const { stem, tail } = splitEnding(word, model.targetLanguages.includes('Russian'));
  const ins = model.inspect(stem);
  if (!mayResolve(ins, opts, model.targetMask)) return null;
  const bit = (n: TargetLanguage) => model.languages.find((l) => l.name === n)?.bit ?? -1;
  let near = 0;
  for (const n of nb == null ? [] : typeof nb === 'string' ? [nb] : nb)
    if (bit(n) >= 0) near |= 1 << bit(n);
  const r = resolveInspected(
    model,
    ins,
    { near, window: context.window ? bit(context.window) : -1, hyphen: !!context.hyphen },
    opts,
  );
  return r && { ...r, normalized: (r.normalized ?? stem) + tail };
}
