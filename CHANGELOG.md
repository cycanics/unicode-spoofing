# @cycanics/unspoof

## 1.0.1

### Major Changes

- **Breaking changes** from 0.6.x, each with its old and new form: [MIGRATING.md](./MIGRATING.md).

- Finding callbacks on a streaming core. `cleanHidden(text, rules?, callbacks?)` returns the cleaned text, and what both functions find streams through their callbacks: `onReport` (every mark of every rule, with the hidden characters as the input has them: the library decodes no payload), `onCleanup` (every region of removals; its return goes into the consumer's records), `onRecord` (phase 1's records), `onWord(start, end, cleaned, replacement, reason)` (every word with a signal; `reason.toLang` the target language converted into, such as `'English'`) and an `AbortSignal` honoured in both phases. Strict rules: the seam rule (`seamSpaces`) is on, `zeroWidthRunThreshold` is 2, `possibleLigatureBreak` is a kind of its own, and invisible runs and bidi spans are rules with modes; `analyze`'s illegal code points, decode damage and lenient invisible runs are rules too. The language model reads a context window (`contextBuffer`, `majorityWindow`, `breadth`) and reports words mixing scripts by the categories below; the neutral alphabet (`neutralAlphabet`, on in strict) reads styled and compatibility letters inside words; strict `analyze` trims stacked marks in its hidden-character pass only. Terminal controls (`hiddenCharRules.terminal`, `cleanTerminal`): the DEC/ANSI parser state machine, string sequences across lines, backspace erasing cells (not sequences) up to a line start, in one streaming scan. Ideographic variation selectors checked against the IVD per base; U+009B before a word is no CSI; with `hiddenChars: 'strict'`, `confusionModel: 'language'` or `neutralAlphabet`, words longer than 250 characters are not judged. The neutral dictionary types each character: styled, compatibility and math conversions are no spoof (the word callback still reports them, `result.words` does not list them), look-alikes of real scripts and non-ASCII digits are converted (alone too) and flagged, Roman numerals convert and spoof only inside words of scripts written with spaces, unit symbols and brand marks stay; math switches `keepMathLetters` and the rule `invisibleMathOperators`. Rule modes also take decision 3's names `'report'` and `'cleanup'`; a backspace erase area is reported once.

  Language model: a word holding a target letter and letters of two scripts or more is reported as `mixed_spoof` (look-alikes in it converted or left; a spoof), `mixed_legitimate` (letters of a requested language with scripts written without spaces; not a spoof) or `mixed_non_legitimate` (otherwise: reported, not a spoof) in place of `mixed_script`; `counts.mixedWords` counts those words. The three keys appear in `signals` only when set. The default path (no options) keeps `mixed_script`.

  Strict `analyze` reports mojibake (UTF-8 read as Windows-1252/Latin-1 or Windows-1251) as phase-1 report kind `mojibake` (`extracted`: the text it encodes; rule `mojibake`, off in `cleanHidden`); a span stays part of its word and its encoded bytes are not converted (`donâ€™t` stays). With the language model a word mixing a script written with spaces and one written without is judged per piece and reported once as a whole; a lone styled letter beside kana/Han stays as written (`作れたｗ`). `µ` at a word's start is kept only before a unit (`µm`, `µHz`), else converted (`µsername` → `username`, `µε` → `με`). `mixed_legitimate` covers the UTS #39 Highly Restrictive sets (`Smith는`). A mixed word that no target takes whole is judged chunk by chunk, each chunk of one script, in the word's language (decision 36c): fully convertible chunks convert (`pаypalя` → `paypalя`, a spoof); otherwise `mixed_non_legitimate`. New option `affixSeparator` keeps convertible prefix/suffix chunks, set off by the given string. Inside a number, digit donors take their digit reading (`error ৪০৪` → `error 808`). Under the language model every decision reads only the requested `targetLanguages` and the call's pair changes (decision 40d): letters of unrequested languages (European `þ`, Ukrainian `і` without Ukrainian, Serbian `ј`, Tajik `ҳ`) are not legitimate, unrequested languages cast no context vote, and the UTS #39 skeleton folds no word. Language rules (orthography) only narrow fold targets; a whole word that breaks one is not converted (decision 40e: `σσ` stays). Several valid targets and no context: the primary target, then the next requested (41e), no fixed alphabet order. New option `mathTarget` (math switch 3): words of Latin, Greek and math letters are native to a Math target. The long s `ſ` and the lunate sigma `ϲ` are ordinary pack donors (decision 40f): their folds are spoofs (`ſecure` → `secure`), the lunate sigma reads `c`, `с` or `σ` by target; packs may hold pairs within a script, never a letter of their own language as a donor. **On the default path (no options):** the long s `ſ` folds to `s`, not UTS #39's `f` (`ſecure` → `secure`, decision 40f). The affix suffix lists are grammatical (Russian, Ukrainian, English, Greek; decision 36c). In strict mode with the language model, words joined by an inner dash are one visibility token whose context comes from outside it; dash parts of one language are judged together, parts of different languages as separate words, and each part counts in its neighbours' context window (decisions 42, 42b, 36c; no hyphen step); 36c's affixes are one-script affixes of a requested language other than the body's (a prefix only when a dash sets it off), and `affixSeparator` acts only on them. A mixed word converts only into a requested target that already holds one of its letters (decision 41n). Word majority needs a sizable majority (decision 41m, options `ladder.wordMajorityMinLetters`/`wordMajorityMinShare`, defaults 3 and 2/3); otherwise the request order decides. A one-letter dash part with a twin in the other part's language is part of the word unless `oneLetterDashAffix` names its language (36c); Greek `μ` before a unit is a unit prefix (30b.8). Mixed words follow decision 36e: detection at on-screen borders (UAX #9 display order), correction only of a one-letter look-alike piece that is not the last or a look-alike piece between two pieces (toward the requested language holding more of the word's letters; option `hostileInput` also the last), everything else reported as `mixed_non_legitimate`; a word holding letters of two requested languages is never mapped whole (ordering B). A Latin stressed vowel in a Russian word becomes the Russian vowel with a combining acute (36f). `п` and `n` are ordinary twins in the English, Russian and Ukrainian packs (40g). In mixed words digits are ignored at a border, and apostrophe parts are separate words like dash parts. An `x` between digits is written `×` (no spoof); a whole word beside a clean word of its own language is not folded by context but reported in a new category `whole_word_lookalike` (41o; a new `signals` value, set only when present, not a spoof); HTML character references are read as the HTML tokenizer reads them in text content (the full HTML5 named list with `;`, the legacy names and numeric references also without it, a legacy name without `;` only when no `=`, letter, mark or number of any script follows, so `&section=1` and `a&copyжурнал` stay text; new option `htmlNamedReferences: 'lenient' | 'strict'`, `'strict'` reading names only with `;`, any number of leading zeros, U+0080–009F as Windows-1252, zero and out of range as U+FFFD) and are decoded once before phase 1, so every rule reads the raw character they encode; positions and reported characters map back to the input as written, each reference is reported (`htmlReference`), and the output keeps a reference as written unless its character changed; the one difference from raw characters: their letters cast no vote and a word of references only is skipped in 41o's neighbour test.

  Terminal rules: a lone CR is a line break in every mode, strict included (CR, LF and CRLF alike); nothing is overwritten. `terminal.bareCR` takes `'keep'` (default: left as written, reported, not counted), `'report'`, `'newline'` (LF, silent) or `'ignored'`.

  Language model, per-language rule: targets, folds, contexts and votes are languages, never alphabets; Russian and Ukrainian are two languages. `WordFinding.resolution.language` names the language folded into; `resolution.context` (the languages both nearest words share, the window's language) and `candidates` are languages. `resolveWord(word, { neighbours, window })` takes language names. A precomposed letter an alphabet lists (`ё`, `ї`, `ў`, …) is a letter of its own, also when written decomposed: `ё` is no Ukrainian letter. `reason.toLang` names a language only when it is requested and the output is in its letters: none for an output with no letter (digits), for an unrequested language's letters and under the Latin-fold model. New option `inputLanguages: TargetLanguage[]` (e.g. `['Russian']`), the languages the input is written in: a whole word written in the letters of one of them is genuine and never folded, under both models. Unlike `targetLanguages` (what the reader reads; conversions go into them), it adds no target. A neutral character with no letter of the word to follow is written in the first requested language that takes it, in request order. The micro sign inside a word is written by the word's language (English and European `u`, Greek `μ`; none decided for the languages of Cyrillic letters, so it stays and is reported). `WordResolution`, `ResolveOptions`, `WordCategory` and `MixedCategory` are exported.

  New (language model): `onLostBound` reports a construct whose closing bound was lost (`{ kind: 'escapeString' | 'bidiFrame', start, length }`); `hiddenCharRules.constructLimit` (`CONSTRUCT_LIMIT`, 4,096 code points) bounds the RTL lookahead, hidden runs and words, concealed and mojibake spans (chunked), bidi frames and backspace erase; `terminal.stringLimit` (`STRING_LIMIT`, 16 Mi code points) bounds an escape string's body. `rtlAwareness` (default `true`) splits a word holding a right-to-left letter in on-screen order. Bidi marks are judged per bidi paragraph (42g: marks in right-to-left text stay; kind `bidiMarksInRtlText`). VT and FF are line breaks, written as LF (42d). A caseless cap-height stroke (`ꓲ ǀ ᛁ ⵏ ا …`) reads as the case it looks like (37): `I` at a capital or alone (the Roman numeral, in any context), `l` among lowercase letters; with no language written in Latin letters requested a lone stroke is kept and reported. The additional look-alike pack of extra pairs has the id `'optional'` (`buildLookalikes({ additional: ['optional'] })`).

  Dotless `ı`: `ı` → `i` is in the default look-alike packs of the target languages written in Latin letters (English, European); to keep every `ı`, remove the pair: `buildLookalikes({ remove: { English: [['ı', 'i']] } })`. A Turkish `ı` stays when the word, another part of its token or a word of its context window holds `ğ`, `ş` or `İ` (decision 41g).

## 0.6.1

### Patch Changes

- Alphabet model (`confusionModel: 'alphabet'`): Latin dotless `ı` now folds to `i` by default (`lınk` → `link`, reported as a confusable word); the conditional twin `ı~i` joins `DEFAULT_CONDITIONAL_TWINS`. To opt out, pass your own `conditionalTwins` without `ı~i`.
- Alphabet model: an intra-Latin fold (`ı~i`, `ŋ~n`, …) applies only if every letter of the folded word, accents included, belongs to a Latin target language, so Turkish words such as `ışık` or `kışın` stay as written.

## 0.6.0

First release as `@cycanics/unspoof`. Everything since upstream 0.4.0:

### Minor Changes

- Two opt-in options for `analyze`. `confusionModel: 'alphabet'` works out which alphabet a scrambled word is written in and folds toward it (`Пpивет` → `Привет`, `раураl` → `paypal`), with `targetLanguages`, `donorAlphabets`, `conditionalTwins` and `wholeScriptFold` sub-options and a per-word `resolution`. `hiddenChars: 'strict'` applies a per-class hidden-character rule set (configurable via `hiddenCharRules`), counts affected words in `counts.hiddenWords` and decodes tag, variation-selector and zero-width payloads in `result.hidden`. `counts` gains `hiddenWords`, `confusableWords` and `mixedWords`. Default behaviour is unchanged and `analyze` is 3–6× faster.
- Export `cleanHidden` and its `HiddenCleanup` / `HiddenEdit` types: the strict hidden-character cleanup without confusable folding, with an edit list for mapping input offsets onto the cleaned text.
- `cleanHidden` counts bidi controls in two classes: `bidiOverride` (U+202A–202E) and `bidiMark` (LRM, RLM, ALM, isolates).
- `cleanHidden` removes control characters, including DEL and C1 controls (rule `controlChars`).

- `cleanHidden` and strict `analyze`: `reportContent` lists what was hidden (`content`: decoded payloads, bidi-overridden spans in logical order, other invisible runs), and the rule action `'remove-with-content'` also removes what an LRO/RLO reverses. Default output is unchanged.
- Strict hidden characters: stacked marks past a per-script limit are reported as `mark-stack` and trimmed (`markStacks`, `markStacksOther`, `markStackLimits`, `MARK_STACK_LIMITS`), judged by each mark's own base. The remaining default-ignorable code points count as `otherInvisibles`. U+061C alone no longer counts as RTL text, so bidi marks in non-RTL text are removed.
- Invisible payloads right after an emoji are reported. The emoji exemption now covers only the invisible characters that belong to an emoji sequence (UTS #51: ZWJ between emoji, one VS15/VS16, keycaps, RGI subdivision-flag tags); tag payloads, stacked variation selectors, zero-width binary, bidi marks, soft hyphens, word joiners and BOMs next to an emoji are reported as `invisible` and stripped from `normalized`.
- The `FORMAT_CHAR_SCRIPTS` exemption is judged per letter instead of per word: one Hebrew, Arabic, Persian or Indic letter no longer exempts its whole word from `invisible` and `zalgo`. Legitimate joiners (Persian ZWNJ, Indic conjuncts, a single bidi mark next to RTL text, script-specific format characters, mark stacks on these letters) stay exempt; bidi overrides, tag characters, zero-width runs and the like inside such words are reported and removed. Myanmar letters take variation selectors.
- The variation selector supplement (VS17–VS256, U+E0100–U+E01EF) is recognised: valid only directly after a Han or kana letter, reported as `invisible` elsewhere; a base keeps one selector, further ones are removed. VS1–VS16 directly after a combining mark are reported. Valid selectors no longer count toward a `zalgo` stack. Removes a quadratic path.

### Patch Changes

- Whole ANSI control sequences (CSI, e.g. `\x1b[31m`) are one `illegal` finding and removed whole from `normalized`, not just the ESC.
- The typographic apostrophe (U+2019) is kept in `normalized` when a lookalike word is folded (`Ivа’s` → `Iva’s`, not `Iva's`).

## 0.4.0

### Minor Changes

- [#16](https://github.com/moderation-api/unicode-spoofing/pull/16) [`301b60c`](https://github.com/moderation-api/unicode-spoofing/commit/301b60c2dc425e70eeaa604df1ccae6d17ac1026) Thanks [@chrisdengso](https://github.com/chrisdengso)! - Separate decode damage from spoofing with a new `encoding_damage` signal.

  U+FFFD used to count as `illegal`, so a message whose name field had been
  mangled upstream — `Hi Jos�� Luis` — reported as a spoofing attack. Across a
  115-row sample of real SMS traffic that was 61% of all flags.

  U+FFFD is a decoder's output, never an author's input: whatever the original
  bytes were, they are gone by the time the character exists, so it can carry no
  payload. It now reports as `encoding_damage`, which is included in `signals`
  and `words` but deliberately does **not** set `spoofed`, and the normalizer
  leaves it in place rather than silently repairing a corrupted message.

  `SpoofSignal` gains a member and `signals` gains a key, so an exhaustive
  `switch` or a strict `toEqual` on the signals object will need updating.
  Genuinely illegal code points (NUL, C1 controls, non-characters) are unchanged.

  A `SPOOFING_SIGNALS` constant is exported alongside `SPOOF_SIGNALS` — the same
  list minus `encoding_damage` — so callers can partition the two the same way
  `spoofed` does.

- [#16](https://github.com/moderation-api/unicode-spoofing/pull/16) [`301b60c`](https://github.com/moderation-api/unicode-spoofing/commit/301b60c2dc425e70eeaa604df1ccae6d17ac1026) Thanks [@chrisdengso](https://github.com/chrisdengso)! - Judge Latin words on UTS [#39](https://github.com/moderation-api/unicode-spoofing/issues/39) Identifier_Status instead of skeleton luck.

  A word already written in Latin cannot be impersonating Latin, so the
  cross-script skeleton test measured only whether its fold happened to reach
  ASCII — which it does for ordinary European orthography, and arbitrarily.
  `æ` is a ligature that UTS [#39](https://github.com/moderation-api/unicode-spoofing/issues/39) dissolves to `ae`, while `ø` keeps its stroke as
  a combining mark and never reaches ASCII, so `Ægir` was reported as a disguised
  word and `Ålborg` was not. Same alphabet, opposite verdicts.

  A Latin word now needs at least one character Unicode marks **Restricted** in
  `IdentifierStatus.txt` before its skeleton counts. `Ægir`, `Þór`, `Straße`,
  `cœur`, `ısıtır` and `Hawaiʻi` are all Allowed and pass through; `pɑypal`
  (U+0251 IPA ALPHA) and `ﬁrst` (a compatibility ligature) are Restricted and are
  still caught — intra-Latin homoglyphs that no script comparison can see.

  The gate applies ONLY to Latin words. Cyrillic `а`/`о` are Allowed too, being
  ordinary Russian, so applying it everywhere would let `раураl` walk through.

  Adds `src/data/identifier-status.generated.ts` (~7 KB) and
  `scripts/generate-identifier-status.mjs`; `npm run generate:data` refreshes
  both tables.

- [#16](https://github.com/moderation-api/unicode-spoofing/pull/16) [`301b60c`](https://github.com/moderation-api/unicode-spoofing/commit/301b60c2dc425e70eeaa604df1ccae6d17ac1026) Thanks [@chrisdengso](https://github.com/chrisdengso)! - Stop reporting zero-width runs that are isolated in whitespace.

  A zero-width character evades a filter by splitting a word (`fr<ZWSP>ee`).
  A run with whitespace (or a string boundary) on BOTH sides splits nothing —
  the break it would create is already there — so it changes neither rendering
  nor tokenization. Rich-text editors leave these in templates constantly, and
  reporting them told senders their own newsletter was an attack.

  Requiring isolation on both sides is the safety of the rule. One-sided contact
  still does work: `admin<ZWSP>` renders as `admin` but compares unequal to it,
  and `<ZWSP>Valencia` glues to the front of a token the same way, so both are
  still reported. Runs longer than the new exported `ZERO_WIDTH_INERT_RUN` (4)
  are reported wherever they sit, because length alone makes a run a payload
  channel regardless of position.

  Scoped to genuinely zero-width, non-reordering characters (U+200B, U+200C,
  U+200D, U+2060, U+FEFF). Bidi controls, tag characters and blank glyphs are
  untouched — Trojan Source and ASCII smuggling detection are unaffected.

## 0.3.0

### Minor Changes

- [#14](https://github.com/moderation-api/unicode-spoofing/pull/14) [`86027a1`](https://github.com/moderation-api/unicode-spoofing/commit/86027a178a353937280240957d1cd1d662d64683) Thanks [@chrisdengso](https://github.com/chrisdengso)! - Export the constants behind the analysis, so callers can enumerate values instead of hardcoding strings: `SCRIPT_NAMES` (every script `dominantScript` and `words[].scripts` can report), `SUPPORTED_SCRIPTS`, `PSEUDO_SCRIPTS`, `FORMAT_CHAR_SCRIPTS`, `LEGITIMATE_SCRIPT_COMBINATIONS`, `ZALGO_MARK_RUN`, and the `primaryScript(char)` classifier.

  Script-typed fields now use the new `ScriptName` union instead of `string`: `AnalysisResult.dominantScript`, `WordFinding.scripts` and `AnalyzeOptions.expectedScripts`. Runtime behavior is unchanged, but TypeScript callers passing a plain `string[]` to `expectedScripts` will need `ScriptName[]` — which is the point: `expectedScripts: ['Cyrilic']` no longer compiles.

## 0.2.0

### Minor Changes

- [#10](https://github.com/moderation-api/unicode-spoofing/pull/10) [`d8f002d`](https://github.com/moderation-api/unicode-spoofing/commit/d8f002d50bc2d66d2b830082587944e6ccbeee39) Thanks [@chrisdengso](https://github.com/chrisdengso)! - Broaden the `invisible` signal to the full hidden-character corpus.

  `analyze()` now also reports and strips:

  - **Invisible characters that belong to no word** — a bidi control or
    zero-width character sitting between punctuation or spaces, rather than
    inside a token. This is what hid two of the four controls in a Trojan Source
    line (`if (level != "user<RLO> <LRI>// admin check<PDI> <LRI>") {`).
  - **Blank glyphs that are not whitespace** — Hangul fillers (U+115F, U+1160,
    U+3164, U+FFA0), BRAILLE PATTERN BLANK, MUSICAL SYMBOL NULL NOTEHEAD. The
    Hangul fillers previously misreported as `mixed_script`, since they are
    Hangul letters to the property tables.
  - **Invisible combining marks** — COMBINING GRAPHEME JOINER, the Khmer inherent
    vowels, KAITHI VOWEL SIGN I. Each stays legitimate inside its own script.
  - **Stray variation selectors** — a selector on a base with no registered
    sequence, the "ASCII smuggling" payload channel. Registered sequences (emoji
    presentation, keycaps, ideographic variants, Mongolian FVS) are untouched.

  Unicode whitespace (U+00A0, U+2000–U+200A, U+3000, …) is deliberately still not
  flagged: it is ordinary typography and every `\s` matcher already treats it as a
  space.

## 0.1.1

### Patch Changes

- [#8](https://github.com/moderation-api/unicode-spoofing/pull/8) [`183fae9`](https://github.com/moderation-api/unicode-spoofing/commit/183fae9a23010d3b5b93cc0be424b453b2316c7d) Thanks [@chrisdengso](https://github.com/chrisdengso)! - Docs: document the `illegal` signal (control, non-character, and replacement
  code points) in the signals table, and note that declaring `expectedScripts`
  enables whole-script confusable detection (e.g. all-Cyrillic `аррӏе` → `apple`
  when Latin is expected). No runtime changes.
