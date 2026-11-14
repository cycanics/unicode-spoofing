#!/usr/bin/env node
/**
 * Benchmark of `analyze` on two inputs:
 *   perf       the corpus of test/performance.test.ts (2 000 paragraphs, ~132 k chars)
 *   realistic  ~1 MB of mixed EN/RU Markdown with the cases.json inputs sprinkled in
 *              (scripts/realistic-text.mjs)
 *
 *   node --expose-gc scripts/bench-analyze.mjs [--impl=dist/index.js] [--opts='{"confusionModel":"alphabet"}']
 *        [--cases=path/to/cases.json] [--runs=9] [--json]
 *
 * Prints median ms, throughput (MB/s of UTF-8 input), heap growth during one
 * call (before GC) and heap retained by the result (after GC).
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildRealisticMarkdown } from './realistic-text.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const impl = resolve(arg('impl', join(__dirname, '..', 'dist', 'index.js')));
const opts = JSON.parse(arg('opts', '{}'));
const runs = Number(arg('runs', '9'));
const casesPath = arg('cases', join(__dirname, '..', 'test', 'fixtures', 'cases.json'));
const { analyze } = await import(pathToFileURL(impl).href);

const PERF_TEMPLATES = [
  'The quick brown fox jumps over the lazy dog near the riverbank.',
  'Contact support at help@example.com for any account questions today.',
  'Пришлите ваш раураl логин прямо сейчас — это срочно и важно!',
  'Free 𝐜𝐫𝐲𝐩𝐭𝐨 giveaway, click the l\u200Bink b\u200Below to c\u200Blaim now',
  'НОТ deals: buy ѕtock, get free ѕhipping on every оrder this week',
  'Z̸̢͇a̴̧͖l̷̪͝g̶̯͝o̶̪͝ text stress test with stacked combining marks here',
];
const perf = Array.from({ length: 2000 }, (_, i) => PERF_TEMPLATES[i % PERF_TEMPLATES.length]).join(
  '\n',
);
const cases = JSON.parse(readFileSync(casesPath, 'utf8')).map((c) => c.input);
const realistic = buildRealisticMarkdown({ targetBytes: 1 << 20, seed: 1, cases });

const gc = globalThis.gc ?? (() => {});
function bench(text) {
  const mb = Buffer.byteLength(text, 'utf8') / (1 << 20);
  analyze(text, opts);
  analyze(text, opts);
  const samples = [];
  for (let i = 0; i < runs; i++) {
    gc();
    const t = performance.now();
    analyze(text, opts);
    samples.push(performance.now() - t);
  }
  samples.sort((a, b) => a - b);
  const ms = samples[Math.floor(samples.length / 2)];
  gc();
  const h0 = process.memoryUsage().heapUsed;
  const res = analyze(text, opts);
  const h1 = process.memoryUsage().heapUsed;
  gc();
  const h2 = process.memoryUsage().heapUsed;
  return {
    chars: text.length,
    mb: +mb.toFixed(3),
    ms: +ms.toFixed(2),
    mbPerS: +(mb / (ms / 1000)).toFixed(2),
    heapGrowthMB: +((h1 - h0) / (1 << 20)).toFixed(1),
    retainedMB: +((h2 - h0) / (1 << 20)).toFixed(1),
    words: res.words.length,
  };
}
const out = { impl, opts, perf: bench(perf), realistic: bench(realistic) };
if (process.argv.includes('--json')) console.log(JSON.stringify(out));
else {
  console.log(`impl ${impl}  opts ${JSON.stringify(opts)}`);
  for (const k of ['perf', 'realistic'])
    console.log(
      `${k.padEnd(10)} ${String(out[k].chars).padStart(8)} chars ${out[k].mb} MB  ${out[k].ms} ms  ${out[k].mbPerS} MB/s  heap +${out[k].heapGrowthMB} MB (retained ${out[k].retainedMB} MB)  findings ${out[k].words}`,
    );
}
