/**
 * Terminal controls (§16, §17.6), ported from `feat/terminal-controls` onto the
 * streaming core with the §16.1 decisions: concealed and same-colour text is
 * removed (and reported), backspace erases what it backs over.
 */
import { describe, it, expect } from 'vitest';
import {
  analyze,
  cleanHidden,
  cleanTerminal,
  STRICT_HIDDEN_RULES,
  TERMINAL_RULES,
  type CleanupCallbacks,
  type HiddenCharRules,
  type LostBound,
  type Mark,
  type OutputRecord,
  type Region,
  type TerminalClass,
  type TerminalRules,
} from '../src';
import { growth, LINEAR, timed } from './helpers/growth';

const E = '\u001b';
interface Run {
  cleaned: string;
  marks: Mark[];
  regions: Region[];
  records: OutputRecord[];
}
const collect = (run: (cb: object) => string): Run => {
  const marks: Mark[] = [];
  const regions: Region[] = [];
  const records: OutputRecord[] = [];
  const cleaned = run({
    onReport: (m: Mark) => void marks.push(m),
    onCleanup: (r: Region) => void regions.push(r),
    onRecord: (r: OutputRecord) => void records.push(r),
  });
  return { cleaned, marks, regions, records };
};
/** `cleanTerminal` with every report call, region and output record collected. */
const term = (text: string, rules: Partial<TerminalRules> = {}) =>
  collect((cb) => cleanTerminal(text, rules, cb));
/** `cleanHidden` with every report call, region and output record collected. */
const hidden = (text: string, rules: Readonly<HiddenCharRules> = STRICT_HIDDEN_RULES) =>
  collect((cb) => cleanHidden(text, rules, cb));
const kinds = (text: string, rules: Partial<TerminalRules> = {}) =>
  term(text, rules).marks.map((m) => m.kind);
const spans = (r: readonly { start: number; length: number }[]) =>
  r.map((x) => [x.start, x.length]);
/** A consumer's counter (D17, D17a): report counts summed by kind. */
const countByKind = (marks: readonly Mark[]) => {
  const n: Record<string, number> = {};
  for (const m of marks) n[m.kind] = (n[m.kind] ?? 0) + m.count;
  return n;
};
/** Strict `analyze` with the terminal layer: [index, word, signals] of its findings. */
const words = (text: string, rules: Partial<TerminalRules> = {}, more = {}) =>
  analyze(text, { hiddenChars: 'strict', hiddenCharRules: { terminal: rules, ...more } }).words.map(
    (w) => [w.index, w.word, w.signals],
  );
/** The records cover the input in order and rebuild the cleaned text. */
const rebuilds = (input: string, r: Run) => {
  let at = 0;
  for (const rec of r.records) {
    expect(rec.start).toBe(at);
    at += rec.length;
  }
  expect(at).toBe(input.length);
  expect(r.records.map((rec) => rec.text).join('')).toBe(r.cleaned);
};
/** Kinds the default rules do not count: 'remove-silent' rules and bare CR's report mode. */
const UNCOUNTED = new Set(
  Object.entries(TERMINAL_RULES)
    .filter(([, v]) => v === 'remove-silent')
    .map(([k]) => k)
    .concat('bareCR'),
);

describe('cleanTerminal: the §16 constructs', () => {
  it.each<[string, string, string, TerminalClass[]]>([
    ['cursor back', `secret${E}[6Dcover!`, 'secretcover!', ['cursorMove']],
    ['erase line', `secret${E}[2Kshown`, 'secretshown', ['erase']],
    ['cursor up', `secret\n${E}[1Ashown`, 'secret\nshown', ['cursorMove']],
    ['erase screen', `secret${E}[2Jshown`, 'secretshown', ['erase']],
    ['erase line start', `secret${E}[1K`, 'secret', ['erase']],
    ['delete line', `secret${E}[M`, 'secret', ['erase']],
    ['conceal', `${E}[8msecret${E}[0m`, '', ['sgrConceal', 'terminalConcealed', 'sgr']],
    [
      'conceal in a list',
      `${E}[1;8msecret${E}[28m`,
      '',
      ['sgrConceal', 'terminalConcealed', 'sgr'],
    ],
    [
      'black on black',
      `${E}[30;40msecret${E}[0m`,
      '',
      ['sgrSameColor', 'terminalConcealed', 'sgr'],
    ],
    [
      'same colour in two sequences',
      `${E}[37m${E}[47msecret`,
      '',
      ['sgr', 'sgrSameColor', 'terminalConcealed'],
    ],
    ['bright pair', `${E}[97;107msecret`, '', ['sgrSameColor', 'terminalConcealed']],
    ['256 colours', `${E}[38;5;196;48;5;196msecret`, '', ['sgrSameColor', 'terminalConcealed']],
    ['true colour', `${E}[38;2;1;2;3;48;2;1;2;3msecret`, '', ['sgrSameColor', 'terminalConcealed']],
    [
      'colon form',
      `${E}[38:2::9:9:9m${E}[48:2::9:9:9msecret`,
      '',
      ['sgr', 'sgrSameColor', 'terminalConcealed'],
    ],
    [
      'basic = palette 0–15',
      `${E}[38;5;1m${E}[41msecret`,
      '',
      ['sgr', 'sgrSameColor', 'terminalConcealed'],
    ],
    ['palette is never RGB', `${E}[38;5;16;48;2;0;0;0msecret`, 'secret', ['sgr']],
    ['different colours', `${E}[31;40msecret`, 'secret', ['sgr']],
    ['save and restore', `${E}7secret${E}8cover`, 'secretcover', ['cursorMove', 'cursorMove']],
    ['reverse index', `secret${E}M`, 'secret', ['cursorMove']],
    ['reset', `secret${E}c`, 'secret', ['reset']],
    ['soft reset', `secret${E}[!p`, 'secret', ['reset']],
    ['OSC to BEL', `a${E}]0;secret\u0007b`, 'ab', ['stringSequence']],
    ['OSC to ST', `a${E}]0;secret${E}\\b`, 'ab', ['stringSequence']],
    ['DCS', `a${E}Psecret${E}\\b`, 'ab', ['stringSequence']],
    ['APC', `a${E}_secret${E}\\b`, 'ab', ['stringSequence']],
    ['PM', `a${E}^secret${E}\\b`, 'ab', ['stringSequence']],
    ['SOS', `a${E}Xsecret${E}\\b`, 'ab', ['stringSequence']],
    ['unterminated string: to the end', `a${E}]0;secret and the rest`, 'a', ['stringSequence']],
    [
      'unterminated string: to the end of its line',
      `a${E}]0;secret\nnext line`,
      'a\nnext line',
      ['stringSequence'],
    ],
    ['CAN aborts a string', `a${E}]0;x\u0018b`, 'ab', ['stringSequence']],
    ['CAN aborts a CSI', `a${E}[3\u00181mb`, 'a1mb', ['otherSequence']],
    // D7a: a C0 inside a CSI is executed (kept) and the CSI goes on: one SGR in two pieces.
    ['a C0 inside a CSI is executed', `a${E}[3\u00011mb`, 'a\u0001b', ['sgr', 'sgr']],
    [
      'generic escape (tput sgr0)',
      `a${E}(B${E}[m b${E}=`,
      'a b',
      ['otherSequence', 'sgr', 'otherSequence'],
    ],
    ['another ESC ends a string', `${E}]0;t${E}[31mred`, 'red', ['stringSequence', 'sgr']],
    ['C1 CSI', `a\u009b2Kb`, 'ab', ['erase']],
    ['backspace', 'norml\bal', 'normal', ['backspace']],
    [
      'overstrike',
      'b\bbo\bol\bld\bd',
      'bold',
      ['backspace', 'backspace', 'backspace', 'backspace'],
    ],
    ['private mode', `${E}[?25l${E}[?2004hx`, 'x', ['otherSequence', 'otherSequence']],
    ['alternate screen', `${E}[?1049hsecret${E}[?1049l`, 'secret', ['erase', 'erase']],
    ['DECALN', `secret${E}#8`, 'secret', ['erase']],
  ])('%s', (_n, input, cleaned, want) => {
    const r = term(input);
    expect(r.cleaned).toBe(cleaned);
    expect(r.marks.map((m) => m.kind)).toEqual(want);
    rebuilds(input, r);
  });

  it('reports kind, offsets and counts', () => {
    const input = `ok secret${E}[6Dcover ${E}[1mbold${E}[0m`;
    const r = term(input);
    expect(r.marks).toEqual([
      { kind: 'cursorMove', start: 9, length: 4, extracted: null, count: 1 },
      { kind: 'sgr', start: 19, length: 4, extracted: null, count: 1 },
      { kind: 'sgr', start: 27, length: 4, extracted: null, count: 1 },
    ]);
    expect(spans(r.regions)).toEqual([
      [9, 4],
      [19, 4],
      [27, 4],
    ]);
    // Strict analyze lists each counted sequence (decisions 7b, 7c); formatting here is silent (explicit rules).
    expect(words(input)).toEqual([[9, `${E}[6D`, ['illegal']]]);
  });

  it('each sequence is a finding of its own, a string with spaces too (7b, 7c)', () => {
    expect(words(`a ${E}[2J b`)).toEqual([[2, `${E}[2J`, ['illegal']]]);
    expect(words(`x${E}]0;my title\u0007y z`)).toEqual([[1, `${E}]0;my title\u0007`, ['illegal']]]);
  });

  it('erasing ahead of the cursor is silent: only a move back makes it hide', () => {
    for (const s of [`${E}[K`, `${E}[0K`, `${E}[J`, `${E}[3X`, `${E}[2P`, `${E}[4@`]) {
      expect(kinds(`text${s}`)).toEqual(['eraseAhead']);
      expect(words(`text${s}`)).toEqual([]);
    }
    expect(kinds(`secret${E}[6D${E}[K`)).toEqual(['cursorMove', 'eraseAhead']);
    expect(words(`secret${E}[6D${E}[K`)).toHaveLength(1);
  });

  it('malformed and lone escapes go silently', () => {
    expect(kinds(`a${E}`)).toEqual(['otherSequence']);
    expect(kinds(`a${E}[12`)).toEqual(['otherSequence']);
    // D7a: a non-ASCII character inside a CSI is consumed with the ignored sequence.
    expect(cleanTerminal(`a${E}[1\u00E9b`)).toBe('ab');
    expect(kinds(`a${E}[1\u00E9b`)).toEqual(['otherSequence']);
    expect(kinds(`a${E}${E}[2Kb`)).toEqual(['otherSequence', 'erase']);
  });

  it('per-class rules', () => {
    const t = `${E}[31mred${E}[0m ${E}[2K`;
    // 'keep' = report mode: kept, still reported.
    const sgrKept = term(t, { sgr: 'keep' });
    expect(sgrKept.cleaned).toBe(`${E}[31mred${E}[0m `);
    expect(sgrKept.marks.map((m) => m.kind)).toEqual(['sgr', 'sgr', 'erase']);
    expect(spans(sgrKept.regions)).toEqual([[13, 4]]);
    // 'remove-counted' and 'remove-silent' report alike (D17a).
    expect(countByKind(term(t, { sgr: 'remove-counted' }).marks)).toEqual({ sgr: 2, erase: 1 });
    const kept = term(t, { erase: 'keep' });
    expect(kept.cleaned).toBe(`red ${E}[2K`);
    expect(kept.marks[2]).toEqual({
      kind: 'erase',
      start: 13,
      length: 4,
      extracted: null,
      count: 1,
    });
    expect(spans(kept.regions)).toEqual([
      [0, 5],
      [8, 4],
    ]);
  });

  it('a kept sequence is no finding in strict analyze, listening or not', () => {
    const t = `${E}[31mred${E}[0m ${E}[2K`;
    const r = analyze(t, {
      hiddenChars: 'strict',
      hiddenCharRules: { terminal: { erase: 'keep' } },
    });
    expect(r.words).toEqual([]);
    expect(r.normalized).toBe(`red ${E}[2K`);
  });

  it('string bodies and concealed spans are extracted', () => {
    const r = term(`a${E}]0;title\u0007 ${E}[8mhidden words${E}[0m shown ${E}_x`);
    expect(r.marks.filter((m) => m.extracted !== null)).toEqual([
      { kind: 'stringSequence', start: 1, length: 10, extracted: '0;title', count: 1 },
      { kind: 'terminalConcealed', start: 16, length: 12, extracted: 'hidden words', count: 1 },
      // Unterminated: cut at the end of its line.
      { kind: 'stringSequence', start: 39, length: 3, extracted: 'x', count: 1 },
    ]);
    expect(r.cleaned).toBe('a shown '); // the seam rule keeps one space
  });

  it("stringSequence 'remove-counted' leaves the body as text", () => {
    const r = term(`a${E}]0;title\u0007b`, { stringSequence: 'remove-counted' });
    expect(r.cleaned).toBe('a0;titleb');
    expect(r.marks.filter((m) => m.extracted !== null)).toEqual([
      { kind: 'stringSequence', start: 1, length: 2, extracted: '0;title', count: 1 },
    ]);
    // Opener and terminator go; the body stays.
    expect(spans(r.regions)).toEqual([
      [1, 2],
      [10, 1],
    ]);
  });

  it('same colour until a colour changes', () => {
    const r = term(`${E}[30;40mhidden${E}[31mshown`);
    expect(r.marks.filter((m) => m.extracted !== null)).toMatchObject([
      { kind: 'terminalConcealed', extracted: 'hidden' },
    ]);
  });

  it('literal spellings in documentation are text', () => {
    const t = 'use \\x1b[31m or ^[[31m or ESC [ 3 1 m';
    const r = term(t);
    expect(r.cleaned).toBe(t);
    expect(r.marks).toEqual([]);
  });

  it('cp1252 › read as Latin-1 is no CSI', () => {
    expect(cleanTerminal('Home \u009B Products \u009BWidgets')).toBe(
      'Home \u009B Products \u009BWidgets',
    );
    expect(cleanHidden('Home \u009B Products', { ...STRICT_HIDDEN_RULES, terminal: {} })).toBe(
      'Home Products',
    ); // the seam rule keeps one space
  });

  it('IND and NEL are line breaks', () => {
    expect(cleanTerminal(`a${E}Db${E}Ec`)).toBe('a\nb\nc');
  });
});

describe('cleanTerminal: bare CR (decision 25a: a lone CR is a line break)', () => {
  it('CRLF, CR CR LF and a final CR are line endings, never reported', () => {
    for (const t of ['a\r\nb\r\n', 'a\r\r\nb', 'a\r', `a\r${E}[K\nb`]) {
      for (const bareCR of ['keep', 'report', 'newline'] as const) {
        const r = term(t, { bareCR });
        expect(r.marks.filter((m) => m.kind === 'bareCR')).toEqual([]);
        expect(r.cleaned).toBe(t.replace(`${E}[K`, ''));
      }
    }
  });

  it("'keep' (default): left as written, reported, not counted; nothing is overwritten", () => {
    const r = term('50%\r100%\n');
    expect(r.cleaned).toBe('50%\r100%\n');
    expect(r.marks).toEqual([{ kind: 'bareCR', start: 3, length: 1, extracted: null, count: 0 }]);
    expect(words('50%\r100%\n')).toEqual([]);
    expect(cleanTerminal('safe\rrm -rf ~')).toBe('safe\rrm -rf ~');
    expect(cleanTerminal('line one\rline two\rline three\r')).toBe(
      'line one\rline two\rline three\r',
    );
  });

  it("'report': as 'keep'; 'newline': becomes LF, silent; removed values are rejected", () => {
    expect(cleanTerminal('secret\rcover\n', { bareCR: 'report' })).toBe('secret\rcover\n');
    const nl = term('secret\r\rcover', { bareCR: 'newline' });
    expect(nl.cleaned).toBe('secret\ncover');
    expect(countByKind(nl.marks)).toEqual({ bareCR: 0 });
    expect(() => cleanTerminal('a', { bareCR: 'newline-counted' as never })).toThrow(RangeError);
    expect(() => cleanTerminal('a', { bareCR: 'overwrite' as never })).toThrow(RangeError);
  });

  it('a lone CR is a line end for backspace erase (decision 25)', () => {
    expect(cleanTerminal('abc\r\bX')).toBe('abc\rX');
    expect(cleanTerminal('ab\bc\rd')).toBe('ac\rd');
  });

  it('a lone CR is a line break for the word phase, strict included', () => {
    const r = analyze('safe\rp\u0430ypal now', {
      hiddenChars: 'strict',
      confusionModel: 'language',
    });
    expect(r.normalized).toBe('safe\rpaypal now');
  });
});

describe('cleanTerminal: real-world output is not flagged by default', () => {
  it.each([
    [
      'single-line progress bar (CR + EL 0, cursor hidden)',
      `${E}[?25lDownloading  10%\r${E}[KDownloading  55%\r${E}[KDownloading 100%\n${E}[?25h`,
      'Downloading  10%\rDownloading  55%\rDownloading 100%\n',
    ],
    ['pip-style CR progress', ' 10%|#         |\r 50%|#####     |\r100%|##########|\n', null],
    [
      'coloured log',
      `${E}[32mINFO${E}[0m server started\n${E}[1;31mERROR${E}[m disk ${E}[38;5;208mfull${E}[39m\n`,
      'INFO server started\nERROR disk full\n',
    ],
    ['tput sgr0', `${E}[1mbold${E}(B${E}[m plain`, 'bold plain'],
    [
      'coloured Windows text',
      `${E}[33mline one${E}[0m\r\nline two\r\n`,
      'line one\r\nline two\r\n',
    ],
    [
      'git diff colours',
      `${E}[1mdiff --git a/x b/x${E}[m\n${E}[31m-old${E}[m\n${E}[32m+new${E}[m`,
      null,
    ],
    ['hyperlink-free plain text', 'nothing here\r\nat all\n', null],
  ])('%s', (_n, input, cleaned) => {
    const r = term(input);
    expect(words(input)).toEqual([]);
    expect(r.marks.filter((m) => !UNCOUNTED.has(m.kind))).toEqual([]);
    if (cleaned !== null) expect(r.cleaned).toBe(cleaned);
    rebuilds(input, r);
  });

  it('a multi-line progress display moves the cursor up: counted', () => {
    const t = `a  10%\nb  20%\n${E}[2A${E}[Ka  60%\n${E}[Kb  70%\n`;
    expect(
      term(t)
        .marks.filter((m) => !UNCOUNTED.has(m.kind))
        .map((m) => m.kind),
    ).toEqual(['cursorMove']);
  });

  it('many unterminated openers', () => {
    expect(cleanTerminal(`${E}]x`.repeat(1000))).toBe('');
  });
  timed(
    'linear on many unterminated openers',
    () => {
      expect(growth((n) => cleanTerminal(`${E}]x`.repeat(n)), 20_000)).toBeLessThan(LINEAR);
    },
    30_000,
  );

  it('many sequences', () => {
    expect(cleanTerminal(`${E}[31mx${E}[0m\r`.repeat(1000))).toBe('x\r'.repeat(1000));
  });
  timed(
    'linear on many sequences',
    () => {
      expect(growth((n) => cleanTerminal(`${E}[31mx${E}[0m\r`.repeat(n)), 20_000)).toBeLessThan(
        LINEAR,
      );
    },
    30_000,
  );

  it('defaults are TERMINAL_RULES', () => {
    const t = `${E}[31mx${E}[2K\ry`;
    expect(term(t)).toEqual(term(t, TERMINAL_RULES));
  });
});

describe('cleanHidden with rules.terminal', () => {
  const T = { ...STRICT_HIDDEN_RULES, terminal: {} };

  it('off by default: only ESC and BEL of a string sequence go', () => {
    const r = hidden(`a${E}]0;word\u0007b ${E}7c${E}8`);
    expect(r.cleaned).toBe('a]0;wordb 7c8');
    expect(r.marks.map((m) => m.kind)).toEqual([
      'controlChars',
      'controlChars',
      'controlChars',
      'controlChars',
    ]);
  });

  it('on: sequences go whole, by kind', () => {
    const input = `a${E}]0;word\u0007b ${E}7c${E}8 ${E}[1mbold${E}[0m`;
    const r = hidden(input, T);
    expect(r.cleaned).toBe('ab c bold');
    expect(r.marks.map((m) => m.kind)).toEqual([
      'stringSequence',
      'cursorMove',
      'cursorMove',
      'sgr',
      'sgr',
    ]);
    expect(r.marks[0]).toMatchObject({ start: 1, extracted: '0;word' });
    expect(words(input).map(([i]) => i)).toEqual([1, 12, 15]);
    rebuilds(input, r);
  });

  it('a word with a hidden character and a sequence: the word and the sequence', () => {
    const input = `fr\u200Bee${E}[2K money`;
    const r = hidden(input, T);
    expect(r.cleaned).toBe('free money');
    expect(r.marks.map((m) => m.kind)).toEqual(['zeroWidthInWord', 'erase']);
    expect(words(input)).toEqual([
      [0, 'fr\u200Bee', ['invisible']],
      [5, `${E}[2K`, ['illegal']],
    ]);
    rebuilds(input, r);
  });

  it('controls inside a sequence belong to it; others keep their rule', () => {
    const r = hidden(`${E}]0;a\u0001b\u0007 x\u0001y`, T);
    expect(r.cleaned).toBe(' xy');
    expect(countByKind(r.marks)).toEqual({ stringSequence: 1, controlChars: 1 });
  });

  it('a kept sequence is not stripped by controlChars', () => {
    expect(cleanHidden(`${E}[31mred`, { ...T, terminal: { sgr: 'keep' } })).toBe(`${E}[31mred`);
  });

  it('a sequence between zero-width characters still cannot split the run', () => {
    const r = hidden(`a\u200B${E}[31m\u200B\u200B\u200Bb`, T);
    expect(r.cleaned).toBe('ab');
    expect(countByKind(r.marks).zeroWidthRun).toBe(4);
  });

  it('bare CR as a newline ends a bidi paragraph', () => {
    expect(
      cleanHidden('\u202Eabc\rdef', {
        ...T,
        bidiOverrides: 'remove-with-content',
        terminal: { bareCR: 'newline' },
      }),
    ).toBe('\ndef');
  });

  it('works under analyze strict', () => {
    const input = `click ${E}]8;;http://evil.example${E}\\here${E}]8;;${E}\\ now`;
    const marks: Mark[] = [];
    const r = analyze(
      input,
      { hiddenChars: 'strict', hiddenCharRules: { terminal: {} } },
      { onReport: (m) => void marks.push(m) },
    );
    expect(r.normalized).toBe('click here now');
    expect(r.words).toHaveLength(2); // each sequence (decisions 7b, 7c)
    expect(r.signals.illegal).toBe(true);
    expect(marks.filter((m) => m.extracted !== null).map((m) => m.extracted)).toEqual([
      '8;;http://evil.example',
      '8;;',
    ]);
    const sgr = analyze(`abc${E}[31mred${E}[0m`, {
      hiddenChars: 'strict',
      hiddenCharRules: { terminal: { sgr: 'remove-counted' } },
    });
    expect(sgr.normalized).toBe('abcred');
    expect(sgr.spoofed).toBe(true);
    const plain = analyze(`${E}[32mok${E}[0m done`, {
      hiddenChars: 'strict',
      hiddenCharRules: { terminal: {} },
    });
    expect(plain.normalized).toBe('ok done');
    expect(plain.spoofed).toBe(false);
  });
});

describe('decision 42e: limits of phase-1 constructs', () => {
  const lost = (f: (cb: CleanupCallbacks) => string) => {
    const l: LostBound[] = [];
    const out = f({ onLostBound: (b) => void l.push(b) });
    return [out, l] as const;
  };
  it('an escape string whose terminator does not come within stringLimit ends at its line end: a lost bound', () => {
    expect(lost((cb) => cleanTerminal(`a${E}]0;title\u0007c`, {}, cb))).toEqual(['ac', []]);
    expect(lost((cb) => cleanTerminal(`a${E}]0;title\u0007c`, { stringLimit: 3 }, cb))).toEqual([
      'a',
      [{ kind: 'escapeString', start: 1, length: 11 }],
    ]);
    // No terminator at all: the same.
    expect(lost((cb) => cleanTerminal(`a${E}]0;title\nb`, {}, cb))).toEqual([
      'a\nb',
      [{ kind: 'escapeString', start: 1, length: 9 }],
    ]);
    expect(() => cleanTerminal('a', { stringLimit: 0 })).toThrow(RangeError);
  });
  it('a concealed span is reported in chunks of constructLimit code points', () => {
    const kinds: string[] = [];
    cleanHidden(
      `a${E}[8m${'x'.repeat(10)}${E}[0mb`,
      { ...STRICT_HIDDEN_RULES, terminal: {}, constructLimit: 4 },
      {
        onReport: (m) => void kinds.push(`${m.kind}@${m.start}+${m.length}`),
      },
    );
    expect(kinds.filter((k) => k.startsWith('terminalConcealed'))).toEqual([
      'terminalConcealed@5+4',
      'terminalConcealed@9+4',
      'terminalConcealed@13+2',
    ]);
  });
  it('limits count code points: an astral body is no longer than its characters', () => {
    const t = `a${E}]0;${'😀'.repeat(5)}\u0007c`;
    expect(cleanTerminal(t, { stringLimit: 7 })).toBe('ac');
    expect(cleanTerminal(t, { stringLimit: 6 })).toBe('a');
  });
  it('a backspace erases at most constructLimit cells', () => {
    const t = 'x'.repeat(5000) + '\b'.repeat(5000) + 'Y';
    expect(cleanTerminal(t)).toBe('x'.repeat(5000 - 4096) + 'Y');
  });
});
