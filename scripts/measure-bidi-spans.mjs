#!/usr/bin/env node
/**
 * MEASUREMENT — what Chrome shows for bidi samples: the left-to-right visual
 * order of their code points, as written and with the bidi controls stripped,
 * in an LTR and an RTL paragraph. Writes docs/evidence/bidi-spans.json;
 * test/hidden-content.test.ts holds the `bidi-override` definition against it.
 *
 *   node scripts/measure-bidi-spans.mjs [path/to/playwright] [chrome]
 */
/* global document */
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PW = process.argv[2] ?? '/home/user/.nvm/versions/node/v20.19.5/lib/node_modules/playwright';
const CHROME = process.argv[3] ?? '/usr/bin/google-chrome';
const { chromium } = require(PW);
const OUT = path.join(__dirname, '..', 'docs', 'evidence', 'bidi-spans.json');

const SAMPLES = {
  // Overrides against the text's direction.
  rlo_latin: '‮gnp.exe‬',
  rlo_unterminated: 'invoice‮gnp.exe',
  rlo_digits: '$‮001‬',
  rlo_two_words: '‮a b‬',
  rlo_punct: '‮!?‬',
  rlo_emoji: '‮😀😈‬',
  rlo_he_latin: '‮שלום world‬',
  rlo_he_digits: '‮מחיר 100‬',
  rlo_ar_digits: '‮السعر ١٠٠‬',
  rlo_ar_latin: '‮مرحبا world‬',
  lro_hebrew: '‭שלום עולם‬',
  lro_arabic: '‭مرحبا بالعالم‬',
  lro_he_in_latin: 'abc ‭שלום‬ def',
  trojan: 'if (x != "user‮ ⁦// admin⁩ ⁦") {',
  // Overrides that agree with the text, or have nothing to reorder.
  rlo_hebrew: '‮שלום עולם‬',
  rlo_he_punct: '‮שלום, עולם!‬',
  rlo_arabic: '‮مرحبا بالعالم‬',
  rlo_ar_marks: '‮مَرْحَبًا‬',
  rlo_persian_zwnj: '‮می‌خواهم‬',
  rlo_he_one_latin: '‮שלום a עולם‬',
  rlo_he_one_digit: '‮מחיר 5‬',
  rlo_one: '‮a‬',
  rlo_nested_lro: '‮السعر ‭100‬ ريال‬',
  rlo_rle_reset: '‮‫abc‬‬',
  lro_latin: '‭hello world‬',
  lro_number: '‭+972-50-1234567‬',
  lro_number_in_he: 'טלפון ‭+972-50-1234567‬ היום',
  lro_date_in_ar: 'التاريخ ‭12/05/2024‬ اليوم',
  lro_one_r: '‭abc א def‬',
  // Embeddings.
  rle_latin: '‫abc def‬',
  rle_hebrew: '‫שלום עולם‬',
  rle_arabic: '‫مرحبا بالعالم‬',
  rle_he_mixed: '‫שלום world עולם‬',
  rle_ar_mixed: '‫نص English نص‬',
  rle_he_digits: '‫מחיר 100‬',
  rle_latin_punct: '‫hello!‬',
  lre_hebrew: '‪שלום עולם‬',
  lre_mixed: '‪abc שלום def‬',
  lre_number_in_ar: 'السعر ‪100‬ ريال',
  // Marks and isolates.
  rle_rlm: '‫abc‏ def‬',
  rle_alm: '‫abc؜ def‬',
  rle_rlm_three: '‫one‏ two‏ three‬',
  rli_rlm: '⁧abc‏ def⁩',
  fsi_rlm_first: '⁨‏abc‏ def⁩',
  fsi_latin_first: '⁨abc‏ def⁩',
  rli_latin: '⁧abc def⁩',
  rlm_only: 'abc‏ def',
  rli_hebrew: 'abc ⁧שלום⁩ def',
  rli_he_mixed: 'hello ⁧שלום world⁩ end',
  rlm_in_hebrew: 'שלום‏ עולם',
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
await page.setContent('<div id=h style="font:20px DejaVu Sans;white-space:pre"></div>');
const results = await page.evaluate((samples) => {
  const h = document.getElementById('h');
  const visual = (t, dir) => {
    h.dir = dir;
    h.textContent = '';
    const n = document.createTextNode(t);
    h.append(n);
    const out = [];
    let i = 0;
    for (const c of t) {
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + c.length);
      const q = r.getBoundingClientRect();
      if (q.width > 0.01 && c.trim()) out.push([q.left, c]);
      i += c.length;
    }
    out.sort((a, b) => a[0] - b[0]);
    return out.map((x) => x[1]).join('');
  };
  const strip = (t) => t.replace(/[‪-‮⁦-⁩‎‏؜]/g, '');
  return Object.entries(samples).map(([name, input]) => {
    const natural = strip(input);
    const firstStrong = /[\p{L}]/u.exec(natural)?.[0] ?? 'a';
    const dir = /[֐-ࣿ]/.test(firstStrong) ? 'rtl' : 'ltr';
    return {
      name,
      input,
      /** The paragraph direction of the text itself (UAX #9 P2–P3). */
      dir,
      shown: visual(input, dir),
      natural: visual(natural, dir),
      sameInLtr: visual(input, 'ltr') === visual(natural, 'ltr'),
      sameInRtl: visual(input, 'rtl') === visual(natural, 'rtl'),
    };
  });
}, SAMPLES);
await browser.close();

const escaped = JSON.stringify(results, null, 2).replace(
  /[؜‌-‏‪-‮⁦-⁩]/g,
  (c) => `\\u${c.codePointAt(0).toString(16).padStart(4, '0')}`,
);
fs.writeFileSync(OUT, `${escaped}\n`);
console.log(`${results.length} samples → ${OUT}`);
