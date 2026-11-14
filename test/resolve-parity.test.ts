/**
 * Parity with the reference prototype (scripts/prototype-resolve.mjs): the
 * src resolver must produce the same normalized text and the same per-word
 * class/rule/target on the prototype's probe list, every corpus input, and
 * the realistic benchmark text, under every wholeScriptFold mode and a few
 * option sets.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConfusionModel, type ConfusionModelOptions } from '../src/confusion';
import { resolveTokens, type WholeScriptFold } from '../src/resolve';

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
  'ηame',
  'ɳo',
  'Wi-Fi-роутер',
  'по e-mail',
  'Docker-контейнер',
];

function srcResolve(text: string, modelOpts: ConfusionModelOptions, mode: WholeScriptFold) {
  const tokens = [...text.matchAll(TOKEN_RE)];
  const { resolved } = resolveTokens(
    text,
    { starts: tokens.map((t) => t.index), ends: tokens.map((t) => t.index + t[0].length) },
    createConfusionModel(modelOpts),
    {
      wholeScriptFold: mode,
    },
  );
  let out = '';
  let cursor = 0;
  const words: string[] = [];
  for (const [i, r] of [...resolved].sort((a, b) => a[0] - b[0])) {
    const t = tokens[i]!;
    out += text.slice(cursor, t.index) + r.normalized;
    cursor = t.index + t[0].length;
    words.push(`${t.index}:${t[0]}→${r.normalized} ${r.class} ${r.rule}→${r.script ?? '-'}`);
  }
  return { normalized: out + text.slice(cursor), words };
}

function protoResolve(text: string, modelOpts: object, mode: WholeScriptFold) {
  const r = proto.makeResolver(modelOpts).resolveText(text, { wholeScriptFold: mode });
  return {
    normalized: r.normalized,
    words: r.words.map(
      (w) =>
        `${w.index}:${w.word}→${(w as { normalized?: string }).normalized} ${w.kind} ${w.rule}→${w.script ?? '-'}`,
    ),
  };
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
        'п~n',
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

describe('resolver parity with the prototype', () => {
  for (const [label, o] of CONFIGS)
    for (const mode of ['all', 'foreign-letters', 'off'] as const) {
      if (label !== 'default' && mode !== 'all') continue;
      const protoOpts = {
        ...(o.conditionalTwins ? { conditionalTwins: new Set(o.conditionalTwins) } : {}),
        ...(o.targetLanguages ? { targetLanguages: o.targetLanguages } : {}),
        ...(o.donorAlphabets ? { donorAlphabets: o.donorAlphabets } : {}),
      };
      it(`probes + corpus, ${label}, ${mode}`, () => {
        let words = 0;
        for (const t of [...PROBES, ...cases]) {
          const a = srcResolve(t, o, mode);
          expect(a, JSON.stringify(t)).toEqual(protoResolve(t, protoOpts, mode));
          words += a.words.length;
        }
        expect(words).toBeGreaterThan(mode === 'off' ? 40 : 100);
      }, 60_000);
    }
  it('realistic text (200 KB), default', () => {
    const text = realistic.buildRealisticMarkdown({ targetBytes: 200_000, seed: 7, cases });
    const a = srcResolve(text, {}, 'all');
    const b = protoResolve(text, {}, 'all');
    expect(a.words.length).toBeGreaterThan(30);
    expect(a.words).toEqual(b.words);
    expect(a.normalized === b.normalized).toBe(true);
  }, 60_000);
});
