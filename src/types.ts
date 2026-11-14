import type { ConditionalTwinId, ConfusionAlphabet, DonorAlphabet, Evidence } from './confusion';
import type { HiddenCharRules, HiddenReport } from './hidden';
import type { TargetLanguage } from './languages';
import type { ResolutionRule, WholeScriptFold } from './resolve';
import type { ScriptName } from './scripts';

export type SpoofSignal =
  'mixed_script' | 'confusable_word' | 'invisible' | 'zalgo' | 'illegal' | 'encoding_damage';

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
export const SPOOFING_SIGNALS: readonly SpoofSignal[] = SPOOF_SIGNALS.filter(
  (s) => s !== 'encoding_damage',
);

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
  /** Primary scripts of the token's letters, e.g. ['Latin', 'Cyrillic']. */
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
    /** The ladder step (or rule) that decided. */
    rule: ResolutionRule;
    /** False for kept confusable words (`wholeScriptFold: 'off'`) and every mixed word. */
    folded: boolean;
    /** Step-1 alphabet (hyphen partners or both neighbours) and step-2 window alphabet. */
    context: { neighbours: ConfusionAlphabet | null; window: ConfusionAlphabet | null };
    /** Alphabets the whole word fits. */
    candidates: ConfusionAlphabet[];
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
   * lookalikes (upstream). `'alphabet'`: the per-alphabet confusion model works
   * out which alphabet a scrambled word is written in and folds toward it
   * (`Пpивет` → `Привет`, `раураl` → `paypal`).
   */
  confusionModel?: 'latin' | 'alphabet';
  /**
   * `'lenient'` (default): upstream invisible-character rules. `'strict'`: the
   * per-class rule set of `hiddenCharRules`, removal counters and decoded
   * payloads (`result.hidden`).
   */
  hiddenChars?: 'lenient' | 'strict';
  /** Per-class overrides of the strict rule set (only with `hiddenChars: 'strict'`). */
  hiddenCharRules?: Partial<HiddenCharRules>;
  /** Whole-script words (`НОТ`): `'all'` (default), `'foreign-letters'`, `'off'`. Alphabet model only. */
  wholeScriptFold?: WholeScriptFold;
  /** Enabled conditional twins (descender/italic pairs). Alphabet model only. */
  conditionalTwins?: ReadonlySet<ConditionalTwinId> | readonly ConditionalTwinId[];
  /** Fold destinations. Default English, Russian, Ukrainian, Greek. Alphabet model only. */
  targetLanguages?: readonly TargetLanguage[];
  /** Lookalike-only alphabets. Default: every alphabet no target language uses. Alphabet model only. */
  donorAlphabets?: readonly DonorAlphabet[];
}

export interface AnalysisResult {
  /**
   * True when any *spoofing* signal fired. `encoding_damage` alone does not
   * set this: broken text is a data-quality problem, not an attack.
   */
  spoofed: boolean;
  /** Which signals fired anywhere in the text. */
  signals: Record<SpoofSignal, boolean>;
  /** Per-token evidence, in input order. Only affected tokens are listed. */
  words: WordFinding[];
  counts: {
    wordsTotal: number;
    wordsAffected: number;
    /** Words (whitespace-delimited chunks) with at least one counted hidden character (strict mode). */
    hiddenWords: number;
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
  /** Hidden-character findings, payloads and totals (`hiddenChars: 'strict'` only). */
  hidden?: HiddenReport;
}
