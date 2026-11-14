/**
 * Deterministic "realistic" benchmark input: mixed English/Russian Markdown
 * (headings, prose, lists, inline code, links, fenced code, tables) with the
 * inputs of a spoofing corpus (cases.json) sprinkled through it at a fixed
 * rate. Used by scripts/bench-analyze.mjs and test/performance.test.ts.
 *
 *   buildRealisticMarkdown({ targetBytes, seed, cases })
 *
 * `targetBytes` is UTF-8 bytes; generation stops at the first block that
 * reaches it. `cases` is an array of strings (corpus inputs); one is inserted
 * every `caseEvery` blocks (default 4).
 */

const EN = [
  'The service reads its configuration from the environment and falls back to defaults.',
  'Each worker pulls a batch of jobs, processes them in order, and acknowledges the batch.',
  'If the cache is cold, the first request takes noticeably longer than the following ones.',
  'We keep the public API small so that callers do not depend on internal details.',
  'Run the migration before deploying the new version, otherwise the schema check fails.',
  'The report lists every word that was changed, together with its position in the input.',
  'Logs are rotated daily and kept for two weeks unless the retention policy says otherwise.',
  "Don't forget to update the changelog when a release changes user-visible behaviour.",
  'The parser accepts both straight and typographic apostrophes in contractions like it’s.',
  'Timeouts are configurable per endpoint; the default is thirty seconds for every call.',
  'A failing health check marks the node as unavailable until three probes succeed again.',
  'Users can export their data as JSON or CSV from the account settings page.',
  'The build uses a lockfile, so two machines always resolve the same dependency tree.',
  'Search results are ranked by relevance first and by modification date second.',
  'When the queue grows beyond its limit, new messages are rejected with a clear error.',
  'Please review the pull request and leave comments on anything that looks unclear.',
  'The dashboard shows throughput, latency percentiles and the error rate per minute.',
  'Backups run every night at two and are verified by restoring a random sample.',
  'This section explains how to install the package and how to run the test suite.',
  'Most of the time is spent in tokenizing, so that is where the fast paths live.',
];

const RU = [
  'Сервис читает конфигурацию из переменных окружения и использует значения по умолчанию.',
  'Каждый обработчик забирает пачку задач, выполняет их по порядку и подтверждает пачку.',
  'Если кэш пустой, первый запрос выполняется заметно дольше, чем все последующие.',
  'Мы держим публичный интерфейс маленьким, чтобы клиенты не зависели от деталей реализации.',
  'Запустите миграцию до выкладки новой версии, иначе проверка схемы завершится ошибкой.',
  'Отчёт перечисляет все изменённые слова вместе с их позицией во входном тексте.',
  'Журналы ротируются ежедневно и хранятся две недели, если политика не требует иного.',
  'Не забудьте обновить журнал изменений, когда релиз меняет видимое поведение.',
  'Docker-контейнер собирается в CI, а образ публикуется в реестр после всех проверок.',
  'Форк на GitHub’е синхронизируется с основным репозиторием раз в сутки.',
  'Таймауты настраиваются для каждой точки входа; по умолчанию это тридцать секунд.',
  'Пользователь может выгрузить свои данные в JSON или CSV из настроек учётной записи.',
  'Сборка использует lock-файл, поэтому на двух машинах дерево зависимостей одинаковое.',
  'Результаты поиска сортируются сначала по релевантности, а затем по дате изменения.',
  'Когда очередь превышает лимит, новые сообщения отклоняются с понятной ошибкой.',
  'Пожалуйста, посмотрите пулл-реквест и оставьте комментарии ко всему непонятному.',
  'На панели видны пропускная способность, перцентили задержки и доля ошибок в минуту.',
  'Резервные копии создаются каждую ночь и проверяются восстановлением случайной выборки.',
  'В этом разделе описано, как установить пакет и как запустить набор тестов.',
  'Wi-Fi-роутер перезагружается автоматически, если пропадает связь с провайдером.',
];

const HEAD_EN = [
  'Overview',
  'Installation',
  'Configuration',
  'Usage',
  'Troubleshooting',
  'Changelog',
];
const HEAD_RU = ['Обзор', 'Установка', 'Настройка', 'Использование', 'Решение проблем', 'История'];
const CODE = [
  '```ts\nconst result = analyze(text, { expectedScripts: ["Cyrillic"] });\nif (result.spoofed) reject(result.words);\n```',
  '```sh\npnpm install && pnpm build && pnpm test\n```',
  '```json\n{ "retries": 3, "timeoutMs": 30000, "queue": "jobs" }\n```',
];

/** mulberry32: small deterministic PRNG. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildRealisticMarkdown({
  targetBytes = 1 << 20,
  seed = 1,
  cases = [],
  caseEvery = 4,
} = {}) {
  const r = rng(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const blocks = [];
  let bytes = 0;
  let k = 0;
  let c = 0;
  while (bytes < targetBytes) {
    const ru = r() < 0.5;
    const roll = r();
    let b;
    if (k % 12 === 0) b = `${'#'.repeat(1 + Math.floor(r() * 3))} ${pick(ru ? HEAD_RU : HEAD_EN)}`;
    else if (roll < 0.55) {
      const n = 2 + Math.floor(r() * 4);
      const s = [];
      for (let i = 0; i < n; i++) s.push(pick(r() < 0.85 ? (ru ? RU : EN) : ru ? EN : RU));
      b = s.join(' ');
    } else if (roll < 0.75) {
      const n = 2 + Math.floor(r() * 4);
      const s = [];
      for (let i = 0; i < n; i++)
        s.push(
          `- ${pick(ru ? RU : EN).replace(/\.$/, '')} (\`opt${i}\`, [docs](https://example.com/${ru ? 'ru' : 'en'}/${k}))`,
        );
      b = s.join('\n');
    } else if (roll < 0.85) b = pick(CODE);
    else b = `| key | value |\n|---|---|\n| ${pick(ru ? RU : EN).slice(0, 40)} | ${k} |`;
    if (cases.length && k % caseEvery === caseEvery - 1) b += ' ' + cases[c++ % cases.length];
    blocks.push(b);
    bytes += Buffer.byteLength(b, 'utf8') + 2;
    k += 1;
  }
  return blocks.join('\n\n');
}
