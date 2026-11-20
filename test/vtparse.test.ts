/** The DEC/ANSI escape-sequence parser (src/vtparse.ts): decisions 7 and 7a. */
import { describe, it, expect } from 'vitest';
import { newStringMemo, parseSequence, type Parsed } from '../src/vtparse';

const E = '\u001b';
const parse = (text: string, i = 0) => parseSequence(text, i, newStringMemo());
const pick = (p: Parsed) => ({ end: p.end, kind: p.kind, params: p.params, final: p.final });

describe('decision 7a: CSI', () => {
  it('dispatches parameters, private marker and final', () => {
    expect(pick(parse(`${E}[?25hx`))).toEqual({ end: 6, kind: 'csi', params: '?25', final: 0x68 });
    expect(parse(`${E}[1 q`)).toMatchObject({ end: 5, kind: 'csi', intermediates: ' ' });
  });

  it('starts at C1 CSI U+009B', () => {
    expect(pick(parse('\u009b2J'))).toEqual({ end: 3, kind: 'csi', params: '2', final: 0x4a });
  });

  it('takes colon sub-parameters as parameters (xterm.js)', () => {
    expect(pick(parse(`${E}[38:5:1m`))).toEqual({
      end: 9,
      kind: 'csi',
      params: '38:5:1',
      final: 0x6d,
    });
    expect(parse(`${E}[:1m`).kind).toBe('csi');
  });

  it('executes C0 controls inside it, BS CR LF included, and goes on', () => {
    const p = parse(`${E}[1\b;\r2\nm`);
    expect(pick(p)).toEqual({ end: 9, kind: 'csi', params: '1;2', final: 0x6d });
    expect(p.executed).toEqual([3, 5, 7]);
  });

  it('ignores DEL inside it', () => {
    expect(pick(parse(`${E}[1\u007f2m`))).toEqual({
      end: 6,
      kind: 'csi',
      params: '12',
      final: 0x6d,
    });
  });

  it('a parameter after an intermediate makes it csi_ignore up to the final', () => {
    const p = parse(`${E}[1 2mx`);
    expect(p).toMatchObject({ end: 6, kind: 'ignored' });
  });

  it('a private marker after a parameter makes it csi_ignore', () => {
    expect(parse(`${E}[1?2hx`)).toMatchObject({ end: 6, kind: 'ignored' });
  });

  it('csi_ignore executes C0 and ignores U+00A0 and up', () => {
    const p = parse(`${E}[1 2é\b漢mx`);
    expect(p).toMatchObject({ end: 9, kind: 'ignored', executed: [6] });
  });

  it('a character from U+00A0 up is an error: aborted, consumed (xterm.js)', () => {
    expect(parse(`${E}[1éJ`)).toMatchObject({ end: 4, kind: 'ignored' });
    expect(parse(`${E}(é`)).toMatchObject({ end: 3, kind: 'ignored' });
    expect(parse(`${E}é`)).toMatchObject({ end: 2, kind: 'ignored' });
  });

  it('an astral character counts as one: both code units consumed', () => {
    expect(parse(`${E}[1\u{1F600}J`)).toMatchObject({ end: 5, kind: 'ignored' });
    expect(parse(`${E}[1 2\u{1F600}m`)).toMatchObject({ end: 8, kind: 'ignored' });
  });

  it('ESC inside it aborts it and is not consumed', () => {
    expect(parse(`${E}[12${E}[m`)).toMatchObject({ end: 4, kind: 'ignored' });
  });

  it('CAN and SUB abort it and are consumed', () => {
    expect(parse(`${E}[12\u0018m`)).toMatchObject({ end: 5, kind: 'ignored' });
    expect(parse(`${E}[12\u001am`)).toMatchObject({ end: 5, kind: 'ignored' });
  });

  it('C1 controls abort it: consumed, except the introducers', () => {
    expect(parse(`${E}[1\u0085m`)).toMatchObject({ end: 4, kind: 'ignored' });
    expect(parse(`${E}[1\u009cm`)).toMatchObject({ end: 4, kind: 'ignored' });
    expect(parse(`${E}[1\u009b2J`)).toMatchObject({ end: 3, kind: 'ignored' });
    expect(parse(`${E}[1\u009d0\u0007`)).toMatchObject({ end: 3, kind: 'ignored' });
  });

  it('the text ending inside it: ignored, consumed to the end', () => {
    expect(parse(`${E}[1;\b`)).toMatchObject({ end: 5, kind: 'ignored', executed: [4] });
  });
});

describe('decision 7a: ESC', () => {
  it('SS2 dispatches on its final only: the next character is not part of it', () => {
    expect(pick(parse(`${E}Nx`))).toEqual({ end: 2, kind: 'esc', params: '', final: 0x4e });
  });

  it('nF sequences: intermediates then a final', () => {
    expect(parse(`${E}(Bx`)).toMatchObject({
      end: 3,
      kind: 'esc',
      intermediates: '(',
      final: 0x42,
    });
    expect(parse(`${E}#8`)).toMatchObject({ end: 3, kind: 'esc', intermediates: '#', final: 0x38 });
  });

  it('C0 controls after ESC are executed, then `[` starts a CSI', () => {
    const p = parse(`${E}\b\r[2J`);
    expect(pick(p)).toEqual({ end: 6, kind: 'csi', params: '2', final: 0x4a });
    expect(p.executed).toEqual([1, 2]);
  });

  it('DEL after ESC is ignored', () => {
    expect(parse(`${E}\u007fc`)).toMatchObject({ end: 3, kind: 'esc', final: 0x63 });
  });

  it('ESC after ESC aborts the first, not consumed', () => {
    expect(parse(`${E}${E}c`)).toMatchObject({ end: 1, kind: 'ignored' });
  });

  it('ESC at the last position: ignored, end after it', () => {
    expect(parse(`ab${E}`, 2)).toMatchObject({ start: 2, end: 3, kind: 'ignored' });
  });
});

describe('decision 7: string sequences', () => {
  it('OSC ends at BEL, consumed', () => {
    expect(parse(`${E}]0;title\u0007x`)).toMatchObject({
      end: 10,
      kind: 'osc',
      body: { start: 2, end: 9 },
      terminated: true,
    });
  });

  it('ST `ESC \\` ends it, both consumed', () => {
    expect(parse(`${E}]0;t${E}\\x`)).toMatchObject({
      end: 7,
      kind: 'osc',
      body: { start: 2, end: 5 },
    });
  });

  it('U+009C ends it, consumed', () => {
    expect(parse(`${E}_data\u009cx`)).toMatchObject({
      end: 7,
      kind: 'apc',
      body: { start: 2, end: 6 },
    });
  });

  it('CAN and SUB abort it, consumed', () => {
    expect(parse(`${E}]0;t\u0018x`)).toMatchObject({
      end: 6,
      kind: 'ignored',
      body: { start: 2, end: 5 },
    });
    expect(parse(`${E}^pm\u001ax`)).toMatchObject({ end: 5, kind: 'ignored' });
  });

  it('another ESC ends it, not consumed', () => {
    expect(parse(`${E}]0;t${E}[m`)).toMatchObject({ end: 5, kind: 'osc', terminated: true });
  });

  it('a C1 control aborts it: consumed, except the introducers', () => {
    expect(parse(`${E}]0;t\u0085x`)).toMatchObject({ end: 6, kind: 'ignored' });
    expect(parse(`${E}]0;t\u009b2J`)).toMatchObject({ end: 5, kind: 'ignored' });
  });

  it('C0 controls and CR/LF are part of the body: the terminator is searched across lines', () => {
    const text = `${E}]0;a\nb\r\bc\u0007d`;
    expect(parse(text)).toMatchObject({
      end: text.length - 1,
      kind: 'osc',
      body: { start: 2, end: text.length - 2 },
      terminated: true,
      executed: [],
    });
  });

  it('with no terminator later, the body ends at its line end, not consumed', () => {
    expect(parse(`${E}]0;a\nb`)).toMatchObject({
      end: 5,
      kind: 'osc',
      body: { start: 2, end: 5 },
      terminated: false,
    });
    expect(parse(`${E}Xsos`)).toMatchObject({ end: 5, kind: 'sos', terminated: false });
  });

  it('the memo remembers a failed search; a string starting at or after it does not search', () => {
    const memo = newStringMemo();
    const text = `ab${E}]a\nb`;
    expect(parseSequence(text, 2, memo)).toMatchObject({ end: 5, terminated: false });
    expect(memo.noTerminatorFrom).toBe(4);
    expect(parseSequence(text, 2, memo)).toMatchObject({ end: 5, kind: 'osc', terminated: false });
    // the memo is trusted: a terminator after it is not looked for
    const memo2 = { noTerminatorFrom: 2, limit: Infinity };
    expect(parseSequence(`${E}]a\u0007\nb`, 0, memo2)).toMatchObject({
      end: 4,
      body: { start: 2, end: 4 },
      terminated: false,
    });
    expect(memo2.noTerminatorFrom).toBe(2);
    // a search that finds a terminator leaves it alone
    expect(parseSequence(`${E}]a\u0007`, 0, memo)).toMatchObject({ end: 4, terminated: true });
    expect(memo.noTerminatorFrom).toBe(4);
  });

  it('DCS: the header is parsed, BEL ends it, the body is everything after `P`', () => {
    expect(parse(`${E}P1;2$qm\u0007x`)).toMatchObject({
      end: 9,
      kind: 'dcs',
      params: '1;2',
      intermediates: '$',
      final: 0x71,
      body: { start: 2, end: 8 },
    });
  });

  it('DCS: C0 and DEL in the header are ignored, the data keeps C0 controls', () => {
    expect(parse(`${E}P1\r\u007fq\bdata${E}\\`)).toMatchObject({
      end: 13,
      kind: 'dcs',
      params: '1',
      final: 0x71,
      executed: [],
    });
  });

  it('DCS: a header with no final is ignored', () => {
    expect(parse(`${E}P1;2\u0007`)).toMatchObject({
      end: 6,
      kind: 'ignored',
      body: { start: 2, end: 5 },
    });
  });

  it('DCS: a private marker after a parameter makes it dcs_ignore, to the terminator', () => {
    expect(parse(`${E}P1?qé${E}\\`)).toMatchObject({ end: 8, kind: 'ignored', terminated: true });
  });

  it('DCS: a character from U+00A0 up in the header is an error, consumed', () => {
    expect(parse(`${E}P1é2q\u0007`)).toMatchObject({ end: 4, kind: 'ignored' });
  });

  it('OSC and DCS data take characters from U+00A0 up, astral ones included', () => {
    expect(parse(`${E}]0;é\u{1F600}\u0007`)).toMatchObject({ end: 8, kind: 'osc' });
    expect(parse(`${E}Pqé\u{1F600}\u0007`)).toMatchObject({ end: 7, kind: 'dcs' });
  });

  it('SOS/PM/APC bodies take characters from U+00A0 up, like the other strings', () => {
    expect(parse(`${E}^ab\u{1F600}cd\u0007`)).toMatchObject({ end: 9, kind: 'pm' });
    expect(parse(`${E}Xé\u0007`)).toMatchObject({ end: 4, kind: 'sos' });
    expect(parse(`${E}_héllo secret${E}\\`)).toMatchObject({ end: 16, kind: 'apc' });
  });

  it('BEL ends SOS, PM and APC too', () => {
    expect(parse(`${E}Xa\u0007`)).toMatchObject({ end: 4, kind: 'sos', terminated: true });
    expect(parse(`${E}^a\u0007`)).toMatchObject({ end: 4, kind: 'pm', terminated: true });
    expect(parse(`${E}_a\u0007`)).toMatchObject({ end: 4, kind: 'apc', terminated: true });
  });

  it('a string introducer at the text end: an empty body, ended at the text end', () => {
    expect(parse(`${E}]`)).toMatchObject({ end: 2, kind: 'osc', body: { start: 2, end: 2 } });
  });
});

describe('decision 7a: properties on random input', () => {
  const ALPHABET = [
    E, E, E, '[', ']', 'P', 'X', '^', '_', '\\', '0', '1', '9', ';', ':', '?', '<', '=', '>',
    '!', '$', ' ', '#', '(', 'm', 'q', 'B', 'N', 'c', 'J', '~', 'a', 'z',
    '\b', '\r', '\n', '\u0007', '\u0018', '\u001a', '\u0000', '\u001f', '\u007f',
    '\u0085', '\u009b', '\u009c', '\u009d', 'é', '漢', '\u{1F600}',
  ]; // prettier-ignore

  it('2 000 seeded strings: end > start, executed and body inside the sequence', () => {
    let seed = 42;
    const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32;
    for (let n = 0; n < 2000; n++) {
      const text = Array.from(
        { length: 1 + Math.floor(rnd() * 30) },
        () => ALPHABET[Math.floor(rnd() * ALPHABET.length)],
      ).join('');
      const memo = newStringMemo();
      for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c !== 0x1b && c !== 0x9b) continue;
        const p = parseSequence(text, i, memo);
        expect(p.start).toBe(i);
        expect(p.end).toBeGreaterThan(i);
        expect(p.end).toBeLessThanOrEqual(text.length);
        let last = i;
        for (const e of p.executed) {
          expect(e).toBeGreaterThan(last);
          expect(e).toBeLessThan(p.end);
          last = e;
        }
        if (p.body) {
          expect(p.body.start).toBeGreaterThan(i);
          expect(p.body.start).toBeLessThanOrEqual(p.body.end);
          expect(p.body.end).toBeLessThanOrEqual(p.end);
        }
      }
    }
  });
});
