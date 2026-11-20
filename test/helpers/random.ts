/** Seeded random inputs shared by the parity, fuzz and stress tests. */

/** The prototype's random alphabet (scripts/prototype-finding-callback.mjs) minus U+009B and U+E0151. */
export const ALPHABET = [
  'a', 'b', 'e', 'o', 'р', 'е', 'ש', 'ل', 'ม', '辻', '😀', '❤', '1', ' ', ' ', '\n', '.',
  '́', '̈', '้', '​', '‌', '‍', '⁠', '﻿', '­',
  '‮', '‭', '‫', '‬', '⁧', '⁩', '‎', '‏', '️',
  '︀', '\u{E0100}', '\u{E0041}', '\u{E007F}', '͏', '⁢', 'ㅤ', '⠀',
  '\u0007', '\u001B[31m', '\u001B', '\u000B', '\u001C', '\u0085', '\u0008', '឴', 'Pа',
  'ypаl', '�', 'Ⓐ', 'ⓑ',
]; // prettier-ignore
export const MARK_HEAVY = ALPHABET.concat(...Array<string[]>(7).fill(['́', '̈', '้']));

/** Seeded random strings (the prototype's generator). */
export function randomStrings(n: number, alphabet = ALPHABET, seed0 = 7): string[] {
  let seed = seed0;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  return Array.from({ length: n }, () =>
    Array.from(
      { length: 1 + Math.floor(rnd() * 24) },
      () => alphabet[Math.floor(rnd() * alphabet.length)],
    ).join(''),
  );
}

/** Words over 250 code points, in several scripts (the gap review 5 found). */
export const LONG = [
  'а'.repeat(125) + 'a'.repeat(126),
  'x '.repeat(3) + 'Pа'.repeat(200) + ' y',
  '漢'.repeat(300) + ' ok',
  'deadbeef'.repeat(40),
  'fr​ee'.repeat(80),
  'ⓐ'.repeat(260) + ' z',
];
/** Words of look-alikes from two or more non-target scripts (review 11): the upstream reference build folds and flags them. */
export const DONOR_MIX = ['Visit ᎪᏢᏢꓡꓰ today', 'Login to ꓑꓮᎩꓑꓮꓡ now', 'ᏀꓳꓳᏀꓡꓰ', 'ᑲყ', 'a 𐐽ס𑣘וᑯ b'];
