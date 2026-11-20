#!/usr/bin/env node
/**
 * Benchmark of the built library (`dist/index.js`): throughput, latency, memory and
 * scaling of `analyze` per mode, with and without callbacks. Run `npm run build` first.
 *
 *   node bench/bench.mjs [--json] [--quick]
 *   node bench/bench.mjs --slow        # only the known slow inputs (see below)
 *
 * Inputs
 *   mixed     English/Russian Markdown (prose, lists, links, code, tables) with one input of
 *             the spoofing corpus (test/fixtures/cases.json) added to every fourth block
 *             (scripts/realistic-text.mjs, seed 1), cut to 1 KB, 100 KB and 1 MB of UTF-8.
 *   english   English sentences, nothing else: clean ASCII prose.
 *   russian   Russian sentences, nothing else.
 *   refs      the mixed text with every eighth word written as HTML character references.
 *   escapes   the mixed text as a coloured terminal log: an SGR pair around every line, an
 *             OSC title string every tenth line.
 *   hebrew    Hebrew prose with a right-to-left mark after every tenth word and an English
 *             word in two of five sentences.
 *   hidden    the mixed text with a zero-width space inside every fifth word.
 *   arabic, thai, chinese, japanese   sentences in that language, nothing else (`--slow`).
 *
 * Method
 *   Time: warm-up calls, then `runs` timed calls in a row in one process (garbage
 *   collection runs when V8 schedules it and is part of the time); the median and the 95th
 *   percentile are reported. For the 1 KB input one sample is a batch of 200 calls divided
 *   by 200. Throughput is UTF-8 megabytes (2^20 bytes) of input per second at the median.
 *   Cold start: a new process per measurement; the time to import the library and the time
 *   of its first `analyze` call (median of 5 processes).
 *   Memory: a child process per measurement builds the input, then calls `analyze` three
 *   times; reported is the growth of its peak resident set size (`maxRSS`) over a child
 *   that only builds the input, and the JS heap the result holds after a GC.
 *   Cost factors: every input at 1 MB, without options and with strict + language (the
 *   escapes input also with the terminal rules, the Russian input also with English as
 *   the only requested language), and `cleanHidden` (the hidden-character pass alone).
 *   Known slow inputs (`--slow`): 1 MB of text whose letters belong to no requested
 *   language (Hebrew, Arabic, Thai, Chinese, Japanese with the default languages), of text
 *   in a language that was not requested (Russian with English requested, English with
 *   Russian requested), and the refs and escapes inputs, in the two language-model modes
 *   and without options; 3 warm-up calls, median of 7.
 *   Scaling: the mixed text at 250 KB, 1 MB, 4 MB and 16 MB and the Hebrew text at 250 KB,
 *   1 MB and 4 MB; nanoseconds per input byte.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus, loadavg, totalmem, release, platform, arch } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildRealisticMarkdown } from '../scripts/realistic-text.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const importStart = performance.now();
const { analyze, cleanHidden } = await import(pathToFileURL(join(root, 'dist', 'index.js')).href);
const importMs = performance.now() - importStart;

const KB = 1 << 10;
const MB = 1 << 20;
const quick = process.argv.includes('--quick');
const asJson = process.argv.includes('--json');

const MODES = {
  default: {},
  'lenient + language': { confusionModel: 'language' },
  strict: { hiddenChars: 'strict' },
  'strict + language': { hiddenChars: 'strict', confusionModel: 'language' },
  'strict + language + terminal': {
    hiddenChars: 'strict',
    confusionModel: 'language',
    hiddenCharRules: { terminal: {} },
  },
  'strict + language, Russian only': {
    hiddenChars: 'strict',
    confusionModel: 'language',
    targetLanguages: ['Russian'],
  },
  'lenient + language, English only': { confusionModel: 'language', targetLanguages: ['English'] },
  'lenient + language, Russian only': { confusionModel: 'language', targetLanguages: ['Russian'] },
  'strict + language, English only': {
    hiddenChars: 'strict',
    confusionModel: 'language',
    targetLanguages: ['English'],
  },
};
/** The modes of the throughput table. */
const MAIN_MODES = ['default', 'lenient + language', 'strict', 'strict + language'];

/** Every callback set, each doing the least a consumer does: count. */
function countingCallbacks() {
  const n = { reports: 0, cleanups: 0, records: 0, words: 0, lost: 0 };
  return {
    n,
    callbacks: {
      onReport: () => void n.reports++,
      onCleanup: () => void n.cleanups++,
      onRecord: () => void n.records++,
      onWord: () => void n.words++,
      onLostBound: () => void n.lost++,
    },
  };
}

// --- inputs -------------------------------------------------------------------------------

const cases = JSON.parse(readFileSync(join(root, 'test', 'fixtures', 'cases.json'), 'utf8')).map(
  (c) => c.input,
);

/** Cuts `text` to at most `bytes` UTF-8 bytes, at a code point boundary. */
function cut(text, bytes) {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= bytes) return text;
  let end = bytes;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--;
  return buf.subarray(0, end).toString('utf8');
}

const mixed = (bytes) => cut(buildRealisticMarkdown({ targetBytes: bytes, seed: 1, cases }), bytes);

const ENGLISH = [
  'The service reads its configuration from the environment and falls back to defaults.',
  'Each worker pulls a batch of jobs, processes them in order, and acknowledges the batch.',
  'If the cache is cold, the first request takes noticeably longer than the following ones.',
  'We keep the public API small so that callers do not depend on internal details.',
  'Run the migration before deploying the new version, otherwise the schema check fails.',
  'Search results are ranked by relevance first and by modification date second.',
  'Backups run every night at two and are verified by restoring a random sample.',
];
const RUSSIAN = [
  'Сервис читает конфигурацию из переменных окружения и использует значения по умолчанию.',
  'Каждый обработчик забирает пачку задач, выполняет их по порядку и подтверждает пачку.',
  'Если кэш пустой, первый запрос выполняется заметно дольше, чем все последующие.',
  'Запустите миграцию до выкладки новой версии, иначе проверка схемы завершится ошибкой.',
  'Результаты поиска сортируются сначала по релевантности, а затем по дате изменения.',
  'Резервные копии создаются каждую ночь и проверяются восстановлением случайной выборки.',
];
const ARABIC = [
  'تقرأ الخدمة إعداداتها من متغيرات البيئة وتستخدم القيم الافتراضية عند غيابها.',
  'يسحب كل عامل مجموعة من المهام ويعالجها بالترتيب ثم يؤكد المجموعة كلها.',
  'إذا كانت الذاكرة المؤقتة فارغة فإن الطلب الأول يستغرق وقتا أطول من الطلبات التالية.',
  'تعمل النسخ الاحتياطية كل ليلة ويتم التحقق منها باستعادة عينة عشوائية.',
];
const THAI = [
  'บริการอ่านการตั้งค่าจากตัวแปรสภาพแวดล้อม และใช้ค่าเริ่มต้นเมื่อไม่มีการกำหนด',
  'ผู้ปฏิบัติงานแต่ละตัวดึงงานเป็นชุด ประมวลผลตามลำดับ แล้วยืนยันทั้งชุด',
  'ถ้าแคชว่าง คำขอแรกจะใช้เวลานานกว่าคำขอถัดไปอย่างเห็นได้ชัด',
  'การสำรองข้อมูลทำงานทุกคืน และตรวจสอบโดยการกู้คืนตัวอย่างแบบสุ่ม',
];
const CHINESE = [
  '服务从环境变量读取配置，缺少时使用默认值。',
  '每个工作进程取出一批任务，按顺序处理，然后确认整批任务。',
  '如果缓存为空，第一个请求明显比后面的请求慢。',
  '备份每天夜里运行，并通过恢复随机样本进行验证。',
];
const JAPANESE = [
  'サービスは環境変数から設定を読み込み、ない場合は既定値を使います。',
  '各ワーカーはジョブをまとめて取り出し、順番に処理してから確認します。',
  'キャッシュが空の場合、最初のリクエストは後続のものより明らかに時間がかかります。',
  'バックアップは毎晩実行され、ランダムなサンプルを復元して検証されます。',
];
const HEBREW = [
  'השירות קורא את ההגדרות שלו ממשתני הסביבה ומשתמש בערכי ברירת המחדל כשהם חסרים.',
  'כל עובד מושך קבוצה של משימות, מעבד אותן לפי הסדר ומאשר את הקבוצה כולה.',
  'אם המטמון ריק, הבקשה הראשונה אורכת זמן רב יותר מהבקשות שבאות אחריה.',
  'הגיבויים רצים בכל לילה ונבדקים על ידי שחזור של דגימה אקראית מתוך Docker.',
  'תוצאות החיפוש מדורגות קודם לפי רלוונטיות ואחר כך לפי תאריך השינוי ב-GitHub.',
];

function repeatTo(sentences, bytes, sep = ' ') {
  const out = [];
  let n = 0;
  for (let i = 0; n < bytes; i++) {
    const s = sentences[i % sentences.length] + (i % 6 === 5 ? '\n\n' : sep);
    out.push(s);
    n += Buffer.byteLength(s, 'utf8');
  }
  return cut(out.join(''), bytes);
}

const asReference = (word) => [...word].map((ch) => `&#${ch.codePointAt(0)};`).join('');

function everyNthWord(text, n, f) {
  let k = 0;
  return text.replace(/[\p{L}]{4,}/gu, (w) => (++k % n === 0 ? f(w) : w));
}

const INPUTS = {
  mixed,
  english: (bytes) => repeatTo(ENGLISH, bytes),
  russian: (bytes) => repeatTo(RUSSIAN, bytes),
  refs: (bytes) => cut(everyNthWord(mixed(bytes), 8, asReference), bytes),
  escapes: (bytes) =>
    cut(
      mixed(bytes)
        .split('\n')
        .map(
          (line, i) =>
            (i % 10 === 0 ? `\u001b]0;job ${i}\u0007` : '') +
            `\u001b[${31 + (i % 6)}m${line}\u001b[0m`,
        )
        .join('\n'),
      bytes,
    ),
  arabic: (bytes) => repeatTo(ARABIC, bytes),
  thai: (bytes) => repeatTo(THAI, bytes),
  chinese: (bytes) => repeatTo(CHINESE, bytes),
  japanese: (bytes) => repeatTo(JAPANESE, bytes),
  hebrew: (bytes) => {
    let k = 0;
    return cut(
      repeatTo(HEBREW, bytes).replace(/ /g, (sp) => (++k % 10 === 0 ? '\u200F ' : sp)),
      bytes,
    );
  },
  hidden: (bytes) =>
    cut(
      everyNthWord(mixed(bytes), 5, (w) => `${w.slice(0, 2)}\u200B${w.slice(2)}`),
      bytes,
    ),
};

// --- child mode: one memory measurement -----------------------------------------------------

if (process.argv[2] === '--child') {
  const [, , , input, bytes, mode, withCallbacks] = process.argv;
  const text = INPUTS[input](Number(bytes));
  let retained = 0;
  if (withCallbacks === 'cold') {
    const t = performance.now();
    analyze(text, MODES[mode]);
    console.log(JSON.stringify({ importMs, firstCallMs: performance.now() - t }));
    process.exit(0);
  }
  if (mode !== 'none') {
    const run = () =>
      analyze(text, MODES[mode], withCallbacks === '1' ? countingCallbacks().callbacks : {});
    run();
    run();
    globalThis.gc();
    const h0 = process.memoryUsage().heapUsed;
    const result = run();
    globalThis.gc();
    retained = process.memoryUsage().heapUsed - h0;
    if (!result.normalized) throw new Error('no result');
  }
  console.log(JSON.stringify({ maxRSS: process.resourceUsage().maxRSS * 1024, retained }));
  process.exit(0);
}

// --- timing ---------------------------------------------------------------------------------

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

function time(text, options, withCallbacks, { runs, batch = 1, warm }) {
  const call = () =>
    analyze(text, options, withCallbacks ? countingCallbacks().callbacks : undefined);
  for (let i = 0; i < warm * batch; i++) call();
  const samples = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    for (let j = 0; j < batch; j++) call();
    samples.push((performance.now() - t) / batch);
  }
  samples.sort((a, b) => a - b);
  const bytes = Buffer.byteLength(text, 'utf8');
  const median = pct(samples, 0.5);
  return {
    bytes,
    medianMs: median,
    p95Ms: pct(samples, 0.95),
    mbPerS: bytes / MB / (median / 1000),
    nsPerByte: (median * 1e6) / bytes,
  };
}

const plan = (bytes) =>
  bytes <= 4 * KB
    ? { runs: quick ? 10 : 30, batch: 200, warm: 10 }
    : bytes <= 256 * KB
      ? { runs: quick ? 10 : 30, warm: 30 }
      : bytes <= 2 * MB
        ? { runs: quick ? 5 : 15, warm: 5 }
        : { runs: quick ? 3 : 5, warm: 2 };

const child = (input, bytes, mode, flag) =>
  JSON.parse(
    execFileSync(
      process.execPath,
      ['--expose-gc', fileURLToPath(import.meta.url), '--child', input, String(bytes), mode, flag],
      { encoding: 'utf8', timeout: 120_000 },
    ),
  );

function memory(input, bytes, mode, withCallbacks) {
  const base = child(input, bytes, 'none', '0');
  const run = child(input, bytes, mode, withCallbacks ? '1' : '0');
  return { peakRssGrowth: run.maxRSS - base.maxRSS, retained: run.retained };
}

function cold(bytes, mode) {
  const runs = Array.from({ length: 5 }, () => child('mixed', bytes, mode, 'cold'));
  const median = (key) => runs.map((r) => r[key]).sort((a, b) => a - b)[2];
  return { importMs: median('importMs'), firstCallMs: median('firstCallMs') };
}

// --- run ------------------------------------------------------------------------------------

const machine = {
  cpu: cpus()[0].model,
  logicalCpus: cpus().length,
  memoryGB: +(totalmem() / 2 ** 30).toFixed(1),
  os: `${platform()} ${release()} ${arch}`,
  node: process.version,
  v8: process.versions.v8,
  loadAverageBefore: loadavg().map((x) => +x.toFixed(2)),
};

const sizes = [
  ['1 KB', KB],
  ['100 KB', 100 * KB],
  ['1 MB', MB],
];
const report = { machine, throughput: [], cold: [], factors: [], scaling: [], memory: [] };

if (process.argv.includes('--slow')) {
  const rows = [];
  const cases = [
    ...['hebrew', 'arabic', 'thai', 'chinese', 'japanese', 'refs', 'escapes'].map((input) => [
      input,
      ['default', 'lenient + language', 'strict + language'],
    ]),
    ['russian', ['default', 'lenient + language, English only', 'strict + language, English only']],
    ['english', ['default', 'lenient + language, Russian only', 'strict + language, Russian only']],
  ];
  for (const [input, modes] of cases) {
    const text = INPUTS[input](MB);
    for (const mode of modes)
      rows.push({ input, mode, ...time(text, MODES[mode], false, { runs: 7, warm: 3 }) });
  }
  machine.loadAverageAfter = loadavg().map((x) => +x.toFixed(2));
  if (asJson) console.log(JSON.stringify({ machine, slow: rows }, null, 2));
  else {
    for (const [k, v] of Object.entries(machine)) console.log(`- ${k}: ${JSON.stringify(v)}`);
    console.log('\n| input | mode | median | MB/s |\n| --- | --- | --- | --- |');
    for (const r of rows)
      console.log(
        `| ${r.input} | ${r.mode} | ${r.medianMs.toFixed(0)} ms | ${r.mbPerS.toFixed(1)} |`,
      );
  }
  process.exit(0);
}

for (const modeName of MAIN_MODES) {
  const options = MODES[modeName];
  for (const [sizeName, bytes] of sizes) {
    const text = INPUTS.mixed(bytes);
    for (const withCallbacks of [false, true])
      report.throughput.push({
        mode: modeName,
        size: sizeName,
        callbacks: withCallbacks,
        ...time(text, options, withCallbacks, plan(bytes)),
      });
  }
}

for (const modeName of ['default', 'strict + language'])
  for (const [sizeName, bytes] of sizes)
    report.cold.push({ mode: modeName, size: sizeName, ...cold(bytes, modeName) });

const factorPlan = { runs: quick ? 5 : 11, warm: 3 };
for (const input of Object.keys(INPUTS)) {
  const text = INPUTS[input](MB);
  const modes = ['default', 'strict + language'];
  if (input === 'escapes') modes.push('strict + language + terminal');
  if (input === 'russian') modes.push('strict + language, English only');
  for (const modeName of modes)
    report.factors.push({
      input,
      mode: modeName,
      ...time(text, MODES[modeName], false, factorPlan),
    });
  // The hidden-character pass alone: `cleanHidden` with the strict rules.
  for (let i = 0; i < 3; i++) cleanHidden(text);
  const samples = [];
  for (let i = 0; i < factorPlan.runs; i++) {
    const t = performance.now();
    cleanHidden(text);
    samples.push(performance.now() - t);
  }
  samples.sort((a, b) => a - b);
  const bytes = Buffer.byteLength(text, 'utf8');
  const medianMs = pct(samples, 0.5);
  report.factors.push({
    input,
    mode: 'cleanHidden',
    bytes,
    medianMs,
    p95Ms: pct(samples, 0.95),
    mbPerS: bytes / MB / (medianMs / 1000),
    nsPerByte: (medianMs * 1e6) / bytes,
  });
}

for (const [input, modeName, sizesOf] of [
  ['mixed', 'default', [250 * KB, MB, 4 * MB, 16 * MB]],
  ['mixed', 'strict + language', [250 * KB, MB, 4 * MB, 16 * MB]],
  ['hebrew', 'strict + language', [250 * KB, MB, 4 * MB]],
])
  for (const bytes of quick ? sizesOf.slice(0, 2) : sizesOf)
    report.scaling.push({
      input,
      mode: modeName,
      ...time(INPUTS[input](bytes), MODES[modeName], false, plan(bytes)),
    });

for (const bytes of quick ? [MB] : [MB, 16 * MB])
  for (const modeName of ['default', 'strict + language'])
    for (const withCallbacks of modeName === 'default' ? [false] : [false, true])
      report.memory.push({
        mode: modeName,
        bytes,
        callbacks: withCallbacks,
        ...memory('mixed', bytes, modeName, withCallbacks),
      });

machine.loadAverageAfter = loadavg().map((x) => +x.toFixed(2));

// --- output ---------------------------------------------------------------------------------

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const f = (x, d = 2) => x.toFixed(d);
  const size = (b) => (b >= 0.99 * MB ? `${Math.round(b / MB)} MB` : `${Math.round(b / KB)} KB`);
  const row = (cells) => `| ${cells.join(' | ')} |`;
  const table = (head, rows) =>
    [row(head), row(head.map(() => '---')), ...rows.map(row)].join('\n') + '\n';
  const ms = (x) => (x < 1 ? `${f(x * 1000, 0)} µs` : `${f(x, x < 10 ? 2 : 1)} ms`);

  console.log('## Machine\n');
  for (const [k, v] of Object.entries(machine)) console.log(`- ${k}: ${JSON.stringify(v)}`);

  console.log('\n## Throughput and latency (mixed text)\n');
  console.log(
    table(
      ['mode', 'callbacks', 'size', 'median', 'p95', 'MB/s'],
      report.throughput.map((r) => [
        r.mode,
        r.callbacks ? 'yes' : 'no',
        r.size,
        ms(r.medianMs),
        ms(r.p95Ms),
        f(r.mbPerS, 1),
      ]),
    ),
  );

  console.log('## Cold start (mixed text, new process)\n');
  console.log(
    table(
      ['mode', 'size', 'import', 'first call'],
      report.cold.map((r) => [r.mode, r.size, ms(r.importMs), ms(r.firstCallMs)]),
    ),
  );

  console.log('## Cost factors (1 MB, no callbacks)\n');
  console.log(
    table(
      ['input', 'mode', 'median', 'MB/s'],
      report.factors.map((r) => [r.input, r.mode, ms(r.medianMs), f(r.mbPerS, 1)]),
    ),
  );

  console.log('## Scaling (no callbacks)\n');
  console.log(
    table(
      ['input', 'mode', 'size', 'median', 'MB/s', 'ns per byte'],
      report.scaling.map((r) => [
        r.input,
        r.mode,
        size(r.bytes),
        ms(r.medianMs),
        f(r.mbPerS, 1),
        f(r.nsPerByte, 0),
      ]),
    ),
  );

  console.log('## Memory (mixed text)\n');
  console.log(
    table(
      ['mode', 'callbacks', 'size', 'peak RSS growth', 'heap held by the result'],
      report.memory.map((r) => [
        r.mode,
        r.callbacks ? 'yes' : 'no',
        size(r.bytes),
        `${f(r.peakRssGrowth / MB, 1)} MB`,
        `${f(r.retained / MB, 1)} MB`,
      ]),
    ),
  );
}
