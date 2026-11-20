/**
 * Fuzz src/vtparse.ts against xterm.js's EscapeSequenceParser: both read the
 * same random texts; their print / execute / dispatch event streams must agree.
 *
 * Usage: node scripts/fuzz-vtparse.mjs [count=20000] [seed=1]
 *        node scripts/fuzz-vtparse.mjs --text '<JSON string>'   (both event streams of one text)
 * Env: XTERM_HEADLESS = the @xterm/headless package directory (needed when the package is
 * not installed in this repo).
 *
 * Known differences (counted, not failures). Intended (owner decisions):
 * - lineEnd: a string with no terminator later in the text ends at its line end (decision 7);
 *   xterm.js keeps reading it.
 * - belString: BEL ends DCS/SOS/PM/APC (decision 7); xterm.js ends only OSC at BEL.
 * xterm.js-specific:
 * - apc: xterm.js 6.1 parses APC with its own states (APC_ENTRY, APC_INTERMEDIATE,
 *   APC_PASSTHROUGH): no APC event before a byte 0x30–0x7E, U+00A0 and up an error
 *   before it and body after it. vtparse keeps vt100.net's sos_pm_apc_string for APC.
 * - csiFastPath: an xterm.js quirk, see fastPathQuirk.
 * C1 introducers (U+0090, U+0098, U+009B, U+009D–U+009F) are not in the alphabet: in
 * ground they start sequences in xterm.js, the caller handles them there.
 * Execute events for CAN, SUB and C1 controls are left out of the comparison: they
 * abort sequences, which shows in the dispatch events.
 * An input with a known difference is compared on its prefix before that sequence.
 * Anything else is a mismatch; the script exits 1 on any.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// esbuild is the bundler tsup uses: resolved from tsup's own dependencies.
const requireHere = createRequire(import.meta.url);
const ESBUILD_MAIN = createRequire(requireHere.resolve('tsup/package.json')).resolve('esbuild');
// @xterm/headless: the directory in XTERM_HEADLESS, else a local install.
const XTERM =
  process.env.XTERM_HEADLESS ??
  (() => {
    try {
      return dirname(requireHere.resolve('@xterm/headless/package.json'));
    } catch {
      console.error(
        '@xterm/headless not found: install it, or set XTERM_HEADLESS to its package directory',
      );
      process.exit(1);
    }
  })();

const oneText = process.argv[2] === '--text' ? JSON.parse(process.argv[3]) : null;
const count = oneText === null ? Number(process.argv[2] ?? 20000) : 0;
const seed0 = oneText === null ? Number(process.argv[3] ?? 1) : 0;

const { default: esbuild } = await import(pathToFileURL(ESBUILD_MAIN).href);
const tmp = mkdtempSync(join(tmpdir(), 'fuzz-vtparse-'));
const out = join(tmp, 'vtparse.mjs');
esbuild.buildSync({
  entryPoints: [join(ROOT, 'src/vtparse.ts')],
  bundle: true,
  format: 'esm',
  outfile: out,
  logLevel: 'error',
});
const { parseSequence, newStringMemo } = await import(pathToFileURL(out).href);
rmSync(tmp, { recursive: true, force: true });
const { Terminal } = await import(
  pathToFileURL(join(XTERM, 'lib-headless/xterm-headless.mjs')).href
);

// ---- xterm.js side: its parser with every handler replaced by a recorder ----

const term = new Terminal({ allowProposedApi: true });
const parser = term._core._inputHandler._parser;
let ev = [];
parser._printHandler = (data, start, end) => {
  ev.push('p:' + String.fromCodePoint(...data.subarray(start, end)));
};
parser._executeHandlers = Object.create(null);
parser._executeHandlersArr = new Array(0x18).fill(undefined);
parser._executeHandlerFb = (code) => ev.push('x:' + code);
parser._csiHandlers = Object.create(null);
parser._csiHandlerFb = (ident, params) =>
  ev.push(`csi:${ident}:${JSON.stringify(params.toArray())}`);
parser._escHandlers = Object.create(null);
parser._escHandlerFb = (ident) => ev.push('esc:' + ident);
parser._errorHandler = (state) => state; // the default one logs each error
parser._oscParser = {
  start() {},
  put() {},
  end(success) {
    if (success) ev.push('osc');
  },
  reset() {},
  dispose() {},
};
let hooked = null;
parser._dcsParser = {
  hook(ident, params) {
    hooked = `dcs:${ident}:${JSON.stringify(params.toArray())}`;
  },
  put() {},
  unhook(success) {
    if (success) ev.push(hooked);
    hooked = null;
  },
  reset() {},
  dispose() {},
};
parser._apcParser = {
  start() {},
  put() {},
  end(success) {
    if (success) ev.push('apc');
  },
  reset() {},
  dispose() {},
};

function xtermEvents(text) {
  ev = [];
  parser.reset();
  const cps = Uint32Array.from(text, (ch) => ch.codePointAt(0));
  parser.parse(cps, cps.length);
  return normalize(ev);
}

// ---- vtparse side: a ground-state walk over parseSequence ----

/** xterm.js's Params.toArray for a parameter string: ZDM 0, empty sub-parameter -1, clamped. */
function paramsArray(p) {
  const out = [];
  for (const param of p.split(';')) {
    const [head, ...subs] = param.split(':');
    const num = (s, empty) => (s === '' ? empty : Math.min(Number(s), 0x7fffffff));
    out.push(num(head, 0));
    if (subs.length) out.push(subs.map((s) => num(s, -1)));
  }
  return out;
}
/** xterm.js's identifier: collected bytes (private marker, intermediates) << 8 | final. */
function ident(marker, intermediates, final) {
  let collect = 0;
  for (const ch of marker + intermediates) collect = (collect << 8) | ch.charCodeAt(0);
  return (collect << 8) | final;
}
function dispatchEvent(p) {
  if (p.kind === 'esc') return 'esc:' + ident('', p.intermediates, p.final);
  if (p.kind === 'csi' || p.kind === 'dcs') {
    const marker = /^[<=>?]/.test(p.params) ? p.params[0] : '';
    const params = paramsArray(p.params.slice(marker.length));
    return `${p.kind}:${ident(marker, p.intermediates, p.final)}:${JSON.stringify(params)}`;
  }
  if (p.kind === 'osc' || p.kind === 'apc') return p.kind;
  return null; // sos, pm, ignored: no event in xterm.js
}

/**
 * xterm.js's CSI fast path (EscapeSequenceParser.parse, `if (!csiDone) { i = k - 1;
 * this.currentState = ParserState.CSI_PARAM; }`) leaves `ESC [` in CSI_PARAM instead
 * of CSI_ENTRY when the byte after `[` is a C0 or DEL; a private marker after that goes
 * to csi_ignore there, unlike its own table.
 */
function fastPathQuirk(text, i) {
  const ctl = (c) => (c < 0x20 && c !== 0x18 && c !== 0x1a && c !== 0x1b) || c === 0x7f;
  if (text[i + 1] !== '[' || !ctl(text.charCodeAt(i + 2))) return false;
  let j = i + 3;
  while (ctl(text.charCodeAt(j))) j++;
  return /[<=>?]/.test(text[j] ?? '');
}

/** Events of `text`, and the start of the first sequence with an intended difference. */
function vtEvents(text) {
  const out = [];
  const memo = newStringMemo();
  let known = null;
  for (let i = 0; i < text.length;) {
    const c = text.charCodeAt(i);
    if (c === 0x1b || c === 0x9b) {
      const p = parseSequence(text, i, memo);
      if (p.body && known === null) {
        const intro = text[p.body.start - 1]; // C0 controls may stand between ESC and it
        if (intro === '_') known = { at: i, why: 'apc' };
        else if (!p.terminated) known = { at: i, why: 'lineEnd' };
        else if (intro !== ']' && text.charCodeAt(p.body.end) === 0x07)
          known = { at: i, why: 'belString' };
      }
      if (known === null && fastPathQuirk(text, i)) known = { at: i, why: 'csiFastPath' };
      for (const e of p.executed) out.push('x:' + text.charCodeAt(e));
      const d = dispatchEvent(p);
      if (d) out.push(d);
      // xterm.js reads ST as ESC, then dispatches `ESC \`
      if (p.body && p.end === p.body.end + 2 && text.charCodeAt(p.body.end) === 0x1b)
        out.push('esc:' + 0x5c);
      i = p.end;
    } else if (c < 0x20) {
      out.push('x:' + c);
      i++;
    } else if (c >= 0x7f && c < 0xa0) {
      if (c >= 0x80 && c !== 0x9c) out.push('x:' + c); // C1 executed, ST and DEL ignored
      i++;
    } else {
      const ch = String.fromCodePoint(text.codePointAt(i));
      out.push('p:' + ch);
      i += ch.length;
    }
  }
  return { events: normalize(out), known };
}

/** Merges adjacent prints; drops execute events of CAN, SUB and C1 controls. */
function normalize(events) {
  const out = [];
  for (const e of events) {
    if (/^x:(24|26|12[89]|1[3-5]\d)$/.test(e)) continue;
    if (e.startsWith('p:') && out.length && out[out.length - 1].startsWith('p:'))
      out[out.length - 1] += e.slice(2);
    else out.push(e);
  }
  return out;
}

// ---- random inputs ----

const ALPHABET = [
  '\x1b', '\x1b', '\x1b', '\x1b', '[', '[', ']', 'P', 'X', '^', '_', '\\',
  '0', '1', '2', '38', ';', ':', '?', '<', '=', '>', '!', '$', ' ', '#', '(',
  'm', 'h', 'H', 'J', 'q', 'B', '8', 'N', 'c', '@', '~', 'a', 'z',
  '\x00', '\x07', '\x08', '\r', '\n', '\x18', '\x1a', '\x05', '\x1f', '\x7f',
  '\x80', '\x85', '\x8f', '\x91', '\x99', '\x9a', '\x9c',
  'é', '漢', '\u{1F600}',
]; // prettier-ignore

let seed = seed0 >>> 0;
/** mulberry32 */
const rnd = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const randomText = () =>
  Array.from({ length: 1 + Math.floor(rnd() * 24) }, () => ALPHABET[Math.floor(rnd() * ALPHABET.length)]).join(''); // prettier-ignore

if (oneText !== null) {
  const vt = vtEvents(oneText);
  console.log(`vtparse ${show(vt.events)} known ${show(vt.known)}`);
  console.log(`xterm   ${show(xtermEvents(oneText))}`);
  process.exit(0);
}

const same = (a, b) => a.length === b.length && a.every((e, k) => e === b[k]);
/** JSON with C1 controls and DEL escaped too (JSON.stringify leaves them raw). */
const show = (s) =>
  JSON.stringify(s).replace(
    /[\x7f-\x9f]/g,
    (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
  );

let mismatches = 0;
const filtered = { lineEnd: 0, belString: 0, apc: 0, csiFastPath: 0 };
const examples = [];
for (let n = 0; n < count; n++) {
  const text = randomText();
  const vt = vtEvents(text);
  const xt = xtermEvents(text);
  if (same(vt.events, xt)) continue;
  if (vt.known) {
    // the ESC keeps a string before the cut terminated; alone it emits nothing on either side
    const prefix = text.slice(0, vt.known.at) + '\x1b';
    if (same(vtEvents(prefix).events, xtermEvents(prefix))) {
      filtered[vt.known.why]++;
      continue;
    }
  }
  mismatches++;
  if (!examples.some((e) => e.text === text)) examples.push({ text, vt: vt.events, xterm: xt });
}

examples.sort((a, b) => a.text.length - b.text.length);
for (const e of examples.slice(0, Number(process.env.SHOW ?? 8)))
  console.log(`mismatch ${show(e.text)}\n  vtparse ${show(e.vt)}\n  xterm   ${show(e.xterm)}`);
console.log(
  `inputs ${count} seed ${seed0}: mismatches ${mismatches}; ` +
    `intended: line end ${filtered.lineEnd}, BEL ends DCS/SOS/PM/APC ${filtered.belString}; ` +
    `xterm.js-specific: APC parser ${filtered.apc}, CSI fast path ${filtered.csiFastPath}`,
);
process.exit(mismatches ? 1 : 0);
