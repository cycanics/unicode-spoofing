/**
 * Words with letters outside the confusion model (decisions 34–36, alphabet
 * model only). Letters are target or donor (in the model), neutral (styled and
 * compatibility letters, src/neutral.ts) or foreign (every other script). A
 * word mixing scripts is allowed when its script set is UTS #39 "Moderately
 * Restrictive"; foreign letters are never folded. How a mixed word is
 * reported is decision 36a's (src/letters.ts).
 */

import { HIGHLY_RESTRICTIVE, isRecommended } from './scriptinfo';

/**
 * UTS #39 §5.2 Moderately Restrictive over a word's scripts (Common and
 * Inherited left out): one script; a Highly Restrictive set; or Latin and one
 * other Recommended script that is not Cyrillic or Greek.
 */
export function moderatelyRestrictive(scripts: ReadonlySet<string>): boolean {
  if (scripts.size <= 1) return true;
  if (HIGHLY_RESTRICTIVE.some((h) => [...scripts].every((s) => h.has(s)))) return true;
  if (scripts.size === 2 && scripts.has('Latin')) {
    const other = [...scripts].find((s) => s !== 'Latin')!;
    return isRecommended(other) && other !== 'Cyrillic' && other !== 'Greek';
  }
  return false;
}
