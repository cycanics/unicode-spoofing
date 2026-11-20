/**
 * Options for the upstream reference build (test/fixtures/reference/main.mjs), whose API
 * differs: `confusionModel` takes `'alphabet'` and `'latin'`, and `inputLanguages` goes as
 * its `expectedScripts`, the scripts of those languages' letters (it has no languages).
 */
import { TARGET_LANGUAGES, type TargetLanguage } from '../../src/languages';

const OLD_MODEL: Record<string, string> = { language: 'alphabet', 'latin-fold': 'latin' };

export function mainOptions<T extends object | undefined>(o: T): T {
  if (!o) return o;
  const { confusionModel, inputLanguages, ...rest } = o as {
    confusionModel?: string;
    inputLanguages?: readonly TargetLanguage[];
  };
  return {
    ...rest,
    ...(confusionModel !== undefined && {
      confusionModel: OLD_MODEL[confusionModel] ?? confusionModel,
    }),
    ...(inputLanguages && {
      expectedScripts: [...new Set(inputLanguages.map((n) => TARGET_LANGUAGES[n].script))],
    }),
  } as T;
}
