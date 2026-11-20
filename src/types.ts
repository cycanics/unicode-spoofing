import type {
  ConditionalTwinId,
  ConfusionAlphabet,
  DonorAlphabet,
  Evidence,
  Lookalikes,
} from './confusion';
import type { HiddenCharRules } from './hidden';
import type { TargetLanguage } from './languages';
import type { ResolutionRule, WholeScriptFold } from './resolve';
import type { ScriptName } from './scripts';

export type SpoofSignal =
  | 'mixed_script'
  | 'confusable_word'
  | 'invisible'
  | 'zalgo'
  | 'illegal'
  | 'encoding_damage'
  | MixedCategory
  | 'whole_word_lookalike';

/**
 * Decision 36a (alphabet model): the category of a mixed-script word, in place
 * of `mixed_script`. `mixed_spoof`: look-alikes in it were converted (a spoof);
 * `mixed_legitimate`: the other script is written without spaces (not a spoof);
 * `mixed_non_legitimate`: scripts written with spaces glued, nothing converted
 * (reported, not a spoof). Present in `signals` only when set.
 */
export type MixedCategory = 'mixed_spoof' | 'mixed_legitimate' | 'mixed_non_legitimate';

/**
 * Decision 41o (alphabet model): `whole_word_lookalike`, a word written wholly in one
 * requested language's letters that its context would fold into another, kept as
 * written because a nearest word is a clean word of its own language (`устройствами
 * по Bluetooth`). Not a spoof. Present in `signals` only when set.
 */
export type WordCategory = MixedCategory | 'whole_word_lookalike';

export const SPOOF_SIGNALS: readonly SpoofSignal[] = [
  'mixed_script',
  'confusable_word',
  'invisible',
  'zalgo',
  'illegal',
  'encoding_damage',
];

/**
 * Signals that assert *intent* — someone disguised this text. `encoding_damage`
 * is deliberately absent: U+FFFD is a decoder's output, not an author's input,
 * so it evidences a broken pipeline rather than an attacker. It is reported,
 * but it does not make a result `spoofed`.
 */
export const SPOOFING_SIGNALS: readonly SpoofSignal[] = [
  ...SPOOF_SIGNALS.filter((s) => s !== 'encoding_damage'),
  'mixed_spoof',
];

export interface WordFinding {
  /**
   * The token exactly as it appears in the input. For an `illegal` finding
   * (a lone control / non-character code point, which is never part of a
   * token) this is the offending character on its own.
   */
  word: string;
  /** Codepoint-safe character offset of the token in the input string. */
  index: number;
  /** Signals this token carries (a token can carry several). */
  signals: SpoofSignal[];
  /**
   * Primary scripts of the token's letters, e.g. ['Latin', 'Cyrillic'], where the
   * word check recorded them. Empty for a hidden-character finding under
   * `hiddenChars: 'strict'`, and for a mixed word corrected letter by letter
   * (`pаypal`) under strict with the alphabet model.
   */
  scripts: ScriptName[];
  /**
   * UTS #39 skeleton of the token — present when it drove a
   * mixed_script/confusable_word signal (what the token resolves to).
   */
  skeleton?: string;
  /**
   * The word after resolution and cleanup — present with
   * `confusionModel: 'alphabet'` or `hiddenChars: 'strict'`. Render a finding
   * as `${f.normalized} (${f.word})`.
   */
  normalized?: string;
  /** How the confusion model resolved the word (`confusionModel: 'alphabet'` only). */
  resolution?: {
    /** confusable = some alphabet fits the whole word; mixed = none does. */
    class: 'confusable' | 'mixed';
    /** Alphabet the word was folded into; null when kept or mixed. */
    script: ConfusionAlphabet | null;
    /** The language it was folded into (never another language of its alphabet); null when kept or mixed. */
    language: TargetLanguage | null;
    /** The ladder step (or rule) that decided. */
    rule: ResolutionRule;
    /** False for kept confusable words (`wholeScriptFold: 'off'`) and every mixed word. */
    folded: boolean;
    /** Step-1 languages (both nearest words') and the step-2 window language (never mix languages). */
    context: { neighbours: TargetLanguage[]; window: TargetLanguage | null };
    /** Languages that can take the whole word. */
    candidates: TargetLanguage[];
    /** Target alphabets whose fold breaks their language (letters or rule name). */
    rejected: Partial<Record<ConfusionAlphabet, string>>;
    /** Internal evidence against the word's own script. */
    evidence?: Evidence;
  };
}

export interface AnalyzeOptions {
  /**
   * Scripts that are expected in this content (e.g. ['Cyrillic'] for a sender
   * with genuine Russian traffic). Whole words written in an expected script
   * are never reported as confusable_word; intra-word mixing still is.
   */
  expectedScripts?: readonly ScriptName[];
  /**
   * `'latin'` (default): mixed-script and confusable words fold to Latin
   * lookalikes. `'alphabet'`: the per-alphabet confusion model works out which
   * requested language (`targetLanguages`) a scrambled word is written in and
   * folds toward it (`Пpивет` → `Привет`, `pаypal` → `paypal`). A word holding
   * letters of two requested languages is corrected only letter by letter:
   * `раураl` (five Russian letters and a Latin `l`) is reported as
   * `mixed_non_legitimate` and kept with the default languages, and folds to
   * `paypal` when neither Russian nor Ukrainian is requested.
   */
  confusionModel?: 'latin' | 'alphabet';
  /**
   * `'lenient'` (default): upstream invisible-character rules. `'strict'`: the
   * per-class rule set of `hiddenCharRules`; marks, regions and decoded
   * payloads go to the callbacks.
   */
  hiddenChars?: 'lenient' | 'strict';
  /**
   * Per-class overrides of the strict rule set (`hiddenChars: 'strict'`). The
   * lenient path reads only `illegal`, `encodingDamage` and `invisibleOutsideWord`.
   * An unknown rule value throws a `RangeError`.
   */
  hiddenCharRules?: Partial<HiddenCharRules>;
  /** Whole-script words (`НОТ`): `'all'` (default), `'foreign-letters'`, `'off'`. Alphabet model only. */
  wholeScriptFold?: WholeScriptFold;
  /**
   * Enabled conditional twins (descender/italic pairs) as additional look-alike
   * packs. Alphabet model only; ignored when `lookalikes` is given. An unknown id
   * throws a plain `Error` (`unknown look-alike pack …`).
   */
  conditionalTwins?: ReadonlySet<ConditionalTwinId> | readonly ConditionalTwinId[];
  /**
   * Look-alike packs (decisions 40–40c), built once by `buildLookalikes` before
   * processing. Default: the ready-made default packs. Alphabet model only.
   */
  lookalikes?: Lookalikes;
  /**
   * Fold destinations. Default English, Russian, Ukrainian, Greek. Alphabet model only.
   * A name that is no target language (a script name such as `'Cyrillic'`) throws a plain
   * `Error` (`unknown target language …`), not a `RangeError`.
   */
  targetLanguages?: readonly TargetLanguage[];
  /** Lookalike-only alphabets. Default: every alphabet no target language uses. Alphabet model only. */
  donorAlphabets?: readonly DonorAlphabet[];
  /**
   * Words the word phase holds for context (decision 20): the ring the
   * neighbour search, the majority window and, with `breadth: 'window'`, the
   * dominant script and "any word is mixed" read. Default 100; at least
   * `2 × majorityWindow + 1` (a RangeError otherwise).
   */
  contextBuffer?: number;
  /** The majority window of the context ladder, ± words (decision 22). Default 10, as in v0.6.0. */
  majorityWindow?: number;
  /**
   * Span of the dominant script and "any word is mixed" inside the word checks
   * (decision 21): `'window'` the context buffer around the word (streams: a
   * word is judged once the read-ahead reaches the buffer's edge), the default
   * with `confusionModel: 'alphabet'`; `'all'` every word of the text, the
   * default otherwise (upstream's behaviour). Decision 42f: `'all'` is kept for
   * comparison with upstream only and its use is discouraged: where the two
   * differ, it is wrong more often than the window, and it holds every word.
   */
  breadth?: 'window' | 'all';
  /**
   * The neutral dictionary (decisions 30–33, 30a–30i, 31a, 32, 37, 38): styled
   * and compatibility letters (`ⓐ`, `Ｐ`, `ﬁ` → `fi`, `ſ` → `s`), math letters
   * (`𝐏`, `ℝ`, `ϕ`), Roman numerals (`Ⅱ`), look-alikes of real scripts and digits
   * (`ꓮ`, `ו`, `Ꮞ` → `4`, `൦` → `o`), unit symbols and brand marks (`℃`, `®`).
   * Under the alphabet model a neutral character follows its word's alphabet
   * (`pⓐypal` → `paypal`); under the Latin model it is written as its letter
   * before the word is judged. Per character type: whether it converts alone
   * (look-alikes, math, Roman numerals do) and whether its conversion is a spoof
   * (look-alikes are; styled, compatibility and math forms are not and reach the
   * word callback with no signal); unit symbols and brand marks stay as written
   * (`TAIL_MARKS`). Superscripts, subscripts and modifier letters are not
   * neutral. Default: on with `hiddenChars: 'strict'`, off otherwise.
   */
  neutralAlphabet?: boolean;
  /**
   * Math switch 1 (decision 30h; off by default): math letters (Mathematical
   * Alphanumeric and Letterlike letters, math Greek, the Greek symbol variants
   * `ϕ ϵ ϑ ϰ ϱ ϖ ϐ ϒ`) are kept as written instead of converted to their base
   * letters, and words made of math letters, or math letters and Greek
   * (`ℎν`, `𝑘𝑇𝜈`), are not judged. The library does not detect math; the
   * caller decides (30g). Switch 2 is the hidden-character rule
   * `invisibleMathOperators`.
   */
  keepMathLetters?: boolean;
  /**
   * Decision 36c option: a real affix of a mixed word (one script, all its
   * letters in one requested language other than the body's; a suffix on that
   * language's grammar list, a prefix only after a dash) is kept as written,
   * and an unseparated one is set off from the body by this string; the word is
   * not a spoof for it (`'-'`: `Windowsах` → `Windows-ах`; `''`: `Windowsах`
   * stays and is not reported). The affix logic then comes before the
   * whole-word conversion. Other chunks still convert (`pаypalя` → `paypal-я`,
   * a spoof). Default (undefined): the whole-word conversion first; an affix
   * set off by a dash or an apostrophe stays (`iPhone'ах`, `SMS-ах`), a glued
   * one only when the word is not converted whole. Alphabet model only.
   */
  affixSeparator?: string;
  /**
   * Decision 36c setting: the requested languages whose one-letter dash prefix
   * (`Р-aypal`), whose letter has a twin in the body's language, applies as an
   * affix, in every mode (`affixSeparator` included). Default: none (off for
   * every language): the letter is part of the word and converts (`Р-aypal` →
   * `P-aypal`, a spoof). A one-letter end part is a suffix only on a suffix
   * list (`plan-В` → `plan-B` whatever the setting). Names are checked like
   * `targetLanguages`. Strict mode, alphabet model.
   */
  oneLetterDashAffix?: readonly TargetLanguage[];
  /**
   * Decision 41o setting: how named HTML character references are read.
   * `'lenient'` (default): names with `;`, and the legacy names (`&amp`,
   * `&copy`, …) also without it, except when `=`, a letter or a digit of any
   * script follows (`&section=1`, `&regionCode=mde`, `a&copyжурнал` stay text). `'strict'`: only names
   * terminated with `;`. Numeric references (`&#1072;`, `&#x430`) are read
   * with or without `;` either way. Strict mode, alphabet model.
   */
  htmlNamedReferences?: 'lenient' | 'strict';
  /**
   * Decision 36e setting for hostile input (default off): a mixed word's last
   * one-letter piece whose letter has a twin on the other side converts too
   * (`Applе` → `Apple`). By default it is reported, not converted. Alphabet model.
   */
  hostileInput?: boolean;
  /**
   * Decision 36c/36e RTL awareness (default on; alphabet model): a word holding a
   * right-to-left letter is split into pieces in its on-screen order (UAX #9, its
   * paragraph's direction), for the mixed-word and the affix rules alike. Off: stored order.
   */
  rtlAwareness?: boolean;
  /**
   * Math switch 3 (decision 30h.3; off by default, not part of strict's
   * defaults; alphabet model): a Math target language whose letters are the
   * Latin and Greek letters, the math letters, `µ` and `ℓ`. A word of these
   * letters is native to Math and stays as written (`αFβγ`, `cosβcosα`); one
   * mixing Latin and Greek is `mixed_legitimate`, not a spoof.
   */
  mathTarget?: boolean;
  /**
   * The ladder's thresholds (decision 41m; ticket #3 naming). `wordMajorityMinLetters`
   * (default 3) and `wordMajorityMinShare` (default 2/3): a mixed word with no deciding
   * context goes to the alphabet holding most of its letters only with at least that many
   * letters and that share of the word's letters; otherwise the request order decides
   * (primary target first). Alphabet model only.
   */
  ladder?: { wordMajorityMinLetters?: number; wordMajorityMinShare?: number };
}

export interface AnalysisResult {
  /**
   * True when any *spoofing* signal fired. `encoding_damage` alone does not
   * set this: broken text is a data-quality problem, not an attack.
   */
  spoofed: boolean;
  /** Which signals fired anywhere in the text: every signal of upstream's six; a decision-36a category only when set. */
  signals: Record<Exclude<SpoofSignal, WordCategory>, boolean> &
    Partial<Record<WordCategory, boolean>>;
  /** Per-token evidence, in input order. Only affected tokens are listed. */
  words: WordFinding[];
  counts: {
    wordsTotal: number;
    wordsAffected: number;
    /** Words some alphabet fits as a whole: folded, or kept under `wholeScriptFold: 'off'` (alphabet model). */
    confusableWords: number;
    /** Mixed-script words no alphabet fits (alphabet model). */
    mixedWords: number;
  };
  /**
   * The input with affected words de-obfuscated: confusables folded to their
   * Latin lookalikes, invisible characters removed, zalgo marks stripped.
   * Unaffected text — including legitimate non-Latin words — is untouched.
   */
  normalized: string;
  /** True when `normalized` differs from the input. */
  changed: boolean;
  /** Most frequent primary script among the input's letters, if any. */
  dominantScript: ScriptName | null;
}
