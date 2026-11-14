#!/usr/bin/env node
/**
 * PROTOTYPE — derives the per-alphabet confusion table from the checked-in
 * UTS #39 data (src/data/confusables.generated.ts), then applies curated
 * overrides. See docs/confusion-model.md.
 *
 * Usage:
 *   node scripts/derive-confusion-table.mjs              # markdown report
 *   node scripts/derive-confusion-table.mjs --json       # table as JSON
 *   node scripts/derive-confusion-table.mjs --raw        # UTS #39 only, no overrides
 *
 * Two letters x (alphabet A) and y (alphabet B, A != B) are twins when their
 * single-letter UTS #39 skeletons are equal. Twins are case-specific: "В" and
 * "в" are separate entries and are judged separately.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '..', 'src', 'data', 'confusables.generated.ts'), 'utf8');
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

/**
 * Alphabets: the letters of the modern alphabet, by code point range. A
 * precomposed letter whose NFD is base + marks is NOT listed — the resolver
 * judges its base letter (so "é" counts as "e"). Letters of the script outside
 * these ranges (IPA, historic, small capitals) are "exotic": native to their
 * script, twin-less, and left to the Identifier_Status rule.
 */
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => String.fromCodePoint(a + i));
const ALPHABETS = {
  Latin: [...range(0x41, 0x5a), ...range(0x61, 0x7a)],
  Cyrillic: [
    ...range(0x400, 0x45f),
    0x490,
    0x491,
    0x4c0,
    0x4cf,
    0x4ae,
    0x4af,
    0x4ba,
    0x4bb,
    0x4d8,
    0x4d9,
    0x4e8,
    0x4e9,
    0x501,
    0x50c,
    0x50d,
    0x51a,
    0x51b,
    0x51c,
    0x51d,
    0x4b2, // Ҳ Tajik/Uzbek ha with descender (descender twin of X, §3.3)
    0x4b3, // ҳ
    0x4aa, // Ҫ Chuvash/Bashkir es with descender (conditional twin of C, off by default)
    0x4ab, // ҫ
  ].map((c) => (typeof c === 'number' ? String.fromCodePoint(c) : c)),
  Greek: [...range(0x391, 0x3a9), ...range(0x3b1, 0x3c9), 'ϳ', 'Ϳ'],
  Armenian: [...range(0x531, 0x556), ...range(0x561, 0x586)],
  Cherokee: [...range(0x13a0, 0x13f5), ...range(0x13f8, 0x13fd), ...range(0xab70, 0xabbf)],
  Coptic: [...range(0x2c80, 0x2ce3), ...range(0x3e2, 0x3ef)],
  // Donor-only Latin letters (§3.4): Latin-1/Extended-A/B, IPA, phonetic small
  // capitals — kept only if UTS #39 gives them a twin in another alphabet
  // (ɑ ı ɡ ᴀ …); twin-less ones (ß ø ł đ) stay ordinary exotic Latin.
  LatinExtra: [
    ...range(0xc0, 0x24f),
    ...range(0x250, 0x2af),
    ...range(0x1d00, 0x1d2b),
    '\ua730', // ꜰ small capital F
    '\ua731', // ꜱ small capital S
  ],
};
const SCRIPT_OF_ALPHABET = { LatinExtra: 'Latin' };
/**
 * Curated donor pairs (§3.4): Latin small capitals read as the lowercase letter
 * at x-height (corpus mixed_script-020 `ᴀᴅᴍɪɴ` → `admin`); UTS #39 maps most of
 * them to themselves (ᴀ → ᴀ), so the derivation alone gives them no Latin twin.
 */
const SMALL_CAPITALS = new Map(
  [...'ᴀaʙbᴄcᴅdᴇeꜰfɢgʜhɪiᴊjᴋkʟlᴍmɴnᴏoᴘpʀrꜱsᴛtᴜuᴠvᴡwʏyᴢz'.match(/../gu)].map((p) => [...p]),
);
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
export { SCRIPT_OF_ALPHABET };

/**
 * Curated overrides, applied on top of the UTS #39 derivation. `remove`
 * deletes a derived pair in both directions; `add` creates one. Every entry
 * carries its reason; docs/confusion-model.md argues them.
 */
export const OVERRIDES = {
  remove: [],
  add: [
    ['\u03c9', 'w', 'ω/w: alike in running text (owner); no UTS #39 entry'],
    // NOT added (owner, 2026-11-04): к/k, κ/k (Latin k's ascender stands out),
    // п/n (italic-only lookalike). χ/x and η/n moved to CONDITIONAL_TWINS (round 6); п/n is there too, default off.
  ],
};

/**
 * Conditional twins (§3.3): pairs that look alike only under some rendering —
 * descender twins differ only below the baseline, italic twins only in
 * italic fonts. A separate class, enabled per pair by the caller
 * (`conditionalTwins`: a set of ids). Cross-alphabet pairs enter the twin
 * table; intra-Latin pairs (ŋ ɳ → n) are handled by the resolver.
 */
export const CONDITIONAL_TWINS = {
  'χ~x': { kind: 'descender', pairs: [['\u03c7', 'x']] },
  'χ~х': { kind: 'descender', pairs: [['\u03c7', '\u0445']] },
  'ҳ~x': {
    kind: 'descender',
    pairs: [
      ['\u04b3', 'x'],
      ['\u04b2', 'X'],
    ],
  },
  'ҳ~χ': { kind: 'descender', pairs: [['\u04b3', '\u03c7']] },
  'η~n': { kind: 'descender', pairs: [['\u03b7', 'n']] },
  'ŋ~n': { kind: 'descender', pairs: [] }, // intra-Latin, resolver: ŋ→n, Ŋ→N
  'ɳ~n': { kind: 'descender', pairs: [] }, // intra-Latin, resolver: ɳ→n
  'и~u': { kind: 'italic', pairs: [['\u0438', 'u']] },
  'т~m': { kind: 'italic', pairs: [['\u0442', 'm']] },
  'п~n': { kind: 'italic', pairs: [['\u043f', 'n']] },
  'ı~i': { kind: 'shape', pairs: [] }, // intra-Latin, resolver: ı→i (dotless i; owner round 7)
  'ҫ~c': {
    kind: 'descender',
    pairs: [
      ['\u04ab', 'c'],
      ['\u04aa', 'C'],
    ],
  },
  'ɽ~r': { kind: 'descender', pairs: [] }, // intra-Latin, resolver: ɽ→r
  'ʐ~z': { kind: 'descender', pairs: [] }, // intra-Latin, resolver: ʐ→z
};
/** Default set (owner, final): the x-likes on; η ŋ ɳ, italic и т п, ı, ҫ ɽ ʐ off. */
export const DEFAULT_CONDITIONAL_TWINS = new Set(['χ~x', 'χ~х', 'ҳ~x', 'ҳ~χ']);

const isUpper = (c) => c !== c.toLowerCase();
export const alphabetOf = new Map();
for (const [name, letters] of Object.entries(ALPHABETS))
  for (const c of letters) alphabetOf.set(c, name);

export { ALPHABETS };
export function derive({ raw = false, conditional = DEFAULT_CONDITIONAL_TWINS } = {}) {
  // twins[letter][alphabet] = Set of letters in that alphabet it is confused with
  const twins = new Map();
  const add = (a, b, src) => {
    for (const [x, y] of [
      [a, b],
      [b, a],
    ]) {
      const A = alphabetOf.get(y);
      if (!twins.has(x)) twins.set(x, {});
      const cross = isUpper(x) !== isUpper(y);
      (twins.get(x)[A] ??= new Map()).set(y, cross && src === 'uts39' ? 'cross-case' : src);
    }
  };
  const bySkel = new Map();
  for (const c of alphabetOf.keys()) {
    const k = skeleton(c);
    if (!bySkel.has(k)) bySkel.set(k, []);
    bySkel.get(k).push(c);
  }
  for (const [, group] of bySkel)
    for (const a of group)
      for (const b of group)
        if (a < b && alphabetOf.get(a) !== alphabetOf.get(b)) add(a, b, 'uts39');
  if (!raw) {
    for (const [a, b] of OVERRIDES.remove) {
      twins.get(a)?.[alphabetOf.get(b)]?.delete(b);
      twins.get(b)?.[alphabetOf.get(a)]?.delete(a);
    }
    for (const [a, b] of OVERRIDES.add) {
      const had = twins.get(a)?.[alphabetOf.get(b)]?.has(b);
      if (!had) add(a, b, 'curated');
    }
    for (const [a, b] of SMALL_CAPITALS)
      if (alphabetOf.has(a) && !twins.get(a)?.Latin?.has(b)) add(a, b, 'curated');
    for (const id of conditional)
      for (const [a, b] of CONDITIONAL_TWINS[id]?.pairs ?? [])
        if (!twins.get(a)?.[alphabetOf.get(b)]?.has(b)) add(a, b, CONDITIONAL_TWINS[id].kind);
  }
  return { twins, bySkel };
}

if (process.argv[1] !== fileURLToPath(import.meta.url)) {
  // imported as a module: no report
} else main();
function main() {
  const args = process.argv.slice(2);
  const { twins, bySkel } = derive({ raw: args.includes('--raw') });
  const scripts = Object.keys(ALPHABETS);

  if (args.includes('--json')) {
    const out = {};
    for (const [c, per] of twins) {
      out[c] = {};
      for (const [A, m] of Object.entries(per)) if (m.size) out[c][A] = [...m.keys()];
    }
    console.log(JSON.stringify(out));
    return;
  }

  const u = (c) => `${c} U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
  const cell = (c, A) => {
    const m = twins.get(c)?.[A];
    if (!m || m.size === 0) return '—';
    return [...m]
      .map(([y, s]) =>
        s === 'curated'
          ? `${y}*`
          : s === 'cross-case'
            ? `${y}†`
            : s === 'descender'
              ? `${y}‡`
              : s === 'italic'
                ? `${y}§`
                : y,
      )
      .join(' ');
  };
  const core = {
    Latin: ALPHABETS.Latin,
    Cyrillic: ALPHABETS.Cyrillic.filter(
      (c) => c.codePointAt(0) >= 0x410 && c.codePointAt(0) <= 0x44f,
    ).concat([
      'і',
      'ї',
      'І',
      'Ї',
      'ј',
      'Ј',
      'ѕ',
      'Ѕ',
      'є',
      'Є',
      'ґ',
      'Ґ',
      'ӏ',
      'Ӏ',
      'ԁ',
      'ԛ',
      'ԝ',
      'Ԛ',
      'Ԝ',
      'һ',
      'Һ',
      'ү',
      'Ү',
      'ҳ',
      'Ҳ',
    ]),
    Greek: ALPHABETS.Greek,
  };
  const others = {
    Latin: ['Cyrillic', 'Greek'],
    Cyrillic: ['Latin', 'Greek'],
    Greek: ['Latin', 'Cyrillic'],
  };
  for (const A of ['Latin', 'Cyrillic', 'Greek']) {
    console.log(`\n### ${A} (${core[A].length} letters shown)\n`);
    console.log(`| letter | ${others[A].join(' | ')} | also |`);
    console.log(`|---|${others[A].map(() => '---').join('|')}|---|`);
    for (const c of core[A]) {
      const extra = scripts
        .filter((s) => s !== A && !others[A].includes(s))
        .map((s) => (cell(c, s) !== '—' ? `${s}: ${cell(c, s)}` : ''))
        .filter(Boolean)
        .join('; ');
      console.log(`| ${u(c)} | ${others[A].map((B) => cell(c, B)).join(' | ')} | ${extra} |`);
    }
  }

  // Stats + noise report.
  console.log('\n### Stats\n');
  for (const A of scripts) {
    const L = ALPHABETS[A];
    const withTwin = L.filter((c) => Object.values(twins.get(c) ?? {}).some((m) => m.size));
    const latin = L.filter((c) => twins.get(c)?.Latin?.size);
    console.log(
      `- ${A}: ${L.length} letters, ${withTwin.length} with any twin, ${A === 'Latin' ? '-' : latin.length} with a Latin twin`,
    );
  }
  console.log('\n### Case asymmetry (letter has a Latin twin but its case partner has none)\n');
  for (const A of ['Cyrillic', 'Greek']) {
    const rows = [];
    for (const c of ALPHABETS[A]) {
      const p = c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase();
      if (p === c || [...p].length !== 1) continue;
      const has = (x) => (twins.get(x)?.Latin?.size ?? 0) > 0;
      if (has(c) && !has(p)) rows.push(`${c}→${cell(c, 'Latin')} (${p}: —)`);
    }
    console.log(`- ${A}: ${rows.join(', ')}`);
  }
  console.log('\n### Cross-alphabet skeleton clusters with ≥3 alphabets (noise check)\n');
  for (const [k, g] of bySkel) {
    const as = new Set(g.map((c) => alphabetOf.get(c)));
    if (as.size >= 3)
      console.log(`- "${k}": ${g.map((c) => `${c}(${alphabetOf.get(c).slice(0, 3)})`).join(' ')}`);
  }
}
