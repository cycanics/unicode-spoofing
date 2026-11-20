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
  CONFUSION_ALPHABETS as TABLE_ALPHABETS,
  DEFAULT_CONDITIONAL_TWIN_IDS,
  TWIN_PAIRS_PACKED,
} from './data/confusion.generated';
import { DONOR_ROWS, REPLACED_TABLE_PAIRS } from './data/donor-rows';
import {
  DEFAULT_TARGET_LANGUAGES,
  ORTHOGRAPHY,
  PALOCHKA,
  PALOCHKA_AFTER,
  RULE_LETTERS,
  TARGET_LANGUAGES,
  letterKey,
  type LanguageScript,
  type TargetLanguage,
} from './languages';
import { primaryScript } from './scripts';

/**
 * Model alphabets: the twin table's (§3.4; `LatinExtra` = donor-only Latin
 * letters) and `Donor`, the letters (or digits, marks) of scripts outside the
 * table that a look-alike pack maps into a target (decision 40). Donors are
 * never fold targets.
 */
export const CONFUSION_ALPHABETS = [...TABLE_ALPHABETS, 'Donor'] as const;
/** An alphabet of the model. */
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

/** Default conditional set: the x-likes on, everything else off. */
export const DEFAULT_CONDITIONAL_TWINS: ReadonlySet<ConditionalTwinId> = new Set(
  DEFAULT_CONDITIONAL_TWIN_IDS as ConditionalTwinId[],
);

// ---------------------------------------------------------------------------
// Static table (parsed once).

const LATIN = 0;
const CYRILLIC = 1;
const GREEK = 2;
const LATIN_EXTRA = 6;
const DONOR = 7;
const N_ALPHA = CONFUSION_ALPHABETS.length;
/** Alphabets with a twin bit (`TWIN_SHIFT`): the table's; nothing folds into `Donor`. */
const N_TWIN = TABLE_ALPHABETS.length;
// Kinds returned by `info(cp) & KIND_MASK` beyond the alphabet ids 0..7.
/** `info(cp) & KIND_MASK` of a pack donor (the Donor alphabet). */
export const KIND_DONOR = DONOR;
export const KIND_NONE = 8; // a letter outside the model
export const KIND_MARK = 9;
export const KIND_OTHER = 10;
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
  const letters = TABLE_ALPHABETS.map((name, a) => {
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
    TABLE_ALPHABETS.map((n, a) => [n, t.letters[a]!.map(ch).join('')]),
  ) as Record<ConfusionAlphabet, string>;
}

const isUpperStr = (c: string) => c !== c.toLowerCase();
const LETTER_RE = /\p{L}/u;
const MARK_RE = /\p{M}/u;
const DIGIT_RE = /\p{Nd}/u;
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
/** The alphabet id of each language bit. */
export const LANG_ALPHA: readonly number[] = LANG_LIST.map((l) => SCRIPT_ALPHABET[l.script]!);
for (const l of LANG_LIST) SCRIPT_LANG_MASK[SCRIPT_ALPHABET[l.script]!]! |= 1 << l.bit;

// ---------------------------------------------------------------------------
// Model.

export interface ConfusionModelOptions {
  /** Fold destinations (§4.5). Default: English, Russian, Ukrainian, Greek. */
  targetLanguages?: readonly TargetLanguage[];
  /** Lookalike-only alphabets (§3.4). Default: every alphabet no target language uses. */
  donorAlphabets?: readonly DonorAlphabet[];
  /**
   * Enabled conditional twins (§3.3), as additional packs. Default
   * {@link DEFAULT_CONDITIONAL_TWINS}. Ignored when `lookalikes` is given.
   */
  conditionalTwins?: ReadonlySet<ConditionalTwinId> | readonly ConditionalTwinId[];
  /** The look-alike packs, built by {@link buildLookalikes} (decision 40c). Default {@link defaultLookalikes}. */
  lookalikes?: Lookalikes;
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
  /**
   * Per-language rule: the requested languages (bits, request order)
   * that can take the word: folded with that language's letters only, it is all its letters
   * (for a word already of the language's script: it is that language's letters).
   */
  validLangs: number[];
  /** Per language bit: letters of the word that are that language's letters (its native count). */
  nativeLang: number[];
  /** Language bits of the requested languages whose letters hold all of the word's letters. */
  ownLangs: number;
  rejected: Partial<Record<TargetLanguage, string>>;
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
  /** Language bits (`LANG_SHIFT` positions) of the requested target languages (decision 40d). */
  readonly langMask: number;
  /** The requested languages, in `targetLanguages` order: bit, name and alphabet id. */
  readonly languages: readonly { bit: number; name: TargetLanguage; alpha: number }[];
  /** The word folded into one language's letters (bit), its other letters as written. */
  foldLang(cl: Clusters, lang: number, anomaly: number): string;
  /** Language bits of the requested languages (`all`: every known language) holding every letter of `word` (0: none). */
  langsOf(word: string, all?: boolean): number;
  /** A letter's twin among one requested language's letters (bit); null if none. */
  twinInLang(c: string, lang: number): string | null;
  /** Decision 41b: the unrequested languages (bits) holding all of a word's letters; 0 if a letter is a requested language's. */
  foreignLangsOf(word: string): number;
  /** 40f / §4.6: the first requested language of alphabet S whose letters the word folded within S is (bit, -1 none). */
  fitsLanguage(cl: Clusters, S: number, anomaly: number): number;
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
  const looks =
    options.lookalikes ??
    (options.conditionalTwins
      ? buildLookalikes({ additional: [...options.conditionalTwins] })
      : defaultLookalikes());
  const key = `${[...targets].join(',')}|${options.donorAlphabets ? [...options.donorAlphabets].join(',') : '*'}|${looks.key}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const model = build(targets, options.donorAlphabets ?? null, looks);
  cache.set(key, model);
  return model;
}

function build(
  targetLanguages: readonly TargetLanguage[],
  donorOpt: readonly ConfusionAlphabet[] | null,
  looks: Lookalikes,
): ConfusionModel {
  const t = loadTable();
  // Letters of scripts outside the table that an enabled pack maps: the Donor alphabet.
  const packDonors = new Set<number>();
  // Decision 40f: a pair into a letter of the donor's own script, outside the twin table, is a
  // fold within that script (`ı` → `i`, `ſ` → `s`, `ϲ` → `σ`).
  const sameScript = (d: string, y: string, name: TargetLanguage) =>
    primaryScript(d) === TARGET_LANGUAGES[name].script &&
    (looks.intra.has(d) || !isTablePair(d, y));
  for (const name of targetLanguages)
    for (const [d, y] of looks.pack[name] ?? [])
      if (!sameScript(d, y, name)) {
        const cp = d.codePointAt(0)!;
        if (!t.alphabetOf.has(cp) && SCRIPT_ALPHABET[primaryScript(d)] === undefined)
          packDonors.add(cp);
      }
  const alphabetOf = (cp: number) => t.alphabetOf.get(cp) ?? (packDonors.has(cp) ? DONOR : -1);
  // Unrestricted twins (any alphabet, §4.7 evidence): the table's and the enabled
  // conditional pairs, both ways; pack pairs donor → target.
  const twinsAll = new Map<number, number[][]>();
  // Fold twins (decision 40): per enabled target language, its pack, donor → target.
  const twinsDir = new Map<number, number[][]>();
  const linkTo = (m: Map<number, number[][]>, x: number, y: number) => {
    const a = alphabetOf(y);
    if (a < 0) return;
    let per = m.get(x);
    if (!per) m.set(x, (per = Array.from({ length: N_ALPHA }, () => [])));
    const list = per[a]!;
    if (!list.includes(y)) list.push(y);
  };
  for (const [a, b] of t.pairs) {
    linkTo(twinsAll, a, b);
    linkTo(twinsAll, b, a);
  }
  for (const [a, b] of looks.symmetric) {
    linkTo(twinsAll, a, b);
    linkTo(twinsAll, b, a);
  }
  /** Folds within a script, per alphabet id (decision 40f; Latin: `ı` → `i`, `ſ` → `s`). */
  const intraOf = new Map<number, Map<string, string>>();
  const intraAny = new Set<string>();
  // Pairs given with their case (curated rows, added pairs): the case is the pair's.
  const caseGiven = new Set<string>();
  for (const name of targetLanguages) {
    const L = TARGET_LANGUAGES[name];
    if (!L) throw new Error(`unknown target language ${name}`);
    for (const [d, y] of looks.pack[name] ?? []) {
      // An intra donor (`ı`) folds only within its script; its other pairs stay out.
      if (looks.intra.has(d) && !sameScript(d, y, name)) continue;
      if (sameScript(d, y, name)) {
        const a = SCRIPT_ALPHABET[L.script]!;
        let m = intraOf.get(a);
        if (!m) intraOf.set(a, (m = new Map()));
        if (!m.has(d)) m.set(d, y);
        intraAny.add(d);
        continue;
      }
      if (!isTablePair(d, y) || CURATED_KEYS.has(`${d}>${y}`)) caseGiven.add(`${d}>${y}`);
      linkTo(twinsDir, d.codePointAt(0)!, y.codePointAt(0)!);
      linkTo(twinsAll, d.codePointAt(0)!, y.codePointAt(0)!);
    }
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
  function twinIn(c: string, T: number, wantUpper = isUpperStr(c), restricted = true, lang = -1) {
    const cp = c.codePointAt(0)!;
    const key = cp * 512 + (lang + 1) * 32 + T * 4 + (wantUpper ? 2 : 0) + (restricted ? 1 : 0);
    let r = twinMemo.get(key);
    if (r === undefined)
      twinMemo.set(key, (r = twinInUncached(c, cp, T, wantUpper, restricted, lang)));
    return r;
  }
  function twinInUncached(
    c: string,
    cp: number,
    T: number,
    wantUpper: boolean,
    restricted: boolean,
    lang: number,
  ) {
    const all = (restricted ? twinsDir : twinsAll).get(cp)?.[T];
    if (!all || all.length === 0) return null;
    // One language's letters (never another language's of the same script), else the alphabet's.
    const allowed = lang >= 0 ? LANG_LIST[lang]!.set : targetLetters[T];
    if (restricted && !allowed) return null;
    const up = isUpperStr(c);
    // Decision 37: a donor without letter case folds to the case it looks like.
    const caseless = !up && c.toUpperCase() === c;
    let best: number | null = null;
    let bestScore = 0;
    for (const y of all) {
      const ys = ch(y);
      const yUp = isUpperStr(ys);
      if (!isCore(y, T)) continue;
      if (restricted && !allowed!.has(ys.toLowerCase())) continue;
      if (
        yUp !== up &&
        !caseless &&
        !CROSS_CASE_ALLOWED.has(`${c}>${ys}`) &&
        !caseGiven.has(`${c}>${ys}`)
      )
        continue;
      const score = (yUp !== wantUpper ? 1 << 20 : 0) + t.order.get(y)!;
      if (best === null || score < bestScore) [best, bestScore] = [y, score];
    }
    return best === null ? null : ch(best);
  }

  // A Latin extra letter is a donor only if it has a twin among the Latin
  // target letters and is not a letter of a requested language written in Latin letters (§3.4, 40d).
  const donorExtra = new Set<number>();
  if (inModel(LATIN_EXTRA))
    for (const cp of t.letters[LATIN_EXTRA]!) {
      const c = ch(cp);
      if (!targetLetters[LATIN]?.has(c.toLowerCase()) && twinIn(c, LATIN, isUpperStr(c), true))
        donorExtra.add(cp);
    }

  /** Alphabet id of a base letter for this configuration, or -1 (outside the model). */
  function scriptOf(c: string): number {
    const cp = c.codePointAt(0)!;
    let a = t.alphabetOf.get(cp);
    if (a === undefined && packDonors.has(cp)) a = DONOR;
    if (a === undefined) a = SCRIPT_ALPHABET[primaryScript(c)];
    if (a === undefined) return -1;
    if (a === LATIN_EXTRA && !donorExtra.has(cp)) return inModel(LATIN) ? LATIN : -1;
    // Decision 40f: a curated donor (`ϲ`) of a script no requested language writes is a donor.
    if (a < N_ALPHA && DONOR_CPS.has(cp) && !(targetMask & (1 << a))) return DONOR;
    return inModel(a) ? a : -1;
  }

  // ---- per-code-point facts ------------------------------------------------
  const bmp = new Int32Array(0x10000);
  const astral = new Map<number, number>();
  function compute(cp: number): number {
    const s = ch(cp);
    if (cp === 0x27 || cp === 0x2019) return F_COMPUTED | KIND_OTHER | F_APOSTROPHE;
    const donor = packDonors.has(cp);
    if (!donor && !LETTER_RE.test(s)) {
      // Decision 0a: a digit of another script with no mapping keeps its word from being mapped.
      if (cp > 0x7f && DIGIT_RE.test(s) && primaryScript(s) !== 'Common')
        return F_COMPUTED | KIND_NONE;
      return F_COMPUTED | (MARK_RE.test(s) ? KIND_MARK : KIND_OTHER);
    }
    const base = donor ? s : String.fromCodePoint(s.normalize('NFD').codePointAt(0)!);
    if (!donor && !LETTER_RE.test(base)) return F_COMPUTED | KIND_OTHER;
    const a = scriptOf(base);
    let v = F_COMPUTED | (a < 0 ? KIND_NONE : a);
    const up = isUpperStr(base);
    if (up) v |= F_UPPER;
    if (RULE_LETTERS.has(base)) v |= F_RULE;
    if (I_SHAPED.has(base)) v |= F_I_SHAPED;
    if (intraAny.has(base)) v |= F_INTRA_LATIN;
    if (a >= 0)
      for (let T = 0; T < N_TWIN; T++)
        if (T !== a && inModel(T) && twinIn(base, T, up, true)) v |= 1 << (TWIN_SHIFT + T);
    // A listed precomposed letter (`ё`) is a letter of its own, not its base (per-language rule).
    const low = donor ? s.toLowerCase() : letterKey(s);
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

  /** Folds every letter not native to T into its twin in T (§4.1 step 7); `lang`: that language's letters only. */
  function fold(cl: Clusters, T: number, anomaly: number, lang = -1): string {
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
      else if (intraOf.get(T)?.has(b)) out += intraOf.get(T)!.get(b)! + m;
      else if (scriptOf(b) === T) out += b + m;
      else out += (twinIn(b, T, pos > 0 && lowerWord ? false : isUpperStr(b), true, lang) ?? b) + m;
    }
    return out.normalize('NFC');
  }

  /** The requested languages in request order. */
  const languages = targetLanguages.map((name) => {
    const l = LANG_LIST.find((x) => x.name === name)!;
    return { bit: l.bit, name, alpha: SCRIPT_ALPHABET[l.script]! };
  });
  /** A cluster's letter as the alphabets list it (its case kept): `е` + U+0308 is `ё`. */
  const caseKey = (b: string, m: string) => {
    const k = m ? letterKey(b + m) : letterKey(b);
    return isUpperStr(b) ? k.toUpperCase() : k;
  };
  /** The word's letters as the alphabets list them (see {@link letterKey}), case kept. */
  const keysOf = (cl: Clusters) => cl.letters.map((i) => caseKey(cl.base[i]!, cl.marks[i]!));
  /** `letters` (lowercase letter keys) are all letters of language `bit`. */
  const holdsAll = (bit: number, letters: readonly string[]) => {
    const set = LANG_LIST[bit]!.set;
    return letters.every((c) => set.has(c));
  };
  function lettersOf(word: string): string[] {
    const cl = clusters(word);
    return keysOf(cl)
      .map((c) => c.toLowerCase())
      .filter((c, k) => LETTER_RE.test(cl.base[cl.letters[k]!]!));
  }
  function langsOf(word: string, all = false): number {
    const letters = lettersOf(word);
    if (!letters.length) return 0;
    let m = 0;
    for (const l of all ? LANG_LIST : languages) if (holdsAll(l.bit, letters)) m |= 1 << l.bit;
    return m;
  }

  const requestedBits = languages.reduce((m, l) => m | (1 << l.bit), 0);
  /**
   * Decision 41b: the unrequested languages (bits) a word of no requested language is written
   * in, each holding all its letters; 0 when a letter is a requested language's.
   */
  function foreignLangsOf(word: string): number {
    const letters = lettersOf(word);
    if (!letters.length) return 0;
    for (const l of languages) if (letters.some((c) => LANG_LIST[l.bit]!.set.has(c))) return 0;
    return langsOf(word, true) & ~requestedBits;
  }

  /** §4.4 + §4.7: does a single-script word fit some language of S? */
  function languageViolation(
    bases: readonly string[],
    S: number,
    elided = false,
    only: readonly string[] | null = null,
  ): Evidence | null {
    if (S !== LATIN && S !== CYRILLIC && S !== GREEK) return null;
    const script = CONFUSION_ALPHABETS[S] as LanguageScript;
    // Decision 40d: the requested languages of the script only.
    const req = targetNames[S];
    const langs = LANG_LIST.filter(
      (l) => l.script === script && req?.includes(l.name) && (!only || only.includes(l.name)),
    );
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
        if (T !== S && inModel(T) && twinIn(c, T, isUpperStr(c), true)) return true;
      return false;
    });
    return look.length ? { kind: 'foreign', letters: look.join('') } : null;
  }

  // Decision 40d: language rules of requested languages only (the Caucasian palochka digraph).
  const palochkaLang = targetLanguages.some((n) => TARGET_LANGUAGES[n].letters.includes('ӏ'));
  /**
   * §3.3, 40f: a fold within a script applies only if the word folded with one requested
   * language's letters is all that language's letters (per-language rule). Latin counts
   * accents too (ışık → işik keeps ş: no fold); other scripts their NFD base letters (λόγοϲ).
   * Returns the language bit, -1 for none.
   */
  function fitsLanguage(cl: Clusters, S: number, anomaly: number): number {
    for (const l of languages) {
      if (l.alpha !== S) continue;
      const folded = fold(cl, S, anomaly, l.bit);
      const set = LANG_LIST[l.bit]!.set;
      if (S === LATIN) {
        const cs = [...folded.toLowerCase()];
        if (cs.some((c) => MARK_RE.test(c))) continue;
        if (cs.filter((c) => LETTER_RE.test(c)).every((c) => set.has(c))) return l.bit;
        continue;
      }
      const fc = clusters(folded);
      const letters = keysOf(fc)
        .map((c) => c.toLowerCase())
        .filter((c, k) => LETTER_RE.test(fc.base[fc.letters[k]!]!));
      if (letters.every((c) => set.has(c))) return l.bit;
    }
    return -1;
  }

  /** §4.6: an I-shaped last letter after lowercase letters (≥ 4 letters); -1 if none. */
  function caseAnomaly(cl: Clusters): number {
    // Decision 42: a positional check applies per dash-separated part (`type-I` keeps its `I`).
    let from = 0;
    for (let i = 0; i < cl.base.length; i++) {
      const b = cl.base[i]!;
      if (b !== '-' && b !== '\u2010' && b !== '\u2011') continue;
      const part = cl.letters.filter((k) => k >= from && k < i);
      const r = partAnomaly(cl, part);
      if (r >= 0) return r;
      from = i + 1;
    }
    return partAnomaly(cl, from ? cl.letters.filter((k) => k >= from) : cl.letters);
  }

  function partAnomaly(cl: Clusters, L: readonly number[]): number {
    if (L.length < 4) return -1;
    const last = cl.base[L[L.length - 1]!]!;
    if (!I_SHAPED.has(last)) return -1;
    for (let k = 1; k < L.length - 1; k++) if (isUpperStr(cl.base[L[k]!]!)) return -1;
    const prev = cl.base[L[L.length - 2]!]!.toLowerCase();
    if (palochkaLang && PALOCHKA.has(last) && PALOCHKA_AFTER.has(prev)) return -1; // Caucasian digraph
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
    const rejected: Partial<Record<TargetLanguage, string>> = {};
    const valid: number[] = [];
    for (let T = 0; T < N_ALPHA; T++) {
      if (!inModel(T) || blockers[T] !== '') continue;
      if (whole && scripts.has(T)) {
        valid.push(T);
        continue;
      }
      if (!targetNames[T]) continue;
      const folded = clusters(fold(cl, T, anomaly));
      const v = languageViolation(keysOf(folded), T, false, targetNames[T]!);
      if (!v) {
        valid.push(T);
        continue;
      }
      // No requested language of T takes the fold: each one's own reason (letters or rule).
      for (const n of targetNames[T]!) {
        const w = languageViolation(keysOf(folded), T, false, [n]) ?? v;
        rejected[n as TargetLanguage] = w.kind === 'orthography' ? w.rule : w.letters;
      }
    }
    // Per-language rule: which requested languages can take the word, each with its own letters.
    const keys = keysOf(cl);
    const lowBases = keys.map((c) => c.toLowerCase());
    const nativeLang: number[] = [];
    let ownLangs = 0;
    for (const l of LANG_LIST) {
      const set = l.set;
      nativeLang[l.bit] = lowBases.filter((c) => set.has([...c][0]!)).length;
    }
    const validLangs: number[] = [];
    for (const l of languages) {
      const own =
        bases.length > 0 &&
        holdsAll(
          l.bit,
          lowBases.map((c) => [...c][0]!),
        );
      if (own) ownLangs |= 1 << l.bit;
      if (!inModel(l.alpha) || blockers[l.alpha] !== '') continue;
      if (whole && scripts.has(l.alpha)) {
        if (own) validLangs.push(l.bit);
        continue;
      }
      const folded = clusters(fold(cl, l.alpha, anomaly, l.bit));
      const v = languageViolation(keysOf(folded), l.alpha, false, [l.name]);
      if (!v) validLangs.push(l.bit);
    }
    let evidence: Evidence | null = null;
    if (bases.length && whole) {
      const S = letterScripts[0]!;
      // Twin evidence reads base letters (its look-alike test is per base: `її` under English and
      // Russian is evidence, `её` under English and Ukrainian is not); membership is exact above.
      const lang = languageViolation(bases, S, /['’]$/.test(seg));
      const own = intraOf.get(S);
      let intra = own ? bases.filter((c) => own.has(c)) : [];
      if (intra.length && fitsLanguage(cl, S, -1) < 0) intra = [];
      if (anomaly >= 0) evidence = { kind: 'case', letters: cl.base[anomaly]! };
      else if (S === LATIN_EXTRA) evidence = { kind: 'donor', letters: '' };
      else if (intra.length) evidence = { kind: 'conditional', letters: intra.join('') };
      // Decision 40e: language rules only narrow targets; a broken rule is no evidence.
      else if (lang && lang.kind !== 'orthography') evidence = lang;
    }
    const r: Inspection = {
      cl,
      scripts,
      native,
      blockers,
      valid,
      validLangs,
      nativeLang,
      ownLangs,
      rejected,
      evidence,
      anomaly,
    };
    if (inspectCache.size >= 20000) inspectCache.clear();
    inspectCache.set(seg, r);
    return r;
  }

  const alphabets = CONFUSION_ALPHABETS.filter((_, a) => inModel(a));
  return {
    key: `${targetLanguages.join(',')}|${donors.join(',')}|${looks.key}`,
    targetLanguages,
    donorAlphabets: donors,
    alphabets,
    targetMask,
    langMask: LANG_LIST.filter((l) => targetLanguages.includes(l.name)).reduce(
      (m, l) => m | (1 << l.bit),
      0,
    ),
    info,
    bmpInfo: bmp,
    twinIn: (c, T, wantUpper, restricted) =>
      twinIn(c, CONFUSION_ALPHABETS.indexOf(T), wantUpper ?? isUpperStr(c), restricted ?? true),
    inspect,
    fold,
    languages,
    foldLang: (cl, lang, anomaly) =>
      fold(cl, languages.find((l) => l.bit === lang)!.alpha, anomaly, lang),
    langsOf,
    foreignLangsOf,
    fitsLanguage,
    twinInLang: (c, lang) =>
      twinIn(c, languages.find((l) => l.bit === lang)!.alpha, isUpperStr(c), true, lang),
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

// ---------------------------------------------------------------------------
// Look-alike packs (decisions 40–40c).

/** A look-alike pair, one direction: the donor and the target letter a reader takes it for. */
export type LookalikePair = readonly [donor: string, target: string];
/** Pairs per target language (decision 40: a pack holds conversions into its target only). */
export type LookalikePack = Partial<Record<TargetLanguage, readonly LookalikePair[]>>;

/** Ids of the additional packs (decision 40a). */
export type AdditionalPackId = ConditionalTwinId | 'optional';

/**
 * How the packs are put together (decision 40a): the default pack of every
 * target, the additional packs named, then pairs added and removed — any
 * pair, either direction.
 */
export interface LookalikeConfig {
  /** Additional packs on top of the defaults. Default {@link DEFAULT_ADDITIONAL_PACKS}. */
  additional?: readonly AdditionalPackId[];
  /** Pairs added, per target language. */
  add?: LookalikePack;
  /** Pairs removed, per target language. */
  remove?: LookalikePack;
}

/** Packs built by {@link buildLookalikes}: a value to pass to `analyze` (decision 40c). */
export interface Lookalikes {
  readonly key: string;
  /** The pairs per target language. */
  readonly pack: Readonly<Partial<Record<TargetLanguage, readonly LookalikePair[]>>>;
  /** Donors read as another Latin letter by the target languages written in Latin letters (`ı` → `i`): the model's intra-Latin folds. */
  readonly intra: ReadonlySet<string>;
  /** Conditional pairs enabled (both ways), for the unrestricted twin relation (§4.7). */
  readonly symmetric: readonly (readonly [number, number])[];
}

/** Additional packs on by default: today's conditional defaults, the x-likes. */
export const DEFAULT_ADDITIONAL_PACKS: readonly AdditionalPackId[] =
  DEFAULT_CONDITIONAL_TWIN_IDS.filter((id) => id !== 'ı~i') as AdditionalPackId[];

/** `ı` → `i`: in the default English pack, not a conditional twin. */
const DEFAULT_INTRA: readonly LookalikePair[] = [['ı', 'i']];

/** Target languages holding a letter (lowercase), for packs derived from the twin table. */
function languagesOf(y: string): TargetLanguage[] {
  const low = y.toLowerCase();
  const script = primaryScript(y);
  return (Object.keys(TARGET_LANGUAGES) as TargetLanguage[]).filter(
    (n) => TARGET_LANGUAGES[n].script === script && TARGET_LANGUAGES[n].letters.includes(low),
  );
}

function addTo(
  out: Partial<Record<TargetLanguage, LookalikePair[]>>,
  L: TargetLanguage,
  p: LookalikePair,
) {
  const list = (out[L] ??= []);
  if (!list.some(([d, y]) => d === p[0] && y === p[1])) list.push(p);
}

let defaults: Record<TargetLanguage, LookalikePair[]> | null = null;
/**
 * The default pack of every target language: the twin table's pairs into its
 * letters (each twin pair gives both directions), `ı` → `i` for the Latin
 * targets, and the curated default donor rows (donor-rows.ts).
 */
export function defaultPacks(): Readonly<Record<TargetLanguage, readonly LookalikePair[]>> {
  if (defaults) return defaults;
  const t = loadTable();
  const out: Partial<Record<TargetLanguage, LookalikePair[]>> = {};
  for (const [a, b] of t.pairs)
    for (const [x, y] of [
      [a, b],
      [b, a],
    ] as const)
      for (const L of languagesOf(ch(y))) addTo(out, L, [ch(x), ch(y)]);
  for (const L of Object.keys(TARGET_LANGUAGES) as TargetLanguage[])
    if (TARGET_LANGUAGES[L].script === 'Latin') for (const p of DEFAULT_INTRA) addTo(out, L, p);
  for (const [cp, y, L, pack] of DONOR_ROWS)
    if (pack === 'default') addTo(out, L as TargetLanguage, [ch(cp), y]);
  // Decision 40f: a table pair a curated row replaces (`ſ` reads `s`, not `f`).
  for (const [d, y, L] of REPLACED_TABLE_PAIRS)
    out[L as TargetLanguage] = (out[L as TargetLanguage] ?? []).filter(
      ([a, b]) => !(a === d && b === y),
    );
  for (const L of Object.keys(TARGET_LANGUAGES) as TargetLanguage[]) out[L] ??= [];
  return (defaults = out as Record<TargetLanguage, LookalikePair[]>);
}

/** An additional pack's pairs per target language, and its symmetric twin pairs. */
function additionalPack(id: AdditionalPackId): {
  pack: Partial<Record<TargetLanguage, LookalikePair[]>>;
  intra: Set<string>;
  symmetric: [number, number][];
} {
  const pack: Partial<Record<TargetLanguage, LookalikePair[]>> = {};
  const intra = new Set<string>();
  if (id === 'optional') {
    for (const [cp, y, L, p] of DONOR_ROWS)
      if (p === 'optional') addTo(pack, L as TargetLanguage, [ch(cp), y]);
    return { pack, intra, symmetric: [] };
  }
  const d = CONDITIONAL_TWIN_DATA[id];
  if (!d) throw new Error(`unknown look-alike pack ${id}`);
  for (const [a, b] of d.pairs)
    for (const [x, y] of [
      [a, b],
      [b, a],
    ] as const)
      for (const L of languagesOf(ch(y))) addTo(pack, L, [ch(x), ch(y)]);
  for (const [a, b] of d.intraLatin) {
    intra.add(ch(a));
    for (const L of Object.keys(TARGET_LANGUAGES) as TargetLanguage[])
      if (TARGET_LANGUAGES[L].script === 'Latin') addTo(pack, L, [ch(a), ch(b)]);
  }
  return { pack, intra, symmetric: d.pairs };
}

const builtPacks = new Map<string, Lookalikes>();

/**
 * Builds the look-alike packs for a configuration (decisions 40a, 40c), once:
 * the caller builds a custom configuration before processing and passes it as
 * `lookalikes`; the default is {@link defaultLookalikes}. An unknown additional
 * pack or target language throws a plain `Error` (`unknown look-alike pack …`,
 * `unknown target language …`).
 */
export function buildLookalikes(config: LookalikeConfig = {}): Lookalikes {
  const additional = [...new Set(config.additional ?? DEFAULT_ADDITIONAL_PACKS)].sort();
  const norm = (p: LookalikePack | undefined) =>
    p
      ? (Object.keys(p) as TargetLanguage[])
          .sort()
          .map((L) => `${L}:${[...p[L]!].map(([d, y]) => d + y).join(',')}`)
          .join(';')
      : '';
  const key = `${additional.join(',')}|+${norm(config.add)}|-${norm(config.remove)}`;
  const hit = builtPacks.get(key);
  if (hit) return hit;
  for (const L of [...Object.keys(config.add ?? {}), ...Object.keys(config.remove ?? {})])
    if (!(L in TARGET_LANGUAGES)) throw new Error(`unknown target language ${L}`);
  const pack: Partial<Record<TargetLanguage, LookalikePair[]>> = {};
  for (const [L, list] of Object.entries(defaultPacks()) as [TargetLanguage, LookalikePair[]][])
    for (const p of list) addTo(pack, L, p);
  const intra = new Set<string>(DEFAULT_INTRA.map(([d]) => d));
  const symmetric: [number, number][] = [];
  for (const id of additional) {
    const a = additionalPack(id);
    for (const [L, list] of Object.entries(a.pack) as [TargetLanguage, LookalikePair[]][])
      for (const p of list) addTo(pack, L, p);
    for (const d of a.intra) intra.add(d);
    symmetric.push(...a.symmetric);
  }
  for (const [L, list] of Object.entries(config.add ?? {}) as [TargetLanguage, LookalikePair[]][])
    for (const [d, y] of list) {
      addTo(pack, L, [d, y]);
      // A pair between two Latin letters outside the table is an intra-Latin fold.
      if (primaryScript(d) === 'Latin' && primaryScript(y) === 'Latin' && !isTablePair(d, y))
        intra.add(d);
    }
  for (const [L, list] of Object.entries(config.remove ?? {}) as [
    TargetLanguage,
    LookalikePair[],
  ][])
    pack[L] = (pack[L] ?? []).filter(([d, y]) => !list.some(([rd, ry]) => rd === d && ry === y));
  // Decision 40f, the loop guard: a pack never maps a letter of its own language as a donor.
  for (const L of Object.keys(pack) as TargetLanguage[]) {
    const letters = TARGET_LANGUAGES[L].letters;
    pack[L] = pack[L]!.filter(([d]) => !letters.includes(d.toLowerCase()));
  }
  const built: Lookalikes = Object.freeze({ key, pack, intra, symmetric });
  builtPacks.set(key, built);
  return built;
}

/** The curated rows as `donor>target`: their case is the judged one (decision 37). */
const DONOR_CPS = new Set(DONOR_ROWS.map(([cp]) => cp));
const CURATED_KEYS = new Set(DONOR_ROWS.map(([cp, y]) => `${String.fromCodePoint(cp)}>${y}`));

let tablePairs: Set<string> | null = null;
function isTablePair(d: string, y: string): boolean {
  tablePairs ??= new Set(loadTable().pairs.flatMap(([a, b]) => [`${a}.${b}`, `${b}.${a}`]));
  return tablePairs.has(`${d.codePointAt(0)}.${y.codePointAt(0)}`);
}

/** The ready-made default packs (decision 40c). */
export function defaultLookalikes(): Lookalikes {
  return buildLookalikes();
}
