/**
 * The resolver (src/resolve.ts): the rows of docs/confusion-model.md §4.8,
 * the wholeScriptFold mode table of §4.3, and a property test — a real word
 * with one injected lookalike resolves back to itself when it holds a proof
 * letter against the lookalike's alphabet and the lookalike folds back to
 * the letter it replaced.
 */
import { describe, expect, it } from 'vitest';
import { createConfusionModel, type ConfusionModelOptions } from '../src/confusion';
import { analyze } from '../src';
import type { TargetLanguage } from '../src/languages';
import { resolveTokens } from './helpers/resolve-tokens';
import type { WholeScriptFold, WordResolution } from '../src/resolve';

const TOKEN_RE = /[\p{L}\p{M}\p{N}\p{Cf}'’]+/gu;

function resolve(text: string, mode: WholeScriptFold = 'all', o: ConfusionModelOptions = {}) {
  const tokens = [...text.matchAll(TOKEN_RE)];
  const { resolved } = resolveTokens(
    text,
    tokens.map((t) => t.index),
    createConfusionModel(o),
    {
      wholeScriptFold: mode,
    },
  );
  let out = '';
  let cursor = 0;
  const words: (WordResolution & { word: string })[] = [];
  for (const [i, r] of [...resolved].sort((a, b) => a[0] - b[0])) {
    const t = tokens[i]!;
    out += text.slice(cursor, t.index) + r.normalized;
    cursor = t.index + t[0].length;
    words.push({ ...r, word: t[0] });
  }
  return { normalized: out + text.slice(cursor), words };
}

/** [text, normalized, word → `rule/class` of the resolved words] (§4.8, defaults). */
const ROWS: [string, string, string[]][] = [
  ['НОТ dog', 'HOT dog', ['window/confusable']],
  ['НОТ deal today', 'HOT deal today', ['window/confusable']],
  ['This is НОТ news', 'This is HOT news', ['neighbours/confusable']],
  ['Мы были в НОТ', 'Мы были в НОТ', []],
  ['НОТ', 'НОТ', []],
  // Decision 36e (ordering B): two requested alphabets, no whole-word resolution (40g: п~n).
  ['cоса', 'cоса', []],
  // Decision 41m: a sizable word majority only, else the request order.
  // Decision 36e (ordering B): two requested alphabets, no whole-word resolution (40g: п~n).
  ['TЕХ', 'TЕХ', []],
  // Decision 41m: a sizable word majority only, else the request order.
  // Decisions 41m, 41n: a sizable word majority only, else the request order.
  // Decision 36e (ordering B): two requested alphabets, no whole-word resolution (40g: п~n).
  ['Αрр', 'Αрр', []],
  // Decision 41m: a sizable word majority only, else the request order.
  // Decision 36e (ordering B): two requested alphabets, no whole-word resolution (40g: п~n).
  ['HОT', 'HОT', []],
  // Decision 41m: a sizable word majority only, else the request order.
  // Decision 36e (ordering B): two requested alphabets, no whole-word resolution (40g: п~n).
  ['НOТ', 'НOТ', []],
  // Decision 41m: a sizable word majority only, else the request order.
  // Decision 36e (ordering B): two requested alphabets, no whole-word resolution (40g: п~n).
  ['CОК', 'CОК', []],
  // Decision 41m: a sizable word majority only, else the request order.
  // Decision 36e (ordering B): two requested alphabets, no whole-word resolution (40g: п~n).
  ['COК', 'COК', []],
  // Decision 36e (ordering B): two requested alphabets, no whole-word resolution (40g: п~n).
  ['drink cоса now', 'drink cоса now', []],
  // Decisions 41m, 41n: a sizable word majority only, else the request order.
  // Decision 36e (ordering B): two requested alphabets, no whole-word resolution (40g: п~n).
  ['open the Αрр', 'open the Αрр', []],
  // Decision 36e (ordering B): two requested alphabets, no whole-word resolution (40g: п~n).
  ['Bank ассоunt verification', 'Bank ассоunt verification', []],
  // Decision 36e (ordering B): two requested alphabets, no whole-word resolution (40g: п~n).
  ['Wе landed at Orly.', 'Wе landed at Orly.', []],
  ['аррӏе.com', 'apple.com', ['window/confusable']],
  // Decision 41m: a sizable word majority only, else the request order.
  // Decision 36e (ordering B): two requested alphabets, no whole-word resolution (40g: п~n).
  ['ΑΡΡLE', 'ΑΡΡLE', []],
  // Decision 41m: a sizable word majority only, else the request order.
  // Decision 36e (ordering B): two requested alphabets, no whole-word resolution (40g: п~n).
  ['раураl', 'раураl', []],
  // Decision 36e (ordering B): two requested alphabets, no whole-word resolution (40g: п~n).
  ['иser', 'иser', []],
  // Decision 36e (ordering B): two requested alphabets, no whole-word resolution (40g: п~n).
  ['my иser name', 'my иser name', []],
  // Decision 41m: a sizable word majority only, else the request order.
  // Decision 36e (ordering B): two requested alphabets, no whole-word resolution (40g: п~n).
  ['кey', 'кey', []],
  // Decision 41m: a sizable word majority only, else the request order.
  // Decision 36e (ordering B): two requested alphabets, no whole-word resolution (40g: п~n).
  ['тap', 'тap', []],
  // Decision 36e (ordering B): two requested alphabets, no whole-word resolution (40g: п~n).
  ['тail admiп вank тime quіск Пpивеt', 'тail admiп вank тime quіск Пpивеt', []],
  ['paᏏy', 'paᏏy', ['no-valid-alphabet/mixed']],
  // Decision 36e (ordering B): two requested alphabets, no whole-word resolution (40g: п~n).
  ['ьank ъеst', 'ьank ъеst', []],
  // Decision 36e (ordering B): two requested alphabets, no whole-word resolution (40g: п~n).
  ['Пpивет', 'Пpивет', []],
  // Decision 36e (ordering B): two requested alphabets, no whole-word resolution (40g: п~n).
  ['Москвa', 'Москвa', []],
  // Decision 36e (ordering B): two requested alphabets, no whole-word resolution (40g: п~n).
  ['paypaІ', 'paypaІ', []],
  // Decision 41m: a sizable word majority only, else the request order.
  // Decision 36e (ordering B): two requested alphabets, no whole-word resolution (40g: п~n).
  ['шaг', 'шaг', []],
  // Decision 36e (ordering B): two requested alphabets, no whole-word resolution (40g: п~n).
  ['pаypal’ѕ', 'pаypal’ѕ', []],
  // Decision 36e (ordering B): two requested alphabets, no whole-word resolution (40g: п~n).
  ['Kαλημέρα', 'Kαλημέρα', []],
  ['ᴀᴅᴍɪɴ', 'admin', ['primary-target/confusable']],
  ['ɡoogle', 'google', ['word-majority/confusable']],
  ['pɑypal', 'paypal', ['word-majority/confusable']],
  // Decision 40d: European is not requested by default, so þ is a donor of p.
  ["İstanbul'da ışık þorn", "İstanbul'da ışık porn", ['window/confusable']],
  ['lınk pıng Lınkedin', 'link ping Linkedin', Array(3).fill('conditional-twin/confusable')],
  ['kışın ığdır Iğdır', 'kışın ığdır Iğdır', []],
  ["GitHub'а iPhone’ов", "GitHub'а iPhone’ов", []],
  // Decision 36e (ordering B): two requested alphabets, no whole-word resolution.
  ["форк на GіtHub'а", "форк на GіtHub'а", []],
  ['I bought сок today', 'I bought сок today', []],
  ['I bought сор today', 'I bought cop today', ['neighbours/confusable']],
  ['the рос here', 'the poc here', ['neighbours/confusable']],
  ['it is сухо here', 'it is cyxo here', ['neighbours/confusable']],
  ['eat уха soup', 'eat yxa soup', ['neighbours/confusable']],
  ['an оса flew', 'an oca flew', ['neighbours/confusable']],
  ['add сахар now', 'add caxap now', ['neighbours/confusable']],
  ['раураӏ', 'paypal', ['primary-target/confusable']],
  ['Зайди на раураӏ сегодня', 'Зайди на paypal сегодня', ['primary-target/confusable']],
  ['раураІ', 'paypal', ['primary-target/confusable']],
  ['paypaI', 'paypal', ['case-anomaly/confusable']],
  ['gmaiI', 'gmail', ['case-anomaly/confusable']],
  // Decision 40e: a broken language rule is no evidence; the word stays.
  ['Ьр', 'Ьр', []],
  ['маӏа Коммерсантъ', 'маӏа Коммерсантъ', []],
  ['Το iPhone είναι ακριβό', 'Το iPhone είναι ακριβό', []],
  ['g00gle app1e НОВ0СТИ', 'g00gle app1e НОВ0СТИ', []],
  ['СОСА-СОЛА', 'СОСА-СОЛА', []],
  // Decision 42b: no hyphen step; the window decides.
  ['СОСА-COLA', 'COCA-COLA', ['window/confusable']],
  ['Wi-Fi-роутер Docker-контейнер', 'Wi-Fi-роутер Docker-контейнер', []],
  // Decision 36e (ordering B): two requested alphabets, no whole-word resolution (40g: п~n).
  // Decision 36e (ordering B): two requested alphabets, no whole-word resolution (40g: п~n).
  [
    'χbox ҳbox Ҳbox paχos',
    'χbox xbox Xbox paχos',
    ['word-majority/confusable', 'word-majority/confusable'],
  ],
  // Decision 36e (ordering B): two requested alphabets, no whole-word resolution (40g: п~n).
  ['ŋame ɳo ηame', 'ŋame ɳo ηame', []],
  // Decision 40d: Tajik is not requested by default; several targets take it, no context: the primary (41e).
  ['ҳа', 'xa', ['primary-target/confusable']],
  // Decision 36e (ordering B): two requested alphabets, no whole-word resolution (40g: п~n).
  ['pay with раураl today', 'pay with раураl today', []],
  // Decision 41m: a sizable word majority only, else the request order.
  // Decision 36e (ordering B): two requested alphabets, no whole-word resolution (40g: п~n).
  ['мiр сiла', 'мiр сiла', []],
];

describe('§4.8 rows (defaults)', () => {
  it.each(ROWS)('%s', (text, normalized, words) => {
    const r = resolve(text);
    expect(r.normalized).toBe(normalized);
    expect(r.words.map((w) => `${w.rule}/${w.class}`)).toEqual(words);
  });

  it('decision 40d: a requested language keeps its letters (European þ, Tajik ҳ)', () => {
    expect(
      resolve("İstanbul'da ışık þorn", 'all', { targetLanguages: ['English', 'European'] })
        .normalized,
    ).toBe("İstanbul'da ışık þorn");
    expect(
      resolve('ҳа', 'all', { targetLanguages: ['Russian', 'Tajik', 'Greek'] }).normalized,
    ).toBe('ҳа');
  });

  it('records context, candidates and evidence', () => {
    // A mixed word of one requested alphabet and donors (36e ordering B leaves it to the ladder).
    const [w] = resolve('Bank ᴀccount verification').words;
    expect(w).toMatchObject({
      script: 'Latin',
      folded: true,
      wholeScript: false,
      language: 'English',
      context: { neighbours: ['English'], window: 'English' },
    });
    expect(resolve('аррӏе.com').words[0]!.evidence).toEqual({ kind: 'foreign', letters: 'ӏ' });
    expect(resolve('paᏏy').words[0]!.rejected).toEqual({ Cyrillic: 'softHardNotAfterVowel' });
  });

  it('36e: a Russian word with Latin i converts the one-letter piece toward Cyrillic', () => {
    const A = { hiddenChars: 'strict', confusionModel: 'alphabet' } as const;
    // Ukrainian і is the twin in a requested language of the larger alphabet.
    expect(analyze('мiр', A).normalized).toBe('мір');
    // With English and Russian no requested Cyrillic language has a twin of i: reported.
    expect(analyze('мiр', { ...A, targetLanguages: ['English', 'Russian'] }).normalized).toBe(
      'мiр',
    );
  });

  it('conditional twins switch rows on and off', () => {
    // `χbox` and `ηame` hold two requested alphabets (36e ordering B: no whole-word mapping);
    // the descender twins switch rows of one requested alphabet (`χbox` with English and Russian).
    const enRu = { targetLanguages: ['English', 'Russian'] as TargetLanguage[] };
    const none = { ...enRu, conditionalTwins: [] };
    expect(resolve('χbox', 'all', none).words.map((w) => w.class)).toEqual(['mixed']);
    expect(resolve('χbox', 'all', enRu).normalized).toBe('xbox');
    const n = { conditionalTwins: ['ŋ~n', 'ɳ~n', 'η~n'] as const };
    expect(
      resolve('ŋame ɳo', 'all', { conditionalTwins: [...n.conditionalTwins] }).normalized,
    ).toBe('name no');
    // `иser` holds two requested alphabets: 36e, not the ladder (the italic twin is no border twin by default).
    expect(resolve('иser', 'all', { conditionalTwins: ['и~u'] }).normalized).toBe('иser');
  });
});

describe('§4.3 wholeScriptFold modes', () => {
  // [text, off, foreign-letters, all]; "!" = flagged but left as written.
  const T: [string, string, string, string][] = [
    ['НОТ dog', 'НОТ dog', 'НОТ dog', 'HOT dog'],
    ['НОТ deal today', 'НОТ deal today', 'НОТ deal today', 'HOT deal today'],
    ['Мы были в НОТ', 'Мы были в НОТ', 'Мы были в НОТ', 'Мы были в НОТ'],
    ['I bought сор today', 'I bought сор today', 'I bought сор today', 'I bought cop today'],
    ['раураӏ', '!', 'paypal', 'paypal'],
    ['go to аррӏе.com', '!', 'go to apple.com', 'go to apple.com'],
    ['Зайди на раураӏ сегодня', '!', 'Зайди на paypal сегодня', 'Зайди на paypal сегодня'],
    ['раураІ', '!', 'paypal', 'paypal'],
    ['paypaI', '!', 'paypal', 'paypal'],
    [
      'Το iPhone είναι ακριβό',
      'Το iPhone είναι ακριβό',
      'Το iPhone είναι ακριβό',
      'Το iPhone είναι ακριβό',
    ],
  ];
  const modes: WholeScriptFold[] = ['off', 'foreign-letters', 'all'];
  it.each(T)('%s', (text, ...want) => {
    modes.forEach((mode, k) => {
      const r = resolve(text, mode);
      if (want[k] === '!') {
        expect(r.normalized, mode).toBe(text);
        expect(
          r.words.map((w) => [w.class, w.folded]),
          mode,
        ).toEqual([['confusable', false]]);
      } else {
        expect(r.normalized, mode).toBe(want[k]);
        expect(r.words.length > 0, mode).toBe(want[k] !== text);
      }
    });
  });
});

describe('property: one injected lookalike resolves back', () => {
  const RU =
    'привет москва конфигурация обработчик последующие интерфейс клиенты реализации миграцию версии проверка завершится ошибкой журналы хранятся политика требует изменений релиз поведение контейнер собирается публикуется репозиторием таймауты настраиваются секунд пользователь выгрузить данные настроек сборка машинах зависимостей результаты поиска сортируются релевантности очередь превышает сообщения отклоняются понятной комментарии пропускная способность задержки ошибок резервные копии восстановлением выборки разделе установить запустить тестов роутер перезагружается провайдером Москва Россия Сергей Ольга Екатеринбург';
  const EN =
    'hello world service reads configuration environment defaults worker pulls batch processes order acknowledges cache request noticeably longer public callers depend internal details migration deploying version schema check fails report changed position input rotated retention policy changelog release behaviour parser accepts apostrophes timeouts endpoint thirty seconds health marks unavailable probes export settings lockfile machines dependency search results ranked relevance queue messages rejected review comments dashboard throughput latency backups verified Paypal Google Amazon Microsoft Netflix';
  const GR =
    'καλημέρα ευχαριστώ θάλασσα ουρανός άνθρωπος βιβλίο σπίτι φίλος δουλειά ήλιος νερό αγάπη';
  const model = createConfusionModel();
  const ALPHA = ['Latin', 'Cyrillic', 'Greek'] as const;
  const isUpper = (c: string) => c !== c.toLowerCase();

  /** Letters of `w` without a twin in alphabet T (proof letters against T). */
  const hasProof = (w: string, T: (typeof ALPHA)[number]) =>
    [...w.normalize('NFD')].some((c) => /\p{L}/u.test(c) && !model.twinIn(c, T, isUpper(c), false));

  for (const [label, words, own] of [
    ['Russian', RU, 'Cyrillic'],
    ['English', EN, 'Latin'],
    ['Greek', GR, 'Greek'],
  ] as const)
    it(label, () => {
      let tried = 0;
      for (const w of words.split(' ')) {
        const cs = [...w];
        for (let i = 0; i < cs.length; i++)
          for (const T of ALPHA) {
            if (T === own) continue;
            const twin = model.twinIn(cs[i]!, T, isUpper(cs[i]!));
            if (!twin || cs.length < 3 || !hasProof(w, T)) continue;
            // Only unambiguous lookalikes: the twin folds back to this letter (Latin o ← ο or σ).
            if (model.twinIn(twin, own, isUpper(twin)) !== cs[i]) continue;
            const spoof = [...cs.slice(0, i), twin, ...cs.slice(i + 1)].join('');
            // Decision 36e: a one-letter twin piece that is not the last converts back toward
            // the word's larger alphabet, a spoof; the last one is reported, not converted.
            const r = analyze(spoof, { hiddenChars: 'strict', confusionModel: 'alphabet' });
            if (i < cs.length - 1) {
              expect(r.normalized, `${w} ← ${spoof}`).toBe(w);
              expect(r.words.map((x) => x.signals[0])).toEqual(['mixed_spoof']);
            } else {
              expect(r.normalized, `${w} ← ${spoof}`).toBe(spoof);
              expect(r.words.map((x) => x.signals[0])).toEqual(['mixed_non_legitimate']);
            }
            tried++;
          }
      }
      expect(tried).toBeGreaterThan(20);
    });
});

describe('resolveTokens reads majorityWindow (context-scales audit)', () => {
  it('the step-2 window is the option, not a constant', async () => {
    const { createConfusionModel } = await import('../src/confusion');
    const text = 'cat dog Кот сор';
    const toks = [...text.matchAll(/\S+/g)];
    const spans = toks.map((t) => t.index);
    const m = createConfusionModel();
    const wide = resolveTokens(text, spans, m, { majorityWindow: 10 }).resolved.get(3);
    const none = resolveTokens(text, spans, m, { majorityWindow: 0 }).resolved.get(3);
    expect(wide?.context.window).not.toBe(none?.context.window ?? 'x');
  });
});
