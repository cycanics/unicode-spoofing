/* eslint-disable no-control-regex -- control characters are what the terminal marks hold */
/**
 * main's `cleanHidden` result (v0.6.0: `cleaned`, `edits`, `findings`,
 * `payloads`, `content`, `removed`) and `analyze`'s `hidden` / `hiddenWords`,
 * rebuilt from the public callback stream only: report calls, cleanup calls
 * and output records. The library no longer builds these fields (decision 10:
 * position lists are the consumer's); this file shows a consumer how, and the
 * parity tests prove the stream carries everything main reported.
 */
import {
  analyze,
  cleanHidden,
  STRICT_HIDDEN_RULES,
  TERMINAL_RULES,
  type AnalysisResult,
  type AnalyzeOptions,
  type HiddenCharRules,
  type Mark,
  type OutputRecord,
  type TerminalClass,
} from '../../src';
import {
  charAt,
  charBefore,
  cpLen,
  isCarrier,
  isOtherInvisible,
  isTag,
  isVS,
  isWS,
  isZW,
  MARK_RE,
} from '../../src/chars';
import { TERMINAL_CLASSES } from '../../src/terminal';

const PRINTABLE_RE = /[\p{L}\p{N}\p{P}\p{Zs}]/u;
/** Payload decoding: the consumer's (decision 12a), as v0.6.0 did it. */
const vsByte = (cp: number) =>
  cp >= 0xfe00 && cp <= 0xfe0f ? cp - 0xfe00 : cp >= 0xe0100 ? cp - 0xe0100 + 16 : -1;
function printable(s: string): boolean {
  let n = 0;
  let ok = 0;
  for (const c of s) {
    n++;
    if (PRINTABLE_RE.test(c)) ok++;
  }
  return n > 0 && ok / n >= 0.9;
}

const utf8 = new TextDecoder('utf-8', { fatal: false });

type Decoded = { decoded: string } | { decoded: null; bytes: number[] } | null;
function decodeVS(cps: number[]): Decoded {
  const bytes = cps.map(vsByte).filter((b) => b >= 0);
  if (bytes.length < 2) return null;
  const s = utf8.decode(Uint8Array.from(bytes));
  return printable(s) ? { decoded: s } : { decoded: null, bytes };
}
function decodeTags(cps: number[]): Decoded {
  let s = '';
  for (const c of cps) if (c > 0xe0000 && c < 0xe007f) s += String.fromCharCode(c - 0xe0000);
  return s.length ? { decoded: s } : null;
}
/** Two-symbol binary over a zero-width run; both polarities, 8-bit MSB-first. */
function decodeZW(cps: number[]): Decoded {
  const syms = [...new Set(cps)];
  if (cps.length < 8 || syms.length !== 2) return null;
  const bytesFor = (zero: number) => {
    const bytes: number[] = [];
    for (let i = 0; i + 8 <= cps.length; i += 8) {
      let b = 0;
      for (let k = 0; k < 8; k++) b = (b << 1) | (cps[i + k] === zero ? 0 : 1);
      bytes.push(b);
    }
    return bytes;
  };
  for (const zero of syms) {
    const s = utf8.decode(Uint8Array.from(bytesFor(zero)));
    if (printable(s)) return { decoded: s };
  }
  return { decoded: null, bytes: bytesFor(syms[0]!) };
}

/** main's hex: the first 32 bytes, '…' if longer (the library's `extracted` has all of them). */
const HEX_CAP = 32;
const hex = (bytes: number[]) =>
  bytes
    .slice(0, HEX_CAP)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('') + (bytes.length > HEX_CAP ? '…' : '');

/** main's rules: the library's, plus the two that shaped main's result. */
export type CompatRules = HiddenCharRules & {
  /** List `content` (main: `reportContent`). */
  reportContent?: boolean;
  /** Decode payloads into `payloads` (main: default true). */
  decodePayloads?: boolean;
};

/** The internal form the recorder below reads, rebuilt from a public `Mark`. */
interface RawMark {
  rule: string;
  cls: string;
  start: number;
  end: number;
  n: number;
  value: string;
  mode: 'report' | 'cleanup';
  counted: boolean;
  layer?: boolean;
  cps?: number[];
  run?: [number, number];
  extracted?: string | null;
  internal?: boolean;
  info?: unknown;
}
interface LibRecord {
  start: number;
  end: number;
  text: string;
  kind: 'keep' | 'rem' | 'emit' | 'seam';
}
interface StackInfo {
  start: number;
  end: number;
  kept: number;
  text: string;
}

export type HiddenClass =
  /** U+202A–202E: embeddings and overrides. */
  | 'bidiOverride'
  /** Marks past the limit of their base's script. */
  | 'markStack'
  /** Every code point of a span removed by 'remove-with-content', its controls included. */
  | 'bidiOverrideSpan'
  /** LRM, RLM, ALM, isolates. */
  | 'bidiMark'
  | 'tag'
  | 'variationSelector'
  | 'zeroWidthRun'
  | 'zeroWidthInWord'
  | 'otherInvisible'
  | 'controlChar'
  | 'blankFiller'
  | 'softHyphen'
  | 'zeroWidth'
  | 'bom'
  /** With `rules.terminal`: one count per sequence, bare CR, backspace area or concealed span. */
  | TerminalClass;

export interface HiddenFinding {
  /** The whitespace-delimited chunk as written (controls the rules remove left out). */
  word: string;
  /** UTF-16 offset of the chunk. */
  index: number;
  /** Code points removed from the chunk, by class (silent ones included). */
  removed: Partial<Record<HiddenClass, number>>;
}

export interface HiddenPayload {
  kind: 'tag' | 'variation-selector' | 'zero-width-binary' | 'zero-width-scattered';
  /** UTF-16 offset of the run. */
  index: number;
  /** Code points in the run. */
  length: number;
  /** Printable decoded text, or null. */
  decoded: string | null;
  /** When `decoded` is null: the first 32 bytes as hex, '…' if longer. */
  bytesHex?: string;
}

export type HiddenContentKind =
  /** Tag characters, decoded as ASCII. */
  | 'tag'
  /** Selectors decoded as bytes. */
  | 'variation-selector'
  /** A two-symbol zero-width run decoded as bits. */
  | 'zero-width-binary'
  /** Zero-width characters one or two per letter, two symbols, decoded as printable bits (§15.5). */
  | 'zero-width-scattered'
  /** A zero-width run with no byte reading. */
  | 'zero-width-run'
  /** A run mixing other invisible characters (U+2062/U+2064 bits, fillers, soft hyphens); decoded as bits if it has two symbols. */
  | 'invisible-run'
  /** Letters with more marks than their script writes, which makes the line unreadable: `text` is the letters with the marks kept. */
  | 'mark-stack'
  /** An LRO/RLO that reverses letters or digits: `text` is the logical order, the screen shows another. */
  | 'bidi-override'
  /** An RTL embedding or isolate whose RLM/ALM swaps Latin words in a span with no RTL letter. */
  | 'bidi-mark-reorder'
  /** With `rules.terminal`: an OSC/DCS/SOS/PM/APC string; `text` is its body. */
  | 'terminal-string'
  /** With `rules.terminal`: text drawn concealed (SGR 8) or in its background colour. */
  | 'terminal-concealed'
  /** With `rules.terminal`: letters a backspace erases; `text` is them. */
  | 'terminal-erased';

/** One hidden thing. All offsets are UTF-16 offsets into the input. */
export interface HiddenContent {
  kind: HiddenContentKind;
  /** Start of the construct. */
  index: number;
  /** End of the construct (exclusive). */
  end: number;
  /** Code points: the carriers of an encoded run; the whole span of a bidi or mark-stack entry. */
  length: number;
  /** Decoded text, or the span in logical order without bidi controls. Null when there is no reading. */
  text: string | null;
  /** `text` is printable (encoded kinds) or has a visible character (bidi, mark-stack). */
  readable: boolean;
  /** The construct is gone from `cleaned`. A kept entry is still there. */
  removed: boolean;
  /** When an encoded run has no text: the first 32 bytes as hex, '…' if longer. */
  bytesHex?: string;
  /** One payload spread over several runs (one selector per letter): the ranges of its carriers. `text` is all of them joined. */
  parts?: { start: number; end: number }[];
  /** A `terminal-string` with no ST or BEL: cut at the end of its line. */
  unterminated?: boolean;
}

export interface HiddenReport {
  findings: HiddenFinding[];
  payloads: HiddenPayload[];
  /** What was hidden, in input order. Only with `reportContent` or a 'remove-with-content' rule. */
  content?: HiddenContent[];
  /** Code points removed over the whole text, by class. */
  removed: {
    counted: Partial<Record<HiddenClass, number>>;
    silent: Partial<Record<HiddenClass, number>>;
  };
}

/** One cleanup edit: input range [start, end) (UTF-16 offsets) replaced by `value` ('', ' ', or '\n' under `rules.terminal`). */
export interface HiddenEdit {
  start: number;
  end: number;
  value: string;
}

export interface HiddenCleanup extends HiddenReport {
  cleaned: string;
  /** Edits in input order, non-overlapping. Use them to map input offsets onto `cleaned`. */
  edits: HiddenEdit[];
  /** An `AbortSignal` stopped the cleanup: the fields cover the text up to the last finished region. */
  aborted?: true;
}

// ---------------------------------------------------------------------------

/** Most code units between two small runs of one payload; one carrier per word still fits. */
const SCATTER_GAP = 32;
/** In-word zero-width runs at most this many code points apart (marks not counted) are one scattered payload. */
const ZW_SCATTER_GAP = 2;
/** Fewest carriers of a scattered zero-width payload: 4 bytes, so noise rarely decodes as printable. */
const ZW_SCATTER_MIN = 32;

type EncodedKind = 'tag' | 'variation-selector' | 'zero-width-binary' | 'zero-width-scattered';

interface RawContent {
  kind: HiddenContentKind;
  start: number;
  end: number;
  /** Carriers of an encoded run. */
  cps?: number[];
  /** Leading code units that stay: a valid first selector; a base with the marks it keeps. */
  kept: number;
  /** Text of a mark stack, a terminal string body, concealed or erased text. */
  text?: string;
  /** Terminal entries: removed state decided by the layer. */
  removed?: boolean;
  unterminated?: boolean;
}

/** A selector run or scattered selectors: bytes even for a single one. */
function decodeContent(kind: HiddenContentKind, cps: number[]): Decoded {
  if (kind === 'tag') return decodeTags(cps);
  if (kind === 'variation-selector') {
    const r = decodeVS(cps);
    if (r) return r;
    const bytes = cps.map(vsByte).filter((v) => v >= 0);
    return bytes.length ? { decoded: null, bytes } : null;
  }
  return decodeZW(cps);
}

const isSmallRun = (kind: EncodedKind, r: RawContent) =>
  r.cps!.length <= (kind === 'zero-width-binary' || kind === 'zero-width-scattered' ? 16 : 2);
const BIDI_CONTROLS_RE = /[؜‎‏‪-‮⁦-⁩]/g;
const VISIBLE_RE = /[^\s\p{M}\p{Cf}\p{Cc}]/u;

/**
 * The finished list: in input order, runs of one scattered payload merged, and
 * `removed` read off the edits.
 */
function buildContent(
  raw: RawContent[],
  text: string,
  edits: readonly { start: number; end: number }[],
): HiddenContent[] {
  raw.sort((a, b) => a.start - b.start || b.end - a.end);
  /** Whether edits cover [from, to). */
  const covered = (from: number, to: number) => {
    let lo = 0;
    let hi = edits.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (edits[mid]!.end <= from) lo = mid + 1;
      else hi = mid;
    }
    let at = from;
    for (let e = lo; at < to && e < edits.length && edits[e]!.start <= at; e++) at = edits[e]!.end;
    return at >= to;
  };

  const last: Partial<Record<EncodedKind, { run: RawContent; entry: HiddenContent }>> = {};
  const carriers = new Map<HiddenContent, number[]>();
  const out: HiddenContent[] = [];
  for (const r of raw) {
    const removed = r.removed ?? covered(r.start + r.kept, r.end);
    if (r.kind === 'bidi-override' || r.kind === 'bidi-mark-reorder') {
      const logical = text.slice(r.start, r.end).replace(BIDI_CONTROLS_RE, '');
      out.push({
        kind: r.kind,
        index: r.start,
        end: r.end,
        length: [...text.slice(r.start, r.end)].length,
        text: logical,
        readable: VISIBLE_RE.test(logical),
        removed,
      });
      continue;
    }
    if (
      r.kind === 'terminal-string' ||
      r.kind === 'terminal-concealed' ||
      r.kind === 'terminal-erased'
    ) {
      out.push({
        kind: r.kind,
        index: r.start,
        end: r.end,
        length: [...text.slice(r.start, r.end)].length,
        text: r.text!,
        readable: VISIBLE_RE.test(r.text!),
        removed,
        ...(r.unterminated && { unterminated: true }),
      });
      continue;
    }
    if (r.kind === 'mark-stack') {
      // Stacks letter after letter are one entry.
      const prev = out[out.length - 1];
      const n = [...text.slice(r.start, r.end)].length;
      if (prev?.kind === 'mark-stack' && prev.end === r.start) {
        prev.end = r.end;
        prev.length += n;
        prev.text += r.text!;
        prev.removed &&= removed;
      } else {
        out.push({
          kind: r.kind,
          index: r.start,
          end: r.end,
          length: n,
          text: r.text!,
          readable: VISIBLE_RE.test(r.text!),
          removed,
        });
      }
      continue;
    }
    const kind = r.kind as EncodedKind;
    const prev = last[kind];
    if (
      prev &&
      isSmallRun(kind, r) &&
      isSmallRun(kind, prev.run) &&
      r.start - prev.run.end <= SCATTER_GAP
    ) {
      const e = prev.entry;
      e.parts ??= [{ start: e.index, end: e.end }];
      e.parts.push({ start: r.start, end: r.end });
      e.end = r.end;
      e.length += r.cps!.length;
      e.removed &&= removed;
      for (const cp of r.cps!) carriers.get(e)!.push(cp);
      prev.run = r;
      continue;
    }
    const entry: HiddenContent = {
      kind: r.kind,
      index: r.start,
      end: r.end,
      length: r.cps!.length,
      text: null,
      readable: false,
      removed,
    };
    carriers.set(entry, [...r.cps!]);
    out.push(entry);
    last[kind] = { run: r, entry };
  }
  for (const [e, cps] of carriers) {
    const d = decodeContent(e.kind, cps);
    e.text = d?.decoded ?? null;
    e.readable = e.text !== null && printable(e.text);
    if (d && d.decoded === null) e.bytesHex = hex(d.bytes);
  }
  return out;
}

// --- The compatibility recorder ----------------------------------------------

/** `content` is listed (reportContent or a 'remove-with-content' rule). */
export function wantsContent(rules: Readonly<CompatRules>): boolean {
  const t = rules.terminal;
  return (
    rules.reportContent === true ||
    rules.bidiOverrides === 'remove-with-content' ||
    rules.tags === 'remove-with-content' ||
    rules.variationSelectors === 'remove-with-content' ||
    rules.zeroWidthRun === 'remove-with-content' ||
    rules.markStacks === 'remove-with-content' ||
    rules.markStacksOther === 'remove-with-content' ||
    (t !== undefined && (t.stringSequence ?? 'remove-with-content') === 'remove-with-content')
  );
}

interface Rem {
  start: number;
  end: number;
  cls: string;
  counted: boolean;
  n: number;
}

/**
 * Rebuilds today's `cleanHidden` fields from the mark stream: counters by each
 * mark's default, word findings, payloads, content. Offsets of the hidden layer
 * are computed on the text without the control layer's removals, as today. A
 * hidden mark is processed once the stream has passed its end (every control
 * inside it has arrived); only the result's lists grow.
 */
export class HiddenRecorder {
  private readonly layer: RawMark[] = [];
  private readonly pending: RawMark[] = [];
  private pHead = 0;
  private readonly edits: HiddenEdit[] = [];
  private cleaned = '';
  // The control layer's cleanup as disjoint intervals, with today's toInput tables.
  private readonly iv: { s: number; e: number; v: string }[] = [];
  private readonly landsAt: number[] = [];
  private readonly shifts: number[] = [];
  // Accumulated fields.
  private readonly counted: Partial<Record<HiddenClass, number>> = {};
  private readonly silent: Partial<Record<HiddenClass, number>> = {};
  private readonly rem: Rem[] = [];
  private readonly raw: RawContent[] = [];
  private readonly payloads: HiddenPayload[] = [];
  private gone: { s: number; e: number } | null = null;
  private chain: { runs: { start: number; end: number; cps: number[] }[]; cps: number[] } | null =
    null;
  constructor(
    private readonly source: string,
    private readonly rules: Readonly<CompatRules>,
    private readonly report: boolean,
    /** Build `cleaned` (analyze needs only the edits). */
    private readonly withCleaned = true,
  ) {}
  /** One of phase 1's records: `cleaned` and `edits` grow from them. */
  record(r: LibRecord): void {
    if (this.withCleaned) this.cleaned += r.text;
    if (r.kind !== 'keep') this.edits.push({ start: r.start, end: r.end, value: r.text });
  }
  mark(m: RawMark): void {
    // Hidden marks wait until the stream has passed their end.
    const P = this.pending;
    while (this.pHead < P.length && waitEnd(P[this.pHead]!) <= m.start)
      this.process(P[this.pHead++]!);
    if (this.pHead > 256 && this.pHead * 2 > P.length) {
      P.splice(0, this.pHead);
      this.pHead = 0;
    }
    if (!m.layer) {
      P.push(m);
      return;
    }
    this.layer.push(m);
    if (m.mode !== 'cleanup') return;
    const iv = this.iv;
    const k = iv.length - 1;
    const p = iv[k];
    if (p && m.start < p.e) {
      if (m.end > p.e) {
        p.e = m.end;
        if (m.value === '') p.v = '';
        const before = k === 0 ? 0 : this.shifts[k - 1]!;
        this.landsAt[k] = p.s - before + p.v.length;
        this.shifts[k] = before + p.e - p.s - p.v.length;
      }
      return;
    }
    const before = k < 0 ? 0 : this.shifts[k]!;
    iv.push({ s: m.start, e: m.end, v: m.value });
    this.landsAt.push(m.start - before + m.value.length);
    this.shifts.push(before + m.end - m.start - m.value.length);
  }
  /** Source position → view position (inside an interval: the interval's view start). */
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
  /** View offset → input offset (today's toInput over the control edits). */
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
  private add(bucket: Partial<Record<HiddenClass, number>>, cls: string, n: number): void {
    const k = cls as HiddenClass;
    bucket[k] = (bucket[k] ?? 0) + n;
  }
  private payload(kind: HiddenPayload['kind'], index: number, n: number, d: Decoded): void {
    if (!d || this.rules.decodePayloads === false) return;
    const p: HiddenPayload = { kind, index, length: n, decoded: d.decoded };
    if (d.decoded === null) p.bytesHex = hex(d.bytes);
    this.payloads.push(p);
  }
  private process(m: RawMark): void {
    const { report, raw, rem } = this;
    const vs = this.toView(m.start);
    const ve = this.toView(m.end);
    if (m.rule === 'invisibleRun') {
      if (report) raw.push({ kind: 'invisible-run', start: vs, end: ve, cps: m.cps, kept: 0 });
      return;
    }
    if (m.rule === 'bidiOverrideSpan' || m.rule === 'bidiReorderSpan') {
      if (report)
        raw.push({
          kind: m.rule === 'bidiOverrideSpan' ? 'bidi-override' : 'bidi-mark-reorder',
          start: vs,
          end: ve,
          kept: 0,
        });
      if (m.mode === 'cleanup') {
        // Spans removed whole: a mark inside one is already removed (today's `drop`).
        this.gone = { s: vs, e: ve };
        this.add(this.counted, 'bidiOverrideSpan', m.n);
        rem.push({ start: vs, end: ve, cls: 'bidiOverrideSpan', counted: true, n: m.n });
      }
      return;
    }
    const removed = m.mode === 'cleanup';
    const gone = this.gone;
    if (m.cls === 'markStack') {
      if (report && m.info) {
        const info = m.info as StackInfo;
        const s0 = this.toView(info.start);
        raw.push({
          kind: 'mark-stack',
          start: s0,
          end: this.toView(info.end),
          kept: this.toView(info.start + info.kept) - s0,
          text: info.text,
        });
      }
      if (!removed || m.internal) return;
      if (gone && gone.s <= vs && vs < gone.e) return;
      this.add(m.counted ? this.counted : this.silent, 'markStack', m.n);
      rem.push({ start: vs, end: ve, cls: 'markStack', counted: m.counted, n: m.n });
      return;
    }
    if (report) {
      if (m.rule === 'tags') raw.push({ kind: 'tag', start: vs, end: ve, cps: m.cps, kept: 0 });
      else if (m.rule === 'variationSelectors') {
        const rs = this.toView(m.run![0]);
        raw.push({
          kind: 'variation-selector',
          start: rs,
          end: this.toView(m.run![1]),
          cps: m.cps,
          kept: vs - rs,
        });
      } else if (m.rule === 'zeroWidthRun')
        raw.push({
          kind: decodeZW(m.cps!) ? 'zero-width-binary' : 'zero-width-run',
          start: vs,
          end: ve,
          cps: m.cps,
          kept: 0,
        });
    }
    if (m.internal) return;
    if (removed) {
      let from = vs;
      let skip = false;
      if (gone && gone.s <= vs && vs < gone.e) {
        if (ve <= gone.e) skip = true;
        else from = gone.e;
      }
      if (!skip) {
        this.add(m.counted ? this.counted : this.silent, m.cls, m.n);
        rem.push({ start: from, end: ve, cls: m.cls, counted: m.counted, n: m.n });
      }
      if (m.rule === 'tags') this.payload('tag', vs, m.n, decodeTags(m.cps!));
      else if (m.rule === 'variationSelectors')
        this.payload('variation-selector', this.toView(m.run![0]), m.cps!.length, decodeVS(m.cps!));
      else if (m.rule === 'zeroWidthRun')
        this.payload('zero-width-binary', vs, m.n, decodeZW(m.cps!));
    }
    if (CLASS[m.rule] === 'zeroWidthInWord') this.chainRun(vs, ve, m.cps!, removed);
  }
  /** Zero-width bits one per letter (§15.5): in-word runs the rules remove, close together. */
  private chainRun(start: number, end: number, cps: number[], removed: boolean): void {
    const c = this.chain;
    if (c && (!removed || this.apart(c.runs[c.runs.length - 1]!.end, start))) this.endChain();
    if (!removed) return;
    const ch = (this.chain ??= { runs: [], cps: [] });
    ch.runs.push({ start, end, cps });
    for (const cp of cps) ch.cps.push(cp);
  }
  private apart(from: number, to: number): boolean {
    // Chains are read on the view; without control removals the view is the source.
    const view = this.iv.length ? null : this.source;
    let n = 0;
    for (let p = from; p < to;) {
      const ch = view ? charAt(view, p) : this.viewCharAt(p);
      if (!MARK_RE.test(ch) && ++n > ZW_SCATTER_GAP) return true;
      p += ch.length;
    }
    return false;
  }
  /** The view's character at view offset q (only with control removals). */
  private viewCharAt(q: number): string {
    const p = this.toInput(q);
    return charAt(this.source, p);
  }
  private endChain(): void {
    const ch = this.chain;
    this.chain = null;
    if (!ch || ch.cps.length < ZW_SCATTER_MIN || new Set(ch.cps).size !== 2) return;
    const d = decodeZW(ch.cps);
    if (!d || d.decoded === null) return;
    if (this.report)
      for (const r of ch.runs) this.raw.push({ kind: 'zero-width-scattered', ...r, kept: 0 });
    this.payload('zero-width-scattered', ch.runs[0]!.start, ch.cps.length, d);
  }
  result(aborted: boolean): HiddenCleanup {
    const { source, rules, report, iv, rem, raw, counted, silent } = this;
    const P = this.pending;
    while (this.pHead < P.length) this.process(P[this.pHead++]!);
    this.endChain();
    let view = source;
    if (iv.length) {
      let out = '';
      let c = 0;
      for (const x of iv) {
        out += source.slice(c, x.s) + x.v;
        c = x.e;
      }
      view = out + source.slice(c);
    }
    const toInput = (q: number) => this.toInput(q);
    const srcRange = (a: number, b: number) => ({ start: toInput(a), end: toInput(b - 1) + 1 });
    rem.sort((a, b) => a.start - b.start);
    this.payloads.sort((a, b) => a.index - b.index);

    // Counting unit = words: a whitespace-delimited chunk with at least one
    // COUNTED removal counts once, however long its payload (§6.2).
    const findings: HiddenFinding[] = [];
    let k = 0;
    while (k < rem.length) {
      let s = rem[k]!.start;
      while (s > 0) {
        const p = charBefore(view, s);
        if (isWS(p.codePointAt(0)!)) break;
        s -= p.length;
      }
      let e = rem[k]!.end;
      while (e < view.length) {
        const cp = view.codePointAt(e)!;
        if (isWS(cp)) break;
        e += cpLen(cp);
      }
      const removed: Partial<Record<HiddenClass, number>> = {};
      let hit = false;
      for (; k < rem.length && rem[k]!.start < e; k++) {
        const r = rem[k]!;
        removed[r.cls as HiddenClass] = (removed[r.cls as HiddenClass] ?? 0) + r.n;
        hit ||= r.counted;
      }
      if (hit) findings.push({ word: view.slice(s, e), index: toInput(s), removed });
    }

    // The control layer: counters, and words holding a counted control.
    const terminal = rules.terminal !== undefined;
    const ctl = this.layer.filter((m) => m.mode === 'cleanup');
    for (const m of ctl) if (!m.internal) this.add(m.counted ? counted : silent, m.cls, m.n);
    if (!terminal && ctl.length && ctl[0]!.counted) {
      const known = new Set(findings.map((f) => f.index));
      const lands = this.landsAt;
      let q = 0;
      for (const w of view.matchAll(/\S+/g)) {
        while (q < lands.length && lands[q]! < w.index) q++;
        const index = toInput(w.index);
        if (q < lands.length && lands[q]! <= w.index + w[0].length && !known.has(index))
          findings.push({ word: w[0], index, removed: { controlChar: 1 } });
      }
      findings.sort((x, y) => x.index - y.index);
    } else if (terminal) mergeLayerFindings(source, ctl, findings);

    let content: HiddenContent[] | undefined;
    if (report) {
      const viewEdits = rem.map((r) => ({ start: r.start, end: r.end }));
      content = buildContent(raw, view, viewEdits).map((c) => {
        const r = srcRange(c.index, c.end);
        return {
          ...c,
          index: r.start,
          end: r.end,
          ...(c.parts && { parts: c.parts.map((p) => srcRange(p.start, p.end)) }),
        };
      });
      if (terminal) {
        content.push(...terminalContentOf(source, this.layer));
        content.sort((a, b) => a.index - b.index);
      }
    }
    return {
      cleaned: this.cleaned,
      edits: this.edits,
      findings,
      payloads: this.payloads.map((p) => ({ ...p, index: toInput(p.index) })),
      ...(content && { content }),
      removed: { counted, silent },
      ...(aborted && { aborted: true as const }),
    };
  }
}

/** Where the stream must have got to before a hidden mark can be mapped onto the view. */
const waitEnd = (m: RawMark) =>
  m.cls === 'markStack' && m.info ? Math.max(m.end, (m.info as StackInfo).end) : m.end;

/** Terminal findings: the source chunks holding a counted layer mark, merged into the hidden findings they overlap. */
function mergeLayerFindings(
  text: string,
  layer: readonly RawMark[],
  findings: HiddenFinding[],
): void {
  const own: HiddenFinding[] = [];
  let k = 0;
  const ws = (i: number) => isWS(text.charCodeAt(i));
  const list = layer.filter((m) => m.counted && !m.internal);
  while (k < list.length) {
    let s = list[k]!.start;
    while (s > 0 && !ws(s - 1)) s--;
    let e = list[k]!.end;
    while (e < text.length && !ws(e)) e++;
    const removed: HiddenFinding['removed'] = {};
    for (; k < list.length && list[k]!.start < e; k++) {
      const q = list[k]!;
      removed[q.cls as HiddenClass] = (removed[q.cls as HiddenClass] ?? 0) + q.n;
      // A mark that runs past the chunk (a string with spaces) extends it.
      if (q.end > e) {
        e = q.end;
        while (e < text.length && !ws(e)) e++;
      }
    }
    own.push({ word: text.slice(s, e), index: s, removed });
  }
  if (own.length === 0) return;
  const extra: HiddenFinding[] = [];
  let f = 0;
  for (const o of own) {
    const end = o.index + o.word.length;
    while (f < findings.length && findings[f]!.index + findings[f]!.word.length <= o.index) f++;
    const hit = findings[f];
    if (hit && hit.index < end) {
      for (const [cls, n] of Object.entries(o.removed) as [HiddenClass, number][])
        hit.removed[cls] = (hit.removed[cls] ?? 0) + n;
    } else extra.push(o);
  }
  if (extra.length) {
    findings.push(...extra);
    findings.sort((x, y) => x.index - y.index);
  }
}

function terminalContentOf(text: string, layer: readonly RawMark[]): HiddenContent[] {
  const out: HiddenContent[] = [];
  for (const m of layer) {
    const kind =
      m.rule === 'stringSequence'
        ? 'terminal-string'
        : m.rule === 'terminalConcealed'
          ? 'terminal-concealed'
          : m.rule === 'backspace' || m.rule === 'backspaceFlood'
            ? 'terminal-erased'
            : null;
    // A string kept as text is two marks (opener, terminator): one entry, from the opener.
    if (!kind || (kind === 'terminal-string' && m.n === 0)) continue;
    const info = m.info as { unterminated?: boolean; bodyKept?: boolean; end?: number } | undefined;
    const body = m.extracted ?? '';
    const end = info?.end ?? m.end;
    out.push({
      kind,
      index: m.start,
      end,
      length: [...text.slice(m.start, end)].length,
      text: body,
      readable: VISIBLE_RE.test(body),
      removed: m.mode === 'cleanup' && !info?.bodyKept,
      ...(info?.unterminated && { unterminated: true }),
    });
  }
  return out;
}

// --- From the public stream ----------------------------------------------------------

const CLASS: Record<string, string> = {
  softHyphen: 'softHyphen',
  leadingBom: 'bom',
  isolatedZeroWidth: 'zeroWidth',
  wordBreakHint: 'zeroWidth',
  joinerInWord: 'zeroWidthInWord',
  possibleLigatureBreak: 'zeroWidthInWord',
  zeroWidthInWord: 'zeroWidthInWord',
  zeroWidthRun: 'zeroWidthRun',
  bidiOverrides: 'bidiOverride',
  bidiMarks: 'bidiMark',
  bidiMarksInRtlText: 'bidiMark',
  variationSelectors: 'variationSelector',
  tags: 'tag',
  blankFillers: 'blankFiller',
  otherInvisibles: 'otherInvisible',
  controlChars: 'controlChar',
  markStacks: 'markStack',
  markStacksOther: 'markStack',
  bidiOverrideSpan: 'bidiOverrideSpan',
  bidiReorderSpan: 'bidiOverrideSpan',
  invisibleRun: 'invisibleRun',
};
const isLayer = (kind: string) => kind === 'controlChars' || TERMINAL_CLASSES.has(kind);
const ESC = 0x1b;

/** The action a mark's rule had (the rules are the consumer's own). */
function actionOf(kind: string, rules: Readonly<CompatRules>): string {
  if (kind === 'bidiOverrideSpan')
    return rules.bidiOverrides === 'remove-with-content' ? 'remove-counted' : 'keep';
  if (kind === 'bidiReorderSpan' || kind === 'invisibleRun') return 'keep';
  if (TERMINAL_CLASSES.has(kind)) {
    const t = { ...TERMINAL_RULES, ...rules.terminal } as unknown as Record<string, string>;
    const a = t[kind]!;
    if (kind === 'bareCR') return a === 'keep' || a === 'report' ? 'keep' : 'remove-counted';
    return a;
  }
  return ((rules as unknown as Record<string, string>)[kind] ??
    (STRICT_HIDDEN_RULES as unknown as Record<string, string>)[kind])!;
}

/** Removed intervals of the control layer, from its cleanup marks. */
function layerIntervals(text: string, marks: readonly Mark[], rules: Readonly<CompatRules>) {
  const iv: { s: number; e: number }[] = [];
  for (const m of marks) {
    if (!isLayer(m.kind) || actionOf(m.kind, rules) === 'keep') continue;
    // VT, FF, NEL become a space: visible, not removed.
    const c = text.charCodeAt(m.start);
    if (m.kind === 'controlChars' && (c === 0x0b || c === 0x0c || c === 0x85)) continue;
    const s = m.start;
    const e = m.start + m.length;
    const p = iv[iv.length - 1];
    if (p && s < p.e) p.e = Math.max(p.e, e);
    else iv.push({ s, e });
  }
  return iv;
}

/** The internal mark of a public one: class, mode and counter from the rules, carriers from the source. */
function rawOf(
  m: Mark,
  text: string,
  rules: Readonly<CompatRules>,
  removedAt: (p: number) => number,
): RawMark {
  const action = actionOf(m.kind, rules);
  const start = m.start;
  const end = m.start + m.length;
  const layer = isLayer(m.kind);
  const r: RawMark = {
    rule: m.kind,
    cls: CLASS[m.kind] ?? m.kind,
    start,
    end,
    // A bare CR counts 1 when counted, 0 when silent: one CR either way.
    n: m.kind === 'bareCR' ? 1 : m.count,
    value: '',
    mode: action === 'keep' ? 'report' : 'cleanup',
    counted: m.kind === 'bareCR' ? m.count > 0 : action !== 'remove-silent',
    layer,
    extracted: m.extracted,
  };
  const carriers = (pred: (cp: number) => boolean, from = start) => {
    const cps: number[] = [];
    for (let p = from; p < end;) {
      const skip = removedAt(p);
      if (skip >= 0) {
        p = skip;
        continue;
      }
      const cp = text.codePointAt(p)!;
      if (pred(cp)) cps.push(cp);
      p += cpLen(cp);
    }
    return cps;
  };
  if (layer) {
    const c = text.charCodeAt(start);
    if (m.kind === 'controlChars' && (c === 0x0b || c === 0x0c || c === 0x85)) r.value = ' ';
    if (m.kind === 'otherSequence' && c === ESC && /^\u001b[DE]$/.test(text.slice(start, end)))
      r.value = '\n';
    if (m.kind === 'bareCR' && r.mode === 'cleanup') r.value = '\n';
    if (m.kind === 'stringSequence') {
      const t = text.slice(start, end);
      const terminated = /(?:\u0007|\u0018|\u001a|\u001b\\)$/.test(t);
      const whole = action !== 'remove-counted' && action !== 'remove-silent';
      if (whole) r.info = { unterminated: !terminated };
      else if (m.count > 0) {
        // The opener of a string kept as text: the body follows it.
        const bodyEnd = end + (m.extracted ?? '').length;
        const tail = text.slice(bodyEnd);
        const term = /^(?:\u0007|\u0018|\u001a|\u001b\\)/.exec(tail);
        r.info = {
          unterminated: !term,
          bodyKept: true,
          end: bodyEnd + (term ? term[0].length : 0),
        };
      }
    }
    return r;
  }
  if (m.kind === 'tags') r.cps = carriers(isTag);
  else if (
    m.kind === 'zeroWidthRun' ||
    CLASS[m.kind] === 'zeroWidthInWord' ||
    CLASS[m.kind] === 'zeroWidth' ||
    m.kind === 'leadingBom'
  )
    r.cps = carriers(isZW);
  else if (m.kind === 'invisibleRun') r.cps = carriers(isCarrier);
  else if (m.kind === 'variationSelectors') {
    // A valid first selector stays before the mark, unless it closed an RGI emoji (then it was never in the run).
    const prev = charBefore(text, start);
    let runStart = start;
    if (prev && isVS(prev.codePointAt(0)!)) {
      const base = charBefore(text, start - prev.length);
      if (!RGI.test(base + prev)) runStart = start - prev.length;
    }
    r.run = [runStart, end];
    r.cps = carriers(isVS, runStart);
  } else if (CLASS[m.kind] === 'markStack') r.info = stackInfo(m, text, removedAt);
  return r;
}

const STACK_CHAR_RE = /^[\p{M}\p{Cf}]/u;
const RGI = new RegExp('^\\p{RGI_Emoji}$', 'v');
const isHiddenMark = (cp: number) =>
  isVS(cp) ||
  cp === 0x034f ||
  cp === 0x17b4 ||
  cp === 0x17b5 ||
  cp === 0x110b1 ||
  cp === 0x1d159 ||
  isOtherInvisible(cp);

/** A stack's extent from the source: its base, the marks it keeps (`extracted` holds them), its last mark. */
function stackInfo(m: Mark, text: string, removedAt: (p: number) => number): StackInfo {
  const visibleBefore = (p: number): number => {
    // Start of the visible character before p, past removed control intervals.
    for (;;) {
      if (p <= 0) return -1;
      let q = p - 1;
      if (q > 0 && text.charCodeAt(q) >= 0xdc00 && text.charCodeAt(q) <= 0xdfff) q--;
      if (removedAt(q) >= 0) {
        while (q > 0 && removedAt(q - 1) >= 0) q--;
        p = q;
        continue;
      }
      return q;
    }
  };
  // Back to the start of the run, then the base before it.
  let runStart = m.start;
  for (
    let q = visibleBefore(runStart);
    q >= 0 && STACK_CHAR_RE.test(charAt(text, q));
    q = visibleBefore(q)
  )
    runStart = q;
  const baseAt = visibleBefore(runStart);
  const base = baseAt >= 0 ? charAt(text, baseAt) : '';
  const keptMarks = [...(m.extracted ?? '')].length - [...base].length;
  let marks = 0;
  let keptEnd = runStart;
  let last = runStart;
  for (let p = runStart; p < text.length;) {
    const skip = removedAt(p);
    if (skip >= 0) {
      p = skip;
      continue;
    }
    const ch = charAt(text, p);
    if (!STACK_CHAR_RE.test(ch)) break;
    if (MARK_RE.test(ch) && !isHiddenMark(ch.codePointAt(0)!)) {
      marks++;
      last = p + ch.length;
      if (marks <= keptMarks) keptEnd = last;
    }
    p += ch.length;
  }
  const s0 = base === '' ? runStart : baseAt;
  return { start: s0, end: last, kept: keptEnd - s0, text: m.extracted ?? '' };
}

/**
 * main's `cleanHidden(text, rules)`, from `cleanHidden`'s callbacks: the
 * records give `cleaned` and `edits`, the report calls everything else.
 */
export function compatCleanHidden(
  text: string,
  rules: Readonly<CompatRules> = STRICT_HIDDEN_RULES,
): HiddenCleanup {
  const marks: Mark[] = [];
  const records: OutputRecord[] = [];
  cleanHidden(text, rules, {
    onReport: (m) => void marks.push(m),
    onRecord: (r) => void records.push(r),
  });
  return fromStream(text, rules, marks, records);
}

/** The rebuild itself: report marks and output records of one run under `rules`. */
export function fromStream(
  text: string,
  rules: Readonly<CompatRules>,
  marks: readonly Mark[],
  records: readonly OutputRecord[],
): HiddenCleanup {
  const iv = layerIntervals(text, marks, rules);
  const removedAt = (p: number) => {
    let lo = 0;
    let hi = iv.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (iv[mid]!.s <= p) lo = mid + 1;
      else hi = mid;
    }
    const x = iv[lo - 1];
    return x && p < x.e ? x.e : -1;
  };
  const rec = new HiddenRecorder(text, rules, wantsContent(rules));
  for (const r of records) {
    const orig = text.slice(r.start, r.start + r.length);
    rec.record({
      start: r.start,
      end: r.start + r.length,
      text: r.text,
      kind: r.text === orig ? 'keep' : 'rem',
    });
  }
  // The reported invisible runs and spans feed only `content`.
  const content = wantsContent(rules);
  let lastStack = -1;
  for (const m of marks) {
    if (!content && (m.kind === 'invisibleRun' || m.kind === 'bidiReorderSpan')) continue;
    if (!content && m.kind === 'bidiOverrideSpan' && rules.bidiOverrides !== 'remove-with-content')
      continue;
    const raw = rawOf(m, text, rules, removedAt);
    if (raw.cls === 'markStack') {
      // One content entry per stack: the ranges of one stack share its start.
      const at = (raw.info as StackInfo).start;
      if (at === lastStack) raw.info = undefined;
      lastStack = at;
    }
    rec.mark(raw);
  }
  return rec.result(false);
}

/** main's `analyze` result: upstream's fields plus `counts.hiddenWords` and `hidden`. */
export type CompatAnalysis = Omit<AnalysisResult, 'counts'> & {
  counts: AnalysisResult['counts'] & { hiddenWords: number };
  hidden?: HiddenReport;
};

/** Strict `analyze`'s rules for the hidden-character pass. */
const analyzeRules = (
  o: AnalyzeOptions & { hiddenCharRules?: Partial<CompatRules> },
): CompatRules => ({
  ...STRICT_HIDDEN_RULES,
  controlChars: 'keep',
  markStacksOther: 'keep',
  ...o.hiddenCharRules,
});

/** main's `analyze`: the library's result, plus `hidden` and `counts.hiddenWords` rebuilt from the stream. */
export function compatAnalyze(
  text: string,
  options: Omit<AnalyzeOptions, 'hiddenCharRules'> & {
    hiddenCharRules?: Partial<CompatRules>;
  } = {},
): CompatAnalysis {
  const r = analyze(text, options as AnalyzeOptions);
  if (options.hiddenChars !== 'strict')
    return { ...r, counts: { ...r.counts, hiddenWords: 0 } } as never;
  const h = compatCleanHidden(text, analyzeRules(options));
  if (h.content) {
    // A stack trimmed in the pass is zalgo, as one left to the token scan.
    const zalgo = r.words.filter((w) => w.signals.includes('zalgo'));
    for (const c of h.content) {
      if (c.kind !== 'mark-stack' || c.removed) continue;
      c.removed = zalgo.some((w) => w.index <= c.index && c.index < w.index + w.word.length);
    }
  }
  const { counts, ...rest } = r;
  return {
    ...rest,
    counts: { ...counts, hiddenWords: h.findings.length },
    hidden: {
      findings: h.findings,
      payloads: h.payloads,
      ...(h.content && { content: h.content }),
      removed: h.removed,
    },
  } as never;
}
