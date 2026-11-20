/**
 * Terminal controls (docs/confusion-model.md §16, §17.6): escape sequences,
 * bare CR and backspace, parsed by the ECMA-48 grammar and judged by what they
 * do on a terminal screen. Formatting goes silently; what can make text vanish
 * from the screen — cursor moves, backspace, erasing, concealed or same-colour
 * text, strings the terminal swallows, a reset — is counted.
 *
 * Escape sequences are parsed by the DEC/ANSI state machine of src/vtparse.ts
 * (decisions 7, 7a). Backspace (decisions 6, 6a, 8, 25): one forward scan over
 * the rare characters (`\b`, ESC, CR, LF) finds the erase areas; the string is
 * reassembled without them and every other generator runs on it, its
 * positions translated back before the merge compares them.
 */

import type { RawMark } from './core';
import { modeOf, type Action } from './detectors';
import type { HiddenAction, HiddenContentAction } from './hidden';
import {
  newStringMemo,
  parseSequence,
  STRING_LIMIT,
  type Parsed,
  type StringMemo,
} from './vtparse';

export type TerminalClass =
  /** SGR formatting: colours, bold, underline, reset. */
  | 'sgr'
  /** SGR 8: the text after it is drawn invisible. */
  | 'sgrConceal'
  /** An SGR after which foreground and background are the same colour number. */
  | 'sgrSameColor'
  /** Cursor moves and position save/restore: CSI A–H, d, f, s, u, …; ESC 7, ESC 8, ESC M. */
  | 'cursorMove'
  /** An erase area: backspaces and the cells they erase. */
  | 'backspace'
  /** An erase area with more backspaces than cells on its line. */
  | 'backspaceFlood'
  /** Erases or shifts text already written: ED 1–3, EL 1–2, DL, IL, scroll, alternate screen, DECALN. */
  | 'erase'
  /** Erases at and after the cursor: ED 0, EL 0, ECH, DCH, ICH. */
  | 'eraseAhead'
  /** OSC, DCS, SOS, PM, APC: the terminal swallows the string. */
  | 'stringSequence'
  /** RIS (`ESC c`) and DECSTR (`CSI ! p`): the screen or its state is wiped. */
  | 'reset'
  /** Any other sequence: private modes, cursor visibility, character sets, keypad; a lone or broken ESC. */
  | 'otherSequence'
  /** A CR that is not part of a CRLF: a line break (decision 25a). */
  | 'bareCR'
  /** Text drawn concealed (SGR 8) or in its background colour. */
  | 'terminalConcealed';

export const TERMINAL_CLASSES: ReadonlySet<string> = new Set<TerminalClass>([
  'sgr',
  'sgrConceal',
  'sgrSameColor',
  'cursorMove',
  'backspace',
  'backspaceFlood',
  'erase',
  'eraseAhead',
  'stringSequence',
  'reset',
  'otherSequence',
  'bareCR',
  'terminalConcealed',
]);

export interface TerminalRules {
  /**
   * A CR not followed by LF or the end of the text (CR CR LF is a line ending too). A lone CR
   * is a line break in every mode (decision 25a: CR, LF and CRLF). 'keep' or 'report'
   * (default 'keep'): left in the text as written, reported (report mode), not counted.
   * 'newline': replaced by LF, silently. 'ignored': no mark.
   */
  bareCR: 'keep' | 'report' | 'newline' | 'ignored';
  /** Default 'remove-silent': formatting hides nothing. */
  sgr: HiddenAction;
  /** Default 'remove-counted'. */
  sgrConceal: HiddenAction;
  /** Default 'remove-counted'. */
  sgrSameColor: HiddenAction;
  /** Default 'remove-counted'. */
  cursorMove: HiddenAction;
  /** Default 'remove-counted': the backspaces go with the cells they erase. */
  backspace: HiddenAction;
  /** Default 'remove-counted': an area with backspaces left over (more than its line has cells). */
  backspaceFlood: HiddenAction;
  /** Default 'remove-counted'. */
  erase: HiddenAction;
  /** Default 'remove-silent'. */
  eraseAhead: HiddenAction;
  /**
   * Default 'remove-with-content': the string goes whole, body included, as the
   * screen shows it; 'remove-counted' removes the opener and terminator only and
   * leaves the body as text.
   */
  stringSequence: HiddenContentAction;
  /** Default 'remove-counted'. */
  reset: HiddenAction;
  /** Default 'remove-silent'. */
  otherSequence: HiddenAction;
  /** Default 'remove-counted': concealed or same-colour text is removed (and its text reported). */
  terminalConcealed: HiddenAction;
  /** Backspace erases nothing before a line start: after LF or CR (decision 25). Default true. */
  backspaceLineStop: boolean;
  /**
   * Decision 42e: how far an escape string's body (OSC, DCS, SOS, PM, APC) runs to its
   * terminator, in code points; past it, or with none, the body ends at its line end and
   * the lost bound is reported (`onLostBound`). Default 16 MiB, so inline images and
   * clipboard payloads stay whole.
   */
  stringLimit?: number;
}

export const TERMINAL_RULES: Readonly<TerminalRules> = {
  bareCR: 'keep',
  sgr: 'remove-silent',
  sgrConceal: 'remove-counted',
  sgrSameColor: 'remove-counted',
  cursorMove: 'remove-counted',
  backspace: 'remove-counted',
  backspaceFlood: 'remove-counted',
  erase: 'remove-counted',
  eraseAhead: 'remove-silent',
  stringSequence: 'remove-with-content',
  reset: 'remove-counted',
  otherSequence: 'remove-silent',
  terminalConcealed: 'remove-counted',
  backspaceLineStop: true,
};

const ESC = 0x1b;
const CSI8 = 0x9b;
const BS = 0x08;
const LETTER_RE = /^\p{L}/u;
const isAsciiLetter = (c: number) => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);

interface SgrState {
  fg: string | null;
  bg: string | null;
  conceal: boolean;
}

/**
 * A colour by number: basic and bright colours are palette entries 0–15, so
 * `30` = `38;5;0` and `97` = `38;5;15`; other palette entries by index, RGB by
 * value. A palette entry is never equal to an RGB value: that needs the theme.
 */
const pal = (n: number) => (Number.isInteger(n) && n >= 0 && n <= 255 ? `p${n}` : null);
const rgb = (v: string[]) => `rgb${v.map((x) => Number(x || 0)).join(',')}`;

/** Applies SGR parameters (`1;38;5;208`, `38:2::255:0:0`) to the state. */
function applySgr(state: SgrState, params: string): void {
  const list = params === '' ? ['0'] : params.split(';');
  for (let i = 0; i < list.length; i++) {
    const sub = list[i]!.split(':');
    const n = sub[0] === '' ? 0 : Number(sub[0]);
    if (n === 0) resetSgr(state);
    else if (n === 8) state.conceal = true;
    else if (n === 28) state.conceal = false;
    else if (n >= 30 && n <= 37) state.fg = pal(n - 30);
    else if (n >= 90 && n <= 97) state.fg = pal(n - 90 + 8);
    else if (n === 39) state.fg = null;
    else if (n >= 40 && n <= 47) state.bg = pal(n - 40);
    else if (n >= 100 && n <= 107) state.bg = pal(n - 100 + 8);
    else if (n === 49) state.bg = null;
    else if (n === 38 || n === 48) {
      let color: string | null = null;
      if (sub.length > 1) {
        // Colon form: 38:5:n, 38:2:r:g:b or 38:2:colorspace:r:g:b.
        if (sub[1] === '5') color = pal(Number(sub[2]));
        else if (sub[1] === '2') color = rgb(sub.length >= 6 ? sub.slice(3, 6) : sub.slice(2, 5));
      } else if (list[i + 1] === '5') {
        color = pal(Number(list[i + 2]));
        i += 2;
      } else if (list[i + 1] === '2') {
        color = rgb(list.slice(i + 2, i + 5));
        i += 4;
      }
      if (n === 38) state.fg = color;
      else state.bg = color;
    }
  }
}

const sameColor = (s: SgrState) => s.fg !== null && s.fg === s.bg;
const hiding = (s: SgrState) => s.conceal || sameColor(s);
function resetSgr(s: SgrState): void {
  s.fg = null;
  s.bg = null;
  s.conceal = false;
}

/** Class of a CSI sequence by private prefix, intermediates and final byte. */
function csiClass(params: string, inter: string, final: string, sgr: SgrState): TerminalClass {
  if (inter === '!' && final === 'p') return 'reset';
  if (inter !== '') return 'otherSequence';
  if (/^[<=>?]/.test(params)) {
    if (params[0] === '?' && (final === 'J' || final === 'K'))
      return /^\?0*$/.test(params) ? 'eraseAhead' : 'erase';
    if (
      params[0] === '?' &&
      (final === 'h' || final === 'l') &&
      params
        .slice(1)
        .split(';')
        .some((p) => p === '47' || p === '1047' || p === '1049')
    )
      return 'erase'; // alternate screen: what was written before (or in it) leaves the screen
    return 'otherSequence';
  }
  switch (final) {
    case 'm': {
      const conceal = sgr.conceal;
      const same = sameColor(sgr);
      applySgr(sgr, params);
      if (sgr.conceal && !conceal) return 'sgrConceal';
      if (sameColor(sgr) && !same) return 'sgrSameColor';
      return 'sgr';
    }
    case 'A': // CUU
    case 'B': // CUD
    case 'C': // CUF
    case 'D': // CUB
    case 'E': // CNL
    case 'F': // CPL
    case 'G': // CHA
    case 'H': // CUP
    case 'f': // HVP
    case 'd': // VPA
    case 'e': // VPR
    case 'a': // HPR
    case '`': // HPA
    case 'j': // HPB
    case 'k': // VPB
    case 'I': // CHT
    case 'Z': // CBT
    case 's': // SCOSC
    case 'u': // SCORC
      return 'cursorMove';
    case 'J': // ED
    case 'K': // EL
      return /^0*$/.test(params) ? 'eraseAhead' : 'erase';
    case 'X': // ECH
    case 'P': // DCH
    case '@': // ICH
      return 'eraseAhead';
    case 'L': // IL
    case 'M': // DL
    case 'S': // SU
    case 'T': // SD
      return 'erase';
    default:
      return 'otherSequence';
  }
}

/** A parsed sequence as the terminal layer judges it: class and default replacement. */
interface Judged {
  cls: Exclude<TerminalClass, 'bareCR' | 'terminalConcealed' | 'backspace' | 'backspaceFlood'>;
  value: string;
}

/** Class of a parsed sequence (the SGR state follows it). */
function judge(p: Parsed, sgr: SgrState): Judged {
  switch (p.kind) {
    case 'csi': {
      const cls = csiClass(
        p.params,
        p.intermediates,
        String.fromCharCode(p.final),
        sgr,
      ) as Judged['cls'];
      if (cls === 'reset') resetSgr(sgr);
      return { cls, value: '' };
    }
    case 'esc': {
      if (p.intermediates === '#' && p.final === 0x38) return { cls: 'erase', value: '' }; // DECALN fills the screen
      if (p.intermediates !== '') return { cls: 'otherSequence', value: '' };
      const ch = String.fromCharCode(p.final);
      if (ch === '7' || ch === '8' || ch === 'M') return { cls: 'cursorMove', value: '' }; // DECSC, DECRC, RI
      if (ch === 'c') {
        resetSgr(sgr);
        return { cls: 'reset', value: '' };
      }
      if (ch === 'D' || ch === 'E') return { cls: 'otherSequence', value: '\n' }; // IND, NEL: a line break
      return { cls: 'otherSequence', value: '' };
    }
    case 'osc':
    case 'dcs':
    case 'sos':
    case 'pm':
    case 'apc':
      return { cls: 'stringSequence', value: '' };
    default:
      return { cls: 'otherSequence', value: '' }; // invalid or aborted: consumed, no effect (decision 7a)
  }
}

/**
 * U+009B is also cp1252 `›` read as Latin-1: a CSI only with a parameter, or a
 * final that is not a letter followed by a letter (`Home \u009B Products`).
 */
function isC1Csi(text: string, p: Parsed): boolean {
  if (p.kind !== 'csi') return false;
  if (p.params === '' && isAsciiLetter(p.final))
    return !LETTER_RE.test(text.slice(p.end, p.end + 2));
  return true;
}

// --- Backspace -----------------------------------------------------------------

/**
 * A character that takes a terminal cell: not a control, mark, format or
 * invisible character. Every such character is one cell, wide (CJK) ones too
 * (decision 6a: a known limitation; a terminal gives wide characters two cells).
 */
const NO_CELL_RE = /^[\p{Cc}\p{Cf}\p{M}ᅟᅠㅤﾠ]/u;
const takesCell = (ch: string) => !NO_CELL_RE.test(ch);
const MARK_RE = /^\p{M}/u;

/** One erase area: [start, end) in the source, its backspaces, the erased cells' text, leftovers. */
export interface EraseArea {
  start: number;
  end: number;
  bs: number;
  letters: string;
  /** Backspaces left over at the line start (rule `backspaceFlood`). */
  flood: boolean;
  /**
   * What the area removes, flat `[s0, e0, s1, e1, …]` ascending: the erased
   * cells, the controls and invisible characters walked over, the backspaces.
   * Sequences inside the area are not erased: their own rules apply.
   */
  pieces: number[];
}

/**
 * One piece of an erase area, as the layer marks it. The area is reported once,
 * on its first piece: `span` the area's extent, `letters` every letter it
 * erased, `bs` its backspaces; the other pieces are `quiet` (removed, not reported).
 */
export interface ErasePiece {
  start: number;
  end: number;
  letters: string;
  bs: number;
  flood: boolean;
  quiet: boolean;
  span?: [number, number];
}

const charBeforeAt = (text: string, i: number): string => {
  const u = text.charCodeAt(i - 1);
  if (u >= 0xdc00 && u <= 0xdfff && i >= 2) {
    const h = text.charCodeAt(i - 2);
    if (h >= 0xd800 && h <= 0xdbff) return text.slice(i - 2, i);
  }
  return text[i - 1]!;
};

/** The rare characters of the pre-cleanup scan (decision 6): BS, ESC, U+009B, CR, LF. */
const PRE_SCAN = /[\b\x1b\x9b\r\n]/g; // eslint-disable-line no-control-regex -- controls are the point

/**
 * The backspace pre-cleanup (decisions 6, 6a, 8, 25): a single forward pass
 * visiting only the rare characters, line by line. An ESC (or U+009B that
 * starts a CSI, the cp1252 `›` guard applied): its sequence is parsed forward
 * right there (span known; the scan resumes after it, so bodies are never
 * scanned; a BS the parser executes inside a CSI is a real backspace). A CR or
 * LF outside a sequence: a line end, the line's spans cleared (with
 * `lineStop`). A backspace run: walk backwards counting erases still owed,
 * stopping at the line end, skipping the line's known spans (sequences, earlier
 * areas); controls and invisible characters walked over go with the area and
 * take no cell; leftover backspaces make the area a flood. An area that walks
 * over an earlier one takes it in.
 *
 * A line's areas are final when the scan passes its line end; `ensure(p)`
 * scans through the line holding p. Only the open line is held (with
 * `lineStop` off, the whole text is one line).
 */
export class BackspaceScan {
  private readonly re = new RegExp(PRE_SCAN.source, 'g');
  private readonly memo: StringMemo;
  private done = false;
  /** Positions below this are final. */
  private finalTo = 0;
  private lineStart = 0;
  // The open line: known spans (ascending, disjoint; `sa` = area id or -1 for a sequence),
  // areas (an area taken in points to the one that took it, `into`), cells and pieces with their area.
  private ss: number[] = [];
  private se: number[] = [];
  private sa: number[] = [];
  private aStart: number[] = [];
  private aEnd: number[] = [];
  private aFlood: boolean[] = [];
  private aInto: number[] = [];
  private cellAt: number[] = [];
  private cellCh: string[] = [];
  private cellA: number[] = [];
  private pieceS: number[] = [];
  private pieceE: number[] = [];
  private pieceA: number[] = [];
  /** Final pieces, ascending; `head` = the first not yet taken, `cov` = the first coveredEnd may still need. */
  private readonly out: ErasePiece[] = [];
  private head = 0;
  private cov = 0;
  constructor(
    private readonly text: string,
    private readonly lineStop: boolean,
    /** Backspaces erase (rules `backspace` / `backspaceFlood` run). */
    private readonly erases = true,
    /** Decision 42e: backspaces erase at most this many cells. */
    private readonly limit = Infinity,
    stringLimit = STRING_LIMIT,
  ) {
    this.memo = newStringMemo(stringLimit);
  }

  /** Scans through the line holding p (or the text's end). */
  ensure(p: number): void {
    while (!this.done && this.finalTo <= p) this.step();
  }

  /** Final pieces starting at or before p, in order (each once). */
  *take(p: number): Generator<ErasePiece> {
    this.ensure(p);
    const out = this.out;
    while (this.head < out.length && out[this.head]!.start <= p) yield out[this.head++]!;
    this.trim();
  }

  /** The final piece holding p, or null. Asked in ascending p. */
  pieceAt(p: number): ErasePiece | null {
    this.ensure(p);
    const out = this.out;
    while (this.cov < out.length && out[this.cov]!.end <= p) this.cov++;
    this.trim();
    return this.cov < out.length && out[this.cov]!.start <= p ? out[this.cov]! : null;
  }

  private trim(): void {
    const k = Math.min(this.head, this.cov);
    if (k > 256 && k * 2 > this.out.length) {
      this.out.splice(0, k);
      this.head -= k;
      this.cov -= k;
    }
  }

  private step(): void {
    const { text, re } = this;
    const m = re.exec(text);
    if (!m) {
      this.closeLine(text.length);
      this.finalTo = Infinity;
      this.done = true;
      return;
    }
    const i = m.index;
    const c = text.charCodeAt(i);
    if (c === ESC || c === CSI8) {
      const p = parseSequence(text, i, this.memo);
      if (c === CSI8 && !isC1Csi(text, p)) return; // cp1252 `›`: no sequence
      for (const x of p.executed) {
        const xc = text.charCodeAt(x);
        if (xc === BS) {
          if (this.erases) this.erase(i, x, x + 1, p.end);
        } else if (xc === 0x0a || xc === 0x0d) this.lineEnd(x, x + 1);
      }
      const { ss, se, sa } = this;
      if (!(se.length && se[se.length - 1]! >= p.end)) {
        ss.push(p.start);
        se.push(p.end);
        sa.push(-1);
      }
      re.lastIndex = p.end;
    } else if (c === BS) {
      let j = i + 1;
      while (text.charCodeAt(j) === BS) j++;
      if (this.erases) this.erase(i, i, j, j);
      re.lastIndex = j;
    } else if (c === 0x0d) {
      let j = i + 1;
      while (text.charCodeAt(j) === 0x0d) j++;
      re.lastIndex = j;
      // Decision 25a: CR, LF and CRLF are line breaks; a lone CR too, in every mode.
      this.lineEnd(i, j);
    } else this.lineEnd(i, i + 1);
  }

  /** A line end at [i, j). */
  private lineEnd(i: number, j: number): void {
    if (!this.lineStop) return;
    this.closeLine(i);
    this.lineStart = j;
    this.finalTo = j;
  }

  /**
   * The cells of source [a, b) outside the row's known spans (sequences, erase areas): each
   * cell with the combining marks after it, `[start, end)`; `push` null: only counted.
   */
  private cells(
    a: number,
    b: number,
    push: ((s: number, e: number) => void) | null,
    max = Infinity,
  ): number {
    const { text, ss, se } = this;
    let lo = 0;
    let hi = ss.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (se[mid]! <= a) lo = mid + 1;
      else hi = mid;
    }
    let k = lo;
    let n = 0;
    let open = -1;
    for (let p = a; p < b;) {
      if (k < ss.length && ss[k]! <= p) {
        if (open >= 0) push?.(open, p);
        open = -1;
        p = Math.max(p, se[k]!);
        k++;
        continue;
      }
      const cp = text.codePointAt(p)!;
      const w = cp > 0xffff ? 2 : 1;
      const ch = w === 1 ? text[p]! : text.slice(p, p + 2);
      if (takesCell(ch)) {
        if (open >= 0) push?.(open, p);
        if (n === max) return n;
        open = p;
        n++;
      } else if (open >= 0 && !MARK_RE.test(ch)) {
        push?.(open, p);
        open = -1;
      }
      p += w;
    }
    if (open >= 0) push?.(open, b);
    return n;
  }

  /** Records a piece of area `id`. */
  private piece(s: number, e: number, id: number): void {
    if (e <= s) return;
    this.pieceS.push(s);
    this.pieceE.push(e);
    this.pieceA.push(id);
  }

  /** Backspaces [bsStart, bsEnd), walking back from `from`; the area ends at `end`. */
  private erase(from: number, bsStart: number, bsEnd: number, end: number): void {
    const { text, ss, se, sa } = this;
    const id = this.aStart.length;
    let need = bsEnd - bsStart;
    const piece = (s: number, e: number) => this.piece(s, e, id);
    piece(bsStart, bsEnd);
    let p = from;
    let stretchEnd = from;
    let k = ss.length - 1;
    const floor = this.lineStart;
    // Decision 42e: an erase reaches back at most `limit` cells; the rest is leftover.
    let reach = this.limit;
    while (need > 0 && p > floor && reach > 0) {
      if (k >= 0 && se[k]! >= p) {
        // A known span (sequence or earlier area) ends here: skipped, not counted.
        if (ss[k]! < p) {
          piece(p, stretchEnd);
          p = ss[k]!;
          stretchEnd = p;
        }
        k--;
        continue;
      }
      const ch = charBeforeAt(text, p);
      p -= ch.length;
      if (takesCell(ch)) {
        need--;
        reach--;
        this.cellAt.push(p);
        this.cellCh.push(ch);
        this.cellA.push(id);
      }
    }
    piece(p, stretchEnd);
    let flood = need > 0;
    // Earlier areas the walk passed are taken in.
    for (let q = k + 1; q < ss.length; q++) {
      const t = sa[q]!;
      if (t < 0) continue;
      this.aInto[t] = id;
      flood ||= this.aFlood[t]!;
    }
    ss.length = se.length = sa.length = k + 1;
    this.aStart.push(p);
    this.aEnd.push(end);
    this.aFlood.push(flood);
    this.aInto.push(-1);
    ss.push(p);
    se.push(end);
    sa.push(id);
  }

  /** The open line's areas become final pieces. */
  private closeLine(end: number): void {
    void end;
    const n = this.aStart.length;
    if (n) {
      const into = this.aInto;
      const root = (a: number): number => {
        let r = a;
        while (into[r]! >= 0) r = into[r]!;
        // Path compression: every area on the way points at the root.
        while (into[a]! >= 0) {
          const next = into[a]!;
          into[a] = r;
          a = next;
        }
        return r;
      };
      // Pieces and cells by final area, then each area's pieces in order with their letters.
      const byArea = new Map<number, [number, number][]>();
      for (let q = 0; q < this.pieceS.length; q++) {
        const r = root(this.pieceA[q]!);
        let l = byArea.get(r);
        if (!l) byArea.set(r, (l = []));
        l.push([this.pieceS[q]!, this.pieceE[q]!]);
      }
      const cells: [number, string][] = [];
      for (let q = 0; q < this.cellAt.length; q++) cells.push([this.cellAt[q]!, this.cellCh[q]!]);
      cells.sort((x, y) => x[0] - y[0]);
      const pieces: ErasePiece[] = [];
      /** Where each area's pieces begin in `pieces` (an area's pieces are pushed together, in order). */
      const areaStart: number[] = [];
      for (const [r, l] of byArea) {
        areaStart.push(pieces.length);
        const flood = this.aFlood[r]!;
        l.sort((x, y) => x[0] - y[0]);
        let cs = -1;
        let ce = -1;
        const flushPiece = () => {
          if (cs < 0) return;
          let bs = 0;
          for (let q = cs; q < ce; q++) if (this.text.charCodeAt(q) === BS) bs++;
          pieces.push({
            start: cs,
            end: ce,
            letters: '',
            bs,
            flood,
            quiet: false,
          });
        };
        for (const [s, e] of l) {
          if (cs >= 0 && s <= ce) ce = Math.max(ce, e);
          else {
            flushPiece();
            cs = s;
            ce = e;
          }
        }
        flushPiece();
      }
      const grouped = pieces.slice();
      pieces.sort((x, y) => x.start - y.start);
      let c = 0;
      for (const pc of pieces) {
        while (c < cells.length && cells[c]![0] < pc.start) c++;
        let letters = '';
        for (; c < cells.length && cells[c]![0] < pc.end; c++) letters += cells[c]![1];
        pc.letters = letters;
      }
      // One report per area: on its first piece, with the area's span, letters and backspaces.
      areaStart.push(grouped.length);
      for (let a = 0; a + 1 < areaStart.length; a++) {
        const q0 = areaStart[a]!;
        const q1 = areaStart[a + 1]!;
        if (q0 === q1) continue;
        const first = grouped[q0]!;
        first.span = [first.start, grouped[q1 - 1]!.end];
        for (let q = q0 + 1; q < q1; q++) {
          const pc = grouped[q]!;
          first.letters += pc.letters;
          first.bs += pc.bs;
          pc.quiet = true;
        }
      }
      for (const pc of pieces) this.out.push(pc);
    }
    this.clearLine();
  }

  /** Forgets the open line's spans, areas, cells and pieces. */
  private clearLine(): void {
    this.ss = [];
    this.se = [];
    this.sa = [];
    this.aStart = [];
    this.aEnd = [];
    this.aFlood = [];
    this.aInto = [];
    this.cellAt = [];
    this.cellCh = [];
    this.cellA = [];
    this.pieceS = [];
    this.pieceE = [];
    this.pieceA = [];
  }
}

/** Every erase area of `text` with its pieces (the scan run to the end; tests and tools). */
export function backspaceAreas(text: string, lineStop: boolean): ErasePiece[] {
  const scan = new BackspaceScan(text, lineStop, true);
  return [...scan.take(Infinity)];
}

// --- The layer -------------------------------------------------------------------

/** Candidates: ESC, 8-bit CSI, CR, and the other C0/C1 controls and U+FFFE (rule `controlChars`). */
// eslint-disable-next-line no-control-regex -- control characters are the point
const CANDIDATE_RE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F￾]/g;
const CONTROL_SPACE = (c: number) => c === 0x0b || c === 0x0c || c === 0x85;

/** Rules with the defaults filled in. */
export function terminalRules(rules: Readonly<Partial<TerminalRules>>): TerminalRules {
  return { ...TERMINAL_RULES, ...rules };
}

/**
 * The terminal layer's marks in position order: erase-area pieces (from
 * `scan`, first at equal positions), sequences, bare CRs, concealed spans and
 * the remaining controls. A character an erase area removes is the area's.
 */
export function* terminalMarks(
  text: string,
  rules: Readonly<TerminalRules>,
  controlAction: Action,
  listen: boolean,
  scan: BackspaceScan | null = null,
  /** Decision 42e: a concealed span is reported in chunks of this many code points. */
  limit = Infinity,
): Generator<RawMark> {
  if (!scan) {
    yield* sequenceLayer(text, rules, controlAction, listen, null, limit);
    return;
  }
  const areaMark = (pc: ErasePiece): RawMark | null => {
    const rule = pc.flood ? 'backspaceFlood' : 'backspace';
    const action: Action = rules[rule];
    const mode = modeOf(action);
    if (mode === null || (mode === 'report' && !listen)) return null;
    return {
      rule,
      cls: rule,
      start: pc.start,
      end: pc.end,
      n: pc.bs,
      value: '',
      mode,
      counted: action !== 'remove-silent',
      layer: true,
      extracted: pc.letters,
      quiet: pc.quiet,
      span: pc.span,
    };
  };
  const removes = (pc: ErasePiece) =>
    modeOf(rules[pc.flood ? 'backspaceFlood' : 'backspace']) === 'cleanup';
  const gen = sequenceLayer(
    text,
    rules,
    controlAction,
    listen,
    (p) => {
      const pc = scan.pieceAt(p);
      return pc && removes(pc) ? pc.end : -1;
    },
    limit,
  );
  for (let x = gen.next(); !x.done; x = gen.next()) {
    for (const pc of scan.take(x.value.start)) {
      const a = areaMark(pc);
      if (a) yield a;
    }
    yield x.value;
  }
  for (const pc of scan.take(Infinity)) {
    const a = areaMark(pc);
    if (a) yield a;
  }
}

/** Sequences, bare CRs, concealed spans and the remaining controls; `erased(p)`: end of a removed erase piece holding p, or -1. */
function* sequenceLayer(
  text: string,
  rules: Readonly<TerminalRules>,
  controlAction: Action,
  listen: boolean,
  erased: ((p: number) => number) | null,
  limit = Infinity,
): Generator<RawMark> {
  const memo = newStringMemo(rules.stringLimit ?? STRING_LIMIT);
  const mk = (
    rule: TerminalClass | 'controlChars',
    cls: string,
    action: Action,
    start: number,
    end: number,
    value: string,
    n = 1,
  ): RawMark | null => {
    const mode = modeOf(action);
    if (mode === null || (mode === 'report' && !listen)) return null;
    return {
      rule,
      cls,
      start,
      end,
      n,
      value,
      mode,
      counted: action !== 'remove-silent',
      layer: true,
    };
  };
  /** The text of [from, to) without the given sequences. */
  const visible = (from: number, to: number, seqs: readonly RawMark[]) => {
    let out = '';
    let c = from;
    for (const q of seqs) {
      if (q.end <= c || q.start >= to) continue;
      if (q.start > c) out += text.slice(c, q.start);
      c = q.end;
    }
    if (c < to) out += text.slice(c, to);
    return out;
  };

  const sgr: SgrState = { fg: null, bg: null, conceal: false };
  const crRule = rules.bareCR;
  const out: RawMark[] = [];
  // A concealed span: its marks wait until it ends (the span starts before them).
  let hiddenFrom = -1;
  let cHeld: RawMark[] = [];
  // A CR run whose judgement waits for the next character that is no sequence.
  let cr: { start: number; end: number; next: number } | null = null;
  let crHeld: RawMark[] = [];
  const dest = () => (hiddenFrom >= 0 ? cHeld : out);
  const emit = (m: RawMark | null) => {
    if (!m) return;
    if (cr) crHeld.push(m);
    else dest().push(m);
  };
  const crMark = (start: number, end: number): RawMark | null => {
    const action: Action =
      crRule === 'keep' || crRule === 'report'
        ? 'keep'
        : crRule === 'ignored'
          ? 'ignored'
          : 'remove-silent';
    // Not counted (decision 25a: a lone CR is a line break, in every mode).
    return mk('bareCR', 'bareCR', action, start, end, action === 'keep' ? '' : '\n', 0);
  };
  const isLineEnd = (next: number) => next >= text.length || text.charCodeAt(next) === 0x0a;
  const judgeCR = (next: number) => {
    const c = cr!;
    cr = null;
    const d = dest();
    if (!isLineEnd(next)) {
      const m = crMark(c.start, c.end);
      if (m) d.push(m);
    }
    for (const m of crHeld) d.push(m);
    crHeld = [];
  };
  const closeConceal = (end: number) => {
    const from = hiddenFrom;
    hiddenFrom = -1;
    // The marks inside it (a chunk's end: those before it; the rest wait for the next chunk).
    const inner = cHeld.filter((x) => x.start < end);
    cHeld = cHeld.filter((x) => x.start >= end);
    if (end > from) {
      const m = mk(
        'terminalConcealed',
        'terminalConcealed',
        rules.terminalConcealed,
        from,
        end,
        '',
      );
      if (m) {
        m.extracted = visible(
          from,
          end,
          inner.filter((x) => x.mode === 'cleanup'),
        );
        out.push(m);
      }
    }
    for (const m of inner) out.push(m);
  };
  /** A C0 control the parser executed inside a sequence, judged as if it stood outside. */
  const executedMark = (x: number): RawMark | null => {
    const c = text.charCodeAt(x);
    if (c === BS || c === 0x0a || c === 0x09) return null; // a kept backspace; line feed and tab are text
    if (c === 0x0d) return isLineEnd(x + 1) ? null : crMark(x, x + 1);
    return mk('controlChars', 'controlChar', controlAction, x, x + 1, CONTROL_SPACE(c) ? ' ' : '');
  };
  /** The marks of a parsed sequence at i: pieces around the executed controls, a string kept as text in two. */
  const sequenceMarks = (i: number, p: Parsed, j: Judged): RawMark[] => {
    const r: RawMark[] = [];
    const push = (m: RawMark | null) => m && r.push(m);
    if (p.body) {
      // Decision 42e: its terminator did not come within the limit (or at all).
      if (p.lost)
        r.push({
          rule: 'lostBound',
          cls: 'lostBound',
          start: i,
          end: p.end,
          n: 0,
          value: '',
          mode: 'report',
          counted: false,
          lost: 'escapeString',
        });
      const action = rules.stringSequence;
      const body = text.slice(p.body.start, p.body.end);
      if (action === 'remove-with-content' || action === 'keep' || action === 'ignored') {
        const m = mk(
          'stringSequence',
          'stringSequence',
          action === 'remove-with-content' ? 'remove-counted' : action,
          i,
          p.end,
          '',
        );
        if (m) m.extracted = body;
        push(m);
      } else {
        // The opener and terminator go, the body stays as text.
        const m1 = mk('stringSequence', 'stringSequence', action, i, p.body.start, '');
        if (m1) m1.extracted = body;
        push(m1);
        if (p.end > p.body.end)
          push(mk('stringSequence', 'stringSequence', action, p.body.end, p.end, '', 0));
      }
      return r;
    }
    // Executed controls split the sequence; the first piece carries its count.
    let from = i;
    let n = 1;
    for (const x of p.executed) {
      if (x > from) {
        push(mk(j.cls, j.cls, rules[j.cls], from, x, n === 1 ? j.value : '', n));
        n = 0;
      }
      push(executedMark(x));
      from = x + 1;
    }
    if (p.end > from) push(mk(j.cls, j.cls, rules[j.cls], from, p.end, n === 1 ? j.value : '', n));
    return r;
  };

  const re = new RegExp(CANDIDATE_RE.source, 'g');
  let pos = 0;
  for (;;) {
    re.lastIndex = pos;
    let m = re.exec(text);
    // Candidates an erase area removes are the area's.
    while (m && erased) {
      const e = erased(m.index);
      if (e < 0) break;
      re.lastIndex = e;
      m = re.exec(text);
    }
    const i = m ? m.index : text.length;
    // Decision 42e: a concealed span reaches at most `limit` code points; it goes on in chunks.
    while (hiddenFrom >= 0 && i - hiddenFrom > limit) {
      let e = hiddenFrom;
      for (let k = 0; k < limit && e < i; k++) e += text.codePointAt(e)! > 0xffff ? 2 : 1;
      if (e >= i) break;
      for (const x of cHeld) if (x.start < e && x.end > e) e = x.end;
      if (e >= i) break;
      closeConceal(e);
      hiddenFrom = e;
    }
    if (cr && cr.next < i) judgeCR(cr.next);
    if (out.length) {
      for (const x of out) yield x;
      out.length = 0;
    }
    if (!m) break;
    const c = text.charCodeAt(i);
    let next = i + 1;
    if (c === 0x0d) {
      if (cr) judgeCR(i);
      while (text.charCodeAt(next) === 0x0d) next++;
      cr = { start: i, end: next, next };
    } else if (c === BS) {
      // A backspace the rules keep: the backspace rule's, not a control.
    } else if (c === ESC || c === CSI8) {
      const p = parseSequence(text, i, memo);
      if (c === ESC || isC1Csi(text, p)) {
        next = p.end;
        const j = judge(p, sgr);
        const marks = sequenceMarks(i, p, j);
        if (cr && cr.next === i) cr.next = next;
        else if (cr) judgeCR(i);
        const h = hiding(sgr);
        if (!h && hiddenFrom >= 0) {
          // The span ends before the sequence that shows the text again.
          if (cr) judgeCR(i);
          closeConceal(i);
          for (const x of marks) out.push(x);
        } else {
          for (const x of marks) emit(x);
          if (h && hiddenFrom < 0) {
            if (cr) judgeCR(next);
            hiddenFrom = next;
          }
        }
      } else {
        if (cr) judgeCR(i);
        emit(
          mk('controlChars', 'controlChar', controlAction, i, i + 1, CONTROL_SPACE(c) ? ' ' : ''),
        );
      }
    } else {
      if (cr) judgeCR(i);
      emit(mk('controlChars', 'controlChar', controlAction, i, next, CONTROL_SPACE(c) ? ' ' : ''));
    }
    pos = next;
  }
  if (cr) judgeCR(text.length);
  if (hiddenFrom >= 0) closeConceal(text.length);
  for (const x of out) yield x;
}
