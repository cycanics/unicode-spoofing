/**
 * Parity with the reference prototype (scripts/prototype-resolve.mjs): the
 * src resolver must produce the same normalized text and the same per-word
 * class/target on the probe sentences, every corpus input, and the realistic
 * benchmark text, under every wholeScriptFold mode and a few option sets.
 *
 * Scope: the prototype implements the ladder of decisions 23–41n. Words that
 * later decisions decide are out of scope on both sides (their behaviour is
 * asserted in the decision tests): 36e ordering B (a word part holding letters
 * of two of Latin, Cyrillic, Greek) and 41o (a whole word folded by context
 * whose nearest word is written in its own script).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildLookalikes,
  createConfusionModel,
  DEFAULT_ADDITIONAL_PACKS,
  DEFAULT_CONDITIONAL_TWINS,
  type ConfusionModelOptions,
  type LookalikePack,
} from '../src/confusion';
import { DEFAULT_TARGET_LANGUAGES, TARGET_LANGUAGES, type TargetLanguage } from '../src/languages';
import { OWNER_DONOR_ROWS, REPLACED_TABLE_PAIRS } from '../src/data/owner-donors';
import { resolveTokens } from './helpers/resolve-tokens';
import type { WholeScriptFold } from '../src/resolve';

const TOKEN_RE = /[\p{L}\p{M}\p{N}\p{Cf}'’]+/gu;
const proto = (await import(
  join(__dirname, '..', 'scripts', 'prototype-resolve.mjs') as string
)) as {
  makeResolver: (o?: object) => {
    resolveText: (
      t: string,
      o?: object,
    ) => {
      normalized: string;
      words: { word: string; index: number; kind: string; rule: string; script: string | null }[];
    };
  };
};
const realistic = (await import(
  join(__dirname, '..', 'scripts', 'realistic-text.mjs') as string
)) as {
  buildRealisticMarkdown: (o: object) => string;
};
const cases = (
  JSON.parse(readFileSync(join(__dirname, 'fixtures', 'cases.json'), 'utf8')) as { input: string }[]
).map((c) => c.input);

export const PROBES = [
  'Пpивет',
  'Мы пишем Пpивет всем',
  'Hеllo',
  'wоrld',
  'pаypal',
  'busіnеss',
  'quіск',
  'HОT',
  'НOТ',
  'ВOДКА',
  'CОК',
  'COК',
  'TЕХ',
  'cоса',
  'drink cоса now',
  'Αрр',
  'open the Αрр',
  'Αpple',
  'Kαλημέρα',
  'οnly',
  'ΑΡΡLE',
  "GitHub'а",
  "форк на GіtHub'а",
  'pаypal’ѕ',
  'iPhone’ов',
  'Пpивеt',
  'Сafé',
  'Ёлкa',
  'шaг',
  'Ьank',
  'paypaІ',
  'тime',
  'кey',
  'Kиев',
  'НОТ',
  'НОТ dog',
  'НОТ deal today',
  'This is НОТ news',
  'Мы были в НОТ',
  'СССР',
  'СОСА-СОЛА',
  'раураӏ',
  'тип',
  'опера',
  'I like опера',
  'тail',
  'иser',
  'admiп',
  'вank',
  'Bank ассоunt verification',
  'Wе landed',
  'раураl',
  'аррӏе.com',
  'I bought сок today',
  'I bought сор today',
  'the рос here',
  'it is сухо here',
  'eat уха soup',
  'an оса flew',
  'add сахар now',
  'Мы были в НОТ сегодня',
  'Зайди на раураӏ сегодня',
  'раураІ',
  'paypaI',
  'NaI',
  'my иser name',
  'my кey here',
  'my тap here',
  'paᏏy',
  'маӏа',
  'Το iPhone είναι ακριβό',
  'Коммерсантъ',
  'ьank',
  'ъеst',
  'oьo',
  'Gοοgle ΑΡΡLΕ',
  'СОСА-COLA',
  'χbox',
  'ҳbox',
  'paχos',
  'ŋame',
  'ҳа',
  'мiр',
  'сiла',
  'ᴀᴅᴍɪɴ',
  'ɡoogle',
  'pɑypal',
  'Ьр',
  "İstanbul'da ışık",
  'þorn',
  'Lınkedin',
  'lınk pıng',
  'kışın ığdır Iğdır',
  'ηame',
  'ɳo',
  'Wi-Fi-роутер',
  'по e-mail',
  'Docker-контейнер',
];

/**
 * Decision 36e ordering B leaves a word of two requested alphabets to 36e, not to the
 * resolver; these sentences hold words the resolver still maps whole, so every mode
 * compares enough words: words written wholly in another target's look-alikes (by their
 * context), donor-only words, and donors of unrequested languages.
 */
const CYR: Record<string, string> = { a: 'а', c: 'с', e: 'е', o: 'о', p: 'р', x: 'х', y: 'у' };
const LAT: Record<string, string> = { а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x' };
const EN_LOOKALIKE =
  'cope pace cape cop copy pope peace pay coax apex ace eye pea cocoa coy yap pax';
const RU_LOOKALIKE = 'сор сосо рора рас рах рух сах оса ехо коса хор ура';
const SMALL_CAPS = 'ᴀᴅᴍɪɴ ᴜꜱᴇʀ ᴘᴀʏ ʟᴏɢɪɴ ᴛᴏᴋᴇɴ ʙᴀɴᴋ ᴄᴏᴅᴇ ᴍᴀɪʟ';
const UNREQUESTED = 'ѕtock ѕhip јob јam ԁog ԁata ѕend ѕale јust ԁone';
const EN_UPPER =
  'HOT COP TOP BOX CAKE MAKE TAKE BAKE POKE HOPE COMA ECHO MOTH TEAM BEAM MEAT HEAT BOAT COAT MOAT';
const UP: Record<string, string> = {
  A: 'А',
  B: 'В',
  C: 'С',
  E: 'Е',
  H: 'Н',
  K: 'К',
  M: 'М',
  O: 'О',
  P: 'Р',
  T: 'Т',
  X: 'Х',
  Y: 'У',
};
// A foreign letter as evidence (Caucasian palochka for `l`): folds on evidence alone.
const EN_WITH_L =
  'apple paypal local loyal lace pale pole cell yell lapel pool cool peel opal ale lay play clay lap coal plea leap peal apply ally oval lope copal cola lop lee eel';
/** The probe sentences are synthetic: their own group and floor, apart from the corpus. */
export const WHOLE_WORD_PROBES = [
  ...EN_LOOKALIKE.split(' ').flatMap((w) => {
    const c = [...w].map((ch) => CYR[ch] ?? ch).join('');
    return [`Please send the ${c} today and more`, `We need ${c} for the team now`];
  }),
  ...RU_LOOKALIKE.split(' ').flatMap((w) => {
    const l = [...w].map((ch) => LAT[ch] ?? ch).join('');
    return [`Мы видели ${l} вчера вечером дома`, `Это ${l} для нашей команды`];
  }),
  ...SMALL_CAPS.split(' ').flatMap((w) => [`Please use ${w} now`, `Мы видели ${w} вчера`]),
  ...UNREQUESTED.split(' ').flatMap((w) => [
    `Please check the ${w} today`,
    `The ${w} is ready now`,
  ]),
  ...EN_UPPER.split(' ').flatMap((w) => {
    const c = [...w].map((ch) => UP[ch] ?? ch).join('');
    return [`Please send the ${c} today and more`, `We need ${c} for the team now`];
  }),
  ...EN_WITH_L.split(' ').flatMap((w) => {
    const c = [...w].map((ch) => (ch === 'l' ? 'ӏ' : (CYR[ch] ?? ch))).join('');
    return [`Please send the ${c} today and more`, `Мы видели ${c} вчера`];
  }),
];

/**
 * The prototype knows the twin table only: the src side runs without the
 * owner's donor rows (owner-donors.ts), and the prototype gets `ı~i`, which
 * the default English pack holds now (owner, 2026-11-15).
 */
const OWNER_ROWS: LookalikePack = {};
for (const [cp, y, L, p] of OWNER_DONOR_ROWS)
  if (p === 'default')
    ((OWNER_ROWS as Record<string, [string, string][]>)[L as TargetLanguage] ??= []).push([
      String.fromCodePoint(cp),
      y,
    ]);
const tableOnly = (o: ConfusionModelOptions): ConfusionModelOptions => ({
  ...o,
  lookalikes: buildLookalikes({
    additional: o.conditionalTwins ? [...o.conditionalTwins] : DEFAULT_ADDITIONAL_PACKS,
    remove: OWNER_ROWS,
    // The table pairs an owner verdict replaced (40f) are the prototype's still.
    add: Object.fromEntries(
      REPLACED_TABLE_PAIRS.map(([d, y, L]) => [L, [[d, y]]]),
    ) as LookalikePack,
  }),
});
const withDotless = (o: ConfusionModelOptions) =>
  new Set([...(o.conditionalTwins ?? DEFAULT_CONDITIONAL_TWINS), 'ı~i']);

/**
 * Which ladder step decided is not compared: the context steps read one
 * context window and the 41b nearest words now (decisions 22, 41b), the
 * prototype its own, so a fold the prototype made by word majority can come
 * from the context here. The fold, its class and alphabet are compared.
 */
const step = (rule: string) => (rule === 'no-valid-alphabet' ? rule : '·');

interface Word {
  index: number;
  word: string;
  normalized: string;
  kind: string;
  rule: string;
  script: string | null;
}

function srcResolve(text: string, modelOpts: ConfusionModelOptions, mode: WholeScriptFold): Word[] {
  const tokens = [...text.matchAll(TOKEN_RE)];
  const { resolved } = resolveTokens(
    text,
    tokens.map((t) => t.index),
    createConfusionModel(tableOnly(modelOpts)),
    { wholeScriptFold: mode },
  );
  return [...resolved]
    .sort((a, b) => a[0] - b[0])
    .map(([i, r]) => ({
      index: tokens[i]!.index,
      word: tokens[i]![0],
      normalized: r.normalized,
      kind: r.class,
      rule: r.rule,
      script: r.script,
    }));
}

function protoResolve(text: string, modelOpts: object, mode: WholeScriptFold): Word[] {
  return proto
    .makeResolver(modelOpts)
    .resolveText(text, { wholeScriptFold: mode })
    .words.map((w) => ({ ...w, normalized: (w as { normalized?: string }).normalized ?? w.word }));
}

const SCRIPT_RE: [string, RegExp][] = [
  ['Latin', /\p{Script=Latin}/u],
  ['Cyrillic', /\p{Script=Cyrillic}/u],
  ['Greek', /\p{Script=Greek}/u],
];
const scriptsOf = (w: string) =>
  new Set([...w].flatMap((c) => SCRIPT_RE.filter(([, re]) => re.test(c)).map(([n]) => n)));

/** 36e ordering B: a word part holding letters of two requested languages' alphabets. */
function orderingB(w: string, targets: readonly TargetLanguage[]): boolean {
  return w.split(/[-\u2010\u2011'’ʼ]/u).some((part) => {
    const held = new Set<string>();
    for (const c of part.normalize('NFD').toLowerCase())
      for (const n of targets)
        if (TARGET_LANGUAGES[n].letters.includes(c)) held.add(TARGET_LANGUAGES[n].script);
    return held.size >= 2;
  });
}

/** 41o: a whole word folded by context whose nearest lettered word (same paragraph) is of its own script. */
function ownScriptNeighbour(text: string, w: Word): boolean {
  if (w.rule !== 'neighbours' && w.rule !== 'window') return false;
  const own = scriptsOf(w.word);
  if (own.size !== 1) return false;
  const tokens = [...text.matchAll(TOKEN_RE)].filter((t) => /\p{L}/u.test(t[0]));
  const k = tokens.findIndex((t) => t.index === w.index);
  for (const j of [k - 1, k + 1]) {
    const t = tokens[j];
    if (!t) continue;
    const between = j < k ? text.slice(t.index, w.index) : text.slice(w.index, t.index);
    if (/\n\s*\n/.test(between)) continue;
    const sc = scriptsOf(t[0]);
    if (sc.size === 1 && own.has([...sc][0]!)) return true;
  }
  return false;
}

/**
 * 41b by language (owner, 2026-11-19): a word whose letters all belong to one unrequested
 * language, a nearest lettered word (same paragraph) of which is that language too, stays as
 * written; the prototype predates the rule.
 */
function unrequestedOwnNeighbour(
  text: string,
  w: Word,
  targets: readonly TargetLanguage[],
): boolean {
  const letters = (x: string) =>
    [...x.normalize('NFD').toLowerCase()].filter((c) => /\p{L}/u.test(c));
  const own = letters(w.word);
  if (!own.length) return false;
  if (own.some((c) => targets.some((n) => TARGET_LANGUAGES[n].letters.includes(c)))) return false;
  const langs = (Object.keys(TARGET_LANGUAGES) as TargetLanguage[]).filter(
    (n) => !targets.includes(n) && own.every((c) => TARGET_LANGUAGES[n].letters.includes(c)),
  );
  if (!langs.length) return false;
  const tokens = [...text.matchAll(TOKEN_RE)].filter((t) => /\p{L}/u.test(t[0]));
  const k = tokens.findIndex((t) => t.index === w.index);
  for (const j of [k - 1, k + 1]) {
    const t = tokens[j];
    if (!t) continue;
    const between = j < k ? text.slice(t.index, w.index) : text.slice(w.index, t.index);
    if (/\n\s*\n/.test(between)) continue;
    const ls = letters(t[0]);
    if (langs.some((n) => ls.every((c) => TARGET_LANGUAGES[n].letters.includes(c)))) return true;
  }
  // Or the window (±10 words, same paragraph): more letters of words of that language than of
  // words of other languages.
  const all = Object.keys(TARGET_LANGUAGES) as TargetLanguage[];
  let mine = 0;
  let other = 0;
  for (let j = Math.max(0, k - 10); j <= Math.min(tokens.length - 1, k + 10); j++) {
    if (j === k) continue;
    const t = tokens[j]!;
    const between = j < k ? text.slice(t.index, w.index) : text.slice(w.index, t.index);
    if (/\n\s*\n/.test(between)) continue;
    const ls = letters(t[0]);
    const of = (n: TargetLanguage) => ls.every((c) => TARGET_LANGUAGES[n].letters.includes(c));
    if (langs.some(of)) mine += ls.length;
    else if (all.some(of)) other += ls.length;
  }
  return mine > other;
}

/** Both sides on `text`, words out of scope left out (and written as they are); the src word count. */
function compare(text: string, a: Word[], b: Word[], targets: readonly TargetLanguage[]): number {
  const out = new Set<number>();
  // 41b by language: excused only where the library left the word as written.
  const srcChanged = new Set(a.filter((w) => w.normalized !== w.word).map((w) => w.index));
  for (const w of [...a, ...b])
    if (
      orderingB(w.word, targets) ||
      ownScriptNeighbour(text, w) ||
      (!srcChanged.has(w.index) && unrequestedOwnNeighbour(text, w, targets))
    )
      out.add(w.index);
  const view = (ws: Word[]) => {
    const kept = ws.filter((w) => !out.has(w.index));
    let normalized = '';
    let cursor = 0;
    for (const w of kept) {
      normalized += text.slice(cursor, w.index) + w.normalized;
      cursor = w.index + w.word.length;
    }
    return {
      normalized: normalized + text.slice(cursor),
      words: kept.map(
        (w) => `${w.index}:${w.word}→${w.normalized} ${w.kind} ${step(w.rule)}→${w.script ?? '-'}`,
      ),
    };
  };
  const x = view(a);
  expect(x, JSON.stringify(text.slice(0, 200))).toEqual(view(b));
  return x.words.length;
}

const CONFIGS: [string, ConfusionModelOptions][] = [
  ['default', {}],
  ['twins none', { conditionalTwins: [] }],
  [
    'twins all',
    {
      conditionalTwins: [
        'χ~x',
        'χ~х',
        'ҳ~x',
        'ҳ~χ',
        'η~n',
        'ŋ~n',
        'ɳ~n',
        'и~u',
        'т~m',
        'ı~i',
        'ҫ~c',
        'ɽ~r',
        'ʐ~z',
      ],
    },
  ],
  ['English+Russian', { targetLanguages: ['English', 'Russian'] }],
  ['no donors', { donorAlphabets: [] }],
];

/**
 * The corpus group: the fixture inputs as they are, and the benchmark text built from them
 * (512 KB; no padding sentences): its own floor.
 */
const CORPUS_TEXT = realistic.buildRealisticMarkdown({ targetBytes: 1 << 19, seed: 3, cases });
const CORPUS_FLOOR = 25;

describe('resolver parity with the prototype', () => {
  for (const [label, o] of CONFIGS)
    for (const mode of ['all', 'foreign-letters', 'off'] as const) {
      if (label !== 'default' && mode !== 'all') continue;
      const protoOpts = {
        conditionalTwins: withDotless(o),
        ...(o.targetLanguages ? { targetLanguages: o.targetLanguages } : {}),
        ...(o.donorAlphabets ? { donorAlphabets: o.donorAlphabets } : {}),
      };
      it(`probes (synthetic) and corpus, ${label}, ${mode}`, () => {
        // A floor per group: the synthetic probes cannot stand in for the corpus (review 18).
        const count = (texts: readonly string[]) =>
          texts.reduce(
            (n, t) =>
              n +
              compare(
                t,
                srcResolve(t, o, mode),
                protoResolve(t, protoOpts, mode),
                o.targetLanguages ?? DEFAULT_TARGET_LANGUAGES,
              ),
            0,
          );
        const np = count([...PROBES, ...WHOLE_WORD_PROBES]);
        const nc = count([...cases, CORPUS_TEXT]);
        expect(np).toBeGreaterThan(mode === 'off' ? 40 : 100);
        expect(nc).toBeGreaterThan(CORPUS_FLOOR);
      }, 120_000);
    }
  it('realistic text (1 MB), default', () => {
    const text = realistic.buildRealisticMarkdown({ targetBytes: 1 << 20, seed: 7, cases });
    const a = srcResolve(text, {}, 'all');
    const b = protoResolve(text, { conditionalTwins: withDotless({}) }, 'all');
    const n = compare(text, a, b, DEFAULT_TARGET_LANGUAGES);
    expect(n).toBeGreaterThan(30);
  }, 120_000);
});
