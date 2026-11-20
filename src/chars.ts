/** Character classes of the hidden-character detectors (docs/confusion-model.md §6, §15). */

import { scriptsWith } from './scriptinfo';

/** An RTL character. U+061C is a mark with Script=Arabic: it says nothing about the text it sits in. */
export const RTL_RE =
  /(?!؜)[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Adlam}\p{Script=Samaritan}\p{Script=Mandaic}]/u;
export const LETTER_RE = /^\p{L}/u;
export const MARK_RE = /^\p{M}/u;
export const EMOJI_RE = /^\p{Emoji}/u;
export const MATH_RE = /^\p{Sm}/u;
export const HAN_RE = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
export const IDEOGRAPH_RE = /^\p{Script=Han}/u;
export const MONGOLIAN_RE = /^\p{Script_Extensions=Mongolian}/u;
/** A letter of a script written without spaces (decision 39's `spaceless`): a zero-width run between two is a word-break hint. */
export const ZWSP_HINT_RE = new RegExp(
  `^[${scriptsWith('spaceless')
    .map((k) => `\\p{Script=${k}}`)
    .join('')}]`,
  'u',
);
export const VIRAMA_RE = /^[्্੍્୍்్್്්္်្]/u;
/** Scripts whose orthography uses ZWNJ/ZWJ between letters. */
export const JOINER_RE = [
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
].map((s) => new RegExp(`^\\p{Script_Extensions=${s}}`, 'u'));
export const KHMER_RE = /^\p{Script_Extensions=Khmer}/u;
export const KAITHI_RE = /^\p{Script_Extensions=Kaithi}/u;
/** Characters an emoji sequence is built from; a hidden run touching one may be inside a sequence. */
export const EMOJI_SEQ_RE =
  // eslint-disable-next-line no-misleading-character-class -- a code point list, not graphemes
  /^[\p{Emoji}\p{Emoji_Component}\p{Emoji_Modifier}‍️⃣\u{E0020}-\u{E007F}]/u;
let rgiRe: RegExp | null = null;
export const rgi = () => (rgiRe ??= new RegExp('\\p{RGI_Emoji}', 'vy'));

export const isZW = (cp: number) =>
  cp === 0x200b || cp === 0x200c || cp === 0x200d || cp === 0x2060 || cp === 0xfeff;
export const isBidiEmbed = (cp: number) => cp >= 0x202a && cp <= 0x202e;
export const isBidiSoft = (cp: number) =>
  cp === 0x200e || cp === 0x200f || cp === 0x061c || (cp >= 0x2066 && cp <= 0x2069);
export const isVS = (cp: number) =>
  (cp >= 0xfe00 && cp <= 0xfe0f) ||
  (cp >= 0xe0100 && cp <= 0xe01ef) ||
  (cp >= 0x180b && cp <= 0x180d) ||
  cp === 0x180f;
export const isTag = (cp: number) => cp >= 0xe0000 && cp <= 0xe007f;
export const isOtherInvisible = (cp: number) =>
  cp === 0x180e ||
  (cp >= 0x2061 && cp <= 0x2065) ||
  cp === 0x034f ||
  (cp >= 0x206a && cp <= 0x206f) ||
  (cp >= 0xfff0 && cp <= 0xfffb) ||
  (cp >= 0x1d173 && cp <= 0x1d17a) ||
  (cp >= 0x1bca0 && cp <= 0x1bca3) ||
  (cp >= 0x13430 && cp <= 0x1343f) ||
  (cp >= 0xe0080 && cp <= 0xe00ff) ||
  (cp >= 0xe01f0 && cp <= 0xe0fff);
export const isBidi = (cp: number) => isBidiEmbed(cp) || isBidiSoft(cp);
export const isBlank = (cp: number) =>
  cp === 0x115f ||
  cp === 0x1160 ||
  cp === 0x3164 ||
  cp === 0xffa0 ||
  cp === 0x2800 ||
  cp === 0x1d159;
/** Characters that can carry a run of bits; tags and selectors have their own encodings. */
export const isCarrier = (cp: number) =>
  isZW(cp) ||
  cp === 0x00ad ||
  isBidiEmbed(cp) ||
  isBidiSoft(cp) ||
  isBlank(cp) ||
  isOtherInvisible(cp);
/** JS `\s` minus U+FEFF (a hidden character here, not a separator). */
export const isWS = (cp: number) =>
  cp === 0x20 ||
  (cp >= 0x09 && cp <= 0x0d) ||
  cp === 0xa0 ||
  cp === 0x1680 ||
  (cp >= 0x2000 && cp <= 0x200a) ||
  cp === 0x2028 ||
  cp === 0x2029 ||
  cp === 0x202f ||
  cp === 0x205f ||
  cp === 0x3000;
export const cpLen = (cp: number) => (cp > 0xffff ? 2 : 1);

/** The whole character ending at code unit `i` (exclusive), or ''. */
export function charBefore(text: string, i: number): string {
  if (i <= 0) return '';
  const u = text.charCodeAt(i - 1);
  if (u >= 0xdc00 && u <= 0xdfff && i >= 2) {
    const h = text.charCodeAt(i - 2);
    if (h >= 0xd800 && h <= 0xdbff) return text.slice(i - 2, i);
  }
  return text[i - 1]!;
}
export function charAt(text: string, i: number): string {
  if (i >= text.length) return '';
  const cp = text.codePointAt(i)!;
  return cp > 0xffff ? text.slice(i, i + 2) : text[i]!;
}
