/**
 * Phase 1 of the finding-callback design (docs/confusion-model.md §17): detector
 * generators over the source, merged by position; report calls per mark,
 * cleanup calls per region of overlapping cleanup marks; a stream of output
 * records `(start, length, text)` over the source. Nothing accumulates: the
 * only buffers are the open region and the look-past buffer between a
 * detector and the layer it reads past.
 */

/** What a rule does with what its detector marks (decision 3). */
export type RuleMode = 'ignored' | 'report' | 'cleanup';

/** One mark, as the report callback gets it. Offsets are UTF-16 offsets into the source. */
export interface Mark {
  /** The rule that marked it (`zeroWidthInWord`, `tags`, `sgrConceal`, …). */
  readonly kind: string;
  readonly start: number;
  readonly length: number;
  /** The hidden part, decoded or in logical order (payloads, string bodies, erased letters, spans); null when there is none. */
  readonly extracted: string | null;
  /** What the rule counts: code points, sequences or backspaces. */
  readonly count: number;
}

/**
 * Decision 42e: a phase-1 construct whose closing bound was lost: an escape string whose
 * terminator did not come within its limit (its body ends at its line end), a bidi override,
 * embedding or isolate not closed within `constructLimit` code points (its frame is closed).
 */
export interface LostBound {
  readonly kind: 'escapeString' | 'bidiFrame';
  /** Where the construct starts and how far it was read. */
  readonly start: number;
  readonly length: number;
}

/** One region of overlapping cleanup marks, as the cleanup callback gets it. */
export interface Region {
  readonly start: number;
  readonly length: number;
  /** The source text of the region. */
  readonly original: string;
}

/** One output record (decision 9): the source range [start, start + length) becomes `text`. */
export interface OutputRecord {
  readonly start: number;
  readonly length: number;
  readonly text: string;
}

export interface CleanupCallbacks {
  /** Every mark of a `report` or `cleanup` rule, per rule, in position order (decision 12). */
  onReport?(mark: Mark): void;
  /**
   * Every region of overlapping `cleanup` marks (decision 13): its source text and
   * `cleanup`, the region with every rule's default applied. A returned string is
   * the consumer's output for the region (decision 15); undefined = `cleanup`.
   */
  onCleanup?(region: Region, cleanup: string): string | undefined;
  /** The consumer's output, record by record: the source with the callbacks' returns. */
  onRecord?(record: OutputRecord): void;
  /** Decision 42e: each construct whose closing bound was lost ({@link LostBound}), in position order. */
  onLostBound?(bound: LostBound): void;
  /** Stops at the next mark (decision 16); the results cover what was done. */
  signal?: AbortSignal;
}

/** A detector's mark, internal form. */
export interface RawMark {
  rule: string;
  /** Counter class (`zeroWidthInWord`, `controlChar`, …). */
  cls: string;
  start: number;
  end: number;
  /** Code points (or sequences, backspaces) the rule counts. */
  n: number;
  /** The rule's default replacement: '' or one character. */
  value: string;
  mode: 'report' | 'cleanup';
  /** A removal strict `analyze` lists as a hidden-character word (`'remove-counted'`); internal, never reported (decision 17a). */
  counted: boolean;
  /** A mark of the control layer (controls, terminal, backspace): the hidden detectors read past it. */
  layer?: boolean;
  /** Decision 42e: no mark, a lost bound for `onLostBound` ({@link LostBound}). */
  lost?: LostBound['kind'];
  /** Code points of an encoded run (tags, selectors, zero-width, invisible run). */
  cps?: number[];
  /** Extracted text, when the detector has it. */
  extracted?: string | null;
  /**
   * A removal the word phase still tokenizes as upstream's tokenizer saw it:
   * its characters separate or form words, its text is gone (`illegal`,
   * `invisibleOutsideWord`).
   */
  split?: boolean;
  /** Removed, not reported (a later piece of a mark reported once). */
  quiet?: boolean;
  /** The extent the report gives, when it is not the mark's own (an erase area's first piece). */
  span?: [number, number];
}

// --- Merge -----------------------------------------------------------------

/**
 * The merge of decisions 2, 4 and 8 as a pull object: `next()` returns the head
 * with the lowest start; on equal starts the generator listed first wins (the
 * pre-cleanup stream is listed first). Mark length plays no role. The
 * generator whose head was taken advances on the following call, not before.
 */
export class Merger {
  private readonly gens: Iterator<RawMark>[] = [];
  private readonly heads: RawMark[] = [];
  private taken = -1;
  constructor(gens: Iterator<RawMark>[]) {
    // Generators in order; a finished one leaves the list (the order of the rest stays).
    for (const g of gens) {
      const r = g.next();
      if (!r.done) {
        this.gens.push(g);
        this.heads.push(r.value);
      }
    }
  }
  next(): RawMark | null {
    const heads = this.heads;
    const t = this.taken;
    if (t >= 0) {
      const r = this.gens[t]!.next();
      if (r.done) {
        this.gens.splice(t, 1);
        heads.splice(t, 1);
      } else heads[t] = r.value;
    }
    let best = -1;
    let b: RawMark | null = null;
    for (let i = 0; i < heads.length; i++) {
      const h = heads[i]!;
      if (!b || h.start < b.start) {
        best = i;
        b = h;
      }
    }
    this.taken = best;
    return b;
  }
}

/** A generator read by several readers; the buffer holds the items between the slowest and the fastest. */
export class Tee<T> {
  private buf: T[] = [];
  /** The index of `buf[0]`; items before the slowest reader (`low`) are dropped in halves. */
  private first = 0;
  private low = 0;
  private done = false;
  private readonly pos: number[];
  /** Most items buffered at once (decision 5: the items between the slowest and the fastest reader). */
  peak = 0;
  constructor(
    private readonly gen: Iterator<T>,
    readers: number,
  ) {
    this.pos = new Array<number>(readers).fill(0);
  }
  private fill(i: number): T | undefined {
    while (!this.done && this.first + this.buf.length <= i) {
      const r = this.gen.next();
      if (r.done) this.done = true;
      else {
        this.buf.push(r.value);
        const live = this.first + this.buf.length - this.low;
        if (live > this.peak) this.peak = live;
      }
    }
    return i - this.first < this.buf.length ? this.buf[i - this.first] : undefined;
  }
  next(k: number): T | undefined {
    const v = this.fill(this.pos[k]!);
    if (v === undefined) return undefined;
    this.pos[k]! += 1;
    let min = this.pos[0]!;
    for (let r = 1; r < this.pos.length; r++) if (this.pos[r]! < min) min = this.pos[r]!;
    this.low = min;
    // Dropped once the read part is half the buffer: a long lag costs no copy per item.
    const dead = min - this.first;
    if (dead > 64 && dead * 2 >= this.buf.length) {
      this.buf.splice(0, dead);
      this.first = min;
    }
    return v;
  }
  reader(k: number): Iterator<T> {
    return {
      next: () => {
        const v = this.next(k);
        return v === undefined ? { done: true, value: undefined } : { done: false, value: v };
      },
    };
  }
}

// --- Look past the control layer ------------------------------------------------

const charBeforeAt = (text: string, i: number): string => {
  if (i <= 0) return '';
  const u = text.charCodeAt(i - 1);
  if (u >= 0xdc00 && u <= 0xdfff && i >= 2) {
    const h = text.charCodeAt(i - 2);
    if (h >= 0xd800 && h <= 0xdbff) return text.slice(i - 2, i);
  }
  return text[i - 1]!;
};
const charAtPos = (text: string, i: number): string => {
  if (i >= text.length) return '';
  const cp = text.codePointAt(i)!;
  return cp > 0xffff ? text.slice(i, i + 2) : text[i]!;
};
const lastChar = (s: string) => charBeforeAt(s, s.length);

/**
 * The source as the hidden detectors see it (decision 5): the control layer's
 * cleanup marks taken out, a default emission (VT, FF, NEL → ' ') seen as
 * itself. The layer's marks come lazily through a tee reader and are flattened
 * into disjoint intervals; each interval knows the visible character before it,
 * so a look back is one lookup however many removals touch.
 */
export class View {
  private s: number[] = [];
  private e: number[] = [];
  private v: string[] = [];
  /** Effective character before each interval's start, and its source position. */
  private pe: string[] = [];
  private pa: number[] = [];
  private head = 0;
  private pending: RawMark | null = null;
  private exhausted: boolean;
  /** Positions the readers still look at, by reader id (Infinity: not reading). */
  private readonly low: number[] = [];
  /** Report-mode layer marks of the terminal classes, [start, end) pairs ascending (rule `illegal` leaves them alone). */
  private readonly cs: number[] = [];
  private readonly ce: number[] = [];
  private ch = 0;
  constructor(
    readonly source: string,
    private readonly layer: Iterator<RawMark> | null,
  ) {
    this.exhausted = layer === null;
    this.pull();
  }
  private pull(): void {
    if (this.exhausted) return;
    for (;;) {
      const r = this.layer!.next();
      if (r.done) {
        this.exhausted = true;
        this.pending = null;
        return;
      }
      const m = r.value;
      if (m.mode === 'cleanup') {
        this.pending = m;
        return;
      }
      if (m.rule !== 'controlChars' && m.rule !== 'bareCR' && !m.lost) {
        this.cs.push(m.start);
        this.ce.push(m.end);
      }
    }
  }
  /** Pulls the layer's marks that start at or before p. */
  private fill(p: number): void {
    while (this.pending && this.pending.start <= p) {
      const m = this.pending;
      this.add(m.start, m.end, m.value);
      this.pull();
    }
  }
  private add(s: number, e: number, v: string): void {
    const n = this.s.length;
    if (n > this.head) {
      const ls = this.s[n - 1]!;
      const le = this.e[n - 1]!;
      if (s < le) {
        // Nested or overlapping: a removal takes in what it overlaps.
        if (e > le) {
          this.e[n - 1] = e;
          if (v === '') this.v[n - 1] = '';
        }
        return;
      }
      if (s === le) {
        const pv = this.v[n - 1]!;
        this.pe.push(pv !== '' ? lastChar(pv) : this.pe[n - 1]!);
        this.pa.push(pv !== '' ? ls : this.pa[n - 1]!);
      } else this.pushBefore(s);
    } else this.pushBefore(s);
    this.s.push(s);
    this.e.push(e);
    this.v.push(v);
  }
  private pushBefore(s: number): void {
    const ch = charBeforeAt(this.source, s);
    this.pe.push(ch);
    this.pa.push(s - ch.length);
  }
  /** Reader `id` reads from position 0 on (register every reader before the first read). */
  register(id: number): void {
    this.low[id] = 0;
  }
  /** Reader `id` will still ask about positions ≥ p (Infinity: done); drops intervals no reader needs. */
  release(id: number, p: number): void {
    const low = this.low;
    low[id] = p;
    let min = p;
    for (let k = 0; k < low.length; k++) {
      const x = low[k];
      if (x !== undefined && x < min) min = x;
    }
    let h = this.head;
    while (h < this.s.length && this.e[h]! < min) h++;
    if (h > 256 && h * 2 > this.s.length) {
      this.s.splice(0, h);
      this.e.splice(0, h);
      this.v.splice(0, h);
      this.pe.splice(0, h);
      this.pa.splice(0, h);
      h = 0;
    }
    this.head = h;
  }
  /** Nothing removed or emitted in [from, to]: plain source there. */
  clear(from: number, to: number): boolean {
    const n = this.s.length;
    if (n > this.head && this.e[n - 1]! >= from) return false;
    return this.pending === null || this.pending.start > to;
  }
  /** Index of the interval with the largest start ≤ p, or -1. */
  private at_(p: number): number {
    let lo = this.head;
    let hi = this.s.length - 1;
    let k = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.s[mid]! <= p) {
        k = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return k;
  }
  /** End of the removed interval covering p, or -1 (an emission is not removed text). */
  removedEnd(p: number): number {
    this.fill(p);
    const k = this.at_(p);
    if (k < 0 || p >= this.e[k]!) return -1;
    return this.v[k] === '' || p > this.s[k]! ? this.e[k]! : -1;
  }
  /**
   * End of what the layer holds at p — a removal, a replacement (from its start
   * on), a terminal mark it reports — or -1. Asked in ascending p (one reader).
   */
  coveredEnd(p: number): number {
    this.fill(p);
    const k = this.at_(p);
    if (k >= 0 && p < this.e[k]!) return this.e[k]!;
    const { cs, ce } = this;
    while (this.ch < cs.length && ce[this.ch]! <= p) this.ch++;
    return this.ch < cs.length && cs[this.ch]! <= p ? ce[this.ch]! : -1;
  }
  /** Source start and end of the character the last {@link after} returned. */
  at = 0;
  next = 0;
  /** The visible character at or after p ('' at the end); its source range in {@link at}, {@link next}. */
  after(p: number): string {
    const src = this.source;
    for (;;) {
      if (p >= src.length) {
        this.at = this.next = p;
        return '';
      }
      if (this.pending === null || this.pending.start > p) {
        if (this.s.length === this.head || this.e[this.s.length - 1]! <= p) {
          const c = src.charCodeAt(p);
          const w = c >= 0xd800 && c <= 0xdbff && p + 1 < src.length ? 2 : 1;
          this.at = p;
          this.next = p + w;
          return w === 1 ? src[p]! : charAtPos(src, p);
        }
      }
      this.fill(p);
      const k = this.at_(p);
      if (k >= 0 && p < this.e[k]!) {
        if (this.v[k] === '' || p > this.s[k]!) {
          p = this.e[k]!;
          continue;
        }
        this.at = this.s[k]!;
        this.next = this.e[k]!;
        return charAtPos(this.v[k]!, 0);
      }
      const ch = charAtPos(src, p);
      this.at = p;
      this.next = p + ch.length;
      return ch;
    }
  }
  /** {@link after} as a code point (-1 at the end), without building a string. */
  afterCp(p: number): number {
    const src = this.source;
    if (
      p < src.length &&
      (this.pending === null || this.pending.start > p) &&
      (this.s.length === this.head || this.e[this.s.length - 1]! <= p)
    ) {
      const c = src.charCodeAt(p);
      if (c >= 0xd800 && c <= 0xdbff && p + 1 < src.length) {
        const d = src.charCodeAt(p + 1);
        if (d >= 0xdc00 && d <= 0xdfff) {
          this.at = p;
          this.next = p + 2;
          return (c - 0xd800) * 0x400 + (d - 0xdc00) + 0x10000;
        }
      }
      this.at = p;
      this.next = p + 1;
      return c;
    }
    const ch = this.after(p);
    return ch === '' ? -1 : ch.codePointAt(0)!;
  }
  /** The visible character before p ('' at the start). */
  before(p: number): string {
    if (p <= 0) return '';
    this.fill(p - 1);
    const k = this.at_(p - 1);
    if (k >= 0 && p <= this.e[k]! && p > this.s[k]!) {
      if (p < this.e[k]!) return this.pe[k]!;
      return this.v[k] !== '' ? lastChar(this.v[k]!) : this.pe[k]!;
    }
    return charBeforeAt(this.source, p);
  }
  /** Code point of the visible character before p (-1 at the start). */
  beforeCp(p: number): number {
    if (p <= 0) return -1;
    if (this.s.length === this.head && (this.pending === null || this.pending.start > p)) {
      const src = this.source;
      const u = src.charCodeAt(p - 1);
      if (u >= 0xdc00 && u <= 0xdfff && p >= 2) {
        const h = src.charCodeAt(p - 2);
        if (h >= 0xd800 && h <= 0xdbff) return (h - 0xd800) * 0x400 + (u - 0xdc00) + 0x10000;
      }
      return u;
    }
    const ch = this.before(p);
    return ch === '' ? -1 : ch.codePointAt(0)!;
  }
  /** Source end of the last visible character before p (p itself when nothing is removed there). */
  visibleEnd(p: number): number {
    for (;;) {
      if (p <= 0) return 0;
      this.fill(p - 1);
      const k = this.at_(p - 1);
      if (k >= 0 && p <= this.e[k]! && p > this.s[k]!) {
        if (this.v[k] !== '') return this.e[k]!;
        p = this.s[k]!;
        continue;
      }
      return p;
    }
  }
  /** The visible text of [from, to). */
  slice(from: number, to: number): string {
    if (this.clear(from, to)) return this.source.slice(from, to);
    let out = '';
    let p = from;
    while (p < to) {
      this.fill(p);
      const k = this.at_(p);
      if (k >= 0 && p < this.e[k]!) {
        if (p === this.s[k]! && this.v[k] !== '') out += this.v[k]!;
        p = this.e[k]!;
        continue;
      }
      // Up to the next interval start or `to`.
      let stop = to;
      const nk = k + 1;
      if (nk < this.s.length && this.s[nk]! < stop) stop = this.s[nk]!;
      if (this.pending && this.pending.start < stop) stop = this.pending.start;
      if (stop <= p) stop = p + 1;
      out += this.source.slice(p, stop);
      p = stop;
    }
    return out;
  }
}

// --- Regions and records ------------------------------------------------------------

/** A record with the library's own classification. */
export interface LibRecord {
  start: number;
  end: number;
  text: string;
  /** keep: source text; rem: a removal; split: a removal the word phase still tokenizes (RawMark.split); emit: a default replacement; seam: a space the seam rule drops. */
  kind: 'keep' | 'rem' | 'split' | 'emit' | 'seam';
}

/** Where records go: source range, text, kind. */
export type RecordSink = (
  start: number,
  end: number,
  text: string,
  kind: LibRecord['kind'],
) => void;

/**
 * Output records over the source, in order. `seams` (decision 11): at a
 * removal seam, `<before><space>` + `<space><after>` keeps one space; the
 * dropped space is a record of its own, so the records' edits reproduce their
 * text; a dropped space opens no new seam.
 */
export class Records {
  end = 0;
  private seam = false;
  private lastSpace = false;
  constructor(
    private readonly src: string,
    private readonly sink: RecordSink,
    private readonly seams: boolean,
    /** Untouched records carry their text (else '': the sink reads the source itself). */
    private readonly keepText = true,
  ) {}
  private out(s: number, e: number, text: string, kind: LibRecord['kind']): void {
    if (e <= s) return;
    const removal = kind === 'rem' || kind === 'split';
    if (this.seam && !removal && (kind === 'keep' || text.length)) {
      this.seam = false;
      const first = kind === 'keep' ? this.src.charCodeAt(s) : text.charCodeAt(0);
      if (this.seams && this.lastSpace && first === 0x20) {
        if (kind === 'keep') {
          this.sink(s, s + 1, '', 'seam');
          s += 1;
          if (s >= e) {
            this.end = e;
            return;
          }
        } else {
          // A default ' ' emission after a removal loses its space.
          text = text.slice(1);
          kind = text.length ? kind : 'rem';
        }
      }
    }
    if (kind === 'keep') {
      this.sink(s, e, this.keepText ? this.src.slice(s, e) : '', kind);
      this.lastSpace = this.src.charCodeAt(e - 1) === 0x20;
    } else {
      this.sink(s, e, text, kind);
      if (text.length) this.lastSpace = text.charCodeAt(text.length - 1) === 0x20;
    }
    if (removal) this.seam = true;
    this.end = e;
  }
  keepTo(to: number): void {
    if (to > this.end) this.out(this.end, to, '', 'keep');
  }
  emit(s: number, e: number, text: string, split = false): void {
    this.keepTo(s);
    if (s < this.end) s = this.end;
    if (e <= s) return;
    this.out(s, e, text, text !== '' ? 'emit' : split ? 'split' : 'rem');
  }
  finish(): void {
    this.keepTo(this.src.length);
  }
}

/**
 * Pieces of a region: each mark keeps what earlier marks left of it (an
 * earlier start wins); a removal running on from the removal before it
 * extends that piece.
 */
export function regionPieces(
  marks: readonly RawMark[],
): { s: number; e: number; v: string; x: boolean }[] {
  const out: { s: number; e: number; v: string; x: boolean }[] = [];
  let reach = -1;
  for (const m of marks) {
    if (m.end <= reach) continue;
    const x = m.split === true;
    const last = out[out.length - 1];
    if (m.start >= reach) out.push({ s: m.start, e: m.end, v: m.value, x });
    else if (m.value !== '')
      continue; // a replacement partly covered: the removal before it wins
    else if (last && last.v === '' && last.x === x)
      last.e = m.end; // removals that touch are one piece
    else out.push({ s: reach, e: m.end, v: '', x });
    reach = m.end;
  }
  return out;
}

/** What the compatibility recorder and the letter phase get from phase 1. */
export interface MarkSink {
  /** Every mark with its fate under the library's defaults. */
  mark(m: RawMark): void;
}

/** The extracted part of a mark: decoded payload, body, logical order, a carrier's characters. */
export type Extractor = (m: RawMark, source: string) => string | null;

export interface Phase1Options {
  callbacks?: CleanupCallbacks;
  sink?: MarkSink | null;
  seams?: boolean;
  extract: Extractor;
  /** The library's records (defaults applied). */
  out: RecordSink;
  /** Untouched records carry their text (default true; the letter phase reads the source). */
  keepText?: boolean;
}

/**
 * Phase 1: merges the detectors, issues report and cleanup calls, and sends
 * the library's records (defaults applied) to `out`; the consumer's records
 * (callback returns) go to `onRecord`. `step()` takes one mark; the records it
 * settles are out when it returns.
 */
export class Phase1 {
  aborted = false;
  private done = false;
  private readonly merger: Merger;
  private readonly recs: Records;
  private readonly crecs: Records | null;
  private rStart = -1;
  private rEnd = -1;
  private readonly rMarks: RawMark[] = [];
  private rN = 0;
  constructor(
    private readonly source: string,
    detectors: Iterator<RawMark>[],
    private readonly o: Phase1Options,
  ) {
    this.merger = new Merger(detectors);
    const seams = o.seams === true;
    this.recs = new Records(source, o.out, seams, o.keepText !== false);
    const onRecord = o.callbacks?.onRecord;
    this.crecs = onRecord
      ? new Records(source, (s, e, text) => onRecord({ start: s, length: e - s, text }), seams)
      : null;
  }
  private close(): void {
    if (this.rStart < 0) return;
    const { recs, crecs, rMarks, rStart, rEnd, source } = this;
    // One mark (the usual case) is its own piece.
    const single = this.rN === 1 ? rMarks[0]! : null;
    const pieces = single ? null : regionPieces(rMarks.slice(0, this.rN));
    let cleanup = '';
    if (single) cleanup = single.value;
    else for (const q of pieces!) cleanup += q.v;
    let text = cleanup;
    const onCleanup = this.o.callbacks?.onCleanup;
    if (onCleanup) {
      const v = onCleanup(
        Object.freeze({
          start: rStart,
          length: rEnd - rStart,
          original: source.slice(rStart, rEnd),
        }),
        cleanup,
      );
      if (v !== undefined && typeof v !== 'string')
        throw new TypeError('onCleanup returns a string or undefined');
      if (v !== undefined) text = v;
    }
    if (single) recs.emit(single.start, single.end, single.value, single.split);
    else for (const q of pieces!) recs.emit(q.s, q.e, q.v, q.x);
    if (crecs) {
      // Left at its default, the consumer's output is the library's, piece by piece.
      if (text !== cleanup) crecs.emit(rStart, rEnd, text);
      else if (single) crecs.emit(single.start, single.end, single.value);
      else for (const q of pieces!) crecs.emit(q.s, q.e, q.v);
    }
    this.rStart = -1;
    this.rN = 0;
  }
  /** Takes the next mark; false once the text is done (or aborted). */
  step(): boolean {
    if (this.done) return false;
    const cb = this.o.callbacks;
    const m = this.merger.next();
    if (cb?.signal?.aborted) {
      this.aborted = true;
      this.done = true;
      return false;
    }
    if (!m) {
      this.done = true;
      if (cb?.signal?.aborted) {
        this.aborted = true;
        return false;
      }
      this.close();
      this.recs.finish();
      this.crecs?.finish();
      return false;
    }
    if (m.lost) {
      cb?.onLostBound?.(Object.freeze({ kind: m.lost, start: m.start, length: m.end - m.start }));
      return true;
    }
    const onReport = cb?.onReport;
    if (onReport && !m.quiet)
      onReport(
        Object.freeze({
          kind: m.rule,
          start: m.span ? m.span[0] : m.start,
          length: m.span ? m.span[1] - m.span[0] : m.end - m.start,
          extracted: m.extracted !== undefined ? m.extracted : this.o.extract(m, this.source),
          count: m.n,
        }),
      );
    this.o.sink?.mark(m);
    if (m.mode !== 'cleanup') return true;
    if (this.rStart >= 0 && m.start >= this.rEnd) this.close();
    if (this.rStart < 0) {
      this.rStart = m.start;
      this.rEnd = m.end;
    } else if (m.end > this.rEnd) this.rEnd = m.end;
    this.rMarks[this.rN++] = m;
    return true;
  }
  /** Runs to the end. */
  run(): void {
    while (this.step());
  }
}
