/**
 * The confusion model of docs/confusion-model.md §3–§4: per-alphabet twin
 * table, target languages, donors, conditional twins, and the context-free
 * judgement of one word (`inspect`). Built once per option set and cached.
 *
 * Hot path: `info(cp)` — one typed-array read per code unit, giving the base
 * letter's alphabet, case, restricted twin mask and language mask — lets the
 * resolver classify ordinary words without NFD, regexes or allocation. Only
 * words that might be resolved go through `inspect`, which ports the
 * prototype (scripts/prototype-resolve.mjs) on NFD clusters.
 */
import {
  ALPHABET_LETTERS_PACKED,
  CONDITIONAL_TWIN_DATA,
  CONFUSION_ALPHABETS,
  DEFAULT_CONDITIONAL_TWIN_IDS,
  TWIN_PAIRS_PACKED,
} from './data/confusion.generated';
import {
  DEFAULT_TARGET_LANGUAGES,
  LANGUAGES,
  ORTHOGRAPHY,
  PALOCHKA,
  PALOCHKA_AFTER,
  RULE_LETTERS,
  TARGET_LANGUAGES,
  type LanguageScript,
  type TargetLanguage,
} from './languages';
import { primaryScript } from './scripts';

export { CONFUSION_ALPHABETS };
/** An alphabet of the twin table (§3.4). `LatinExtra` = donor-only Latin letters. */
export type ConfusionAlphabet = (typeof CONFUSION_ALPHABETS)[number];
/** Alphabets whose letters may be lookalikes but are never fold targets (§3.4). */
export type DonorAlphabet = ConfusionAlphabet;

/** Ids of the conditional twins (§3.3). */
export type ConditionalTwinId =
  | 'χ~x'
  | 'χ~х'
  | 'ҳ~x'
  | 'ҳ~χ'
  | 'η~n'
  | 'ŋ~n'
  | 'ɳ~n'
  | 'и~u'
  | 'т~m'
  | 'п~n'
  | 'ı~i'
  | 'ҫ~c'
  | 'ɽ~r'
  | 'ʐ~z';

const ch = (cp: number) => String.fromCodePoint(cp);

/** Conditional twins: pairs that look alike only under some rendering (§3.3). */
export const CONDITIONAL_TWINS: Readonly<
  Record<
    ConditionalTwinId,
    {
      kind: 'descender' | 'italic' | 'shape';
      pairs: readonly (readonly [string, string])[];
      intraLatin: readonly (readonly [string, string])[];
    }
  >
> = Object.fromEntries(
  Object.entries(CONDITIONAL_TWIN_DATA).map(([id, d]) => [
    id,
    {
      kind: d.kind,
      pairs: d.pairs.map(([a, b]) => [ch(a), ch(b)] as const),
      intraLatin: d.intraLatin.map(([a, b]) => [ch(a), ch(b)] as const),
    },
  ]),
) as never;

/** Default conditional set (owner, final): the x-likes and `ı~i` on, everything else off. */
export const DEFAULT_CONDITIONAL_TWINS: ReadonlySet<ConditionalTwinId> = new Set(
  DEFAULT_CONDITIONAL_TWIN_IDS as ConditionalTwinId[],
);

// ---------------------------------------------------------------------------
// Static table (parsed once).

const LATIN = 0;
const CYRILLIC = 1;
const GREEK = 2;
const LATIN_EXTRA = 6;
const N_ALPHA = CONFUSION_ALPHABETS.length;
/** Kinds returned by `info(cp) & KIND_MASK` beyond the alphabet ids 0..6. */
export const KIND_NONE = 7; // a letter outside the model
export const KIND_MARK = 8;
export const KIND_OTHER = 9;
export const KIND_MASK = 0xf;
export const F_UPPER = 1 << 4;
/** Letter some language rule looks at (ь ъ ы σ ς palochka): never fast-path. */
export const F_RULE = 1 << 5;
export const F_I_SHAPED = 1 << 6;
export const F_INTRA_LATIN = 1 << 7;
export const F_APOSTROPHE = 1 << 8;
export const TWIN_SHIFT = 9; // 7 bits: restricted same-case twin per alphabet
export const LANG_SHIFT = 16; // 13 bits: languages containing the lowercase base
const F_COMPUTED = 1 << 30;

interface Table {
  alphabetOf: Map<number, number>;
  order: Map<number, number>;
  letters: number[][];
  pairs: [number, number][];
}
let table: Table | null = null;
function loadTable(): Table {
  if (table) return table;
  const alphabetOf = new Map<number, number>();
  const order = new Map<number, number>();
  const letters = CONFUSION_ALPHABETS.map((name, a) => {
    const list = ALPHABET_LETTERS_PACKED[name].split(',').map((h) => parseInt(h, 16));
    list.forEach((cp, i) => {
      alphabetOf.set(cp, a);
      order.set(cp, i);
    });
    return list;
  });
  const pairs: [number, number][] = TWIN_PAIRS_PACKED.split(';').map((e) => {
    const [a, b] = e.slice(0, -1).split('.');
    return [parseInt(a!, 16), parseInt(b!, 16)];
  });
  table = { alphabetOf, order, letters, pairs };
  return table;
}

/** Twin pairs of the static table with their tag (u = UTS #39, x = cross-case, c = curated). */
export function twinPairs(): readonly { a: string; b: string; tag: 'u' | 'x' | 'c' }[] {
  return TWIN_PAIRS_PACKED.split(';').map((e) => {
    const [a, b] = e.slice(0, -1).split('.');
    return { a: ch(parseInt(a!, 16)), b: ch(parseInt(b!, 16)), tag: e.at(-1) as 'u' | 'x' | 'c' };
  });
}

/** Letters of every model alphabet, in fold-preference order. */
export function alphabetLetters(): Readonly<Record<ConfusionAlphabet, string>> {
  const t = loadTable();
  return Object.fromEntries(
    CONFUSION_ALPHABETS.map((n, a) => [n, t.letters[a]!.map(ch).join('')]),
  ) as Record<ConfusionAlphabet, string>;
}

const isUpperStr = (c: string) => c !== c.toLowerCase();
const LETTER_RE = /\p{L}/u;
const MARK_RE = /\p{M}/u;
/** Fold targets are restricted to core letters (§3.1). */
function isCore(cp: number, T: number): boolean {
  if (T === LATIN) return (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a);
  if (T === CYRILLIC) return (cp >= 0x400 && cp <= 0x45f) || cp === 0x490 || cp === 0x491;
  if (T === GREEK) return cp >= 0x391 && cp <= 0x3c9;
  return true;
}
/** Cross-case UTS #39 pairs only count as these directional folds (§3.2). */
const CROSS_CASE_ALLOWED = new Set(['І>l', 'Ӏ>l', 'Ι>l', 'Ь>b']);
const I_SHAPED = new Set(['I', 'І', 'Ӏ', 'ӏ', 'Ι']);
const SCRIPT_ALPHABET: Record<string, number> = {
  Latin: 0,
  Cyrillic: 1,
  Greek: 2,
  Armenian: 3,
  Cherokee: 4,
  Coptic: 5,
};

/** Language names with a global bit index (≤ 13). */
const LANG_LIST = (Object.keys(TARGET_LANGUAGES) as TargetLanguage[]).map((name, bit) => ({
  name,
  bit,
  script: TARGET_LANGUAGES[name].script,
  set: new Set([...TARGET_LANGUAGES[name].letters]),
}));
/** Language bits per alphabet id (Latin, Cyrillic, Greek; 0 for the rest). */
export const SCRIPT_LANG_MASK: number[] = [0, 0, 0, 0, 0, 0, 0];
for (const l of LANG_LIST) SCRIPT_LANG_MASK[SCRIPT_ALPHABET[l.script]!]! |= 1 << l.bit;
const EUROPEAN_LATIN = new Set(Object.values(LANGUAGES.Latin).flatMap((a) => [...a]));

// ---------------------------------------------------------------------------
// Model.

export interface ConfusionModelOptions {
  /** Fold destinations (§4.4b). Default: English, Russian, Ukrainian, Greek. */
  targetLanguages?: readonly TargetLanguage[];
  /** Lookalike-only alphabets (§3.4). Default: every alphabet no target language uses. */
  donorAlphabets?: readonly DonorAlphabet[];
  /** Enabled conditional twins (§3.3). Default {@link DEFAULT_CONDITIONAL_TWINS}. */
  conditionalTwins?: ReadonlySet<ConditionalTwinId> | readonly ConditionalTwinId[];
}

export type Evidence =
  | { kind: 'foreign'; letters: string }
  | { kind: 'orthography'; rule: string }
  | { kind: 'case'; letters: string }
  | { kind: 'donor'; letters: string }
  | { kind: 'conditional'; letters: string };

/** NFD clusters of a word: base character + its trailing marks. */
export interface Clusters {
  base: string[];
  marks: string[];
  /** Indices of letter clusters. */
  letters: number[];
}

/** Context-free facts about one word (§4.1 steps 2–4). */
export interface Inspection {
  cl: Clusters;
  /** Alphabet ids of the letters; -1 = a letter outside the model. */
  scripts: Set<number>;
  native: number[];
  blockers: string[];
  /** Alphabet ids the whole word fits. */
  valid: number[];
  rejected: Partial<Record<ConfusionAlphabet, string>>;
  evidence: Evidence | null;
  /** Cluster index of the case-anomaly letter, or -1. */
  anomaly: number;
}

export interface ConfusionModel {
  readonly key: string;
  readonly targetLanguages: readonly TargetLanguage[];
  readonly donorAlphabets: readonly ConfusionAlphabet[];
  /** Alphabets in the model for this configuration (targets' scripts + donors). */
  readonly alphabets: readonly ConfusionAlphabet[];
  /** Bit mask of alphabets with an enabled target language. */
  readonly targetMask: number;
  /** Packed per-code-point facts (see the F_* / *_SHIFT constants). */
  info(cp: number): number;
  /** The BMP part of `info`, read directly on the hot path (0 = not computed yet). */
  readonly bmpInfo: Int32Array;
  /** Best twin of a letter in alphabet T (§4.1 step 7), or null. */
  twinIn(c: string, T: ConfusionAlphabet, wantUpper?: boolean, restricted?: boolean): string | null;
  inspect(word: string): Inspection;
  fold(cl: Clusters, T: number, anomaly: number): string;
  languageViolation(
    bases: readonly string[],
    S: number,
    elided?: boolean,
    only?: readonly string[] | null,
  ): Evidence | null;
}

const cache = new Map<string, ConfusionModel>();

/** Builds (or returns the cached) confusion model for an option set. */
export function createConfusionModel(options: ConfusionModelOptions = {}): ConfusionModel {
  const targets = options.targetLanguages ?? DEFAULT_TARGET_LANGUAGES;
  const twinsOpt = options.conditionalTwins ?? DEFAULT_CONDITIONAL_TWINS;
  const conditional = [...new Set(twinsOpt)].sort();
  const key = `${[...targets].join(',')}|${options.donorAlphabets ? [...options.donorAlphabets].join(',') : '*'}|${conditional.join(',')}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const model = build(targets, options.donorAlphabets ?? null, conditional);
  cache.set(key, model);
  return model;
}

function build(
  targetLanguages: readonly TargetLanguage[],
  donorOpt: readonly ConfusionAlphabet[] | null,
  conditional: readonly ConditionalTwinId[],
): ConfusionModel {
  const t = loadTable();
  for (const id of conditional)
    if (!(id in CONDITIONAL_TWINS)) throw new Error(`unknown conditional twin ${id}`);
  // twins[cp] = per alphabet, the twin code points.
  const twins = new Map<number, number[][]>();
  const link = (a: number, b: number) => {
    for (const [x, y] of [
      [a, b],
      [b, a],
    ] as const) {
      let per = twins.get(x);
      if (!per) twins.set(x, (per = Array.from({ length: N_ALPHA }, () => [])));
      const list = per[t.alphabetOf.get(y)!]!;
      if (!list.includes(y)) list.push(y);
    }
  };
  for (const [a, b] of t.pairs) link(a, b);
  const intraLatin = new Map<string, string>();
  for (const id of conditional) {
    const d = CONDITIONAL_TWIN_DATA[id]!;
    for (const [a, b] of d.pairs) link(a, b);
    for (const [a, b] of d.intraLatin) intraLatin.set(ch(a), ch(b));
  }

  const targetLetters: (Set<string> | undefined)[] = [];
  const targetNames: (string[] | undefined)[] = [];
  for (const name of targetLanguages) {
    const L = TARGET_LANGUAGES[name];
    if (!L) throw new Error(`unknown target language ${name}`);
    const a = SCRIPT_ALPHABET[L.script]!;
    const set = (targetLetters[a] ??= new Set());
    for (const c of L.letters) set.add(c);
    (targetNames[a] ??= []).push(name);
  }
  let targetMask = 0;
  for (let a = 0; a < N_ALPHA; a++) if (targetNames[a]) targetMask |= 1 << a;
  const donors: ConfusionAlphabet[] = donorOpt
    ? [...donorOpt]
    : CONFUSION_ALPHABETS.filter((_, a) => !(targetMask & (1 << a)));
  for (const d of donors)
    if (!CONFUSION_ALPHABETS.includes(d)) throw new Error(`unknown donor alphabet ${d}`);
  let modelMask = targetMask;
  for (const d of donors) modelMask |= 1 << CONFUSION_ALPHABETS.indexOf(d);
  const inModel = (a: number) => (modelMask & (1 << a)) !== 0;

  const twinMemo = new Map<number, string | null>();
  function twinIn(c: string, T: number, wantUpper = isUpperStr(c), restricted = true) {
    const cp = c.codePointAt(0)!;
    const key = cp * 32 + T * 4 + (wantUpper ? 2 : 0) + (restricted ? 1 : 0);
    let r = twinMemo.get(key);
    if (r === undefined) twinMemo.set(key, (r = twinInUncached(c, cp, T, wantUpper, restricted)));
    return r;
  }
  function twinInUncached(
    c: string,
    cp: number,
    T: number,
    wantUpper: boolean,
    restricted: boolean,
  ) {
    const all = twins.get(cp)?.[T];
    if (!all || all.length === 0) return null;
    const allowed = targetLetters[T];
    if (restricted && !allowed) return null;
    const up = isUpperStr(c);
    let best: number | null = null;
    let bestScore = 0;
    for (const y of all) {
      const ys = ch(y);
      const yUp = isUpperStr(ys);
      if (!isCore(y, T)) continue;
      if (restricted && !allowed!.has(ys.toLowerCase())) continue;
      if (yUp !== up && !CROSS_CASE_ALLOWED.has(`${c}>${ys}`)) continue;
      const score = (yUp !== wantUpper ? 1 << 20 : 0) + t.order.get(y)!;
      if (best === null || score < bestScore) [best, bestScore] = [y, score];
    }
    return best === null ? null : ch(best);
  }

  // A Latin extra letter is a donor only if it has a twin among the Latin
  // target letters and is not a letter of a modelled European language (§3.4).
  const donorExtra = new Set<number>();
  if (inModel(LATIN_EXTRA))
    for (const cp of t.letters[LATIN_EXTRA]!) {
      const c = ch(cp);
      if (
        !EUROPEAN_LATIN.has(c.toLowerCase()) &&
        !targetLetters[LATIN]?.has(c.toLowerCase()) &&
        twinIn(c, LATIN, isUpperStr(c), true)
      )
        donorExtra.add(cp);
    }

  /** Alphabet id of a base letter for this configuration, or -1 (outside the model). */
  function scriptOf(c: string): number {
    const cp = c.codePointAt(0)!;
    let a = t.alphabetOf.get(cp);
    if (a === undefined) a = SCRIPT_ALPHABET[primaryScript(c)];
    if (a === undefined) return -1;
    if (a === LATIN_EXTRA && !donorExtra.has(cp)) return inModel(LATIN) ? LATIN : -1;
    return inModel(a) ? a : -1;
  }

  // ---- per-code-point facts ------------------------------------------------
  const bmp = new Int32Array(0x10000);
  const astral = new Map<number, number>();
  function compute(cp: number): number {
    const s = ch(cp);
    if (cp === 0x27 || cp === 0x2019) return F_COMPUTED | KIND_OTHER | F_APOSTROPHE;
    if (!LETTER_RE.test(s)) return F_COMPUTED | (MARK_RE.test(s) ? KIND_MARK : KIND_OTHER);
    const base = String.fromCodePoint(s.normalize('NFD').codePointAt(0)!);
    if (!LETTER_RE.test(base)) return F_COMPUTED | KIND_OTHER;
    const a = scriptOf(base);
    let v = F_COMPUTED | (a < 0 ? KIND_NONE : a);
    const up = isUpperStr(base);
    if (up) v |= F_UPPER;
    if (RULE_LETTERS.has(base)) v |= F_RULE;
    if (I_SHAPED.has(base)) v |= F_I_SHAPED;
    if (intraLatin.has(base)) v |= F_INTRA_LATIN;
    if (a >= 0)
      for (let T = 0; T < N_ALPHA; T++)
        if (T !== a && inModel(T) && twinIn(base, T, up, true)) v |= 1 << (TWIN_SHIFT + T);
    const low = base.toLowerCase();
    for (const l of LANG_LIST) if (l.set.has(low)) v |= 1 << (LANG_SHIFT + l.bit);
    return v;
  }
  function info(cp: number): number {
    if (cp < 0x10000) {
      const v = bmp[cp]!;
      if (v !== 0) return v;
      return (bmp[cp] = compute(cp));
    }
    let v = astral.get(cp);
    if (v === undefined) astral.set(cp, (v = compute(cp)));
    return v;
  }

  // ---- slow path: the prototype on NFD clusters -----------------------------
  function clusters(seg: string): Clusters {
    const base: string[] = [];
    const marks: string[] = [];
    const letters: number[] = [];
    for (const c of seg.normalize('NFD')) {
      const k = info(c.codePointAt(0)!) & KIND_MASK;
      if (k === KIND_MARK && base.length) marks[marks.length - 1] += c;
      else {
        if (k <= KIND_NONE) letters.push(base.length);
        base.push(c);
        marks.push('');
      }
    }
    return { base, marks, letters };
  }

  /** Folds every letter not native to T into its twin in T (§4.1 step 7). */
  function fold(cl: Clusters, T: number, anomaly: number): string {
    const L = cl.letters;
    let lowerAfterFirst = 0;
    for (let k = 1; k < L.length; k++) if (!isUpperStr(cl.base[L[k]!]!)) lowerAfterFirst++;
    const lowerWord = L.length > 2 && lowerAfterFirst >= L.length - 2;
    let out = '';
    let li = 0;
    for (let i = 0; i < cl.base.length; i++) {
      const b = cl.base[i]!;
      const m = cl.marks[i]!;
      if (L[li] !== i) {
        out += b + m;
        continue;
      }
      const pos = li++;
      if (i === anomaly && T === LATIN) out += 'l' + m;
      else if (T === LATIN && intraLatin.has(b)) out += intraLatin.get(b)! + m;
      else if (scriptOf(b) === T) out += b + m;
      else out += (twinIn(b, T, pos > 0 && lowerWord ? false : isUpperStr(b)) ?? b) + m;
    }
    return out.normalize('NFC');
  }

  /** §4.4 + §4.6: does a single-script word fit some language of S? */
  function languageViolation(
    bases: readonly string[],
    S: number,
    elided = false,
    only: readonly string[] | null = null,
  ): Evidence | null {
    if (S !== LATIN && S !== CYRILLIC && S !== GREEK) return null;
    const script = CONFUSION_ALPHABETS[S] as LanguageScript;
    const langs = LANG_LIST.filter((l) => l.script === script && (!only || only.includes(l.name)));
    const low = bases.map((c) => c.toLowerCase());
    let best: string[] | null = null;
    let ortho: Evidence | null = null;
    for (const l of langs) {
      const miss = bases.filter((c, i) => {
        if (PALOCHKA.has(c)) return !l.set.has('ӏ') || (i > 0 && !PALOCHKA_AFTER.has(low[i - 1]!));
        return !l.set.has(low[i]!);
      });
      if (miss.length === 0) {
        const broken =
          low.length >= 2
            ? (ORTHOGRAPHY[l.name] ?? []).find((r) => !r.test(low, bases, elided))
            : null;
        if (!broken) return null;
        ortho ??= { kind: 'orthography', rule: broken.name };
        continue;
      }
      if (!best || miss.length < best.length) best = miss;
    }
    if (ortho) return ortho;
    if (only) return { kind: 'foreign', letters: (best ?? bases).join('') };
    // Only lookalikes are spoof evidence: a foreign letter with no twin in any
    // other alphabet (Tatar җ, Bashkir ҡ) just means an unmodelled language.
    const look = (best ?? []).filter((c) => {
      for (let T = 0; T < N_ALPHA; T++)
        if (T !== S && inModel(T) && twinIn(c, T, isUpperStr(c), false)) return true;
      return false;
    });
    return look.length ? { kind: 'foreign', letters: look.join('') } : null;
  }

  const latinTargetSets = LANG_LIST.filter((l) => targetNames[LATIN]?.includes(l.name)).map(
    (l) => l.set,
  );
  /**
   * §3.3: an intra-Latin fold applies only if every letter of the folded word,
   * accents included, is in one Latin target language (ışık → işik keeps ş: no fold).
   */
  function fitsLatinTarget(folded: string): boolean {
    const cs = [...folded.toLowerCase()];
    if (cs.some((c) => MARK_RE.test(c))) return false;
    const letters = cs.filter((c) => LETTER_RE.test(c));
    return latinTargetSets.some((set) => letters.every((c) => set.has(c)));
  }

  /** §4.5: an I-shaped last letter after lowercase letters (≥ 4 letters); -1 if none. */
  function caseAnomaly(cl: Clusters): number {
    const L = cl.letters;
    if (L.length < 4) return -1;
    const last = cl.base[L[L.length - 1]!]!;
    if (!I_SHAPED.has(last)) return -1;
    for (let k = 1; k < L.length - 1; k++) if (isUpperStr(cl.base[L[k]!]!)) return -1;
    const prev = cl.base[L[L.length - 2]!]!.toLowerCase();
    if (PALOCHKA.has(last) && PALOCHKA_AFTER.has(prev)) return -1; // Caucasian digraph
    return L[L.length - 1]!;
  }

  const inspectCache = new Map<string, Inspection>();
  function inspect(seg: string): Inspection {
    const hit = inspectCache.get(seg);
    if (hit) return hit;
    const cl = clusters(seg);
    const bases = cl.letters.map((i) => cl.base[i]!);
    const letterScripts = bases.map(scriptOf);
    const scripts = new Set(letterScripts);
    const native: number[] = [];
    const blockers: string[] = [];
    for (let T = 0; T < N_ALPHA; T++) {
      let n = 0;
      let b = '';
      if (inModel(T))
        bases.forEach((c, k) => {
          if (letterScripts[k] === T) n++;
          else if (!twinIn(c, T)) b += c;
        });
      native.push(n);
      blockers.push(b);
    }
    const whole = scripts.size === 1 && !scripts.has(-1);
    const anomaly = whole ? caseAnomaly(cl) : -1;
    const rejected: Partial<Record<ConfusionAlphabet, string>> = {};
    const valid: number[] = [];
    for (let T = 0; T < N_ALPHA; T++) {
      if (!inModel(T) || blockers[T] !== '') continue;
      if (whole && scripts.has(T)) {
        valid.push(T);
        continue;
      }
      if (!targetNames[T]) continue;
      const folded = clusters(fold(cl, T, anomaly));
      const v = languageViolation(
        folded.letters.map((i) => folded.base[i]!),
        T,
        false,
        targetNames[T]!,
      );
      if (v) rejected[CONFUSION_ALPHABETS[T]!] = v.kind === 'orthography' ? v.rule : v.letters;
      else valid.push(T);
    }
    let evidence: Evidence | null = null;
    if (bases.length && whole) {
      const S = letterScripts[0]!;
      const lang = languageViolation(bases, S, /['’]$/.test(seg));
      let intra = S === LATIN ? bases.filter((c) => intraLatin.has(c)) : [];
      if (intra.length && !fitsLatinTarget(fold(cl, LATIN, -1))) intra = [];
      if (anomaly >= 0) evidence = { kind: 'case', letters: cl.base[anomaly]! };
      else if (S === LATIN_EXTRA) evidence = { kind: 'donor', letters: '' };
      else if (intra.length) evidence = { kind: 'conditional', letters: intra.join('') };
      else if (lang) evidence = lang;
    }
    const r: Inspection = { cl, scripts, native, blockers, valid, rejected, evidence, anomaly };
    if (inspectCache.size >= 20000) inspectCache.clear();
    inspectCache.set(seg, r);
    return r;
  }

  const alphabets = CONFUSION_ALPHABETS.filter((_, a) => inModel(a));
  return {
    key: `${targetLanguages.join(',')}|${donors.join(',')}|${conditional.join(',')}`,
    targetLanguages,
    donorAlphabets: donors,
    alphabets,
    targetMask,
    info,
    bmpInfo: bmp,
    twinIn: (c, T, wantUpper, restricted) =>
      twinIn(c, CONFUSION_ALPHABETS.indexOf(T), wantUpper ?? isUpperStr(c), restricted ?? true),
    inspect,
    fold,
    languageViolation,
  };
}

/**
 * Every twin of a letter, per alphabet, in the model built from `options`
 * (conditional twins included when enabled). Unrestricted: donor and
 * non-target letters are listed too.
 */
export function twinsOf(
  c: string,
  options: ConfusionModelOptions = {},
): Partial<Record<ConfusionAlphabet, string[]>> {
  const model = createConfusionModel(options);
  const t = loadTable();
  const out: Partial<Record<ConfusionAlphabet, string[]>> = {};
  const cp = c.codePointAt(0)!;
  const conditional = [...(options.conditionalTwins ?? DEFAULT_CONDITIONAL_TWINS)];
  const add = (y: number) => {
    const A = CONFUSION_ALPHABETS[t.alphabetOf.get(y)!]!;
    if (model.alphabets.includes(A) && !(out[A] ??= []).includes(ch(y))) out[A]!.push(ch(y));
  };
  for (const [a, b] of t.pairs) {
    if (a === cp) add(b);
    else if (b === cp) add(a);
  }
  for (const id of conditional)
    for (const [a, b] of CONDITIONAL_TWIN_DATA[id]!.pairs) {
      if (a === cp) add(b);
      else if (b === cp) add(a);
    }
  return out;
}

export const ALPHABET_ID = { LATIN, CYRILLIC, GREEK, LATIN_EXTRA } as const;
