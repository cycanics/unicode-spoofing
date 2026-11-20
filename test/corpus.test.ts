/**
 * Acceptance corpus (test/fixtures/cases.json, the upstream benchmark,
 * unmodified). A case passes when `spoofed` matches, `normalized`
 * equals the expected form when one is given, and the input is unchanged when
 * `keep` is set; ambiguous cases are not scored.
 *
 * The score per mode is a measurement, printed, not pinned. A case the
 * library fails while the upstream reference build
 * (test/fixtures/reference/main.mjs, same options) passes it must be one where
 * a design decision disagrees with the benchmark (DECISION_DIFFERS below:
 * decision and reason); any other such case fails the test. Cases the upstream
 * reference build fails too are reported as failures.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyze, type AnalyzeOptions } from '../src';
// @ts-expect-error -- a vendored ESM bundle without types
import * as ref from './fixtures/reference/main.mjs';
import { mainOptions } from './helpers/main-options';

interface Case {
  id: string;
  input: string;
  verdict: 'must_flag' | 'must_not_flag' | 'ambiguous';
  expected: { spoofed: boolean; normalized?: string; keep?: boolean };
}
type Analyze = (t: string, o?: object) => { spoofed: boolean; normalized: string };
const main: Analyze = (t, o) => (ref as { analyze: Analyze }).analyze(t, mainOptions(o));
const cases = (
  JSON.parse(readFileSync(join(__dirname, 'fixtures', 'cases.json'), 'utf8')) as Case[]
).filter((c) => c.verdict !== 'ambiguous');

const passes = (fn: Analyze, c: Case, o: AnalyzeOptions) => {
  const r = fn(c.input, o);
  return (
    r.spoofed === c.expected.spoofed &&
    (c.expected.normalized === undefined || r.normalized === c.expected.normalized) &&
    (!c.expected.keep || r.normalized === c.input)
  );
};

/** Cases where a design decision disagrees with the benchmark. */
const DECISION_DIFFERS: Record<string, string> = {
  'html_entity-003':
    '41o: a hidden-character reference behaves as the raw character, output removal too; strict removes a soft hyphen inside a word (Donaudampfschiff)',
  'html_entity-007':
    '41o: a hidden-character reference behaves as the raw character, output removal too; strict removes and counts ZWNJ in a word of Latin letters (Brotzeit)',
  'mixed_script-002':
    '36e: only 36e fixes a word mixing two requested languagesâ letters (ordering B); the last one-letter piece is reported, not converted (Москвa: mixed_non_legitimate)',
  'mixed_script-010':
    '36e: only 36e fixes a word mixing two requested languagesâ letters (ordering B); the last one-letter piece is reported, not converted (Wе)',
  'mixed_script-018':
    '36e: only 36e fixes a word mixing two requested languagesâ letters (ordering B); a multi-letter piece is reported, not converted (ассоunt)',
  'whole_script-004':
    '36e: only 36e fixes a word mixing two requested languagesâ letters (ordering B); a multi-letter piece is reported, not converted (раураl)',
  'case_dependent-008':
    '36e: only 36e fixes a word mixing two requested languagesâ letters (ordering B); `к` has no English twin and `ey` is two letters, so nothing converts: reported (кey)',
  'case_dependent-011':
    '36e: only 36e fixes a word mixing two requested languagesâ letters (ordering B); `т`~`m` is italic only and `ap` is two letters, so nothing converts: reported (тap)',
  'idn-004':
    '36e: only 36e fixes a word mixing two requested languagesâ letters (ordering B); multi-letter pieces are reported, not converted (ехаmрlе)',
  'legit_ru_tech-013':
    '40g: п and n are ordinary twins, so the all-look-alike по folds to English by its context (e-mail)',
  'legit_greek-001':
    "36c setting: a one-letter dash part whose letter has a twin in the other part's language is part of the word, off for every language by default (π-калибровка → п-калибровка)",
  'legit_greek-002':
    "36c setting: a one-letter dash part whose letter has a twin in the other part's language is part of the word, off for every language by default (α-частица → а-частица)",
  'legit_latin-007':
    '40d: European is not requested by default, so Icelandic þ is a donor of p (þorn → porn)',
  'styled-001': '30b cat. 1: a visible style converts with no spoof',
  'styled-003': '30b cat. 1: a visible style converts with no spoof',
  'styled-005': '30b cat. 1: a visible style converts with no spoof',
  'styled-010': '30b cat. 1: a visible style converts with no spoof',
  'prompt_injection-004': '30b cat. 1: fullwidth text converts with no spoof',
  'case_dependent-002': '36a/36b: nothing converts, mixed_non_legitimate, not a spoof',
  'case_dependent-004': '36a/36b: nothing converts, mixed_non_legitimate, not a spoof',
  'case_dependent-006': '36a/36b: nothing converts, mixed_non_legitimate, not a spoof',
  'case_dependent-010': '36a/36b: nothing converts, mixed_non_legitimate, not a spoof',
  'case_dependent-018': '36a/36b: nothing converts, mixed_non_legitimate, not a spoof',
  'case_dependent-019': '36a/36b: nothing converts, mixed_non_legitimate, not a spoof',
  'case_dependent-020':
    '36e: п~n is an ordinary twin since 40g, but `п` is the last piece of admiп: reported (mixed_non_legitimate), not converted',
  'mixed_script-021': '36a/36b: nothing converts, mixed_non_legitimate, not a spoof',
};

const STRICT: AnalyzeOptions = { confusionModel: 'language', hiddenChars: 'strict' };
const MODES: [string, AnalyzeOptions][] = [
  ['default options (lenient rules, Latin fold)', {}],
  ['language model + strict hidden chars', STRICT],
  [
    'alternative hidden options',
    { ...STRICT, hiddenCharRules: { softHyphen: 'remove-counted', wordBreakHint: 'keep' } },
  ],
  ['wholeScriptFold off', { ...STRICT, wholeScriptFold: 'off' }],
  ['wholeScriptFold foreign-letters', { ...STRICT, wholeScriptFold: 'foreign-letters' }],
];

describe('corpus', () => {
  it.each(MODES)(
    '%s: no failure the upstream reference build does not have, unless a decision says so',
    (name, o) => {
      let pass = 0;
      const asMain: string[] = [];
      const decided: string[] = [];
      const unexplained: string[] = [];
      for (const c of cases) {
        if (passes(analyze, c, o)) {
          pass++;
          continue;
        }
        if (!passes(main, c, o)) asMain.push(c.id);
        else if (DECISION_DIFFERS[c.id]) decided.push(c.id);
        else unexplained.push(c.id);
      }
      console.log(
        `corpus, ${name}: ${pass}/${cases.length - pass}; failures as main ${asMain.length}; ` +
          `decision differs ${decided.length}${decided.length ? ` (${decided.map((id) => `${id}: ${DECISION_DIFFERS[id]}`).join('; ')})` : ''}`,
      );
      expect(unexplained).toEqual([]);
    },
  );
  it('the default path matches the upstream reference build on every case (40f aside: `ſ` reads `s`; 42g: bidi marks by paragraph)', () => {
    const rtl42g = (t: string) =>
      /[\u200e\u200f\u061c\u2066-\u2069]/u.test(t) &&
      /[\p{Script=Hebrew}\p{Script=Arabic}]/u.test(t);
    for (const c of cases) {
      if (c.input.includes('ſ')) continue;
      // Decision 42g: a bidi mark in right-to-left text stays: a case may pass where the
      // upstream reference build fails.
      if (rtl42g(c.input)) {
        if (passes(main, c, {})) expect(passes(analyze, c, {}), c.id).toBe(true);
        continue;
      }
      expect(passes(analyze, c, {}), c.id).toBe(passes(main, c, {}));
    }
  });
});
