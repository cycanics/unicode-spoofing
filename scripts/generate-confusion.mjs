#!/usr/bin/env node
/**
 * Regenerates src/data/confusion.generated.ts — the per-alphabet twin table of
 * docs/confusion-model.md §3 — from the checked-in UTS #39 data
 * (src/data/confusables.generated.ts) plus the curated overrides in
 * scripts/confusion-overrides.json.
 *
 *   node scripts/generate-confusion.mjs
 *
 * Two letters of different alphabets are twins when their single-letter UTS #39
 * skeletons are equal. Curated additions, the small-capital donors and the
 * conditional pairs come from the overrides file, so a Unicode refresh
 * (scripts/generate-confusables.mjs) re-derives without losing them.
 * Conditional pairs are emitted separately, tagged with their id; the
 * resolver enables them per id at model construction.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '..', 'src', 'data', 'confusables.generated.ts'), 'utf8');
const overrides = JSON.parse(readFileSync(join(__dirname, 'confusion-overrides.json'), 'utf8'));
const version = src.match(/UNICODE_VERSION = '([^']+)'/)[1];
const packed = [...src.matchAll(/'([^']*)'/g)]
  .map((m) => m[1])
  .filter((s) => s.includes('>'))
  .join('');
const MAP = new Map();
for (const e of packed.split(';')) {
  const [f, t] = e.split('>');
  MAP.set(
    parseInt(f, 16),
    t
      .split(' ')
      .map((h) => String.fromCodePoint(parseInt(h, 16)))
      .join(''),
  );
}
const skeleton = (s) =>
  [...s.normalize('NFD')]
    .map((c) => MAP.get(c.codePointAt(0)) ?? c)
    .join('')
    .normalize('NFD');

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => String.fromCodePoint(a + i));
const cps = (...list) => list.map((c) => String.fromCodePoint(c));
/** Letters of each model alphabet, in fold-preference order (§3.1, §3.4). */
const ALPHABETS = {
  Latin: [...range(0x41, 0x5a), ...range(0x61, 0x7a)],
  Cyrillic: [
    ...range(0x400, 0x45f),
    ...cps(0x490, 0x491, 0x4c0, 0x4cf, 0x4ae, 0x4af, 0x4ba, 0x4bb, 0x4d8, 0x4d9, 0x4e8, 0x4e9),
    ...cps(0x501, 0x50c, 0x50d, 0x51a, 0x51b, 0x51c, 0x51d),
    ...cps(0x4b2, 0x4b3), // Ҳ ҳ Tajik/Uzbek (descender twin of X, §3.3)
    ...cps(0x4aa, 0x4ab), // Ҫ ҫ Chuvash/Bashkir (conditional twin of C)
  ],
  Greek: [...range(0x391, 0x3a9), ...range(0x3b1, 0x3c9), 'ϳ', 'Ϳ'],
  Armenian: [...range(0x531, 0x556), ...range(0x561, 0x586)],
  Cherokee: [...range(0x13a0, 0x13f5), ...range(0x13f8, 0x13fd), ...range(0xab70, 0xabbf)],
  Coptic: [...range(0x2c80, 0x2ce3), ...range(0x3e2, 0x3ef)],
  LatinExtra: [...range(0xc0, 0x24f), ...range(0x250, 0x2af), ...range(0x1d00, 0x1d2b), 'ꜰ', 'ꜱ'],
};
const SCRIPT_OF_ALPHABET = { LatinExtra: 'Latin' };
const SMALL_CAPITALS = new Map([...overrides.smallCapitals.pairs.match(/../gu)].map((p) => [...p]));
for (const [name, letters] of Object.entries(ALPHABETS)) {
  const sc = SCRIPT_OF_ALPHABET[name] ?? name;
  const re = new RegExp(`^[\\p{L}--\\P{Script=${sc}}]$`, 'v');
  ALPHABETS[name] = letters.filter((c) => re.test(c) && c.normalize('NFD') === c);
}
{
  const latin = new Set(ALPHABETS.Latin);
  const others = new Map();
  for (const [name, letters] of Object.entries(ALPHABETS))
    if (name !== 'LatinExtra') for (const c of letters) others.set(skeleton(c), name);
  ALPHABETS.LatinExtra = ALPHABETS.LatinExtra.filter(
    (c) => !latin.has(c) && (others.has(skeleton(c)) || SMALL_CAPITALS.has(c)),
  );
}
const NAMES = Object.keys(ALPHABETS);
const alphabetOf = new Map();
for (const [name, letters] of Object.entries(ALPHABETS))
  for (const c of letters) alphabetOf.set(c, name);
const isUpper = (c) => c !== c.toLowerCase();

// pairs: key "a|b" (a < b) → tag: u = UTS #39 same case, x = UTS #39 cross-case, c = curated.
const pairs = new Map();
const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const bySkel = new Map();
for (const c of alphabetOf.keys()) {
  const k = skeleton(c);
  if (!bySkel.has(k)) bySkel.set(k, []);
  bySkel.get(k).push(c);
}
for (const [, group] of bySkel)
  for (const a of group)
    for (const b of group)
      if (a < b && alphabetOf.get(a) !== alphabetOf.get(b))
        pairs.set(key(a, b), isUpper(a) !== isUpper(b) ? 'x' : 'u');
const fail = (m) => {
  throw new Error(m);
};
for (const [a, b] of overrides.remove)
  if (!pairs.delete(key(a, b))) fail(`remove ${a}/${b}: not derived`);
for (const [a, b] of overrides.add) {
  if (!alphabetOf.has(a) || !alphabetOf.has(b)) fail(`add ${a}/${b}: not a model letter`);
  if (pairs.has(key(a, b))) fail(`add ${a}/${b}: already derived`);
  pairs.set(key(a, b), 'c');
}
for (const [a, b] of SMALL_CAPITALS)
  if (alphabetOf.has(a) && !pairs.has(key(a, b))) pairs.set(key(a, b), 'c');
const conditional = {};
for (const [id, def] of Object.entries(overrides.conditionalTwins)) {
  for (const [a, b] of def.pairs) {
    if (!alphabetOf.has(a) || !alphabetOf.has(b))
      fail(`conditional ${id}: ${a}/${b} not model letters`);
    if (pairs.has(key(a, b))) fail(`conditional ${id}: ${a}/${b} already a twin`);
  }
  conditional[id] = {
    kind: def.kind,
    pairs: def.pairs.map(([a, b]) => [a.codePointAt(0), b.codePointAt(0)]),
    intraLatin: (def.intraLatin ?? []).map(([a, b]) => [a.codePointAt(0), b.codePointAt(0)]),
  };
}

const hex = (c) => c.codePointAt(0).toString(16);
const letterLines = NAMES.map((n) => `  ${n}: '${ALPHABETS[n].map(hex).join(',')}',`);
const pairList = [...pairs]
  .sort(([a], [b]) => (a < b ? -1 : 1))
  .map(([k, t]) => {
    const [a, b] = k.split('|');
    return `${hex(a)}.${hex(b)}${t}`;
  });
const chunks = [];
for (let i = 0; i < pairList.length; i += 150)
  chunks.push(pairList.slice(i, i + 150).join(';') + (i + 150 < pairList.length ? ';' : ''));
const out = `// AUTO-GENERATED by scripts/generate-confusion.mjs — DO NOT EDIT.
// Source: UTS #39 ${version} skeletons (confusables.generated.ts) + scripts/confusion-overrides.json
// Letters: ${alphabetOf.size}; twin pairs: ${pairs.size} (+ conditional, enabled per id)

/** Model alphabets, in tie-break order (docs/confusion-model.md §3.4). */
export const CONFUSION_ALPHABETS = ${JSON.stringify(NAMES)} as const;

/** Letters per alphabet as hex code points, in fold-preference order. */
export const ALPHABET_LETTERS_PACKED: Record<(typeof CONFUSION_ALPHABETS)[number], string> = {
${letterLines.join('\n')}
};

/**
 * Twin pairs "a.bT;…" (hex code points, a < b). T: u = UTS #39 same case,
 * x = UTS #39 cross-case (counts only as an allowed directional fold),
 * c = curated (overrides, small capitals).
 */
export const TWIN_PAIRS_PACKED =
${chunks.map((c) => `  '${c}'`).join(' +\n')};

/** Conditional twins (§3.3), off unless their id is enabled. */
export const CONDITIONAL_TWIN_DATA: Record<
  string,
  { kind: 'descender' | 'italic' | 'shape'; pairs: [number, number][]; intraLatin: [number, number][] }
> = ${JSON.stringify(conditional)};

/** Default conditional set (owner, final). */
export const DEFAULT_CONDITIONAL_TWIN_IDS: readonly string[] = ${JSON.stringify(overrides.defaultConditionalTwins)};
`;
const outPath = join(__dirname, '..', 'src', 'data', 'confusion.generated.ts');
writeFileSync(outPath, out);
console.log(
  `Wrote ${alphabetOf.size} letters, ${pairs.size} pairs, ${Object.keys(conditional).length} conditional ids to ${outPath}`,
);
