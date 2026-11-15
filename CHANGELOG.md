# @cycanics/unspoof

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
