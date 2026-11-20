/**
 * `analyze`: phase 1 (rules with modes over the source) feeding the word phase
 * (src/letters.ts), which reads phase 1's output only. Lenient: phase 1 runs
 * the findings between words — illegal code points, decode damage, invisible
 * runs outside words. Strict: the hidden-character rules too. Every mark,
 * region and word
 * streams through the callbacks.
 */

import { createConfusionModel } from './confusion';
import { TARGET_LANGUAGES } from './languages';
import { Phase1, type OutputRecord, type RawMark } from './core';
import { ReferenceText, ReferenceWriter } from './references';
import {
  CONSTRUCT_LIMIT,
  DetectCtx,
  encodingDamage,
  extractOf,
  lenientBetweenWords,
  READER,
} from './detectors';
import {
  readRules,
  hiddenDetectors,
  STRICT_HIDDEN_RULES,
  type HiddenCallbacks,
  type HiddenCharRules,
} from './hidden';
import { HiddenWords } from './hidden-words';
import { LetterPhase, type LetterFinding, type LetterOptions, type WordCallback } from './letters';
import { View } from './core';
import type { WordResolution } from './resolve';
import { emptySignals } from './token';
import {
  SPOOFING_SIGNALS,
  type AnalysisResult,
  type AnalyzeOptions,
  type SpoofSignal,
  type WordFinding,
} from './types';

export { FORMAT_CHAR_SCRIPTS, ZALGO_MARK_RUN, ZERO_WIDTH_INERT_RUN } from './token';

/** Callbacks of `analyze`: the cleanup callbacks and the word callback. */
export interface AnalyzeCallbacks extends HiddenCallbacks {
  /**
   * Every word the word phase converted or reported, and every word past the word
   * cap (decision 14): `(start, end, cleaned, replacement, reason)` — source
   * positions, the word as phase 1 output it, the library's output for it. A word
   * converted with no signal (a styled letter written as its letter) is called
   * too. With `hiddenChars: 'strict'` a word whose only finding is a hidden
   * character gets no word call: phase 1 reports it (`onReport`), and the result's
   * `words` lists it. A notification: its return is not used (decision 15). Word
   * calls lag behind the report and cleanup calls by the words the context ring
   * holds.
   */
  onWord?: WordCallback;
}

const DEFAULT_CONTEXT_BUFFER = 100;
const DEFAULT_MAJORITY_WINDOW = 10;

/** The findings between words (decision 3), as phase-1 rules, and their signals. */
const SIGNAL_OF = {
  illegal: 'illegal',
  encodingDamage: 'encoding_damage',
  invisibleOutsideWord: 'invisible',
} as const satisfies Partial<Record<keyof HiddenCharRules, SpoofSignal>>;

type AnalyzeRuleKey = keyof typeof SIGNAL_OF;

const signalOf = (rule: string): SpoofSignal | undefined =>
  rule in SIGNAL_OF ? SIGNAL_OF[rule as AnalyzeRuleKey] : undefined;

/** `analyze`'s own rules: the findings between words, and mojibake (decision 42). */
const ANALYZE_RULES: ReadonlySet<string> = new Set([...Object.keys(SIGNAL_OF), 'mojibake']);

function strictRules(overrides: Partial<HiddenCharRules> | undefined): HiddenCharRules {
  // Controls keep their own signal here (illegal); stacked marks are phase 1's
  // in strict analyze too (decision 28b).
  return {
    ...STRICT_HIDDEN_RULES,
    controlChars: 'keep',
    illegal: 'remove-counted',
    encodingDamage: 'keep',
    invisibleOutsideWord: 'ignored',
    // Decision 42: mojibake is reported, and its spans are non-breaking parts of words.
    mojibake: 'keep',
    // Decision 7b: the escape-sequence parser of decisions 6 and 7a runs by
    // default, so a control sequence goes whole; a backspace stays an `illegal`
    // character (7b names the sequences, not the erase); each removed sequence
    // is a finding (7b, 7c).
    terminal: {
      backspace: 'ignored',
      backspaceFlood: 'ignored',
      sgr: 'remove-counted',
      eraseAhead: 'remove-counted',
      otherSequence: 'remove-counted',
    },
    ...overrides,
  };
}

function lenientRules(
  overrides: Partial<HiddenCharRules> | undefined,
): Pick<HiddenCharRules, AnalyzeRuleKey | 'constructLimit'> {
  return {
    ...(overrides?.constructLimit !== undefined && { constructLimit: overrides.constructLimit }),
    illegal: overrides?.illegal ?? 'remove-counted',
    encodingDamage: overrides?.encodingDamage ?? 'keep',
    invisibleOutsideWord: overrides?.invisibleOutsideWord ?? 'remove-counted',
  };
}

/** Lenient phase 1: the findings between words, on the source (no control layer). */
function lenientDetectors(
  text: string,
  rules: Pick<HiddenCharRules, AnalyzeRuleKey | 'constructLimit'>,
  listen: boolean,
): Iterator<RawMark>[] {
  const view = new View(text, null);
  const ctx = new DetectCtx(
    text,
    view,
    { ...STRICT_HIDDEN_RULES, ...rules },
    {
      listen,
      layerFree: true,
      always: ANALYZE_RULES,
    },
  );
  view.register(READER.illegal);
  view.register(READER.damage);
  return [lenientBetweenWords(ctx), encodingDamage(ctx)];
}

function validate(options: AnalyzeOptions): { contextBuffer: number; majorityWindow: number } {
  const majorityWindow = options.majorityWindow ?? DEFAULT_MAJORITY_WINDOW;
  if (!Number.isInteger(majorityWindow) || majorityWindow < 0)
    throw new RangeError(
      `analyze: majorityWindow must be a non-negative integer (got ${majorityWindow})`,
    );
  const contextBuffer = options.contextBuffer ?? DEFAULT_CONTEXT_BUFFER;
  if (!Number.isInteger(contextBuffer) || contextBuffer < 2 * majorityWindow + 1)
    throw new RangeError(
      `analyze: contextBuffer (${contextBuffer}) must hold the word and ±majorityWindow (${majorityWindow}) words: at least ${2 * majorityWindow + 1}`,
    );
  if (options.breadth !== undefined && options.breadth !== 'window' && options.breadth !== 'all')
    throw new RangeError(
      `analyze: breadth must be 'window' or 'all' (got ${String(options.breadth)})`,
    );
  if (options.rtlAwareness !== undefined && typeof options.rtlAwareness !== 'boolean')
    throw new RangeError(
      `analyze: rtlAwareness must be a boolean (got ${String(options.rtlAwareness)})`,
    );
  if (options.affixSeparator !== undefined && typeof options.affixSeparator !== 'string')
    throw new RangeError(
      `analyze: affixSeparator must be a string (got ${String(options.affixSeparator)})`,
    );
  const cm: unknown = options.confusionModel;
  if (cm === 'alphabet' || cm === 'latin')
    throw new RangeError(
      `analyze: confusionModel '${cm}' was renamed '${cm === 'alphabet' ? 'language' : 'latin-fold'}'`,
    );
  if (cm !== undefined && cm !== 'latin-fold' && cm !== 'language')
    throw new RangeError(
      `analyze: confusionModel must be 'latin-fold' or 'language' (got ${String(cm)})`,
    );
  for (const old of ['expectedScripts', 'expectedLanguages'] as const)
    if ((options as Record<string, unknown>)[old] !== undefined)
      throw new RangeError(
        `analyze: ${old} was replaced by inputLanguages (the languages the input is written in, e.g. ['Russian'])`,
      );
  if (options.inputLanguages !== undefined) {
    if (!Array.isArray(options.inputLanguages))
      throw new RangeError('analyze: inputLanguages must be an array of target languages');
    for (const n of options.inputLanguages)
      if (!Object.prototype.hasOwnProperty.call(TARGET_LANGUAGES, n))
        throw new Error(`unknown target language ${String(n)}`);
  }
  // Decision 36c's setting, checked like `targetLanguages`.
  if (options.oneLetterDashAffix !== undefined) {
    if (!Array.isArray(options.oneLetterDashAffix))
      throw new RangeError('analyze: oneLetterDashAffix must be an array of target languages');
    for (const n of options.oneLetterDashAffix)
      if (!Object.prototype.hasOwnProperty.call(TARGET_LANGUAGES, n))
        throw new Error(`unknown target language ${String(n)}`);
  }
  if (
    options.htmlNamedReferences !== undefined &&
    options.htmlNamedReferences !== 'lenient' &&
    options.htmlNamedReferences !== 'strict'
  )
    throw new RangeError(
      `analyze: htmlNamedReferences must be 'lenient' or 'strict' (got ${String(options.htmlNamedReferences)})`,
    );
  return { contextBuffer, majorityWindow };
}

export function analyze(
  input: string,
  options: AnalyzeOptions = {},
  callbacks: AnalyzeCallbacks = {},
): AnalysisResult {
  return analyzeWith(input, options, callbacks, {});
}

/** Test only: the word phase's test switches ({@link LetterOptions.fastLane}, {@link LetterOptions.onTokenState}). */
export type LetterTestOptions = Pick<LetterOptions, 'fastLane' | 'onTokenState'>;

/** {@link analyze} with the word phase's test switches (not exported by the package). */
export function analyzeWith(
  input: string,
  options: AnalyzeOptions,
  callbacks: AnalyzeCallbacks,
  test: LetterTestOptions,
): AnalysisResult {
  if (typeof input !== 'string') throw new TypeError('analyze: text must be a string');
  const { contextBuffer, majorityWindow } = validate(options);
  // Decision 41o: strict, language model: the input is read with its HTML character references
  // decoded (every rule sees the raw character); positions and text map back to the input.
  const refs =
    options.hiddenChars === 'strict' && options.confusionModel === 'language'
      ? ReferenceText.of(input, options.htmlNamedReferences === 'strict')
      : null;
  const mapped = refs ? mapCallbacks(callbacks, refs) : null;
  if (mapped) callbacks = mapped.callbacks;
  const text = refs ? refs.text : input;
  if (options.hiddenCharRules)
    options = { ...options, hiddenCharRules: readRules(options.hiddenCharRules, 'analyze') };
  const strict = options.hiddenChars === 'strict';
  const model =
    options.confusionModel === 'language'
      ? createConfusionModel({
          ...(options.targetLanguages && { targetLanguages: options.targetLanguages }),
          ...(options.donorAlphabets && { donorAlphabets: options.donorAlphabets }),
          ...(options.conditionalTwins && { conditionalTwins: options.conditionalTwins }),
          ...(options.lookalikes && { lookalikes: options.lookalikes }),
        })
      : null;
  // The output: the first 1 024 pieces concatenated (a short text pays nothing
  // more), then pieces joined every 1 024, so they become garbage at once
  // instead of one cons-string holding every piece to the end.
  let outHead = '';
  let outN = 0;
  let outParts: string[] = [];
  const outChunks: string[] = [];
  const write = (t: string) => {
    if (++outN <= 1024) {
      outHead += t;
      return;
    }
    outParts.push(t);
    if (outParts.length >= 1024) {
      outChunks.push(outParts.join(''));
      outParts = [];
    }
  };
  const writer = refs ? new ReferenceWriter(refs, write) : null;
  const words: WordFinding[] = [];
  const between: WordFinding[] = [];
  const signals = emptySignals();
  let wordsTotal = 0;
  let confusableWords = 0;
  let mixedWords = 0;
  const lenient = strict ? null : lenientRules(options.hiddenCharRules);
  const letters = new LetterPhase({
    ...test,
    source: text,
    strict,
    model,
    inputLanguages: options.inputLanguages ?? [],
    wholeScriptFold: options.wholeScriptFold ?? 'all',
    contextBuffer,
    majorityWindow,
    // Decision 21: the language model reads the context window; otherwise the whole text.
    breadth: options.breadth ?? (model ? 'window' : 'all'),
    // Decision 30a: on by default in strict, optional otherwise.
    neutral: options.neutralAlphabet ?? strict,
    keepMath: options.keepMathLetters === true,
    affixSeparator: options.affixSeparator,
    oneLetterDashAffix: options.oneLetterDashAffix ?? [],
    hostileInput: options.hostileInput === true,
    rtlAwareness: options.rtlAwareness !== false,
    mathTarget: options.mathTarget === true,
    ...(options.ladder?.wordMajorityMinLetters !== undefined && {
      wordMajorityMinLetters: options.ladder.wordMajorityMinLetters,
    }),
    ...(options.ladder?.wordMajorityMinShare !== undefined && {
      wordMajorityMinShare: options.ladder.wordMajorityMinShare,
    }),
    // The default path (no strict, model or neutral option) judges every word; the cap comes with those options.
    wordCap: strict || model !== null || options.neutralAlphabet === true,
    onWord: callbacks.onWord,
    signal: callbacks.signal,
    out: writer ? (t) => writer.text(t) : write,
    ...(writer && {
      refs: {
        spans: refs!.spans(),
        range: (a: number, b: number) => writer.range(a, b),
        word: (t: string, a: number, b: number) => writer.word(t, a, b),
      },
    }),
    finding: (f) => {
      const w = findingOf(text, f, model !== null, strict);
      for (const s of w.signals) signals[s] = true;
      // Decision 36a: under the language model a mixed word is one with a category.
      if (model && w.signals.some((y) => y.startsWith('mixed_'))) mixedWords += 1;
      words.push(w);
    },
    counted: (hasLetter: boolean, resolved: WordResolution | null) => {
      if (hasLetter) wordsTotal += 1;
      if (resolved) {
        if (resolved.class !== 'mixed') confusableWords += 1;
        else if (!model) mixedWords += 1;
      }
    },
  });
  // Decode damage reads phase 1's output: two runs with only
  // removed characters between them are one finding. Text that stays (and
  // removals the word phase still tokenizes) is kept from the first run on.
  const damage: WordFinding[] = [];
  let removedTo = -1;
  const stays: number[] = [];
  const listen = callbacks.onReport !== undefined;
  const rules = strict ? strictRules(options.hiddenCharRules) : null;
  const recorder = rules
    ? new HiddenWords(text, rules.terminal !== undefined, rules.constructLimit ?? CONSTRUCT_LIMIT)
    : null;
  const found = rules
    ? hiddenDetectors(text, rules, {
        listen,
        always: ANALYZE_RULES,
        lostBounds: callbacks.onLostBound !== undefined,
      })
    : lenientDetectors(text, lenient!, listen);
  const detectors = [
    ...(refs && listen ? [referenceMarks(refs)] : []),
    // Decision 42d (language model): VT and FF are written as a line feed.
    ...(model ? found.map((g) => lineBreaks(g, text)) : found),
  ];
  const p1 = new Phase1(text, detectors, {
    callbacks: {
      onReport: callbacks.onReport,
      onCleanup: callbacks.onCleanup,
      onRecord: callbacks.onRecord,
      onLostBound: callbacks.onLostBound,
      signal: callbacks.signal,
    },
    sink: {
      mark(m) {
        if (m.rule === 'mojibake') {
          letters.mojibake(m.start, m.end, m.extracted ?? '');
          return;
        }
        if (m.rule === 'htmlReference') return; // a report only (41o)
        // the findings between words, from their phase-1 rules
        const signal = m.split || m.rule === 'encodingDamage' ? signalOf(m.rule) : undefined;
        if (!signal && m.mode === 'cleanup' && m.end > removedTo) removedTo = m.end;
        // A finding inside another rule's removal (a span removed with its content) is gone with it.
        if (signal && m.start < removedTo) return;
        if (signal) {
          signals[signal] = true;
          const w: WordFinding = {
            word: text.slice(m.start, m.end),
            index: m.start,
            signals: [signal],
            scripts: [],
          };
          between.push(w);
          if (m.rule === 'encodingDamage') damage.push(w);
          return;
        }
        recorder?.mark(m);
      },
    },
    seams: rules ? (rules.seamSpaces ?? true) : false,
    extract: extractOf,
    keepText: false,
    out: (s, e, t, k) => {
      if (damage.length && k !== 'rem' && k !== 'seam' && e > s) stays.push(s, e);
      recorder?.record(s, e, t, k);
      letters.record(s, e, t, k);
    },
  });
  p1.run();
  mapped?.flush();
  if (!p1.aborted) letters.finish();
  const joined = damage.length > 1 ? joinDamage(text, damage, stays) : null;
  // Words and the findings between them, in input order (a word first at one index).
  let all = mergeByIndex(words, joined ? between.filter((w) => !joined.has(w)) : between);
  if (recorder) {
    const hiddenWords = recorder.result();
    for (const w of hiddenWords) signals[w.signals[0]!] = true;
    all = mergeByIndex(all, hiddenWords);
  }
  writer?.done();
  outChunks.push(outParts.join(''));
  const normalized = outHead + outChunks.join('');
  if (refs) for (const w of all) mapFinding(w, refs);
  return {
    spoofed: SPOOFING_SIGNALS.some((s) => signals[s]),
    signals,
    words: all,
    counts: { wordsTotal, wordsAffected: all.length, confusableWords, mixedWords },
    normalized,
    changed: normalized !== input,
    dominantScript: letters.wholeDominant(),
  };
}

/** Decision 41o: each reference reported (`extracted`: as written), at its decoded span. */
/**
 * Decision 42d (language model): a VT or FF the `illegal` rule removes is written as a line
 * feed (the reader sees a line break), not removed; it is still reported.
 */
function* lineBreaks(marks: Iterator<RawMark>, text: string): Generator<RawMark> {
  for (let r = marks.next(); !r.done; r = marks.next()) {
    const m = r.value;
    if (m.rule === 'illegal' && m.end - m.start === 1) {
      const u = text.charCodeAt(m.start);
      if (u === 0x0b || u === 0x0c) m.value = '\n';
    }
    yield m;
  }
}

function* referenceMarks(refs: ReferenceText): Generator<RawMark> {
  for (let k = 0; k < refs.ds.length; k++)
    yield {
      rule: 'htmlReference',
      cls: 'htmlReference',
      start: refs.ds[k]!,
      end: refs.de[k]!,
      n: 1,
      value: '',
      mode: 'report',
      counted: false,
      extracted: refs.text.slice(refs.ds[k]!, refs.de[k]!),
    };
}

/** A text the decoded run reports for `text[a, b)`, as written in the input. */
const written = (refs: ReferenceText, t: string | null, a: number, b: number) =>
  t !== null && t === refs.text.slice(a, b) ? refs.slice(a, b) : t;

/**
 * Decision 9 with references: each record's text as written, so the records join to the
 * output. One writer reads every record ({@link ReferenceWriter}): a record holding a
 * reference without `;` that what follows may still change waits; the rest go out in order.
 */
function recordsWritten(
  refs: ReferenceText,
  span: (start: number, length: number) => { start: number; length: number },
  onRecord: (r: OutputRecord) => void,
): { take: (r: OutputRecord) => void; flush: () => void } {
  /** The records not sent yet, each written into as the writer goes (built once, handed over). */
  const queue: { start: number; length: number; text: string }[] = [];
  /** The index of `queue[0]` among every record taken. */
  let base = 0;
  const w = new ReferenceWriter(refs, (t, tag) => void (queue[tag - base]!.text += t));
  const send = (upTo: number) => {
    for (; base < upTo; base++) onRecord(queue.shift()!);
  };
  return {
    take: (r) => {
      const { start, length } = span(r.start, r.length);
      queue.push({ start, length, text: '' });
      w.tag = base + queue.length - 1;
      w.word(r.text, r.start, r.start + r.length);
      const held = w.waiting();
      send(held >= 0 ? held : base + queue.length);
    },
    flush: () => {
      w.done();
      send(base + queue.length);
    },
  };
}

/**
 * The callbacks with decoded positions and text mapped back to the input (decision 41o), and
 * what writes the records still held at the end.
 */
function mapCallbacks(
  cb: AnalyzeCallbacks,
  refs: ReferenceText,
): { callbacks: AnalyzeCallbacks; flush: () => void } {
  const { onReport, onCleanup, onRecord, onWord, onLostBound } = cb;
  const span = (start: number, length: number) => {
    const s = refs.start(start);
    return { start: s, length: refs.end(start + length) - s };
  };
  const records = onRecord ? recordsWritten(refs, span, onRecord) : null;
  const callbacks: AnalyzeCallbacks = {
    signal: cb.signal,
    ...(onLostBound && {
      onLostBound: (b) => onLostBound(Object.freeze({ kind: b.kind, ...span(b.start, b.length) })),
    }),
    ...(onReport && {
      onReport: (m) =>
        onReport({
          ...m,
          ...span(m.start, m.length),
          extracted: written(refs, m.extracted, m.start, m.start + m.length),
        }),
    }),
    ...(onCleanup && {
      onCleanup: (r, cleanup) => {
        const p = span(r.start, r.length);
        return onCleanup(
          { ...p, original: refs.input.slice(p.start, p.start + p.length) },
          cleanup,
        );
      },
    }),
    ...(records && { onRecord: records.take }),
    ...(onWord && {
      onWord: (start, end, cleaned, replacement, reason) =>
        onWord(
          refs.start(start),
          refs.end(end),
          refs.encode(cleaned, start, end),
          refs.encode(replacement, start, end),
          reason,
        ),
    }),
  };
  return { callbacks, flush: records ? records.flush : () => {} };
}

/** A finding at decoded positions, mapped back to the input (decision 41o). */
function mapFinding(w: WordFinding, refs: ReferenceText): void {
  const a = w.index;
  const b = a + w.word.length;
  if (w.normalized !== undefined) w.normalized = refs.encode(w.normalized, a, b);
  w.index = refs.start(a);
  w.word = refs.slice(a, b);
}

/** Damage findings with only removed text between them become one; the set of the ones taken in. */
function joinDamage(input: string, damage: WordFinding[], stays: number[]): Set<WordFinding> {
  const gone = new Set<WordFinding>();
  let q = 0;
  let a = damage[0]!;
  for (let k = 1; k < damage.length; k++) {
    const b = damage[k]!;
    const from = a.index + a.word.length;
    while (q < stays.length && stays[q + 1]! <= from) q += 2;
    if (q < stays.length && stays[q]! < b.index) a = b;
    else {
      a.word = input.slice(a.index, b.index + b.word.length);
      gone.add(b);
    }
  }
  return gone;
}

/** Two lists in input order, merged (the first list's entry first at one index). */
function mergeByIndex(a: WordFinding[], b: WordFinding[]): WordFinding[] {
  if (!b.length) return a;
  if (!a.length) return b;
  const out: WordFinding[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length)
    out.push(j >= b.length || (i < a.length && a[i]!.index <= b[j]!.index) ? a[i++]! : b[j++]!);
  return out;
}

function findingOf(input: string, f: LetterFinding, model: boolean, strict: boolean): WordFinding {
  const word = input.slice(f.start, f.end);
  if (f.kind === 'styled')
    return {
      word,
      index: f.start,
      signals: ['confusable_word'],
      scripts: [],
      skeleton: f.replacement,
    };
  const r = f.result;
  return {
    word,
    index: f.start,
    signals: r.signals,
    scripts: r.scripts,
    ...(r.skeleton !== undefined && { skeleton: r.skeleton }),
    ...((model || strict) && { normalized: f.replacement }),
    ...(f.resolved && { resolution: resolutionOf(f.resolved) }),
  };
}

function resolutionOf(r: WordResolution): NonNullable<WordFinding['resolution']> {
  return {
    class: r.class,
    language: r.language,
    rule: r.rule,
    folded: r.folded,
    context: r.context,
    candidates: r.candidates,
    rejected: r.rejected,
    ...(r.evidence && { evidence: r.evidence }),
  };
}
