/**
 * Strict `analyze`'s hidden-character words: the whitespace-delimited chunks
 * holding a counted removal (§6.2), with the classes removed from each, on the
 * text without the control layer's removals. They become `words` entries
 * (`invisible`, `zalgo`, `illegal`). Fed by phase 1's marks and records.
 */

import { isWS } from './chars';
import type { LibRecord, MarkSink, RawMark } from './core';
import { TERMINAL_CLASSES } from './terminal';
import type { SpoofSignal, WordFinding } from './types';

const isHigh = (u: number) => u >= 0xd800 && u <= 0xdbff;
const isLow = (u: number) => u >= 0xdc00 && u <= 0xdfff;
const isControl = (cls: string) => cls === 'controlChar' || TERMINAL_CLASSES.has(cls);
type Chunk = {
  word: string;
  index: number;
  nonStack: boolean;
  nonControl: boolean;
  normalized: string;
};

/** Interval layout: start, end, emitted length. */
interface Interval {
  s: number;
  e: number;
  v: number;
  value: string;
}

export class HiddenWords implements MarkSink {
  // Hidden marks waiting for the stream to pass their end: start, end, class, counted, a span removed whole.
  private readonly ps: number[] = [];
  private readonly pe: number[] = [];
  private readonly pc: string[] = [];
  private readonly pk: boolean[] = [];
  private readonly pspan: boolean[] = [];
  private pHead = 0;
  private readonly iv: Interval[] = [];
  private readonly landsAt: number[] = [];
  private readonly shifts: number[] = [];
  // Removals for the words: view start, view end, class, counted.
  private rs = new Int32Array(256);
  private re = new Int32Array(256);
  /** Bits: 1 a mark stack, 2 a control, 4 counted. */
  private rf = new Uint8Array(256);
  private rn = 0;
  private readonly edits: { start: number; end: number; value: string }[] = [];
  /** The counted control-layer removals: start, end. */
  private readonly layerS: number[] = [];
  private readonly layerE: number[] = [];
  private goneS = -1;
  private goneE = -1;
  constructor(
    private readonly source: string,
    private readonly terminal: boolean,
    /** Decision 42e: a hidden-character word is reported in chunks of this many code points. */
    private readonly limit = 4096,
  ) {}
  /** The position `n` code points after `p` (before it, for negative `n`), within the view. */
  private step(view: string, p: number, n: number): number {
    if (n >= 0) {
      for (let k = 0; k < n && p < view.length; k++) p += view.codePointAt(p)! > 0xffff ? 2 : 1;
      return Math.min(p, view.length);
    }
    for (let k = 0; k < -n && p > 0; k++) {
      p--;
      const u = view.charCodeAt(p);
      if (u >= 0xdc00 && u <= 0xdfff && p > 0) {
        const h = view.charCodeAt(p - 1);
        if (h >= 0xd800 && h <= 0xdbff) p--;
      }
    }
    return p;
  }
  record(start: number, end: number, text: string, kind: LibRecord['kind']): void {
    // `analyze`'s own rules (illegal code points) are no hidden characters.
    if (kind !== 'keep' && kind !== 'split') this.edits.push({ start, end, value: text });
  }
  mark(m: RawMark): void {
    // A hidden mark waits until the stream has passed its end (controls inside it arrived).
    this.drain(m.start);
    if (m.mode !== 'cleanup') return;
    if (!m.layer) {
      const span = m.rule === 'bidiOverrideSpan';
      // A span removed whole goes before the marks at its start (they are inside it).
      let k = this.ps.length;
      if (span) while (k > this.pHead && this.ps[k - 1] === m.start) k--;
      if (k === this.ps.length) {
        this.ps.push(m.start);
        this.pe.push(m.end);
        this.pc.push(m.cls);
        this.pk.push(m.counted);
        this.pspan.push(span);
      } else {
        this.ps.splice(k, 0, m.start);
        this.pe.splice(k, 0, m.end);
        this.pc.splice(k, 0, m.cls);
        this.pk.splice(k, 0, m.counted);
        this.pspan.splice(k, 0, span);
      }
      return;
    }
    if (m.counted) {
      this.layerS.push(m.start);
      this.layerE.push(m.end);
    }
    const iv = this.iv;
    const k = iv.length - 1;
    const p = iv[k];
    if (p && m.start < p.e) {
      if (m.end > p.e) {
        p.e = m.end;
        if (m.value === '') {
          p.v = 0;
          p.value = '';
        }
        const before = k === 0 ? 0 : this.shifts[k - 1]!;
        this.landsAt[k] = p.s - before + p.v;
        this.shifts[k] = before + p.e - p.s - p.v;
      }
      return;
    }
    const before = k < 0 ? 0 : this.shifts[k]!;
    iv.push({ s: m.start, e: m.end, v: m.value.length, value: m.value });
    this.landsAt.push(m.start - before + m.value.length);
    this.shifts.push(before + m.end - m.start - m.value.length);
  }
  private toView(p: number): number {
    const iv = this.iv;
    if (!iv.length) return p;
    let lo = 0;
    let hi = iv.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (iv[mid]!.s < p) lo = mid + 1;
      else hi = mid;
    }
    const k = lo - 1;
    if (k < 0) return p;
    const x = iv[k]!;
    const shiftBefore = k === 0 ? 0 : this.shifts[k - 1]!;
    if (p < x.e) return x.s - shiftBefore;
    return p - this.shifts[k]!;
  }
  private toInput(offset: number): number {
    if (!this.iv.length) return offset;
    const landsAt = this.landsAt;
    let lo = 0;
    let hi = landsAt.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (landsAt[mid]! <= offset) lo = mid + 1;
      else hi = mid;
    }
    return offset + (lo === 0 ? 0 : this.shifts[lo - 1]!);
  }
  private push(s: number, e: number, cls: string, counted: boolean): void {
    if (this.rn === this.rs.length) {
      const grow = <T extends Int32Array | Uint8Array>(a: T): T => {
        const b = new (a.constructor as new (n: number) => T)(a.length * 2);
        b.set(a);
        return b;
      };
      this.rs = grow(this.rs);
      this.re = grow(this.re);
      this.rf = grow(this.rf);
    }
    const k = this.rn++;
    this.rs[k] = s;
    this.re[k] = e;
    this.rf[k] = (cls === 'markStack' ? 1 : 0) | (isControl(cls) ? 2 : 0) | (counted ? 4 : 0);
  }
  /** Processes the waiting marks that end at or before p. */
  private drain(p: number): void {
    const { ps, pe } = this;
    let h = this.pHead;
    while (h < ps.length && pe[h]! <= p) {
      this.process(ps[h]!, pe[h]!, this.pc[h]!, this.pk[h]!, this.pspan[h]!);
      h++;
    }
    if (h > 1024 && h * 2 > ps.length) {
      for (const a of [ps, pe, this.pc, this.pk, this.pspan] as unknown[][]) a.splice(0, h);
      h = 0;
    }
    this.pHead = h;
  }
  private process(start: number, end: number, cls: string, counted: boolean, span: boolean): void {
    const vs = this.toView(start);
    const ve = this.toView(end);
    if (span) {
      // A span removed whole: a mark inside it is already removed.
      this.goneS = vs;
      this.goneE = ve;
      this.push(vs, ve, 'bidiOverrideSpan', true);
      return;
    }
    const inGone = this.goneS <= vs && vs < this.goneE;
    if (cls === 'markStack') {
      if (!inGone) this.push(vs, ve, 'markStack', counted);
      return;
    }
    if (inGone && ve <= this.goneE) return;
    this.push(inGone ? this.goneE : vs, ve, cls, counted);
  }
  /** The words, in input order. */
  result(): WordFinding[] {
    const { source, iv } = this;
    this.drain(Infinity);
    let view = source;
    if (iv.length) {
      let out = '';
      let c = 0;
      for (const x of iv) {
        out += source.slice(c, x.s) + x.value;
        c = x.e;
      }
      view = out + source.slice(c);
    }
    // Removals in view order.
    const n = this.rn;
    const { rs, re, rf } = this;
    // Removals arrive in view order but for a span's outlasting run; sort only then.
    let order: number[] | null = null;
    for (let i = 1; i < n; i++)
      if (rs[i]! < rs[i - 1]!) {
        order = Array.from({ length: n }, (_, j) => j).sort((a, b) => rs[a]! - rs[b]!);
        break;
      }
    const words: Chunk[] = [];
    let k = 0;
    while (k < n) {
      const r0 = order ? order[k]! : k;
      let s = rs[r0]!;
      // Decision 42e: a word reaches at most `limit` code points past its removals each way
      // (a longer one is reported in chunks).
      // Whitespace is BMP: walking by code units finds the chunk's edges (code points counted).
      for (let n = 0; s > 0 && n < this.limit && !isWS(view.charCodeAt(s - 1)); n++) {
        s--;
        if (s > 0 && isLow(view.charCodeAt(s)) && isHigh(view.charCodeAt(s - 1))) s--;
      }
      let e = re[r0]!;
      for (let n = 0; e < view.length && n < this.limit && !isWS(view.charCodeAt(e)); n++)
        e += isHigh(view.charCodeAt(e)) && isLow(view.charCodeAt(e + 1)) ? 2 : 1;
      let hit = false;
      let nonStack = false;
      let nonControl = false;
      for (; k < n; k++) {
        const r = order ? order[k]! : k;
        if (rs[r]! >= e) break;
        const f = rf[r]!;
        if (!(f & 1)) nonStack = true;
        if (!(f & 2)) nonControl = true;
        if (f & 4) hit = true;
      }
      if (hit)
        words.push({
          word: view.slice(s, e),
          index: this.toInput(s),
          nonStack,
          nonControl,
          normalized: '',
        });
    }
    // Words holding a counted control.
    const layerS = this.layerS;
    if (layerS.length && !this.terminal) {
      const known = new Set(words.map((w) => w.index));
      const lands = this.landsAt;
      let q = 0;
      for (const w of view.matchAll(/\S+/g)) {
        // A word longer than `limit` code points in chunks of it (42e).
        const end = w.index + w[0].length;
        for (let a = w.index; a < end;) {
          const b = Math.min(end, this.step(view, a, this.limit));
          while (q < lands.length && lands[q]! < a) q++;
          const index = this.toInput(a);
          if (q < lands.length && lands[q]! <= b && !known.has(index))
            words.push({
              word: view.slice(a, b),
              index,
              nonStack: true,
              nonControl: false,
              normalized: '',
            });
          a = b > a ? b : a + 1;
        }
      }
      words.sort((x, y) => x.index - y.index);
    } else if (layerS.length) {
      // Decisions 7b, 7c: each removed control sequence is a finding of its own.
      for (let k = 0; k < layerS.length; k++)
        words.push({
          word: source.slice(layerS[k]!, this.layerE[k]!),
          index: layerS[k]!,
          nonStack: true,
          nonControl: false,
          normalized: '',
        });
      words.sort((x, y) => x.index - y.index);
    }
    const out: WordFinding[] = [];
    for (const w of words) {
      // Mark stacks only: zalgo; terminal controls only: illegal, as the lenient path calls them.
      const signal: SpoofSignal = !w.nonStack
        ? 'zalgo'
        : !w.nonControl && this.terminal
          ? 'illegal'
          : 'invisible';
      out.push({
        word: w.word,
        index: w.index,
        signals: [signal],
        scripts: [],
        normalized: cleanChunk(w.word, w.index, this.edits),
      });
    }
    return out;
  }
}

/** The cleaned form of an input chunk [index, index + word.length). */
function cleanChunk(
  word: string,
  index: number,
  edits: readonly { start: number; end: number; value: string }[],
): string {
  let lo = 0;
  let hi = edits.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (edits[mid]!.end <= index) lo = mid + 1;
    else hi = mid;
  }
  let out = '';
  let cursor = index;
  const end = index + word.length;
  for (let k = lo; k < edits.length; k++) {
    const e = edits[k]!;
    if (e.start >= end) break;
    out += word.slice(cursor - index, e.start - index) + e.value;
    cursor = e.end;
  }
  return out + word.slice(cursor - index);
}
