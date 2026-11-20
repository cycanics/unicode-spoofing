/**
 * The examples of README.md, docs/guide.md and docs/confusion-model.md, executed. The
 * examples are data (scripts/doc-examples-lib.mjs): `node scripts/doc-examples.mjs --write`
 * writes their tables into the documents, and this test fails when a document and the
 * library differ, so a documented output cannot drift from the library.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import * as library from '../src';
import {
  SECTIONS,
  blockIds,
  code,
  extras,
  fill,
  show,
  table,
  type ExampleSection,
} from '../scripts/doc-examples-lib.mjs';

const analyze = library.analyze as never;
const read = (file: string) => readFileSync(join(__dirname, '..', file), 'utf8');

/** A table row without the padding prettier adds, so written and computed rows compare. */
const unpad = (text: string) =>
  text
    .split('\n')
    .map((line) =>
      line.startsWith('|')
        ? line
            .split(/(?<!\\)\|/)
            .map((cell) => cell.trim().replace(/^-+$/, '---'))
            .join('|')
        : line,
    )
    .join('\n');

const section = (id: string): ExampleSection => {
  const found = SECTIONS.find((s) => s.id === id);
  if (!found) throw new Error(`no example section "${id}"`);
  return found;
};

/** Each case of a section as the strings its table shows: input, output. */
const rows = (id: string) =>
  table(section(id), analyze)
    .split('\n')
    .slice(2)
    .map((line) => line.split(/(?<!\\)\|/).map((cell) => cell.trim()))
    .map((cells) => ({ input: cells[1]!, output: cells[section(id).options ? 2 : 3]! }));

const values = new Map(extras(library));
const value = <T>(label: string): T => {
  if (!values.has(label)) throw new Error(`no example "${label}"`);
  return values.get(label) as T;
};
/** A value as a README comment writes it: single quotes, spaces after separators. */
const js = (v: unknown): string =>
  show(JSON.stringify(v))
    .replace(/"([A-Za-z]+)":/g, '$1: ')
    .replace(/"/g, "'")
    .replace(/,(?=\S)/g, ', ')
    .replace(/\{(?=\S)/g, '{ ')
    .replace(/(?<=\S)\}/g, ' }');

describe.each(['README.md', 'docs/guide.md', 'docs/confusion-model.md'])(
  '%s — example tables',
  (file) => {
    const text = read(file);
    it('has example blocks', () => {
      expect(blockIds(text).length).toBeGreaterThan(0);
    });
    it.each(blockIds(text))('block %s is what the library gives', (id) => {
      const written = new RegExp(`<!-- examples: ${id} -->\\n([\\s\\S]*?)<!-- /examples -->`).exec(
        text,
      )![1]!;
      expect(unpad(written).trim()).toBe(unpad(table(section(id), analyze)));
    });
    it('is what `doc-examples.mjs --write` would write', () => {
      expect(unpad(fill(text, analyze, file))).toBe(unpad(text));
    });
  },
);

describe('README.md', () => {
  const readme = read('README.md');

  /** The rows of the README's hand-written tables whose first cell is a name in backticks. */
  const tableRows = new Map<string, string[]>();
  for (const line of readme.split('\n')) {
    const cells = line.split(/(?<!\\)\|/).map((cell) => cell.trim());
    const name = /^`([A-Za-z_.]+)`$/.exec(cells[1] ?? '');
    if (name) tableRows.set(name[1]!, cells.slice(2, -1));
  }
  const cell = (row: string, column: number) => {
    if (!tableRows.has(row)) throw new Error(`README has no table row \`${row}\``);
    return tableRows.get(row)![column]!;
  };

  it('every `input` → `output` in the text is what the library gives', () => {
    const known = new Set(
      ['readme-inline', 'readme-signals', 'readme-signals-other', 'readme-modes'].flatMap((id) =>
        rows(id).map(({ input, output }) => `${input} → ${output}`),
      ),
    );
    const written = [...readme.matchAll(/`[^`|\n]+` → `[^`|\n]+`/g)].map((m) => m[0]);
    expect(written.length).toBeGreaterThan(5);
    for (const pair of written) expect(known, pair).toContain(pair);
  });

  it('the words it says stay as written do', () => {
    for (const { input, output } of rows('readme-inline')) {
      expect(readme, input).toContain(input.slice(1, -1));
      expect(readme, `${input} → ${output}`).toContain(output.slice(1, -1));
    }
    const stays = (text: string) =>
      library.analyze(text, { hiddenChars: 'strict', confusionModel: 'alphabet' }).normalized;
    for (const text of ['Мы были в НОТ', 'НОТ', 'сор', 'AT&amp;T', 'Applе'])
      expect(stays(text)).toBe(text);
  });

  it('the signal table: every signal, and whether it sets `spoofed`', () => {
    const categories = ['mixed_spoof', 'mixed_legitimate', 'mixed_non_legitimate'];
    const signals = [...library.SPOOF_SIGNALS, ...categories, 'whole_word_lookalike'];
    for (const signal of signals)
      expect(cell(signal, 1), signal).toBe(
        (library.SPOOFING_SIGNALS as readonly string[]).includes(signal) ? 'yes' : 'no',
      );
    // A signal of the examples sets `spoofed` exactly when the table says so.
    for (const id of ['readme-signals', 'readme-signals-other'])
      for (const line of table(section(id), analyze).split('\n').slice(2)) {
        const cells = line.split(/(?<!\\)\|/).map((c) => c.trim());
        const [spoofed, names] = cells.slice(-3, -1) as [string, string];
        const any = names.split(', ').some((n) => cell(n.slice(1, -1), 1) === 'yes');
        expect(spoofed, line).toBe(any ? 'yes' : 'no');
      }
  });

  it('the option tables: every option, with the default of the source', () => {
    const source = (file: string, name: string) =>
      new RegExp(`const ${name} = ([^;]+);`).exec(read(file))![1]!;
    const defaults: Record<string, string> = {
      hiddenChars: "`'lenient'`",
      confusionModel: "`'latin'`",
      targetLanguages: `\`${js(library.DEFAULT_TARGET_LANGUAGES)}\``,
      lookalikes: '`defaultLookalikes()`',
      conditionalTwins: [...library.DEFAULT_CONDITIONAL_TWINS].map((id) => `\`${id}\``).join(', '),
      donorAlphabets: 'every alphabet no requested language uses',
      expectedScripts: 'none',
      wholeScriptFold: "`'all'`",
      hostileInput: '`false`',
      affixSeparator: 'not set',
      oneLetterDashAffix: 'none',
      rtlAwareness: '`true`',
      ladder: `\`${source('src/resolve.ts', 'WORD_MAJORITY_MIN_LETTERS')}\`, \`${source('src/resolve.ts', 'WORD_MAJORITY_MIN_SHARE').replace(/ /g, '')}\``,
      majorityWindow: `\`${source('src/analyze.ts', 'DEFAULT_MAJORITY_WINDOW')}\``,
      contextBuffer: `\`${source('src/analyze.ts', 'DEFAULT_CONTEXT_BUFFER')}\``,
      breadth: "`'window'` (alphabet model), else `'all'`",
      neutralAlphabet: "on with `hiddenChars: 'strict'`",
      keepMathLetters: '`false`',
      mathTarget: '`false`',
      hiddenCharRules: '`STRICT_HIDDEN_RULES`',
      'hiddenCharRules.terminal': 'not set',
      'hiddenCharRules.invisibleMathOperators': 'not set',
      'hiddenCharRules.constructLimit': `\`${library.CONSTRUCT_LIMIT}\``,
      htmlNamedReferences: "`'lenient'`",
    };
    for (const [option, value] of Object.entries(defaults))
      expect(cell(option, 0), option).toBe(value);
    expect(library.STRICT_HIDDEN_RULES.terminal).toBeUndefined();
    expect(library.STRICT_HIDDEN_RULES.invisibleMathOperators).toBeUndefined();

    // A default the library applies itself: the call with the option left out equals the call
    // with the documented default, and differs from the call with another value.
    const full = { hiddenChars: 'strict', confusionModel: 'alphabet' } as const;
    const run = (text: string, options: library.AnalyzeOptions) => {
      const marks: string[] = [];
      const r = library.analyze(text, options, { onReport: (m) => void marks.push(m.kind) });
      return JSON.stringify([r, marks]);
    };
    const probes: [
      library.AnalyzeOptions,
      string,
      library.AnalyzeOptions,
      library.AnalyzeOptions,
    ][] = [
      [{}, 'Пpивет co\u00ADop', { hiddenChars: 'lenient' }, { hiddenChars: 'strict' }],
      [{}, 'Пpивет', { confusionModel: 'latin' }, { confusionModel: 'alphabet' }],
      [full, 'НОТ dog', { wholeScriptFold: 'all' }, { wholeScriptFold: 'off' }],
      [full, 'Applе', { hostileInput: false }, { hostileInput: true }],
      [full, 'שלום iPhoneахא', { rtlAwareness: true }, { rtlAwareness: false }],
      [full, 'ℎν', { keepMathLetters: false }, { keepMathLetters: true }],
      [full, 'cosβcosα', { mathTarget: false }, { mathTarget: true }],
      [full, 'x &copy text', { htmlNamedReferences: 'lenient' }, { htmlNamedReferences: 'strict' }],
      [full, 'pⓐypal', { neutralAlphabet: true }, { neutralAlphabet: false }],
      [
        { confusionModel: 'alphabet' },
        'pⓐypal',
        { neutralAlphabet: false },
        { neutralAlphabet: true },
      ],
      [full, 'Windowsах', {}, { affixSeparator: '-' }],
      [full, 'Р-aypal', { oneLetterDashAffix: [] }, { oneLetterDashAffix: ['Russian'] }],
      [full, 'НОТ dog', { expectedScripts: [] }, { expectedScripts: ['Cyrillic'] }],
      [
        full,
        'ϲ',
        { targetLanguages: library.DEFAULT_TARGET_LANGUAGES },
        { targetLanguages: ['Russian', 'English'] },
      ],
      [
        full,
        'χbox иser',
        { conditionalTwins: library.DEFAULT_CONDITIONAL_TWINS },
        { conditionalTwins: ['и~u'] },
      ],
      [
        full,
        'click the lınk now',
        { lookalikes: library.defaultLookalikes() },
        {
          lookalikes: library.buildLookalikes({ remove: { English: [['ı', 'i']] } }),
        },
      ],
    ];
    for (const [base, text, documented, other] of probes) {
      const label = `${text} ${JSON.stringify(other)}`;
      expect(run(text, { ...base, ...documented }), label).toBe(run(text, base));
      expect(run(text, { ...base, ...other }), label).not.toBe(run(text, base));
    }
  });

  it('quick start: the result of the first call', () => {
    const [text] = section('readme-quick-start').cases as [string];
    const r = library.analyze(text, section('readme-quick-start').options);
    expect(readme).toContain(`result.normalized; // '${r.normalized}'`);
    expect(readme).toContain(`result.spoofed; // ${String(r.spoofed)}`);
    expect([r.signals.mixed_spoof, r.signals.invisible]).toEqual([true, true]);
    expect(readme).toContain(
      `// [${r.words.map((w) => `'${show(w.word)} → ${w.normalized}'`).join(', ')}]`,
    );
  });

  it('quick start: the word callback', () => {
    const { words } = value<{ words: Record<string, unknown>[] }>('onWord');
    const { start, end, cleaned, replacement, reason } = words[0]!;
    expect(readme).toContain(
      `start: ${start}, end: ${end}, cleaned: '${cleaned}', replacement: '${replacement}'`,
    );
    expect(readme).toContain(`reason: ${js(reason)}`);
  });

  it('the result object', () => {
    const r = value<library.AnalysisResult>('result');
    expect(readme).toContain(`'${r.normalized}'`);
    expect(readme).toContain(`\`${js(r.counts)}\``);
    expect(readme).toContain(`\`'${r.dominantScript}'\``);
    const word = r.words.find((w) => w.resolution)!;
    for (const line of [
      `word: '${word.word}'`,
      `index: ${word.index}`,
      `signals: ${js(word.signals)}`,
      `scripts: ${js(word.scripts)}`,
      `skeleton: '${word.skeleton}'`,
      `normalized: '${word.normalized}'`,
      `language: '${word.resolution!.language}'`,
      `rule: '${word.resolution!.rule}'`,
      `context: ${js(word.resolution!.context)}`,
      `candidates: ${js(word.resolution!.candidates)}`,
    ])
      expect(readme, line).toContain(line);
    expect(library.skeleton('раураl')).toBe(library.skeleton('paypal'));
  });

  it('the limits it names', () => {
    expect([library.WORD_CAP, library.CONSTRUCT_LIMIT, library.STRING_LIMIT]).toEqual([
      250, 4096, 16_777_216,
    ]);
    expect(readme).toContain('250 characters, 4,096 and 16,777,216 code points');
    expect(readme).toContain(js(library.DEFAULT_TARGET_LANGUAGES));
    expect(readme).toContain(`Unicode\n${library.UNICODE_VERSION}`);
  });
});

describe('docs/guide.md — code examples', () => {
  const guide = read('docs/guide.md');
  const shown = (v: unknown) => `// ${js(v)}`;

  it('cleanHidden and its callbacks', () => {
    const c = value<{ cleaned: string; marks: { kind: string }[]; records: { text: string }[] }>(
      'cleanHidden',
    );
    expect(guide).toContain(`cleaned; ${shown(c.cleaned)}`);
    expect(guide).toContain(`marks; ${shown(c.marks.map((m) => m.kind))}`);
    expect(guide).toContain(`out.join(''); ${shown(c.records.map((r) => r.text).join(''))}`);
    expect(guide).toContain(`${shown(value('cleanHidden default rules'))} (the Cyrillic`);
    expect(guide).toContain(shown(value('cleanTerminal')));
  });

  it('the word callback and the early stop', () => {
    const w = value<{ normalized: string; words: Record<string, unknown>[]; listed: string[] }>(
      'onWord',
    );
    expect(guide).toContain(`r.normalized; ${shown(w.normalized)}`);
    for (const word of w.words) {
      expect(guide).toContain(`start: ${word.start}, end: ${word.end}, cleaned: '${word.cleaned}'`);
      expect(guide).toContain(`reason: ${js(word.reason)}`);
    }
    expect(guide).toContain(`r.words.map((w) => w.word); ${shown(w.listed)}`);
    expect(guide).toContain(
      `r.normalized; ${shown(value<{ normalized: string }>('abort').normalized)}`,
    );
  });

  it('limits', () => {
    const lost = value<{ normalized: string; lost: unknown[] }>('lost escape string');
    expect(guide).toContain(`r.normalized; // '${show(lost.normalized)}'`);
    expect(guide).toContain(`lost; ${shown(lost.lost)}`);
    expect(guide).toContain(`kinds; ${shown(value('long tag run'))}`);
    expect(value('word cap')).toMatchObject({ unchanged: true, spoofed: false });
    expect(value('word cap, default')).toEqual({ unchanged: false });
    expect(value('word cap, alphabet')).toEqual({ unchanged: true });
    expect(value('word cap, strict')).toEqual({ unchanged: true });
  });

  it('custom packs and errors', () => {
    const pack = value<{ with: string; without: string }>('custom pack');
    expect(guide).toContain(`analyze('${pack.without}', options).normalized; ${shown(pack.with)}`);
    expect(guide).toContain(shown(value<{ out: string }>('pair removed').out));
    expect(value('conditional twin')).toEqual({ off: 'иser', on: 'user', withLookalikes: 'иser' });
    expect(guide).toContain(
      "`analyze('иser', { hiddenChars: 'strict', confusionModel: 'alphabet', conditionalTwins: ['и~u'] })`\n  gives `user`",
    );
    expect(guide).toContain('`conditionalTwins` is ignored when `lookalikes` is given');
    const optional = value<{ off: string; on: string }>('optional pack');
    expect(optional.off).toBe('the 𐔓ame here');
    expect(guide).toContain(`\`${optional.off}\` becomes \`${optional.on}\``);
    expect(guide).toContain(`\`${value<string>('error, not a string')}\``);
    expect(guide).toContain(`\`${value<string>('error, rule value')}\``);
    expect(guide).toContain(`\`${value<string>('error, language')}\``);
    expect(value<string>('error, contextBuffer')).toMatch(/^RangeError: /);
  });

  it('recipes', () => {
    const recipe = (label: string) => value<{ input: string; normalized: string }>(label);
    for (const label of ['recipe, model', 'recipe, scan', 'recipe, languages'])
      expect(guide, label).toContain(`// '${show(recipe(label).normalized)}'`);
    expect(guide).toContain(`marks; ${shown(value<{ marks: string[] }>('recipe, scan').marks)}`);
    expect(code(recipe('recipe, model').input)).toBeTruthy();
  });
});
