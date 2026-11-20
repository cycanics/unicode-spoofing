/**
 * The confusion model (src/confusion.ts, src/languages.ts): case-specific
 * twins, target restriction, conditional twins, positional spelling rules,
 * foreign-letter / case-anomaly / donor evidence (docs/confusion-model.md
 * §3, §4.4–4.7).
 */
import { describe, expect, it } from 'vitest';
import {
  buildLookalikes,
  CONDITIONAL_TWINS,
  createConfusionModel,
  DEFAULT_CONDITIONAL_TWINS,
  twinsOf,
} from '../src/confusion';
import { DEFAULT_TARGET_LANGUAGES, RU_CASE_ENDINGS, TARGET_LANGUAGES } from '../src/languages';

const model = createConfusionModel();
const ALPHA = ['Latin', 'Cyrillic', 'Greek', 'Armenian', 'Cherokee', 'Coptic', 'LatinExtra'];
const valid = (w: string) => model.inspect(w).valid.map((a) => ALPHA[a]);
const evidence = (w: string) => model.inspect(w).evidence;

/** camelCase / brand / formula / Caucasian / Cyrillic-brand tokens (scripts/measure-false-positives.mjs). */
const CASE_LEGIT = (
  'iPhone GitHub McDonald eBay YouTube PayPal LinkedIn iOS macOS WiFi JavaScript DeepL NaI AgI PbI2 ' +
  'CsI getId userId isIn openAI OpenAI SwiftUI PowerBI WWII HenryVIII XboX iPadOS ChatGPT TikTok WhatsApp ' +
  'DuckDuckGo SharePoint AdobeXD LouisXIV MySQL PostgreSQL GraphQL jQuery iCloud iMac eID ' +
  'Кӏант кӏорни хӏума дӏа маӏа Коммерсантъ КамАЗ ВкусВилл МосГорТранс ъгъл ыдыс'
).split(' ');

describe('defaults', () => {
  it('targets English, Russian, Ukrainian, Greek; donors are the other alphabets', () => {
    expect(DEFAULT_TARGET_LANGUAGES).toEqual(['English', 'Russian', 'Ukrainian', 'Greek']);
    // Donor: letters of scripts outside the table that a look-alike pack maps (decision 40).
    expect(model.donorAlphabets).toEqual(['Armenian', 'Cherokee', 'Coptic', 'LatinExtra', 'Donor']);
    expect([...DEFAULT_CONDITIONAL_TWINS].sort()).toEqual(['χ~x', 'χ~х', 'ҳ~x', 'ҳ~χ'].sort());
    expect(Object.keys(CONDITIONAL_TWINS)).toHaveLength(13); // 40g: п~n is an ordinary pair
    expect(Object.keys(TARGET_LANGUAGES)).toContain('Kazakh');
    expect(RU_CASE_ENDINGS.has('ами')).toBe(true);
  });
  it('is cached per option set', () => {
    expect(createConfusionModel()).toBe(model);
    expect(createConfusionModel({ conditionalTwins: [] })).not.toBe(model);
  });
});

describe('twins are case-specific (§3.2)', () => {
  it.each([
    ['В', 'Latin', 'B'],
    ['в', 'Latin', null],
    ['Т', 'Latin', 'T'],
    ['т', 'Latin', null],
    ['Н', 'Latin', 'H'],
    ['н', 'Latin', null],
    ['М', 'Latin', 'M'],
    ['м', 'Latin', null],
    ['к', 'Latin', null],
    ['κ', 'Latin', null],
    ['р', 'Latin', 'p'],
    ['ш', 'Latin', 'w'],
    ['ω', 'Latin', 'w'],
    ['σ', 'Latin', 'o'],
    ['І', 'Latin', 'I'],
    ['Ь', 'Latin', 'b'],
    ['p', 'Cyrillic', 'р'],
    ['k', 'Cyrillic', null],
    ['n', 'Greek', null],
  ] as const)('%s → %s: %s', (c, T, want) => {
    expect(model.twinIn(c, T)).toBe(want);
  });
  it('allows only the four directional cross-case folds', () => {
    expect(model.twinIn('І', 'Latin', false)).toBe('l');
    expect(model.twinIn('Ӏ', 'Latin', false)).toBe('l');
    expect(model.twinIn('Ι', 'Latin', false)).toBe('l');
    expect(model.twinIn('l', 'Cyrillic')).toBeNull(); // ӏ is a source, never a target
  });
});

describe('target restriction (§4.5)', () => {
  it('folds only into letters of an enabled target language', () => {
    expect(model.twinIn('s', 'Cyrillic')).toBeNull(); // ѕ is Macedonian
    expect(model.twinIn('i', 'Cyrillic')).toBe('і'); // Ukrainian is a default target
    const enRu = createConfusionModel({ targetLanguages: ['English', 'Russian'] });
    expect(enRu.twinIn('i', 'Cyrillic')).toBeNull();
    expect(enRu.twinIn('a', 'Greek')).toBeNull(); // Greek not a target
    expect(enRu.donorAlphabets).toContain('Greek');
  });
  it('lists unrestricted twins via twinsOf', () => {
    expect(twinsOf('s').Cyrillic).toEqual(['ѕ']);
    expect(twinsOf('x').Greek).toEqual(['χ']);
    expect(twinsOf('x', { conditionalTwins: [] }).Greek).toBeUndefined();
  });
});

describe('conditional twins (§3.3)', () => {
  it('descender twins on by default', () => {
    expect(model.twinIn('χ', 'Latin')).toBe('x');
    expect(model.twinIn('ҳ', 'Latin')).toBe('x');
    expect(model.twinIn('Ҳ', 'Latin')).toBe('X');
    expect(createConfusionModel({ conditionalTwins: [] }).twinIn('χ', 'Latin')).toBeNull();
  });
  it('italic twins off by default', () => {
    expect(model.twinIn('и', 'Latin')).toBeNull();
    expect(createConfusionModel({ conditionalTwins: ['и~u'] }).twinIn('и', 'Latin')).toBe('u');
  });
  it('intra-Latin conditional twins carry conditional evidence only when enabled', () => {
    expect(evidence('ŋame')).toEqual({ kind: 'foreign', letters: 'ŋ' }); // Greek η lookalike
    const m = createConfusionModel({ conditionalTwins: ['ŋ~n'] });
    expect(m.inspect('ŋame').evidence).toEqual({ kind: 'conditional', letters: 'ŋ' });
  });
  it('ı → i is in the default English pack; an intra-Latin fold needs a target-language result', () => {
    expect(evidence('lınk')).toEqual({ kind: 'conditional', letters: 'ı' });
    expect(evidence('Lınkedin')).toEqual({ kind: 'conditional', letters: 'ı' });
    for (const w of ['ışık', 'kışın', 'ığdır', 'Iğdır']) expect(evidence(w)).toBeNull(); // ş ğ: not English
    const off = createConfusionModel({
      lookalikes: buildLookalikes({ remove: { English: [['ı', 'i']], European: [['ı', 'i']] } }),
    });
    expect(off.inspect('lınk').evidence).toBeNull();
    const n = createConfusionModel({ conditionalTwins: ['ŋ~n'] });
    // é: not English; ŋ's only twin under the call's mapping is Latin n, so it is no proof (40d).
    expect(n.inspect('ŋamé').evidence).toBeNull();
  });
  it('rejects unknown ids', () => {
    expect(() => createConfusionModel({ conditionalTwins: ['x~y' as never] })).toThrow();
  });
});

describe('validity and proof letters', () => {
  it.each([
    ['Пpивет', ['Cyrillic']],
    ['HОT', ['Latin', 'Cyrillic', 'Greek']],
    ['quіск', []],
    ['кey', ['Cyrillic']],
    ['раураl', ['Latin']],
    ['иser', []],
    ['Kαλημέρα', ['Greek']],
    ['dog', ['Latin']],
  ])('%s fits %j', (w, want) => {
    expect(valid(w)).toEqual(want);
  });
  it('rejects a target whose fold breaks its positional rules', () => {
    expect(model.inspect('paᏏy').rejected).toEqual({ Cyrillic: 'softHardNotAfterVowel' });
  });
});

describe('evidence (§4.4–4.7)', () => {
  it('foreign lookalike letters', () => {
    expect(evidence('аррӏе')).toEqual({ kind: 'foreign', letters: 'ӏ' });
    expect(evidence('ԁоm')).toBeNull(); // not a whole-script word
    expect(evidence('җир')).toBeNull(); // Tatar җ has no twin: unmodelled language
  });
  it('case anomaly on the last letter only', () => {
    expect(evidence('paypaI')).toEqual({ kind: 'case', letters: 'I' });
    expect(evidence('раураӏ')).toEqual({ kind: 'case', letters: 'ӏ' });
    expect(evidence('gmaiI')).toEqual({ kind: 'case', letters: 'I' });
    expect(evidence('goIang')).toBeNull();
    expect(evidence('NaI')).toBeNull();
  });
  it('positional spelling rules narrow targets; they are no evidence (decision 40e)', () => {
    const lv = (w: string, S: number) => model.languageViolation([...w], S);
    expect(lv('Ьр', 1)).toEqual({ kind: 'orthography', rule: 'softHardNotInitial' });
    expect(lv('оьо', 1)).toEqual({ kind: 'orthography', rule: 'softHardNotAfterVowel' });
    expect(lv('μέσοσ'.normalize('NFD').replace(/\p{M}/gu, ''), 2)).toEqual({
      kind: 'orthography',
      rule: 'finalSigma',
    });
    for (const w of ['Ьр', 'оьо', 'μέσοσ', 'ъгъл']) expect(evidence(w)).toBeNull();
    // Decision 40d: only requested languages count; with Bulgarian requested `ъгъл` fits.
    const bk = createConfusionModel({ targetLanguages: ['Russian', 'Bulgarian', 'Kazakh'] });
    expect(bk.languageViolation([...'ъгъл'], 1)).toBeNull();
    expect(lv('ъгъл', 1)).toEqual({ kind: 'orthography', rule: 'softHardNotInitial' });
    expect(evidence('Коммерсантъ')).toBeNull();
    expect(evidence('μέσος')).toBeNull();
    expect(model.languageViolation(['μ', 'έ', 'σ'], 2, true)).toBeNull(); // elided μέσ'
  });
  it('donor-only words', () => {
    expect(evidence('ᴀᴅᴍɪɴ')).toEqual({ kind: 'donor', letters: '' });
    expect(evidence('İstanbul')).toBeNull();
    expect(evidence('ışık')).toBeNull(); // ş: the fold is no English word (§3.3)
  });
  it('leaves the CASE_LEGIT list clean except Chechen маӏа (foreign, harmless) when its languages are requested', () => {
    // Decision 40d: Caucasian, Bulgarian and Kazakh words are legitimate only when requested.
    const all = createConfusionModel({
      targetLanguages: [
        'English',
        'Russian',
        'Ukrainian',
        'Greek',
        'Bulgarian',
        'Kazakh',
        'Caucasian',
      ],
    });
    expect(CASE_LEGIT.filter((t) => all.inspect(t).evidence)).toEqual(['маӏа']);
    const hit = CASE_LEGIT.filter((t) => evidence(t));
    expect(hit).toEqual(['Кӏант', 'кӏорни', 'хӏума', 'дӏа', 'маӏа']);
    expect(model.inspect('маӏа').valid.filter((a) => a !== 1)).toEqual([]);
  });
});

describe('per-code-point facts', () => {
  it('judges precomposed letters by their base', () => {
    const e = model.info('é'.codePointAt(0)!);
    expect(e & 0xf).toBe(model.info('e'.codePointAt(0)!) & 0xf);
    expect(valid('Ёлкa')).toEqual(['Cyrillic']);
  });
});
