/**
 * The generated twin table (src/data/confusion.generated.ts) against the
 * design: sizes of §3.4, the Latin/Cyrillic/Greek tables of §5 (parsed from
 * docs/confusion-model.md), and the overrides — each must still change the
 * raw UTS #39 derivation, so a Unicode refresh that makes one redundant fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { skeleton } from '../src';
import {
  ALPHABET_LETTERS_PACKED,
  CONDITIONAL_TWIN_DATA,
  CONFUSION_ALPHABETS,
  DEFAULT_CONDITIONAL_TWIN_IDS,
  TWIN_PAIRS_PACKED,
} from '../src/data/confusion.generated';

const root = join(__dirname, '..');
const overrides = JSON.parse(
  readFileSync(join(root, 'scripts', 'confusion-overrides.json'), 'utf8'),
) as {
  add: [string, string, string][];
  remove: [string, string][];
  conditionalTwins: Record<string, { pairs: [string, string][] }>;
};
const ch = (h: string) => String.fromCodePoint(parseInt(h, 16));
const letters = Object.fromEntries(
  CONFUSION_ALPHABETS.map((a) => [a, ALPHABET_LETTERS_PACKED[a].split(',').map(ch)]),
) as Record<(typeof CONFUSION_ALPHABETS)[number], string[]>;
const alphabetOf = new Map<string, string>();
for (const a of CONFUSION_ALPHABETS) for (const c of letters[a]) alphabetOf.set(c, a);
const basePairs = TWIN_PAIRS_PACKED.split(';').map((e) => {
  const [a, b] = e.slice(0, -1).split('.');
  return { a: ch(a!), b: ch(b!), tag: e.at(-1)! };
});
const conditionalPairs = DEFAULT_CONDITIONAL_TWIN_IDS.flatMap((id) =>
  CONDITIONAL_TWIN_DATA[id]!.pairs.map(([a, b]) => ({
    a: String.fromCodePoint(a),
    b: String.fromCodePoint(b),
    tag: 'conditional',
  })),
);
const defaultPairs = [...basePairs, ...conditionalPairs];

describe('confusion table sizes (§3.4)', () => {
  it('has 650 letters in 7 alphabets', () => {
    expect(Object.fromEntries(CONFUSION_ALPHABETS.map((a) => [a, letters[a].length]))).toEqual({
      Latin: 52,
      Cyrillic: 103,
      Greek: 51,
      Armenian: 76,
      Cherokee: 172,
      Coptic: 114,
      LatinExtra: 82,
    });
    expect(alphabetOf.size).toBe(650);
  });

  it('has 643 pairs with the default conditional set, 107 of them Latin/Cyrillic/Greek', () => {
    expect(defaultPairs.length).toBe(643);
    const lcg = new Set(['Latin', 'Cyrillic', 'Greek']);
    expect(
      defaultPairs.filter((p) => lcg.has(alphabetOf.get(p.a)!) && lcg.has(alphabetOf.get(p.b)!))
        .length,
    ).toBe(107);
    for (const p of defaultPairs) expect(alphabetOf.get(p.a)).not.toBe(alphabetOf.get(p.b));
  });
});

describe('overrides still change the raw derivation', () => {
  it('curated additions are not UTS #39 pairs', () => {
    for (const [a, b] of overrides.add) expect(skeleton(a), `${a}/${b}`).not.toBe(skeleton(b));
  });
  it('removals are UTS #39 pairs', () => {
    for (const [a, b] of overrides.remove) expect(skeleton(a)).toBe(skeleton(b));
  });
  it('conditional pairs are not UTS #39 pairs', () => {
    for (const [id, d] of Object.entries(overrides.conditionalTwins))
      for (const [a, b] of d.pairs) expect(skeleton(a), id).not.toBe(skeleton(b));
  });
  it('curated pairs in the table are exactly the additions and the non-derived small capitals', () => {
    const curated = basePairs.filter((p) => p.tag === 'c');
    for (const p of curated) expect(skeleton(p.a), `${p.a}/${p.b}`).not.toBe(skeleton(p.b));
    for (const p of basePairs.filter((q) => q.tag !== 'c'))
      expect(skeleton(p.a)).toBe(skeleton(p.b));
    expect(curated.length).toBe(1 + 15); // ω~w + 15 small capitals (UTS #39 already pairs the rest)
  });
});

/** Rows of the §5.1–5.3 tables: letter → alphabet → twins (markers stripped). */
function docTables(): Map<string, Map<string, Set<string>>> {
  const doc = readFileSync(join(root, 'docs', 'confusion-model.md'), 'utf8');
  const out = new Map<string, Map<string, Set<string>>>();
  const sections = doc.split(/^### 5\.\d /m).slice(1, 4);
  for (const sec of sections) {
    const lines = sec
      .split('\n')
      .filter((l) => l.startsWith('| ') && !l.startsWith('| letter') && !l.startsWith('| -'));
    const header = sec
      .split('\n')
      .find((l) => l.startsWith('| letter'))!
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const line of lines) {
      const cells = line.split('|').map((s) => s.trim());
      cells.shift();
      const letter = [...cells[0]!][0]!;
      const per = new Map<string, Set<string>>();
      const strip = (s: string) =>
        s
          .replace(/[*†‡§]/g, '')
          .split(/\s+/)
          .filter((x) => x && x !== '—');
      per.set(header[1]!, new Set(strip(cells[1]!)));
      per.set(header[2]!, new Set(strip(cells[2]!)));
      for (const part of (cells[3] ?? '').split(';').filter((s) => s.includes(':'))) {
        const [a, list] = part.split(':');
        per.set(a!.trim(), new Set(strip(list!)));
      }
      out.set(letter, per);
    }
  }
  return out;
}

describe('§5 tables match the generated data', () => {
  it('every listed letter has exactly the documented twins', () => {
    const twins = new Map<string, Map<string, Set<string>>>();
    const put = (x: string, y: string) => {
      const A = alphabetOf.get(y)!;
      if (!twins.has(x)) twins.set(x, new Map());
      if (!twins.get(x)!.has(A)) twins.get(x)!.set(A, new Set());
      twins.get(x)!.get(A)!.add(y);
    };
    for (const p of defaultPairs) {
      put(p.a, p.b);
      put(p.b, p.a);
    }
    const doc = docTables();
    expect(doc.size).toBe(52 + 87 + 51);
    for (const [letter, per] of doc)
      for (const A of CONFUSION_ALPHABETS) {
        if (A === alphabetOf.get(letter)) continue;
        const want = [...(per.get(A) ?? [])].sort();
        const got = [...(twins.get(letter)?.get(A) ?? [])].sort();
        expect(got, `${letter} → ${A}`).toEqual(want);
      }
  });
});
