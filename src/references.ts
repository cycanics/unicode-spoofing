/**
 * Decision 41o: HTML character references, decoded once before phase 1 (decisions 1, 5, 9).
 * Strict `analyze` under the language model reads the input with every reference replaced by
 * the character it encodes, so every detector and the word phase see the raw character; the
 * reference text maps positions back to the input and writes the output with each reference
 * as written unless its character changed.
 */

import { HTML_LEGACY_NAMES, HTML_NAMED_PACKED } from './data/html-entities.generated';
import { CP1252_HIGH } from './mojibake';

/**
 * An HTML character reference as the HTML tokenizer reads one in text content: numeric with
 * or without `;`; a name, with `;` or a legacy name without it. The attribute-value
 * exception is not applied; the rule for names without `;` is ({@link AFTER_NAME_RE}).
 */
const HTML_REF_RE = /&(?:#([0-9]+);?|#[xX]([0-9A-Fa-f]+);?|([A-Za-z][A-Za-z0-9]*)(;?))/g;

/** After a legacy name without `;`: `=`, a letter, mark or number of any script make it text (41o). */
const AFTER_NAME_RE = /^[=\p{L}\p{M}\p{N}]$/u;

let named: Map<string, string> | null = null;
let legacy: string[] | null = null;

/** The HTML5 named references (built on first use). */
function namedRef(name: string): string | undefined {
  if (!named) {
    named = new Map();
    for (const row of HTML_NAMED_PACKED.split(';')) {
      const eq = row.indexOf('=');
      const cps = row
        .slice(eq + 1)
        .split(',')
        .map((h) => parseInt(h, 16));
      named.set(row.slice(0, eq), String.fromCodePoint(...cps));
    }
  }
  return named.get(name);
}

/** The longest legacy name (no `;` needed) that `run` starts with. */
function legacyPrefix(run: string): string | undefined {
  legacy ??= HTML_LEGACY_NAMES.split(' ').sort((a, b) => b.length - a.length);
  return legacy.find((n) => run.startsWith(n));
}

/** A numeric reference's character: HTML reads 80–9F as Windows-1252; zero, surrogates and past U+10FFFF as U+FFFD. */
function numericRef(digits: string, base: number, maxDigits: number): string {
  const v = digits.replace(/^0+/, '');
  const cp = v.length > maxDigits ? 0x110000 : v === '' ? 0 : parseInt(v, base);
  if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '�';
  return cp >= 0x80 && cp <= 0x9f ? CP1252_HIGH[cp - 0x80]! : String.fromCodePoint(cp);
}

/** What would extend a reference written without `;` if it followed it. */
const EXTENDS_RE = { named: AFTER_NAME_RE, dec: /^[0-9]$/, hex: /^[0-9A-Fa-f]$/ } as const;

/** One reference: input [s, e), the text it encodes, and what would extend it (null: it ends with `;`). */
interface Ref {
  s: number;
  e: number;
  d: string;
  open: RegExp | null;
}

/** The references of `text`; `namesNeedSemicolon`: names only with `;` (`htmlNamedReferences: 'strict'`). */
function referencesOf(text: string, namesNeedSemicolon: boolean): Ref[] {
  const refs: Ref[] = [];
  if (!text.includes('&')) return refs;
  for (const m of text.matchAll(HTML_REF_RE)) {
    const s = m.index;
    const e = s + m[0].length;
    const semi = m[0].endsWith(';');
    if (m[1] !== undefined)
      refs.push({ s, e, d: numericRef(m[1], 10, 7), open: semi ? null : EXTENDS_RE.dec });
    else if (m[2] !== undefined)
      refs.push({ s, e, d: numericRef(m[2], 16, 6), open: semi ? null : EXTENDS_RE.hex });
    else {
      const full = m[4] === ';' ? namedRef(m[3]!) : undefined;
      if (full !== undefined) refs.push({ s, e, d: full, open: null });
      else if (!namesNeedSemicolon) {
        // A legacy name without `;`, unless `=`, a letter or a digit follows (`&section=1`,
        // `&regionCode=mde`, `a&copyжурнал` stay text).
        const pre = legacyPrefix(m[3]!);
        if (pre === undefined) continue;
        const next = text.codePointAt(s + 1 + pre.length);
        if (next !== undefined && AFTER_NAME_RE.test(String.fromCodePoint(next))) continue;
        refs.push({ s, e: s + 1 + pre.length, d: namedRef(pre)!, open: AFTER_NAME_RE });
      }
    }
  }
  return refs;
}

/**
 * The input with its references decoded (`text`), and the map back. Positions of `text`
 * map to the input; a position inside a reference's decoded text maps to the reference.
 */
export class ReferenceText {
  /** The decoded text. */
  readonly text: string;
  /** Each reference's decoded span [ds, de), ascending. */
  readonly ds: number[] = [];
  readonly de: number[] = [];
  private constructor(
    readonly input: string,
    private readonly refs: Ref[],
  ) {
    let text = '';
    let p = 0;
    for (const r of refs) {
      text += input.slice(p, r.s);
      this.ds.push(text.length);
      text += r.d;
      this.de.push(text.length);
      p = r.e;
    }
    this.text = text + input.slice(p);
  }

  /** The input's references decoded, or null when it has none. */
  static of(input: string, namesNeedSemicolon: boolean): ReferenceText | null {
    const refs = referencesOf(input, namesNeedSemicolon);
    return refs.length ? new ReferenceText(input, refs) : null;
  }

  /** The number of references whose decoded text starts at or before i. */
  private upTo(i: number): number {
    const ds = this.ds;
    let lo = 0;
    let hi = ds.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ds[mid]! <= i) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** The input position of a start at i. */
  start(i: number): number {
    const k = this.upTo(i) - 1;
    if (k < 0) return i;
    const r = this.refs[k]!;
    return i < this.de[k]! ? r.s : i - this.de[k]! + r.e;
  }

  /** The input position of an end at i. */
  end(i: number): number {
    const k = this.upTo(i - 1) - 1;
    if (k < 0) return i;
    const r = this.refs[k]!;
    return i <= this.de[k]! ? r.e : i - this.de[k]! + r.e;
  }

  /** The input as written for `text[a, b)`. */
  slice(a: number, b: number): string {
    return this.input.slice(this.start(a), this.end(b));
  }

  /** `t`, which replaces `text[a, b)`, with the references it keeps as written. */
  encode(t: string, a: number, b: number): string {
    const w = new ReferenceWriter(this);
    w.word(t, a, b);
    return w.done();
  }

  /** Writes `text[a, b)` as written: references whole, a part of one decoded. */
  writeRange(w: ReferenceWriter, a: number, b: number): void {
    let k = this.upTo(a) - 1;
    if (k < 0 || a >= this.de[k]!) k++;
    let x = a;
    while (x < b) {
      if (k < this.ds.length && this.ds[k]! <= x) {
        const end = Math.min(b, this.de[k]!);
        if (x === this.ds[k]! && end === this.de[k]!) {
          const r = this.refs[k]!;
          w.put(this.input.slice(r.s, r.e), r);
        } else w.put(this.text.slice(x, end), null);
        x = end;
        k++;
        continue;
      }
      const y = k < this.ds.length ? Math.min(b, this.ds[k]!) : b;
      const s = this.start(x);
      w.put(this.input.slice(s, s + y - x), null);
      x = y;
    }
  }

  /** A position not inside a reference's decoded text or a surrogate pair (`dir` -1: back, 1: on). */
  snap(x: number, dir: -1 | 1): number {
    const k = this.upTo(x) - 1;
    if (k >= 0 && x > this.ds[k]! && x < this.de[k]!) return dir < 0 ? this.ds[k]! : this.de[k]!;
    const u = this.text.charCodeAt(x);
    if (x > 0 && u >= 0xdc00 && u <= 0xdfff) return x + dir;
    return x;
  }

  /** Every decoded reference span, flat `[ds, de, …]` (decision 41o's neighbour test). */
  spans(): number[] {
    return this.ds.flatMap((d, k) => [d, this.de[k]!]);
  }
}

/** Whether `next` (the output right after a reference written without `;`) would extend it or end it with `;`. */
function extendsRef(ref: Ref, next: string): boolean {
  if (next === '') return false;
  const c = String.fromCodePoint(next.codePointAt(0)!);
  return c === ';' || ref.open!.test(c);
}

/**
 * The output written back over the input: source runs and references as written, changed text
 * as it is. References without `;` written in a row are held until the text after them is
 * known; each is written decoded when what follows it in the output (the next one decoded, or
 * that text) would extend it or end it with `;`, so the output reads as the input's references did.
 */
export class ReferenceWriter {
  private parts: string[] = [];
  /** The held references without `;`, in output order, each with its text as written and tag. */
  private chain: { ref: Ref; written: string; tag: number }[] = [];
  /** A tag the sink receives with each piece: what was being written when it was put (a record's index). */
  tag = 0;
  constructor(
    private readonly rt: ReferenceText,
    private readonly sink: ((t: string, tag: number) => void) | null = null,
  ) {}

  /** Writes `t`; `ref` when `t` is that reference as written. */
  put(t: string, ref: Ref | null): void {
    if (t === '') return;
    if (ref?.open) {
      this.chain.push({ ref, written: t, tag: this.tag });
      return;
    }
    this.release(t);
    this.emit(t, this.tag);
  }

  /** Writes the held references, `next` after them ('' at the end): last first, each by what follows it. */
  private release(next: string): void {
    const c = this.chain;
    if (!c.length) return;
    this.chain = [];
    const out: string[] = new Array<string>(c.length);
    for (let k = c.length - 1; k >= 0; k--) {
      const h = c[k]!;
      out[k] = extendsRef(h.ref, k + 1 < c.length ? out[k + 1]! : next) ? h.ref.d : h.written;
    }
    for (let k = 0; k < c.length; k++) this.emit(out[k]!, c[k]!.tag);
  }

  /** Writes `text[a, b)` as written. */
  range(a: number, b: number): void {
    if (b > a) this.rt.writeRange(this, a, b);
  }

  /** Writes changed text. */
  text(t: string): void {
    this.put(t, null);
  }

  /**
   * Writes `t`, which replaces `text[a, b)`: what it shares with that text at both ends as
   * written, the rest as it is (`p&#1072;ypal` → `paypal`, `C&#1087;росите` → `С&#1087;росите`).
   */
  word(t: string, a: number, b: number): void {
    const { text } = this.rt;
    const n = Math.min(t.length, b - a);
    let p = 0;
    while (p < n && t.charCodeAt(p) === text.charCodeAt(a + p)) p++;
    let q = 0;
    while (q < n - p && t.charCodeAt(t.length - 1 - q) === text.charCodeAt(b - 1 - q)) q++;
    if (p === t.length && p === b - a) return this.range(a, b);
    p = this.rt.snap(a + p, -1) - a;
    q = b - this.rt.snap(b - q, 1);
    this.range(a, a + p);
    this.text(t.slice(p, t.length - q));
    this.range(b - q, b);
  }

  private emit(t: string, tag: number): void {
    if (this.sink) this.sink(t, tag);
    else this.parts.push(t);
  }

  /** The tag of the first held reference (what may still change), -1 when none is held. */
  waiting(): number {
    return this.chain.length ? this.chain[0]!.tag : -1;
  }

  /** Writes what is held; the text written (when there is no sink). */
  done(): string {
    this.release('');
    return this.parts.join('');
  }
}
