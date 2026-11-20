/**
 * The neutral dictionary (decisions 30b–30i, 31a, 32a, 38, 39; src/neutral.ts):
 * one category per character, its behaviour standalone, inside a word and at a
 * word's end, spoof by category; what is not neutral (30c, canonical
 * duplicates, letters of real scripts); the per-script table.
 */
import { describe, expect, it } from 'vitest';
import { analyze, cleanHidden, STRICT_HIDDEN_RULES, type AnalyzeOptions } from '../src';
import type { WordReason } from '../src/letters';
import { neutralInfo } from '../src/neutral';
import { HIGHLY_RESTRICTIVE, isRecommended, isSpaceless, scriptsWith } from '../src/scriptinfo';

const A: AnalyzeOptions = { hiddenChars: 'strict', confusionModel: 'alphabet' };
const L: AnalyzeOptions = { hiddenChars: 'strict' };
const MODELS: [string, AnalyzeOptions][] = [
  ['alphabet', A],
  ['latin', L],
];
const norm = (t: string, o: AnalyzeOptions = A) => analyze(t, o).normalized;
const calls = (t: string, o: AnalyzeOptions = A) => {
  const out: [string, string, WordReason][] = [];
  analyze(t, o, { onWord: (_s, _e, c, r, why) => void out.push([c, r, why]) });
  return out;
};
const category = (ch: string) => neutralInfo(ch.codePointAt(0)!)?.category ?? null;
const spoof = (t: string, o: AnalyzeOptions = A) => analyze(t, o).spoofed;

describe('decision 30b: one category per character', () => {
  it.each([
    ['ⓐ', 'visibleStyle'],
    ['⒜', 'visibleStyle'],
    ['🄰', 'visibleStyle'],
    ['Ｐ', 'visibleStyle'],
    ['ﬁ', 'visibleStyle'],
    ['𝐈', 'disguise'],
    ['ℝ', 'disguise'],
    ['ℯ', 'disguise'],
    ['𝚨', 'disguise'],
    ['ϕ', 'disguise'],
    ['ϰ', 'disguise'],
    ['Ⅱ', 'sameReading'],
    ['ⅽ', 'sameReading'],
    ['№', 'separator'],
    ['®', 'tailMark'],
    ['™', 'tailMark'],
    ['ℓ', 'unit'],
    ['℃', 'unit'],
    ['㎏', 'unit'],
    ['㎡', 'unit'],
    ['℡', 'wordSign'],
    ['℻', 'wordSign'],
    ['℅', 'wordSign'],
    ['㍵', 'japaneseSquare'],
    ['µ', 'unitPrefix'],
  ])('%s is %s', (ch, c) => {
    expect(category(ch)).toBe(c);
  });
  it.each([
    ['ᵢ', '30c subscript'],
    ['º', '30c ordinal'],
    ['ʰ', '30c modifier letter'],
    ['¹', '30c superscript'],
    ['ℹ', 'an emoji'],
    ['𝟎', 'a digit'],
    ['א', 'a letter of a real script'],
    ['ꓮ', 'a donor (look-alike packs, decision 40), not neutral'],
    ['Ꮞ', 'a digit look-alike (decision 41), not neutral'],
    ['൦', 'a donor, not neutral'],
    ['𝚤', 'math dotless i: its base is no target letter'],
    ['K', 'the kelvin sign: K'],
    ['Å', 'the ångström sign: Å'],
    ['Ω', 'the ohm sign: Ω'],
    ['Ϲ', 'capital lunate sigma: a donor (40f)'],
    ['ϲ', 'lunate sigma: a donor (40f)'],
    ['ſ', 'long s: a donor (40f)'],
    ['ϴ', 'capital theta symbol: not one of 30i’s variants'],
  ])('%s is not neutral (%s)', (ch) => {
    expect(category(ch)).toBe(null);
  });
});

describe('decision 30b category 1: visible style', () => {
  it.each(MODELS)('%s: alone kept; in a word converted, no spoof, reported', (_m, o) => {
    expect(norm('see ⓐ here', o)).toBe('see ⓐ here');
    expect(norm('see Ｐ here', o)).toBe('see Ｐ here');
    for (const [t, out] of [
      ['pⓐypal', 'paypal'],
      ['Ｐａｙｐａｌ', 'Paypal'],
      ['oﬃce', 'office'],
    ]) {
      const r = analyze(t!, o);
      expect(r.normalized).toBe(out);
      expect(r.spoofed).toBe(false);
      expect(calls(t!, o)).toEqual([[t, out, { signals: [], converted: true, toLang: 'English' }]]);
    }
  });
  it('alphabet model: follows the word’s alphabet (decision 31)', () => {
    expect(norm('пⓐроль')).toBe('пароль');
  });
});

describe('decision 30b category 2: disguise (30g, 30i)', () => {
  it.each(MODELS)('%s: always converted, alone too; a spoof', (_m, o) => {
    for (const [t, out] of [
      ['𝐈', 'I'],
      ['ℝ', 'R'],
      ['𝐏𝐚𝐲𝐩𝐚𝐥', 'Paypal'],
      ['the set ℕ of', 'the set N of'],
    ]) {
      expect(norm(t!, o)).toBe(out);
      expect(spoof(t!, o)).toBe(true);
    }
  });
  it('alphabet model: the plain letter is written before the word is judged', () => {
    // The base, not a twin: the reader sees 𝐮 as u. A styled letter is no letter of a requested
    // alphabet (36e ordering B, 40d), so `ρ𝐮` is mapped whole while a typed `ρu` is corrected
    // by 36e only (a tie: reported).
    expect(norm('ρ𝐮')).toBe('pu');
    expect(norm('ρu')).toBe('ρu');
    expect(norm('Σ𝐁')).toBe('ΣΒ');
    expect(norm('Δ𝐩')).toBe('Δρ');
    // A Greek capital alpha in a Latin word is judged as such and folded.
    expect(norm('P𝚨YP𝚨L')).toBe('PAYPAL');
    expect(analyze('P𝚨YP𝚨L', A).words[0]!.signals).toContain('mixed_spoof'); // decision 36a
  });
  it('30i: the eight Greek symbol variants convert to their Greek base', () => {
    expect(norm('ϰ ϱ ϖ')).toBe('κ ρ π');
    expect(norm('cosϕ')).toBe('cosφ');
    expect(norm('ϑ ϵ ϐ ϒ')).toBe('θ ε β Υ');
  });
});

describe('decision 30b category 3: same reading (Roman numerals, 38)', () => {
  it.each(MODELS)('%s: converted; no spoof alone or among numerals', (_m, o) => {
    for (const [t, out] of [
      ['Ⅳ', 'IV'],
      ['ⅯⅯⅩⅩⅣ', 'MMXXIV'],
      ['Chapter Ⅱ', 'Chapter II'],
    ]) {
      expect(norm(t!, o)).toBe(out);
      expect(spoof(t!, o)).toBe(false);
    }
  });
  it.each(MODELS)('%s: a spoof inside a word of a script written with spaces', (_m, o) => {
    for (const [t, out] of [
      ['ⅽlick', 'click'],
      ['ⅼogin', 'login'],
      ['EA900Ⅱ', 'EA900II'],
    ]) {
      expect(norm(t!, o)).toBe(out);
      expect(spoof(t!, o)).toBe(true);
    }
  });
  it('next to a script written without spaces: converted, no spoof (alphabet model)', () => {
    // Decision 36a: Latin with a script written without spaces is reported mixed_legitimate, no spoof.
    expect(calls('第Ⅲ章')).toEqual([
      ['第Ⅲ章', '第III章', { signals: ['mixed_legitimate'], converted: true, toLang: 'English' }],
    ]);
    expect(analyze('第Ⅲ章', A).spoofed).toBe(false);
    // Review 7 minor: the long-vowel mark (script Common) no longer stops the word.
    expect(calls('パートⅡ')).toEqual([
      [
        'パートⅡ',
        'パートII',
        { signals: ['mixed_legitimate'], converted: true, toLang: 'English' },
      ],
    ]);
  });
});

describe('decision 30b categories 4, 5: separator symbol, tail mark', () => {
  it.each(MODELS)('%s: never converted, never reported', (_m, o) => {
    for (const t of ['№5', 'Brand®', 'Acme™ Inc', '©2026']) {
      expect(norm(t, o)).toBe(t);
      expect(calls(t, o)).toEqual([]);
    }
  });
  it('a tail mark ends its word: the next letters are a word of their own', () => {
    expect(calls('pⓐy®ⓟal')).toEqual([
      ['pⓐy®', 'pay®', { signals: [], converted: true, toLang: 'English' }],
      ['ⓟal', 'pal', { signals: [], converted: true, toLang: 'English' }],
    ]);
  });
  it('the separator is a boundary on both sides', () => {
    // pⓐ is a word, № stands between, ⓨ alone stays.
    expect(calls('pⓐ№ⓨ')).toEqual([
      ['pⓐ', 'pa', { signals: [], converted: true, toLang: 'English' }],
    ]);
    expect(norm('pⓐ№ⓨ')).toBe('pa№ⓨ');
  });
});

describe('decision 30b category 6: unit', () => {
  it.each(MODELS)('%s: alone and at a word’s end kept, not reported', (_m, o) => {
    for (const t of ['ℓ', '5ℓ', 'kℓ', 'mℓ', '10㎏', '25℃', '5 ㎡']) {
      expect(norm(t, o)).toBe(t);
      expect(calls(t, o)).toEqual([]);
    }
  });
  it.each(MODELS)('%s: at a word’s start or middle it follows and is reported', (_m, o) => {
    for (const [t, out] of [
      ['aℓl', 'all'],
      ['ℓogin', 'login'],
      ['a㎏b', 'akgb'],
    ]) {
      expect(norm(t!, o)).toBe(out);
      expect(calls(t!, o)).toEqual([[t, out, { signals: [], converted: true, toLang: 'English' }]]);
    }
  });
  it('a unit before a tail mark stays in place (mℓ®)', () => {
    expect(norm('mℓ®', L)).toBe('mℓ®');
    expect(norm('mℓ®', A)).toBe('mℓ®');
  });
});

describe('decision 30b category 7: word sign', () => {
  it.each(MODELS)('%s: always replaced into English', (_m, o) => {
    expect(norm('℡', o)).toBe('TEL');
    expect(norm('call ℻ 123', o)).toBe('call FAX 123');
  });
  it.each(MODELS)('%s: no spoof next to a separator or a digit', (_m, o) => {
    for (const t of ['℡', '℡5551234', '(℡)']) expect(spoof(t, o)).toBe(false);
  });
  it('alphabet model: no spoof next to a letter of a script written without spaces', () => {
    expect(spoof('電話℡')).toBe(false);
  });
  it.each(MODELS)('%s: a spoof touching anything else', (_m, o) => {
    for (const t of ['a℡', '℡x', 'ab℻cd']) expect(spoof(t, o)).toBe(true);
  });
});

describe('decision 30c: superscripts, subscripts, ordinals, modifier letters stay', () => {
  it.each(MODELS)('%s', (_m, o) => {
    for (const t of ['xᵢ', '1º', '10ⁿ', 'nª', 'kʰ']) {
      expect(norm(t, o)).toBe(t);
      expect(calls(t, o)).toEqual([]);
    }
  });
});

describe('decision 30g: no math detection; strict converts math letters', () => {
  it('lenient: no neutral dictionary unless asked', () => {
    expect(analyze('𝐈 ℝ').normalized).toBe(analyze('𝐈 ℝ', {}).normalized);
    expect(analyze('ℝ', { neutralAlphabet: true }).normalized).toBe('R');
  });
});

describe('decision 30h: math switches', () => {
  const K = { ...A, keepMathLetters: true };
  it('switch 1: math letters stay as written; words of math letters (and Greek) are not judged', () => {
    for (const t of ['ℎν', '𝑘𝑇𝜈', '𝐈', 'ℝ', 'ϕ']) {
      const r = analyze(t, K);
      expect(r.normalized).toBe(t);
      expect(r.spoofed).toBe(false);
      expect(calls(t, K)).toEqual([]);
    }
    expect(analyze('ℎν', { ...L, keepMathLetters: true }).normalized).toBe('ℎν');
    expect(norm('cosϕ', K)).toBe('cosϕ');
  });
  it('switch 1: a kept math letter does not switch judging off for its word', () => {
    expect(analyze('рay𝐩al', K).spoofed).toBe(true);
    expect(analyze('pаypal𝐱', K).spoofed).toBe(true);
  });
  it('switch 2: the invisible math operators get a rule of their own', () => {
    const t = 'f⁡(x) a⁢b';
    expect(norm(t)).toBe('f(x) ab');
    const kinds: string[] = [];
    const keep = analyze(
      t,
      { ...A, hiddenCharRules: { invisibleMathOperators: 'keep' } },
      { onReport: (m) => void kinds.push(m.kind) },
    );
    expect(keep.normalized).toBe(t);
    expect(kinds).toEqual(['invisibleMathOperators', 'invisibleMathOperators']);
    expect(
      cleanHidden(t, { ...STRICT_HIDDEN_RULES, invisibleMathOperators: 'remove-counted' }),
    ).toBe('f(x) ab');
    // U+2065 is no operator: still otherInvisibles.
    expect(cleanHidden('a⁥b', { ...STRICT_HIDDEN_RULES, invisibleMathOperators: 'keep' })).toBe(
      'ab',
    );
  });
  it('switch 2 values are checked like any rule', () => {
    expect(() =>
      analyze('a', { ...A, hiddenCharRules: { invisibleMathOperators: 'drop' as never } }),
    ).toThrow(RangeError);
  });
});

describe('decision 32a: standalone conversion is the character’s own property', () => {
  it('defaults by category', () => {
    const alone = (ch: string) => neutralInfo(ch.codePointAt(0)!)!.standalone;
    expect(['ⓐ', 'Ｐ', 'ℓ', '㎏', '©', '№'].map(alone)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(['𝐈', 'Ⅳ', '℡'].map(alone)).toEqual([true, true, true]);
  });
});

describe('canonical duplicates are their letters (kelvin, ångström, ohm signs)', () => {
  it.each(MODELS)('%s: p⟨kelvin⟩ypal is flagged', (_m, o) => {
    expect(spoof('pKypal', o)).toBe(true);
  });
  it('alphabet model: read as the letter', () => {
    expect(norm('pKypal')).toBe('pKypal');
  });
});

describe('a word is classified once and rebuilt by position', () => {
  it.each(MODELS)('%s: marks and apostrophes stay with their character', (_m, o) => {
    for (const [t, out] of [
      ['cafｅ\u0301', 'cafe\u0301'],
      ['aⓑ\u0301c', 'ab\u0301c'],
      ["rock'ⓝ'roll", "rock'n'roll"],
      ['d𝑥̂', 'dx̂'],
      ['m𝐯⃗', 'mv⃗'],
    ])
      expect(norm(t!, o)).toBe(out);
  });
  it('alphabet model: a foreign letter keeps its apostrophe', () => {
    expect(norm("a東's")).toBe("a東's");
  });
});

describe('a letter outside the model and the dictionary is kept, the word judged', () => {
  it('pаypal with a trailing Common letter is still folded and flagged', () => {
    for (const t of ['pаypalـ', 'pаypalー', 'pаypalℏ', 'pаypalℹ']) {
      const r = analyze(t, A);
      expect(r.spoofed, t).toBe(true);
      expect(r.normalized.startsWith('paypal'), t).toBe(true);
    }
  });
});

describe('decision 39: one per-script table, independent properties', () => {
  it('spaceless and the UTS #39 sets are separate categories', () => {
    expect(scriptsWith('spaceless').sort()).toEqual(
      ['Han', 'Hiragana', 'Katakana', 'Khmer', 'Lao', 'Myanmar', 'Thai', 'Tibetan'].sort(),
    );
    expect(isSpaceless('Thai') && isRecommended('Thai')).toBe(true);
    expect(isSpaceless('Hangul')).toBe(false);
    expect(isRecommended('Hangul')).toBe(true);
    expect(HIGHLY_RESTRICTIVE.some((s) => s.has('Hangul'))).toBe(true);
  });
  it('the word-break hint reads spaceless', () => {
    const kinds: string[] = [];
    cleanHidden('ภาษา​ไทย', STRICT_HIDDEN_RULES, { onReport: (m) => void kinds.push(m.kind) });
    expect(kinds).toEqual(['wordBreakHint']);
  });
});

describe('decision 31: a word of neutral letters only has an alphabet', () => {
  it('ⓐⓑ under the alphabet model is Latin', () => {
    expect(calls('x ⓐⓑ y')).toEqual([
      ['ⓐⓑ', 'ab', { signals: [], converted: true, toLang: 'English' }],
    ]);
  });
});
