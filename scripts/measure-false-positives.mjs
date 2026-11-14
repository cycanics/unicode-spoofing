#!/usr/bin/env node
/**
 * MEASUREMENT — false positives of the language evidence: foreign letters
 * (§4.4), case anomaly (§4.5), positional spelling rules (§4.6), plus the
 * not-adopted mid-word I-for-l rule (§15).
 *
 *   node scripts/measure-false-positives.mjs                       # built-in token lists
 *   node scripts/measure-false-positives.mjs --dict=Script:file …  # dictionary words with evidence
 *   node scripts/measure-false-positives.mjs --hebrew=file         # Hebrew final-form rule on a word list
 *   node scripts/measure-false-positives.mjs --from=filelist [--list]
 *       # real text: tokens with evidence, and non-ASCII tokens that fold when judged alone
 *
 * Dictionary files are hunspell .dic (stems; "/flags" stripped) or plain word lists, UTF-8.
 */
import { readFileSync } from 'node:fs';
import { makeResolver, hebrewFinalsOk } from './prototype-resolve.mjs';

const args = process.argv.slice(2);
const vals = (k) => args.filter((a) => a.startsWith(`--${k}=`)).map((a) => a.slice(k.length + 3));
const { inspect, resolveText } = makeResolver();
const words = (f) =>
  readFileSync(f, 'utf8')
    .split('\n')
    .slice(1)
    .map((l) => l.split('/')[0].trim())
    .filter(Boolean);

/** camelCase / brand / formula tokens the case-anomaly rule (§4.5) must leave alone. */
export const CASE_LEGIT = (
  'iPhone GitHub McDonald eBay YouTube PayPal LinkedIn iOS macOS WiFi JavaScript DeepL NaI AgI PbI2 ' +
  'CsI getId userId isIn openAI OpenAI SwiftUI PowerBI WWII HenryVIII XboX iPadOS ChatGPT TikTok WhatsApp ' +
  'DuckDuckGo SharePoint AdobeXD LouisXIV MySQL PostgreSQL GraphQL jQuery iCloud iMac eID ' +
  'Кӏант кӏорни хӏума дӏа маӏа Коммерсантъ КамАЗ ВкусВилл МосГорТранс ъгъл ыдыс'
).split(' ');
export const CASE_ATTACKS = 'paypaI раураӏ раураІ gmaiI goIang appIe'.split(' ');

const dicts = vals('dict');
const heb = vals('hebrew');
const from = vals('from')[0];
if (dicts.length) {
  for (const d of dicts) {
    const [S, f] = d.split(/:(.*)/s);
    const list = words(f);
    const hits = { foreign: [], case: [], orthography: [] };
    let flagged = 0;
    for (const w of list) {
      const i = inspect(w);
      if (!i.evidence) continue;
      hits[i.evidence.kind].push(`${w}(${i.evidence.rule ?? i.evidence.letters})`);
      if (i.valid.some((T) => !i.scripts.has(T))) flagged++;
    }
    console.log(
      `${f.split('/').pop()} (${S}): ${list.length} words; evidence foreign=${hits.foreign.length} case=${hits.case.length} orthography=${hits.orthography.length}; readable as another alphabet (would be flagged): ${flagged}`,
    );
    if (args.includes('--list'))
      for (const [k, v] of Object.entries(hits))
        if (v.length) console.log(`  ${k}: ${v.slice(0, 40).join(' ')}`);
  }
} else if (heb.length) {
  for (const f of heb) {
    const list = words(f);
    const bad = list.filter((w) => !hebrewFinalsOk(w));
    console.log(`${f.split('/').pop()}: ${list.length} words; final-form violations ${bad.length}`);
    if (args.includes('--list')) console.log('  ' + bad.slice(0, 40).join(' '));
  }
} else if (from) {
  const counts = new Map();
  for (const f of readFileSync(from, 'utf8').split('\n').filter(Boolean))
    for (const m of readFileSync(f, 'utf8').matchAll(/[\p{L}\p{M}\p{N}]+/gu))
      counts.set(m[0], (counts.get(m[0]) ?? 0) + 1);
  const hits = {
    foreign: new Map(),
    case: new Map(),
    orthography: new Map(),
    donor: new Map(),
    folded: new Map(),
  };
  let tokens = 0;
  for (const [t, n] of counts) {
    tokens += n;
    const ev = inspect(t).evidence;
    if (ev) (hits[ev.kind] ??= new Map()).set(`${t}(${ev.rule ?? ev.letters})`, n);
    // Context-free fold of the token alone (any rule): what a lone token would become.
    if (/[^\p{ASCII}]/u.test(t)) {
      const r = resolveText(t);
      if (r.normalized !== t) hits.folded.set(`${t}→${r.normalized}`, n);
    }
  }
  console.log(`tokens=${tokens} distinct=${counts.size}`);
  for (const [k, m] of Object.entries(hits)) {
    const n = [...m.values()].reduce((a, b) => a + b, 0);
    console.log(`${k}: ${n} occurrences, ${m.size} distinct`);
    if (args.includes('--list'))
      for (const [t, c] of [...m].sort((a, b) => b[1] - a[1]).slice(0, 40))
        console.log(`  ${c}\t${t}`);
  }
} else {
  for (const [name, list] of [
    ['case-legit', CASE_LEGIT],
    ['case-attacks', CASE_ATTACKS],
  ]) {
    const hit = list.filter((t) => inspect(t).evidence);
    console.log(
      `${name}: ${hit.length}/${list.length} with evidence${hit.length ? ': ' + hit.map((t) => `${t}(${inspect(t).evidence.rule ?? inspect(t).evidence.letters})`).join(' ') : ''}`,
    );
  }
}
