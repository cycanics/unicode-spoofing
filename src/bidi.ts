/**
 * Display order of one word (decision 36e): the Unicode Bidirectional Algorithm
 * (UAX #9) rules W1–W7, N1–N2, I1–I2 and L2 applied to the word alone, as an
 * isolating run sequence in its paragraph's direction. A word holds no explicit
 * embedding (controls are cleaned before), so no X rules apply.
 *
 * Bidi classes come from the Unicode Character Database (generated table);
 * classes a word cannot hold (separators, controls) read as other neutrals.
 */

import { BIDI_CLASS_RUNS } from './data/bidi-classes.generated';

const enum K {
  L,
  R,
  AL,
  EN,
  AN,
  ES,
  ET,
  CS,
  NSM,
  ON,
}

/** Characters that make a word need the algorithm: right-to-left letters and Arabic digits. */
export const RTL_CHAR_RE =
  /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff\u{10800}-\u{10fff}\u{1e800}-\u{1efff}]/u;

/** Bidi classes by code point (UCD, `src/data/bidi-classes.generated.ts`): run starts and classes. */
const RUN_START: number[] = [];
const RUN_CLASS: K[] = [];
for (const r of BIDI_CLASS_RUNS.split(';')) {
  const c = r.indexOf(':');
  RUN_START.push(parseInt(r.slice(0, c), 16));
  RUN_CLASS.push(Number(r.slice(c + 1)) as K);
}

function cls(ch: string): K {
  const cp = ch.codePointAt(0)!;
  let lo = 0;
  let hi = RUN_START.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (RUN_START[mid]! <= cp) lo = mid;
    else hi = mid - 1;
  }
  return RUN_CLASS[lo]!;
}

/** A paragraph separator (UAX #9 class B): LF, CR, FS, GS, RS, NEL, U+2029. */
export function isParaSep(u: number): boolean {
  return u === 0x0a || u === 0x0d || (u >= 0x1c && u <= 0x1e) || u === 0x85 || u === 0x2029;
}

/**
 * The direction of a paragraph (UAX #9 P2, P3): its first strong character (L, or
 * R/AL), characters between an isolate initiator and its matching PDI skipped; none:
 * left to right.
 */
export function firstStrongRtl(text: string, from: number, to: number): boolean {
  let iso = 0;
  for (let i = from; i < to;) {
    const cp = text.codePointAt(i)!;
    i += cp > 0xffff ? 2 : 1;
    if (cp >= 0x2066 && cp <= 0x2068) {
      iso++;
      continue;
    }
    if (cp === 0x2069) {
      if (iso > 0) iso--;
      continue;
    }
    if (iso > 0) continue;
    const k = cls(String.fromCodePoint(cp));
    if (k === K.L) return false;
    if (k === K.R || k === K.AL) return true;
  }
  return false;
}

/**
 * The display order (left to right) of a word's characters `chars` (one entry
 * per character; marks are their own entries), in a paragraph of direction
 * `rtl`: indices into `chars`.
 */
export function displayOrder(chars: readonly string[], rtl: boolean): number[] {
  const n = chars.length;
  const e = rtl ? 1 : 0;
  const sos = rtl ? K.R : K.L;
  const t = chars.map(cls);
  // W1: a mark takes the type of the character before it (sos at the start).
  for (let i = 0; i < n; i++) if (t[i] === K.NSM) t[i] = i === 0 ? sos : t[i - 1]!;
  // W2: EN after AL (looking back to the last strong type) becomes AN.
  let last = sos;
  for (let i = 0; i < n; i++) {
    const k = t[i]!;
    if (k === K.L || k === K.R || k === K.AL) last = k;
    else if (k === K.EN && last === K.AL) t[i] = K.AN;
  }
  // W3: AL becomes R.
  for (let i = 0; i < n; i++) if (t[i] === K.AL) t[i] = K.R;
  // W4: one separator between two numbers of the same type.
  for (let i = 1; i + 1 < n; i++) {
    const a = t[i - 1]!;
    const b = t[i + 1]!;
    if (t[i] === K.ES && a === K.EN && b === K.EN) t[i] = K.EN;
    else if (t[i] === K.CS && a === b && (a === K.EN || a === K.AN)) t[i] = a;
  }
  // W5: terminators next to European numbers.
  for (let i = 0; i < n; i++) {
    if (t[i] !== K.ET) continue;
    let j = i;
    while (j < n && t[j] === K.ET) j++;
    if ((i > 0 && t[i - 1] === K.EN) || (j < n && t[j] === K.EN))
      for (let q = i; q < j; q++) t[q] = K.EN;
    i = j - 1;
  }
  // W6: remaining separators and terminators are neutral.
  for (let i = 0; i < n; i++) if (t[i] === K.ES || t[i] === K.ET || t[i] === K.CS) t[i] = K.ON;
  // W7: EN after L (or sos L) becomes L.
  last = sos;
  for (let i = 0; i < n; i++) {
    const k = t[i]!;
    if (k === K.L || k === K.R) last = k;
    else if (k === K.EN && last === K.L) t[i] = K.L;
  }
  // N1, N2: neutrals between two strong types of one direction take it; others the embedding's.
  const dir = (k: K) => (k === K.L ? K.L : K.R);
  for (let i = 0; i < n; i++) {
    if (t[i] !== K.ON) continue;
    let j = i;
    while (j < n && t[j] === K.ON) j++;
    const before = i > 0 ? dir(t[i - 1]!) : sos;
    const after = j < n ? dir(t[j]!) : sos;
    const d = before === after ? before : rtl ? K.R : K.L;
    for (let q = i; q < j; q++) t[q] = d;
    i = j - 1;
  }
  // I1, I2: levels.
  const lv = t.map((k) =>
    e === 0
      ? k === K.R
        ? 1
        : k === K.AN || k === K.EN
          ? 2
          : 0
      : k === K.L || k === K.EN || k === K.AN
        ? 2
        : 1,
  );
  // L2: reverse every run at each level from the highest down to the lowest odd one.
  const order = chars.map((_, i) => i);
  let max = 0;
  let minOdd = 99;
  for (const l of lv) {
    if (l > max) max = l;
    if (l % 2 === 1 && l < minOdd) minOdd = l;
  }
  for (let level = max; level >= minOdd && level > 0; level--) {
    for (let i = 0; i < n; i++) {
      if (lv[order[i]!]! < level) continue;
      let j = i;
      while (j < n && lv[order[j]!]! >= level) j++;
      const seg = order.slice(i, j).reverse();
      for (let q = i; q < j; q++) order[q] = seg[q - i]!;
      i = j - 1;
    }
  }
  return order;
}
