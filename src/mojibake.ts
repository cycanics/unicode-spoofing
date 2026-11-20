/**
 * Decision 42: mojibake, UTF-8 read as Windows-1252 (or Latin-1, C1 controls
 * for bytes 0x80–0x9F) or as Windows-1251. A hit is a whole sequence: a lead
 * character (bytes C2–F4) and exactly the continuation characters (bytes
 * 80–BF) that decode to one valid UTF-8 code point in a block real text uses.
 *
 * Which hits count (mojibake-micro-research.md):
 * - Windows-1252: the sequence guards (a) and (b), or the script
 *   context (Latin-looking garbage in a word of Cyrillic or Greek letters, word unit).
 * - Windows-1251: the Windows-1251 guards, or script context with the sequence guards
 *   (Cyrillic-looking garbage in a word of Latin letters, word unit), or the curly
 *   quotes `вЂњ` / `вЂќ`.
 * The two pages' lead characters are disjoint (Latin `Â`…`ô`, Cyrillic
 * `В`…`ф`), so their hits never overlap.
 */

import type { RawMark } from './core';

/** One sequence: source [s, e), the code point it encodes. */
export interface MojibakeHit {
  s: number;
  e: number;
  cp: number;
}

/** A source character's byte under a code page (-1: none); the pages' characters are all below U+2123. */
const PAGE_TOP = 0x2123;
/** Windows-1252's characters for bytes 80–9F (its five gaps read as the C1 control). */
export const CP1252_HIGH = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F\u0090‘’“”•–—˜™š›œ\u009DžŸ';
const B1252 = new Int16Array(PAGE_TOP).fill(-1);
{
  const cp1252 = CP1252_HIGH;
  for (let b = 0xa0; b <= 0xff; b++) B1252[b] = b;
  for (let i = 0; i < 32; i++) {
    B1252[0x80 + i] = 0x80 + i;
    B1252[cp1252.charCodeAt(i)] = 0x80 + i;
  }
}
const B1251 = new Int16Array(PAGE_TOP).fill(-1);
{
  const dec = new TextDecoder('windows-1251');
  for (let b = 0x80; b <= 0xff; b++) {
    const c = dec.decode(Uint8Array.of(b)).charCodeAt(0);
    if (c !== 0xfffd && c < PAGE_TOP) B1251[c] = b;
  }
  B1251[0x98] = 0x98;
}

/** Continuation characters (bytes 80–BF): bit 1 of Windows-1252, bit 2 of Windows-1251. */
const CONT = new Uint8Array(0x10000);
for (let c = 0x80; c < PAGE_TOP; c++)
  CONT[c] =
    (B1252[c]! >= 0x80 && B1252[c]! <= 0xbf ? 1 : 0) |
    (B1251[c]! >= 0x80 && B1251[c]! <= 0xbf ? 2 : 0);

/** Blocks real text uses (the decoded code point must lie in one, and be assigned). */
const PLAUSIBLE: readonly (readonly [number, number])[] = [
  [0xa0, 0x24f],
  [0x300, 0x36f],
  [0x370, 0x52f],
  [0x590, 0x6ff],
  [0x2000, 0x206f],
  [0x20a0, 0x20cf],
  [0x2100, 0x22ff],
  [0x2190, 0x21ff],
  [0x2500, 0x27bf],
  [0x3000, 0x9fff],
  [0xac00, 0xd7af],
  [0xfe00, 0xfe0f],
  [0xff00, 0xffef],
  [0x1f000, 0x1faff],
];
const CN_RE = /\p{Cn}/u;
const plausible = (cp: number) =>
  PLAUSIBLE.some(([a, b]) => cp >= a && cp <= b) && !CN_RE.test(String.fromCodePoint(cp));

/**
 * The plausible sequences of one page at lead position i (a lead character
 * followed by its continuation characters), or null.
 */
function decodeAt(text: string, page: Int16Array, i: number): MojibakeHit | null {
  const n = text.length;
  const byte = (q: number) => {
    const c = q < n ? text.charCodeAt(q) : 0;
    return c >= 0x80 && c < PAGE_TOP ? page[c]! : -1;
  };
  const b0 = byte(i);
  if (b0 < 0xc2 || b0 > 0xf4) return null;
  const len = b0 >= 0xf0 ? 3 : b0 >= 0xe0 ? 2 : 1;
  let cp = b0 & (len === 1 ? 0x1f : len === 2 ? 0x0f : 0x07);
  for (let k = 1; k <= len; k++) {
    const b = byte(i + k);
    if (b < 0x80 || b > 0xbf) return null;
    cp = (cp << 6) | (b & 0x3f);
  }
  // Valid UTF-8 only: no overlongs, no surrogates, at most U+10FFFF.
  if (
    (len === 2 && (cp < 0x800 || (cp >= 0xd800 && cp <= 0xdfff))) ||
    (len === 3 && (cp < 0x10000 || cp > 0x10ffff))
  )
    return null;
  if (!plausible(cp)) return null;
  return { s: i, e: i + len + 1, cp };
}

/**
 * Every plausible sequence of each page, ascending, non-overlapping within a
 * page: one pass over the text, a page tried at each of its lead characters
 * followed by one of its continuation characters, left to right.
 */
function scan(text: string): [MojibakeHit[], MojibakeHit[]] {
  const a: MojibakeHit[] = [];
  const b: MojibakeHit[] = [];
  let fromA = 0;
  let fromB = 0;
  const n = text.length;
  for (let j = 1; j < n; j++) {
    // One table lookup per code unit (the table covers the BMP).
    const bits = CONT[text.charCodeAt(j)]!;
    if (bits === 0) continue;
    if (bits & 1 && j - 1 >= fromA) {
      const h = decodeAt(text, B1252, j - 1);
      if (h) {
        a.push(h);
        fromA = h.e;
      }
    }
    if (bits & 2 && j - 1 >= fromB) {
      const h = decodeAt(text, B1251, j - 1);
      if (h) {
        b.push(h);
        fromB = h.e;
      }
    }
  }
  return [a, b];
}

const LETTERS_RE = /^\p{L}+$/u;
const L_RE = /\p{L}/u;
const LATIN_RE = /\p{Script=Latin}/u;
const CYRGR_RE = /[\p{Script=Cyrillic}\p{Script=Greek}]/u;
const PUNCT_RE = /^[‘-„–—…•\u0080-\u009f]+$/u;
const PUNCT2_RE = /^[«»‘-„–—…•‹›\u0080-\u009f]+$/u;
const WORD_CH_RE = /[\p{L}\p{N}\p{M}'’]/u;

const seqOf = (text: string, x: MojibakeHit) => text.slice(x.s, x.e);
const touches = (xs: MojibakeHit[], k: number) =>
  (k > 0 && xs[k - 1]!.e === xs[k]!.s) || (k + 1 < xs.length && xs[k + 1]!.s === xs[k]!.e);

/**
 * The sequence guards (both pages): (a) a sequence encoding a letter of a script other than
 * Latin counts only in a run of sequences; (b) one encoding a Latin letter
 * through a punctuation continuation (`Ã’`) only with a letter right after it
 * or in a run; (c, `letterGuard`) a sequence of letters only in a run.
 */
function guards(text: string, xs: MojibakeHit[], letterGuard: boolean): MojibakeHit[] {
  return xs.filter((x, k) => {
    const ch = String.fromCodePoint(x.cp);
    const seq = seqOf(text, x);
    const run = touches(xs, k);
    if (run) return true;
    if (letterGuard && LETTERS_RE.test(seq)) return false;
    if (L_RE.test(ch) && !LATIN_RE.test(ch)) return false;
    if (LATIN_RE.test(ch) && PUNCT_RE.test(seq.slice(1)) && !L_RE.test(text[x.e] ?? ''))
      return false;
    return true;
  });
}

/**
 * The Windows-1251 guards: the sequence guards with the letter guard, then (d) letters-only
 * sequences led by anything but `Р С Г В` and (e) sequences encoding a
 * combining mark are dropped; a run then counts only between sequences of the
 * same length, and letters-only sequences, punctuation continuations with no
 * letter after, and non-Latin letters need such a run.
 */
function guards1251(text: string, xs: MojibakeHit[]): MojibakeHit[] {
  const ys = guards(text, xs, true).filter((x) => {
    const seq = seqOf(text, x);
    return (
      !(LETTERS_RE.test(seq) && !'РСГВ'.includes(seq[0]!)) && !(x.cp >= 0x300 && x.cp <= 0x36f)
    );
  });
  return ys.filter((x, k) => {
    const len = x.e - x.s;
    const run =
      (k > 0 && ys[k - 1]!.e === x.s && ys[k - 1]!.e - ys[k - 1]!.s === len) ||
      (k + 1 < ys.length && ys[k + 1]!.s === x.e && ys[k + 1]!.e - ys[k + 1]!.s === len);
    if (run) return true;
    const ch = String.fromCodePoint(x.cp);
    const seq = seqOf(text, x);
    if (LETTERS_RE.test(seq)) return false;
    if (PUNCT2_RE.test(seq.slice(1)) && !L_RE.test(text[x.e] ?? '')) return false;
    if (L_RE.test(ch) && !LATIN_RE.test(ch)) return false;
    return true;
  });
}

/**
 * Script context, word unit: a candidate counts when the
 * rest of its word (every sequence left out) has letters and all are of the
 * wanted kind (`want`: Latin, or Cyrillic or Greek); a word of sequences only
 * when its nearest words, each voting by its converted form, are of that kind
 * (at least one votes). A word is a run of letters, digits, marks, apostrophes
 * and sequence characters.
 */
function context(
  text: string,
  cand: MojibakeHit[],
  all: MojibakeHit[],
  want: 'latin' | 'cyrillicGreek',
): MojibakeHit[] {
  if (!cand.length) return cand;
  const inSeq = new Uint8Array(text.length);
  for (const x of all) inSeq.fill(1, x.s, x.e);
  const isB = (i: number) => !inSeq[i] && !WORD_CH_RE.test(text[i]!);
  const wordAt = (s: number, e: number): [number, number] => {
    let a = s;
    let b = e;
    while (a > 0 && !isB(a - 1)) a--;
    while (b < text.length && !isB(b)) b++;
    return [a, b];
  };
  const seqsIn = (a: number, b: number) => {
    let lo = 0;
    let hi = all.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (all[m]!.s < a) lo = m + 1;
      else hi = m;
    }
    const o: MojibakeHit[] = [];
    for (let k = lo; k < all.length && all[k]!.s < b; k++) if (all[k]!.e <= b) o.push(all[k]!);
    return o;
  };
  // Letters of [a, b) by kind: sequences left out (rest) or as what they encode (vote).
  const tally = (a: number, b: number, decode: boolean) => {
    const seqs = seqsIn(a, b);
    let lat = 0;
    let cyr = 0;
    let oth = 0;
    let j = 0;
    for (let i = a; i < b; i++) {
      while (j < seqs.length && seqs[j]!.e <= i) j++;
      let c: string;
      if (j < seqs.length && seqs[j]!.s <= i && i < seqs[j]!.e) {
        i = seqs[j]!.e - 1;
        if (!decode) continue;
        c = String.fromCodePoint(seqs[j]!.cp);
      } else c = text[i]!;
      if (!L_RE.test(c)) continue;
      if (LATIN_RE.test(c)) lat++;
      else if (CYRGR_RE.test(c)) cyr++;
      else oth++;
    }
    return { lat, cyr, oth };
  };
  const wantKind = want === 'cyrillicGreek' ? 'C' : 'L';
  const vote = (a: number, b: number) => {
    const { lat, cyr, oth } = tally(a, b, true);
    if (!lat && !cyr && !oth) return null;
    return lat >= cyr && lat >= oth ? 'L' : cyr >= oth ? 'C' : 'O';
  };
  const nearest = (a: number, b: number, dir: -1 | 1) => {
    let p = dir < 0 ? a - 1 : b;
    for (let n = 0; n < 50; n++) {
      while (p >= 0 && p < text.length && isB(p)) p += dir;
      if (p < 0 || p >= text.length) return null;
      const [ta, tb] = wordAt(p, p + 1);
      const v = vote(ta, tb);
      if (v) return v;
      p = dir < 0 ? ta - 1 : tb;
    }
    return null;
  };
  // Candidates ascend: the word of the last one answers every candidate inside it (linear time).
  let lastB = -1;
  let lastOk = false;
  return cand.filter((x) => {
    if (x.s < lastB) return lastOk;
    const [a, b] = wordAt(x.s, x.e);
    const r = tally(a, b, false);
    let ok: boolean;
    if (r.lat + r.cyr + r.oth > 0)
      ok =
        want === 'cyrillicGreek'
          ? r.cyr > 0 && r.lat === 0 && r.oth === 0
          : r.lat > 0 && r.cyr === 0 && r.oth === 0;
    else {
      const l = nearest(a, b, -1);
      const rr = nearest(a, b, 1);
      ok =
        (l !== null || rr !== null) &&
        (l === null || l === wantKind) &&
        (rr === null || rr === wantKind);
    }
    lastB = b;
    lastOk = ok;
    return ok;
  });
}

/** Hits in either list, ascending (each list ascending, a start in both taken once). */
function union(a: MojibakeHit[], b: MojibakeHit[]): MojibakeHit[] {
  if (!b.length) return a;
  if (!a.length) return b;
  const out: MojibakeHit[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const x = a[i];
    const y = b[j];
    if (y === undefined || (x !== undefined && x.s < y.s)) out.push(a[i++]!);
    else if (x === undefined || y.s < x.s) out.push(b[j++]!);
    else {
      out.push(a[i++]!);
      j++;
    }
  }
  return out;
}

/** Lead characters (bytes C2–F4) of Windows-1252 and Windows-1251. */
const LEAD_RE = /[\u00c2-\u00f4\u0412-\u0444]/;

/** The mojibake sequences of `text`, both pages, ascending. */
export function mojibakeHits(text: string): MojibakeHit[] {
  // No lead character of either page: nothing to read.
  if (!LEAD_RE.test(text)) return [];
  const [a, b] = scan(text);
  const h1252 = a.length ? union(guards(text, a, false), context(text, a, a, 'cyrillicGreek')) : a;
  const h1251 = b.length
    ? union(
        union(guards1251(text, b), context(text, guards(text, b, false), b, 'latin')),
        b.filter((x) => x.cp === 0x201c || x.cp === 0x201d),
      )
    : b;
  return union(h1252, h1251);
}

/**
 * Phase 1's `mojibake` rule (decision 42): one report per span of adjacent
 * sequences, on the source before control characters are removed. `extracted`
 * is the text the span encodes; `count` its sequences.
 */
export function* mojibakeMarks(text: string, limit = Infinity): Generator<RawMark> {
  const hits = mojibakeHits(text);
  const cps = (a: number, b: number) => {
    let n = 0;
    for (let p = a; p < b; p += text.codePointAt(p)! > 0xffff ? 2 : 1) n++;
    return n;
  };
  for (let k = 0; k < hits.length;) {
    const s = hits[k]!.s;
    let e = hits[k]!.e;
    let decoded = String.fromCodePoint(hits[k]!.cp);
    let n = 1;
    // Decision 42e: a span reaches at most `limit` code points; a longer one is a series of spans.
    let reach = cps(s, e);
    for (k++; k < hits.length && hits[k]!.s === e; k++, n++) {
      const w = cps(hits[k]!.s, hits[k]!.e);
      if (reach + w > limit) break;
      reach += w;
      e = hits[k]!.e;
      decoded += String.fromCodePoint(hits[k]!.cp);
    }
    yield {
      rule: 'mojibake',
      cls: 'mojibake',
      start: s,
      end: e,
      n,
      value: '',
      mode: 'report',
      counted: false,
      extracted: decoded,
    };
  }
}
