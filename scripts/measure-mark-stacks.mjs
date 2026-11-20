#!/usr/bin/env node
/**
 * MEASUREMENT — how stacked marks read: how far a stack leaves its line and how
 * much of the neighbouring lines it runs through, by script and depth, against
 * real text of the script (docs/confusion-model.md §15.7). Every letter of a
 * word carries the stack, between two lines of ordinary text, in 3 fonts.
 * `up`, `down`: ink past the line box, in lines (worst font). `above`, `below`:
 * share of the neighbour line's letters that the stack's ink crosses. Writes
 * docs/evidence/mark-stacks.json. Imports dist/ for the limits, so build first.
 *
 *   node scripts/measure-mark-stacks.mjs [path/to/playwright] [chrome]   (or PLAYWRIGHT_PATH)
 */
/* global document, createImageBitmap, OffscreenCanvas */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { MARK_STACK_LIMITS } from '../dist/index.js';

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
const OUT = path.join(__dirname, '..', 'docs', 'evidence', 'mark-stacks.json');
const FONTS = ['DejaVu Sans', 'Noto Sans', 'Liberation Serif'];
const DEPTHS = [1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 40];

const SCRIPTS = {
  Thai: { word: 'สวัส', mark: '้', real: 'ผู้ใหญ่ น้ำ สิทธิ์ ฟื้น' },
  Lao: { word: 'ສວສ', mark: '້', real: 'ສະບາຍດີ ຜູ້' },
  Arabic: { word: 'سلام', mark: 'َ', real: 'ٱلرَّحْمَٰنِ لَا رَيْبَ ۛ فِيهِ جَآءَ' },
  Hebrew: { word: 'שלום', mark: '֑', real: 'בְּרֵאשִׁ֖ית בָּרָ֣א שָּֽׁ֣' },
  Devanagari: { word: 'नमस', mark: '॑', real: 'अ॒ग्निमी॑ळे क़ुँ॑ क्ष्म्य' },
  Tibetan: { word: 'བོད', mark: 'ྲ', real: 'བསྒྲུབས ཧཱུྃ ཧྐྵྨླྭྲྱཱྃ' },
  Latin: { word: 'Viet', mark: '́', real: 'Việt người ệ ẫ'.normalize('NFD') },
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 1300 } });
await page.setContent(`<style>
 body{margin:0;background:#fff}
 #row{padding:520px 40px;width:920px;font-size:32px;white-space:pre}
 #above,#below{color:#0a0}
 #s{color:#f00}
</style><div id=row><div id=above></div><div id=s></div><div id=below></div></div>`);
const REF = 'reference line of ordinary text';

/** Reach and neighbours crossed by `text`, in `font`. */
async function measure(text, font, lineHeight) {
  const lay = await page.evaluate(
    ({ text, font, REF, lineHeight }) => {
      document.getElementById('row').style.fontFamily = `'${font}'`;
      document.getElementById('row').style.lineHeight = lineHeight;
      const s = document.getElementById('s');
      s.textContent = text;
      const cellsOf = (id) => {
        const e = document.getElementById(id);
        e.textContent = REF;
        e.style.visibility = 'hidden';
        const n = e.firstChild;
        const out = [];
        for (let i = 0; i < REF.length; i++) {
          if (REF[i] === ' ') continue;
          const r = document.createRange();
          r.setStart(n, i);
          r.setEnd(n, i + 1);
          const q = r.getBoundingClientRect();
          out.push({ x: q.left, y: q.top, w: q.width, h: q.height });
        }
        return out;
      };
      const above = cellsOf('above');
      const below = cellsOf('below');
      const b = s.getBoundingClientRect();
      return { above, below, top: b.top, bottom: b.bottom };
    },
    { text, font, REF, lineHeight },
  );
  const shot = (await page.screenshot({ type: 'png' })).toString('base64');
  return page.evaluate(
    async ({ shot, lay }) => {
      const bmp = await createImageBitmap(
        await (await fetch(`data:image/png;base64,${shot}`)).blob(),
      );
      const cv = new OffscreenCanvas(bmp.width, bmp.height);
      const x = cv.getContext('2d');
      x.drawImage(bmp, 0, 0);
      const { data, width: W, height: H } = x.getImageData(0, 0, bmp.width, bmp.height);
      const ink = (px, py) => {
        const i = (py * W + px) * 4;
        return data[i] + data[i + 1] + data[i + 2] < 600;
      };
      let top = null;
      let bottom = null;
      for (let py = 0; py < H; py++)
        for (let px = 0; px < W; px++)
          if (ink(px, py)) {
            top ??= py;
            bottom = py;
          }
      const crossed = (cells) =>
        cells.filter((c) => {
          for (let py = Math.round(c.y); py < c.y + c.h; py++)
            for (let px = Math.round(c.x); px < c.x + c.w; px++) if (ink(px, py)) return true;
          return false;
        }).length / cells.length;
      const lineH = lay.bottom - lay.top;
      return {
        up: top === null ? 0 : Math.max(0, lay.top - top) / lineH,
        down: bottom === null ? 0 : Math.max(0, bottom - lay.bottom) / lineH,
        above: crossed(lay.above),
        below: crossed(lay.below),
      };
    },
    { shot, lay },
  );
}

const worst = async (text, lineHeight) => {
  const all = [];
  for (const font of FONTS) all.push(await measure(text, font, lineHeight));
  const max = (k) => +Math.max(...all.map((r) => r[k])).toFixed(2);
  return { up: max('up'), down: max('down'), above: max('above'), below: max('below') };
};

const results = {};
for (const [script, { word, mark, real }] of Object.entries(SCRIPTS)) {
  const stacked = (n) => [...word].map((c) => c + mark.repeat(n)).join('');
  const depths = {};
  for (const n of DEPTHS) depths[n] = await worst(stacked(n), 'normal');
  results[script] = {
    limit: MARK_STACK_LIMITS[script],
    real: await worst(real, 'normal'),
    realTight: await worst(real, '1.2'),
    depths,
  };
}
await browser.close();
fs.writeFileSync(OUT, `${JSON.stringify({ fonts: FONTS, results }, null, 1)}\n`);
for (const [script, r] of Object.entries(results)) {
  console.log(
    script,
    'limit',
    r.limit,
    'real',
    JSON.stringify(r.real),
    'real@1.2',
    JSON.stringify(r.realTight),
  );
  for (const [n, d] of Object.entries(r.depths)) console.log('  ', n, JSON.stringify(d));
}
