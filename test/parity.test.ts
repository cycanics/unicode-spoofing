/**
 * Comparison with the upstream reference build (test/fixtures/reference/main.mjs,
 * commit d26b10b, vendored by scripts/build-reference.mjs) on the corpus, seeded
 * random strings and the ~1 MB realistic text.
 *
 * - The default path (`analyze` with no option: lenient rules, Latin fold): equal
 *   to the upstream reference build, field for field, words over 250 code points
 *   included (decision 19's cap applies under the opt-in options only).
 * - The opt-in options run with their defaults. An input whose result differs
 *   from the upstream reference build must differ because of a decision:
 *   - decisions 11, 27, 28a (seam rule, possible ligature break, zero-width
 *     run threshold 2) are rule settings, so each one's effect is checked by
 *     setting it to the upstream reference build's value;
 *   - the others are not settings: an input that differs with those three set
 *     to the reference values must carry the trigger of a decision that
 *     explains the change in its direction. A word the upstream reference
 *     build flags and the library does not flag needs a decision that removes
 *     that flag, on that word (`REMOVES`: a no-spoof neutral, a letter outside
 *     the model, a 36a category the library gives the word, …); any other
 *     difference needs a decision trigger in the input (`TRIGGERS`).
 *   Nothing is counted or pinned: the check is per input.
 *
 * The upstream reference build's extra result fields (`edits`, `findings`,
 * `payloads`, `content`, `hidden`) are not compared: the library has none
 * (decisions 10, 17); its report calls carry what they hold. The random
 * alphabet leaves out U+009B and U+E0151, which the two read differently
 * (finding-callback.test.ts, "where the upstream reference build differs").
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  analyze,
  cleanHidden,
  primaryScript,
  STRICT_HIDDEN_RULES,
  type AnalyzeOptions,
  type HiddenCharRules,
} from '../src';
// @ts-expect-error -- a vendored ESM bundle without types
import * as ref from './fixtures/reference/main.mjs';
import { mainOptions } from './helpers/main-options';
import { DONOR_MIX, LONG, MARK_HEAVY, randomStrings } from './helpers/random';
import { neutralInfo } from '../src/neutral';
import { DIGIT_LOOKALIKES, DONOR_ROWS } from '../src/data/donor-rows';
import { twinsOf } from '../src/confusion';
import { DEFAULT_TARGET_LANGUAGES, TARGET_LANGUAGES } from '../src/languages';
import { mojibakeHits } from '../src/mojibake';
import { HIGHLY_RESTRICTIVE, isSpaceless } from '../src/scriptinfo';

type MainWord = { word: string; index: number; signals: string[]; resolution?: { class: string } };
type MainAnalysis = {
  counts: Record<string, number>;
  hidden?: unknown;
  normalized: string;
  words: MainWord[];
};
const vendored = ref as {
  cleanHidden: (t: string, r?: object) => { cleaned: string };
  analyze: (t: string, o?: object) => MainAnalysis;
};
const reference = {
  cleanHidden: vendored.cleanHidden,
  analyze: (t: string, o?: object) => vendored.analyze(t, mainOptions(o)),
};

const corpus = (
  JSON.parse(readFileSync(join(__dirname, 'fixtures', 'cases.json'), 'utf8')) as { input: string }[]
).map((c) => c.input);
const random = randomStrings(3000);
const marks = randomStrings(800, MARK_HEAVY, 11);
const inputs = [...corpus, ...random, ...marks, ...LONG, ...DONOR_MIX];

/** The upstream reference build's result without its `hidden` and `counts.hiddenWords` fields. */
const upstreamFields = (r: MainAnalysis) => {
  const { hidden, counts, ...rest } = r;
  void hidden;
  const { hiddenWords, ...c } = counts;
  void hiddenWords;
  return { ...rest, counts: c };
};
const same = (a: unknown, b: unknown) => isDeepStrictEqual(a, b);

/** Decisions 11, 27, 28a, each as the rule setting of the upstream reference build. */
const BACK = {
  d11: { seamSpaces: false },
  d27: { possibleLigatureBreak: 'remove-counted' },
  d28a: { zeroWidthRunThreshold: 4 },
} as const;
const MAIN = { ...BACK.d11, ...BACK.d27, ...BACK.d28a };
type Back = keyof typeof BACK;

const isZW = (c: number) =>
  c === 0x200b || c === 0x200c || c === 0x200d || c === 0x2060 || c === 0xfeff;
/** What each of these decisions may take out of the text. */
const DROPS: Record<Back, (c: number) => boolean> = {
  d11: (c) => c === 0x20,
  d27: () => false,
  d28a: isZW,
};
/** `ours` is `other` with some characters `may` allows taken out. */
function onlyDropped(ours: string, other: string, may: (c: number) => boolean): boolean {
  let i = 0;
  for (let k = 0; k < other.length; k++) {
    if (ours.charCodeAt(i) === other.charCodeAt(k)) i++;
    else if (!may(other.charCodeAt(k))) return false;
  }
  return i === ours.length;
}
const anyDrop = (c: number) => c === 0x20 || isZW(c);

// Triggers of the decisions that are not rule settings.
const MODEL_SCRIPTS = new Set(['Latin', 'Cyrillic', 'Greek', 'Armenian', 'Cherokee', 'Coptic']);
const LETTER = /\p{L}/u;
const isNeutral = (ch: string) => {
  const nf = ch.normalize('NFKC');
  return nf !== ch && /[A-Za-z]/.test(nf);
};
const PACK_DONORS = new Set([
  'ı',
  ...DONOR_ROWS.map(([cp]) => String.fromCodePoint(cp)),
  ...DIGIT_LOOKALIKES.map(([cp]) => String.fromCodePoint(cp)),
]);
/**
 * What phase 1 removes with nothing and the upstream reference build's tokenizer splits at ({@link TRIGGERS}.d14removed):
 * an escape sequence (CSI, OSC, DCS/SOS/PM/APC, two-byte, C1 CSI), a control (NEL too), U+FFFE/U+FFFF, a tag.
 */
const REMOVED_SPLIT =
  // eslint-disable-next-line no-control-regex -- control characters are the point
  /\x1b(?:\[[0-?]*[ -/]*[@-~]?|\][^\x07\x1b]*(?:\x07|\x1b\\)?|[PX^_][^\x1b]*(?:\x1b\\)?|[ -/]*[0-~]?)|\x9b[0-?]*[ -/]*[@-~]?|[\0-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f\x7f-\x9a\x9c-\x9f\ufffe\uffff\u{e0000}-\u{e007f}]/u
    .source;
/** Hidden characters and marks around it, which the upstream reference build also reads inside a word. */
const INSIDE = String.raw`(?![\u{e0000}-\u{e007f}])[\p{Default_Ignorable_Code_Point}\p{M}]`;
/** A word character, a dash or `_` (the `×` rule's edges). */
const EDGE = String.raw`[\p{L}\p{M}\p{N}\-\u2010\u2011_]`;
/** A run of both between two of them, taken whole (a lookahead and its backreference). */
const RUN_RE = new RegExp(`${EDGE}(?=((?:${INSIDE}|${REMOVED_SPLIT})+))\\1(?=${EDGE})`, 'gu');
const SPLIT_RE = new RegExp(REMOVED_SPLIT, 'u');
const BIDI_MARK_RE = /[\u200e\u200f\u061c\u2066-\u2069]/u;
const RTL_LETTER_RE =
  /(?!\u061c)[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Adlam}\p{Script=Samaritan}\p{Script=Mandaic}]/u;
/** The input without its bidi marks (decision 42g's difference taken out). */
const withoutBidiMarks = (s: string) => s.replace(new RegExp(BIDI_MARK_RE.source, 'gu'), '');
type Words = {
  words: readonly {
    word: string;
    index: number;
    signals: readonly string[];
    normalized?: string;
  }[];
};
/** The words of `a` and `b` that are not in both (by position, word, signals and output). */
const wordsApart = (a: Words, b: Words) => {
  const key = (w: Words['words'][number]) =>
    `${w.index}:${w.word}:${w.signals.join()}:${w.normalized ?? ''}`;
  const ka = new Set(a.words.map(key));
  const kb = new Set(b.words.map(key));
  return [...a.words.filter((w) => !kb.has(key(w))), ...b.words.filter((w) => !ka.has(key(w)))];
};
/**
 * Decision 42g on the default path: the two results differ only in bidi marks — the outputs
 * read the same without them, the words that differ each hold one, the other fields agree.
 */
type Result = { normalized: string; words: Words['words']; counts: object };
const onlyBidiMarksApart = (a: Result, b: Result) => {
  const apart = wordsApart(a, b);
  // The fields a bidi mark's finding changes: spoofed, signals, changed, words affected.
  const rest = (r: Result) => {
    const { wordsAffected, ...c } = r.counts as Record<string, number>;
    void wordsAffected;
    return c;
  };
  return (
    apart.length > 0 &&
    apart.every((w) => BIDI_MARK_RE.test(w.word)) &&
    withoutBidiMarks(a.normalized) === withoutBidiMarks(b.normalized) &&
    isDeepStrictEqual(rest(a), rest(b))
  );
};
const TRIGGERS = {
  /** Decision 19: a word over 250 code points (the cap applies under the opt-in options). */
  d19: (s: string) =>
    (s.match(/[\p{L}\p{M}\p{N}\p{Cf}'’]+/gu) ?? []).some((w) => [...w].length > 250),
  /** Decision 28b: a stack of three or more marks. */
  d28b: (s: string) => /\p{M}{3,}/u.test(s.replace(/[\p{Cf}\p{Cc}]/gu, '')),
  /**
   * Decisions 30–33, 30a–30i, 32, 37, 38: a character of the neutral dictionary
   * (styled, compatibility, math, Roman numeral, look-alike of a real script,
   * unit symbol, brand mark).
   */
  d30: (s: string) => [...s].some((ch) => neutralInfo(ch.codePointAt(0)!) !== null),
  /**
   * Decisions 6, 7a, 7b: strict runs the escape-sequence parser by default; it
   * removes every sequence (invalid ones too) and an SGR sequence silently,
   * where the upstream reference build lists each ESC (or `ESC [ … final`) as `illegal`.
   */
  // eslint-disable-next-line no-control-regex -- ESC is what it matches
  d7a: (s: string) => /[\x1b\x9b]/.test(s),
  /**
   * Decisions 34–36, 0a: a letter of a script outside the model, or a digit of
   * another script (bound to its script, it keeps its word from being mapped).
   */
  d34: (s: string) =>
    [...s].some((ch) => {
      if (/\p{Nd}/u.test(ch)) return ch > '9' && primaryScript(ch) !== 'Common';
      if (!LETTER.test(ch) || isNeutral(ch)) return false;
      const sc = primaryScript(ch);
      return !MODEL_SCRIPTS.has(sc) && sc !== 'Common' && sc !== 'Inherited';
    }),
  /**
   * Decisions 22, 24, 41b: one context window (±majorityWindow, within the
   * paragraph) for every window metric, and one definition of the nearest
   * words: an input with a word the upstream reference build's resolver judges by its context.
   */
  d22: (s: string) =>
    reference.analyze(s, { confusionModel: 'language' }).words.some((w) => 'resolution' in w),
  /**
   * Decision 36a: a mixed-script word is reported as `mixed_spoof`,
   * `mixed_legitimate` or `mixed_non_legitimate` in place of `mixed_script`:
   * an input with a mixed-script word the upstream reference build flags under the language model.
   */
  d36a: (s: string) =>
    reference
      .analyze(s, { confusionModel: 'language' })
      .words.some((w) => w.signals.includes('mixed_script')),
  /** Decisions 40, 41: a donor the default packs add to the twin table (curated rows, `ı` → `i`), a digit look-alike. */
  d40: (s: string) => [...s].some((ch) => PACK_DONORS.has(ch)),
  /**
   * Decisions 42, 42b: words joined by an inner dash are one visibility token whose context
   * comes from outside it; the ladder has no hyphen step.
   */
  d42dash: (s: string) => /\p{L}[-\u2010\u2011]\p{L}/u.test(s),
  /** Decision 41o: an HTML character reference (any form, `;` or not) is read as its character. */
  d41oref: (s: string) => /&(?:[A-Za-z]|#[0-9]|#[xX][0-9A-Fa-f])/.test(s),
  /** Decision 36e: a letter between two digit-like characters may be written `×`. */
  d36x: (s: string) => /[\p{Nd}\p{No}][\p{L}\p{So}][\p{Nd}\p{No}]/u.test(s),
  /**
   * Decision 14 (language model): the word phase reads phase 1's output, so a run of what phase 1
   * removes with nothing (a control, an escape sequence, U+FFFE/U+FFFF) between two word
   * characters (letters, marks, digits) or beside a dash or `_` joins its neighbours (the
   * upstream reference build's tokenizer splits there).
   */
  d14removed: (s: string) => [...s.matchAll(RUN_RE)].some((m) => SPLIT_RE.test(m[1]!)),
  /** Decision 42d (language model): VT and FF are written as a line feed, not removed. */
  d42d: (s: string) => /[\v\f]/.test(s),
  /**
   * Decision 42g: "in right-to-left text" is per bidi paragraph, on every path (the default
   * path too): a bidi mark in an input that holds a right-to-left letter.
   */
  d42g: (s: string) => BIDI_MARK_RE.test(s) && RTL_LETTER_RE.test(s),
  /** Decision 40f: the long s and the lunate sigma are ordinary donors (`ſ` reads `s`). */
  d40f: (s: string) => /[ſϲϹ]/u.test(s),
  /** Decision 40d: a letter only an unrequested supported language has. */
  d40d: (s: string) => unrequestedLetter(s),
};
type Trigger = keyof typeof TRIGGERS;

/** Letters of a supported language no default target language of the same script has (decision 40d). */
const UNREQUESTED = new Set<string>(
  Object.values(TARGET_LANGUAGES).flatMap(({ script, letters }) =>
    [...letters].filter(
      (c) =>
        !DEFAULT_TARGET_LANGUAGES.some(
          (n) => TARGET_LANGUAGES[n].script === script && TARGET_LANGUAGES[n].letters.includes(c),
        ),
    ),
  ),
);
// `ı` is 41g's (a Turkish keep), never 40d's.
UNREQUESTED.delete('ı');
/** Decision 40d: a letter only an unrequested supported language has (`ѕ`, `þ`, `ҳ`, `ӏ`): not legitimate. */
function unrequestedLetter(s: string): boolean {
  return [...s].some((ch) => UNREQUESTED.has(ch.normalize('NFD')[0]!.toLowerCase()));
}

/** The upstream reference build's spoofing signals, and the library's (decision 36a adds `mixed_spoof`). */
const MAIN_SPOOF = new Set(['mixed_script', 'confusable_word', 'invisible', 'zalgo', 'illegal']);
const OUR_SPOOF = new Set([...MAIN_SPOOF, 'mixed_spoof']);
type AnyWord = { word: string; index: number; signals: readonly string[] };
const overlaps = (a: AnyWord, b: AnyWord) =>
  a.index < b.index + b.word.length && b.index < a.index + a.word.length;
/** Neutral categories whose conversion (or keeping) is no spoof (decision 30b). */
const NO_SPOOF_NEUTRAL = new Set([
  'visibleStyle',
  'sameReading',
  'separator',
  'tailMark',
  'unit',
  'wordSign',
  'japaneseSquare',
  'unitPrefix',
  'longS',
]);
const inModel = (ch: string) => PACK_DONORS.has(ch) || Object.keys(twinsOf(ch)).length > 0;
/**
 * Decisions that take a flag the upstream reference build raises off a word, each read on
 * that word (`w`, the reference's), the input `s` and the library's findings `ours`.
 */
let hitsOf: { s: string; hits: { s: number; e: number }[] } | null = null;
const mojibakeIn = (s: string) => {
  if (hitsOf?.s !== s) hitsOf = { s, hits: mojibakeHits(s) };
  return hitsOf.hits;
};
const REMOVES: Record<
  string,
  (w: MainWord, s: string, ours: readonly AnyWord[], near: string) => boolean
> = {
  /** 42g: a bidi mark judged by its paragraph's right-to-left letters, not the whole text's. */
  d42g: (w, s) => BIDI_MARK_RE.test(w.word) && TRIGGERS.d42g(s),
  /** 6, 7a, 7b: an escape sequence the parser removes whole, which the detectors then read past (a bidi span runs on over it). */
  d7a: (_w, _s, _o, near) => TRIGGERS.d7a(near),
  d19: (w) => TRIGGERS.d19(w.word),
  d28b: (w) => TRIGGERS.d28b(w.word),
  /** 30b: a neutral character whose conversion is no spoof, or that stays (tail mark, unit). */
  d30: (w) =>
    [...w.word].some((ch) => NO_SPOOF_NEUTRAL.has(neutralInfo(ch.codePointAt(0)!)?.category ?? '')),
  /** 34–36, 0a, 41i: a letter (or digit) outside the model, never folded and keeping its word's donors. */
  d34: (w) =>
    [...w.word].some((ch) => {
      if (/\p{Nd}/u.test(ch)) return ch > '9' && primaryScript(ch) !== 'Common' && !inModel(ch);
      if (!LETTER.test(ch) || isNeutral(ch) || inModel(ch)) return false;
      const sc = primaryScript(ch);
      return !MODEL_SCRIPTS.has(sc) && sc !== 'Common' && sc !== 'Inherited';
    }),
  /** 30b.8: Greek `μ` directly before a unit of the unit list is a unit prefix, kept (`μs`). */
  d30b8: (w) =>
    /^[0-9]*\u03bc(?:m|s|g|l|A|V|W|F|H|K|J|N|Pa|Hz|mol|M|Sv|Gy|cd|lm|lx|Wb|T|C|bar|in|S|Bq|eV|rad|sr|Ci|Torr|atm|cal|Da|kat|b|ohm)[0-9²³¹⁰⁴-⁻]*$/u.test(
      w.word,
    ),
  /** 36a: the library reports the word as legitimate or non-legitimate mixed, not a spoof. */
  /**
   * 34–36, 36a: the upstream reference build's `mixed_script` on a word whose scripts may share it (one written with
   * spaces among scripts written without, or a UTS #39 Highly Restrictive set), read on the word
   * itself, not on the library's category (review 13).
   */
  d36a: (w) => {
    if (!w.signals.includes('mixed_script')) return false;
    const sc = [
      ...new Set(
        [...w.word]
          .filter((c) => LETTER.test(c))
          .map((c) => primaryScript(c) as string)
          .filter((x) => x !== 'Common' && x !== 'Inherited'),
      ),
    ];
    if (sc.length < 2) return false;
    if (sc.filter((x) => !isSpaceless(x)).length <= 1) return true;
    return HIGHLY_RESTRICTIVE.some((h) => sc.every((x) => h.has(x)));
  },
  /**
   * 36c: the upstream reference build's `mixed_script` on a word of two scripts or more, one a
   * target's, that the library leaves as written
   * (no chunk converts into the word's language): reported, not a spoof.
   */
  d36c: (w, _s, ours) => {
    if (!w.signals.includes('mixed_script')) return false;
    const sc = new Set(
      [...w.word].filter((c) => LETTER.test(c)).map((c) => primaryScript(c) as string),
    );
    sc.delete('Common');
    sc.delete('Inherited');
    const target = ['Latin', 'Cyrillic', 'Greek'].some((x) => sc.has(x));
    return (
      sc.size >= 2 &&
      target &&
      ours.some((o) => overlaps(o, w) && (o as { normalized?: string }).normalized === o.word)
    );
  },
  /** 22, 24, 41b, 41e, 41o: a whole-script word the upstream reference build folds is decided by its context. */
  d22: (w) => w.resolution?.class === 'confusable' || w.signals.includes('confusable_word'),
  /** 41b, 41d: a donor among letters (or digits) of its own script stays. */
  d41b: (w, _s, _o, near) =>
    [...w.word].some((ch) => {
      if (!PACK_DONORS.has(ch)) return false;
      const sc = primaryScript(ch);
      return [...near].some((c) => c !== ch && !PACK_DONORS.has(c) && primaryScript(c) === sc);
    }),
  /** 40d: only requested languages make a word legitimate; their letters are donors otherwise. */
  d40d: (w) => unrequestedLetter(w.word),
  /** 42, 42b, 36c: a dash-joined token judged with outside context (`NTLM-хеш` in Russian text). */
  d42dash: (_w, _s, _o, near) => TRIGGERS.d42dash(near),
  /** 41o: an HTML character reference next to the word is no word (`pay&shy;pal`). */
  d41oref: (_w, _s, _o, near) => TRIGGERS.d41oref(near),
  /** 36e: an `x` between digits is a non-letter (`1920х1080` → `1920×1080`). */
  d36x: (w) => TRIGGERS.d36x(w.word),
  /** 14: a removed control or illegal code point next to the word joins it (phase 1's output). */
  d14removed: (_w, _s, _o, near) => TRIGGERS.d14removed(near),
  /** 42: the word holds mojibake, whose encoded bytes are not converted. */
  d42: (w, s) => mojibakeIn(s).some((h) => h.s < w.index + w.word.length && w.index < h.e),
};

/**
 * Why `ours` may differ from `main` (the upstream reference build) on `s`: an
 * empty list when it may not. A flag the reference raises on a word that the
 * library drops needs a decision in `REMOVES` on that word; any other
 * difference a trigger in the input.
 */
function explain(
  s: string,
  ours: { words: readonly AnyWord[] },
  main: { words: readonly MainWord[] },
  triggers: Trigger[],
  context: (w: AnyWord) => string = () => s,
): string[] {
  const lost = main.words.filter(
    (w) =>
      w.signals.some((y) => MAIN_SPOOF.has(y)) &&
      !ours.words.some((o) => overlaps(o, w) && o.signals.some((y) => OUR_SPOOF.has(y))),
  );
  if (lost.length) {
    const why = new Set<string>();
    for (const w of lost) {
      const hit = Object.keys(REMOVES).filter((d) => REMOVES[d]!(w, s, ours.words, context(w)));
      if (!hit.length) return [];
      for (const d of hit) why.add(d);
    }
    return [...why];
  }
  // 42g explains only a difference in a word that holds a bidi mark.
  return triggers.filter((t) =>
    t === 'd42g'
      ? TRIGGERS.d42g(s) && wordsApart(ours, main).some((w) => BIDI_MARK_RE.test(w.word))
      : TRIGGERS[t](s),
  );
}

describe('parity: the default path equals the upstream reference build, field for field', () => {
  it(
    'analyze with no option: corpus, random, mark-heavy, words over 250',
    { timeout: 60_000 },
    () => {
      for (const s of inputs) {
        const ours = analyze(s);
        const main = upstreamFields(reference.analyze(s));
        if (same(ours, main)) continue;
        // Decision 40f: the long s reads `s` on every path (the upstream reference build: UTS
        // #39's `f`); decision 42g: a bidi mark is judged by its paragraph. The only differences
        // allowed: with `ſ` written as `s`, the results are the reference's but for words holding
        // a bidi mark.
        expect(TRIGGERS.d40f(s) || TRIGGERS.d42g(s), JSON.stringify(s)).toBe(true);
        const t = s.replace(/ſ/g, 's');
        const o2 = analyze(t);
        const m2 = upstreamFields(reference.analyze(t));
        if (!same(o2, m2))
          expect(onlyBidiMarksApart(o2, m2 as Result), JSON.stringify(s)).toBe(true);
      }
    },
  );
});

/** Every input whose result differs from the upstream reference build must be explained ({@link explain}). */
function attribute(
  pair: (s: string) => { ours: { words: readonly AnyWord[] }; main: MainAnalysis },
  triggers: Trigger[],
) {
  for (const s of inputs) {
    const { ours, main } = pair(s);
    if (same(ours, main)) continue;
    expect(
      explain(s, ours, main, triggers),
      `no decision explains ${JSON.stringify(s)}`,
    ).not.toEqual([]);
  }
}

const LENIENT_MODEL: Record<string, AnalyzeOptions> = {
  alphabet: { confusionModel: 'language' },
  expected: { confusionModel: 'language', inputLanguages: ['Russian'] },
  noFold: { confusionModel: 'language', wholeScriptFold: 'off' },
};

describe('parity: lenient language model against the upstream reference build', () => {
  it.each(Object.entries(LENIENT_MODEL))(
    '%s: only foreign-script words change (decisions 34–36)',
    (name, o) => {
      attribute(
        (s) => ({
          ours: analyze(s, { ...o, breadth: 'all' }),
          main: upstreamFields(reference.analyze(s, o)) as MainAnalysis,
        }),
        [
          'd19',
          'd22',
          'd34',
          'd36a',
          'd40',
          'd40d',
          'd40f',
          'd42dash',
          'd41oref',
          'd36x',
          'd42d',
          'd42g',
        ],
      );
    },
  );
});

const CLEAN_SETS: Record<string, Partial<HiddenCharRules>> = {
  strict: {},
  withContent: { bidiOverrides: 'remove-with-content' },
  keepStacks: { markStacks: 'keep', markStacksOther: 'keep' },
  upstreamLike: {
    softHyphen: 'remove-counted',
    wordBreakHint: 'keep',
    controlChars: 'remove-silent',
  },
  analyzeRules: { controlChars: 'keep', markStacksOther: 'keep' },
  tagsWithContent: { tags: 'remove-with-content' },
};

describe('parity: cleanHidden, default rules against the upstream reference build', () => {
  it.each(Object.entries(CLEAN_SETS))('%s', { timeout: 60_000 }, (name, over) => {
    const rules = { ...STRICT_HIDDEN_RULES, ...over };
    const n: Record<string, number> = { differs: 0, d11: 0, d27: 0, d28a: 0 };
    for (const s of inputs) {
      // Decision 42g: with right-to-left text, the bidi marks are judged by their paragraph.
      const g = TRIGGERS.d42g(s) ? withoutBidiMarks : (x: string) => x;
      const main = g(reference.cleanHidden(s, { ...rules, ...MAIN }).cleaned);
      expect(g(cleanHidden(s, { ...rules, ...MAIN })), JSON.stringify(s)).toBe(main);
      const ours = g(cleanHidden(s, rules));
      if (ours === main) continue;
      n.differs!++;
      expect(onlyDropped(ours, main, anyDrop), JSON.stringify(s)).toBe(true);
      for (const d of Object.keys(BACK) as Back[]) {
        const back = g(cleanHidden(s, { ...rules, ...BACK[d] }));
        if (back === ours) continue;
        n[d]!++;
        expect(onlyDropped(ours, back, DROPS[d]), `${d} ${JSON.stringify(s)}`).toBe(true);
      }
    }
    void n;
  });
});

const STRICT_SETS: Record<string, AnalyzeOptions> = {
  strict: { hiddenChars: 'strict' },
  both: { hiddenChars: 'strict', confusionModel: 'language' },
  withContent: {
    hiddenChars: 'strict',
    confusionModel: 'language',
    hiddenCharRules: { bidiOverrides: 'remove-with-content' },
  },
  noFold: { hiddenChars: 'strict', confusionModel: 'language', wholeScriptFold: 'off' },
};

describe('parity: strict analyze, default rules against the upstream reference build', () => {
  it.each(Object.entries(STRICT_SETS))('%s', { timeout: 120_000 }, (name, o) => {
    const rules = (extra: object) => ({
      ...o,
      breadth: 'all' as const,
      hiddenCharRules: { ...o.hiddenCharRules, ...extra },
    });
    const triggers: Trigger[] = o.confusionModel
      ? [
          'd7a',
          'd19',
          'd22',
          'd28b',
          'd30',
          'd34',
          'd36a',
          'd40',
          'd40d',
          'd40f',
          'd42dash',
          'd41oref',
          'd36x',
          'd14removed',
          'd42d',
          'd42g',
        ]
      : ['d7a', 'd19', 'd28b', 'd30', 'd40f', 'd42g'];
    // With 11, 27, 28a at the reference's values, what differs is 28b, 30a, 34–36.
    attribute(
      (s) => ({
        ours: analyze(s, rules(MAIN)),
        main: upstreamFields(reference.analyze(s, o)) as MainAnalysis,
      }),
      triggers,
    );
    // 11, 27, 28a, each set alone to the reference's value against the default rules.
    const back: Record<string, number> = { d11: 0, d27: 0, d28a: 0 };
    for (const s of inputs) {
      const ours = analyze(s, rules({}));
      for (const d of Object.keys(BACK) as Back[]) {
        const b = analyze(s, rules(BACK[d]));
        if (same(b, ours)) continue;
        back[d]!++;
        expect(
          onlyDropped(ours.normalized, b.normalized, DROPS[d]),
          `${d} ${JSON.stringify(s)}`,
        ).toBe(true);
      }
    }
    void back;
  });
});

describe('parity: the ~1 MB realistic text', () => {
  let text = '';
  beforeAll(async () => {
    const { buildRealisticMarkdown } = (await import(
      join(__dirname, '..', 'scripts', 'realistic-text.mjs') as string
    )) as { buildRealisticMarkdown: (o: object) => string };
    text = buildRealisticMarkdown({ targetBytes: 1 << 20, seed: 1, cases: corpus });
  });
  it('analyze default: equal to the upstream reference build (decision 40f aside: `ſ` reads `s`)', () => {
    const t = TRIGGERS.d40f(text) ? text.replace(/ſ/g, 's') : text;
    const ours = analyze(t);
    const main = upstreamFields(reference.analyze(t));
    // Decision 42g: bidi marks are judged by their paragraph (the upstream reference build: by
    // the whole text).
    if (!same(ours, main)) expect(onlyBidiMarksApart(ours, main as Result)).toBe(true);
  });
  it.each([
    ['language', { confusionModel: 'language' }],
    ['strict', { hiddenChars: 'strict' }],
    ['both', { hiddenChars: 'strict', confusionModel: 'language' }],
  ] as [string, AnalyzeOptions][])(
    '%s: every word that differs from the upstream reference build carries a decision trigger',
    (name, o) => {
      const main = upstreamFields(reference.analyze(text, o));
      const ours = analyze(text, { ...o, breadth: 'all', hiddenCharRules: MAIN });
      const key = (w: { index: number; signals: readonly string[]; normalized?: string }) =>
        `${w.index}:${w.signals.join()}:${w.normalized ?? ''}`;
      const a = new Map<string, AnyWord>(ours.words.map((w) => [key(w), w]));
      const b = new Map<string, MainWord>(main.words.map((w) => [key(w), w as MainWord]));
      const triggers = (
        o.confusionModel
          ? [
              'd7a',
              'd19',
              'd22',
              'd28b',
              'd30',
              'd34',
              'd36a',
              'd40',
              'd40d',
              'd40f',
              'd42dash',
              'd41oref',
              'd36x',
            ]
          : ['d7a', 'd19', 'd28b', 'd30', 'd40f']
      ) as Trigger[];
      // The word with its line around it: the context the decisions read.
      const around = (w: AnyWord) =>
        text.slice(Math.max(0, w.index - 200), w.index + w.word.length + 200);
      const unexplained: string[] = [];
      for (const [k, w] of [...a]
        .filter(([k]) => !b.has(k))
        .concat([...b].filter(([k]) => !a.has(k)))) {
        // A flag the upstream reference build raises that the library drops needs a decision
        // that removes it, on that word.
        const near = ours.words.filter((x) => overlaps(x, w));
        const mainNear = (main.words as MainWord[]).filter((x) => overlaps(x, w));
        const why = explain(text, { words: near }, { words: mainNear }, [], around);
        // 42g: a bidi mark's finding follows its paragraph, which may reach past the line.
        const any =
          triggers.some((t) => TRIGGERS[t](w.word) || TRIGGERS[t](around(w))) ||
          (TRIGGERS.d42g(text) && BIDI_MARK_RE.test(w.word));
        const lost = mainNear.some(
          (m) =>
            m.signals.some((y) => MAIN_SPOOF.has(y)) &&
            !near.some((x) => overlaps(x, m) && x.signals.some((y) => OUR_SPOOF.has(y))),
        );
        if (lost ? !why.length : !any) unexplained.push(`${name} ${k} ${JSON.stringify(w.word)}`);
      }
      expect(unexplained).toEqual([]);
    },
  );
});
