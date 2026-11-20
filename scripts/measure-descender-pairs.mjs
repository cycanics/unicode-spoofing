#!/usr/bin/env node
/**
 * MEASUREMENT — descender twins (docs/confusion-model.md §3.3): letters that
 * differ from their twin only below the baseline. Each pair is rendered at
 * 64px in the 8 corpus fonts twice: whole glyph, and clipped at the baseline
 * (ink below the baseline erased). Writes docs/evidence/descender-pairs.json
 * and docs/evidence/descender-pairs.png.
 *
 *   node scripts/measure-descender-pairs.mjs [path/to/playwright] [chrome]   (or PLAYWRIGHT_PATH)
 */
/* global document */
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PW = process.argv[2] ?? process.env.PLAYWRIGHT_PATH ?? 'playwright';
const CHROME = process.argv[3] ?? '/usr/bin/google-chrome';
const { chromium } = (() => {
  try {
    return require(PW);
  } catch {
    console.error(
      `playwright not found (${PW}): pass its path as the first argument or set PLAYWRIGHT_PATH`,
    );
    process.exit(1);
  }
})();
const OUT = path.join(__dirname, '..', 'docs', 'evidence');

// [candidate, twin, group]
export const PAIRS = [
  ['χ', 'x', 'x-like'],
  ['ҳ', 'x', 'x-like'],
  ['ҳ', 'х', 'x-like'],
  ['χ', 'х', 'x-like'],
  ['χ', 'ҳ', 'x-like'],
  ['Ҳ', 'X', 'x-like'],
  ['Ҳ', 'Х', 'x-like'],
  ['η', 'n', 'maybe'],
  ['ŋ', 'n', 'maybe'],
  ['ɳ', 'n', 'maybe'],
  ['μ', 'u', 'candidate'],
  ['ς', 'c', 'candidate'],
  ['ц', 'u', 'candidate'],
  ['щ', 'w', 'candidate'],
  ['ҫ', 'c', 'candidate'],
  ['ç', 'c', 'candidate'],
  ['Ц', 'U', 'candidate'],
  ['Щ', 'W', 'candidate'],
  ['Ҫ', 'C', 'candidate'],
  ['Ç', 'C', 'candidate'],
  ['ң', 'н', 'other'],
  ['қ', 'к', 'other'],
  ['ҷ', 'ч', 'other'],
  ['ҙ', 'з', 'other'],
  ['ҫ', 'с', 'other'],
  ['ɖ', 'd', 'other'],
  ['ɭ', 'l', 'other'],
  ['ʈ', 't', 'other'],
  ['ɽ', 'r', 'other'],
  ['ʂ', 's', 'other'],
  ['ʐ', 'z', 'other'],
  ['ц', 'и', 'other'],
  ['щ', 'ш', 'other'],
  ['Ц', 'И', 'other'],
  ['Щ', 'Ш', 'other'],
  ['д', 'л', 'other'],
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

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 1400 } });
await page.setContent('<!doctype html><meta charset="utf-8"><body style="background:#fff"></body>');
const res = await page.evaluate(
  async ({ PAIRS, FONTS }) => {
    const warm = document.createElement('div');
    for (const f of FONTS) {
      const s = document.createElement('span');
      s.style.font = `${f.style} 20px '${f.key}'`;
      s.textContent = PAIRS.map((p) => p[0] + p[1]).join('');
      warm.appendChild(s);
    }
    document.body.appendChild(warm);
    await document.fonts.ready;
    await new Promise((r) => setTimeout(r, 400));
    warm.remove();
    const cv = document.createElement('canvas');
    cv.width = 200;
    cv.height = 130;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const BASE = 90;
    const draw = (s, f, clip) => {
      ctx.clearRect(0, 0, 200, 130);
      ctx.save();
      if (clip) {
        ctx.beginPath();
        ctx.rect(0, 0, 200, BASE); // keep only ink above the alphabetic baseline
        ctx.clip();
      }
      ctx.font = `${f.style} 64px '${f.key}'`;
      ctx.fillText(s, 20, BASE);
      ctx.restore();
      return ctx.getImageData(0, 0, 200, 130).data;
    };
    const cmp = (a, b, f, clip) => {
      const x = draw(a, f, clip);
      const y = draw(b, f, clip);
      let diff = 0;
      let ink = 0;
      for (let i = 3; i < x.length; i += 4) {
        if (x[i] > 40 || y[i] > 40) ink++;
        if (Math.abs(x[i] - y[i]) > 40) diff++;
      }
      const ratio = ink ? diff / ink : 0;
      return {
        ratio: +ratio.toFixed(3),
        verdict: diff === 0 ? 'identical' : ratio < 0.12 ? 'near' : 'distinguishable',
      };
    };
    const out = [];
    for (const [a, b, group] of PAIRS) {
      const row = { pair: `${a}~${b}`, group, clipped: {}, whole: {} };
      for (const f of FONTS) {
        const k = `${f.key}${f.style === 'italic' ? ' italic' : ''}`;
        row.clipped[k] = cmp(a, b, f, true);
        row.whole[k] = cmp(a, b, f, false);
      }
      out.push(row);
    }
    // Eyeball sheet: pairs clipped at the baseline, in every font.
    const t = document.createElement('table');
    t.id = 'g';
    t.style.borderCollapse = 'collapse';
    let h =
      '<tr><td></td>' +
      FONTS.map(
        (f) => `<td style="font:10px monospace">${f.key}${f.style === 'italic' ? ' it' : ''}</td>`,
      ).join('') +
      '</tr>';
    for (const [a, b] of PAIRS) {
      h += `<tr><td style="font:11px monospace">${a}~${b}</td>`;
      for (const f of FONTS)
        h += `<td style="border:1px solid #ccc;padding:0 6px;height:30px;overflow:hidden"><div style="height:24px;overflow:hidden;font:${f.style} 26px/30px '${f.key}'">${a} ${b}</div></td>`;
      h += '</tr>';
    }
    t.innerHTML = h;
    document.body.appendChild(t);
    return out;
  },
  { PAIRS, FONTS },
);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'descender-pairs.json'), JSON.stringify(res, null, 1));
await (await page.$('#g')).screenshot({ path: path.join(OUT, 'descender-pairs.png') });
await browser.close();
const sym = (v) => (v.verdict === 'identical' ? 'I' : v.verdict === 'near' ? 'n' : '.');
for (const r of res) {
  const c = Object.values(r.clipped);
  const w = Object.values(r.whole);
  console.log(
    `${r.pair.padEnd(6)} ${r.group.padEnd(9)} clipped ${c.map((v) => sym(v) + v.ratio.toFixed(2)).join(' ')} | whole ${w.map((v) => sym(v)).join('')} | clipped identical ${c.filter((v) => v.verdict === 'identical').length}/8 near ${c.filter((v) => v.verdict === 'near').length}/8`,
  );
}
