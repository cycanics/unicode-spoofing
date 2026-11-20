/**
 * DEC/ANSI escape-sequence parser: the state machine by Paul Williams
 * (https://vt100.net/emu/dec_ansi_parser), table-driven, as xterm and xterm.js
 * follow it. It parses one sequence from its ESC (or U+009B) and reports its
 * extent, kind, parameters and the C0 controls executed inside it.
 *
 * Two points follow xterm.js (`VT500_TRANSITION_TABLE` in
 * src/common/parser/EscapeSequenceParser.ts) where it refines vt100.net:
 * - `:` (0x3A) is a parameter byte in csi_entry/csi_param and dcs_entry/dcs_param
 *   (colon sub-parameters, `38:5:1`); vt100.net sends it to csi_ignore/dcs_ignore.
 * - Code points from U+00A0 up (vt100.net is byte-oriented) form one class: ignored
 *   in csi_ignore and dcs_ignore, body in every string body (dcs_passthrough,
 *   osc_string, sos_pm_apc_string: vt100.net swallows a SOS/PM/APC body up to its
 *   terminator), an error everywhere else (the sequence is aborted, the
 *   character consumed).
 *
 * String sequences (decision 7) end at their terminator wherever it is, across
 * line breaks; only when the text has none later do they end at their line end.
 */

/** Remembers a failed terminator search (decision 7): string bodies starting at or after `noTerminatorFrom` have no terminator. */
export interface StringMemo {
  noTerminatorFrom: number;
  /** Decision 42e: how far a string body may run to its terminator, in code points. */
  limit: number;
}
export const newStringMemo = (limit = STRING_LIMIT): StringMemo => ({
  noTerminatorFrom: Infinity,
  limit,
});
/** Decision 42e: the default reach of an escape string's body, in code points (16 Mi). */
export const STRING_LIMIT = 16 * 1024 * 1024;

export type SequenceKind = 'csi' | 'esc' | 'osc' | 'dcs' | 'sos' | 'pm' | 'apc' | 'ignored';

export interface Parsed {
  /** Position of the ESC (or U+009B) the sequence starts at. */
  start: number;
  /** Exclusive end: after the last character the sequence consumed. An ESC or C1 introducer that aborts it is not consumed (the caller parses a new sequence there). */
  end: number;
  /** 'ignored': invalid or aborted (CAN/SUB, an ESC or C1 in the middle, csi_ignore, an error character, the text ends inside it): consumed, no effect. */
  kind: SequenceKind;
  /** CSI/ESC/DCS: parameter bytes 0x30–0x3F in order (private markers included), intermediates 0x20–0x2F, the final character code (-1 when none). */
  params: string;
  intermediates: string;
  final: number;
  /** String sequences (OSC, DCS, SOS, PM, APC): the body range, after the introducer up to (not including) the terminator; null otherwise. */
  body: { start: number; end: number } | null;
  /** String sequences: ended by a terminator (true) or at the line end because none exists later (false). */
  terminated: boolean;
  /** Decision 42e: a string whose terminator did not come within its limit (it ended at its line end). */
  lost: boolean;
  /** Positions of C0 controls executed inside the sequence (CSI and escape states): not part of the sequence's own text; the caller handles each as if it stood outside. Ascending. */
  executed: number[];
}

// States. Ground is only the exit and has no row.
const ESCAPE = 0;
const ESCAPE_INTERMEDIATE = 1;
const CSI_ENTRY = 2;
const CSI_PARAM = 3;
const CSI_INTERMEDIATE = 4;
const CSI_IGNORE = 5;
const DCS_ENTRY = 6;
const DCS_PARAM = 7;
const DCS_INTERMEDIATE = 8;
const DCS_PASSTHROUGH = 9;
const DCS_IGNORE = 10;
const OSC_STRING = 11;
const SOS_PM_APC_STRING = 12;
const STATES = 13;

// Character classes.
const C_C0 = 0; // 0x00–0x06, 0x08–0x17, 0x19, 0x1C–0x1F
const C_BEL = 1;
const C_CANSUB = 2; // 0x18, 0x1A
const C_ESC = 3;
const C_INTER = 4; // 0x20–0x2F
const C_PARAM = 5; // 0x30–0x3B (digits, `:`, `;`)
const C_PRIV = 6; // 0x3C–0x3F
const C_FINAL = 7; // 0x40–0x7E other than the introducers below
const C_DCS = 8; // P
const C_SOS = 9; // X
const C_CSI = 10; // [
const C_OSC = 11; // ]
const C_PM = 12; // ^
const C_APC = 13; // _
const C_DEL = 14;
const C_C1 = 15; // 0x80–0x8F, 0x91–0x97, 0x99, 0x9A: abort, consumed
const C_ST = 16; // 0x9C
const C_C1_INTRO = 17; // 0x90, 0x98, 0x9B, 0x9D, 0x9E, 0x9F: abort, not consumed
const C_WIDE = 18; // U+00A0 and up
const CLASSES = 19;

// Actions.
const A_IGNORE = 0; // consumed, no effect
const A_EXECUTE = 1;
const A_PARAM = 2;
const A_COLLECT = 3;
const A_ESC_DISPATCH = 4;
const A_CSI_DISPATCH = 5;
const A_ABORT = 6; // ends the sequence as 'ignored', consumed
const A_ABORT_BEFORE = 7; // ends the sequence as 'ignored', not consumed
const A_STRING = 8; // enters a string state
const A_HOOK = 9; // DCS final: the data follows
const A_STRING_END = 10; // BEL or ST: terminator, consumed
const A_STRING_ESC = 11; // ESC in a string: ends it; `ESC \` is consumed

const CLASS_OF = new Uint8Array(0xa0);
{
  const set = (from: number, to: number, cls: number) => CLASS_OF.fill(cls, from, to + 1);
  set(0x00, 0x1f, C_C0);
  set(0x07, 0x07, C_BEL);
  set(0x18, 0x18, C_CANSUB);
  set(0x1a, 0x1a, C_CANSUB);
  set(0x1b, 0x1b, C_ESC);
  set(0x20, 0x2f, C_INTER);
  set(0x30, 0x3b, C_PARAM);
  set(0x3c, 0x3f, C_PRIV);
  set(0x40, 0x7e, C_FINAL);
  set(0x50, 0x50, C_DCS);
  set(0x58, 0x58, C_SOS);
  set(0x5b, 0x5b, C_CSI);
  set(0x5d, 0x5d, C_OSC);
  set(0x5e, 0x5e, C_PM);
  set(0x5f, 0x5f, C_APC);
  set(0x7f, 0x7f, C_DEL);
  set(0x80, 0x9f, C_C1);
  set(0x9c, 0x9c, C_ST);
  for (const c of [0x90, 0x98, 0x9b, 0x9d, 0x9e, 0x9f]) set(c, c, C_C1_INTRO);
}
const classOf = (c: number) => (c < 0xa0 ? CLASS_OF[c] : C_WIDE);

/** Transition table: `TABLE[state * CLASSES + class]` = action << 4 | next state. */
const TABLE = new Uint8Array(STATES * CLASSES);
{
  const on = (states: number[], classes: number[], action: number, next?: number) => {
    for (const s of states)
      for (const c of classes) TABLE[s * CLASSES + c] = (action << 4) | (next ?? s);
  };
  const ALL = Array.from({ length: STATES }, (_, s) => s);
  const FINALS = [C_FINAL, C_DCS, C_SOS, C_CSI, C_OSC, C_PM, C_APC]; // 0x40–0x7E
  const PRINTABLE = [C_INTER, C_PARAM, C_PRIV, ...FINALS, C_DEL];
  const STRINGS = [
    DCS_ENTRY,
    DCS_PARAM,
    DCS_INTERMEDIATE,
    DCS_PASSTHROUGH,
    DCS_IGNORE,
    OSC_STRING,
    SOS_PM_APC_STRING,
  ];
  const ESC_CSI = [ESCAPE, ESCAPE_INTERMEDIATE, CSI_ENTRY, CSI_PARAM, CSI_INTERMEDIATE, CSI_IGNORE];
  const DCS_HEADER = [DCS_ENTRY, DCS_PARAM, DCS_INTERMEDIATE];

  // anywhere; U+00A0 and up an error unless a state says otherwise
  on(ALL, [C_CANSUB, C_C1, C_ST, C_WIDE], A_ABORT);
  on(ALL, [C_ESC, C_C1_INTRO], A_ABORT_BEFORE);
  // escape and CSI states: C0 executed, DEL ignored
  on(ESC_CSI, [C_C0, C_BEL], A_EXECUTE);
  on(ESC_CSI, [C_DEL], A_IGNORE);

  on([ESCAPE], [C_INTER], A_COLLECT, ESCAPE_INTERMEDIATE);
  on([ESCAPE], [C_PARAM, C_PRIV, C_FINAL], A_ESC_DISPATCH);
  on([ESCAPE], [C_CSI], A_IGNORE, CSI_ENTRY);
  on([ESCAPE], [C_DCS], A_STRING, DCS_ENTRY);
  on([ESCAPE], [C_OSC], A_STRING, OSC_STRING);
  on([ESCAPE], [C_SOS, C_PM, C_APC], A_STRING, SOS_PM_APC_STRING);

  on([ESCAPE_INTERMEDIATE], [C_INTER], A_COLLECT);
  on([ESCAPE_INTERMEDIATE], [C_PARAM, C_PRIV, ...FINALS], A_ESC_DISPATCH);

  on([CSI_ENTRY], [C_INTER], A_COLLECT, CSI_INTERMEDIATE);
  on([CSI_ENTRY], [C_PARAM, C_PRIV], A_PARAM, CSI_PARAM);
  on([CSI_ENTRY, CSI_PARAM, CSI_INTERMEDIATE], FINALS, A_CSI_DISPATCH);
  on([CSI_PARAM], [C_PARAM], A_PARAM);
  on([CSI_PARAM], [C_PRIV], A_IGNORE, CSI_IGNORE);
  on([CSI_PARAM], [C_INTER], A_COLLECT, CSI_INTERMEDIATE);
  on([CSI_INTERMEDIATE], [C_INTER], A_COLLECT);
  on([CSI_INTERMEDIATE], [C_PARAM, C_PRIV], A_IGNORE, CSI_IGNORE);
  on([CSI_IGNORE], [C_INTER, C_PARAM, C_PRIV, C_WIDE], A_IGNORE);
  on([CSI_IGNORE], FINALS, A_ABORT);

  // string states: the body runs to the terminator (decision 7)
  on(STRINGS, [C_C0, ...PRINTABLE], A_IGNORE);
  on(STRINGS, [C_BEL, C_ST], A_STRING_END);
  on(STRINGS, [C_ESC], A_STRING_ESC);
  on([DCS_PASSTHROUGH, DCS_IGNORE, OSC_STRING, SOS_PM_APC_STRING], [C_WIDE], A_IGNORE);
  on([DCS_ENTRY], [C_INTER], A_COLLECT, DCS_INTERMEDIATE);
  on([DCS_ENTRY], [C_PARAM, C_PRIV], A_PARAM, DCS_PARAM);
  on(DCS_HEADER, FINALS, A_HOOK, DCS_PASSTHROUGH);
  on([DCS_PARAM], [C_PARAM], A_PARAM);
  on([DCS_PARAM], [C_PRIV], A_IGNORE, DCS_IGNORE);
  on([DCS_PARAM], [C_INTER], A_COLLECT, DCS_INTERMEDIATE);
  on([DCS_INTERMEDIATE], [C_INTER], A_COLLECT);
  on([DCS_INTERMEDIATE], [C_PARAM, C_PRIV], A_IGNORE, DCS_IGNORE);
}

/** The characters that can end a string body: BEL, CAN, SUB, ESC, C1. */
// eslint-disable-next-line no-control-regex -- control characters are the point
const TERMINATOR_RE = /[\x07\x18\x1a\x1b\x80-\x9f]/g;
const LINE_END_RE = /[\r\n]/g;

const STRING_KIND: Record<number, SequenceKind> = {
  [C_DCS]: 'dcs',
  [C_OSC]: 'osc',
  [C_SOS]: 'sos',
  [C_PM]: 'pm',
  [C_APC]: 'apc',
};

/** Parses the sequence at `i` (text[i] is ESC U+001B or C1 CSI U+009B). Never returns end <= i. */
export function parseSequence(text: string, i: number, memo: StringMemo): Parsed {
  const n = text.length;
  const executed: number[] = [];
  let params = '';
  let intermediates = '';
  let final = -1;
  let state = text.charCodeAt(i) === 0x9b ? CSI_ENTRY : ESCAPE;
  let kind: SequenceKind = 'ignored';
  // string sequences: body start, where the body stops, and whether a terminator is there
  let bodyStart = -1;
  let stop = -1;
  let terminated = false;

  const done = (k: SequenceKind, end: number, bodyEnd = end, lineEnd = false): Parsed => ({
    start: i,
    end,
    kind: k,
    params,
    intermediates,
    final,
    body: bodyStart < 0 ? null : { start: bodyStart, end: bodyEnd },
    terminated: bodyStart >= 0 && !lineEnd,
    lost: bodyStart >= 0 && lineEnd,
    executed,
  });
  /** The kind a string has when it ends now: a DCS whose header did not finish is ignored. */
  const stringKind = () => (state === DCS_PASSTHROUGH || state > DCS_IGNORE ? kind : 'ignored');

  let j = i + 1;
  for (;;) {
    // these bodies run to their stop; a DCS header and SOS/PM/APC are read character by character
    if (state === OSC_STRING || state === DCS_PASSTHROUGH || state === DCS_IGNORE) j = stop;
    if (j >= n || (j === stop && !terminated)) {
      // text end, or a string's line end when no terminator exists later
      return bodyStart < 0 ? done('ignored', n) : done(stringKind(), j, j, true);
    }
    const c = text.charCodeAt(j);
    const width = c >= 0xd800 && c <= 0xdbff && j + 1 < n && isLow(text.charCodeAt(j + 1)) ? 2 : 1;
    const t = TABLE[state * CLASSES + classOf(c)];
    switch (t >> 4) {
      case A_IGNORE:
        break;
      case A_EXECUTE:
        executed.push(j);
        break;
      case A_PARAM:
        params += text[j];
        break;
      case A_COLLECT:
        intermediates += text[j];
        break;
      case A_ESC_DISPATCH:
        final = c;
        return done('esc', j + 1);
      case A_CSI_DISPATCH:
        final = c;
        return done('csi', j + 1);
      case A_ABORT:
        return done('ignored', j + width, j);
      case A_ABORT_BEFORE:
        return done('ignored', j);
      case A_STRING:
        kind = STRING_KIND[classOf(c)];
        bodyStart = j + 1;
        [stop, terminated] = findStop(text, bodyStart, memo);
        break;
      case A_HOOK:
        final = c;
        break;
      case A_STRING_END:
        return done(stringKind(), j + 1, j);
      case A_STRING_ESC: // ST `ESC \` is consumed; another ESC starts the next sequence
        return done(stringKind(), text.charCodeAt(j + 1) === 0x5c ? j + 2 : j, j);
    }
    state = t & 15;
    j += width;
  }
}

const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/**
 * Where a string body starting at `from` stops: its first terminator candidate
 * (true), or, when the text has none later, its line end (false).
 */
/** Whether [a, b) holds at most `limit` code points. */
function withinCodePoints(text: string, a: number, b: number, limit: number): boolean {
  if (b - a <= limit) return true;
  if (b - a > 2 * limit) return false;
  let n = 0;
  for (let p = a; p < b && n <= limit; p += text.codePointAt(p)! > 0xffff ? 2 : 1) n++;
  return n <= limit;
}

function findStop(text: string, from: number, memo: StringMemo): [number, boolean] {
  if (from < memo.noTerminatorFrom) {
    TERMINATOR_RE.lastIndex = from;
    const m = TERMINATOR_RE.exec(text);
    // Decision 42e: a terminator past the limit is lost; the body ends at its line end.
    if (m && withinCodePoints(text, from, m.index, memo.limit)) return [m.index, true];
    if (!m) memo.noTerminatorFrom = from;
  }
  LINE_END_RE.lastIndex = from;
  const m = LINE_END_RE.exec(text);
  return [m ? m.index : text.length, false];
}
