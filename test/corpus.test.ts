/**
 * Acceptance corpus (test/fixtures/cases.json, 294 cases; docs/confusion-model.md
 * §8, §16). A case passes when `spoofed` matches, `normalized` equals the
 * expected form when one is given, and the input is unchanged when `keep` is
 * set; ambiguous cases are not scored.
 *
 * The failing ids are listed explicitly: a newly failing case fails the test,
 * and a newly passing one does too (move it out of the list).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyze, type AnalyzeOptions } from '../src';

interface Case {
  id: string;
  input: string;
  verdict: 'must_flag' | 'must_not_flag' | 'ambiguous';
  expected: { spoofed: boolean; normalized?: string; keep?: boolean };
}
const cases = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'cases.json'), 'utf8')) as Case[];

function failures(opts: AnalyzeOptions): string[] {
  const out: string[] = [];
  for (const c of cases) {
    if (c.verdict === 'ambiguous') continue;
    const r = analyze(c.input, opts);
    const ok =
      r.spoofed === c.expected.spoofed &&
      (c.expected.normalized === undefined || r.normalized === c.expected.normalized) &&
      (!c.expected.keep || r.normalized === c.input);
    if (!ok) out.push(c.id);
  }
  return out.sort();
}
const scored = cases.filter((c) => c.verdict !== 'ambiguous').length;

/** Owner decisions the corpus disagrees with (§16). */
const OWNER_VS_CORPUS = [
  'hidden_format-001',
  'hidden_format-002',
  'hidden_format-003',
  'prompt_injection-005',
  'zero_width-016',
  'zero_width-029',
];
/** Fail in upstream too (§16). */
const INHERITED = [
  'bidi-015',
  'legit_greek-004',
  'legit_greek-007',
  'mixed_numbers-001',
  'mixed_numbers-003',
  'styled-004',
  'styled-015',
  'zalgo-002',
];
/** HTML entities are not decoded (out of scope). */
const HTML = [1, 2, 4, 8, 9, 10, 12, 13, 14, 18, 21, 22].map(
  (n) => `html_entity-${String(n).padStart(3, '0')}`,
);
const STRICT_DEFAULTS: AnalyzeOptions = { confusionModel: 'alphabet', hiddenChars: 'strict' };
/** Hidden options that restore upstream's soft-hyphen and Thai-ZWSP behaviour. */
const OWNER_ALTERNATIVE: AnalyzeOptions = {
  ...STRICT_DEFAULTS,
  hiddenCharRules: { softHyphen: 'remove-counted', wordBreakHint: 'keep' },
};

describe('corpus', () => {
  it('has 252 scored cases', () => {
    expect(cases).toHaveLength(294);
    expect(scored).toBe(252);
  });

  // Upstream v0.4.0 itself scores 206/46 (docs/confusion-model.md §8); the defaults
  // keep its rules plus the fixes sent upstream (control_char-003: ANSI escapes;
  // tag_chars-007: tags after an emoji; variation_selector-011/013: selectors).
  it('default options (upstream rules): 210/42', () => {
    expect(scored - failures({}).length).toBe(210);
  });

  it('alphabet model + strict hidden chars: 226/26, failures exactly the known gaps', () => {
    expect(failures(STRICT_DEFAULTS)).toEqual([...OWNER_VS_CORPUS, ...INHERITED, ...HTML].sort());
  });

  it('owner-alternative hidden options recover the 4 cases that differ from upstream: 230/22', () => {
    const f = failures(OWNER_ALTERNATIVE);
    expect(scored - f.length).toBe(230);
    const recovered = OWNER_VS_CORPUS.filter((id) => !f.includes(id));
    expect(recovered).toEqual([
      'hidden_format-002',
      'hidden_format-003',
      'prompt_injection-005',
      'zero_width-029',
    ]);
    // With them the fork fails no case that upstream passes.
    const up = failures({});
    expect(f.filter((id) => !up.includes(id))).toEqual([]);
  });

  it('wholeScriptFold modes: off 222/30, foreign-letters 225/27', () => {
    expect(scored - failures({ ...STRICT_DEFAULTS, wholeScriptFold: 'off' }).length).toBe(222);
    expect(
      scored - failures({ ...STRICT_DEFAULTS, wholeScriptFold: 'foreign-letters' }).length,
    ).toBe(225);
  });
});
