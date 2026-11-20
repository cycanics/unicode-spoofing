#!/usr/bin/env node
/**
 * PROTOTYPE — the confusion-model resolver from docs/confusion-model.md §4.
 * Not wired into src/; run it directly:
 *
 *   node scripts/prototype-resolve.mjs                    # built-in probe list
 *   node scripts/prototype-resolve.mjs 'Пpивет' 'HОT'     # each argument is one text
 *   --whole-script-fold=off|foreign-letters|all           # §4.3 (default all)
 *   --twins=id,id|none                                    # §3.3 conditional twins (default: x-likes)
 *   --targets=English,Russian,…                           # §4.5 target languages (default English,Russian)
 *   --donors=Armenian,Cherokee,…                          # §3.4 donor alphabets (default: all non-target)
 *   --step5-own-scripts                                   # measurement: step 5 only into own scripts
 */
import { fileURLToPath } from 'node:url';
import {
  derive,
  alphabetOf,
  ALPHABETS,
  DEFAULT_CONDITIONAL_TWINS,
  SCRIPT_OF_ALPHABET,
} from './derive-confusion-table.mjs';

/** All alphabets of the twin table: Latin, Cyrillic, Greek, Armenian, Cherokee, Coptic, LatinExtra. */
const ALL_MODEL = Object.keys(ALPHABETS);
const SCRIPT_RE = Object.fromEntries(
  ALL_MODEL.map((s) => [s, new RegExp(`\\p{Script=${SCRIPT_OF_ALPHABET[s] ?? s}}`, 'u')]),
);
const LETTER = /\p{L}/u;
const MARK = /\p{M}/u;
const TOKEN_RE = /[\p{L}\p{M}\p{N}\p{Cf}'’]+/gu;
const isUpper = (c) => c !== c.toLowerCase();

/** Alphabet of a base letter in the full table, or null (outside every alphabet). */
const baseScriptOf = (c) =>
  alphabetOf.get(c) ?? ALL_MODEL.find((s) => SCRIPT_RE[s].test(c)) ?? null;

/**
 * Fold TARGETS are restricted to the core alphabet: Komi "ԁ" or palochka "ӏ"
 * are folded FROM (they are Latin lookalikes) but a Latin letter is never
 * folded INTO them — otherwise every Latin "l" would read as Cyrillic "ӏ".
 */
const CORE = {
  Latin: (c) => /^[A-Za-z]$/.test(c),
  Cyrillic: (c) => {
    const cp = c.codePointAt(0);
    return (cp >= 0x400 && cp <= 0x45f) || cp === 0x490 || cp === 0x491;
  },
  Greek: (c) => {
    const cp = c.codePointAt(0);
    return cp >= 0x391 && cp <= 0x3c9;
  },
};
const isCore = (c, T) => (CORE[T] ? CORE[T](c) : true);

/**
 * Cross-case twins (UTS #39 clusters ignore case: Cyrillic capital "І" sits
 * with Latin small "l") do not count — the model is case-specific — except
 * these directional source→target folds ("paypaІ", "Ьank").
 */
const CROSS_CASE_ALLOWED = new Set(['І>l', 'Ӏ>l', 'Ι>l', 'Ь>b']);

/**
 * Russian case endings accepted after an apostrophe on a Latin stem
 * ("GitHub'а", "Excel'е", "iPhone’ов"). Anything else is analyzed whole.
 */
export const RU_CASE_ENDINGS = new Set(
  'а я у ю е и ы ом ем ём ой ей ою ею ов ев ёв ам ям ах ях ами ями'.split(' '),
);
const APOSTROPHE_ENDING = /^(.*\p{Script=Latin}.*)(['’])(\p{Script=Cyrillic}{1,3})$/u;

/**
 * Language alphabets inside a script (§4.4), as NFD base letters, lowercase.
 * A word whose letters fit no language of its script carries "foreign-letter"
 * evidence: it is not that script in disguise-free form.
 */
const RU = 'абвгдежзийклмнопрстуфхцчшщъыьэюя';
const without = (a, drop) => [...a].filter((c) => !drop.includes(c)).join('');
export const LANGUAGES = {
  Cyrillic: {
    Russian: RU,
    Ukrainian: without(RU, 'ъыэ') + 'ґєі',
    Belarusian: without(RU, 'щъ') + 'і', // ў = у + breve; й keeps и as base
    Bulgarian: without(RU, 'ыэ'),
    Serbian: 'абвгдђежзијклљмнњопрстћуфхцчџш',
    Macedonian: 'абвгдежзѕијклљмнњопрстуфхцчџш', // ѓ ќ = г к + acute
    Kazakh: RU + 'әғқңөұүһі',
    // ҳ is a model letter (descender twin, §3.3), so the languages that use it are modelled.
    Tajik: without(RU, 'щыьц') + 'ғқҳҷ', // ӣ ӯ = и у + macron
    Uzbek: without(RU, 'щы') + 'қғҳ', // ў = у + breve
    // Chechen, Ingush, Avar, Kabardian, Adyghe, Lak, Dargwa: Russian + palochka,
    // and the palochka only follows one of PALOCHKA_AFTER (or starts the word).
    Caucasian: RU + 'ӏ',
  },
  Greek: { Greek: 'αβγδεζηθικλμνξοπρσςτυφχψω' },
  Latin: {
    // English + Western/Central European + Turkish base letters (accents are marks).
    English: 'abcdefghijklmnopqrstuvwxyz', // the Latin target language (§4.5)
    European: 'abcdefghijklmnopqrstuvwxyzßæœøþðıłđ',
  },
};
const PALOCHKA = new Set(['ӏ', 'Ӏ']);
const PALOCHKA_AFTER = new Set([...'гдклптфхцчшщжсз']);
const LANG_SETS = Object.fromEntries(
  Object.entries(LANGUAGES).map(([S, ls]) => [
    S,
    Object.entries(ls).map(([name, a]) => [name, new Set(a)]),
  ]),
);

/**
 * Positional spelling rules per language (§4.7), on lowercased NFD base
 * letters of a word with ≥ 2 letters (`raw` keeps the case). A violation
 * means "this word is not this language". Only positional rules: nothing
 * that tells ь from ъ (native writers mix them up).
 */
const VOWELS = new Set([...'аеиоуыэюяіїєәөұү']);
const LOWER_ONLY_CAPS = new Set(['Ь', 'Ъ']);
function softHardNotInitial(w) {
  return w[0] !== 'ь' && w[0] !== 'ъ';
}
function softNotInitial(w) {
  return w[0] !== 'ь';
}
function hardNotInitial(w) {
  return w[0] !== 'ъ';
}
function yeryNotInitial(w) {
  return w[0] !== 'ы';
}
function softHardNotAfterVowel(w) {
  return !w.some((c, i) => (c === 'ь' || c === 'ъ') && i > 0 && VOWELS.has(w[i - 1]));
}
function softNotAfterVowel(w) {
  return !w.some((c, i) => c === 'ь' && i > 0 && VOWELS.has(w[i - 1]));
}
// A capital Ь/Ъ after the first letter of a word that has lowercase letters.
function capitalSignOnlyInCaps(w, raw) {
  return (
    !raw.some((c, i) => i > 0 && LOWER_ONLY_CAPS.has(c)) || raw.every((c) => c === c.toUpperCase())
  );
}
// ς only word-final; lowercase σ never word-final (except elided, μέσ').
function finalSigma(w, raw, elided) {
  return !raw.some(
    (c, i) => (c === 'ς' && i < raw.length - 1) || (c === 'σ' && i === raw.length - 1 && !elided),
  );
}
export const ORTHOGRAPHY = {
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
/**
 * Hebrew final forms (§4.7): defined and measured, not wired — Hebrew is
 * outside the model, so no Hebrew word is ever resolved. A non-final form
 * at the end is allowed before a geresh (צ' loan sounds) and in acronyms (ח"כ).
 */
export function hebrewFinalsOk(word) {
  const ch = [...word];
  const idx = ch
    .map((c, i) => i)
    .filter((i) => /\p{Script=Hebrew}/u.test(ch[i]) && /\p{L}/u.test(ch[i]));
  if (idx.length < 2) return true;
  return idx.every((i, k) => {
    const last = k === idx.length - 1;
    if ('ךםןףץ'.includes(ch[i])) return last;
    // Non-final כ מ נ צ never end a word; פ does in loanwords (טיפ, לפטופ), so it is not judged.
    if ('כמנצ'.includes(ch[i])) return !last || /^['׳’]/.test(ch[i + 1] ?? '') || /["״]/.test(word);
    return true;
  });
}

/** Intra-Latin descender twins (§3.3), enabled per id like the cross-alphabet ones. */
const INTRA_LATIN_DESCENDER = {
  'ŋ~n': { ŋ: 'n', Ŋ: 'N' },
  'ɳ~n': { ɳ: 'n' },
  'ı~i': { ı: 'i' }, // dotless i: shape twin, not a donor (round 7)
  'ɽ~r': { ɽ: 'r' },
  'ʐ~z': { ʐ: 'z' },
};

/**
 * Target languages (§4.5): a word is folded into script T only if every
 * letter after folding is in the alphabet of an enabled target language of T.
 * Only the requested languages decide legitimacy too (decision 40d).
 */
export const TARGET_LANGUAGES = {
  ...Object.fromEntries(
    Object.entries(LANGUAGES)
      .filter(([, ls]) => ls)
      .flatMap(([S, ls]) =>
        Object.entries(ls).map(([name, a]) => [name, { script: S, letters: a }]),
      ),
  ),
};
export const DEFAULT_TARGET_LANGUAGES = ['English', 'Russian', 'Ukrainian', 'Greek'];

/** I-shaped letters whose lowercase alternative is Latin "l" (§4.6). */
const I_SHAPED = new Set(['I', 'І', 'Ӏ', 'ӏ', 'Ι']);

/**
 * N target languages × (N + M) alphabets (§3.4): `targetLanguages` are fold
 * destinations; `donorAlphabets` are alphabets whose letters may appear as
 * lookalikes (substitutions + evidence) but are never fold targets. Letters of
 * a target script outside every target language (Macedonian ѕ, Caucasian ӏ for
 * an English + Russian reader) are donors too. Default donors: every alphabet
 * of the table that no target language uses.
 */
export function makeResolver({
  conditionalTwins = DEFAULT_CONDITIONAL_TWINS,
  targetLanguages = DEFAULT_TARGET_LANGUAGES,
  donorAlphabets = null,
} = {}) {
  const descenderTwins = conditionalTwins;
  const { twins } = derive({ conditional: conditionalTwins });
  // Letters a fold may produce, per script (lowercase), and the target language names per script.
  const targetLetters = {};
  const targetNames = {};
  for (const name of targetLanguages) {
    const L = TARGET_LANGUAGES[name];
    if (!L) throw new Error(`unknown target language ${name}`);
    for (const c of L.letters) (targetLetters[L.script] ??= new Set()).add(c);
    (targetNames[L.script] ??= []).push(name);
  }
  const targetScripts = new Set(targetLanguages.map((n) => TARGET_LANGUAGES[n].script));
  const donors = donorAlphabets ?? ALL_MODEL.filter((a) => !targetScripts.has(a));
  const MODEL = ALL_MODEL.filter((a) => targetScripts.has(a) || donors.includes(a));
  // A Latin extra letter is a donor only if it has a twin among the Latin target
  // letters (ɑ→a ɡ→g ſ→f ᴀ→a) and is no letter of a requested Latin language
  // (decision 40d: European's ı þ ð ß æ œ ø ł đ only when European is requested).
  const donorExtra = new Set(
    (MODEL.includes('LatinExtra') ? ALPHABETS.LatinExtra : []).filter(
      (c) =>
        !targetLetters.Latin?.has(c.toLowerCase()) &&
        // An intra-Latin conditional twin (ı) is judged by its pair, not as a donor.
        !Object.values(INTRA_LATIN_DESCENDER).some((m) => c in m) &&
        twinIn(c, 'Latin', isUpper(c), true),
    ),
  );
  /** Alphabet of a base letter for this configuration, or null (outside the model). */
  const scriptOf = (c) => {
    const a = baseScriptOf(c);
    if (a === 'LatinExtra' && !donorExtra.has(c)) return MODEL.includes('Latin') ? 'Latin' : null;
    return a && MODEL.includes(a) ? a : null;
  };
  const intraLatin = Object.assign(
    {},
    ...[...descenderTwins].map((id) => INTRA_LATIN_DESCENDER[id] ?? {}),
  );

  /** Best twin of `c` in alphabet T: core, same case (or allowed cross-case), alphabet order. */
  /**
   * Best twin of `c` in alphabet T. `restricted` (default): only letters of an
   * enabled target language of T. Unrestricted lookups serve evidence (§4.4).
   */
  function twinIn(c, T, wantUpper = isUpper(c), restricted = true) {
    const all = twins.get(c)?.[T];
    if (!all) return null;
    const allowed = targetLetters[T];
    if (restricted && !allowed) return null;
    const ok = [...all.keys()].filter(
      (y) =>
        isCore(y, T) &&
        (!restricted || allowed.has(y.toLowerCase())) &&
        (isUpper(y) === isUpper(c) || CROSS_CASE_ALLOWED.has(`${c}>${y}`)),
    );
    if (ok.length === 0) return null;
    const order = ALPHABETS[T];
    return ok.sort(
      (a, b) =>
        (isUpper(a) !== wantUpper) - (isUpper(b) !== wantUpper) ||
        order.indexOf(a) - order.indexOf(b),
    )[0];
  }

  /** Base letter + trailing marks (NFD), so "é" is judged as "e" and keeps its accent. */
  function clusters(seg) {
    const out = [];
    for (const ch of seg.normalize('NFD')) {
      if (MARK.test(ch) && out.length) out[out.length - 1].marks += ch;
      else out.push({ base: ch, marks: '' });
    }
    return out;
  }

  const latinTargetSets = (LANG_SETS.Latin ?? [])
    .filter(([name]) => targetNames.Latin?.includes(name))
    .map(([, set]) => set);
  function fitsLatinTarget(folded) {
    const cs = [...folded.toLowerCase()];
    if (cs.some((c) => MARK.test(c))) return false;
    const ls = cs.filter((c) => LETTER.test(c));
    return latinTargetSets.some((set) => ls.every((c) => set.has(c)));
  }

  /** Folds every letter not native to T into its twin in T (lowercase twin inside lowercase words). */
  function fold(cl, letters, T, anomaly) {
    const lowerWord =
      letters.length > 2 &&
      letters.slice(1).filter((c) => !isUpper(c.base)).length >= letters.length - 2;
    return cl
      .map((c) => {
        if (!LETTER.test(c.base)) return c.base + c.marks;
        if (c === anomaly && T === 'Latin') return 'l' + c.marks; // §4.6: I-shaped → l
        if (T === 'Latin' && intraLatin[c.base]) return intraLatin[c.base] + c.marks; // §3.3: ŋ → n
        if (scriptOf(c.base) === T) return c.base + c.marks;
        const i = letters.indexOf(c);
        const t = twinIn(c.base, T, i > 0 && lowerWord ? false : isUpper(c.base));
        return (t ?? c.base) + c.marks;
      })
      .join('')
      .normalize('NFC');
  }

  /**
   * §4.4 + §4.7: does a single-script word fit some language of S (letters
   * and positional rules)? null if it fits (or S has no languages), else
   * { kind: 'foreign', letters } — lookalike letters outside every language —
   * or { kind: 'orthography', rule } — letters fit, positional rules do not.
   */
  function languageViolation(letters, S, elided = false, only = null) {
    // Decision 40d: the requested languages of S only.
    const langs = LANG_SETS[S]?.filter(
      ([name]) => targetNames[S]?.includes(name) && (!only || only.includes(name)),
    );
    if (!langs) return null;
    const raw = letters.map((c) => c.base);
    const low = raw.map((c) => c.toLowerCase());
    let best = null;
    let ortho = null;
    for (const [name, set] of langs) {
      const miss = letters.filter((c, i) => {
        if (PALOCHKA.has(c.base))
          return !set.has('ӏ') || (i > 0 && !PALOCHKA_AFTER.has(low[i - 1]));
        return !set.has(low[i]);
      });
      if (miss.length === 0) {
        const broken =
          low.length >= 2 ? (ORTHOGRAPHY[name] ?? []).find((r) => !r(low, raw, elided)) : null;
        if (!broken) return null;
        ortho ??= { kind: 'orthography', rule: broken.name };
        continue;
      }
      if (!best || miss.length < best.length) best = miss;
    }
    if (ortho) return ortho;
    // Target check (§4.5): any letter outside the target languages disqualifies.
    if (only) return { kind: 'foreign', letters: (best ?? letters).map((c) => c.base).join('') };
    // Only lookalikes are spoof evidence: a foreign letter with no twin in any
    // other alphabet (Tatar җ, Bashkir ҡ) just means an unmodelled language.
    // Decision 40d: proof letters by the effective (restricted) mapping.
    const look = (best ?? []).filter((c) =>
      MODEL.some((T) => T !== S && twinIn(c.base, T, isUpper(c.base), true)),
    );
    return look.length ? { kind: 'foreign', letters: look.map((c) => c.base).join('') } : null;
  }

  const palochkaLang = targetLanguages.some((n) => TARGET_LANGUAGES[n].letters.includes('ӏ'));
  /** §4.6: an I-shaped last letter after lowercase letters (≥ 4 letters); null if none. */
  function caseAnomaly(letters) {
    if (letters.length < 4) return null;
    const last = letters[letters.length - 1];
    if (!I_SHAPED.has(last.base)) return null;
    if (letters.slice(1, -1).some((c) => isUpper(c.base))) return null;
    const prev = letters[letters.length - 2].base.toLowerCase();
    // Caucasian digraph, when a requested language has the palochka (40d).
    if (palochkaLang && PALOCHKA.has(last.base) && PALOCHKA_AFTER.has(prev)) return null;
    return last;
  }

  /** Context-free facts about one segment. */
  function inspect(seg) {
    const cl = clusters(seg);
    const letters = cl.filter((c) => LETTER.test(c.base));
    const scripts = new Set(letters.map((c) => scriptOf(c.base)));
    const native = {};
    const blockers = {};
    for (const T of MODEL) {
      native[T] = letters.filter((c) => scriptOf(c.base) === T).length;
      blockers[T] = letters
        .filter((c) => scriptOf(c.base) !== T && !twinIn(c.base, T))
        .map((c) => c.base)
        .join('');
    }
    // A target alphabet is valid only if the folded word fits one of its
    // languages, positional rules included (paᏏy → раЬу is no Cyrillic word).
    const whole = scripts.size === 1 && !scripts.has(null);
    const anomaly = whole ? caseAnomaly(letters) : null;
    const rejected = {};
    const valid = MODEL.filter((T) => {
      if (blockers[T] !== '') return false;
      if (whole && scripts.has(T)) return true; // own script: judged as evidence below
      if (!targetNames[T]) return false; // no enabled target language in T
      const folded = clusters(fold(cl, letters, T, anomaly)).filter((c) => LETTER.test(c.base));
      // Every letter after folding must be in one enabled target language of T (§4.5).
      const v = languageViolation(folded, T, false, targetNames[T]);
      if (v) rejected[T] = v;
      return !v;
    });
    const info = {
      cl,
      letters,
      scripts,
      native,
      blockers,
      valid,
      rejected,
      evidence: null,
      anomaly: null,
    };
    if (letters.length && whole) {
      const [S] = scripts;
      const lang = languageViolation(letters, S, /['’]$/.test(seg));
      let intra = S === 'Latin' ? letters.filter((c) => intraLatin[c.base]) : [];
      // §3.3: an intra-Latin fold applies only if every letter of the folded
      // word, accents included, is in one Latin target language (ışık stays).
      if (intra.length && !fitsLatinTarget(fold(cl, letters, 'Latin', null))) intra = [];
      // Decision 41g (the word part): Turkish ı stays in a word holding ğ, ş or İ.
      if (/[ğĞşŞİ]/.test(seg)) intra = intra.filter((c) => c.base !== 'ı');
      if (anomaly)
        [info.evidence, info.anomaly] = [{ kind: 'case', letters: anomaly.base }, anomaly];
      // A word made only of Latin extras (ᴀᴅᴍɪɴ) is no language: donor evidence.
      else if (S === 'LatinExtra') info.evidence = { kind: 'donor', letters: '' };
      else if (intra.length)
        info.evidence = { kind: 'conditional', letters: intra.map((c) => c.base).join('') };
      // Decision 40e: language rules only narrow targets; a broken rule is no evidence.
      else if (lang && lang.kind !== 'orthography') info.evidence = lang;
    }
    return info;
  }

  /** Stem judged for a token with an apostrophe case ending, else the token. */
  function splitEnding(token) {
    // Russian's case endings: only when Russian is requested (40d).
    const m = targetLanguages.includes('Russian') ? token.match(APOSTROPHE_ENDING) : null;
    return m && RU_CASE_ENDINGS.has(m[3].toLowerCase())
      ? { stem: m[1], tail: m[2] + m[3], ending: m[3] }
      : { stem: token, tail: '', ending: null };
  }

  /** A context word: one model alphabet, not confusable, no evidence. */
  function cleanAlphabet(token) {
    const { stem } = splitEnding(token);
    const { letters, scripts, valid, evidence } = inspect(stem);
    const model = [...scripts].filter(Boolean);
    if (letters.length === 0 || model.length !== 1 || evidence) return null;
    const [S] = model;
    if (!targetScripts.has(S)) return null; // decision 40d: only a requested target votes
    if (!scripts.has(null) && valid.some((T) => T !== S)) return null; // confusable
    return { S, n: letters.filter((c) => scriptOf(c.base) === S).length };
  }

  /**
   * §4.2 ladder for one segment. ctx = { left, right, window } context
   * alphabets from the clean words around it (null when none/tied).
   */
  function resolveSegment(seg, ctx, opts) {
    const info = inspect(seg);
    const { cl, letters, scripts, native, blockers, valid, evidence, anomaly } = info;
    if (letters.length === 0 || scripts.has(null)) return null; // outside the model: existing path
    const own = [...scripts];
    const whole = scripts.size === 1;
    const S = whole ? own[0] : null;
    const mode = opts.wholeScriptFold ?? 'all';
    const evidenceOut = Object.fromEntries(
      own.filter((T) => blockers[T]).map((T) => [T, blockers[T]]),
    );
    const base = { valid, rejected: info.rejected, blockers: evidenceOut, evidence };
    const keep = (kind, extra) => ({ kind, script: null, normalized: seg, ...base, ...extra });
    let cands = valid;
    // Decision 41n: only targets already holding one of the word's letters; none at all: any.
    if (!whole) {
      const holding = valid.filter((T) => native[T] > 0);
      const anyTarget = [...targetScripts].some((T) => native[T] > 0);
      cands = holding.length ? holding : anyTarget ? [] : valid;
    }
    if (whole) {
      if (letters.length < 2 || (opts.expectedScripts ?? []).includes(S)) return null;
      if (!evidence && mode !== 'all') return null;
      if (S === 'Latin' && targetScripts.has('Latin')) {
        // Never folded out of Latin; only intra-Latin folds: case anomaly
        // (paypaI → paypal) and enabled intra-Latin descender twins (ŋ → n).
        if (evidence?.kind !== 'case' && evidence?.kind !== 'conditional') return null;
        const rule = evidence.kind === 'case' ? 'case-anomaly' : 'conditional-twin';
        if (mode === 'off') return keep('confusable', { rule, folded: false });
        return {
          kind: 'confusable',
          script: 'Latin',
          rule,
          ...base,
          normalized: fold(cl, letters, 'Latin', anomaly),
        };
      }
      cands = valid.filter((T) => T !== S);
      // Case anomaly: only an alphabet where the I-shaped letter reads as lowercase "l".
      if (evidence?.kind === 'case') cands = cands.filter((T) => T === 'Latin');
      // Evidence only matters if the word can be read as another alphabet (Chechen маӏа cannot).
      if (evidence && cands.length === 0) return null;
      if (evidence && mode === 'off')
        return keep('confusable', { rule: 'evidence', folded: false });
    }

    const take = (T, rule) => ({
      kind: 'confusable',
      script: T,
      rule,
      ...base,
      normalized: fold(cl, letters, T, anomaly),
    });
    // Steps 1–2: immediate context, then surrounding context. No gate.
    for (const [step, X] of [
      [ctx.hyphen ? 'hyphen' : 'neighbours', ctx.near],
      ['window', ctx.window],
    ]) {
      if (!X) continue;
      if (whole && X === S && !evidence) return null; // the word fits its context
      if (cands.includes(X)) return take(X, step);
    }
    if (whole && !evidence) return null; // whole-script words fold only on context or evidence
    // Step 3: word majority (no outnumber gate: removed in round 7).
    const ranked = [...cands].sort((a, b) => native[b] - native[a]);
    const lead = ranked[0];
    // Decision 41m: a sizable majority only (≥ 3 letters and ≥ 2/3 of the word's letters).
    if (
      lead &&
      native[lead] >= (opts.wordMajorityMinLetters ?? 3) &&
      native[lead] >= (opts.wordMajorityMinShare ?? 2 / 3) * letters.length &&
      (ranked.length === 1 || native[lead] > native[ranked[1]])
    )
      return take(lead, 'word-majority');
    // Step 5: any valid alphabet, the primary target first (41e).
    // --step5-own-scripts (measurement only): step 5 only into scripts the word has letters in.
    const c5 = opts.step5OwnScripts && !evidence ? cands.filter((T) => scripts.has(T)) : cands;
    // Decision 41e: the primary target, else the first requested target that can take it.
    if (c5.length)
      return take(
        targetLanguages.map((n) => TARGET_LANGUAGES[n].script).find((T) => c5.includes(T)) ??
          [...c5].sort()[0],
        'any-valid',
      );
    if (cands.length) return keep('confusable', { rule: 'step5-restricted', folded: false });
    return keep('mixed', { rule: 'no-valid-language' });
  }

  /** Resolves every token of a text; returns per-word findings + normalized text. */
  function resolveText(text, opts = {}) {
    const WINDOW = opts.window ?? 10;
    const tokens = [...text.matchAll(TOKEN_RE)];
    // Paragraph = run of text without a blank line.
    const para = [];
    let p = 0;
    let last = 0;
    for (const m of tokens) {
      if (/\n\s*\n/.test(text.slice(last, m.index))) p++;
      para.push(p);
      last = m.index + m[0].length;
    }
    const clean = tokens.map((m) => cleanAlphabet(m[0]));
    // Hyphen compounds (СОСА-СОЛА, Docker-контейнер): parts joined by a single
    // hyphen are each other's immediate context (step 1).
    const compound = [];
    tokens.forEach((m, i) => {
      const gap = i ? text.slice(tokens[i - 1].index + tokens[i - 1][0].length, m.index) : null;
      compound.push(i && /^[-\u2010\u2011]$/.test(gap) ? compound[i - 1] : i);
    });
    const nearest = (i, step) => {
      for (let j = i + step; j >= 0 && j < tokens.length && para[j] === para[i]; j += step)
        if (clean[j]) return clean[j].S;
      return null;
    };
    const windowMajority = (i) => {
      const n = {};
      for (let j = Math.max(0, i - WINDOW); j <= Math.min(tokens.length - 1, i + WINDOW); j++)
        if (j !== i && para[j] === para[i] && clean[j])
          n[clean[j].S] = (n[clean[j].S] ?? 0) + clean[j].n;
      const r = Object.entries(n).sort((a, b) => b[1] - a[1]);
      return r.length && !(r[1] && r[1][1] === r[0][1]) ? r[0][0] : null;
    };
    const words = [];
    let out = '';
    let cursor = 0;
    tokens.forEach((m, i) => {
      const L = nearest(i, -1);
      const R = nearest(i, +1);
      // Step 1: clean hyphen partners if any (all one alphabet), else a clean
      // word on BOTH sides that agree; at a text/paragraph edge step 2 decides.
      // Decision 42b: no hyphen step; a compound's parts are no context for each other.
      const near = L && R && L === R ? L : null;
      const ctx = { near, window: windowMajority(i), hyphen: false };
      const { stem, tail, ending } = splitEnding(m[0]);
      let r = resolveSegment(stem, ctx, opts);
      if (!r) return;
      if (ending) r = { ...r, normalized: r.normalized + tail, ending };
      words.push({ word: m[0], index: m.index, context: ctx, ...r });
      out += text.slice(cursor, m.index) + r.normalized;
      cursor = m.index + m[0].length;
    });
    return {
      words,
      confusableWords: words.filter((w) => w.kind === 'confusable').length,
      mixedWords: words.filter((w) => w.kind === 'mixed').length,
      normalized: out + text.slice(cursor),
    };
  }

  /** The configuration as resolved: targets, donors, and which letters can be fold targets. */
  const config = () => ({
    targetLanguages,
    targetScripts: [...targetScripts],
    donorAlphabets: donors,
    model: MODEL,
    targetLetters: Object.fromEntries(Object.entries(targetLetters).map(([k, v]) => [k, v.size])),
    latinExtraDonors: [...donorExtra].join(''),
  });
  return { resolveText, twinIn, inspect, languageViolation, config };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
  const opts = {
    wholeScriptFold: opt('whole-script-fold', 'all'),
    step5OwnScripts: args.includes('--step5-own-scripts'),
  };
  const d = opt('twins', null);
  const tl = opt('targets', null);
  const texts = args.filter((a) => !a.startsWith('--'));
  const { resolveText } = makeResolver({
    ...(d === null ? {} : { conditionalTwins: new Set(d === 'none' ? [] : d.split(',')) }),
    ...(tl === null ? {} : { targetLanguages: tl.split(',') }),
    ...(opt('donors', null) === null
      ? {}
      : { donorAlphabets: opt('donors').split(',').filter(Boolean) }),
  });
  const probes = texts.length
    ? texts
    : [
        'Пpивет',
        'Мы пишем Пpивет всем',
        'Hеllo',
        'wоrld',
        'pаypal',
        'busіnеss',
        'quіск',
        'HОT',
        'НOТ',
        'ВOДКА',
        'CОК',
        'COК',
        'TЕХ',
        'cоса',
        'drink cоса now',
        'Αрр',
        'open the Αрр',
        'Αpple',
        'Kαλημέρα',
        'οnly',
        'ΑΡΡLE',
        "GitHub'а",
        "форк на GіtHub'а",
        'pаypal’ѕ',
        'iPhone’ов',
        'Пpивеt',
        'Сafé',
        'Ёлкa',
        'шaг',
        'Ьank',
        'paypaІ',
        'тime',
        'кey',
        'Kиев',
        'НОТ',
        'НОТ dog',
        'НОТ deal today',
        'This is НОТ news',
        'Мы были в НОТ',
        'СССР',
        'СОСА-СОЛА',
        'раураӏ',
        'тип',
        'опера',
        'I like опера',
        'тail',
        'иser',
        'admiп',
        'вank',
        'Bank ассоunt verification',
        'Wе landed',
        'раураl',
        'аррӏе.com',
        'I bought сок today',
        'I bought сор today',
        'the рос here',
        'it is сухо here',
        'eat уха soup',
        'an оса flew',
        'add сахар now',
        'Мы были в НОТ сегодня',
        'Зайди на раураӏ сегодня',
        'раураІ',
        'paypaI',
        'NaI',
        'my иser name',
        'my кey here',
        'my тap here',
        'paᏏy',
        'маӏа',
        'Το iPhone είναι ακριβό',
        'Коммерсантъ',
        'ьank',
        'ъеst',
        'oьo',
        'Gοοgle ΑΡΡLΕ',
        'СОСА-COLA',
        'χbox',
        'ҳbox',
        'paχos',
        'ŋame',
        'ҳа',
      ];
  for (const t of probes) {
    const r = resolveText(t, opts);
    const w = r.words.map(
      (x) =>
        `${x.word}→${x.normalized} ${x.kind} ${x.rule}→${x.script ?? x.wouldBe ?? '-'}${x.folded === false ? ' (not folded)' : ''} ctx=${x.context.near ?? '-'}/${x.context.window ?? '-'} valid=[${x.valid}]${
          Object.keys(x.rejected ?? {}).length
            ? ' rejected=' +
              Object.entries(x.rejected)
                .map(([T, v]) => `${T}:${v.rule ?? v.letters}`)
                .join(',')
            : ''
        }${x.evidence ? ` evidence=${x.evidence.kind}:${x.evidence.letters ?? x.evidence.rule}` : ''}`,
    );
    console.log(
      `${JSON.stringify(t).padEnd(26)} ${r.normalized === t ? '(unchanged)' : '=> ' + JSON.stringify(r.normalized)}  ${w.join(' ; ')}`,
    );
  }
}
