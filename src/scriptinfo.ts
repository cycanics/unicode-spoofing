/**
 * Per-script information (decision 39): script properties live in a single
 * table and each rule reads its own property. Two of them are independent:
 * - `spaceless`: words are not separated by spaces (word-break hints,
 *   decision 38's Roman-numeral context);
 * - `recommended`: UTS #31 Table 4 Recommended Scripts, the scripts a UTS #39
 *   Moderately Restrictive set may add to Latin (decisions 35, 36), together
 *   with {@link HIGHLY_RESTRICTIVE}.
 */

export interface ScriptInfo {
  spaceless?: true;
  recommended?: true;
}

const R = { recommended: true } as const;
const SR = { spaceless: true, recommended: true } as const;

export const SCRIPT_INFO: Readonly<Record<string, ScriptInfo>> = {
  Arabic: R,
  Armenian: R,
  Bengali: R,
  Bopomofo: R,
  Cyrillic: R,
  Devanagari: R,
  Ethiopic: R,
  Georgian: R,
  Greek: R,
  Gujarati: R,
  Gurmukhi: R,
  Han: SR,
  Hangul: R,
  Hebrew: R,
  Hiragana: SR,
  Kannada: R,
  Katakana: SR,
  Khmer: SR,
  Lao: SR,
  Latin: R,
  Malayalam: R,
  Myanmar: SR,
  Oriya: R,
  Sinhala: R,
  Tamil: R,
  Telugu: R,
  Thaana: R,
  Thai: SR,
  Tibetan: SR,
};

/** UTS #39 §5.2 Highly Restrictive: the script sets that may mix with Han. */
export const HIGHLY_RESTRICTIVE: readonly ReadonlySet<string>[] = [
  new Set(['Latin', 'Han', 'Hiragana', 'Katakana']),
  new Set(['Latin', 'Han', 'Bopomofo']),
  new Set(['Latin', 'Han', 'Hangul']),
];

/** The script writes words without spaces. */
export const isSpaceless = (script: string): boolean => SCRIPT_INFO[script]?.spaceless === true;
/** A UTS #31 Recommended Script. */
export const isRecommended = (script: string): boolean => SCRIPT_INFO[script]?.recommended === true;

/** Script names with a property, for building character classes. */
export const scriptsWith = (p: keyof ScriptInfo): string[] =>
  Object.keys(SCRIPT_INFO).filter((k) => SCRIPT_INFO[k]![p] === true);
