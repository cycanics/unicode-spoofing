/**
 * The finding-callback design, decision by decision, plus the fuzz and stress
 * runs: record invariant, mixed callbacks, abort. Every
 * assertion reads the library's own results and callbacks.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { timed } from './helpers/growth';
import {
  analyze,
  cleanHidden,
  cleanTerminal,
  STRICT_HIDDEN_RULES,
  WORD_CAP,
  type AnalyzeCallbacks,
  type HiddenCharRules,
  type Mark,
  type OutputRecord,
  type Region,
  type WordReason,
} from '../src';
import { Merger, Tee, type RawMark } from '../src/core';
import { LetterPhase } from '../src/letters';
import { backspaceAreas } from '../src/terminal';
import { randomStrings } from './helpers/random';
// @ts-expect-error -- a vendored ESM bundle without types
import * as ref from './fixtures/reference/main.mjs';

const reference = ref as {
  cleanHidden: (t: string, r?: object) => { cleaned: string };
  analyze: (t: string, o?: object) => { normalized: string; words: { word: string }[] };
};
const E = '\u001b';
const ZW = '\u200B';
const ZWNJ = '\u200C';
const STRICT = STRICT_HIDDEN_RULES;
const TERM: HiddenCharRules = { ...STRICT, terminal: {} };
const BOTH = { hiddenChars: 'strict', confusionModel: 'alphabet' } as const;
/** v0.6.0's strict rules: what main shipped before decisions 11, 27, 28a. */
const MAIN_RULES = {
  seamSpaces: false,
  zeroWidthRunThreshold: 4,
  possibleLigatureBreak: 'remove-counted',
} as const;

const reports = (text: string, rules: HiddenCharRules = STRICT) => {
  const marks: Mark[] = [];
  cleanHidden(text, rules, { onReport: (m) => void marks.push(m) });
  return marks;
};
const kinds = (text: string, rules: HiddenCharRules = STRICT) =>
  reports(text, rules).map((m) => m.kind);
const regions = (text: string, rules: HiddenCharRules = STRICT) => {
  const out: [Region, string][] = [];
  cleanHidden(text, rules, { onCleanup: (r, c) => void out.push([r, c]) });
  return out;
};
const records = (
  text: string,
  rules: HiddenCharRules = STRICT,
  cb: Omit<AnalyzeCallbacks, 'onRecord'> = {},
) => {
  const recs: OutputRecord[] = [];
  cleanHidden(text, rules, { ...cb, onRecord: (r) => void recs.push(r) });
  return recs;
};
type Word = [number, number, string, string, WordReason];
const words = (t: string, o: object = {}) => {
  const out: Word[] = [];
  analyze(t, o, { onWord: (...w) => void out.push(w) });
  return out;
};
/** Records cover the source in order; their text joined is the output. */
function checkRecords(src: string, recs: readonly OutputRecord[]): string {
  let p = 0;
  let out = '';
  for (const r of recs) {
    expect(r.start).toBe(p);
    expect(r.length).toBeGreaterThanOrEqual(0);
    p = r.start + r.length;
    out += r.text;
  }
  expect(p).toBe(src.length);
  return out;
}

const corpus = (
  JSON.parse(readFileSync(join(__dirname, 'fixtures', 'cases.json'), 'utf8')) as { input: string }[]
).map((c) => c.input);
const TERM_ALPHABET = [
  'a', 'b', 'c', ' ', '\n', '\b', '\b', '\b', `${E}[31m`, `${E}[8m`, `${E}[0m`, `${E}]0;t\u0007`,
  ZW, '\u0301', 'é', '\r', '\u0007', `${E}[2K`, E, '[', '3', '1', 'm', '漢', `${E}]8;;`, '\u007F',
]; // prettier-ignore

describe('decision 1: each detector is a generator yielding marks in position order', () => {
  it('marks of every rule arrive in position order', () => {
    for (const s of [...randomStrings(2000), ...randomStrings(500, TERM_ALPHABET, 2)]) {
      const byKind = new Map<string, number>();
      for (const m of reports(s, TERM)) {
        expect(m.start).toBeGreaterThanOrEqual(byKind.get(m.kind) ?? 0);
        byKind.set(m.kind, m.start);
      }
    }
  });
});

const raw = (rule: string, start: number, end: number): RawMark => ({
  rule,
  cls: 'x',
  start,
  end,
  n: 1,
  value: '',
  mode: 'cleanup',
  counted: true,
});
function* counted(marks: [number, number][], pulls: number[], k: number): Generator<RawMark> {
  for (const [s, e] of marks) {
    pulls[k]! += 1;
    yield raw(`g${k}`, s, e);
  }
}
const drain = (m: Merger) => {
  const out: string[] = [];
  for (let x = m.next(); x; x = m.next()) out.push(`${x.rule}:${x.start}-${x.end}`);
  return out;
};

describe('decision 2: generators merged by position, each advanced only when its head is taken', () => {
  it('the lowest start first, like the merge step of merge sort', () => {
    const pulls = [0, 0, 0];
    const m = new Merger([
      counted([[0, 2], [5, 6]], pulls, 0),
      counted([[1, 3], [4, 5]], pulls, 1),
      counted([[2, 6]], pulls, 2),
    ]); // prettier-ignore
    expect(drain(m)).toEqual(['g0:0-2', 'g1:1-3', 'g2:2-6', 'g1:4-5', 'g0:5-6']);
  });
  it('a generator advances only when its head is taken', () => {
    const pulls = [0, 0];
    const m = new Merger([counted([[0, 1], [10, 11], [20, 21]], pulls, 0), counted([[30, 31]], pulls, 1)]); // prettier-ignore
    expect(pulls).toEqual([1, 1]); // one head each
    m.next(); // g0@0 taken
    expect(pulls).toEqual([1, 1]);
    m.next(); // g0 advances to 10, which is taken
    expect(pulls).toEqual([2, 1]);
  });
});

describe('decision 3: each cleanup rule has a mode', () => {
  const t = `pa${ZW}y`;
  it('ignored: no mark, no report, text untouched', () => {
    const rules = { ...STRICT, zeroWidthInWord: 'ignored' } as const;
    expect(reports(t, rules)).toEqual([]);
    expect(cleanHidden(t, rules)).toBe(t);
  });
  it('report: reported, text untouched', () => {
    const rules = { ...STRICT, zeroWidthInWord: 'keep' } as const;
    expect(kinds(t, rules)).toEqual(['zeroWidthInWord']);
    expect(regions(t, rules)).toEqual([]);
    expect(cleanHidden(t, rules)).toBe(t);
  });
  it('cleanup: reported and removed', () => {
    expect(kinds(t)).toEqual(['zeroWidthInWord']);
    expect(regions(t).length).toBe(1);
    expect(cleanHidden(t)).toBe('pay');
  });
  it('invisible runs and bidi spans are rules with modes (default report)', () => {
    const run = `a\u00AD\u2062b`; // two carriers in a row, not zero-width: an invisible run
    expect(kinds(run)).toEqual(['invisibleRun', 'softHyphen', 'otherInvisibles']); // one generator: the run first
    expect(kinds(run, { ...STRICT, invisibleRun: 'ignored' })).toEqual([
      'softHyphen',
      'otherInvisibles',
    ]);
    expect(cleanHidden(`x\u202Eabc\u202C y`, { ...STRICT, bidiOverrideSpan: 'ignored' })).toBe(
      'xabc y',
    );
    expect(kinds(`x \u202Eabc\u202C y`, { ...STRICT, bidiOverrideSpan: 'ignored' })).toEqual([
      'bidiOverrides',
      'bidiOverrides',
    ]);
    // A span in cleanup mode removes what the override reverses.
    expect(
      cleanHidden(`x \u202Eabc\u202C y`, { ...STRICT, bidiOverrideSpan: 'remove-counted' }),
    ).toBe('x y');
    expect(
      cleanHidden(`x \u202Babc\u200F def\u202C y`, {
        ...STRICT,
        bidiReorderSpan: 'remove-counted',
      }),
    ).toBe('x y');
  });
  it("analyze's findings between words are phase-1 rules: illegal, encodingDamage, invisibleOutsideWord", () => {
    const seen = (t: string, o: object) => {
      const k: string[] = [];
      analyze(t, o, { onReport: (m) => void k.push(m.kind) });
      return k;
    };
    expect(seen('a\u0007b x�y z \u2062 q', {})).toEqual([
      'illegal',
      'encodingDamage',
      'invisibleOutsideWord',
    ]);
    expect(seen('a\u0007b', { hiddenCharRules: { illegal: 'ignored' } })).toEqual([]);
    expect(analyze('a\u0007b', { hiddenCharRules: { illegal: 'keep' } }).normalized).toBe(
      'a\u0007b',
    );
    expect(analyze('a\u0007b').normalized).toBe('ab');
  });
});

describe('decision 4: overlapping cleanup marks are joined into one region', () => {
  it('a control inside a zero-width run: one region', () => {
    const t = `a${ZW}${ZW}${E}[31m${ZW}${ZW}b`;
    expect(regions(t)).toEqual([[{ start: 1, length: 9, original: t.slice(1, 10) }, '']]);
    expect(kinds(t)).toEqual(['zeroWidthRun', 'controlChars']);
  });
  it('touching marks stay separate regions', () => {
    expect(regions('a\u0001\u0002b').map(([g]) => [g.start, g.length])).toEqual([
      [1, 1],
      [2, 1],
    ]);
  });
  it('mark length plays no role: at one start the generator listed first comes first', () => {
    // The bidi control (invisibles) precedes the longer span (bidi spans) at the same start.
    expect(reports(`x \u202Egnp.exe\u202C`).map((m) => [m.kind, m.start, m.length])).toEqual([
      ['bidiOverrides', 2, 1],
      ['bidiOverrideSpan', 2, 9],
      ['bidiOverrides', 10, 1],
    ]);
  });
  it('a span removed with its content takes in the marks inside it', () => {
    const t = `x \u202Eab${ZW}cd\u202C y`;
    const r = regions(t, { ...STRICT, bidiOverrides: 'remove-with-content' });
    expect(r.map(([g, c]) => [g.original, c])).toEqual([[`\u202Eab${ZW}cd\u202C`, '']]);
  });
});

describe('decision 5: the zero-width generator reads through the control generator', () => {
  it('ZW ZW <ctl> ZW ZW is one run of 4', () => {
    const m = reports(`a${ZW}${ZW}\u0001${ZW}${ZW}b`).find((x) => x.kind === 'zeroWidthRun')!;
    expect(m).toMatchObject({ start: 1, length: 5, count: 4 });
  });
  it('a removed control is no neighbour; an emitted VT is the space it becomes', () => {
    expect(kinds(` \u0001${ZW}x`)).toEqual(['controlChars', 'zeroWidthInWord']);
    expect(kinds(` ${ZW}\u000B`)).toEqual(['isolatedZeroWidth', 'controlChars']);
  });
  it('classifies each run itself and yields it when the run ends', () => {
    expect(kinds(`\uFEFFab`)).toEqual(['leadingBom']);
    expect(kinds(`a ${ZW} b`)).toEqual(['isolatedZeroWidth']);
    expect(kinds(`ม${ZW}ม`)).toEqual(['wordBreakHint']);
    expect(kinds(`Ma${ZWNJ}ke`)).toEqual(['joinerInWord']);
    expect(kinds(`fr${ZW}ee`)).toEqual(['zeroWidthInWord']);
    expect(kinds(`a${ZW.repeat(2)}b`)).toEqual(['zeroWidthRun']);
    expect(reports(`क्\u200Dष`)).toEqual([]); // a legitimate joiner: no mark
  });
  it('the shared buffer holds only the items between the two readers', () => {
    function* gen() {
      for (let i = 0; i < 1000; i++) yield i;
    }
    const tee = new Tee(gen(), 2);
    for (let i = 0; i < 1000; i++) {
      tee.next(0);
      tee.next(1);
    }
    expect(tee.peak).toBeLessThan(70);
  });
});

describe('decision 6: the backspace pre-cleanup is one forward scan', () => {
  it('erases what the backspaces back over', () => {
    expect(cleanHidden('norml\bal', TERM)).toBe('normal');
    expect(cleanHidden('abc\b\bde\b\b\b', TERM)).toBe('');
  });
  it('controls and invisibles walked over go with the area; sequences are skipped, not counted', () => {
    expect(cleanHidden(`pass${E}[m\b\b\b\bfail`, TERM)).toBe('fail');
    expect(cleanHidden(`abc\b\bd${ZW}e\b\b\b\b`, TERM)).toBe('');
    expect(backspaceAreas(`ab\u0001\b`, true)).toEqual([
      { start: 1, end: 4, bs: 1, letters: 'b', flood: false, quiet: false, span: [1, 4] },
    ]);
    // The area is one piece per stretch it removes; the sequence inside is in none
    // (its own rule removes it). The first piece reports the whole area (review 6
    // A5): its span, all its letters, all its backspaces; the others are quiet.
    expect(backspaceAreas(`pass${E}[m\b\b\b\bfail`, true)).toEqual([
      { start: 0, end: 4, letters: 'pass', bs: 4, flood: false, quiet: false, span: [0, 11] },
      { start: 7, end: 11, letters: '', bs: 4, flood: false, quiet: true },
    ]);
    expect(
      reports(`pass${E}[m\b\b\b\bfail`, TERM).map((m) => [
        m.kind,
        m.start,
        m.length,
        m.extracted,
        m.count,
      ]),
    ).toEqual([
      ['backspace', 0, 11, 'pass', 4],
      ['sgr', 4, 3, null, 1],
    ]);
  });
  it('a sequence of any length is one known span (audit a3: no 64-unit look-back)', () => {
    const t = `ab${E}]0;${'t'.repeat(80)}\u0007${'\b'.repeat(2)}`;
    expect(cleanHidden(t, TERM)).toBe('');
    // One report per area (review 6 A5), the sequence inside it under its own rule.
    expect(reports(t, TERM)).toMatchObject([
      { kind: 'backspace', start: 0, length: 89, extracted: 'ab', count: 2 },
      { kind: 'stringSequence', start: 2, length: 85 },
    ]);
    const many = `ab${E}]0;${'t'.repeat(80)}\u0007${'\b'.repeat(70)}`;
    expect(reports(many, TERM)).toMatchObject([
      { kind: 'backspaceFlood', start: 0, length: 157, extracted: 'ab', count: 70 },
      { kind: 'stringSequence', start: 2, length: 85 },
    ]);
  });
  it('a later run walks over an earlier area and takes it in', () => {
    expect(reports('abc\b\bde\b\b\b', TERM)).toEqual([
      { kind: 'backspace', start: 0, length: 10, extracted: 'abcde', count: 5 },
    ]);
  });
  it('leftover backspaces are reported (backspaceFlood)', () => {
    expect(reports('ab\b\b\bx', TERM)).toEqual([
      { kind: 'backspaceFlood', start: 0, length: 5, extracted: 'ab', count: 3 },
    ]);
  });
  it('one path: the result does not depend on how many backspaces a run has elsewhere', () => {
    const area = `ab${E}[31m\b\b\bx`;
    const far = `\n${'y'.repeat(300)}${'\b'.repeat(300)}`;
    expect(cleanHidden(area + far, TERM).startsWith(cleanHidden(area, TERM))).toBe(true);
  });
});

describe('decision 6a: every character is one cell, wide ones too (documented limitation)', () => {
  it('漢字⟨BS⟩⟨BS⟩ erases both (a terminal erases only 字)', () => {
    expect(cleanHidden('漢字\b\b', TERM)).toBe('');
    expect(reports('漢字\b\b', TERM)).toEqual([
      { kind: 'backspace', start: 0, length: 4, extracted: '漢字', count: 2 },
    ]);
  });
});

describe('decision 7: a string sequence ends at its terminator, across line breaks', () => {
  it('the body runs over CR/LF to BEL or ST', () => {
    expect(cleanTerminal(`a${E}]0;ti\ntle\u0007b`)).toBe('ab');
    expect(cleanTerminal(`a${E}]0;ti\r\ntle${E}\\b`)).toBe('ab');
    expect(cleanTerminal(`a${E}P1;2q\nsixel${E}\\b`)).toBe('ab');
  });
  it('only with no terminator later does it end at its line end', () => {
    expect(cleanTerminal(`a${E}]0;title\nnext line`)).toBe('a\nnext line');
    const m: Mark[] = [];
    cleanTerminal(`a${E}]0;title\nb`, {}, { onReport: (x) => void m.push(x) });
    expect(m).toEqual([
      { kind: 'stringSequence', start: 1, length: 9, extracted: '0;title', count: 1 },
    ]);
  });
  it('another ESC ends the body and starts a new sequence', () => {
    expect(cleanTerminal(`a${E}]0;t${E}[31mb`)).toBe('ab');
  });
});

describe('decision 7a: escape sequences by the DEC/ANSI state machine', () => {
  const marks = (t: string) => {
    const m: [string, number, number][] = [];
    cleanTerminal(t, {}, { onReport: (x) => void m.push([x.kind, x.start, x.length]) });
    return m;
  };
  it('a C0 control inside a CSI is executed; the CSI goes on (the LF stays)', () => {
    expect(cleanTerminal(`a${E}[3\n1mb`)).toBe('a\nb');
    expect(marks(`a${E}[3\n1mb`)).toEqual([
      ['sgr', 1, 3],
      ['sgr', 5, 2],
    ]);
  });
  it('a BS inside a CSI is a real backspace', () => {
    expect(cleanTerminal(`ab${E}[3\b1mc`)).toBe('ac');
  });
  it('DEL inside a CSI is ignored', () => {
    expect(cleanTerminal(`a${E}[3\u007F1mb`)).toBe('ab');
  });
  it('invalid sequences are consumed and ignored', () => {
    expect(cleanTerminal(`a${E}[ 1mb`)).toBe('ab'); // a parameter after an intermediate: csi_ignore to the final
    expect(cleanTerminal(`a${E}[3é1mb`)).toBe('a1mb'); // a character outside the grammar: the sequence ends with it
    expect(marks(`a${E}[ 1mb`)).toEqual([['otherSequence', 1, 5]]);
  });
  it('CAN/SUB abort a sequence; ESC inside one aborts it and starts a new one', () => {
    expect(cleanTerminal(`a${E}[3\u00181mb`)).toBe('a1mb');
    expect(cleanTerminal(`a${E}[3${E}[31mb`)).toBe('ab');
  });
  it('an escape dispatch takes its final only: SS2 leaves the next character', () => {
    expect(cleanTerminal(`a${E}Nxb`)).toBe('axb');
  });
  it('an ESC followed by a C0 executes it and goes on', () => {
    expect(cleanTerminal(`a${E}\u0001[31mb`)).toBe('a\u0001b');
  });
});

describe('decision 8: pre-cleanup deletions stream in source positions, first at equal positions', () => {
  it('marks after a reassembled area carry source positions', () => {
    expect(reports(`abc\b\b\bx${ZW}y`, TERM)).toEqual([
      { kind: 'backspace', start: 0, length: 6, extracted: 'abc', count: 3 },
      { kind: 'zeroWidthInWord', start: 7, length: 1, extracted: ZW, count: 1 },
    ]);
  });
  it('the area stream comes first at equal positions', () => {
    // The area (reported once, at its start) and the SGR's two parts in source order: 1, 2, 6.
    expect(kinds(`ab${E}[3\b1mc`, TERM)).toEqual(['backspace', 'sgr', 'sgr']);
    expect(
      drain(
        new Merger([
          [raw('pre', 3, 4)][Symbol.iterator](),
          [raw('other', 3, 9)][Symbol.iterator](),
        ]),
      ),
    ).toEqual(['pre:3-4', 'other:3-9']);
  });
});

describe('decision 9: phase 1 emits records (start, length, text); nothing accumulates', () => {
  it('records cover the source and rebuild the output', () => {
    for (const s of randomStrings(3000)) expect(checkRecords(s, records(s))).toBe(cleanHidden(s));
  });
  it('merging two records concatenates their text and joins their ranges', () => {
    const joined = records(`a${ZW}b c`).reduce((x, y) => ({
      start: x.start,
      length: x.length + y.length,
      text: x.text + y.text,
    }));
    expect(joined).toEqual({ start: 0, length: 5, text: 'ab c' });
  });
  it('records stream while the text is read', () => {
    const big = `x${ZW}y `.repeat(50_000);
    let reportsAtFirstRecord = -1;
    let n = 0;
    cleanHidden(big, STRICT, {
      onReport: () => void n++,
      onRecord: () => {
        if (reportsAtFirstRecord < 0) reportsAtFirstRecord = n;
      },
    });
    expect(reportsAtFirstRecord).toBeLessThan(10);
  });
});

describe('decision 10: position lists are the consumer’s', () => {
  it('records carry only (start, length, text); cleanHidden returns the text', () => {
    for (const r of records(`a${ZW}b`))
      expect(Object.keys(r).sort()).toEqual(['length', 'start', 'text']);
    expect(typeof cleanHidden(`a${ZW}b`)).toBe('string');
  });
});

describe('decision 11: at a removal seam one space stays (fork-only, strict)', () => {
  it('<before><space> + <space><after> → <before><space><after>', () => {
    expect(cleanHidden(`a ${ZW} b`)).toBe('a b');
    expect(cleanHidden(`a ${ZW} b`, { ...STRICT, seamSpaces: false })).toBe('a  b');
  });
  it('a rules object without the key has it on, like every other strict default (audit b29)', () => {
    expect(cleanHidden(`a ${ZW} b`, {} as HiddenCharRules)).toBe('a b');
  });
  it('the dropped space is a record of its own', () => {
    expect(records(`a ${ZW} b`)).toEqual([
      { start: 0, length: 2, text: 'a ' },
      { start: 2, length: 1, text: '' },
      { start: 3, length: 1, text: '' },
      { start: 4, length: 1, text: 'b' },
    ]);
  });
  it('a dropped space opens no new seam; a default space emission after a removal loses its space', () => {
    expect(cleanHidden(`a ${ZW} \u000Bb`)).toBe('a  b');
    expect(cleanHidden(`x${ZW} ${ZW}\u000By`)).toBe('x y');
    expect(cleanHidden('a  b')).toBe('a  b'); // a source double space stays
  });
  it("upstream's path has no seam rule", () => {
    expect(analyze('a \u0007 b').normalized).toBe('a  b');
    expect(analyze('a \u0007 b', { hiddenChars: 'strict' }).normalized).toBe('a b');
  });
});

describe('decision 12: report — one call per mark per rule, own kind, hidden part', () => {
  it('kinds, extracted hidden parts (decision 12a: tag characters as written), counts', () => {
    const tags = [...'hi'].map((c) => String.fromCodePoint(0xe0000 + c.codePointAt(0)!)).join('');
    const t = `a${ZW}b x${tags} \u202Egnp.exe\u202C`;
    expect(reports(t)).toEqual([
      { kind: 'zeroWidthInWord', start: 1, length: 1, extracted: ZW, count: 1 },
      { kind: 'tags', start: 5, length: 4, extracted: tags, count: 2 },
      { kind: 'bidiOverrides', start: 10, length: 1, extracted: '\u202E', count: 1 },
      { kind: 'bidiOverrideSpan', start: 10, length: 9, extracted: 'gnp.exe', count: 9 },
      { kind: 'bidiOverrides', start: 18, length: 1, extracted: '\u202C', count: 1 },
    ]);
  });
  it('a zero-width payload is its characters on its mark (decision 12a: no decoding)', () => {
    const bits = [...'hi']
      .map((c) => c.charCodeAt(0).toString(2).padStart(8, '0'))
      .join('')
      .replace(/0/g, ZW)
      .replace(/1/g, ZWNJ);
    expect(reports(`x${bits}y`)[0]).toMatchObject({
      kind: 'zeroWidthRun',
      extracted: bits,
      count: 16,
    });
  });
  it('a selector payload is its selectors, no hex, no cap (decision 12a)', () => {
    expect(reports('a\uFE00\uFE01\uFE05')).toEqual([
      {
        kind: 'variationSelectors',
        start: 1,
        length: 3,
        extracted: '\uFE00\uFE01\uFE05',
        count: 3,
      },
    ]);
    const long = 'a' + '\uFE00\uFE01'.repeat(40);
    expect(reports(long)[0]!.extracted).toBe('\uFE00\uFE01'.repeat(40));
  });
  it('rules in cleanup mode report too, and so do report-mode rules', () => {
    expect(kinds(`a\u200Fb`)).toEqual(['bidiMarks']);
    expect(kinds(`ש\u200Fb`)).toEqual(['bidiMarksInRtlText']);
  });
});

describe('decision 13: cleanup — one call per region, its source text and every rule’s default', () => {
  it('the region and its cleanup, no hidden part', () => {
    expect(regions(`click⠀here`)).toEqual([[{ start: 5, length: 1, original: '⠀' }, ' ']]);
    const [[g, c]] = regions(`a\u000Bb`) as [[Region, string]];
    expect(Object.keys(g).sort()).toEqual(['length', 'original', 'start']);
    expect(c).toBe(' ');
  });
});

describe('decision 14: word — (start, end, cleaned, replacement, reason)', () => {
  it('a folded word: converted, toLang (camelCase, audit b46)', () => {
    expect(words('please pay Pаypаl now', BOTH)).toEqual([
      [
        11,
        17,
        'Pаypаl',
        'Paypal',
        // 36e corrects it (no ladder rule).
        { signals: ['mixed_spoof'], converted: true, toLang: 'English' },
      ],
    ]);
  });
  it('cleaned is the word as phase 1 output it; start and end are source positions', () => {
    expect(words(`pay P${ZW}аypаl`, BOTH)).toEqual([
      [4, 11, 'Pаypаl', 'Paypal', { signals: ['mixed_spoof'], converted: true, toLang: 'English' }],
    ]);
  });
  it('only words: findings between words go to the report callback (audit b45)', () => {
    expect(words('a\u0007b x�y')).toEqual([]);
    expect(words('ⒶⓑⒸ x')).toEqual([[0, 3, 'ⒶⓑⒸ', 'AbC', { signals: ['confusable_word'] }]]);
  });
});

describe('decision 15: text a callback returns goes to the consumer’s output only', () => {
  it('the library result stays the defaults’', { timeout: 60_000 }, () => {
    for (const s of randomStrings(1500)) {
      const plain = analyze(s, BOTH);
      const seen: OutputRecord[] = [];
      const cbs: AnalyzeCallbacks = {
        onCleanup: () => '[hidden]',
        onWord: () => void 0,
        onRecord: (r) => void seen.push(r),
      };
      expect(analyze(s, BOTH, cbs)).toEqual(plain);
      checkRecords(s, seen);
    }
  });
  it('onRecord streams phase 1 with the cleanup returns; the result is the library’s', () => {
    const t = `pay P${ZW}аypаl and fr${ZW}ee`;
    const phase1: OutputRecord[] = [];
    const r = analyze(t, BOTH, { onCleanup: () => '[h]', onRecord: (x) => void phase1.push(x) });
    expect(r.normalized).toBe('pay Paypal and free');
    expect(phase1.map((x) => x.text).join('')).toBe('pay P[h]аypаl and fr[h]ee');
    expect(
      records(`fr${ZW}ee co\u00ADop`, STRICT, { onCleanup: (g) => `{${g.length}}` })
        .map((x) => x.text)
        .join(''),
    ).toBe('fr{1}ee co{1}op');
  });
});

describe('decision 16: early stop is an AbortSignal, honoured in both phases', () => {
  it('phase 1 stops at the next mark', () => {
    const big = `x${ZW}y `.repeat(20_000);
    const ac = new AbortController();
    let calls = 0;
    const r = cleanHidden(big, STRICT, {
      signal: ac.signal,
      onReport: () => {
        if (++calls === 50) ac.abort();
      },
    });
    expect(calls).toBe(50);
    expect(r.length).toBeLessThan(big.length / 10);
  });
  it('the word phase stops at the next word (audit a5)', () => {
    for (const o of [{}, BOTH]) {
      const ac = new AbortController();
      let n = 0;
      analyze('раураl x раураl y раураl', o, {
        signal: ac.signal,
        onWord: () => {
          n++;
          ac.abort();
        },
      });
      expect(n).toBe(1);
    }
  });
  it('aborted before the start: nothing is done', () => {
    const ac = new AbortController();
    ac.abort();
    expect(analyze(`x${ZW}y`, BOTH, { signal: ac.signal }).normalized).toBe('');
    expect(records(`a${ZW}b`, STRICT, { signal: ac.signal })).toEqual([]);
  });
});

describe('decision 16a: one streaming API', () => {
  it('no separate record generators are exported', async () => {
    const lib = (await import('../src')) as Record<string, unknown>;
    expect(lib.hiddenRecords).toBeUndefined();
    expect(lib.analyzeRecords).toBeUndefined();
  });
});

describe('decisions 17, 17a: counters are the consumer’s; the kind decides', () => {
  it('reports carry no counted/silent flag', () => {
    for (const m of reports(`a${ZW}b c\u00ADd`))
      expect(Object.keys(m).sort()).toEqual(['count', 'extracted', 'kind', 'length', 'start']);
  });
  it('the formerly silent rules and the ligature break are kinds of their own', () => {
    const t = `\uFEFFa co\u00ADop x ${ZW} y ม${ZW}ม Auf${ZWNJ}lage`;
    expect(kinds(t)).toEqual([
      'leadingBom',
      'softHyphen',
      'isolatedZeroWidth',
      'wordBreakHint',
      'possibleLigatureBreak',
    ]);
  });
  it('a counting report callback: totals by kind', () => {
    const n: Record<string, number> = {};
    cleanHidden(`fr${ZW}ee co\u00ADop fr${ZW}ee`, STRICT, {
      onReport: (m) => void (n[m.kind] = (n[m.kind] ?? 0) + m.count),
    });
    expect(n).toEqual({ zeroWidthInWord: 2, softHyphen: 1 });
  });
});

describe('decision 18: the re-chunker keeps true source positions over any record cut', () => {
  function run(text: string, cuts: number[]) {
    const pieces: string[] = [];
    const lp = new LetterPhase({
      source: text,
      strict: false,
      model: null,
      expectedScripts: new Set(),
      wholeScriptFold: 'all',
      contextBuffer: 100,
      majorityWindow: 10,
      breadth: 'window',
      neutral: false,
      wordCap: true,
      out: (t) => void pieces.push(t),
      finding: null,
      counted: null,
    });
    let at = 0;
    for (const c of [...cuts, text.length]) {
      if (c > at) lp.record(at, c, text.slice(at, c), 'keep');
      at = c;
    }
    lp.finish();
    return pieces.join('');
  }
  it('records cut anywhere (outside surrogate pairs) give one output', () => {
    let seed = 5;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (const s of randomStrings(2000).filter(
      // eslint-disable-next-line no-control-regex -- control characters are the point
      (x) => !/[\uD800-\uDFFF\u0000-\u001F\u007F-\u009F\uFFFD]/.test(x),
    )) {
      const cuts = [...new Set(Array.from({ length: 4 }, () => Math.floor(rnd() * s.length)))].sort(
        (a, b) => a - b,
      );
      expect(run(s, cuts)).toBe(run(s, []));
    }
  });
  it('a removal joins its neighbours into one word', () => {
    const r = analyze(`Pa${E}[0myPal`, {
      hiddenChars: 'strict',
      hiddenCharRules: { controlChars: 'remove-counted' },
    });
    expect(r.normalized).toBe('PayPal');
    expect(r.counts.wordsTotal).toBe(1);
  });
});

describe('decision 18a: chunks carry their leading gap; the text after the last word is a chunk of its own', () => {
  it('with no word changed, the chunks rebuild phase 1’s output', () => {
    for (const s of [...randomStrings(1500), ...corpus]) {
      for (const o of [{}, BOTH]) {
        const recs: OutputRecord[] = [];
        let changed = 0;
        const r = analyze(s, o, {
          onRecord: (x) => void recs.push(x),
          onWord: () => void changed++,
          // Lenient: invisible runs outside words are the word pass's removals, not phase 1's.
          onReport: (m) => void (m.kind === 'invisibleOutsideWord' && changed++),
        });
        if (changed === 0)
          expect(r.normalized, JSON.stringify(s)).toBe(recs.map((x) => x.text).join(''));
      }
    }
  });
  it('gaps around words keep their text', () => {
    expect(analyze('« Pаypаl », ok!!', BOTH).normalized).toBe('« Paypal », ok!!');
  });
});

describe('decision 19: word cap of 250 characters', () => {
  const long = 'Pа' + 'a'.repeat(WORD_CAP);
  it('past it: tooBig, the word stays as phase 1 output it, its end position kept', () => {
    const r = analyze(`x ${long} y`, BOTH, {});
    expect(words(`x ${long} y`, BOTH)).toEqual([
      [2, 2 + long.length, long, long, { tooBig: true }],
    ]);
    expect(r.normalized).toBe(`x ${long} y`);
    expect(r.words).toEqual([]);
  });
  it('a hidden character inside a too-big word: cleaned has it removed (audit a1)', () => {
    const t = 'a'.repeat(200) + ZW + 'a'.repeat(100);
    const [w] = words(t, { hiddenChars: 'strict' });
    expect(w).toEqual([0, 301, 'a'.repeat(300), 'a'.repeat(300), { tooBig: true }]);
    expect(analyze(t, { hiddenChars: 'strict' }).normalized).toBe('a'.repeat(300));
  });
  it('at the cap the word is judged', () => {
    expect(analyze('Pа' + 'a'.repeat(WORD_CAP - 2), BOTH).words.length).toBe(1);
  });
});

describe('decision 20: the language context is a ring of words, configurable, default 100', () => {
  const t =
    'the cat sat сор ' + Array.from({ length: 120 }, (_, i) => String(i)).join(' ') + ' dog';
  const rule = (o: object) =>
    analyze(t, { confusionModel: 'alphabet', breadth: 'window', ...o }).words[0]?.resolution?.rule;
  it('the nearest words reach ±majorityWindow, whatever the ring (results do not depend on its size)', () => {
    expect(rule({})).toBe('window'); // `dog` is 121 words ahead
    expect(rule({ contextBuffer: 200 })).toBe('window');
  });
  it('the ring must hold the majority window and the word: a clear error (audit b52)', () => {
    expect(() => analyze('a', { contextBuffer: 20 })).toThrow(
      /contextBuffer \(20\).*majorityWindow \(10\).*21/,
    );
    expect(() => analyze('a', { majorityWindow: 60 })).toThrow(
      /contextBuffer \(100\).*majorityWindow \(60\).*121/,
    );
    expect(() => analyze('a', { contextBuffer: 21 })).not.toThrow();
  });
});

describe('decision 21: dominant alphabet and any-mixed over a configurable window, or all words', () => {
  const t = Array(60).fill('привет').join(' ') + ' ' + Array(60).fill('hello').join(' ') + ' НОТ';
  it('the window sees Latin around the word, the whole text sees Cyrillic', () => {
    expect(analyze(t, { breadth: 'window', contextBuffer: 50 }).words.map((w) => w.word)).toEqual([
      'НОТ',
    ]);
    expect(analyze(t, { breadth: 'all' }).words).toEqual([]);
    expect(analyze(t).words).toEqual(analyze(t, { breadth: 'all' }).words); // default without the model: all
  });
  it('the alphabet model reads the window by default', () => {
    expect(analyze(t, { confusionModel: 'alphabet' })).toEqual(
      analyze(t, { confusionModel: 'alphabet', breadth: 'window' }),
    );
  });
  it('an unknown breadth is rejected (audit b50)', () => {
    expect(() => analyze('a', { breadth: 'every' as never })).toThrow(RangeError);
  });
});

describe('decision 22: one window mechanism; the majority window is configurable, default ±10', () => {
  const t = 'the cat sat ' + Array(10).fill('1').join(' ') + ' сор';
  const res = (o: object) => analyze(t, { confusionModel: 'alphabet', ...o }).words[0]?.resolution;
  it('±10 does not reach the Latin words; ±12 does', () => {
    expect(res({})).toBeUndefined();
    expect(res({ majorityWindow: 12, contextBuffer: 25 })).toMatchObject({
      rule: 'window',
      context: { window: 'English' },
    });
  });
});

describe('decision 23: no conditions for clearing the buffer', () => {
  it('the buffer is not cleared; the one context window stops at a paragraph (22, 24)', () => {
    const same = Array(30).fill('hello').join(' ') + ' НОТ';
    expect(analyze(same, { breadth: 'window' }).words.map((w) => w.word)).toEqual(['НОТ']);
    const t = Array(30).fill('hello').join(' ') + '\n\nНОТ';
    expect(analyze(t, { breadth: 'window' }).words.map((w) => w.word)).toEqual([]);
  });
});

describe('decision 24: paragraph-bounded context, a marker on the buffered word', () => {
  it('neighbours and the majority window stop at a blank line', () => {
    const one = analyze('the cat сор sat on', { confusionModel: 'alphabet' }).words[0]!.resolution!;
    const two = analyze('the cat\n\nсор sat on', { confusionModel: 'alphabet' }).words[0]!
      .resolution!;
    expect(one.context).toEqual({ neighbours: ['English'], window: 'English' });
    expect(two.context.neighbours).toEqual([]);
  });
  it('decision 25a: CR, LF and CRLF in any combination are line breaks; two make a blank line', () => {
    const LA = { confusionModel: 'alphabet' } as const;
    const ctx = (b: string) =>
      analyze(`the cat${b}сор sat on`, LA).words[0]?.resolution?.context.neighbours ?? null;
    for (const b of ['\n\n', '\r\r', '\r\n\r\n', '\r\n\r', '\n\r'])
      expect(ctx(b), JSON.stringify(b)).toEqual([]);
    for (const b of ['\n', '\r', '\r\n']) expect(ctx(b), JSON.stringify(b)).toEqual(['English']);
  });
});

describe('decision 25: backspace erase stops at a line start (LF, and after a CR); configurable', () => {
  it('stops at \\n', () => {
    expect(cleanHidden('ab\n\b\bcd', TERM)).toBe('ab\ncd');
    expect(reports('ab\n\b\bcd', TERM)[0]).toMatchObject({ kind: 'backspaceFlood', count: 2 });
  });
  it('after a bare CR the cursor is at column 0: the backspace erases nothing before it', () => {
    // Decision 25a: a lone CR is a line break; nothing is overwritten.
    expect(cleanHidden('ab\r\bcd', TERM)).toBe('ab\rcd');
    expect(kinds('ab\r\bcd', TERM)).toEqual(['bareCR', 'backspaceFlood']);
    expect(cleanHidden('ab\rcd\b\b\b', TERM)).toBe('ab\r');
  });
  it('backspaceLineStop: false erases across the line start (the LF inside the area goes too)', () => {
    const rules = { ...STRICT, terminal: { backspaceLineStop: false } };
    expect(cleanHidden('ab\n\b\bcd', rules)).toBe('cd');
    expect(reports('ab\n\b\bcd', rules)).toEqual([
      { kind: 'backspace', start: 0, length: 5, extracted: 'ab', count: 2 },
    ]);
  });
});

describe('decision 26: a ZWSP touching a Latin letter is removed, strict and lenient', () => {
  it.each([`fr${ZW}ee`, `word${ZW} next`, `${ZW}word`])('%j', (t) => {
    expect(analyze(t).normalized).not.toContain(ZW);
    expect(analyze(t, { hiddenChars: 'strict' }).normalized).not.toContain(ZW);
    expect(analyze(t).normalized).toBe(reference.analyze(t).normalized); // lenient: as upstream
  });
});

describe('decision 27: ZWNJ between f and f/i/l/t is a possible ligature break', () => {
  it('strict removes it under a kind of its own', () => {
    for (const t of [
      `Auf${ZWNJ}lage`,
      `Schaf${ZWNJ}fell`,
      `auf${ZWNJ}tauchen`,
      `Kauf${ZWNJ}interesse`,
    ]) {
      expect(kinds(t)).toEqual(['possibleLigatureBreak']);
      expect(cleanHidden(t)).toBe(t.replace(ZWNJ, ''));
    }
    expect(kinds(`Ma${ZWNJ}ke`)).toEqual(['joinerInWord']); // not after f
  });
  it('lenient as upstream', () => {
    const t = `Auf${ZWNJ}lage`;
    expect(analyze(t).normalized).toBe(reference.analyze(t).normalized);
  });
  it('strict analyze does not list it as a hidden-character word (a silent kind, decision 17a)', () => {
    expect(analyze(`die Auf${ZWNJ}lage`, { hiddenChars: 'strict' }).words).toEqual([]);
  });
});

describe('decision 28: a ZWSP or ZWNJ touching only one letter is never legitimate', () => {
  it('strict: removed and listed, a joining-script letter included', () => {
    for (const t of [`word${ZW} x`, `کتاب${ZWNJ} x`, `/${ZW}path`, `x ${ZWNJ}word`]) {
      const r = analyze(t, { hiddenChars: 'strict' });
      expect(r.normalized, t).toBe(t.replace(/[\u200B\u200C]/g, ''));
      expect(
        r.words.map((w) => w.signals),
        t,
      ).toEqual([['invisible']]);
    }
  });
  it('lenient keeps upstream’s behaviour', () => {
    for (const t of [`کتاب${ZWNJ} x`, `/${ZW}path`]) expect(analyze(t)).toEqual(analyzeMain(t));
  });
  it('ZWJ is not covered', () => {
    expect(kinds(`क्\u200Dष`)).toEqual([]);
  });
});

/** main's lenient analyze without its fork-only fields. */
function analyzeMain(t: string): object {
  const { hidden, counts, ...rest } = reference.analyze(t) as unknown as {
    hidden?: unknown;
    counts: Record<string, number>;
  } & Record<string, unknown>;
  void hidden;
  const { hiddenWords, ...c } = counts;
  void hiddenWords;
  return { ...rest, counts: c };
}

describe('decision 28a: in strict, two or more zero-width characters in a row are a run', () => {
  it('wherever they sit', () => {
    expect(kinds(`a ${ZW}${ZW} b`)).toEqual(['zeroWidthRun']);
    expect(kinds(`fr${ZW}${ZWNJ}ee`)).toEqual(['zeroWidthRun']);
    expect(kinds(`\uFEFF\uFEFFab`)).toEqual(['zeroWidthRun']);
    expect(STRICT.zeroWidthRunThreshold).toBe(2);
  });
  it('strict analyze lists it; lenient keeps upstream’s 4', () => {
    expect(
      analyze(`a ${ZW}${ZW} b`, { hiddenChars: 'strict' }).words.map((w) => w.signals),
    ).toEqual([['invisible']]);
    const t = `a ${ZW}${ZW}${ZW} b`;
    expect(analyze(t)).toEqual(analyzeMain(t));
  });
});

describe('decision 29: each carrier report includes its character; the consumer joins scattered payloads', () => {
  it('the per-carrier report calls rebuild the payload', () => {
    const msg = 'pwnd'.repeat(80);
    const bits = [...msg].map((c) => c.charCodeAt(0).toString(2).padStart(8, '0')).join('');
    const t = [...bits].map((b, i) => `${'abcdefgh'[i % 8]}${b === '0' ? ZW : ZWNJ}`).join('');
    const carriers = reports(t).filter(
      (m) => m.kind === 'zeroWidthInWord' || m.kind === 'joinerInWord',
    );
    const decoded = carriers
      .map((m) => (m.extracted === ZW ? '0' : '1'))
      .join('')
      .match(/.{8}/g)!
      .map((b) => String.fromCharCode(parseInt(b, 2)))
      .join('');
    expect(decoded).toBe(msg);
    expect(cleanHidden(t)).toBe(t.replace(/[\u200B\u200C]/g, '')); // the library's output is the same either way
  });
  it.each([`a\u00ADb`, `x\u2062y`, `a\u200Fb`, `click⠀here`])('%j reports its character', (t) => {
    const [m] = reports(t);
    expect(m!.extracted).toBe(t.slice(m!.start, m!.start + m!.length));
  });
});

describe('decisions 30–33: styled characters are a neutral alphabet (option neutralAlphabet)', () => {
  const N = { neutralAlphabet: true } as const;
  it('decision 30: an optional feature; off, upstream’s styled runs as before', () => {
    expect(analyze('pⓐypal').normalized).toBe('pⓐypal');
    expect(analyze('pⓐypal', N).normalized).toBe('paypal');
    expect(analyze('ⓗⓔⓛⓛⓞ world')).toEqual(analyzeMain('ⓗⓔⓛⓛⓞ world'));
  });
  it('decision 31: a neutral letter follows its word’s conversion, never a target', () => {
    expect(analyze('pⓐypal', { ...N, confusionModel: 'alphabet' }).normalized).toBe('paypal');
    // 36e: `рураl` is not converted (its last piece is reported), so `ⓐ` has no conversion to follow.
    expect(analyze('рⓐураl', { ...N, confusionModel: 'alphabet' }).normalized).toBe('рⓐураl');
    expect(analyze('пⓐпа', { ...N, confusionModel: 'alphabet' }).normalized).toBe('папа');
    expect(words('pⓐypal', { ...N, confusionModel: 'alphabet' })).toEqual([
      [
        0,
        6,
        'pⓐypal',
        'paypal',
        // Decision 30b: a styled form is clearly visible, its conversion no spoof.
        { signals: [], converted: true, toLang: 'English' },
      ],
    ]);
  });
  it('decision 32: a standalone neutral letter is not converted', () => {
    expect(analyze('see ⓐ here', N).normalized).toBe('see ⓐ here');
    expect(analyze('see ⓐ here', N).words).toEqual([]);
  });
  it('decision 33: a brand mark at a word’s end stays and does not stop the word', () => {
    expect(analyze('Brand® now', N).normalized).toBe('Brand® now');
    expect(analyze('Brand® now', N).words).toEqual([]);
    expect(analyze('pⓐypal® now', N).normalized).toBe('paypal® now');
    expect(words('pⓐypal™', N)).toEqual([
      [0, 7, 'pⓐypal™', 'paypal™', { signals: [], converted: true, toLang: 'English' }],
    ]);
  });
});

describe('decision 6: U+009B starts a CSI in the backspace scan (cp1252 `›` guard kept)', () => {
  it('a backspace after a C1 CSI skips the sequence, as after ESC [', () => {
    expect(cleanHidden('ab\u009B31m\b\bcd', TERM)).toBe(cleanHidden(`ab${E}[31m\b\bcd`, TERM));
    expect(cleanHidden('ab\u009B31m\b\bcd', TERM)).toBe('cd');
  });
  it('a `›` before a word is no sequence: its characters are no span', () => {
    expect(cleanTerminal('Home \u009B Products')).toBe('Home \u009B Products');
  });
});

describe('decision 7: a backspace erases cells, not sequences', () => {
  it('a sequence inside an erase area keeps its own rule', () => {
    const t = `ab${E}[31mcd\b\b\bX`;
    expect(cleanTerminal(t, { sgr: 'keep' })).toBe(`a${E}[31mX`);
    expect(cleanTerminal(t)).toBe('aX');
  });
  it('the scan streams: areas of a line are final at its line end', async () => {
    const { BackspaceScan } = await import('../src/terminal');
    const text = 'ab\b\ncd\b\b\nef';
    const scan = new BackspaceScan(text, true);
    expect([...scan.take(2)]).toEqual([
      { start: 1, end: 3, letters: 'b', bs: 1, flood: false, quiet: false, span: [1, 3] },
    ]);
    expect([...scan.take(Infinity)].map((p) => [p.start, p.letters])).toEqual([[4, 'cd']]);
  });
});

describe('decision 7a: SOS, PM and APC bodies take any character to their terminator', () => {
  it('APC with a non-ASCII character is removed whole', () => {
    expect(cleanTerminal(`a${E}_héllo secret${E}\\b`)).toBe('ab');
    expect(cleanTerminal(`a${E}^pé${E}\\b`)).toBe('ab');
  });
});

describe('decision 12a: no conversion of hidden content', () => {
  it('payloads are their input characters', () => {
    const tags = [...'hi'].map((c) => String.fromCodePoint(0xe0000 + c.codePointAt(0)!)).join('');
    expect(reports(`x${tags} y`)[0]!.extracted).toBe(tags);
    expect(reports('a\uFE00\uFE01\uFE05')[0]!.extracted).toBe('\uFE00\uFE01\uFE05');
    expect(reports(`a${'\u0301'.repeat(5)}`)[0]!.extracted).toBe('\u0301'.repeat(3));
  });
  it('no decoder is exported', async () => {
    const lib = (await import('../src')) as Record<string, unknown>;
    expect(lib.PAYLOAD_HEX_CAP).toBeUndefined();
    const chars = (await import('../src/chars')) as Record<string, unknown>;
    for (const k of ['decodeTags', 'decodeVS', 'decodeZW', 'hex', 'printable'])
      expect(chars[k]).toBeUndefined();
  });
});

describe('rule values: an unknown one is rejected', () => {
  it.each([
    [{ zeroWidthInWord: 'remove-with-content' }],
    [{ zeroWidthRunThreshold: 0 }],
    [{ terminal: { sgr: 'drop' } }],
    [{ terminal: { bareCR: 'cr' } }],
  ])('%j', (over) => {
    expect(() => cleanHidden('a\u00ADb', { ...STRICT, ...over } as never)).toThrow(RangeError);
    expect(() => analyze('a', { hiddenChars: 'strict', hiddenCharRules: over as never })).toThrow(
      RangeError,
    );
  });
});

describe('decision 16: abort stops the scan itself', () => {
  it('a mark early in a text: the output stops there', () => {
    const ac = new AbortController();
    const text = '\u0007' + 'plain words here '.repeat(1000);
    const r = analyze(text, {}, { signal: ac.signal, onReport: () => ac.abort() });
    expect(r.normalized).toBe('');
  });
  timed('a mark early in a long text: the rest is not read', () => {
    const big = '\u0007' + 'plain words here '.repeat(150_000);
    const aborted = () => {
      const ac = new AbortController();
      const t0 = performance.now();
      const r = analyze(big, {}, { signal: ac.signal, onReport: () => ac.abort() });
      expect(r.normalized).toBe('');
      return performance.now() - t0;
    };
    analyze(big);
    aborted();
    const full = performance.now();
    analyze(big);
    const fullMs = performance.now() - full;
    // The text is read once by the phase-1 regexes; the word pass does not run.
    expect(Math.min(aborted(), aborted())).toBeLessThan(fullMs / 2);
  });
});

describe('decision 19: the word cap is the fork’s options’', () => {
  const long = 'а'.repeat(125) + 'a'.repeat(126);
  it('upstream’s path judges a word over 250 characters', () => {
    expect(analyze(long)).toEqual(analyzeMain(long));
    expect(analyze(long).spoofed).toBe(true);
  });
  it('with a fork option it is too big', () => {
    expect(analyze(long, { confusionModel: 'alphabet' }).spoofed).toBe(false);
    expect(analyze(long, { hiddenChars: 'strict' }).spoofed).toBe(false);
  });
});

describe('lenient analyze: invisible runs outside words are found in the word pass', () => {
  it('as upstream: removed, a finding, a report of their own kind', () => {
    const t = 'click ⠀ here 12\u200B34';
    const k: string[] = [];
    const r = analyze(t, {}, { onReport: (m) => void k.push(`${m.kind}:${m.extracted}`) });
    expect(r).toEqual(analyzeMain(t));
    expect(k).toEqual(['invisibleOutsideWord:⠀', 'invisibleOutsideWord:\u200B']);
  });
});

describe('decision 14: the Latin model’s reason carries converted and toLang', () => {
  it('a fold under the Latin model', () => {
    expect(words('pаypal')).toEqual([
      [0, 6, 'pаypal', 'paypal', { signals: ['mixed_script'], converted: true, toLang: 'English' }],
    ]);
  });
});

describe('decision 28b: stacked marks only through phase 1, in strict analyze too', () => {
  it('marks within the limit stay; the rest go and are reported', () => {
    const t = `ok a${'\u0301'.repeat(5)} ok`;
    for (const o of [{ hiddenChars: 'strict' }, BOTH] as const) {
      const r = analyze(t, o);
      expect(r.normalized.normalize('NFC')).toBe(`ok ${'a\u0301\u0301'.normalize('NFC')} ok`);
      expect(r.words.map((w) => w.signals)).toEqual([['zalgo']]);
    }
    expect(analyze(t).normalized).toBe('ok a ok'); // lenient: upstream's zalgo
  });
});

describe('decisions 30a, 31a: compatibility letters are neutral, on by default in strict', () => {
  it('fullwidth, mathematical and ligatures', () => {
    const S = { hiddenChars: 'strict' } as const;
    expect(analyze('Ｇｅｔ 𝐅𝐑𝐄𝐄 ﬁle', S).normalized).toBe('Get FREE file');
    expect(analyze('Ｇｅｔ 𝐅𝐑𝐄𝐄 ﬁle', BOTH).normalized).toBe('Get FREE file');
  });
  it('decision 31a: under the Latin model the letter is Latin before the word is judged', () => {
    expect(analyze('pⓐypal', { hiddenChars: 'strict' }).normalized).toBe('paypal');
    expect(analyze('Brand® now', { hiddenChars: 'strict' }).normalized).toBe('Brand® now');
  });
  it('off: upstream’s styled-word handling', () => {
    expect(
      analyze('Ｇｅｔ', { hiddenChars: 'strict', neutralAlphabet: false }).words[0]?.signals,
    ).toEqual(['confusable_word']);
  });
});

describe('decisions 34–36: foreign scripts under the alphabet model', () => {
  const A = { confusionModel: 'alphabet' } as const;
  const sig = (t: string, o: object = A) => analyze(t, o).words.map((w) => w.signals);
  it('decision 36a: a spaceless other script is mixed_legitimate, not a spoof', () => {
    expect(sig('iPhone用')).toEqual([['mixed_legitimate']]);
    expect(sig('ABC株式会社XYZ')).toEqual([['mixed_legitimate']]);
    expect(analyze('iPhone用', A).spoofed).toBe(false);
  });
  it('decision 36a: converted look-alikes are mixed_spoof; spaced scripts glued, mixed_non_legitimate', () => {
    expect(sig('pаypal用')).toEqual([['mixed_spoof']]);
    // No target letter: no category (review 10).
    expect(sig('שלוםمرحبا')).toEqual([]);
    expect(sig('testשלם')).toEqual([['mixed_non_legitimate']]);
    expect(analyze('testשלם', A).spoofed).toBe(false);
  });
  it('decision 35: foreign letters are never folded', () => {
    expect(analyze('pаypal用', A).normalized).toBe('paypal用');
  });
  it('decision 36a replaces placement C as a spoof rule (pa株ypal is mixed_legitimate)', () => {
    expect(sig('pa株ypal')).toEqual([['mixed_legitimate']]);
    expect(analyze('pa株ypal', A).spoofed).toBe(false);
  });
  it('upstream’s path is unaffected', () => {
    expect(analyze('pa株ypal')).toEqual(analyzeMain('pa株ypal'));
  });
});

describe('designed changes against main (ported branches, owner decisions)', () => {
  it('IVS: a supplement selector not registered for its base is a payload (per-base IVD table)', () => {
    expect(cleanHidden('辻\u{E0100}')).toBe('辻\u{E0100}');
    expect(cleanHidden('辻\u{E0151}')).toBe('辻');
    expect(reference.cleanHidden('辻\u{E0151}').cleaned).toBe('辻\u{E0151}');
  });
  it('U+009B before a word is cp1252 `›`, not a CSI', () => {
    expect(reference.cleanHidden('Home \u009BProducts').cleaned).toBe('Home roducts');
    expect(cleanHidden('Home \u009BProducts')).toBe('Home Products');
  });
});

describe('stress: mixed callbacks never change the library’s results', () => {
  const inputs = [...corpus, ...randomStrings(600), ...randomStrings(300, TERM_ALPHABET, 9)];
  const modes: Record<string, AnalyzeCallbacks> = {
    keepAll: { onCleanup: (r) => r.original },
    text: { onCleanup: () => '[h]', onWord: () => void 0 },
    empty: { onCleanup: () => '' },
    mixed: { onCleanup: (r, c) => (r.start % 2 ? c : r.original) },
    annotate: { onCleanup: (r, c) => `${c}(+${r.length})`, onReport: () => void 0 },
  };
  it.each(Object.entries(modes))('%s', { timeout: 120_000 }, (name, cbs) => {
    for (const s of inputs) {
      for (const [rules, o] of [
        [STRICT, BOTH],
        [TERM, { ...BOTH, hiddenCharRules: { terminal: {} } }],
      ] as const) {
        const recs: OutputRecord[] = [];
        expect(cleanHidden(s, rules, { ...cbs, onRecord: (r) => void recs.push(r) })).toEqual(
          cleanHidden(s, rules),
        );
        const out = checkRecords(s, recs);
        if (name === 'keepAll') expect(out).toBe(s);
        const arecs: OutputRecord[] = [];
        expect(analyze(s, o, { ...cbs, onRecord: (r) => void arecs.push(r) })).toEqual(
          analyze(s, o),
        );
        checkRecords(s, arecs);
      }
    }
  });
});

describe('fuzz: record invariant over rule sets', () => {
  const sets: Record<string, HiddenCharRules> = {
    strict: STRICT,
    main: { ...STRICT, ...MAIN_RULES },
    withContent: { ...STRICT, bidiOverrides: 'remove-with-content' },
    terminal: TERM,
    keepAll: Object.fromEntries(
      Object.entries(STRICT).map(([k, v]) => [k, typeof v === 'string' ? 'keep' : v]),
    ) as unknown as HiddenCharRules,
  };
  it.each(Object.entries(sets))('%s', { timeout: 120_000 }, (_n, rules) => {
    for (const s of [...randomStrings(1500), ...randomStrings(600, TERM_ALPHABET, 4)]) {
      expect(checkRecords(s, records(s, rules))).toBe(cleanHidden(s, rules));
      const recs: OutputRecord[] = [];
      analyze(
        s,
        { hiddenChars: 'strict', hiddenCharRules: rules },
        { onRecord: (r) => void recs.push(r) },
      );
      checkRecords(s, recs);
    }
  });
});

describe('abort on the ~1 MB text', () => {
  it('stops after 50 report calls', { timeout: 60_000 }, async () => {
    const { buildRealisticMarkdown } = (await import(
      join(__dirname, '..', 'scripts', 'realistic-text.mjs') as string
    )) as {
      buildRealisticMarkdown: (o: object) => string;
    };
    const text = buildRealisticMarkdown({ targetBytes: 1 << 20, seed: 1, cases: corpus });
    const ac = new AbortController();
    let calls = 0;
    const r = analyze(text, BOTH, {
      signal: ac.signal,
      onReport: () => {
        if (++calls === 50) ac.abort();
      },
    });
    expect(calls).toBe(50);
    expect(r.normalized.length).toBeLessThan(text.length);
  });
});

describe('folds keep letter order; lenient invisible runs, erased bidi marks, decision-3 mode names', () => {
  it('A1: a fold that composes or drops characters keeps the letters in order', () => {
    expect(analyze('Pа́yⓟal', BOTH).normalized).toBe('Páypal');
    expect(analyze('cоmе́ⓓy', BOTH).normalized).toBe('comédy');
    expect(analyze('ᾳlⓟha', BOTH).normalized).toBe('aͅlpha');
    expect(analyze('pa​ypa株l', { confusionModel: 'alphabet' }).normalized).toBe('paypa株l');
  });
  it('A2: lenient invisible runs outside words are phase 1’s again: position order, cleanup, records', () => {
    const t = 'ab ⁣⁣ c\u0001d ‮ e�f раураl';
    const rep: string[] = [];
    let cleanups = 0;
    const r = analyze(
      t,
      {},
      {
        onReport: (m) => void rep.push(`${m.kind}@${m.start}`),
        onCleanup: () => void cleanups++,
      },
    );
    expect(rep).toEqual([
      'invisibleOutsideWord@3',
      'illegal@7',
      'invisibleOutsideWord@10',
      'encodingDamage@13',
    ]);
    expect(cleanups).toBe(3);
    expect(r).toEqual(analyzeMain(t));
  });
  it('A3: a bidi mark whose only right-to-left letter was erased is removed', () => {
    expect(cleanHidden('ב\b⁦', TERM)).toBe('');
    expect(cleanHidden('A‏א\bB', TERM)).toBe('AB');
  });
  it('A4: the mode names of decision 3 work beside the old ones', () => {
    const k: string[] = [];
    expect(
      cleanHidden(
        'a­b',
        { ...STRICT, softHyphen: 'report' },
        { onReport: (m) => void k.push(m.kind) },
      ),
    ).toBe('a­b');
    expect(k).toEqual(['softHyphen']);
    expect(cleanHidden('a­b', { ...STRICT, softHyphen: 'cleanup' })).toBe('ab');
    expect(cleanHidden(`a${E}[31mb`, { ...STRICT, terminal: { sgr: 'report' } })).toBe(
      `a${E}[31mb`,
    );
    expect(cleanHidden(`a${E}[31mb`, { ...STRICT, terminal: { sgr: 'cleanup' } })).toBe('ab');
  });
  it('A5: an erase area is reported once, with all its letters and backspaces', () => {
    expect(
      reports(`ab${E}[31m\b\bcd`, TERM).map((m) => [
        m.kind,
        m.start,
        m.length,
        m.extracted,
        m.count,
      ]),
    ).toEqual([
      ['backspace', 0, 9, 'ab', 2],
      ['sgr', 2, 5, null, 1],
    ]);
  });
});
