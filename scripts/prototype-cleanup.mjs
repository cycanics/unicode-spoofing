#!/usr/bin/env node
/**
 * PROTOTYPE — hidden-character cleanup with removal counters and payload
 * decoding, per docs/confusion-model.md §6. Not wired into src/.
 *
 *   node scripts/prototype-cleanup.mjs [path/to/cases.mjs]
 *
 * The cases module must export `cases` (name → string).
 */
import { fileURLToPath, pathToFileURL } from 'node:url';

const RGI_EMOJI = /\p{RGI_Emoji}/gv; // protects ZWJ, tag, keycap and VS16 sequences whole
const LETTER = /\p{L}/u;
const MARK = /\p{M}/u;
const RTL =
  /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Adlam}\p{Script=Samaritan}\p{Script=Mandaic}]/u;
const EMOJI = /\p{Emoji}/u;
const MATH = /\p{Sm}/u;
const HAN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const MONGOLIAN = /\p{Script_Extensions=Mongolian}/u;

/** Scripts whose orthography uses ZWNJ/ZWJ between letters. */
const JOINER_SCRIPTS = [
  'Arabic',
  'Syriac',
  'Nko',
  'Mongolian',
  'Devanagari',
  'Bengali',
  'Gurmukhi',
  'Gujarati',
  'Oriya',
  'Tamil',
  'Telugu',
  'Kannada',
  'Malayalam',
  'Sinhala',
  'Khmer',
  'Myanmar',
  'Tibetan',
  'Kaithi',
];
const JOINER_RE = JOINER_SCRIPTS.map((s) => new RegExp(`\\p{Script_Extensions=${s}}`, 'u'));

const ZW = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]);
const BIDI_EMBED = (cp) => cp >= 0x202a && cp <= 0x202e; // LRE RLE PDF LRO RLO
const BIDI_SOFT = (cp) =>
  cp === 0x200e || cp === 0x200f || cp === 0x061c || (cp >= 0x2066 && cp <= 0x2069);
const isVS = (cp) =>
  (cp >= 0xfe00 && cp <= 0xfe0f) ||
  (cp >= 0xe0100 && cp <= 0xe01ef) ||
  (cp >= 0x180b && cp <= 0x180d) ||
  cp === 0x180f;
/** Word separators for counting; U+FEFF is in JS \\s but is a hidden char here. */
const WS = /[\s--\uFEFF]/v;
const isTag = (cp) => cp >= 0xe0000 && cp <= 0xe007f;
/**
 * Other invisibles: render as nothing in any context. Arabic number signs
 * (U+0600–0605, U+06DD, U+070F) are Cf too but VISIBLE, and are not listed.
 */
const OTHER_INVISIBLE = (cp) =>
  cp === 0x180e ||
  (cp >= 0x2061 && cp <= 0x2064) ||
  cp === 0x034f ||
  (cp >= 0x206a && cp <= 0x206f) ||
  (cp >= 0xfff9 && cp <= 0xfffb);

/** Blank glyphs: occupy space, draw nothing, are not whitespace → become U+0020. */
const BLANK = new Set([0x115f, 0x1160, 0x3164, 0xffa0, 0x2800, 0x1d159]);
/** Scripts that use ZWSP as a word-break hint between their letters. */
const ZWSP_HINT_RE =
  /[\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}\p{Script=Tibetan}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
/** Viramas etc. after which a lone ZWJ forms a chillu/half form even at word end. */
const VIRAMA_RE =
  /[\u094d\u09cd\u0a4d\u0acd\u0b4d\u0bcd\u0c4d\u0ccd\u0d4d\u0dca\u1039\u103a\u17d2]/u;

/** VS → byte (the "emoji smuggling" scheme: FE00..FE0F = 0..15, E0100.. = 16..255). */
const vsByte = (cp) =>
  cp >= 0xfe00 && cp <= 0xfe0f ? cp - 0xfe00 : cp >= 0xe0100 ? cp - 0xe0100 + 16 : null;

function decodeVS(cps) {
  const bytes = cps.map(vsByte).filter((b) => b !== null);
  if (bytes.length < 2) return null;
  const s = new TextDecoder('utf-8', { fatal: false }).decode(Uint8Array.from(bytes));
  return printable(s) ? { decoded: s } : { decoded: null, bytes };
}
const decodeTags = (cps) => {
  const s = String.fromCodePoint(
    ...cps.filter((c) => c > 0xe0000 && c < 0xe007f).map((c) => c - 0xe0000),
  );
  return s.length ? { decoded: s } : null;
};
/** Two-symbol binary over a zero-width run; tries both polarities, 8-bit MSB-first. */
function decodeZW(cps) {
  const syms = [...new Set(cps)];
  if (cps.length < 8 || syms.length !== 2) return null;
  for (const [zero] of [[syms[0]], [syms[1]]]) {
    const bits = cps.map((c) => (c === zero ? 0 : 1));
    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8)
      bytes.push(parseInt(bits.slice(i, i + 8).join(''), 2));
    const s = new TextDecoder().decode(Uint8Array.from(bytes));
    if (printable(s)) return { decoded: s };
  }
  const bits = cps.map((c) => (c === syms[0] ? 0 : 1));
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8)
    bytes.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  return { decoded: null, bytes };
}

/** Raw bytes of an undecodable payload, capped, as hex. */
export const PAYLOAD_HEX_CAP = 32;
const hex = (bytes) =>
  bytes
    .slice(0, PAYLOAD_HEX_CAP)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('') + (bytes.length > PAYLOAD_HEX_CAP ? '…' : '');
const printable = (s) =>
  s.length > 0 &&
  [...s].filter((c) => /[\p{L}\p{N}\p{P}\p{Zs}]/u.test(c)).length / [...s].length >= 0.9;

/**
 * Returns { cleaned, removed: { counted: {...}, silent: {...} }, payloads }.
 * Counted = hidden/misreading cases; silent = removed without counting.
 */
export function cleanup(text) {
  const cps = [...text];
  const n = cps.length;
  const keep = new Uint8Array(n).fill(1);
  const replaceWith = [];
  const protectedAt = new Uint8Array(n);
  // Protect RGI emoji sequences (by code point index).
  {
    const starts = new Map();
    let idx = 0;
    let off = 0;
    for (const ch of cps) {
      starts.set(off, idx);
      off += ch.length;
      idx += 1;
    }
    for (const m of text.matchAll(RGI_EMOJI)) {
      const i = starts.get(m.index);
      const len = [...m[0]].length;
      protectedAt.fill(1, i, i + len);
    }
  }
  const counted = {
    bidiOverride: 0,
    bidiMark: 0,
    tag: 0,
    variationSelector: 0,
    zeroWidthRun: 0,
    zeroWidthInWord: 0,
    otherInvisible: 0,
    blankFiller: 0,
  };
  const silent = { softHyphen: 0, zeroWidth: 0, bom: 0 };
  const clsAt = new Array(n); // per removed code point: [class, counted]
  const offs = [];
  for (let i = 0, o = 0; i < n; o += cps[i].length, i += 1) offs.push(o);
  const drop = (i, j, cls, isCounted) => {
    keep.fill(0, i, j);
    (isCounted ? counted : silent)[cls] += j - i;
    for (let k = i; k < j; k += 1) clsAt[k] = [cls, isCounted];
  };
  const payload = (kind, i, j, r) => {
    if (!r) return;
    const p = { kind, index: offs[i], length: j - i, decoded: r.decoded };
    if (r.decoded === null) p.bytesHex = hex(r.bytes);
    payloads.push(p);
  };
  const payloads = [];
  const hasRTL = RTL.test(text);
  const cp = (i) => cps[i]?.codePointAt(0);

  for (let i = 0; i < n; i += 1) {
    const c = cp(i);
    if (protectedAt[i]) continue;

    if (c === 0x00ad) {
      drop(i, i + 1, 'softHyphen', false);
      continue;
    }
    if (BLANK.has(c)) {
      drop(i, i + 1, 'blankFiller', true);
      // Between two visible characters it stands for a space ("click⠀here");
      // at a word edge it only pads the word ("admin⠀") and is dropped.
      if (cps[i - 1] && cps[i + 1] && !WS.test(cps[i - 1]) && !WS.test(cps[i + 1]))
        replaceWith[i] = ' ';
      continue;
    }
    if (OTHER_INVISIBLE(c)) {
      drop(i, i + 1, 'otherInvisible', true);
      continue;
    }

    if (BIDI_EMBED(c)) {
      drop(i, i + 1, 'bidiOverride', true);
      continue;
    }
    if (BIDI_SOFT(c)) {
      if (!hasRTL) drop(i, i + 1, 'bidiMark', true);
      continue;
    }

    if (isTag(c)) {
      let j = i;
      while (j < n && isTag(cp(j)) && !protectedAt[j]) j += 1;
      const run = cps.slice(i, j).map((x) => x.codePointAt(0));
      drop(i, j, 'tag', true);
      payload('tag', i, j, decodeTags(run));
      i = j - 1;
      continue;
    }

    if (isVS(c)) {
      // Valid: exactly one selector on a base that takes it.
      let j = i;
      while (j < n && isVS(cp(j))) j += 1;
      const base = cps[i - 1] ?? '';
      const first = c;
      const validSingle =
        base &&
        ((first === 0xfe0e || first === 0xfe0f) && EMOJI.test(base)
          ? true
          : first >= 0xe0100 && HAN.test(base)
            ? true
            : first >= 0x180b && first <= 0x180f && MONGOLIAN.test(base)
              ? true
              : first >= 0xfe00 && first <= 0xfe02 && (HAN.test(base) || MATH.test(base))); // standardized variants (CJK, math)
      const from = validSingle ? i + 1 : i;
      if (j > from) {
        drop(from, j, 'variationSelector', true);
        payload('variation-selector', i, j, decodeVS(cps.slice(i, j).map((x) => x.codePointAt(0))));
      }
      i = j - 1;
      continue;
    }

    if (ZW.has(c)) {
      let j = i;
      while (j < n && ZW.has(cp(j)) && !protectedAt[j]) j += 1;
      const run = cps.slice(i, j).map((x) => x.codePointAt(0));
      const prev = cps[i - 1] ?? '';
      const next = cps[j] ?? '';
      // Joiners between letters/marks of a script that uses them survive.
      const joinerOnly = run.every((x) => x === 0x200c || x === 0x200d);
      const legitJoiner =
        joinerOnly &&
        j - i === 1 &&
        (LETTER.test(prev) || MARK.test(prev)) &&
        JOINER_RE.some(
          (re) =>
            re.test(prev) &&
            (LETTER.test(next) ? re.test(next) : run[0] === 0x200d && VIRAMA_RE.test(prev)),
        );
      if (legitJoiner) {
        i = j - 1;
        continue;
      }
      if (j - i >= 4) {
        drop(i, j, 'zeroWidthRun', true);
        payload('zero-width-binary', i, j, decodeZW(run));
      } else if (run.every((x) => x === 0xfeff) && i === 0) {
        drop(i, j, 'bom', false);
      } else if ((prev === '' || WS.test(prev)) && (next === '' || WS.test(next))) {
        drop(i, j, 'zeroWidth', false); // isolated: splits nothing
      } else if (ZWSP_HINT_RE.test(prev) && ZWSP_HINT_RE.test(next)) {
        drop(i, j, 'zeroWidth', false); // line-break hint in Thai/CJK/…
      } else {
        // Attached to a word on at least one side ("ad<ZWJ>min", "at<ZWJ> Orly",
        // "is_<ZWSP>admin", a broken emoji ZWJ sequence): evades exact matching.
        drop(i, j, 'zeroWidthInWord', true);
      }
      i = j - 1;
    }
  }
  const cleaned = cps.map((ch, i) => (keep[i] ? ch : (replaceWith[i] ?? ''))).join('');
  // Counting unit = words: a whitespace-delimited chunk with at least one
  // COUNTED removal counts once, however long its payload; a run standing
  // alone between words is its own chunk, so it counts once too.
  // Per-code-point detail stays in the findings.
  const findings = [];
  for (let i = 0; i < n;) {
    if (WS.test(cps[i])) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < n && !WS.test(cps[j])) j += 1;
    const removed = {};
    let hit = false;
    for (let k = i; k < j; k += 1)
      if (clsAt[k]) {
        removed[clsAt[k][0]] = (removed[clsAt[k][0]] ?? 0) + 1;
        hit ||= clsAt[k][1];
      }
    if (hit) findings.push({ word: cps.slice(i, j).join(''), index: offs[i], removed });
    i = j;
  }
  return {
    cleaned,
    hiddenWords: findings.length,
    findings,
    removed: { counted, silent },
    payloads,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path =
    process.argv[2] ??
    (console.error('usage: node scripts/prototype-cleanup.mjs <cases.mjs>'), process.exit(2));
  const { cases } = await import(pathToFileURL(path).href);
  const enc = (s) => [...s].map((c) => String.fromCodePoint(0xe0000 + c.codePointAt(0))).join('');
  const vsenc = (s) =>
    [...new TextEncoder().encode(s)]
      .map((b) => String.fromCodePoint(b < 16 ? 0xfe00 + b : 0xe0100 + b - 16))
      .join('');
  const zwenc = (s) =>
    [...new TextEncoder().encode(s)]
      .map((b) => b.toString(2).padStart(8, '0').replace(/0/g, '​').replace(/1/g, '‌'))
      .join('');
  const extra = {
    vsSuppSingle: 'x\u{E0110}',
    emojiVsPayload: '😀' + vsenc('hi!'),
    tagAfterEmoji: '😀' + enc('ignore'),
    zwBinary: 'ok ' + zwenc('pwn') + ' ok',
    zwIsolated: 'a ​ b',
    bomStart: '﻿hello',
    hebrewRLO: 'של‮ום',
    arabicTag: 'مي' + enc('hi') + 'خ',
    persianZWSPrun: 'می​​​​​خواهم',
    zwnjBetweenSpaces: 'a ‌ b',
    keycap: '1️⃣',
    rliHebrew: 'abc ⁧שלום⁩ def',
    rliNoRtl: 'abc ⁧def⁩',
    nbsp: 'a b c',
    shyCyr: 'ко\u00ADшка',
    twoWords: 'fr\u200bee mon\u200bey ' + enc('x'.repeat(200)),
    arabicNumberSign: '\u0600١٢٣',
    fnApp: 'adm\u2061in',
    ivs3: '辻\u{E0100}\u{E0101}\u{E0102}',
    emojiVs16: '☺️',
    vs16OnLetter: 'a️',
  };
  const show = (s) =>
    [...s]
      .map((c) =>
        c.codePointAt(0) > 127 && !/[\p{L}\p{Extended_Pictographic}]/u.test(c)
          ? `<${c.codePointAt(0).toString(16)}>`
          : c,
      )
      .join('')
      .replace(/(<[0-9a-f]+>)\1{3,}/g, (m, u) => `${u}×${m.length / u.length}`);
  for (const [k, s] of Object.entries({ ...cases, ...extra })) {
    const r = cleanup(s);
    const c = Object.entries(r.removed.counted)
      .filter(([, v]) => v)
      .map(([k2, v]) => `${k2}=${v}`)
      .join(',');
    const si = Object.entries(r.removed.silent)
      .filter(([, v]) => v)
      .map(([k2, v]) => `${k2}=${v}`)
      .join(',');
    const p = r.payloads
      .map(
        (x) =>
          `${x.kind}:${x.decoded !== null ? JSON.stringify(x.decoded.length > 24 ? x.decoded.slice(0, 24) + '…' : x.decoded) : 'hex ' + x.bytesHex}`,
      )
      .join(' ');
    console.log(
      `| ${k} | ${show(s)} | ${r.cleaned === s ? '=' : show(r.cleaned)} | ${r.hiddenWords} | ${c} | ${si} | ${p} |`,
    );
  }
}
