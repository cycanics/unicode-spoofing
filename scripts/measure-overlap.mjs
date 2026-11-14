#!/usr/bin/env node
/**
 * MEASUREMENT — Unicode that renders over other text (docs/confusion-model.md §19).
 * Browser: each sample in Chrome, 4 fonts, against the same text without the
 * suspect code points. `filled`: share of the blank pixels in each base letter's
 * cell that gain ink, the worst letter (100% = a solid block, no letter left).
 * `aboveLost`: share of the ink of the line above painted over. `reachAbove`,
 * `reachBelow`: how far the sample's ink leaves its own line box, in lines.
 * Marks paint in their base's color, so all this is measured on one color per
 * line, not by coloring the suspect code points. Terminal: raw bytes through a
 * tmux pane, what the screen holds after. Both: what the rules of this library
 * do with the sample (imports dist/, so build first). Writes
 * docs/evidence/overlap.json and overlap.png.
 *
 *   node scripts/measure-overlap.mjs [path/to/playwright] [chrome]
 */
/* global document, createImageBitmap, OffscreenCanvas */
/* eslint-disable no-control-regex, no-irregular-whitespace -- it reports on these characters */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { analyze, cleanHidden } from '../dist/index.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PW = process.argv[2] ?? '/home/user/.nvm/versions/node/v20.19.5/lib/node_modules/playwright';
const CHROME = process.argv[3] ?? '/usr/bin/google-chrome';
const { chromium } = require(PW);
const OUT = path.join(__dirname, '..', 'docs', 'evidence');
const FONTS = ['DejaVu Sans', 'Noto Sans', 'Liberation Serif', 'DejaVu Sans Mono'];

const WORD = 'SECRET';
/** `cover` after each letter of `word`, as [text, isCover] segments. */
const each = (cover, word = WORD) =>
  [...word].flatMap((c) => [
    [c, false],
    [cover, true],
  ]);
const after = (cover, base = WORD) => [
  [base, false],
  [cover, true],
];
const before = (cover, base = WORD) => [
  [cover, true],
  [base, false],
];
const rep = (s, n) => s.repeat(n);
const cps = (segments) =>
  [...new Set(segments.filter(([, c]) => c).flatMap(([s]) => [...s]))]
    .map((c) => `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`)
    .join(' ');

const BROWSER = {
  // Overprint controls, as a browser takes them.
  'backspace ×6': after(rep('\b', 6) + 'visibl'),
  CR: after('\rvisibl'),
  'VT, FF': after('\v\fvisibl'),
  'ESC[2K left over': after('\u001B[2Kvisibl'),
  // Enclosing marks.
  'U+20DD circle, each letter': each('⃝'),
  'U+20E0 prohibition, each letter': each('⃠'),
  'U+20E3 keycap, each letter': each('⃣'),
  'U+0488 hundred thousands, each letter': each('҈'),
  'U+0489 millions, each letter': each('҉'),
  'U+0489 ×1 on the word': after('҉'),
  'U+20DD ×2, each letter': each('⃝⃝'),
  'U+0489 ×2, each letter': each('҉҉'),
  // Overlays.
  'U+0336 stroke, each letter': each('̶'),
  'U+0338 solidus, each letter': each('̸'),
  'U+20D2 long bar, each letter': each('⃒'),
  'U+0336 ×2, each letter': each('̶̶'),
  'U+0336+U+0338+U+20D2+U+20E5, each letter': each('̶̸⃒⃥'),
  'U+0336 ×20, each letter': each(rep('̶', 20)),
  // Tall stacks onto the line above.
  'U+0301 ×2, each letter': each(rep('́', 2)),
  'U+0301 ×40, each letter': each(rep('́', 40)),
  'Hebrew point U+05B0 ×40': each(rep('ְ', 40), 'שלום'),
  'Hebrew accent U+0591 ×40': each(rep('֑', 40), 'שלום'),
  'Arabic fatha U+064E ×40': each(rep('َ', 40), 'سلام'),
  'Thai tone U+0E49 ×40': each(rep('้', 40), 'สวัส'),
  'Devanagari U+0951 ×40': each(rep('॑', 40), 'नमस'),
  'Tibetan subjoined U+0FB2 ×20': each(rep('ྲ', 20), 'བོད'),
  // Past the zalgo count.
  'U+0301 ×2 + CGJ, ×10 per letter': each(rep('\u0301\u0301\u034F', 10)),
  'U+0301 ×40, a Hebrew letter in the word': [['ש', false], ...each(rep('\u0301', 40))],
  'Best try: every wide mark ×20, a Hebrew letter in the word': [
    ['ש', false],
    ...each(rep('\u0489\u0488\u20DD\u20E3\u0336\u0338\u20D2\u20E5\u0333\u0332', 20)),
  ],
  // Positive control of `filled`: only CSS pulls a block over its neighbour.
  'CSS control: letter-spacing -0.62em, U+2588 after each letter': each('\u2588'),
  // Wide or tall glyphs with an advance.
  'U+FDFD bismillah': after(' ﷽'),
  'U+12031 cuneiform': after(' \u{12031}'),
  'U+2E3B three-em dash': after(' ⸻'),
  // Block elements.
  'U+2588 full block ×6 after': after(rep('█', 6)),
  'U+2588 before each letter': each('█'),
  'U+2591 shade ×6 after': after(rep('░', 6)),
  'U+2588 + U+20DD after each letter': each('█⃝'),
  // Direction.
  'RLO over the word': before('‮'),
  'RLO + line break + word': [
    ['aaaa‮ bbbb\n', true],
    [WORD, false],
  ],
  'U+2028 + RLO': [
    ['aaaa ‮', true],
    [WORD, false],
  ],
  // Format controls whose job is overlap.
  'U+1BCA0 shorthand overlap, each letter': each('\u{1BCA0}'),
  'U+13434 hieroglyph overlay': [
    ['\u{13000}', false],
    ['\u{13434}\u{13050}', true],
  ],
  'U+0600 number sign over digits': [
    ['؀', true],
    ['123', false],
  ],
  'U+06DD end of ayah over digits': [
    ['۝', true],
    ['123', false],
  ],
};

const TERMINAL = {
  'backspace ×6': `${WORD}\b\b\b\b\b\bvisibl`,
  CR: `${WORD}\rvisibl`,
  'ESC[6D cursor left': `${WORD}\u001B[6Dvisibl`,
  'ESC[2K erase line + CR': `${WORD}\u001B[2K\rvisibl`,
  'ESC[1A cursor up (over the line above)': `${WORD}\n\u001B[1A\u001B[6Dvisibl`,
  'ESC[2J erase screen': `${WORD}\u001B[2J\u001B[Hvisibl`,
  'ESC[8m conceal': `\u001B[8m${WORD}\u001B[0m visibl`,
  'ESC[30;40m black on black': `\u001B[30;40m${WORD}\u001B[0m visibl`,
  'CSI as U+009B': `${WORD}\u009B6Dvisibl`,
  'ESC 7 / ESC 8 save and restore': `\u001B7${WORD}\u001B8visibl`,
  'ESC c reset': `${WORD}\u001Bcvisibl`,
  'OSC title': `\u001B]0;${WORD}\u0007visibl`,
  'OSC 8 hyperlink target': `\u001B]8;;http://x/${WORD}\u001B\\visibl\u001B]8;;\u001B\\`,
  'DCS string': `\u001BP${WORD}\u001B\\visibl`,
  'APC string': `\u001B_${WORD}\u001B\\visibl`,
};

const show = (s) => s.replace(/[^\x20-\x7E]/gu, (c) => `<${c.codePointAt(0).toString(16)}>`);

function rules(input) {
  const lenient = analyze(input);
  const strict = analyze(input, { hiddenChars: 'strict' });
  const c = cleanHidden(input, { reportContent: true });
  const on = (r) =>
    Object.entries(r.signals)
      .filter(([, v]) => v)
      .map(([k]) => k);
  return {
    lenient: { signals: on(lenient), normalized: lenient.normalized },
    strict: { signals: on(strict), normalized: strict.normalized },
    cleanHidden: { cleaned: c.cleaned, content: c.content.map((e) => e.kind) },
  };
}

// --- Browser -----------------------------------------------------------------

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 1300 } });
const CLIP = { x: 0, y: 0, width: 1000, height: 1300 };
await page.setContent(`<style>
 body{margin:0;background:#fff}
 #row{padding:520px 40px;width:920px;line-height:normal;font-size:32px;white-space:pre-wrap}
 #above,#below{color:#0a0}
 #s{color:#f00}
</style><div id=row><div id=above>REFERENCE ABOVE LINE</div><div id=s></div><div id=below>REFERENCE BELOW LINE</div></div>`);

/** Lays out `segments`; cells of the base letters and the line box. */
const lay = (segments, font) =>
  page.evaluate(
    ({ segments, font }) => {
      document.getElementById('row').style.fontFamily = `'${font}'`;
      const s = document.getElementById('s');
      const n = document.createTextNode(segments.map(([t]) => t).join(''));
      s.textContent = '';
      s.append(n);
      const cells = [];
      let at = 0;
      for (const [t, cover] of segments) {
        if (!cover) {
          for (const c of t) {
            const r = document.createRange();
            r.setStart(n, at);
            r.setEnd(n, at + c.length);
            const q = r.getBoundingClientRect();
            cells.push({ x: q.left, y: q.top, w: q.width, h: q.height });
            at += c.length;
          }
        } else at += t.length;
      }
      const b = s.getBoundingClientRect();
      const a = document.getElementById('above').getBoundingClientRect();
      const l = document.getElementById('below').getBoundingClientRect();
      return { cells, top: b.top, bottom: b.bottom, aTop: a.top, lBottom: l.bottom, lTop: l.top };
    },
    { segments, font },
  );
const shot = async () => (await page.screenshot({ type: 'png', clip: CLIP })).toString('base64');
const hideRefs = (hide) =>
  page.evaluate((hide) => {
    for (const id of ['above', 'below'])
      document.getElementById(id).style.visibility = hide ? 'hidden' : 'visible';
  }, hide);

const compare = (args) =>
  page.evaluate(async ({ plain, sample, sampleBare, layP, layS }) => {
    const load = async (b64) => {
      const bmp = await createImageBitmap(
        await (await fetch(`data:image/png;base64,${b64}`)).blob(),
      );
      const cv = new OffscreenCanvas(bmp.width, bmp.height);
      const x = cv.getContext('2d');
      x.drawImage(bmp, 0, 0);
      return x.getImageData(0, 0, bmp.width, bmp.height);
    };
    const P = await load(plain);
    const S = await load(sample);
    const B = await load(sampleBare);
    const W = P.width;
    const ink = (d, x, y) => {
      const i = (y * W + x) * 4;
      return d[i] + d[i + 1] + d[i + 2] < 600;
    };
    const green = (d, x, y) => {
      const i = (y * W + x) * 4;
      return d[i + 1] > 90 && d[i] < 110 && d[i + 2] < 110;
    };
    // The line above: same place in both, since it comes first.
    let aboveInk = 0;
    let aboveLost = 0;
    for (let y = Math.floor(layP.aTop); y < Math.floor(layP.top); y++)
      for (let x = 0; x < W; x++)
        if (green(P.data, x, y)) {
          aboveInk += 1;
          if (!green(S.data, x, y)) aboveLost += 1;
        }
    // The sample's own ink, no reference lines painted.
    let topInk = null;
    let bottomInk = null;
    for (let y = 0; y < P.height; y++)
      for (let x = 0; x < W; x++)
        if (ink(B.data, x, y)) {
          topInk ??= y;
          bottomInk = y;
        }
    // Each base letter's cell: what was blank and is not.
    let worst = 0;
    layP.cells.forEach((c0, k) => {
      const c1 = layS.cells[k];
      if (!c1 || !c0.w) return;
      const w = Math.floor(c0.w);
      const h = Math.floor(c0.h);
      let blank = 0;
      let gained = 0;
      for (let dy = 0; dy < h; dy++)
        for (let dx = 0; dx < w; dx++) {
          const x0 = Math.round(c0.x) + dx;
          const y0 = Math.round(c0.y) + dy;
          if (ink(P.data, x0, y0)) continue;
          blank += 1;
          if (ink(S.data, Math.round(c1.x) + dx, Math.round(c1.y) + dy)) gained += 1;
        }
      if (blank) worst = Math.max(worst, gained / blank);
    });
    const lineH = layS.bottom - layS.top;
    return {
      filled: worst,
      aboveLost: aboveInk ? aboveLost / aboveInk : 0,
      reachAbove: topInk === null ? 0 : Math.max(0, layS.top - topInk) / lineH,
      reachBelow: bottomInk === null ? 0 : Math.max(0, bottomInk - layS.bottom) / lineH,
      lineH,
    };
  }, args);

const browserResults = [];
for (const [name, segments] of Object.entries(BROWSER)) {
  const input = segments.map(([s]) => s).join('');
  const fonts = {};
  for (const font of FONTS) {
    const css = name.startsWith('CSS control') ? '-0.62em' : '';
    await page.evaluate((v) => {
      document.getElementById('s').style.letterSpacing = v;
    }, '');
    const layP = await lay(
      segments.filter(([, c]) => !c),
      font,
    );
    await hideRefs(false);
    const plain = await shot();
    await page.evaluate((v) => {
      document.getElementById('s').style.letterSpacing = v;
    }, css);
    const layS = await lay(segments, font);
    const sample = await shot();
    await hideRefs(true);
    const sampleBare = await shot();
    await hideRefs(false);
    fonts[font] = await compare({ plain, sample, sampleBare, layP, layS });
  }
  const max = (k) => Math.max(...Object.values(fonts).map((f) => f[k]));
  browserResults.push({
    name,
    codePoints: cps(segments),
    filledMax: +max('filled').toFixed(3),
    aboveLostMax: +max('aboveLost').toFixed(3),
    reachAboveMax: +max('reachAbove').toFixed(2),
    reachBelowMax: +max('reachBelow').toFixed(2),
    fonts,
    rules: rules(input),
  });
}

// Contact sheet: the samples worth seeing, each under a reference line.
await page.setViewportSize({ width: 1100, height: 900 });
const SHEET = Object.keys(BROWSER).filter((n) =>
  /^(CSS|backspace|CR|U\+0489 ×2|U\+0336 ×20|U\+0301 ×2,|U\+0301 ×40,|Hebrew accent|Arabic fatha|Thai|Tibetan|U\+2588 before|U\+2591)/.test(
    n,
  ),
);
await page.setContent(`<style>
 body{margin:12px;background:#fff;font:15px 'DejaVu Sans'}
 .n{color:#555;margin-top:14px}.r{font-size:30px;white-space:pre-wrap;word-break:break-all;width:1060px}.g{color:#080}.b{color:#d00}
</style><div style="padding-top:330px">${SHEET.map(
  (n) =>
    `<div class=n>${n}</div><div class="r g">reference line above</div><div class="r b" style="letter-spacing:${n.startsWith('CSS') ? '-0.62em' : 'normal'}">${BROWSER[
      n
    ]
      .map(([t]) => t.replace(/</g, '&lt;'))
      .join('')}</div>`,
).join('')}</div>`);
await page.screenshot({ path: path.join(OUT, 'overlap.png'), fullPage: true });
await browser.close();

// --- Terminal ----------------------------------------------------------------

const SOCKET = 'unicode-overlap';
const tmux = (...args) =>
  execFileSync('tmux', ['-L', SOCKET, '-f', '/dev/null', ...args], {
    encoding: 'utf8',
    timeout: 5000,
  });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overlap-'));
const terminalResults = [];
for (const [name, payload] of Object.entries(TERMINAL)) {
  const f = path.join(dir, 'sample');
  fs.writeFileSync(f, `line above\n${payload}\nline below\n`);
  tmux('new-session', '-d', '-s', 's', '-x', '60', '-y', '8', `cat '${f}'; sleep 2`);
  await new Promise((r) => setTimeout(r, 400));
  const plain = tmux('capture-pane', '-p', '-t', 's');
  const styled = tmux('capture-pane', '-ep', '-t', 's');
  tmux('kill-server');
  const screen = plain.replace(/\n+$/, '');
  terminalResults.push({
    name,
    screen: show(screen),
    /** The word is on the screen and in no style that hides it. */
    wordOnScreen: screen.includes(WORD),
    hiddenStyle: /\u001B\[(?:[0-9;]*;)?(?:8|30;40)[;m]/.test(styled) && styled.includes(WORD),
    lineAboveIntact: screen.includes('line above'),
    rules: rules(payload),
  });
}
fs.rmSync(dir, { recursive: true, force: true });

const escapeNonAscii = (json) =>
  json.replace(/[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁠-⁯]/gu, (c) => {
    if (c === '\n') return c;
    return `\\u${c.codePointAt(0).toString(16).padStart(4, '0')}`;
  });
fs.writeFileSync(
  path.join(OUT, 'overlap.json'),
  `${escapeNonAscii(JSON.stringify({ fonts: FONTS, browser: browserResults, terminal: terminalResults }, null, 1))}\n`,
);

const pct = (x) => `${Math.round(x * 100)}%`;
const sig = (r) => r.signals.join('+') || '-';
console.log(
  'BROWSER name | filled | above lost | reach up | reach down | lenient | strict | strict keeps it',
);
for (const r of browserResults)
  console.log(
    [
      r.name,
      pct(r.filledMax),
      pct(r.aboveLostMax),
      r.reachAboveMax,
      r.reachBelowMax,
      sig(r.rules.lenient),
      sig(r.rules.strict),
      r.rules.strict.normalized.length,
    ].join(' | '),
  );
console.log(
  '\nTERMINAL name | word on screen | hidden style | above intact | screen || lenient | strict | cleanHidden',
);
for (const r of terminalResults)
  console.log(
    [
      r.name,
      r.wordOnScreen,
      r.hiddenStyle,
      r.lineAboveIntact,
      r.screen.replace(/\n/g, '/'),
      sig(r.rules.lenient),
      show(r.rules.lenient.normalized),
      sig(r.rules.strict),
      show(r.rules.strict.normalized),
      show(r.rules.cleanHidden.cleaned),
    ].join(' | '),
  );
