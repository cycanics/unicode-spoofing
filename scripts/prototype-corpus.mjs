#!/usr/bin/env node
/**
 * PROTOTYPE — scores upstream v0.4.0 and the fork pipeline (cleanup →
 * resolver → upstream for zalgo/styled/illegal) on a cases.json corpus.
 *
 *   pnpm build && node scripts/prototype-corpus.mjs path/to/cases.json [--fails]
 *     [--whole-script-fold=off|foreign-letters|all] [--step5-own-scripts]
 *     [--twins=id,id|none]       # §3.3 conditional twin set (default: x-likes)
 *     [--targets=English,Russian,…]   # §4.5 target languages
 *     [--donors=LatinExtra,Armenian,…]          # §3.4 donor alphabets (default: all non-target)
 *     [--modes]   # totals for every whole-script-fold mode
 *
 * Scored per case (verdict must_flag / must_not_flag; `ambiguous` is only
 * tallied): `spoofed` must equal expected.spoofed; when expected.normalized
 * is given, `normalized` must equal it; when expected.keep is true,
 * `normalized` must equal the input.
 */
import { readFileSync } from 'node:fs';
import { analyze } from '../dist/index.js';
import { cleanup } from './prototype-cleanup.mjs';
import { makeResolver } from './prototype-resolve.mjs';

const MODEL = new Set(['Latin', 'Cyrillic', 'Greek', 'Armenian', 'Cherokee', 'Coptic']);
// One resolver per conditional-twin set × target-language list (§3.3, §4.5).
const resolvers = new Map();
const resolverFor = (set, targets, donors) => {
  const key = `${set ? [...set].sort().join(',') : 'default'}|${targets ?? 'default'}|${donors ?? 'default'}`;
  if (!resolvers.has(key))
    resolvers.set(
      key,
      makeResolver({
        ...(set ? { conditionalTwins: set } : {}),
        ...(targets ? { targetLanguages: targets } : {}),
        ...(donors ? { donorAlphabets: donors } : {}),
      }),
    );
  return resolvers.get(key);
};

export function forkAnalyze(text, opts = {}) {
  const c = cleanup(text);
  const r = resolverFor(
    opts.conditionalTwins,
    opts.targetLanguages,
    opts.donorAlphabets,
  ).resolveText(c.cleaned, opts);
  // Upstream supplies what the prototypes do not cover: zalgo, styled words,
  // illegal code points, remaining invisibles, words outside the model.
  // Its Latin-only fold of model-script words is NOT taken.
  const u = analyze(r.normalized);
  const taken = u.words.filter((w) => {
    // Cleanup is the authority on invisibles: what it kept (RLM in RTL text,
    // legit joiners, valid selectors) upstream must not strip again.
    if (w.signals.every((s) => s === 'invisible')) return false;
    if (w.signals.includes('mixed_script') && w.scripts.every((s) => MODEL.has(s))) return false;
    if (
      w.signals.length === 1 &&
      w.signals[0] === 'confusable_word' &&
      w.scripts.some((s) => s !== 'Latin')
    )
      return false;
    return true;
  });
  let normalized = '';
  let cursor = 0;
  for (const w of taken) {
    if (w.index < cursor) continue;
    normalized += r.normalized.slice(cursor, w.index) + analyze(w.word).normalized;
    cursor = w.index + w.word.length;
  }
  normalized += r.normalized.slice(cursor);
  const upstreamSpoof = taken.some((w) => w.signals.some((s) => s !== 'encoding_damage'));
  return {
    spoofed: c.hiddenWords > 0 || r.words.length > 0 || upstreamSpoof,
    normalized,
    hiddenWords: c.hiddenWords,
    confusableWords: r.confusableWords,
    mixedWords: r.mixedWords,
  };
}

function score(cases, fn) {
  const byCat = {};
  const fails = [];
  for (const x of cases) {
    const cat = (byCat[x.category] ??= { pass: 0, fail: 0, amb: 0, ambFlagged: 0 });
    const r = fn(x.input);
    if (x.verdict === 'ambiguous') {
      cat.amb += 1;
      if (r.spoofed) cat.ambFlagged += 1;
      continue;
    }
    const why = [];
    if (r.spoofed !== x.expected.spoofed) why.push(`spoofed=${r.spoofed}`);
    if (x.expected.normalized !== undefined && r.normalized !== x.expected.normalized)
      why.push(`normalized=${JSON.stringify(r.normalized)}`);
    if (x.expected.keep && r.normalized !== x.input)
      why.push(`changed→${JSON.stringify(r.normalized)}`);
    if (why.length) {
      cat.fail += 1;
      fails.push(`${x.id} ${JSON.stringify(x.input).slice(0, 50)} ${why.join(' ').slice(0, 140)}`);
    } else cat.pass += 1;
  }
  return { byCat, fails };
}

const path =
  process.argv[2] ??
  (console.error('usage: node scripts/prototype-corpus.mjs <cases.json>'), process.exit(2));
const cases = JSON.parse(readFileSync(path, 'utf8'));
const up = score(cases, (t) => analyze(t));
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const forkOpts = {
  wholeScriptFold: arg('whole-script-fold', 'all'),
  step5OwnScripts: process.argv.includes('--step5-own-scripts'),
};
const tw = arg('twins', null);
if (tw !== null) forkOpts.conditionalTwins = new Set(tw === 'none' ? [] : tw.split(','));
const tl = arg('targets', null);
if (tl !== null) forkOpts.targetLanguages = tl.split(',');
const dn = arg('donors', null);
if (dn !== null) forkOpts.donorAlphabets = dn.split(',').filter(Boolean);
const fk = score(cases, (t) => forkAnalyze(t, forkOpts));
const tot = (s) =>
  Object.values(s.byCat).reduce(
    (a, c) => ({
      pass: a.pass + c.pass,
      fail: a.fail + c.fail,
      amb: a.amb + c.amb,
      ambFlagged: a.ambFlagged + c.ambFlagged,
    }),
    { pass: 0, fail: 0, amb: 0, ambFlagged: 0 },
  );
console.log(
  '| category | upstream pass/fail | fork pass/fail | ambiguous flagged (upstream / fork) |',
);
console.log('|---|---|---|---|');
for (const cat of Object.keys(fk.byCat)) {
  const a = up.byCat[cat];
  const b = fk.byCat[cat];
  console.log(
    `| ${cat} | ${a.pass}/${a.fail} | ${b.pass}/${b.fail} | ${a.amb ? `${a.ambFlagged}/${a.amb} · ${b.ambFlagged}/${b.amb}` : '—'} |`,
  );
}
const A = tot(up);
const B = tot(fk);
console.log(
  `| **total** | ${A.pass}/${A.fail} | ${B.pass}/${B.fail} | ${A.ambFlagged}/${A.amb} · ${B.ambFlagged}/${B.amb} |`,
);
if (process.argv.includes('--fails')) {
  console.log('\nfork failures:');
  for (const f of fk.fails) console.log('- ' + f);
  console.log('\nupstream failures:');
  for (const f of up.fails) console.log('- ' + f);
}

if (process.argv.includes('--modes')) {
  console.log('\n| wholeScriptFold | fork pass/fail | ambiguous flagged |');
  console.log('|---|---|---|');
  for (const w of ['off', 'foreign-letters', 'all']) {
    const t = tot(score(cases, (x) => forkAnalyze(x, { ...forkOpts, wholeScriptFold: w })));
    console.log(`| ${w} | ${t.pass}/${t.fail} | ${t.ambFlagged}/${t.amb} |`);
  }
  console.log('\n| conditional twins | fork pass/fail | ambiguous flagged |');
  console.log('|---|---|---|');
  const X = ['χ~x', 'χ~х', 'ҳ~x', 'ҳ~χ'];
  for (const [name, set] of [
    ['none', []],
    ['default (x-likes)', X],
    ['+ η ŋ ɳ', [...X, 'η~n', 'ŋ~n', 'ɳ~n']],
    ['+ и~u', [...X, 'и~u']],
    ['+ и~u т~m', [...X, 'и~u', 'т~m']],
    ['+ ı~i', [...X, 'ı~i']],
    ['+ ҫ~c ɽ~r ʐ~z', [...X, 'ҫ~c', 'ɽ~r', 'ʐ~z']],
  ]) {
    const t = tot(
      score(cases, (x) => forkAnalyze(x, { ...forkOpts, conditionalTwins: new Set(set) })),
    );
    console.log(`| ${name} | ${t.pass}/${t.fail} | ${t.ambFlagged}/${t.amb} |`);
  }
  console.log('\n| donor alphabets | fork pass/fail | ambiguous flagged |');
  console.log('|---|---|---|');
  for (const dn of [
    [],
    ['Armenian', 'Cherokee', 'Coptic'],
    ['LatinExtra', 'Armenian', 'Cherokee', 'Coptic'],
  ]) {
    const t = tot(score(cases, (x) => forkAnalyze(x, { ...forkOpts, donorAlphabets: dn })));
    console.log(`| ${dn.join(' + ') || 'none'} | ${t.pass}/${t.fail} | ${t.ambFlagged}/${t.amb} |`);
  }
  console.log('\n| target languages | fork pass/fail | ambiguous flagged |');
  console.log('|---|---|---|');
  for (const tl of [
    ['English', 'Russian'],
    ['English', 'Russian', 'Ukrainian'],
    ['English', 'Russian', 'Greek'],
    ['English', 'Russian', 'Ukrainian', 'Greek'],
  ]) {
    const t = tot(score(cases, (x) => forkAnalyze(x, { ...forkOpts, targetLanguages: tl })));
    console.log(`| ${tl.join(' + ')} | ${t.pass}/${t.fail} | ${t.ambFlagged}/${t.amb} |`);
  }
}
