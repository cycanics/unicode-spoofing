/**
 * The resolver (src/resolve.ts): the rows of docs/confusion-model.md §4.7,
 * the wholeScriptFold mode table of §4.3, and a property test — a real word
 * with one injected lookalike resolves back to itself when it holds a proof
 * letter against the lookalike's alphabet and the lookalike folds back to
 * the letter it replaced.
 */
import { describe, expect, it } from 'vitest';
import { createConfusionModel, type ConfusionModelOptions } from '../src/confusion';
import { resolveTokens, type WholeScriptFold, type WordResolution } from '../src/resolve';

const TOKEN_RE = /[\p{L}\p{M}\p{N}\p{Cf}'’]+/gu;

function resolve(text: string, mode: WholeScriptFold = 'all', o: ConfusionModelOptions = {}) {
  const tokens = [...text.matchAll(TOKEN_RE)];
  const { resolved } = resolveTokens(
    text,
    { starts: tokens.map((t) => t.index), ends: tokens.map((t) => t.index + t[0].length) },
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

/** [text, normalized, word → `rule/class` of the resolved words] (§4.7, defaults). */
const ROWS: [string, string, string[]][] = [
  ['НОТ dog', 'HOT dog', ['window/confusable']],
  ['НОТ deal today', 'HOT deal today', ['window/confusable']],
  ['This is НОТ news', 'This is HOT news', ['neighbours/confusable']],
  ['Мы были в НОТ', 'Мы были в НОТ', []],
  ['НОТ', 'НОТ', []],
  ['cоса', 'соса', ['word-majority/confusable']],
  ['TЕХ', 'ТЕХ', ['word-majority/confusable']],
  ['Αрр', 'Арр', ['word-majority/confusable']],
  ['HОT', 'HOT', ['word-majority/confusable']],
  ['НOТ', 'НОТ', ['word-majority/confusable']],
  ['CОК', 'СОК', ['word-majority/confusable']],
  ['COК', 'COK', ['word-majority/confusable']],
  ['drink cоса now', 'drink coca now', ['neighbours/confusable']],
  ['open the Αрр', 'open the App', ['window/confusable']],
  ['Bank ассоunt verification', 'Bank account verification', ['neighbours/confusable']],
  ['Wе landed at Orly.', 'We landed at Orly.', ['window/confusable']],
  ['аррӏе.com', 'apple.com', ['window/confusable']],
  ['ΑΡΡLE', 'APPLE', ['word-majority/confusable']],
  ['раураl', 'paypal', ['word-majority/confusable']],
  ['иser', 'иser', ['no-valid-alphabet/mixed']],
  ['my иser name', 'my иser name', ['no-valid-alphabet/mixed']],
  ['кey', 'кеу', ['word-majority/confusable']],
  ['тap', 'тар', ['word-majority/confusable']],
  [
    'тail admiп вank тime quіск Пpивеt',
    'тail admiп вank тime quіск Пpивеt',
    Array(6).fill('no-valid-alphabet/mixed'),
  ],
  ['paᏏy', 'paᏏy', ['no-valid-alphabet/mixed']],
  ['ьank ъеst', 'ьank ъеst', ['no-valid-alphabet/mixed', 'no-valid-alphabet/mixed']],
  ['Пpивет', 'Привет', ['word-majority/confusable']],
  ['Москвa', 'Москва', ['word-majority/confusable']],
  ['paypaІ', 'paypal', ['word-majority/confusable']],
  ['шaг', 'шаг', ['word-majority/confusable']],
  ['pаypal’ѕ', 'paypal’s', ['word-majority/confusable']],
  ['Kαλημέρα', 'Καλημέρα', ['word-majority/confusable']],
  ['ᴀᴅᴍɪɴ', 'admin', ['any-valid/confusable']],
  ['ɡoogle', 'google', ['word-majority/confusable']],
  ['pɑypal', 'paypal', ['word-majority/confusable']],
  ["İstanbul'da ışık þorn", "İstanbul'da ışık þorn", []],
  ['lınk pıng Lınkedin', 'link ping Linkedin', Array(3).fill('conditional-twin/confusable')],
  ['kışın ığdır Iğdır', 'kışın ığdır Iğdır', []],
  ["GitHub'а iPhone’ов", "GitHub'а iPhone’ов", []],
  ["форк на GіtHub'а", "форк на GitHub'а", ['word-majority/confusable']],
  ['I bought сок today', 'I bought сок today', []],
  ['I bought сор today', 'I bought cop today', ['neighbours/confusable']],
  ['the рос here', 'the poc here', ['neighbours/confusable']],
  ['it is сухо here', 'it is cyxo here', ['neighbours/confusable']],
  ['eat уха soup', 'eat yxa soup', ['neighbours/confusable']],
  ['an оса flew', 'an oca flew', ['neighbours/confusable']],
  ['add сахар now', 'add caxap now', ['neighbours/confusable']],
  ['раураӏ', 'paypal', ['any-valid/confusable']],
  ['Зайди на раураӏ сегодня', 'Зайди на paypal сегодня', ['any-valid/confusable']],
  ['раураІ', 'paypal', ['any-valid/confusable']],
  ['paypaI', 'paypal', ['case-anomaly/confusable']],
  ['gmaiI', 'gmail', ['case-anomaly/confusable']],
  ['Ьр', 'bp', ['any-valid/confusable']],
  ['маӏа Коммерсантъ', 'маӏа Коммерсантъ', []],
  ['Το iPhone είναι ακριβό', 'Το iPhone είναι ακριβό', []],
  ['g00gle app1e НОВ0СТИ', 'g00gle app1e НОВ0СТИ', []],
  ['СОСА-СОЛА', 'СОСА-СОЛА', []],
  ['СОСА-COLA', 'COCA-COLA', ['hyphen/confusable']],
  ['Wi-Fi-роутер Docker-контейнер', 'Wi-Fi-роутер Docker-контейнер', []],
  ['χbox ҳbox Ҳbox paχos', 'xbox xbox Xbox paxos', Array(4).fill('word-majority/confusable')],
  ['ŋame ɳo ηame', 'ŋame ɳo ηame', ['no-valid-alphabet/mixed']],
  ['ҳа', 'ҳа', []],
  ['pay with раураl today', 'pay with paypal today', ['neighbours/confusable']],
  ['мiр сiла', 'мір сіла', ['word-majority/confusable', 'word-majority/confusable']],
];

describe('§4.7 rows (defaults)', () => {
  it.each(ROWS)('%s', (text, normalized, words) => {
    const r = resolve(text);
    expect(r.normalized).toBe(normalized);
    expect(r.words.map((w) => `${w.rule}/${w.class}`)).toEqual(words);
  });

  it('records context, candidates and evidence', () => {
    const [w] = resolve('Bank ассоunt verification').words;
    expect(w).toMatchObject({
      script: 'Latin',
      folded: true,
      wholeScript: false,
      context: { neighbours: 'Latin', window: 'Latin' },
      candidates: ['Latin'],
    });
    expect(resolve('аррӏе.com').words[0]!.evidence).toEqual({ kind: 'foreign', letters: 'ӏ' });
    expect(resolve('paᏏy').words[0]!.rejected).toEqual({ Cyrillic: 'softHardNotAfterVowel' });
  });

  it('owner: a Russian word with Latin i folds to Ukrainian і (no Russian letter looks like i)', () => {
    expect(resolve('мiр').normalized).toBe('мір');
    expect(resolve('мiр', 'all', { targetLanguages: ['English', 'Russian'] }).normalized).toBe(
      'мiр',
    );
  });

  it('conditional twins switch rows on and off', () => {
    const none = { conditionalTwins: [] };
    expect(resolve('χbox ҳbox', 'all', none).words.map((w) => w.class)).toEqual(['mixed', 'mixed']);
    const n = { conditionalTwins: ['ŋ~n', 'ɳ~n', 'η~n'] as const };
    expect(
      resolve('ŋame ɳo ηame', 'all', { conditionalTwins: [...n.conditionalTwins] }).normalized,
    ).toBe('name no name');
    expect(resolve('иser', 'all', { conditionalTwins: ['и~u'] }).normalized).toBe('user');
    expect(resolve('lınk', 'all', { conditionalTwins: ['χ~x'] }).normalized).toBe('lınk');
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
            const r = resolve(spoof);
            expect(r.normalized, `${w} ← ${spoof}`).toBe(w);
            expect(r.words.map((x) => x.class)).toEqual(['confusable']);
            tried++;
          }
      }
      expect(tried).toBeGreaterThan(20);
    });
});
