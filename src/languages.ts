/**
 * Language alphabets inside the model scripts, positional spelling rules and
 * Russian case endings — docs/confusion-model.md §4.4, §4.5, §4.7, §4.1.
 * Letters are lowercase. A precomposed letter an alphabet lists (`й ё ї ў ѓ ќ ӣ ӯ`) is a
 * letter of its own, never its base (Per-language rule: `ё` is no Ukrainian `е`); other
 * marks are diacritics, judged by their base letter (Greek tonos, Latin accents).
 */

const RU = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя';
const without = (a: string, drop: string) => [...a].filter((c) => !drop.includes(c)).join('');

/** Script of a language: one of the confusion model's target-capable scripts. */
export type LanguageScript = 'Latin' | 'Cyrillic' | 'Greek';

/** Letter sets per language, grouped by script (§4.4). */
export const LANGUAGES = {
  Cyrillic: {
    Russian: RU,
    Ukrainian: without(RU, 'ъыэё') + 'ґєії',
    Belarusian: without(RU, 'щъ') + 'іў',
    Bulgarian: without(RU, 'ыэё'),
    Serbian: 'абвгдђежзијклљмнњопрстћуфхцчџш',
    Macedonian: 'абвгдѓежзѕијклљмнњопрстќуфхцчџш',
    Kazakh: RU + 'әғқңөұүһі',
    Tajik: without(RU, 'щыьц') + 'ғқҳҷӣӯ',
    Uzbek: without(RU, 'щы') + 'қғҳў',
    // Chechen, Ingush, Avar, Kabardian, Adyghe, Lak, Dargwa: Russian + palochka,
    // which only follows one of PALOCHKA_AFTER (or starts the word).
    Caucasian: RU + 'ӏ',
  },
  Greek: { Greek: 'αβγδεζηθικλμνξοπρσςτυφχψω' },
  Latin: {
    English: 'abcdefghijklmnopqrstuvwxyz',
    European: 'abcdefghijklmnopqrstuvwxyzßæœøþðıłđ',
  },
} as const satisfies Record<LanguageScript, Record<string, string>>;

/** Precomposed letters some alphabet lists: each is a letter of its own (never its NFD base). */
export const PRECOMPOSED_LETTERS: ReadonlySet<string> = new Set(
  Object.values(LANGUAGES)
    .flatMap((ls) => Object.values(ls) as string[])
    .flatMap((l) => [...l])
    .filter((c) => c.normalize('NFD') !== c),
);

/**
 * A letter as the alphabets list it, lowercase: a listed precomposed letter (`ё`, also
 * written `е` + U+0308) itself, any other letter its NFD base (`é` → `e`, `ά` → `α`).
 */
const KEYS = new Map<string, string>();
export function letterKey(c: string): string {
  let k = KEYS.get(c);
  if (k === undefined) {
    k = keyOf(c);
    if (KEYS.size < 65536) KEYS.set(c, k);
  }
  return k;
}
function keyOf(c: string): string {
  const low = c.toLowerCase();
  const nfc = String.fromCodePoint(low.normalize('NFC').codePointAt(0)!);
  if (PRECOMPOSED_LETTERS.has(nfc)) return nfc;
  return String.fromCodePoint(low.normalize('NFD').codePointAt(0)!);
}

/** A language of {@link LANGUAGES}; any of them can be a fold target (§4.5). */
export type TargetLanguage = {
  [S in LanguageScript]: keyof (typeof LANGUAGES)[S];
}[LanguageScript];

/** Every language with its script and letters, in declaration order. */
export const TARGET_LANGUAGES: Readonly<
  Record<TargetLanguage, { script: LanguageScript; letters: string }>
> = Object.fromEntries(
  (Object.entries(LANGUAGES) as [LanguageScript, Record<string, string>][]).flatMap(([S, ls]) =>
    Object.entries(ls).map(([name, letters]) => [name, { script: S, letters }]),
  ),
) as Record<TargetLanguage, { script: LanguageScript; letters: string }>;

/** Every letter of `text` is a letter of language `L` (by {@link letterKey}); false with no letter. */
export function inLanguage(L: TargetLanguage, text: Iterable<string>): boolean {
  const ls = TARGET_LANGUAGES[L].letters;
  let any = false;
  for (const c of text) {
    if (!/\p{L}/u.test(c)) continue;
    if (!ls.includes(letterKey(c))) return false;
    any = true;
  }
  return any;
}

/** Default fold destinations. */
export const DEFAULT_TARGET_LANGUAGES: readonly TargetLanguage[] = [
  'English',
  'Russian',
  'Ukrainian',
  'Greek',
];

export const PALOCHKA = new Set(['ӏ', 'Ӏ']);
export const PALOCHKA_AFTER = new Set([...'гдклптфхцчшщжсз']);
const VOWELS = new Set([...'аеиоуыэюяіїєәөұү']);
const LOWER_ONLY_CAPS = new Set(['Ь', 'Ъ']);

/**
 * A positional rule over a word's lowercased NFD base letters (`w`), the same
 * letters with case (`raw`), and whether the token ends in an apostrophe.
 * Returns true when the word obeys it.
 */
export interface OrthographyRule {
  name: string;
  test: (w: readonly string[], raw: readonly string[], elided: boolean) => boolean;
}
const rule = (name: string, test: OrthographyRule['test']): OrthographyRule => ({ name, test });
const softHardNotInitial = rule('softHardNotInitial', (w) => w[0] !== 'ь' && w[0] !== 'ъ');
const softNotInitial = rule('softNotInitial', (w) => w[0] !== 'ь');
const hardNotInitial = rule('hardNotInitial', (w) => w[0] !== 'ъ');
const yeryNotInitial = rule('yeryNotInitial', (w) => w[0] !== 'ы');
const softHardNotAfterVowel = rule(
  'softHardNotAfterVowel',
  (w) => !w.some((c, i) => (c === 'ь' || c === 'ъ') && i > 0 && VOWELS.has(w[i - 1]!)),
);
const softNotAfterVowel = rule(
  'softNotAfterVowel',
  (w) => !w.some((c, i) => c === 'ь' && i > 0 && VOWELS.has(w[i - 1]!)),
);
// A capital Ь/Ъ after the first letter of a word that has lowercase letters.
const capitalSignOnlyInCaps = rule(
  'capitalSignOnlyInCaps',
  (_w, raw) =>
    !raw.some((c, i) => i > 0 && LOWER_ONLY_CAPS.has(c)) || raw.every((c) => c === c.toUpperCase()),
);
// ς only word-final; lowercase σ never word-final (except elided, μέσ').
const finalSigma = rule(
  'finalSigma',
  (_w, raw, elided) =>
    !raw.some(
      (c, i) => (c === 'ς' && i < raw.length - 1) || (c === 'σ' && i === raw.length - 1 && !elided),
    ),
);

/**
 * Positional spelling rules per language (§4.7). Only positional rules:
 * nothing that tells ь from ъ (native writers mix them up).
 */
export const ORTHOGRAPHY: Partial<Record<TargetLanguage, readonly OrthographyRule[]>> = {
  Russian: [softHardNotInitial, yeryNotInitial, softHardNotAfterVowel, capitalSignOnlyInCaps],
  Ukrainian: [softNotInitial, softNotAfterVowel, capitalSignOnlyInCaps],
  Belarusian: [softNotInitial, yeryNotInitial, softNotAfterVowel, capitalSignOnlyInCaps],
  // Bulgarian ъ is a vowel (ъгъл, Ървин): only the soft sign is positional.
  Bulgarian: [softNotInitial, softNotAfterVowel, capitalSignOnlyInCaps],
  // Kazakh native words start with ы (ыдыс).
  Kazakh: [softHardNotInitial, softHardNotAfterVowel, capitalSignOnlyInCaps],
  Caucasian: [softHardNotInitial, yeryNotInitial, softHardNotAfterVowel, capitalSignOnlyInCaps],
  // Tajik/Uzbek ъ marks a glottal stop and follows vowels (маъно).
  Tajik: [hardNotInitial, capitalSignOnlyInCaps],
  Uzbek: [softHardNotInitial, softNotAfterVowel, capitalSignOnlyInCaps],
  Greek: [finalSigma],
};

/** Letters some positional rule looks at; a word without them obeys every rule. */
export const RULE_LETTERS = new Set([...'ьъыЬЪЫσςӏӀ']);

/**
 * Russian case endings accepted after an apostrophe on a Latin stem
 * ("GitHub'а", "Excel'е", "iPhone’ов"). Anything else is analyzed whole.
 */
export const RU_CASE_ENDINGS: ReadonlySet<string> = new Set(
  'а я у ю е и ы ом ем ём ой ей ою ею ов ев ёв ам ям ах ях ами ями'.split(' '),
);
