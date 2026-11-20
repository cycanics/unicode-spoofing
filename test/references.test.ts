/**
 * Decision 41o: HTML character references in strict `analyze` (language model).
 * The rule is an equivalence: a reference behaves like the raw character it encodes. The
 * property test checks it on generated inputs; the rest are the decided specifics (the
 * reference report, the output as written, the no-`;` rule and its switch, numeric parsing,
 * and the one decided difference: a word of references only is no clean neighbour).
 */
import { describe, expect, it, vi } from 'vitest';
import { analyze, type AnalyzeOptions } from '../src';

const A: AnalyzeOptions = { hiddenChars: 'strict', confusionModel: 'language' };
const ENRU: AnalyzeOptions = { ...A, targetLanguages: ['English', 'Russian'] };

/** A few named references (with `;`), by character. */
const NAMED: Record<string, string> = {
  '­': 'shy',
  '‍': 'zwj',
  '‌': 'zwnj',
  '‎': 'lrm',
  '‏': 'rlm',
  '©': 'copy',
  '®': 'reg',
  '™': 'trade',
  ' ': 'nbsp',
  '—': 'mdash',
  ο: 'omicron',
  α: 'alpha',
  '−': 'minus',
  '\n': 'NewLine',
  '⁢': 'InvisibleTimes',
};

/** Characters: the hidden-character classes, look-alikes, neutrals, digits, dashes, mojibake bytes, separators. */
const CHARS = [
  ...'­͏؜ᅟ឴឵᠋᠎​‌‍‎‏',
  ...'‪‫‬‭‮⁠⁢⁦⁧⁩⠀ㅤ️﻿ﾠ',
  '\u{e0100}',
  '\u{e01ef}',
  '\u{1d173}',
  '\u{110b1}',
  ...'\u0007\u008f\u0085 \n ',
  ...'аоерсхіјнк',
  ...'οαρνκ',
  ...'жпщ',
  ...'০৪١۱०',
  ...'©®™№℠ⓐⅰ',
  '𝐚',
  '𝛼',
  ...'-‐–—_x×',
  ...'âÐÑ€™Ÿ',
  ...'קعپ',
];

/** Host texts; `{}` is where the character goes. */
const HOSTS = [
  'pay{}pal now',
  'the c{}onstant here',
  'read the {} word',
  'line one\n{}word two',
  'Hello{}world again',
  'donâ€{}t worry',
  'Ñ{}Ð·Ñ‹Ðº и ÐŸÑ€Ð¸Ð²ÐµÑ‚',
  'abc{}def ghi',
  'abc‮def{}ghi end',
  'שלום {}abc עולם',
  'size 10{}10 cm',
  'mixtral{}8x22b today',
  'Acme{}inc',
  'Пр{}ивет мир',
  'is{}​admin',
];

const forms = (ch: string, next: string): string[] => {
  const cp = ch.codePointAt(0)!;
  // HTML reads numeric 80–9F as Windows-1252 (its five gaps as the control itself).
  if (cp >= 0x80 && cp <= 0x9f && ![0x81, 0x8d, 0x8f, 0x90, 0x9d].includes(cp)) return [];
  const f = [`&#${cp};`, `&#x${cp.toString(16)};`, `&#00000${cp};`];
  if (NAMED[ch]) f.push(`&${NAMED[ch]};`);
  // Without `;` only where the next character cannot extend it.
  if (!/[0-9]/.test(next)) f.push(`&#${cp}`);
  return f;
};

interface Seen {
  spoofed: boolean;
  out: string;
  reports: string[];
  words: string[];
}

const seen = (t: string, o: AnalyzeOptions, back: (s: string) => string): Seen => {
  const reports: string[] = [];
  const words: string[] = [];
  const r = analyze(t, o, {
    onReport: (m) => {
      if (m.kind !== 'htmlReference') reports.push(`${m.kind}:${back(m.extracted ?? '∅')}`);
    },
    onWord: (_s, _e, cleaned, replacement, reason) =>
      void words.push(`${back(cleaned)}→${back(replacement)}${JSON.stringify(reason)}`),
  });
  return { spoofed: r.spoofed, out: back(r.normalized), reports, words };
};

describe('41o: a reference behaves like its raw character', () => {
  for (const [name, o] of [
    ['default targets', A],
    ['English and Russian', ENRU],
  ] as const)
    it(`every form, every character, every host (${name})`, () => {
      const bad: string[] = [];
      let n = 0;
      for (const host of HOSTS)
        for (const ch of CHARS) {
          const [pre, post] = host.split('{}') as [string, string];
          const raw = seen(pre + ch + post, o, (s) => s);
          for (const ref of forms(ch, post[0] ?? '')) {
            n++;
            const got = seen(pre + ref + post, o, (s) => s.split(ref).join(ch));
            if (JSON.stringify(got) !== JSON.stringify(raw))
              bad.push(
                `${JSON.stringify(pre + ref + post)}\n  raw ${JSON.stringify(raw)}\n  ref ${JSON.stringify(got)}`,
              );
          }
        }
      expect(n).toBeGreaterThan(3000);
      expect(bad.slice(0, 5).join('\n')).toBe('');
    }, 60_000);
});

describe('41o: decided specifics', () => {
  const run = (t: string, o: AnalyzeOptions = A) => {
    const reports: string[] = [];
    const r = analyze(t, o, {
      onReport: (m) =>
        void reports.push(`${m.kind}:${m.extracted ?? 'null'}@${m.start}+${m.length}`),
    });
    return { out: r.normalized, spoofed: r.spoofed, reports };
  };
  it('every reference is reported, `extracted` as written; others report the input as written', () => {
    expect(run('a p&#1072;ypal').reports).toEqual(['htmlReference:&#1072;@3+7']);
    expect(run('abc&#8203;def').reports).toEqual([
      'htmlReference:&#8203;@3+7',
      'zeroWidthInWord:&#8203;@3+7',
    ]);
    expect(run('is​&#8203;admin').reports).toContain('zeroWidthRun:​&#8203;@2+8');
  });
  it('the output keeps a reference as written unless its character changed', () => {
    expect(run('p&#1072;ypal now').out).toBe('paypal now');
    expect(run('C&#1087;росите').out).toBe('С&#1087;росите');
    expect(run('уда&#1088;éние').out).toBe('уда&#1088;е́ние');
    expect(run('pа́yp&#97;l').out).toBe('páyp&#97;l');
    expect(run('Hello&lt;сор&gt;world').out).toBe('Hello&lt;cop&gt;world');
  });
  it('a reference without `;` is written decoded where what follows in the output would extend it', () => {
    expect(run('a&copy­x').out).toBe('a©x');
    expect(run('1&#1072­5').out).toBe('1а5');
    expect(run('x &copy text').out).toBe('x &copy text');
  });
  it('numeric references: leading zeros, U+FFFD past U+10FFFF and for zero, 80–9F as Windows-1252', () => {
    expect(run('c&#000000001086;nstant').out).toBe('constant');
    expect(run('c&#x0000043e;nstant').out).toBe('constant');
    expect(run('a&#1114112;b').reports[0]).toBe('htmlReference:&#1114112;@1+10');
    expect(run('don&#226;&#8364;&#8482;t').reports).toContain('mojibake:’@3+20');
  });
  it('a legacy name without `;` before `=`, a letter or a digit of any script is text', () => {
    for (const t of [
      '?a=1&section=1',
      '&regionCode=mde',
      '&copy8x22b',
      '&ampx',
      '&lt=3',
      'a&copyжурнал',
      '&copyé 2026',
      'x&amp٣',
    ])
      expect(run(t).reports, t).toEqual([]);
    expect(run('x &copy text').reports).toEqual(['htmlReference:&copy@2+5']);
  });
  it("htmlNamedReferences 'strict': names only with `;`; numeric references either way", () => {
    const S: AnalyzeOptions = { ...A, htmlNamedReferences: 'strict' };
    expect(run('x &copy text', S).reports).toEqual([]);
    expect(run('Hello&lt;сор&gt;world', S).out).toBe('Hello&lt;cop&gt;world');
    expect(run('p&#1072ypal', S).out).toBe('paypal');
    expect(() => analyze('x', { ...A, htmlNamedReferences: 'no' as never })).toThrow(RangeError);
  });
  it('the decided difference: a word of references only is no clean neighbour', () => {
    expect(run('Please read the ВООК &#1076;&#1088;&#1091;&#1075;').out).toBe(
      'Please read the BOOK &#1076;&#1088;&#1091;&#1075;',
    );
    expect(run('Please read the ВООК друг').out).toBe('Please read the ВООК друг');
  });
});

describe('41o with decision 9: records join to the output', () => {
  it('a reference without `;` before a removal is written decoded when what follows extends it', () => {
    for (const [t, out] of [
      ['&#1072­5', 'а5'],
      ['x&amp­y', 'x&y'],
      ['a&copy­x', 'a©x'],
    ]) {
      const recs: string[] = [];
      const r = analyze(t!, A, { onRecord: (x) => void recs.push(x.text) });
      expect([recs.join(''), r.normalized], t).toEqual([out, out]);
    }
  });
  it('a `;` after a removal never ends a reference without `;` (it reads as text)', () => {
    for (const [t, out] of [
      ['&#1072\u00ad;', 'а;'],
      ['&#x430\u00ad; ok', 'а; ok'],
      ['x&amp\u00ad;y', 'x&;y'],
      ['&not\u00ad;', '¬;'],
      ['a&lt\u200b;b', 'a<;b'],
      ['&#1072\u0007;', 'а;'],
    ]) {
      const recs: string[] = [];
      const r = analyze(t!, A, { onRecord: (x) => void recs.push(x.text) });
      expect([recs.join(''), r.normalized], t).toEqual([out, out]);
    }
  });
  it('references without `;` in a row: one written decoded decodes those it would extend', () => {
    for (const [t, out, norm] of [
      ['&copy&#x35\u001b[0mbi', '©5bi'],
      ['&not&#x430\u200bb', '¬аb'],
      ['x&amp&#1072\u00ad5', 'x&а5'],
      // The word is rewritten in the output, its references decoded; the records keep them.
      ['&#53&#x35\u001b[0m&#x35i&shy;\u00adi', '&#53&#x35&#x35ii', '555ii'],
      ['&#1072&#x35\u001b[0m&#x35\u00ad5b', 'а555b'],
      ['a &copy&#x35\u00adx', 'a &copy&#x35x'],
    ]) {
      const recs: string[] = [];
      const r = analyze(t!, A, { onRecord: (x) => void recs.push(x.text) });
      expect([recs.join(''), r.normalized], t).toEqual([out, norm ?? out]);
    }
  });
  it('records go out in order, once each, the held ones at the end', () => {
    const recs: { start: number; length: number; text: string }[] = [];
    analyze('a&copy\u00adx &#1072', A, { onRecord: (x) => void recs.push({ ...x }) });
    expect(recs.map((x) => x.text).join('')).toBe('a©x &#1072');
    for (let k = 1; k < recs.length; k++)
      expect(recs[k]!.start).toBe(recs[k - 1]!.start + recs[k - 1]!.length);
  });
  it('the caller’s record callback is called, nothing else of it', () => {
    const flush = vi.fn();
    for (const [t, o] of [
      ['plain text', A],
      ['a &copy x', A],
      ['plain text', {}],
    ] as [string, AnalyzeOptions][]) {
      const recs: string[] = [];
      analyze(t, o, {
        onRecord: Object.assign((x: { text: string }) => void recs.push(x.text), { flush }),
      });
      expect(recs.join(''), t).toBe(t);
    }
    expect(flush).not.toHaveBeenCalled();
  });
  it('after a name without `;`, a letter, mark or number of any script makes it text', () => {
    for (const t of ['&copy² x', 'x&copý y', 'a&amp٣']) expect(analyze(t, A).normalized, t).toBe(t);
  });
});
