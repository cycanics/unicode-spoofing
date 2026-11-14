#!/usr/bin/env node
/**
 * MEASUREMENT — digit vs letter glyph pairs, same method as the corpus study
 * (a private glyph-rendering script): render both glyphs at 64px in 8
 * fonts, count differing ink pixels. Writes docs/evidence/digit-pairs.{json,png}.
 *
 *   node scripts/measure-digit-pairs.mjs [path/to/playwright] [chrome]
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
const OUT = path.join(__dirname, '..', 'docs', 'evidence');

const P = (a, b) => ({ a, b, label: `${a} vs ${b}` });
const PAIRS = [
  P('0', 'O'),
  P('0', 'o'),
  P('0', 'О'),
  P('0', 'о'),
  P('0', 'Ο'),
  P('0', 'ο'),
  P('1', 'l'),
  P('1', 'I'),
  P('1', 'І'),
  P('1', 'ӏ'),
  P('1', 'Ӏ'),
  P('3', 'З'),
  P('3', 'з'),
  P('3', 'Ʒ'),
  P('3', 'ʒ'),
  P('3', 'Ӡ'),
  P('3', 'ӡ'),
  P('6', 'б'),
  P('4', 'Ч'),
  P('4', 'ч'),
  P('8', 'B'),
  P('8', 'В'),
  P('5', 'S'),
  P('5', 's'),
  P('2', 'Z'),
  P('9', 'g'),
  P('9', 'q'),
  P('7', 'T'),
  P('6', 'G'),
  P('6', 'b'),
];
const FONTS = [
  { key: 'Noto Sans', style: 'normal' },
  { key: 'DejaVu Sans', style: 'normal' },
  { key: 'Liberation Sans', style: 'normal' },
  { key: 'Liberation Serif', style: 'normal' },
  { key: 'Noto Serif', style: 'normal' },
  { key: 'DejaVu Sans Mono', style: 'normal' },
  { key: 'Noto Serif', style: 'italic' },
  { key: 'Liberation Serif', style: 'italic' },
];

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.setContent('<!doctype html><meta charset="utf-8"><body></body>');
  const res = await page.evaluate(
    async ({ PAIRS, FONTS }) => {
      const warm = document.createElement('div');
      for (const f of FONTS) {
        const s = document.createElement('span');
        s.style.font = `${f.style} 20px '${f.key}'`;
        s.textContent = PAIRS.map((p) => p.a + p.b).join('');
        warm.appendChild(s);
      }
      document.body.appendChild(warm);
      await document.fonts.ready;
      await new Promise((r) => setTimeout(r, 400));
      warm.remove();
      const cv = document.createElement('canvas');
      cv.width = 200;
      cv.height = 120;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      const draw = (s, f) => {
        ctx.clearRect(0, 0, 200, 120);
        ctx.font = `${f.style} 64px '${f.key}'`;
        ctx.fillText(s, 20, 90);
        return ctx.getImageData(0, 0, 200, 120).data;
      };
      const out = [];
      for (const p of PAIRS) {
        const row = { label: p.label, fonts: {} };
        for (const f of FONTS) {
          const x = draw(p.a, f);
          const y = draw(p.b, f);
          let diff = 0;
          let ink = 0;
          for (let i = 3; i < x.length; i += 4) {
            if (x[i] > 40 || y[i] > 40) ink++;
            if (Math.abs(x[i] - y[i]) > 40) diff++;
          }
          const ratio = ink ? diff / ink : 0;
          row.fonts[`${f.key}${f.style === 'italic' ? ' italic' : ''}`] = {
            ratio: +ratio.toFixed(3),
            verdict: diff === 0 ? 'identical' : ratio < 0.12 ? 'near' : 'distinguishable',
          };
        }
        out.push(row);
      }
      // In-word render: digit vs letter inside a word, for eyeballing.
      const words = [
        ['g00gle', 'google'],
        ['app1e', 'apple'],
        ['ЗАКАЗ', '3AKA3'],
        ['раб0та', 'работа'],
        ['6ыть', 'быть'],
        ['Ч0', 'ЧО'],
        ['8ank', 'Bank'],
        ['5ecure', 'Secure'],
        ['mi11ion', 'million'],
        ['l10n', 'a11y'],
      ];
      const t = document.createElement('table');
      t.style.borderCollapse = 'collapse';
      let h = '';
      for (const f of FONTS) {
        h += `<tr><td style="font:11px monospace;padding:2px 6px">${f.key}${f.style === 'italic' ? ' it' : ''}</td>`;
        for (const [a, b] of words)
          h += `<td style="font:${f.style} 22px '${f.key}';padding:2px 10px;border:1px solid #ccc">${a}<br>${b}</td>`;
        h += '</tr>';
      }
      t.innerHTML = h;
      t.id = 'g';
      document.body.style.background = '#fff';
      document.body.appendChild(t);
      return out;
    },
    { PAIRS, FONTS },
  );
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'digit-pairs.json'), JSON.stringify(res, null, 1));
  await (await page.$('#g')).screenshot({ path: path.join(OUT, 'digit-words.png') });
  await browser.close();
  for (const r of res)
    console.log(
      r.label.padEnd(8),
      Object.values(r.fonts)
        .map(
          (v) =>
            (v.verdict === 'identical' ? 'I' : v.verdict === 'near' ? 'n' : '.') +
            v.ratio.toFixed(2),
        )
        .join(' '),
    );
})();
