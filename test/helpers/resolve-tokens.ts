/**
 * Test helper: resolves every word of a text through the word phase (one window, one
 * nearest-words definition: decisions 22, 41b), lenient, every word as context; the
 * resolution of each token starting at `starts` that has one.
 */
import type { ConfusionModel } from '../../src/confusion';
import { LetterPhase } from '../../src/letters';
import type { WholeScriptFold, WordResolution } from '../../src/resolve';
import type { TargetLanguage } from '../../src/languages';

export function resolveTokens(
  text: string,
  starts: readonly number[],
  model: ConfusionModel,
  options: {
    wholeScriptFold?: WholeScriptFold;
    inputLanguages?: readonly TargetLanguage[];
    majorityWindow?: number;
  } = {},
): { resolved: Map<number, WordResolution> } {
  const at = new Map<number, number>();
  for (let i = 0; i < starts.length; i++) at.set(starts[i]!, i);
  const resolved = new Map<number, WordResolution>();
  const W = options.majorityWindow ?? 10;
  const phase = new LetterPhase({
    source: text,
    strict: false,
    model,
    inputLanguages: options.inputLanguages ?? [],
    wholeScriptFold: options.wholeScriptFold ?? 'all',
    contextBuffer: Math.max(100, 2 * W + 1),
    majorityWindow: W,
    breadth: 'all',
    neutral: false,
    wordCap: false,
    out: () => {},
    finding: (f) => {
      const i = at.get(f.start);
      if (f.resolved && i !== undefined) resolved.set(i, f.resolved);
    },
    counted: null,
  });
  phase.record(0, text.length, '', 'keep');
  phase.finish();
  return { resolved };
}
