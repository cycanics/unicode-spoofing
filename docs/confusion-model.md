# Confusion model: per-language word resolution, hidden-character rules and callbacks

Technical reference of `@cycanics/unspoof`:

1. the per-language **confusion model** (`confusionModel: 'language'`), which works out which language a scrambled word is written in and folds toward it (§3–§5);
2. the **hidden-character rules** (`hiddenChars: 'strict'`), a fixed rule set per class of hidden character (§6), the **hidden content** they report and the `remove-with-content` action (§15), and what this library can and cannot judge of text rendered over other text (§16);
3. the **finding callbacks** and the two phases behind them (§17).

§1 and §2 describe `analyze` without options (the Latin-fold model with the lenient hidden-character rules), which the two options replace.

Scripts (plain Node ≥ 20), all run against the checked-in UTS #39 17.0.0 data:

| script                                | what it does                                                                                                                                                            |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/derive-confusion-table.mjs`  | derives the twin table from `src/data/confusables.generated.ts`, applies curated overrides, prints the tables in §5 (`--raw` skips overrides, `--json` dumps the table) |
| `scripts/prototype-resolve.mjs`       | a stand-alone per-word resolver (§4.2)                                                                                                                                  |
| `scripts/prototype-cleanup.mjs`       | a stand-alone hidden-character cleanup with counters and payload decoding (§6)                                                                                          |
| `scripts/prototype-corpus.mjs`        | scores the prototype pipeline on a `cases.json` corpus (imports `dist/`, so run `pnpm build` first)                                                                     |
| `scripts/measure-digit-pairs.mjs`     | renders digit/letter glyph pairs in 8 fonts (method of §8) → `docs/evidence/digit-pairs.json`, `digit-words.png`; evidence for dropping digits (§8.4)                   |
| `scripts/measure-false-positives.mjs` | false positives of foreign-letter, case-anomaly and positional-rule evidence on token lists, dictionaries and real files (§4.4–4.7)                                     |
| `scripts/measure-bidi-spans.mjs`      | what Chrome shows for 50 bidi samples → `docs/evidence/bidi-spans.json`; `test/hidden-content.test.ts` holds the span definition of §15.2 against it                    |
| `scripts/measure-mark-stacks.mjs`     | how far stacks leave their line and cross the neighbours, by script and depth, against real text → `docs/evidence/mark-stacks.json`; evidence for §15.7                 |
| `scripts/measure-overlap.mjs`         | overlap samples in Chrome (4 fonts) and through a tmux pane, with what the rules do to each → `docs/evidence/overlap.json`, `overlap.png`; evidence for §16             |

The measurement scripts produce the evidence files; the prototype scripts are stand-alone implementations of the resolver and the cleanup, kept as test fixtures. What the library does is what this document states; every table marked as generated is written by `scripts/doc-examples.mjs` from the built library, with the options given next to it, and `test/readme.test.ts` fails when a table and the library differ.

## 1. `analyze` without options

The Latin-fold model (`confusionModel: 'latin-fold'`) with the lenient hidden-character rules (`hiddenChars: 'lenient'`):

| concern                       | where                | behaviour                                                                                                                                                                                                                                                  |
| ----------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tokenizing                    | `src/letters.ts`     | token = run of `\p{L}\p{M}\p{N}\p{Cf}'’`; hyphens split tokens, apostrophes do not                                                                                                                                                                         |
| dominant script               | `src/letters.ts`     | most frequent primary script over all letters in the text; ties go to the first seen                                                                                                                                                                       |
| mixed-script test             | `src/scripts.ts`     | a word is mixed when no single script covers all its letters via Script_Extensions; Han+kana, Han+Hangul, Han+Bopomofo are legitimate                                                                                                                      |
| whole-word confusable         | `src/token.ts`       | single-script word whose UTS #39 skeleton is ASCII; gated on a Latin-letter majority (`dominantScript === 'Latin'`, any mixed word in the message, or the word's script is Latin), or on `inputLanguages` (a word with no letter of the input's languages) |
| fold of affected words        | `src/confusables.ts` | every character goes through `foldChar`, whose target is **always** ASCII; if a character's own prototype is not ASCII its case partner is tried (`К`→`K` lowercased gives `к`→`k`)                                                                        |
| reported skeleton             | `src/token.ts`       | `WordFinding.skeleton` = UTS #39 skeleton of the raw token                                                                                                                                                                                                 |
| invisible exemption by script | `src/token.ts`       | a joiner or stacked marks are exempt from `invisible` and `zalgo` on a letter of `FORMAT_CHAR_SCRIPTS` (Arabic, Hebrew, Indic, Thai, …), judged per letter                                                                                                 |
| inert zero-width runs         | `src/token.ts`       | a run of ≤ 4 ZWSP/ZWNJ/ZWJ/WJ/BOM with whitespace (or string edge) on both sides is left in `normalized` and not reported                                                                                                                                  |
| standalone invisibles         | `src/detectors.ts`   | invisible runs outside letter tokens are reported (rule `invisibleOutsideWord`); the code points inside an emoji sequence are not                                                                                                                          |
| counts                        | `src/analyze.ts`     | `wordsAffected` = number of findings, including standalone invisibles and illegal code points, so it can exceed `wordsTotal`                                                                                                                               |

## 2. What the Latin-fold model and the lenient rules do, with evidence

Generated tables: the library's output for the options stated.

### 2.1 Fold target is always Latin letters

`analyze(text)`, no options (in the inputs the Latin letters are `p` in `Пpивет`, `O` in `ВOДКА`, `K` in `Kαλημέρα`; `GitHub'а` ends in a Russian case ending):

<!-- examples: ref-2.1 -->

| Input                          | Output                         | Spoofed | Signals        |
| ------------------------------ | ------------------------------ | ------- | -------------- |
| `Пpивет мир`                   | `Πpᴎbet мир`                   | yes     | `mixed_script` |
| `Мы пишем Пpивет всем друзьям` | `Мы пишем Πpᴎbet всем друзьям` | yes     | `mixed_script` |
| `ВOДКА`                        | `BOДKA`                        | yes     | `mixed_script` |
| `Kαλημέρα`                     | `Kaλhmέpa`                     | yes     | `mixed_script` |
| `GitHub'а`                     | `GitHub'a`                     | yes     | `mixed_script` |
| `GitHub’а`                     | `GitHub’a`                     | yes     | `mixed_script` |

<!-- /examples -->

The same inputs with `{ confusionModel: 'language' }`:

<!-- examples: ref-2.1-alphabet -->

| Input                          | Output                         | Spoofed | Signals       |
| ------------------------------ | ------------------------------ | ------- | ------------- |
| `Пpивет мир`                   | `Привет мир`                   | yes     | `mixed_spoof` |
| `Мы пишем Пpивет всем друзьям` | `Мы пишем Привет всем друзьям` | yes     | `mixed_spoof` |
| `ВOДКА`                        | `ВОДКА`                        | yes     | `mixed_spoof` |
| `Kαλημέρα`                     | `Καλημέρα`                     | yes     | `mixed_spoof` |
| `GitHub'а`                     | `GitHub'а`                     | no      | —             |
| `GitHub’а`                     | `GitHub’а`                     | no      | —             |

<!-- /examples -->

Cause: `foldChar` has only one target alphabet. UTS #39 prototypes for Cyrillic/Greek letters that have no ASCII twin are Greek letters (`П→Π`) or small capitals/IPA — 41 of the 202 Latin/Cyrillic/Greek alphabet letters have a prototype outside all three alphabets (`в→ʙ и→ᴎ т→ᴛ н→ʜ м→ʍ к→ĸ η→n̩ ε→ꞓ …`), and `foldChar` falls back to that prototype (`src/confusables.ts`). The result is neither the original word nor its real spelling.

### 2.2 Whole-script words depend on letter frequency

`analyze(text)`, no options:

<!-- examples: ref-2.2 -->

| Input            | Output           | Spoofed | Signals           |
| ---------------- | ---------------- | ------- | ----------------- |
| `НОТ deal today` | `HOT deal today` | yes     | `confusable_word` |
| `НОТ dog`        | `НОТ dog`        | no      | —                 |
| `НОТ`            | `НОТ`            | no      | —                 |
| `СОК`            | `СОК`            | no      | —                 |
| `ВОДКА СОК`      | `ВОДКА СОК`      | no      | —                 |

<!-- /examples -->

`НОТ deal today`: Latin letters win the letter count of the text. `НОТ dog`: 3 Cyrillic letters against 3 Latin ones; the tie goes to the script seen first (Cyrillic), so `dog` gives no Latin-letter majority. `НОТ`, `СОК`, `ВОДКА СОК`: the text's dominant script is Cyrillic. The result follows a letter count, not evidence in the words.

### 2.3 Hidden characters under the lenient and the strict rules

<!-- examples: ref-2.3 -->

| Input                                | Options                   | Output                         | Spoofed | Signals     | Reports                                                 |
| ------------------------------------ | ------------------------- | ------------------------------ | ------- | ----------- | ------------------------------------------------------- |
| `a \u200B b`                         | `{}`                      | `a \u200B b`                   | no      | —           | —                                                       |
| `a \u200B b`                         | `{hiddenChars: 'strict'}` | `a b`                          | no      | —           | `isolatedZeroWidth` `\u200B`                            |
| `a \u200B\u200B\u200B\u200B b`       | `{}`                      | `a \u200B\u200B\u200B\u200B b` | no      | —           | —                                                       |
| `a \u200B\u200B\u200B\u200B\u200B b` | `{}`                      | `a  b`                         | yes     | `invisible` | `invisibleOutsideWord` `\u200B\u200B\u200B\u200B\u200B` |
| `a \u200B\u200B b`                   | `{hiddenChars: 'strict'}` | `a b`                          | yes     | `invisible` | `zeroWidthRun` `\u200B\u200B`                           |
| `co\u00ADoperate`                    | `{}`                      | `cooperate`                    | yes     | `invisible` | —                                                       |
| `co\u00ADoperate`                    | `{hiddenChars: 'strict'}` | `cooperate`                    | no      | —           | `softHyphen` `\u00AD`                                   |
| `\uFEFFHello`                        | `{}`                      | `Hello`                        | yes     | `invisible` | —                                                       |
| `\uFEFFHello`                        | `{hiddenChars: 'strict'}` | `Hello`                        | no      | —           | `leadingBom` `\uFEFF`                                   |

<!-- /examples -->

- Lenient: a run of up to 4 zero-width characters (`ZERO_WIDTH_INERT_RUN`) with whitespace or a text edge on both sides stays and is not reported; a longer one is removed and reported. Strict: an isolated zero-width character is removed silently, and a run of `zeroWidthRunThreshold` (2) or more is removed and counted wherever it is.
- A soft hyphen and a BOM at the text start are removed under both rule sets; the lenient rules report them as `invisible`, the strict rules remove them silently.

The same under both rule sets: a zero-width character inside a word of Latin or Cyrillic letters is removed and reported (`ad\u200Bmin`); ZWNJ in `می\u200Cخواهم` and `क्\u200Cष` is kept; emoji ZWJ sequences, flag tag sequences, keycaps and `❤\uFE0F` are kept; an override or isolates in text with no right-to-left letter are removed; RLM in Hebrew text is kept; `辻` with one registered ideographic variation selector is kept; NBSP and thin space are untouched.

## 3. The confusion model

### 3.1 Data

For each **model alphabet** — Latin, Cyrillic, Greek, plus Armenian, Cherokee and Coptic to prove the design extends — the model lists, **per letter and per case**, the letters of every other model alphabet it can be visually mistaken for (its _twins_). A letter with no twin in alphabet X is a **proof letter** against X: a word containing it cannot be X in disguise.

| alphabet                   | letters                                                                    | precomposed letters                                                              |
| -------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Latin                      | `A–Z a–z`                                                                  | judged by NFD base: `é` is judged as `e`; the accent is carried through the fold |
| Cyrillic                   | U+0400–045F, `Ґґ`, palochka `Ӏӏ`, `Үү Һһ Әә Өө`, Komi/Kurdish `ԁ Ԍԍ Ԛԛ Ԝԝ` | same (`Ё` = `Е`+U+0308, `Й` = `И`+U+0306)                                        |
| Greek                      | U+0391–03A9, U+03B1–03C9, `ϳ Ϳ`                                            | same (tonos/dialytika decompose)                                                 |
| Armenian, Cherokee, Coptic | the script's letter blocks                                                 | same                                                                             |

Letters of a model script outside these sets (IPA, small capitals, historic letters) are **exotic**: native to their script, twin-less, and left to the Identifier_Status rule of the Latin-model judge (`src/token.ts`).

**Core targets.** A letter is only ever folded **into** a core letter: Latin `A–Za–z`, Cyrillic U+0400–045F + `Ґґ`, Greek U+0391–03C9. Komi `ԁ`, palochka `ӏ` and `һ` stay twins as _sources_ (they are favourite look-alikes of Latin letters), but a Latin letter is never folded into them. Without this rule nearly every Latin `l` would read as Cyrillic `ӏ` and stop being a proof letter.

### 3.2 Where the table comes from

**Derived from UTS #39, then curated.** Two alphabet letters of different alphabets are twins when their single-letter UTS #39 skeletons are equal. This keeps the table in step with each Unicode security release (same refresh path as `scripts/generate-confusables.mjs`).

How noisy the derivation is, measured on 17.0.0 for Latin↔Cyrillic↔Greek:

- 101 twin pairs derived; 7 are **cross-case** (UTS #39 clusters ignore case: Cyrillic capital `І`/`Ӏ` and Greek `Ι` sit with Latin small `l`; Cyrillic capital `Ь` with Latin small `b`).
- 41 alphabet letters have a prototype outside every alphabet (small capitals, IPA, digits, multi-character: `в→ʙ т→ᴛ н→ʜ м→ʍ и→ᴎ к→ĸ`, `m→rn`, `Ы→bl`, `Ю→lO`, `б→6`, `З→3`). These come out twin-less, which is what makes them proof letters.
- UTS #39 also lists pairs that the visual study (§8) found distinct in every font: `У/Y`, `ү/y`, `α/a`, `ρ/p`, `ι/i`, `υ/u`, `γ/y`, `ν/v`, `г/r`. They stay in the table: the criterion is running text, not side-by-side glyphs (§8.2).

**Case rules.**

- Twins are case-specific: `В`↔`B` is a twin, `в` has no Latin twin; `Т`↔`T`, `т` none; `Н`↔`H`, `н` none; `М`↔`M`, `м` none. `foldChar`'s case-partner fallback (`src/confusables.ts`) does not make this distinction.
- Cross-case pairs do **not** count, except four directional source→target folds that are real lowercase lookalikes: `І→l`, `Ӏ→l`, `Ι→l`, `Ь→b` (`paypaІ`, `Ьank`).
- When a capital sits among lowercase letters, a lowercase twin is preferred (`раураІ` → `paypal`, not `paypaI`).
- **Italic twins are conditional, default off**: `т`~~`m` and `и`~~`u` look distinct to a Russian reader upright, but italic fonts render them pixel-identical (§8.1). They are in the per-pair conditional set (§3.3), off by default; words using them (`тail`, `тime`) are then reported as mixed (`mixed_non_legitimate`) and left as written.

**Curated overrides** (`OVERRIDES` in `scripts/derive-confusion-table.mjs`, each with its reason in code). Criterion: alike in running text, not glyph-to-glyph.

| change         | pair                 | reason                                                                                                                                                                                                          |
| -------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| add            | `ω`~`w`              | alike in running text; no UTS #39 entry                                                                                                                                                                         |
| conditional    | `χ`~~`x`, `η`~~`n`   | descender twins, enabled per pair (§3.3)                                                                                                                                                                        |
| keep (UTS #39) | `ш`↔`w`, `σ`↔`o`/`о` | alike; derived as-is, no override                                                                                                                                                                               |
| not added      | `к`~~`k`, `κ`~~`k`   | distinct: Latin `k`'s ascender stands out. UTS #39 sends both to kra `ĸ`                                                                                                                                        |
| pack pair      | `п`→`n`, `n`→`п`     | an ordinary look-alike in both directions: the English pack holds `п`→`n`, the Russian and Ukrainian packs hold `n`→`п`. A pair of the packs (§17.8), not of the twin table: `twinsOf('п')` lists no Latin twin |

Result: **102** Latin/Cyrillic/Greek twin pairs (101 derived + `ω`~`w`; 7 cross-case), plus the enabled descender twins: **107** with the default set (§3.3).

**Proof letters against Latin** (no Latin twin in that case; a word containing one cannot be a word of Latin letters in disguise):

| alphabet                    | lowercase                                                  | uppercase                                          |
| --------------------------- | ---------------------------------------------------------- | -------------------------------------------------- |
| Cyrillic (Russian alphabet) | `б в д ж з и й к л м н п т ф ц ч щ ъ ы ь э ю я` (23 of 33) | `Б Г Д Ж З И Й Л П Ф Ц Ч Ш Щ Ъ Ы Э Ю Я` (19 of 33) |
| Greek                       | `β δ ε ζ η θ κ λ μ ξ π τ φ ψ` (14 of 24)                   | `Γ Δ Θ Λ Ξ Π Σ Φ Ψ Ω` (10 of 24)                   |

**Proof letters against Cyrillic / Greek** (Latin letters with no twin there):

| target   | lowercase                           | uppercase                 |
| -------- | ----------------------------------- | ------------------------- |
| Cyrillic | `b d f g h k l m n q t u v z`       | `D F G L N Q R U V W Z`   |
| Greek    | `b c d e f g h j k l m n q r s t z` | `C D F G J L Q R S U V W` |

Proof letters through the rules for `к`, `κ`, `η`: Cyrillic `к`, Greek `κ η` against Latin; Latin `k` against Cyrillic and Greek, Latin `n` against Greek. No proof letters, through curated or kept twins: Cyrillic `ш` (lowercase), Greek `σ ω`, and `χ` while the descender pair `χ`~`x` is enabled (default).

### 3.3 Conditional twins: descender and italic

The conditional twins are additional look-alike packs (§17.8), selected with `conditionalTwins` or `buildLookalikes({ additional })`. The pair `ı` → `i` is also in the default English pack, so it applies whatever the set: `lınk` → `link` (rule `conditional-twin`), unless Turkish letters are near (§17.8).

A separate twin class for pairs that look alike only under some rendering: **descender twins** differ from their twin only below the baseline (each such letter has two matching forms, with and without its descender); **italic twins** match only in italic fonts. The caller enables them **per pair** (`conditionalTwins`: a set of pair ids), not by a global console/web mode: `CONDITIONAL_TWINS` in `scripts/derive-confusion-table.mjs`.

| id    | pairs                         | kind                        | default                                      |
| ----- | ----------------------------- | --------------------------- | -------------------------------------------- |
| `χ~x` | Greek `χ` ↔ Latin `x`         | cross-alphabet              | on                                           |
| `χ~х` | Greek `χ` ↔ Cyrillic `х`      | cross-alphabet              | on                                           |
| `ҳ~x` | Cyrillic `ҳ` ↔ `x`, `Ҳ` ↔ `X` | cross-alphabet              | on                                           |
| `ҳ~χ` | Cyrillic `ҳ` ↔ Greek `χ`      | cross-alphabet              | on                                           |
| `η~n` | Greek `η` ↔ Latin `n`         | cross-alphabet              | off                                          |
| `ŋ~n` | Latin `ŋ` → `n`, `Ŋ` → `N`    | intra-Latin fold            | off                                          |
| `ɳ~n` | Latin `ɳ` → `n`               | intra-Latin fold            | off                                          |
| `и~u` | Cyrillic `и` ↔ Latin `u`      | italic                      | off                                          |
| `т~m` | Cyrillic `т` ↔ Latin `m`      | italic                      | off                                          |
| `ı~i` | Latin `ı` → `i`               | shape, intra-Latin fold     | off; the pair is in the default English pack |
| `ҫ~c` | Cyrillic `ҫ` ↔ `c`, `Ҫ` ↔ `C` | descender                   | off                                          |
| `ɽ~r` | Latin `ɽ` → `r`               | descender, intra-Latin fold | off                                          |
| `ʐ~z` | Latin `ʐ` → `z`               | descender, intra-Latin fold | off                                          |

**Default set: `χ~x` `χ~х` `ҳ~x` `ҳ~χ` on; `η~n` `ŋ~n` `ɳ~n` `и~u` `т~m` `ı~i` `ҫ~c` `ɽ~r` `ʐ~z` off** (`DEFAULT_CONDITIONAL_TWINS`). With `conditionalTwins: []` the four x-likes are off too (`χbox` is then reported as mixed and left). `ҳ Ҳ` (Tajik, Uzbek) are Cyrillic model letters for this, so Tajik and Uzbek are languages of the model (§4.4) — otherwise every Tajik word with `ҳ` would carry foreign-letter evidence. Intra-Latin folds (with `ŋ~n` on: `ŋame` → `name`, rule `conditional-twin`) apply to words of Latin letters like the case anomaly (§4.6), counted as confusable.

**Measurement** (`scripts/measure-descender-pairs.mjs` → `docs/evidence/descender-pairs.json`, `descender-pairs.png`): each pair rendered at 64 px in the 8 corpus fonts with all ink below the alphabetic baseline erased, then pixel-compared as in §8 (identical = 0 differing pixels, near = < 12 %).

| pair  | group     | clipped at baseline: identical / near (of 8 fonts) | diff ratio range | status                               |
| ----- | --------- | -------------------------------------------------- | ---------------- | ------------------------------------ |
| `χ~x` | x-like    | 0 / 0                                              | 0.69–0.83        | **on** (default)                     |
| `ҳ~x` | x-like    | 0 / 8                                              | 0.00–0.09        | **on** (default)                     |
| `ҳ~х` | x-like    | 0 / 8                                              | 0.00–0.09        | intra-Cyrillic, not modelled         |
| `χ~х` | x-like    | 0 / 0                                              | 0.69–0.83        | **on** (default)                     |
| `χ~ҳ` | x-like    | 0 / 0                                              | 0.69–0.83        | **on** (default, id `ҳ~χ`)           |
| `Ҳ~X` | x-like    | 2 / 6                                              | 0.00–0.07        | **on** (part of `ҳ~x`)               |
| `Ҳ~Х` | x-like    | 2 / 6                                              | 0.00–0.07        | intra-Cyrillic, not modelled         |
| `η~n` | maybe     | 2 / 2                                              | 0.00–0.58        | off (default), id `η~n`              |
| `ŋ~n` | maybe     | 3 / 3                                              | 0.00–0.35        | off (default), id `ŋ~n`, intra-Latin |
| `ɳ~n` | maybe     | 3 / 2                                              | 0.00–0.64        | off (default), id `ɳ~n`, intra-Latin |
| `μ~u` | candidate | 0 / 0                                              | 0.18–0.47        | data only, not enabled               |
| `ς~c` | candidate | 0 / 1                                              | 0.09–0.47        | data only, not enabled               |
| `ц~u` | candidate | 1 / 1                                              | 0.00–0.61        | data only, not enabled               |
| `щ~w` | candidate | 0 / 0                                              | 0.69–0.84        | data only, not enabled               |
| `ҫ~c` | candidate | 0 / 7                                              | 0.02–0.31        | data only, not enabled               |
| `ç~c` | candidate | 4 / 2                                              | 0.00–0.19        | data only, not enabled               |
| `Ц~U` | candidate | 0 / 0                                              | 0.42–0.58        | data only, not enabled               |
| `Щ~W` | candidate | 0 / 0                                              | 0.72–0.85        | data only, not enabled               |
| `Ҫ~C` | candidate | 1 / 5                                              | 0.00–0.19        | data only, not enabled               |
| `Ç~C` | candidate | 6 / 0                                              | 0.00–0.19        | data only, not enabled               |
| `ң~н` | other     | 0 / 6                                              | 0.00–0.67        | data only, not enabled               |
| `қ~к` | other     | 1 / 7                                              | 0.00–0.10        | data only, not enabled               |
| `ҷ~ч` | other     | 1 / 4                                              | 0.00–0.88        | data only, not enabled               |
| `ҙ~з` | other     | 0 / 1                                              | 0.05–0.33        | data only, not enabled               |
| `ҫ~с` | other     | 0 / 7                                              | 0.02–0.31        | data only, not enabled               |
| `ɖ~d` | other     | 1 / 4                                              | 0.00–0.53        | data only, not enabled               |
| `ɭ~l` | other     | 1 / 3                                              | 0.00–0.50        | data only, not enabled               |
| `ʈ~t` | other     | 0 / 0                                              | 0.15–0.35        | data only, not enabled               |
| `ɽ~r` | other     | 3 / 4                                              | 0.00–0.16        | data only, not enabled               |
| `ʂ~s` | other     | 0 / 5                                              | 0.01–0.26        | data only, not enabled               |
| `ʐ~z` | other     | 3 / 2                                              | 0.00–0.58        | data only, not enabled               |
| `ц~и` | other     | 1 / 1                                              | 0.00–0.68        | data only, not enabled               |
| `щ~ш` | other     | 1 / 6                                              | 0.00–0.49        | data only, not enabled               |
| `Ц~И` | other     | 0 / 0                                              | 0.20–0.67        | data only, not enabled               |
| `Щ~Ш` | other     | 0 / 5                                              | 0.00–0.56        | data only, not enabled               |
| `д~л` | other     | 0 / 0                                              | 0.44–0.90        | data only, not enabled               |

Reading:

- `ҳ`~~`x`/`х` is a true descender twin: near in all 8 fonts once clipped. `Ҳ`~~`X` is identical in 2 and near in 6.
- `χ`~`x` is **not** a descender twin by this test (0/8): `χ` straddles the baseline, so its upper half is a `v`/`γ`-like fork. It stays on because it reads as `x` in running text (font-dependent: identical in some terminal fonts).
- `η ŋ ɳ`~`n`: identical in Noto Sans and DejaVu Sans, distinct in the serifs — font-dependent, so off by default.
- Other pairs that come out identical or near in most fonts once clipped (data only, not enabled): `ç`~~`c` (4 identical / 2 near), `Ç`~~`C` (6/0), `ҫ`~~`c` (0/7), `Ҫ`~~`C` (1/5), `ɽ`~~`r` (3/4), `ʐ`~~`z` (3/2); intra-Cyrillic `қ`~~`к` (1/7), `ң`~~`н` (0/6), `щ`~`ш` (1/6). `ç Ç` are judged by their NFD base (`c` + cedilla mark), so they need no pair.
- Not alike even clipped: `μ`~~`u`, `щ`~~`w`, `Щ`~~`W`, `Ц`~~`U`, `ʈ`~~`t`, `ς`~~`c` (1 near); `ц`~`u` only in the italics.

**Italic twins, effect** (`{ confusionModel: 'language', conditionalTwins: [...] }`): with `и~u`, `иser` → `user`. With `т~m`, `тail` → `mail` and `тime` → `mime`. With both, Russian words made only of letters that have English twins fold into English through an English context: `Wi-Fi-роутер` → `Wi-Fi-poymep`, `по e-mail` → `no e-mail`. Glyph evidence: §8.1 (`т и` pixel-identical to `m u` in both italic fonts).

### 3.4 Targets and donors: N target languages × (N + M) alphabets

The twin table is pairwise across every letter of **N + M alphabets**; folding happens only **into** one of N target languages:

- **Targets** (`targetLanguages`, N; default `English`, `Russian`, `Ukrainian`, `Greek`): fold destinations. A word folds into a target language only if that language covers every letter after folding (§4.5). Any language of §4.4 can be added (`Ukrainian`, `Greek`, `Bulgarian`, `Kazakh`, …); `N = 4` is only the default (§4.5).
- **Donors** (`donorAlphabets`, M; default: every alphabet no target uses): letters that may appear as lookalikes — substitutions in a word, and evidence (§4.4) — but are never fold targets. With the default targets: Armenian, Cherokee, Coptic, the Latin extras below, and the letters of target scripts outside every target language (Macedonian `ѕ`, Serbian `ј`, Caucasian `ӏ`, Komi `ԁ`, Greek `ϳ`). For an English + Russian reader Greek and Ukrainian `і ї є ґ` would be donors too. A donor alphabet left out of `donorAlphabets` is outside the model (its words go to the Latin-model judge).

**Latin extras** (`LatinExtra`, a donor alphabet in `scripts/derive-confusion-table.mjs`): Latin-script letters of Latin-1/Extended-A/B (U+00C0–024F, non-decomposing), IPA (U+0250–02AF) and phonetic small capitals (U+1D00–1D2B, `ꜰ ꜱ`), kept when UTS #39 gives them a twin in another alphabet, plus a curated small-capital set (`ᴀ`→`a`, `ʙ`→`b`, … `ᴢ`→`z`: they read as the lowercase letter at x-height; UTS #39 maps most of them to themselves). In a configuration, a Latin extra is a donor only if it has a twin among the target Latin letters and is not a letter of a modelled European language (`ı þ ð ß æ œ ø ł đ` stay ordinary Latin). Default donors: `ſ ƍ ƒ Ɩ Ʀ ƽ ƿ ǀ ɑ ɡ ɢ ɣ ɩ ɪ ɯ ɴ ʀ ʋ ʏ ʙ ʜ ʟ ᴀ ᴄ ᴅ ᴇ ᴊ ᴋ ᴍ ᴏ ᴑ ᴘ ᴛ ᴜ ᴠ ᴡ ᴢ ꜰ ꜱ`.

- `ı` and `þ` are letters of the `European` language. With `English` requested (the default) they are letters of no requested language: `þ` reads `p` (`þorn` → `porn`) and `ı` reads `i` (`Lınkedin` → `Linkedin`), except that `ı` stays where Turkish letters are near (`İstanbul'da ışık` stays). With `European` requested in place of `English` both stay as written.
- A word made only of donor letters of no language (`ᴀᴅᴍɪɴ`, upside-down text) carries donor evidence and folds through the ladder: `ᴀᴅᴍɪɴ` → `admin`. Whole words of a donor _language_ (Armenian; Greek when it is not requested) follow the whole-script rule (§4.3): folded only with context.

**Table sizes** (UTS #39 17.0.0 + curated + default conditional twins):

| alphabet   | letters | role (default config)                                                                 |
| ---------- | ------- | ------------------------------------------------------------------------------------- |
| Latin      | 52      | script of a requested language (English: 26 letters × 2 cases)                        |
| Cyrillic   | 103     | script of requested languages (Russian + Ukrainian: 35 bases); the rest donors        |
| Greek      | 51      | script of a requested language (Greek: 25 letters)                                    |
| Armenian   | 76      | donor                                                                                 |
| Cherokee   | 172     | donor                                                                                 |
| Coptic     | 114     | donor                                                                                 |
| LatinExtra | 82      | donor (41 in the default config, list above)                                          |
| **total**  | **650** | **643** twin pairs with the default conditional set; 107 of them Latin/Cyrillic/Greek |

Pairs per alphabet pair: Coptic–Cyrillic 52, Cyrillic–LatinExtra 52, Coptic–LatinExtra 48, Cherokee–LatinExtra 47, Cherokee–Cyrillic 45, Latin–LatinExtra 44, Cyrillic–Latin 43, Coptic–Greek 41, Cyrillic–Greek 37, Cherokee–Latin 35, Cherokee–Coptic 32, Greek–LatinExtra 29, Greek–Latin 27, Cherokee–Greek 24, Coptic–Latin 24, Armenian–LatinExtra 17, Armenian–Latin 14, Armenian–Cyrillic 10, Armenian–Greek 8, Armenian–Coptic 8, Armenian–Cherokee 6. Visual evidence for the donor pairs: §8.1 (Armenian `ս օ հ ո` identical to `u o h n` in DejaVu Sans only; `ɡ`≈`g` in sans fonts; Cherokee distinct in every font) — the derivation keeps UTS #39's pairs regardless, as for Latin/Cyrillic/Greek (§3.2).

## 4. Resolver algorithm

**Which words this section covers.** The ladder of §4.2 decides a word as a whole. It applies to a word whose letters belong to at most one requested language: a word written wholly in one alphabet (§4.3), a word of donors only (`ᴀᴅᴍɪɴ`), and a word of one requested language's letters plus donors (`pɑypal`, `ҳbox`; `раураl` when Russian and Ukrainian are not requested). A word that holds letters of two or more requested languages (`pаypal`, `раураl`, `кey` with English and Russian requested) is never mapped as a whole: only its look-alike pieces are corrected, by the piece rules of §17.10 (a one-letter piece that is not the last, or a piece between two pieces, toward the side that holds more of the word's letters), and anything else in it is reported as `mixed_non_legitimate` and left as written. The finding of such a word has no `resolution`.

### 4.1 Steps

Per text:

1. **Tokens.** Tokenize as §1. **Apostrophe endings:** if a token is `<stem with a Latin letter>` + `'`/`’` + 1–3 Cyrillic letters that form a Russian case ending, the stem is judged alone and the ending is kept as written. Endings (`RU_CASE_ENDINGS`): `а я у ю е и ы ом ем ём ой ей ою ею ов ев ёв ам ям ах ях ами ями`. Anything else is judged as one token (`pаypal’ѕ`: its `а` is corrected, §4.8). Hyphens split tokens (`Docker-контейнер`, `Wi-Fi-роутер`); with `hiddenChars: 'strict'` the parts of a dash or apostrophe token are judged as §17.5 says.
2. NFD each token into base letter + marks. If any letter is outside the model (Han, Arabic, …) the ladder does not apply; the word gets a mixed category (§17.10: `AI技術`, `日本語のtext` are `mixed_legitimate`).
3. For every requested language L: L is **valid** for a word when the word folded with L's letters only is all L's letters: every letter is one of L's or has a same-case (or allowed cross-case) twin among them. Letters with no twin are the **blockers**.
4. **Internal evidence** of a single-script word against its own script: a lookalike letter outside every language of the script (§4.4) or an I-shaped final letter after lowercase letters (§4.6). A broken positional spelling rule (§4.7) is no evidence.
   A target language is valid only if the word folded into it fits it, positional rules included (`paᏏy` read as `раЬу` breaks "no `ь`/`ъ` after a vowel", so no Russian or Ukrainian reading is valid).
5. **Clean words** give context: letters of one model alphabet, a vote for the requested languages holding all its letters, no requested language of another alphabet can take it, no internal evidence (`dog`, `Мы`, `были` are clean; `HOT`, `is`, `now` — valid in Armenian `ո օ ա` — `сор`, `раураӏ` are not). The judged word never counts for itself.
6. Choose the target with the ladder (§4.2); whole-script words follow §4.3.
7. Fold each letter the target language does not have to its best twin among that language's letters (same case first), re-attach marks, NFC. A capital among lowercase letters takes a lowercase twin (`раураІ` → `paypal`).

### 4.2 Target ladder

Candidates = the requested target **languages** that can take the word: folded with that language's letters only, every letter is that language's (§4.5); for a whole-script word, languages of other alphabets than its own (§4.3). The first step that names a candidate decides; `rule` records it, `resolution.language` and `toLang` the language.

**Per-language rule.** Targets, folds, contexts and votes are languages, not alphabets; Russian and Ukrainian are separate targets. A context word votes for the requested languages whose letters hold all its letters (Russian-only `ы э ъ ё` → Russian, `ё` being a letter of its own (§4.4); Ukrainian-only `і ї є ґ` → Ukrainian; a word of shared letters → both; a word no requested language holds, such as pre-reform `вѣръ`, votes for none). Step 1 names the languages both nearest words share; step 2 the language with strictly the most letters in the window. A context language that cannot take the word gives no candidate, and the next step decides. A lone cap-height stroke (`ǀ ꓲ ᛁ ⵏ …`) never reaches the ladder: it is the Roman numeral `I` (a Latin language, English by default) in any context (`Он ǀ она`, `Пётр ǀ пришёл` → `I`, never Ukrainian `І` or Greek `Ι`); with no language written in Latin letters requested it stays as written and is reported (no requested target can take it), every stroke alike; a stroke of another writing in text of its own script stays unreported (41b: `هذا ا كتاب`). No other letter is folded into an unrequested language either: `Kǀ` (Kelvin sign) alone with Russian and Ukrainian converts only the sign (`Kǀ`, reported); in Russian text with Russian and Ukrainian it gives `КІ`. `toLang` names no language for an output with no letter (digits carry no target, 41l: `Ꮞ04` → `404`); a neutral's own output keeps its language whatever is requested (40d: `ℂ` → `C` is English). A context-free choice among several languages is the request order. A fold writes only the chosen language's letters (`twinIn` within that language). The word itself is that language when one requested language holds all its letters; a word written in its context's language stays.

| order            | rule                                | decides when                                                                                                                                                                              |
| ---------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| before the steps | `conditional-twin` / `case-anomaly` | a word of one requested language's letters that holds a same-alphabet pair (`ſ`, `ı`, an enabled intra-Latin twin) or carries the case anomaly (§4.6): folded within that language        |
| before the steps | `one-target`                        | a donor-only word that exactly one requested language can take, whatever its context; a lone cap-height stroke                                                                            |
| 1                | `neighbours`                        | the nearest word on the left **and** the nearest word on the right (same paragraph) are written in a common requested language, and it is a candidate                                     |
| 2                | `window`                            | the words within `majorityWindow` (10) words on each side, same paragraph, have a strict letter majority of one requested language, and it is a candidate                                 |
| 3                | `primary-target`                    | a whole-alphabet word with evidence, or a donor-only word, that several languages can take: the first candidate in request order                                                          |
| 4                | `word-majority`                     | a mixed word: the candidate that holds most of its letters, strictly ahead, with at least `ladder.wordMajorityMinLetters` (3) letters and `ladder.wordMajorityMinShare` (2/3) of the word |
| 5                | `any-valid`                         | a mixed word with no such majority: the first candidate in request order                                                                                                                  |
| —                | `no-valid-language`                 | no candidate: reported, left as written                                                                                                                                                   |
| —                | `evidence`                          | `wholeScriptFold: 'off'`: a whole-alphabet word with evidence is reported, not folded (§4.3)                                                                                              |

`resolveWord(word, { neighbours, hyphen: true })` names step 1 `hyphen`; `analyze` always names it `neighbours`. A whole-alphabet word without evidence is folded only by step 1 or 2 (§4.3), and stays when the context language is one its own letters fit. A mixed word is a candidate only for a requested language that already holds one of its letters; a donor-only word for every requested language that can take it.

- **Step 1 needs both sides.** At a text or paragraph edge step 1 does not decide and step 2 does. In `Το iPhone είναι ακριβό` the only right neighbour of `Το` is the English `iPhone`; with both sides required, the window (Greek 11 letters, English 6) keeps the Greek word. Without the words after it, `Το iPhone` gives `To iPhone` (rule `window`).
- **Hyphen compounds**: without `hiddenChars: 'strict'` a hyphen splits tokens and each part is a word with the other parts among its neighbours: in `СОСА-СОЛА` the part `СОЛА` holds `Л`, a proof letter, so nothing names another language and the word stays; `СОСА-COLA` → `COCA-COLA` (rule `window`). With `hiddenChars: 'strict'` the parts form one token whose context comes from outside it (§17.5): `СОСА-COLA` alone stays as written.
- **Window ±10 words within the paragraph** (blank line = paragraph break). Ten words a side is one to two sentences, ≈ 100 letters of evidence, enough to outvote a quoted brand or a stray foreign word; the paragraph bound keeps a reply in one language from voting on a quoted paragraph in another; a fixed window keeps the cost linear for unbroken long texts (chat logs, scraped pages) and keeps the choice local where a whole-text majority would let one long section decide for the rest.
- **Evidence without context**: `раураӏ` and `раураІ` (a letter that is not Russian; the case anomaly) fold into English by `primary-target`, also inside Russian text (`Зайди на раураӏ сегодня`).
- **One requested language plus donors**: `pɑypal`, `ɡoogle` → `word-majority`; `ҳbox` → `xbox`. `paᏏy` has no candidate (its Russian reading breaks a positional rule; `Ꮟ` has no English pair): `no-valid-language`.
- **Two requested languages in one word** do not reach the ladder (see the start of §4): `раураl`, `кey`, `тap`, `ΑΡΡLE`, `Bank ассоunt verification` are reported and left with the default languages. With `targetLanguages: ['English']`, `раураl` → `paypal` and `ΑΡΡLE` → `APPLE` by `any-valid` (§4.5).

### 4.3 Whole-script words and `wholeScriptFold`

A word written entirely in one alphabet S (`НОТ`, `сор`, `раураӏ`). Never below 2 letters (a donor, a same-alphabet pair and a lone cap-height stroke excepted), never when one language of `inputLanguages` holds all its letters. A word of Latin letters is never folded into a language written in another alphabet; its only folds are within Latin: the case anomaly (§4.6, `paypaI`) and same-alphabet pairs (`ſ`, `ı`, §3.3).

One option, three modes:

| `wholeScriptFold`   | whole-script word **without** internal evidence      | whole-script word **with** internal evidence (§4.4, §4.6)      |
| ------------------- | ---------------------------------------------------- | -------------------------------------------------------------- |
| `'off'`             | never folded, not reported                           | reported (`confusable_word`, rule `evidence`), left as written |
| `'foreign-letters'` | never folded, not reported                           | folded by the ladder                                           |
| `'all'` (default)   | folded only when step 1 or 2 names another candidate | folded by the ladder                                           |

A whole-script word whose context (step 1 or 2) is a language its own letters fit stays as written, unless it carries evidence. Evidence only counts when another requested language can take the word (Chechen `маӏа` has none, so it is left alone). A word the context would fold is kept and reported as `whole_word_lookalike` when a word next to it is a clean word of its own language (§17.10).

Generated tables, one per mode. `{ confusionModel: 'language', wholeScriptFold: 'all' }`:

<!-- examples: ref-4.3-all -->

| Input                     | Output                    | Spoofed | Signals           | Rule             |
| ------------------------- | ------------------------- | ------- | ----------------- | ---------------- |
| `НОТ dog`                 | `HOT dog`                 | yes     | `confusable_word` | `window`         |
| `НОТ deal today`          | `HOT deal today`          | yes     | `confusable_word` | `window`         |
| `Мы были в НОТ`           | `Мы были в НОТ`           | no      | —                 | —                |
| `I bought сор today`      | `I bought cop today`      | yes     | `confusable_word` | `neighbours`     |
| `раураӏ`                  | `paypal`                  | yes     | `confusable_word` | `primary-target` |
| `go to аррӏе.com`         | `go to apple.com`         | yes     | `confusable_word` | `neighbours`     |
| `Зайди на раураӏ сегодня` | `Зайди на paypal сегодня` | yes     | `confusable_word` | `primary-target` |
| `раураІ`                  | `paypal`                  | yes     | `confusable_word` | `primary-target` |
| `paypaI`                  | `paypal`                  | yes     | `confusable_word` | `case-anomaly`   |
| `Το iPhone είναι ακριβό`  | `Το iPhone είναι ακριβό`  | no      | —                 | —                |

<!-- /examples -->

`{ confusionModel: 'language', wholeScriptFold: 'foreign-letters' }`:

<!-- examples: ref-4.3-foreign-letters -->

| Input                     | Output                    | Spoofed | Signals           | Rule             |
| ------------------------- | ------------------------- | ------- | ----------------- | ---------------- |
| `НОТ dog`                 | `НОТ dog`                 | no      | —                 | —                |
| `НОТ deal today`          | `НОТ deal today`          | no      | —                 | —                |
| `Мы были в НОТ`           | `Мы были в НОТ`           | no      | —                 | —                |
| `I bought сор today`      | `I bought сор today`      | no      | —                 | —                |
| `раураӏ`                  | `paypal`                  | yes     | `confusable_word` | `primary-target` |
| `go to аррӏе.com`         | `go to apple.com`         | yes     | `confusable_word` | `neighbours`     |
| `Зайди на раураӏ сегодня` | `Зайди на paypal сегодня` | yes     | `confusable_word` | `primary-target` |
| `раураІ`                  | `paypal`                  | yes     | `confusable_word` | `primary-target` |
| `paypaI`                  | `paypal`                  | yes     | `confusable_word` | `case-anomaly`   |
| `Το iPhone είναι ακριβό`  | `Το iPhone είναι ακριβό`  | no      | —                 | —                |

<!-- /examples -->

`{ confusionModel: 'language', wholeScriptFold: 'off' }`:

<!-- examples: ref-4.3-off -->

| Input                     | Output                    | Spoofed | Signals           | Rule           |
| ------------------------- | ------------------------- | ------- | ----------------- | -------------- |
| `НОТ dog`                 | `НОТ dog`                 | no      | —                 | —              |
| `НОТ deal today`          | `НОТ deal today`          | no      | —                 | —              |
| `Мы были в НОТ`           | `Мы были в НОТ`           | no      | —                 | —              |
| `I bought сор today`      | `I bought сор today`      | no      | —                 | —              |
| `раураӏ`                  | `раураӏ`                  | yes     | `confusable_word` | `evidence`     |
| `go to аррӏе.com`         | `go to аррӏе.com`         | yes     | `confusable_word` | `evidence`     |
| `Зайди на раураӏ сегодня` | `Зайди на раураӏ сегодня` | yes     | `confusable_word` | `evidence`     |
| `раураІ`                  | `раураІ`                  | yes     | `confusable_word` | `evidence`     |
| `paypaI`                  | `paypaI`                  | yes     | `confusable_word` | `case-anomaly` |
| `Το iPhone είναι ακριβό`  | `Το iPhone είναι ακριβό`  | no      | —                 | —              |

<!-- /examples -->

The same inputs under the Latin-fold model (no options), which folds a single-script word whose UTS #39 skeleton is ASCII when the text's dominant script is Latin (letter count over the whole text, the word included) or the text has a mixed word:

<!-- examples: ref-4.3-latin -->

| Input                     | Output                    | Spoofed | Signals           |
| ------------------------- | ------------------------- | ------- | ----------------- |
| `НОТ dog`                 | `НОТ dog`                 | no      | —                 |
| `НОТ deal today`          | `HOT deal today`          | yes     | `confusable_word` |
| `Мы были в НОТ`           | `Мы были в НОТ`           | no      | —                 |
| `I bought сор today`      | `I bought cop today`      | yes     | `confusable_word` |
| `раураӏ`                  | `раураӏ`                  | no      | —                 |
| `go to аррӏе.com`         | `go to apple.com`         | yes     | `confusable_word` |
| `Зайди на раураӏ сегодня` | `Зайди на раураӏ сегодня` | no      | —                 |
| `раураІ`                  | `раураІ`                  | no      | —                 |
| `paypaI`                  | `paypaI`                  | no      | —                 |
| `Το iPhone είναι ακριβό`  | `Το iPhone είναι ακριβό`  | no      | —                 |

<!-- /examples -->

### 4.4 Language alphabets inside a script

`LANGUAGES` in `src/languages.ts`. A precomposed letter an alphabet lists is a letter of its own, never its NFD base (per-language rule): `ё` is Russian (and Belarusian, Kazakh, …), never Ukrainian `е`; `ї` Ukrainian; `ў` Belarusian and Uzbek; `ѓ ќ` Macedonian; `ӣ ӯ` Tajik; `й` every alphabet that lists it. Written decomposed (`е` + U+0308) it is the same letter. Other marks are diacritics, judged by the base letter (Greek tonos; Latin accents: `é` as `e`). The stand-alone resolver (`scripts/prototype-resolve.mjs`) judges by NFD base:

| script   | languages                                                                                                                                                                                                                                                                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cyrillic | Russian (`ё`), Ukrainian (`ґ є і ї`, no `ъ ы э ё`), Belarusian (`і ў`, no `щ ъ`), Bulgarian (no `ы э ё`), Serbian (`ђ ј љ њ ћ џ`), Macedonian (`ѓ ѕ ј љ њ ќ џ`), Kazakh (`ә ғ қ ң ө ұ ү һ і`), Tajik (`ғ қ ҳ ҷ ӣ ӯ`, no `щ ы ь ц`), Uzbek (`қ ғ ҳ ў`, no `щ ы`), Caucasian palochka languages (Russian + `ӏ` after `г д к л п т ф х ц ч ш щ ж с з` or word-initial) |
| Latin    | one European set: `a–z ß æ œ ø þ ð ı ł đ` (accents are marks)                                                                                                                                                                                                                                                                                                       |
| Greek    | modern Greek `α–ω ς`                                                                                                                                                                                                                                                                                                                                                |

**Foreign-letter evidence** = letters of a single-script word that fall outside the best-fitting language, keeping only those with a twin in another alphabet (lookalikes). Tatar `җ` or Bashkir `ҡ` have no twin: an unmodelled language, not evidence. `ԁ ԛ ԝ`, `ӏ` after a vowel or `р`, Greek `ϳ` are evidence.

- `аррӏе` → evidence `ӏ` (after `р`); `раураӏ` → case anomaly first (§4.6).
- Corpus legit Cyrillic/Greek cases: no evidence on any word (Kazakh, Belarusian, Serbian, Macedonian, Bulgarian, Ukrainian rows all fit).
- Real-text scan (Markdown, 5.83 M tokens, test material excluded): 0 occurrences.
- Known gap: Chechen also writes `Ӏ` as a consonant after vowels (`маӀа`). The positional rule marks such words; they stay unflagged only because no other alphabet is valid for them. A Chechen word made only of Latin-twinned letters plus a post-vowel palochka would be folded.

### 4.5 Target languages

Target validity is judged at **language** level, not script-wide: a word is folded only into an **enabled target language**, every letter after folding in that language's alphabet, positional rules (§4.7) included. Option `targetLanguages` (`TARGET_LANGUAGES` in `src/languages.ts`: `English` = `a–z`, plus every language of §4.4). The other languages serve as evidence (§4.4); twins into a script are restricted to target-language letters (`ѕ`, `ӏ`, `і` are fold sources, never targets, unless their language is enabled). Scripts with no enabled target language (Armenian, Cherokee, Coptic; Greek when it is not requested) are never targets.

Generated table: each word alone (`my кey here` in a sentence), with the default languages, with English only, and with English and Russian. `Rule` is `resolution.rule`; a row without one was decided by the piece rules (§17.10).

<!-- examples: ref-4.5 -->

| Input         | Options                                                                 | Output        | Spoofed | Signals                | Rule                |
| ------------- | ----------------------------------------------------------------------- | ------------- | ------- | ---------------------- | ------------------- |
| `раураl`      | `{confusionModel: 'language'}`                                          | `раураl`      | no      | `mixed_non_legitimate` | —                   |
| `раураl`      | `{confusionModel: 'language', targetLanguages: ['English']}`            | `paypal`      | yes     | `mixed_spoof`          | `any-valid`         |
| `раураl`      | `{confusionModel: 'language', targetLanguages: ['English', 'Russian']}` | `раураl`      | no      | `mixed_non_legitimate` | —                   |
| `иser`        | `{confusionModel: 'language'}`                                          | `иser`        | no      | `mixed_non_legitimate` | —                   |
| `иser`        | `{confusionModel: 'language', targetLanguages: ['English']}`            | `иser`        | no      | `mixed_non_legitimate` | `no-valid-language` |
| `иser`        | `{confusionModel: 'language', targetLanguages: ['English', 'Russian']}` | `иser`        | no      | `mixed_non_legitimate` | —                   |
| `кey`         | `{confusionModel: 'language'}`                                          | `кey`         | no      | `mixed_non_legitimate` | —                   |
| `кey`         | `{confusionModel: 'language', targetLanguages: ['English']}`            | `кey`         | no      | `mixed_non_legitimate` | `no-valid-language` |
| `кey`         | `{confusionModel: 'language', targetLanguages: ['English', 'Russian']}` | `кey`         | no      | `mixed_non_legitimate` | —                   |
| `my кey here` | `{confusionModel: 'language'}`                                          | `my кey here` | no      | `mixed_non_legitimate` | —                   |
| `my кey here` | `{confusionModel: 'language', targetLanguages: ['English']}`            | `my кey here` | no      | `mixed_non_legitimate` | `no-valid-language` |
| `my кey here` | `{confusionModel: 'language', targetLanguages: ['English', 'Russian']}` | `my кey here` | no      | `mixed_non_legitimate` | —                   |
| `тap`         | `{confusionModel: 'language'}`                                          | `тap`         | no      | `mixed_non_legitimate` | —                   |
| `тap`         | `{confusionModel: 'language', targetLanguages: ['English']}`            | `тap`         | no      | `mixed_non_legitimate` | `no-valid-language` |
| `тap`         | `{confusionModel: 'language', targetLanguages: ['English', 'Russian']}` | `тap`         | no      | `mixed_non_legitimate` | —                   |
| `ΑΡΡLE`       | `{confusionModel: 'language'}`                                          | `ΑΡΡLE`       | no      | `mixed_non_legitimate` | —                   |
| `ΑΡΡLE`       | `{confusionModel: 'language', targetLanguages: ['English']}`            | `APPLE`       | yes     | `mixed_spoof`          | `any-valid`         |
| `ΑΡΡLE`       | `{confusionModel: 'language', targetLanguages: ['English', 'Russian']}` | `APPLE`       | yes     | `mixed_spoof`          | `any-valid`         |
| `cоса`        | `{confusionModel: 'language'}`                                          | `соса`        | yes     | `mixed_spoof`          | —                   |
| `cоса`        | `{confusionModel: 'language', targetLanguages: ['English']}`            | `coca`        | yes     | `mixed_spoof`          | `any-valid`         |
| `cоса`        | `{confusionModel: 'language', targetLanguages: ['English', 'Russian']}` | `соса`        | yes     | `mixed_spoof`          | —                   |
| `Kαλημέρα`    | `{confusionModel: 'language'}`                                          | `Καλημέρα`    | yes     | `mixed_spoof`          | —                   |
| `Kαλημέρα`    | `{confusionModel: 'language', targetLanguages: ['English']}`            | `Kαλημέρα`    | no      | `mixed_non_legitimate` | `no-valid-language` |
| `Kαλημέρα`    | `{confusionModel: 'language', targetLanguages: ['English', 'Russian']}` | `Kαλημέρα`    | no      | `mixed_non_legitimate` | `no-valid-language` |
| `сiла`        | `{confusionModel: 'language'}`                                          | `сіла`        | yes     | `mixed_spoof`          | —                   |
| `сiла`        | `{confusionModel: 'language', targetLanguages: ['English']}`            | `сiла`        | no      | `mixed_non_legitimate` | `no-valid-language` |
| `сiла`        | `{confusionModel: 'language', targetLanguages: ['English', 'Russian']}` | `сiла`        | no      | `mixed_non_legitimate` | —                   |
| `мiр`         | `{confusionModel: 'language'}`                                          | `мір`         | yes     | `mixed_spoof`          | —                   |
| `мiр`         | `{confusionModel: 'language', targetLanguages: ['English']}`            | `мiр`         | no      | `mixed_non_legitimate` | `no-valid-language` |
| `мiр`         | `{confusionModel: 'language', targetLanguages: ['English', 'Russian']}` | `мiр`         | no      | `mixed_non_legitimate` | —                   |

<!-- /examples -->

- `раураl`: five Russian letters and a Latin `l`. With Russian requested it holds letters of two requested languages; its Russian letters form the first piece, of several letters, so nothing is converted. With English only, the five letters are donors and English takes the word.
- `кey`, `тap`: `к` and `т` have no English pair (`т~m` off), so English cannot take the word; the Latin letters are a last piece or a piece of several letters, so the piece rules convert nothing either.
- `иser`: `и` has no English pair unless `и~u` is on (§3.3: then `user`).
- `ΑΡΡLE`: with Greek requested, a word of two requested languages; without Greek, `Α Ρ` are donors and English takes it.
- `cоса`: with Russian requested the one Latin letter starts the word and is corrected toward the Russian side; with English only, the three Cyrillic letters are donors.
- `Kαλημέρα`, `сiла`, `мiр`: a single Latin letter in a Greek or Ukrainian word is corrected when that language is requested. `мiр` shows the cost of requesting Ukrainian: the Latin `i` has a Ukrainian twin and no Russian one, so the word is completed as Ukrainian `мір`, not Russian `мир`.

**No outnumber gate**: one target-language fit is enough for the ladder, however few of the word's letters are native to it.

**Default target languages**: `English`, `Russian`, `Ukrainian`, `Greek`.

### 4.6 Case anomaly

A word of ≥ 4 letters whose **last** letter is I-shaped (`I`, Cyrillic `І Ӏ ӏ`, Greek `Ι`) and whose inner letters are all lowercase (the first letter may be a capital) carries case-anomaly evidence: that letter is a lowercase `l` from another alphabet. Candidates are restricted to the languages of Latin letters (the only alphabet with a lowercase I-shaped letter, `l`), and the letter folds to `l`.

- Only the last position: a capital followed by lowercase letters is a camelCase hump (`iPhone GitHub McDonald eBay YouTube getId userId`); so `goIang` and `appIe` are not caught.
- ≥ 4 letters keeps chemical formulas (`NaI AgI CsI PbI2`).
- Palochka after a palochka consonant is exempt (Caucasian digraph `кӏ`, `дӏ`).
- Measured: 52 camelCase/brand/formula/Chechen/Cyrillic-brand tokens (`CASE_LEGIT` in `scripts/measure-false-positives.mjs`) → 1 with evidence (`маӏа`, foreign-letter kind; not flagged, §4.4). Attacks `paypaI раураӏ раураІ gmaiI` caught, `goIang appIe` not. Real-text scan (5.83 M tokens): 6 occurrences, 2 distinct, both false positives — a mojibake string (`Î²î²ðì²Ì`) and a random ID ending in `I` (`ge0ovx2fbI`).

### 4.7 Positional spelling rules

`ORTHOGRAPHY` in `src/languages.ts`, applied per language on words of ≥ 2 letters. The rules only narrow fold targets: a fold that breaks them makes that target invalid (`paᏏy` cannot be read as `раЬу`). A word written wholly in a requested language's letters is not converted for breaking a rule: `Ьр` and `σσ` alone stay; context can still fold such a word like any whole-script word (`see Ьр here` → `see bp here`). Only positional rules: nothing that tells `ь` from `ъ` (native writers mix them up).

| rule                                                                        | languages                                                                 | not applied to                                                         |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `ь` not word-initial                                                        | Russian, Ukrainian, Belarusian, Bulgarian, Kazakh, Caucasian              | —                                                                      |
| `ъ` not word-initial                                                        | Russian, Kazakh, Caucasian                                                | Bulgarian (`ъ` is a vowel: `ъгъл`, `Ървин`)                            |
| `ы` not word-initial                                                        | Russian, Belarusian, Caucasian                                            | Kazakh (`ыдыс`)                                                        |
| `ь` not after a vowel                                                       | all of the above                                                          | —                                                                      |
| `ъ` not after a vowel                                                       | Russian, Kazakh, Caucasian                                                | Bulgarian                                                              |
| capital `Ь`/`Ъ` after the first letter of a word that has lowercase letters | all Cyrillic languages above                                              | all-caps words                                                         |
| `ς` only word-final; lowercase `σ` not word-final                           | Greek                                                                     | elided forms (`μέσ'`)                                                  |
| Hebrew final forms `ך ם ן ף ץ` only word-final; `כ מ נ צ` not word-final    | Hebrew — defined and measured, **not wired**: Hebrew is outside the model | `פ` (loanwords `טיפ`, `לפטופ`); before geresh (`צ'`); acronyms (`ח"כ`) |

Not rules: `ъ` only before `е ё ю я` (fires on real misspellings; also breaks pre-1918 `Коммерсантъ`); Bulgarian `ь` only before `о` (distinguishes `ь` usage); `й` before consonant clusters (not solid).

**False-positive data** (`scripts/measure-false-positives.mjs`; dictionaries are hunspell stems, so inflected forms are not covered):

| set                                                                                         | words   | breaking a positional rule                                                                                     | of those, readable as another alphabet |
| ------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `ru_RU`                                                                                     | 146 269 | 0                                                                                                              | 0                                      |
| `uk_UA`                                                                                     | 331 660 | 0                                                                                                              | 0                                      |
| `be_BY`                                                                                     | 83 665  | 0                                                                                                              | 0                                      |
| `bg_BG`                                                                                     | 78 238  | 0 (the capital rule skips the first letter: `Ървин`)                                                           | 0                                      |
| `kk_KZ`                                                                                     | 54 063  | 0                                                                                                              | 0                                      |
| `sr_RS`                                                                                     | 251 549 | 0                                                                                                              | 0                                      |
| `mn_MN` (Mongolian, not modelled)                                                           | 574 462 | 0                                                                                                              | 0                                      |
| `el_GR`                                                                                     | 828 806 | 8: dictionary run-ons (`Ιησουίτεςό`, `τεχνικέςαυτές`) and `μέσ` (elided; as a token `μέσ'` it is exempt)       | 0                                      |
| `he_IL` (Hebrew rule)                                                                       | 469 750 | 110, all prefix-only dictionary entries (`וכמ`, `ובכ`); 0 real words. Without the `פ` exemption: +34 loanwords | — (not wired)                          |
| Markdown scan (4 109 files, 5.83 M tokens, this repo and the test corpus excluded)          | —       | 0                                                                                                              | 0                                      |
| corpus legit rows; `CASE_LEGIT` list (`Коммерсантъ КамАЗ ВкусВилл МосГорТранс ъгъл ыдыс` …) | —       | 0                                                                                                              | 0                                      |

The last column counts the rule-breaking words another alphabet is valid for.

### 4.8 Results for the listed words

Generated table: `analyze(text, { confusionModel: 'language' })`, every other option at its default. `Rule` is `resolution.rule` (§4.2); a converted or reported word without one holds letters of two requested languages and was decided by the piece rules (§17.10).

<!-- examples: ref-4.8 -->

| Input                       | Output                      | Spoofed | Signals                | Rule                |
| --------------------------- | --------------------------- | ------- | ---------------------- | ------------------- |
| `НОТ dog`                   | `HOT dog`                   | yes     | `confusable_word`      | `window`            |
| `НОТ deal today`            | `HOT deal today`            | yes     | `confusable_word`      | `window`            |
| `This is НОТ news`          | `This is HOT news`          | yes     | `confusable_word`      | `neighbours`        |
| `Мы были в НОТ`             | `Мы были в НОТ`             | no      | —                      | —                   |
| `НОТ`                       | `НОТ`                       | no      | —                      | —                   |
| `cоса`                      | `соса`                      | yes     | `mixed_spoof`          | —                   |
| `TЕХ`                       | `ТЕХ`                       | yes     | `mixed_spoof`          | —                   |
| `Αрр`                       | `Арр`                       | yes     | `mixed_spoof`          | —                   |
| `HОT`                       | `HOT`                       | yes     | `mixed_spoof`          | —                   |
| `НOТ`                       | `НОТ`                       | yes     | `mixed_spoof`          | —                   |
| `CОК`                       | `СОК`                       | yes     | `mixed_spoof`          | —                   |
| `COК`                       | `COК`                       | no      | `mixed_non_legitimate` | —                   |
| `drink cоса now`            | `drink соса now`            | yes     | `mixed_spoof`          | —                   |
| `open the Αрр`              | `open the Арр`              | yes     | `mixed_spoof`          | —                   |
| `Bank ассоunt verification` | `Bank ассоunt verification` | no      | `mixed_non_legitimate` | —                   |
| `Wе landed at Orly.`        | `Wе landed at Orly.`        | no      | `mixed_non_legitimate` | —                   |
| `аррӏе.com`                 | `apple.com`                 | yes     | `confusable_word`      | `window`            |
| `ΑΡΡLE`                     | `ΑΡΡLE`                     | no      | `mixed_non_legitimate` | —                   |
| `раураl`                    | `раураl`                    | no      | `mixed_non_legitimate` | —                   |
| `pay with раураl today`     | `pay with раураl today`     | no      | `mixed_non_legitimate` | —                   |
| `иser`                      | `иser`                      | no      | `mixed_non_legitimate` | —                   |
| `кey`                       | `кey`                       | no      | `mixed_non_legitimate` | —                   |
| `my кey here`               | `my кey here`               | no      | `mixed_non_legitimate` | —                   |
| `тap`                       | `тap`                       | no      | `mixed_non_legitimate` | —                   |
| `тail`                      | `тail`                      | no      | `mixed_non_legitimate` | —                   |
| `admiп`                     | `admiп`                     | no      | `mixed_non_legitimate` | —                   |
| `вank`                      | `вank`                      | no      | `mixed_non_legitimate` | —                   |
| `тime`                      | `тime`                      | no      | `mixed_non_legitimate` | —                   |
| `quіск`                     | `quіск`                     | no      | `mixed_non_legitimate` | —                   |
| `Пpивеt`                    | `Привеt`                    | yes     | `mixed_spoof`          | —                   |
| `paᏏy`                      | `paᏏy`                      | no      | `mixed_non_legitimate` | `no-valid-language` |
| `ьank`                      | `ьank`                      | no      | `mixed_non_legitimate` | —                   |
| `ъеst`                      | `ъеst`                      | no      | `mixed_non_legitimate` | —                   |
| `Пpивет`                    | `Привет`                    | yes     | `mixed_spoof`          | —                   |
| `Москвa`                    | `Москвa`                    | no      | `mixed_non_legitimate` | —                   |
| `paypaІ`                    | `paypaІ`                    | no      | `mixed_non_legitimate` | —                   |
| `шaг`                       | `шаг`                       | yes     | `mixed_spoof`          | —                   |
| `pаypal’ѕ`                  | `paypal’ѕ`                  | yes     | `mixed_spoof`          | —                   |
| `Kαλημέρα`                  | `Καλημέρα`                  | yes     | `mixed_spoof`          | —                   |
| `ᴀᴅᴍɪɴ`                     | `admin`                     | yes     | `confusable_word`      | `primary-target`    |
| `ɡoogle`                    | `google`                    | yes     | `confusable_word`      | `word-majority`     |
| `pɑypal`                    | `paypal`                    | yes     | `confusable_word`      | `word-majority`     |
| `İstanbul'da ışık`          | `İstanbul'da ışık`          | no      | —                      | —                   |
| `þorn`                      | `porn`                      | yes     | `confusable_word`      | `word-majority`     |
| `GitHub'а`                  | `GitHub'а`                  | no      | —                      | —                   |
| `iPhone’ов`                 | `iPhone’ов`                 | no      | —                      | —                   |
| `форк на GіtHub'а`          | `форк на GitHub'а`          | yes     | `mixed_spoof`          | —                   |
| `I bought сок today`        | `I bought сок today`        | no      | —                      | —                   |
| `I bought сор today`        | `I bought cop today`        | yes     | `confusable_word`      | `neighbours`        |
| `the рос here`              | `the poc here`              | yes     | `confusable_word`      | `neighbours`        |
| `it is сухо here`           | `it is cyxo here`           | yes     | `confusable_word`      | `neighbours`        |
| `eat уха soup`              | `eat yxa soup`              | yes     | `confusable_word`      | `neighbours`        |
| `an оса flew`               | `an oca flew`               | yes     | `confusable_word`      | `neighbours`        |
| `add сахар now`             | `add caxap now`             | yes     | `confusable_word`      | `neighbours`        |
| `раураӏ`                    | `paypal`                    | yes     | `confusable_word`      | `primary-target`    |
| `Зайди на раураӏ сегодня`   | `Зайди на paypal сегодня`   | yes     | `confusable_word`      | `primary-target`    |
| `раураІ`                    | `paypal`                    | yes     | `confusable_word`      | `primary-target`    |
| `paypaI`                    | `paypal`                    | yes     | `confusable_word`      | `case-anomaly`      |
| `gmaiI`                     | `gmail`                     | yes     | `confusable_word`      | `case-anomaly`      |
| `Ьр`                        | `Ьр`                        | no      | —                      | —                   |
| `маӏа`                      | `маӏа`                      | no      | —                      | —                   |
| `Коммерсантъ`               | `Коммерсантъ`               | no      | —                      | —                   |
| `Το iPhone είναι ακριβό`    | `Το iPhone είναι ακριβό`    | no      | —                      | —                   |
| `g00gle`                    | `g00gle`                    | no      | —                      | —                   |
| `app1e`                     | `app1e`                     | no      | —                      | —                   |
| `НОВ0СТИ`                   | `НОВ0СТИ`                   | no      | —                      | —                   |
| `СОСА-СОЛА`                 | `СОСА-СОЛА`                 | no      | —                      | —                   |
| `СОСА-COLA`                 | `COCA-COLA`                 | yes     | `confusable_word`      | `window`            |
| `χbox`                      | `xbox`                      | yes     | `mixed_spoof`          | —                   |
| `ҳbox`                      | `xbox`                      | yes     | `mixed_spoof`          | `word-majority`     |
| `Ҳbox`                      | `Xbox`                      | yes     | `mixed_spoof`          | `word-majority`     |
| `paχos`                     | `paxos`                     | yes     | `mixed_spoof`          | —                   |
| `ŋame`                      | `ŋame`                      | no      | —                      | —                   |
| `ɳo`                        | `ɳo`                        | no      | —                      | —                   |
| `ηame`                      | `ηame`                      | no      | `mixed_non_legitimate` | —                   |
| `ҳа`                        | `xa`                        | yes     | `confusable_word`      | `primary-target`    |

<!-- /examples -->

Notes:

- `иser`, `тail`, `тime`, `ηame`, `ŋame`, `ɳo` convert with their conditional twin enabled (§3.3: `user`, `mail`, `mime`, `name`, `name`, `no`).
- `χbox`, `paχos`: `χ~x` is on by default; with `conditionalTwins: []` both are reported and left.
- `þorn`, `ҳа`: `þ` and `ҳ` are letters of `European` and `Tajik`, which are not requested by default, so they are donors here (§3.4); with those languages requested the words stay.
- `g00gle`, `app1e`, `НОВ0СТИ`: an ASCII digit is never read as a letter (§8.4).
- `Ьр`: both letters are Russian letters; the word-initial `Ь` breaks a positional rule (§4.7), but a word written wholly in a requested language's letters is not converted for breaking a rule.
- `GitHub'а`, `iPhone’ов`: a Russian case ending after an apostrophe (§4.1).

## 5. Derived tables (UTS #39 17.0.0 + overrides)

Generated by `node scripts/derive-confusion-table.mjs`. `—` = no twin in that alphabet (a proof letter against it). `*` = curated addition. `‡` = descender twin of the default set (§3.3). `†` = cross-case pair (recorded; only `І→l Ӏ→l Ι→l Ь→b` count). For Cyrillic only letters actually used in alphabets are listed (Russian, Ukrainian, Belarusian, Serbian/Macedonian, plus the homoglyph favourites); `--json` dumps the full table.

### 5.1 Latin (52 letters shown)

| letter   | Cyrillic | Greek | also                                                      |
| -------- | -------- | ----- | --------------------------------------------------------- |
| A U+0041 | А        | Α     | Cherokee: Ꭺ                                               |
| B U+0042 | В        | Β     | Cherokee: Ᏼ; Coptic: Ⲃ                                    |
| C U+0043 | С        | —     | Cherokee: Ꮯ; Coptic: Ⲥ                                    |
| D U+0044 | —        | —     | Cherokee: Ꭰ                                               |
| E U+0045 | Е        | Ε     | Cherokee: Ꭼ                                               |
| F U+0046 | —        | —     |                                                           |
| G U+0047 | Ԍ        | —     | Cherokee: Ꮐ Ᏻ                                             |
| H U+0048 | Н        | Η     | Cherokee: Ꮋ; Coptic: Ⲏ                                    |
| I U+0049 | І Ӏ ӏ†   | Ι     | Coptic: Ⲓ; LatinExtra: Ɩ ǀ†                               |
| J U+004A | Ј        | Ϳ     | Cherokee: Ꭻ                                               |
| K U+004B | К        | Κ     | Cherokee: Ꮶ; Coptic: Ⲕ                                    |
| L U+004C | —        | —     | Cherokee: Ꮮ; Coptic: Ⳑ                                    |
| M U+004D | М        | Μ     | Cherokee: Ꮇ; Coptic: Ⲙ                                    |
| N U+004E | —        | Ν     | Coptic: Ⲛ                                                 |
| O U+004F | О        | Ο     | Armenian: Օ; Coptic: Ⲟ                                    |
| P U+0050 | Р        | Ρ     | Cherokee: Ꮲ; Coptic: Ⲣ Ⳏ                                  |
| Q U+0051 | —        | —     |                                                           |
| R U+0052 | —        | —     | Cherokee: Ꭱ Ꮢ; LatinExtra: Ʀ                              |
| S U+0053 | Ѕ        | —     | Armenian: Տ; Cherokee: Ꮥ Ꮪ                                |
| T U+0054 | Т        | Τ     | Cherokee: Ꭲ; Coptic: Ⲧ                                    |
| U U+0055 | —        | —     | Armenian: Ս                                               |
| V U+0056 | —        | —     | Cherokee: Ꮩ                                               |
| W U+0057 | Ԝ        | —     | Cherokee: Ꮃ Ꮤ                                             |
| X U+0058 | Х Ҳ‡     | Χ     | Coptic: Ⲭ                                                 |
| Y U+0059 | У Ү      | Υ     | Cherokee: Ꭹ Ꮍ; Coptic: Ⲩ                                  |
| Z U+005A | —        | Ζ     | Cherokee: Ꮓ                                               |
| a U+0061 | а        | α     | LatinExtra: ɑ ᴀ*                                          |
| b U+0062 | Ь†       | —     | Cherokee: Ꮟ†; LatinExtra: Ƅ† ʙ*                           |
| c U+0063 | с        | —     | Cherokee: ꮯ; Coptic: ⲥ; LatinExtra: ᴄ                     |
| d U+0064 | ԁ        | —     | Cherokee: Ꮷ†; LatinExtra: ᴅ*                              |
| e U+0065 | е        | —     | LatinExtra: ᴇ*                                            |
| f U+0066 | —        | —     | Armenian: ք; LatinExtra: ſ ƒ ꜰ*                           |
| g U+0067 | —        | —     | Armenian: ց; LatinExtra: ƍ ɡ ɢ*                           |
| h U+0068 | һ        | —     | Armenian: հ; Cherokee: Ꮒ†; LatinExtra: ʜ*                 |
| i U+0069 | і        | ι     | Armenian: ւ; Cherokee: Ꭵ† ꭵ; Coptic: ⲓ; LatinExtra: ı ɩ ɪ |
| j U+006A | ј        | ϳ     | LatinExtra: ᴊ*                                            |
| k U+006B | —        | —     | LatinExtra: ᴋ*                                            |
| l U+006C | І† Ӏ† ӏ  | Ι†    | Coptic: Ⲓ†; LatinExtra: Ɩ† ǀ ʟ*                           |
| m U+006D | —        | —     | LatinExtra: ᴍ*                                            |
| n U+006E | —        | —     | Armenian: ո ռ; LatinExtra: ɴ*                             |
| o U+006F | о        | ο σ   | Armenian: օ; Coptic: ⲟ ϭ; LatinExtra: ᴏ ᴑ                 |
| p U+0070 | р        | ρ     | Coptic: ⲣ ⳏ; LatinExtra: þ ƿ ᴘ*                           |
| q U+0071 | ԛ        | —     | Armenian: գ զ                                             |
| r U+0072 | г        | —     | Cherokee: ꮁ; Coptic: ⲅ; LatinExtra: ʀ*                    |
| s U+0073 | ѕ        | —     | Cherokee: ꮪ; LatinExtra: ƽ ꜱ                              |
| t U+0074 | —        | —     | LatinExtra: ᴛ*                                            |
| u U+0075 | —        | υ     | Armenian: ս; LatinExtra: ʋ ᴜ                              |
| v U+0076 | —        | ν     | Cherokee: ꮩ; LatinExtra: ᴠ                                |
| w U+0077 | ш ԝ      | ω*    | Armenian: ա; Cherokee: ꮃ; Coptic: ⲽ; LatinExtra: ɯ ᴡ      |
| x U+0078 | х ҳ‡     | χ‡    |                                                           |
| y U+0079 | у ү      | γ     | Coptic: ⲩ; LatinExtra: ɣ ʏ                                |
| z U+007A | —        | —     | Cherokee: ꮓ; LatinExtra: ᴢ                                |

### 5.2 Cyrillic (87 letters shown)

| letter   | Latin | Greek | also                                                      |
| -------- | ----- | ----- | --------------------------------------------------------- |
| А U+0410 | A     | Α     | Cherokee: Ꭺ                                               |
| Б U+0411 | —     | —     | LatinExtra: Ƃ ƃ†                                          |
| В U+0412 | B     | Β     | Cherokee: Ᏼ; Coptic: Ⲃ                                    |
| Г U+0413 | —     | Γ     | Cherokee: Ꮁ; Coptic: Ⲅ                                    |
| Д U+0414 | —     | —     |                                                           |
| Е U+0415 | E     | Ε     | Cherokee: Ꭼ                                               |
| Ж U+0416 | —     | —     |                                                           |
| З U+0417 | —     | —     | Coptic: Ⲝ Ⳅ Ⳍ; LatinExtra: Ʒ Ȝ                            |
| И U+0418 | —     | —     |                                                           |
| К U+041A | K     | Κ     | Cherokee: Ꮶ; Coptic: Ⲕ                                    |
| Л U+041B | —     | Λ     | LatinExtra: Ʌ                                             |
| М U+041C | M     | Μ     | Cherokee: Ꮇ; Coptic: Ⲙ                                    |
| Н U+041D | H     | Η     | Cherokee: Ꮋ; Coptic: Ⲏ                                    |
| О U+041E | O     | Ο     | Armenian: Օ; Coptic: Ⲟ                                    |
| П U+041F | —     | Π     | Coptic: Ⲡ                                                 |
| Р U+0420 | P     | Ρ     | Cherokee: Ꮲ; Coptic: Ⲣ Ⳏ                                  |
| С U+0421 | C     | —     | Cherokee: Ꮯ; Coptic: Ⲥ                                    |
| Т U+0422 | T     | Τ     | Cherokee: Ꭲ; Coptic: Ⲧ                                    |
| У U+0423 | Y     | Υ     | Cherokee: Ꭹ Ꮍ; Coptic: Ⲩ                                  |
| Ф U+0424 | —     | Φ     | Armenian: Փ; Coptic: Ⲫ                                    |
| Х U+0425 | X     | Χ     | Coptic: Ⲭ                                                 |
| Ц U+0426 | —     | —     |                                                           |
| Ч U+0427 | —     | —     | Coptic: Ϥ                                                 |
| Ш U+0428 | —     | —     | Coptic: Ⲽ                                                 |
| Щ U+0429 | —     | —     |                                                           |
| Ъ U+042A | —     | —     |                                                           |
| Ы U+042B | —     | —     |                                                           |
| Ь U+042C | b†    | —     | Cherokee: Ꮟ; LatinExtra: Ƅ                                |
| Э U+042D | —     | —     |                                                           |
| Ю U+042E | —     | —     |                                                           |
| Я U+042F | —     | —     |                                                           |
| а U+0430 | a     | α     | LatinExtra: ɑ                                             |
| б U+0431 | —     | —     | Cherokee: Ꮾ†; Coptic: Ⳓ† ⳓ Ⳝ† Ϭ†                          |
| в U+0432 | —     | —     | Cherokee: ᏼ; Coptic: ⲃ; LatinExtra: ʙ                     |
| г U+0433 | r     | —     | Cherokee: ꮁ; Coptic: ⲅ                                    |
| д U+0434 | —     | —     |                                                           |
| е U+0435 | e     | —     |                                                           |
| ж U+0436 | —     | —     |                                                           |
| з U+0437 | —     | —     | LatinExtra: ᴈ ɜ                                           |
| и U+0438 | —     | —     | LatinExtra: ᴎ                                             |
| к U+043A | —     | κ     | Cherokee: ꮶ; Coptic: ⲕ; LatinExtra: ᴋ ĸ                   |
| л U+043B | —     | —     |                                                           |
| м U+043C | —     | —     | Cherokee: ꮇ; Coptic: ⲙ; LatinExtra: ᴍ ʍ                   |
| н U+043D | —     | —     | Cherokee: ꮋ; Coptic: ⲏ; LatinExtra: ʜ                     |
| о U+043E | o     | ο σ   | Armenian: օ; Coptic: ⲟ ϭ; LatinExtra: ᴏ ᴑ                 |
| п U+043F | —     | π     | Coptic: ⲡ                                                 |
| р U+0440 | p     | ρ     | Coptic: ⲣ ⳏ; LatinExtra: þ ƿ                              |
| с U+0441 | c     | —     | Cherokee: ꮯ; Coptic: ⲥ; LatinExtra: ᴄ                     |
| т U+0442 | —     | τ     | Cherokee: ꭲ; Coptic: ⲧ; LatinExtra: ᴛ                     |
| у U+0443 | y     | γ     | Coptic: ⲩ; LatinExtra: ɣ ʏ                                |
| ф U+0444 | —     | φ     | Coptic: ⲫ Ⳡ† ⳡ; LatinExtra: ɸ                             |
| х U+0445 | x     | χ‡    |                                                           |
| ц U+0446 | —     | —     |                                                           |
| ч U+0447 | —     | —     | Coptic: ϥ                                                 |
| ш U+0448 | w     | —     | Armenian: ա; Cherokee: ꮃ; Coptic: ⲽ; LatinExtra: ᴡ ɯ      |
| щ U+0449 | —     | —     |                                                           |
| ъ U+044A | —     | —     |                                                           |
| ы U+044B | —     | —     |                                                           |
| ь U+044C | —     | —     | Cherokee: ꮟ; LatinExtra: ƅ                                |
| э U+044D | —     | —     |                                                           |
| ю U+044E | —     | —     |                                                           |
| я U+044F | —     | —     | LatinExtra: ᴙ                                             |
| і U+0456 | i     | ι     | Armenian: ւ; Cherokee: Ꭵ† ꭵ; Coptic: ⲓ; LatinExtra: ı ɩ ɪ |
| ї U+0457 | —     | —     |                                                           |
| І U+0406 | I l†  | Ι     | Coptic: Ⲓ; LatinExtra: Ɩ ǀ†                               |
| Ї U+0407 | —     | —     |                                                           |
| ј U+0458 | j     | ϳ     |                                                           |
| Ј U+0408 | J     | Ϳ     | Cherokee: Ꭻ                                               |
| ѕ U+0455 | s     | —     | Cherokee: ꮪ; LatinExtra: ꜱ ƽ                              |
| Ѕ U+0405 | S     | —     | Armenian: Տ; Cherokee: Ꮥ Ꮪ                                |
| є U+0454 | —     | ε     | Cherokee: ꮛ; Coptic: ⲉ; LatinExtra: ɛ                     |
| Є U+0404 | —     | —     | Coptic: Ⲉ                                                 |
| ґ U+0491 | —     | —     |                                                           |
| Ґ U+0490 | —     | —     |                                                           |
| ӏ U+04CF | I† l  | Ι†    | Coptic: Ⲓ†; LatinExtra: Ɩ† ǀ                              |
| Ӏ U+04C0 | I l†  | Ι     | Coptic: Ⲓ; LatinExtra: Ɩ ǀ†                               |
| ԁ U+0501 | d     | —     | Cherokee: Ꮷ†                                              |
| ԛ U+051B | q     | —     | Armenian: գ զ                                             |
| ԝ U+051D | w     | —     | Armenian: ա; Cherokee: ꮃ; Coptic: ⲽ; LatinExtra: ᴡ ɯ      |
| Ԛ U+051A | —     | —     |                                                           |
| Ԝ U+051C | W     | —     | Cherokee: Ꮃ Ꮤ                                             |
| һ U+04BB | h     | —     | Armenian: հ; Cherokee: Ꮒ†                                 |
| Һ U+04BA | —     | —     |                                                           |
| ү U+04AF | y     | γ     | Coptic: ⲩ; LatinExtra: ɣ ʏ                                |
| Ү U+04AE | Y     | Υ     | Cherokee: Ꭹ Ꮍ; Coptic: Ⲩ                                  |
| ҳ U+04B3 | x‡    | χ‡    |                                                           |
| Ҳ U+04B2 | X‡    | —     |                                                           |

### 5.3 Greek (51 letters shown)

| letter   | Latin | Cyrillic | also                                                      |
| -------- | ----- | -------- | --------------------------------------------------------- |
| Α U+0391 | A     | А        | Cherokee: Ꭺ                                               |
| Β U+0392 | B     | В        | Cherokee: Ᏼ; Coptic: Ⲃ                                    |
| Γ U+0393 | —     | Г        | Cherokee: Ꮁ; Coptic: Ⲅ                                    |
| Δ U+0394 | —     | —        | Coptic: Ⲇ                                                 |
| Ε U+0395 | E     | Е        | Cherokee: Ꭼ                                               |
| Ζ U+0396 | Z     | —        | Cherokee: Ꮓ                                               |
| Η U+0397 | H     | Н        | Cherokee: Ꮋ; Coptic: Ⲏ                                    |
| Θ U+0398 | —     | Ө        | Cherokee: Ꮎ Ꮻ; Coptic: Ⲑ; LatinExtra: Ɵ                   |
| Ι U+0399 | I l†  | І Ӏ ӏ†   | Coptic: Ⲓ; LatinExtra: Ɩ ǀ†                               |
| Κ U+039A | K     | К        | Cherokee: Ꮶ; Coptic: Ⲕ                                    |
| Λ U+039B | —     | Л        | LatinExtra: Ʌ                                             |
| Μ U+039C | M     | М        | Cherokee: Ꮇ; Coptic: Ⲙ                                    |
| Ν U+039D | N     | —        | Coptic: Ⲛ                                                 |
| Ξ U+039E | —     | —        | Coptic: Ⲷ                                                 |
| Ο U+039F | O     | О        | Armenian: Օ; Coptic: Ⲟ                                    |
| Π U+03A0 | —     | П        | Coptic: Ⲡ                                                 |
| Ρ U+03A1 | P     | Р        | Cherokee: Ꮲ; Coptic: Ⲣ Ⳏ                                  |
| Σ U+03A3 | —     | —        | LatinExtra: Ʃ                                             |
| Τ U+03A4 | T     | Т        | Cherokee: Ꭲ; Coptic: Ⲧ                                    |
| Υ U+03A5 | Y     | У Ү      | Cherokee: Ꭹ Ꮍ; Coptic: Ⲩ                                  |
| Φ U+03A6 | —     | Ф        | Armenian: Փ; Coptic: Ⲫ                                    |
| Χ U+03A7 | X     | Х        | Coptic: Ⲭ                                                 |
| Ψ U+03A8 | —     | —        | Coptic: Ⲯ                                                 |
| Ω U+03A9 | —     | —        |                                                           |
| α U+03B1 | a     | а        | LatinExtra: ɑ                                             |
| β U+03B2 | —     | —        | Cherokee: Ᏸ†; LatinExtra: ß                               |
| γ U+03B3 | y     | у ү      | Coptic: ⲩ; LatinExtra: ɣ ʏ                                |
| δ U+03B4 | —     | —        | Armenian: ծ; Coptic: ⳝ                                    |
| ε U+03B5 | —     | є        | Cherokee: ꮛ; Coptic: ⲉ; LatinExtra: ɛ                     |
| ζ U+03B6 | —     | —        |                                                           |
| η U+03B7 | —     | —        | Armenian: ղ; LatinExtra: ŋ ƞ                              |
| θ U+03B8 | —     | Ө†       | Cherokee: Ꮎ† Ꮻ†; Coptic: Ⲑ†; LatinExtra: Ɵ†               |
| ι U+03B9 | i     | і        | Armenian: ւ; Cherokee: Ꭵ† ꭵ; Coptic: ⲓ; LatinExtra: ı ɩ ɪ |
| κ U+03BA | —     | к        | Cherokee: ꮶ; Coptic: ⲕ; LatinExtra: ᴋ ĸ                   |
| λ U+03BB | —     | —        | Coptic: Ⲗ†                                                |
| μ U+03BC | —     | —        |                                                           |
| ν U+03BD | v     | —        | Cherokee: ꮩ; LatinExtra: ᴠ                                |
| ξ U+03BE | —     | —        |                                                           |
| ο U+03BF | o     | о        | Armenian: օ; Coptic: ⲟ ϭ; LatinExtra: ᴏ ᴑ                 |
| π U+03C0 | —     | п        | Coptic: ⲡ                                                 |
| ρ U+03C1 | p     | р        | Coptic: ⲣ ⳏ; LatinExtra: þ ƿ                              |
| ς U+03C2 | —     | —        | Coptic: ⲋ                                                 |
| σ U+03C3 | o     | о        | Armenian: օ; Coptic: ⲟ ϭ; LatinExtra: ᴏ ᴑ                 |
| τ U+03C4 | —     | т        | Cherokee: ꭲ; Coptic: ⲧ; LatinExtra: ᴛ                     |
| υ U+03C5 | u     | —        | Armenian: ս; LatinExtra: ᴜ ʋ                              |
| φ U+03C6 | —     | ф        | Coptic: ⲫ Ⳡ† ⳡ; LatinExtra: ɸ                             |
| χ U+03C7 | x‡    | х‡ ҳ‡    | Coptic: ⲭ                                                 |
| ψ U+03C8 | —     | —        | Coptic: ⲯ                                                 |
| ω U+03C9 | w*    | —        | Coptic: ⲱ                                                 |
| ϳ U+03F3 | j     | ј        |                                                           |
| Ϳ U+037F | J     | Ј        | Cherokee: Ꭻ                                               |

### 5.4 Case asymmetry (letter has a Latin twin but its case partner has none)

- Cyrillic: В→B (в: —), К→K (к: —), М→M (м: —), Н→H (н: —), Т→T (т: —), Ь→b† (ь: —), г→r (Г: —), ш→w (Ш: —), һ→h (Һ: —), ԁ→d (Ԁ: —), Ԍ→G (ԍ: —), ԛ→q (Ԛ: —)
- Greek: Β→B (β: —), Ε→E (ε: —), Ζ→Z (ζ: —), Η→H (η: —), Κ→K (κ: —), Μ→M (μ: —), Τ→T (τ: —), γ→y (Γ: —), σ→o (Σ: —), ω→w* (Ω: —)

### 5.5 Cross-alphabet skeleton clusters with ≥3 alphabets (noise check)

- "A": A(Lat) А(Cyr) Α(Gre) Ꭺ(Che)
- "B": B(Lat) В(Cyr) Β(Gre) Ᏼ(Che) Ⲃ(Cop)
- "C": C(Lat) С(Cyr) Ꮯ(Che) Ⲥ(Cop)
- "E": E(Lat) Е(Cyr) Ε(Gre) Ꭼ(Che)
- "G": G(Lat) Ԍ(Cyr) Ꮐ(Che) Ᏻ(Che)
- "H": H(Lat) Н(Cyr) Η(Gre) Ꮋ(Che) Ⲏ(Cop)
- "l": I(Lat) l(Lat) І(Cyr) Ӏ(Cyr) ӏ(Cyr) Ι(Gre) Ⲓ(Cop) Ɩ(Lat) ǀ(Lat)
- "J": J(Lat) Ј(Cyr) Ϳ(Gre) Ꭻ(Che)
- "K": K(Lat) К(Cyr) Κ(Gre) Ꮶ(Che) Ⲕ(Cop)
- "L": L(Lat) Ꮮ(Che) Ⳑ(Cop)
- "M": M(Lat) М(Cyr) Μ(Gre) Ꮇ(Che) Ⲙ(Cop)
- "N": N(Lat) Ν(Gre) Ⲛ(Cop)
- "O": O(Lat) О(Cyr) Ο(Gre) Օ(Arm) Ⲟ(Cop)
- "P": P(Lat) Р(Cyr) Ρ(Gre) Ꮲ(Che) Ⲣ(Cop) Ⳏ(Cop)
- "R": R(Lat) Ꭱ(Che) Ꮢ(Che) Ʀ(Lat)
- "S": S(Lat) Ѕ(Cyr) Տ(Arm) Ꮥ(Che) Ꮪ(Che)
- "T": T(Lat) Т(Cyr) Τ(Gre) Ꭲ(Che) Ⲧ(Cop)
- "W": W(Lat) Ԝ(Cyr) Ꮃ(Che) Ꮤ(Che)
- "X": X(Lat) Х(Cyr) Χ(Gre) Ⲭ(Cop)
- "Y": Y(Lat) У(Cyr) Ү(Cyr) Υ(Gre) Ꭹ(Che) Ꮍ(Che) Ⲩ(Cop)
- "Z": Z(Lat) Ζ(Gre) Ꮓ(Che)
- "a": a(Lat) а(Cyr) α(Gre) ɑ(Lat)
- "b": b(Lat) Ь(Cyr) Ꮟ(Che) Ƅ(Lat)
- "c": c(Lat) с(Cyr) ꮯ(Che) ⲥ(Cop) ᴄ(Lat)
- "d": d(Lat) ԁ(Cyr) Ꮷ(Che)
- "f": f(Lat) ք(Arm) ſ(Lat) ƒ(Lat)
- "g": g(Lat) ց(Arm) ƍ(Lat) ɡ(Lat)
- "h": h(Lat) һ(Cyr) հ(Arm) Ꮒ(Che)
- "i": i(Lat) і(Cyr) ι(Gre) ւ(Arm) Ꭵ(Che) ꭵ(Che) ⲓ(Cop) ı(Lat) ɩ(Lat) ɪ(Lat)
- "j": j(Lat) ј(Cyr) ϳ(Gre)
- "o": o(Lat) о(Cyr) ο(Gre) σ(Gre) օ(Arm) ⲟ(Cop) ϭ(Cop) ᴏ(Lat) ᴑ(Lat)
- "p": p(Lat) р(Cyr) ρ(Gre) ⲣ(Cop) ⳏ(Cop) þ(Lat) ƿ(Lat)
- "q": q(Lat) ԛ(Cyr) գ(Arm) զ(Arm)
- "r": r(Lat) г(Cyr) ꮁ(Che) ⲅ(Cop)
- "s": s(Lat) ѕ(Cyr) ꮪ(Che) ƽ(Lat) ꜱ(Lat)
- "u": u(Lat) υ(Gre) ս(Arm) ʋ(Lat) ᴜ(Lat)
- "v": v(Lat) ν(Gre) ꮩ(Che) ᴠ(Lat)
- "w": w(Lat) ш(Cyr) ԝ(Cyr) ա(Arm) ꮃ(Che) ⲽ(Cop) ɯ(Lat) ᴡ(Lat)
- "y": y(Lat) у(Cyr) ү(Cyr) γ(Gre) ⲩ(Cop) ɣ(Lat) ʏ(Lat)
- "z": z(Lat) ꮓ(Che) ᴢ(Lat)
- "Γ": Г(Cyr) Γ(Gre) Ꮁ(Che) Ⲅ(Cop)
- "3": З(Cyr) Ⲝ(Cop) Ⳅ(Cop) Ⳍ(Cop) Ʒ(Lat) Ȝ(Lat)
- "Ʌ": Л(Cyr) Λ(Gre) Ʌ(Lat)
- "Π": П(Cyr) Π(Gre) Ⲡ(Cop)
- "Φ": Ф(Cyr) Φ(Gre) Փ(Arm) Ⲫ(Cop)
- "6": б(Cyr) Ꮾ(Che) Ⳓ(Cop) ⳓ(Cop) Ⳝ(Cop) Ϭ(Cop)
- "ʙ": в(Cyr) ᏼ(Che) ⲃ(Cop) ʙ(Lat)
- "ĸ": к(Cyr) κ(Gre) ꮶ(Che) ⲕ(Cop) ĸ(Lat) ᴋ(Lat)
- "ʍ": м(Cyr) ꮇ(Che) ⲙ(Cop) ʍ(Lat) ᴍ(Lat)
- "ʜ": н(Cyr) ꮋ(Che) ⲏ(Cop) ʜ(Lat)
- "π": п(Cyr) π(Gre) ⲡ(Cop)
- "ᴛ": т(Cyr) τ(Gre) ꭲ(Che) ⲧ(Cop) ᴛ(Lat)
- "ɸ": ф(Cyr) φ(Gre) ⲫ(Cop) Ⳡ(Cop) ⳡ(Cop) ɸ(Lat)
- "ƅ": ь(Cyr) ꮟ(Che) ƅ(Lat)
- "ꞓ": є(Cyr) ε(Gre) ꮛ(Che) ⲉ(Cop) ɛ(Lat)
- "O̵": Ө(Cyr) Θ(Gre) θ(Gre) Ꮎ(Che) Ꮻ(Che) Ⲑ(Cop) Ɵ(Lat)
- "o̵": ө(Cyr) ꮎ(Che) ꮻ(Che) ⲑ(Cop) ɵ(Lat)
- "ɢ": ԍ(Cyr) ᏻ(Che) ꮐ(Che) ɢ(Lat)
- "ß": β(Gre) Ᏸ(Che) ß(Lat)
- "ẟ": δ(Gre) ծ(Arm) ⳝ(Cop)
- "n̩": η(Gre) ղ(Arm) ŋ(Lat) ƞ(Lat)
- "ʟ": ꮮ(Che) ⳑ(Cop) ʟ(Lat)

## 6. Hidden-character cleanup and counters

### 6.1 Rules

| class                     | code points                                                                             | keep when                                                                                                                                                                                                                           | otherwise                                                                                        | counted?                                                                                                                                                                                                                                                                                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| soft hyphen               | U+00AD                                                                                  | never                                                                                                                                                                                                                               | remove                                                                                           | silent                                                                                                                                                                                                                                                                                                                                          |
| zero-width                | ZWSP U+200B, WJ U+2060, BOM U+FEFF                                                      | never                                                                                                                                                                                                                               | remove                                                                                           | counted if the run has at least `zeroWidthRunThreshold` code points (default 2; steganography) or touches a word on either side (`ad\u200Bmin`, `at\u200D Orly`, `is_\u200Badmin`, a broken emoji ZWJ sequence); silent if isolated in whitespace, a BOM at text start, or a word-break hint between Thai/Lao/Khmer/Myanmar/Tibetan/CJK letters |
| joiners                   | ZWNJ U+200C, ZWJ U+200D                                                                 | a single joiner between letters/marks of a joining script (Arabic, Syriac, N'Ko, Mongolian, Indic, Sinhala, Khmer, Myanmar, Tibetan, Kaithi); a ZWJ after a virama at word end (Malayalam chillu); inside an RGI emoji ZWJ sequence | remove                                                                                           | as zero-width                                                                                                                                                                                                                                                                                                                                   |
| bidi embeddings/overrides | U+202A–202E                                                                             | never                                                                                                                                                                                                                               | remove                                                                                           | counted                                                                                                                                                                                                                                                                                                                                         |
| bidi marks/isolates       | LRM, RLM, ALM U+061C, U+2066–2069                                                       | their bidi paragraph has an RTL letter before them or within `constructLimit` (4,096) code points after (strict and lenient; each mark its own lookahead)                                                                           | remove                                                                                           | counted                                                                                                                                                                                                                                                                                                                                         |
| variation selectors       | U+FE00–FE0F, U+E0100–E01EF, Mongolian U+180B–180F                                       | exactly one selector on a base that takes it: VS15/VS16 on `\p{Emoji}`; VS17–256 or VS1–3 on Han/kana; VS1–3 on math symbols (`≨\uFE00`); FVS on Mongolian                                                                          | remove every selector after the first valid one, and orphans                                     | counted                                                                                                                                                                                                                                                                                                                                         |
| tag characters            | U+E0000–E007F                                                                           | inside `\p{RGI_Emoji_Tag_Sequence}` (subdivision flags)                                                                                                                                                                             | remove                                                                                           | counted                                                                                                                                                                                                                                                                                                                                         |
| other invisibles          | U+180E, U+2061–2065, CGJ U+034F, U+206A–206F, U+FFF0–FFFB, U+E0080–E00FF, U+E01F0–E0FFF | never                                                                                                                                                                                                                               | remove                                                                                           | counted                                                                                                                                                                                                                                                                                                                                         |
| blank glyphs              | Hangul fillers U+115F/1160/3164/FFA0, Braille blank U+2800, U+1D159                     | never                                                                                                                                                                                                                               | U+0020 between two visible characters (`click\u2800here` → `click here`), removed at a word edge | counted                                                                                                                                                                                                                                                                                                                                         |
| visible format characters | Arabic number signs U+0600–0605, U+06DD, U+070F                                         | always                                                                                                                                                                                                                              | —                                                                                                | not touched (they render; the lenient rules treat all `\p{Cf}` as invisible)                                                                                                                                                                                                                                                                    |
| special spaces            | NBSP, U+2000–200A, U+202F, U+3000, …                                                    | always                                                                                                                                                                                                                              | —                                                                                                | not touched                                                                                                                                                                                                                                                                                                                                     |

**Rule:** a zero-width run that touches a word on **either** side is counted — one side suffices (`at\u200D Orly`, `word\u200B next`, `ad\u200Bmin`). Only a run with whitespace or a text edge on both sides, a BOM at text start, or a Thai/Lao/Khmer/Myanmar/Tibetan/CJK word-break hint is silent.

How the strict rules differ from the lenient ones (§1):

- No inert zero-width runs (`inertZeroWidthMask`, `src/token.ts`): isolated runs are removed into the silent bucket; a run is counted from the threshold (`zeroWidthRunThreshold`).
- `FORMAT_CHAR_SCRIPTS` splits in two: joining scripts exempt **only** ZWNJ/ZWJ between their letters; stacking scripts (incl. Hebrew, Thai, Lao) exempt only `zalgo`. Bidi controls, tags, selectors and ZW runs inside Arabic/Hebrew/Indic words are judged like anywhere else.
- Variation selectors include U+E0100–E01EF and U+180F; supplement selectors do not count as combining marks for `zalgo`.
- Emoji sequences are exempt by matching real RGI sequences (`\p{RGI_Emoji}`, `v` flag, Node ≥ 20): only the code points inside a match are protected.
- The visible Arabic number signs are not invisible characters.

Control characters (`controlChars`, class `controlChar`, default `remove-counted`): C0 controls except tab, LF and CR, DEL, C1 controls, and U+FFFE; a CSI escape sequence goes whole. VT and FF are written as a line feed with `confusionModel: 'language'` and removed with `hiddenChars: 'strict'` alone. They go before the rest, so one can't split a run past the run rules.

### 6.2 Counting unit and result additions

The counting unit is the **word**: a whitespace-delimited chunk with at least one counted removal counts once, however long its payload (a word carrying 200 tag characters = 1). A run standing alone between words is its own chunk and counts once. Silent removals never count. In strict `analyze` such a chunk is a `words` entry with signal `invisible` (`zalgo` when only mark stacks were trimmed). Per-class removal counts and the decoded payloads are the consumer's, from the report calls (§17.1; `test/helpers/compat.ts` rebuilds a `hidden` field and a `counts.hiddenWords` counter from them).

The two confusion-model counters (verified on `iPhone用 timея pаypal НОТ dog` with `{ confusionModel: 'language' }`: `confusableWords` 1, `mixedWords` 3):

| counter           | what                                                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `confusableWords` | words the ladder decided as a whole with class `confusable`: folded, or kept (evidence words under `wholeScriptFold: 'off'`) |
| `mixedWords`      | words reported with a mixed category: `mixed_spoof`, `mixed_legitimate`, `mixed_non_legitimate`                              |

A word of one requested language's letters plus donors that the ladder folds counts in both (`pаypаl` with `targetLanguages: ['English']`).

The library decodes no hidden content: a mark's `extracted` is the hidden characters as the input has them; reading tag characters, variation selectors or zero-width runs as bytes is the consumer's.

## 7. Corpus results (`test/fixtures/cases.json`)

The corpus has 294 cases: 132 must_flag, 120 must_not_flag and 42 ambiguous, which are not scored. A case passes when `spoofed` matches `expected.spoofed`, `normalized` equals `expected.normalized` when given, and `normalized` equals the input when `expected.keep` is set. `npx vitest run test/corpus.test.ts --reporter=verbose` prints the score of the library per option set (pass/fail of the 252 scored cases):

| options                                                                                  | pass/fail |
| ---------------------------------------------------------------------------------------- | --------- |
| none                                                                                     | 213/39    |
| `{ confusionModel: 'language', hiddenChars: 'strict' }`                                  | 215/37    |
| the same with `hiddenCharRules: { softHyphen: 'remove-counted', wordBreakHint: 'keep' }` | 221/31    |
| the same with `wholeScriptFold: 'off'`                                                   | 211/41    |
| the same with `wholeScriptFold: 'foreign-letters'`                                       | 215/37    |

The scores are printed, not pinned. Cases where the rules give another result than the corpus expects: words of two requested languages that are reported instead of converted (`Москвa`, `Wе`, `ассоunt`, `раураl`, `admiп`), words where nothing converts (`mixed_non_legitimate`), silent soft hyphens.

## 8. Visual test-case study (evidence)

Source: a visual study of the corpus words: glyphs rendered side by side in 8 fonts (Noto Sans/Serif, DejaVu Sans/Mono, Liberation Sans/Serif, Noto Serif italic, Liberation Serif italic) and compared by pixels. Evidence only: the rules follow reading in running text, which the study does not measure.

### 8.1 Findings

- **Identical in all 8 fonts**: Cyrillic `а е о р с у х ѕ ԛ ԝ`; caps `А В Е М Н О Р С Т Х І Ј Ѕ Ԛ Ԝ`. All are twins in the table.
- **UTS #39-confusable but visibly different in every font**: `У/Y`, `ү/y`, Greek `α ν ρ ι κ υ γ χ`, Latin `ɑ ı ſ/f`, Cherokee, fullwidth/math-bold, `З/3` (except DejaVu Sans Mono). `К/K` differs in most fonts (kinked arm). `к/k` differs in all 8.
- **Italic**: `т п и` are pixel-identical to `m n u` in both italic fonts (`тail`, `иser`, `admiп` read "mail", "user", "admin"; Russian `тип` reads "mun"). Upright `т в н` match small capitals `ᴛ ʙ ʜ`, not `t b h`.
- **Font-dependent**: `ɡ`≈`g` (sans), palochka `ӏ` is cap-height and reads `I` (so `раураӏ` reads "paypaI"), Armenian `ս օ հ ո` ≈ `u o h n` only in DejaVu Sans, `ν`≈`v` only in Liberation Serif italic.
- **Digits** (`pairs.json`): `1/l` and `0/O` are distinguishable by pixels in all 8 fonts (ratios 0.33–0.97); `З/3` is identical in DejaVu Sans Mono. Further digit pairs: §8.4.
- **Not all `\p{Cf}` is invisible**: Arabic number signs U+0600–0605, U+06DD, U+070F render. Cleanup leaves them (§6.1).
- **Legit hidden characters**: German `Auf\u200Clage` (ZWNJ breaks the `fl` ligature); ICU's `J\u200F2–\u200F` and ALM between Arabic-Indic digits reorder display but are legitimate marks (corpus: ambiguous).
- ш/w, σ/o, η/n, ω/w were not among the measured pairs.

### 8.2 Rules and the study's glyph comparison

| rule                                                  | study says                                                                                    | consequence                                                                                                                       |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `χ`~`x` is a twin (identical in some terminal fonts)  | visibly different in all 8 fonts                                                              | font-dependent: the pair is on by default                                                                                         |
| `к`~~`k`, `κ`~~`k` not twins                          | visibly different in all 8 fonts                                                              | agrees with the study                                                                                                             |
| `η`~`n` not a twin                                    | not measured                                                                                  | —                                                                                                                                 |
| `ω`~`w`, `ш`↔`w`, `σ`↔`o` twins                       | not measured                                                                                  | no evidence either way                                                                                                            |
| UTS #39 pairs kept (`У/Y ү/y α ρ ι υ γ ν г/r`)        | visibly different in every font                                                               | removing them would make ~10 more letters proof letters                                                                           |
| italic twins are conditional, off by default          | italic renders `т п и` pixel-identical to `m n u`                                             | `т~m`, `и~u` are conditional, off by default: such words are reported as mixed, not converted (§3.3); `п`↔`n` is an ordinary pair |
| soft hyphen removed silently                          | corpus flags SHY inside a brand/keyword (`pay\u00ADpal.com`) and keeps it in German compounds | `spoofed` false where the corpus expects true (3 cases); German compounds lose their hyphenation hints                            |
| ZWNJ inside a word of Latin letters removed + counted | `Auf\u200Clage` is legitimate German typography                                               | one counted false positive per such word                                                                                          |
| ZWSP always removed                                   | Thai text uses ZWSP as word-break hints                                                       | Thai text changes (silently); line breaking in Thai degrades after normalization                                                  |

The study's comparison is glyph-to-glyph. The criterion of the rules, alike in running text, is about reading, which the study does not measure. `χ`~`x` is font-dependent: distinct in the 8 study fonts, identical in some terminal fonts; the pair is on by default.

### 8.3 Italic twins

`т`~~`m` and `и`~~`u` match only in italic fonts; to a Russian reader they look distinct upright. They are conditional twins, off by default (§3.3). Without them such words are reported as mixed and left as written. `п`~`n` is an ordinary pair of the packs in both directions (§3.2).

### 8.4 Digits

An ASCII digit is never read as a letter: `g00gle`, `app1e`, `l0gin`, `НОВ0СТИ` stay as written and are not reported (the measurements below are the reason). The other direction is part of the library: a character that looks like an ASCII digit is converted, alone too (§17.8: `error Ꮞ04` → `error 404`, a spoof), and a character with a digit reading and a letter reading takes the letter inside a word (`g০০gle` → `google`).

The measurement for ASCII digits as letters (gate `0 1 3` + optional `6`~`б`):

- Glyphs (`scripts/measure-digit-pairs.mjs`, `docs/evidence/digit-pairs.json`, `docs/evidence/digit-words.png`): every digit/letter pair is distinguishable by pixels in all 8 fonts except `3`/`З` in DejaVu Sans Mono; `ра6ота`/`работа` and `3`/`З` in caps read alike in sans fonts.
- Gate: digit runs between letters on both sides, ≥ 3 letters, letters ≥ 2 × digits, no hex, consistent case, no camel hump after the run.
- Corpus: 0 cases changed (the hex rule keeps 2 hex HTML entities out). 117 curated legit tokens: 0 (not independent: the gate was tuned on them).
- **Real text, 5.83 M Markdown tokens: 111 folds, 34 distinct, ≈ 33 wrong** (`x11spice`, `v1beta`, `x00api`, IDs, key fragments). With a 247 k known-word list: 1 (a leet user name), but attacks caught are 11/17 instead of 14/17 and a word list would have to ship.

### 8.5 Mid-word I-for-l (not in the design; the measurement is the reason)

There is no rule for a capital `I` inside a lowercase word (`goIang`, `appIe`) — it cannot be told from camelCase without a dictionary. Measured for the rule "capital `I` between two lowercase Latin letters, and the `I`→`l` form is a known word" (`/usr/share/dict/words`, 104 k): the Markdown scan (5.83 M tokens) has 2 494 such tokens, 224 distinct (`sessionId` 195, `accountId` 170, `userId` 127, `beginInteraction` 55 …); 0 become a known word. Attacks `appIe paIace heIlo onIine emaiIs bIog` are caught by it, `goIang` missed (`golang` not in the list). Without the word list every one of the 2 494 camelCase tokens would be a candidate. The case anomaly is limited to the last letter (§4.6).

## 9. Costs and limits

1. **Russian words quoted in English text fold into English.** Lowercase words built only from `а е о р с у х ш г` fold whenever the other words are English — `I bought сор today` → `cop`, `the рос here` → `poc`, `it is сухо here` → `cyxo`, `eat уха soup` → `yxa`, `an оса flew` → `oca`, `add сахар now` → `caxap`. Of 142 815 `ru_RU` hunspell stems (≥ 2 letters, lowercase), 131 fold inside `we saw … today` (`шар` → `wap`, `хор` → `xop`, `гора` → `ropa`); 294 stems use only those letters plus `к`, so `к` being a proof letter halves the set. Inflected forms are not counted. `ё` folds to `ë` (`серёг` → `cepër`). `сок`, `кора`, `рука`, `кошка` do not fold. `inputLanguages: ['Russian']` suppresses it. Under `wholeScriptFold: 'foreign-letters'` or `'off'` none of them fold (§4.3); the default `'all'` folds them, as the Latin-fold model does.
2. **One target-language fit is enough for the ladder.** With `targetLanguages: ['English']`, `раураl` → `paypal` although one letter of six is English. A word of two requested languages is not folded as a whole: with the default languages `раураl`, `кey` and `тap` are reported and left as written (§4.5).
3. **Positional rules judge only folds into languages with rules** (Russian, Ukrainian and the other Cyrillic-letter languages, Greek). They reject the Russian reading `раЬу` of `paᏏy`; a fold into a language without rules (English, European) is unchecked. No corpus case or probe reaches that (§4.2).
4. **Target languages decide what can be fixed.** With the defaults (English, Russian, Ukrainian, Greek) Latin letters in a Greek word (`Kαλημέρα`) or a Ukrainian word (`сiла`) fold back; a language not enabled (Serbian `ј`, Macedonian `ѕ`, Kazakh `қ`) is only evidence, and its words with Latin letters stay mixed. A Russian word with a Latin `i` folds into Ukrainian (`мiр` → `мір`). (Armenian/Cherokee/Coptic are donors, never targets, so `now` is a clean context word; `THE` is not — it fits Russian `ТНЕ`.)
5. **Case anomaly sees only the last letter** (no mid-word rule, §8.5). `paypaI`, `gmaiI`, `раураӏ`, `раураІ` are caught; `goIang`, `appIe` (I-shaped capital inside, followed by lowercase) are indistinguishable from camelCase (`getId`) and pass. A random ID or mojibake ending in `I` after lowercase letters is flagged.
6. **Palochka languages are approximated.** `ӏ` is allowed after `г д к л п т ф х ц ч ш щ ж с з`; Chechen also writes it after vowels (`маӏа`). Such words get evidence; they stay unflagged only when no other alphabet fits them.
7. **Orthography evidence needs ≥ 2 letters and only positional rules.** Misspellings that swap `ь`/`ъ` are deliberately not judged; a spoof that only swaps them (`подъезд` ↔ `подьезд`) is invisible to these rules. Dictionaries cover stems, not inflected forms.
8. **Whole-script attacks in their own language's context pass** without evidence (`СОСА` in Cyrillic letters next to a Russian word stays as written); `раураl` alone is reported and left (§4.5).
9. **Hyphen parts.** Without `hiddenChars: 'strict'` each part of a hyphen compound is a word with the other parts as neighbours: `СОСА-COLA` → `COCA-COLA`; inside Russian text (`это СОСА-COLA тут`) it is kept and reported as `whole_word_lookalike`. `СОСА-СОЛА` stays as written, also inside English text.
10. **Descender twins are font-dependent by design.** `χ`~~`x` fails the baseline-clip test in all 8 fonts but is on by default (it reads as `x` in running text); `η ŋ ɳ`~~`n` are identical only in some sans fonts and are off. Callers pick the set; a different default changes which Greek/Tajik letters are proof letters.
11. **Tajik and Uzbek are modelled only by letter set** (needed because `ҳ` is a model letter); no positional rules, no dictionary measurement (no Tajik/Uzbek Cyrillic hunspell list on this host).
12. **Pieces, not words, in a word of two requested languages.** `Пpивеt` becomes `Привеt`: the one-letter piece `p` is corrected, the last piece `t` is not. `quіск` stays as written and is reported (without options `analyze` gives `quick`).
13. **Silent soft hyphens.** A soft hyphen inside a brand or keyword (`pay\u00ADpal`) is removed without a finding; `softHyphen: 'remove-counted'` reports it (§7 scores both settings).
14. **Latin extras as donors fold IPA.** An IPA transcription made of donor letters (`ɡɪ` → `gi`) is folded. With `English` requested, `þ` reads `p` and `ı` reads `i` (`þorn` → `porn`; a Turkish `ı` is kept only near other Turkish letters); request `European` to keep both (§3.4).
15. **Italic twins break Russian words in English context** when enabled (`Wi-Fi-роутер` → `Wi-Fi-poymep`, `по e-mail` → `no e-mail`, §3.3); off by default.
16. **Both options are opt-in**: none of this applies unless the caller asks for it — without `confusionModel: 'language'` `Пpивет` comes out as `Πpᴎbet`.

## 10. API

Two opt-in options, plus sub-options of the resolver; the callbacks are §17.1:

| option, field or export                                                                                                                                                                                                                                                                                                 | notes                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AnalyzeOptions.confusionModel?: 'latin-fold' \| 'language'`                                                                                                                                                                                                                                                            | default `'latin-fold'` (the fold of §1). `'language'` enables the resolver of §4                                                                                                                                                                                                                                                                                                                                                     |
| `AnalyzeOptions.hiddenChars?: 'lenient' \| 'strict'`                                                                                                                                                                                                                                                                    | default `'lenient'` (§1). `'strict'` enables the rules of §6.1                                                                                                                                                                                                                                                                                                                                                                       |
| `AnalyzeOptions.wholeScriptFold?: 'off' \| 'foreign-letters' \| 'all'`                                                                                                                                                                                                                                                  | only with `confusionModel: 'language'`; default `'all'` (nearest the Latin-fold model's whole-script fold; §4.3)                                                                                                                                                                                                                                                                                                                     |
| `AnalyzeOptions.conditionalTwins?: ReadonlySet<ConditionalTwinId>`                                                                                                                                                                                                                                                      | only with `confusionModel: 'language'`; default `{'χ~x','χ~х','ҳ~x','ҳ~χ'}` (§3.3); ids `η~n` `ŋ~n` `ɳ~n` (descender) and `и~u` `т~m` (italic) opt-in; `п`↔`n` is an ordinary pair (40g); export `CONDITIONAL_TWINS` lists them                                                                                                                                                                                                      |
| `AnalyzeOptions.targetLanguages?: readonly TargetLanguage[]`                                                                                                                                                                                                                                                            | only with `confusionModel: 'language'`; default `['English', 'Russian', 'Ukrainian', 'Greek']`; any language of `TARGET_LANGUAGES`                                                                                                                                                                                                                                                                                                   |
| `AnalyzeOptions.donorAlphabets?: readonly DonorAlphabet[]`                                                                                                                                                                                                                                                              | only with `confusionModel: 'language'`; default: every alphabet no target language uses (`Armenian`, `Cherokee`, `Coptic`, `LatinExtra` with the default targets); an alphabet left out is outside the model (§3.4)                                                                                                                                                                                                                  |
| `WordFinding.normalized?: string`                                                                                                                                                                                                                                                                                       | the word after resolution/cleanup. Callers render `` `${f.normalized} (${f.word})` ``                                                                                                                                                                                                                                                                                                                                                |
| `WordFinding.resolution?: { class: 'confusable' \| 'mixed'; language: TargetLanguage \| null; rule: ResolutionRule; folded: boolean; context: { neighbours: TargetLanguage[]; window: TargetLanguage \| null }; candidates: TargetLanguage[]; rejected: Partial<Record<TargetLanguage, string>>; evidence?: Evidence }` | only with `confusionModel: 'language'`, for a word the ladder decided (§4.2). `ResolutionRule` = `'hyphen' \| 'neighbours' \| 'window' \| 'word-majority' \| 'any-valid' \| 'case-anomaly' \| 'conditional-twin' \| 'evidence' \| 'one-target' \| 'primary-target' \| 'no-valid-language'`; `Evidence` kinds `foreign`, `orthography`, `case`, `donor`, `conditional`; `folded: false` for kept confusable words and all mixed words |
| `counts.confusableWords`, `counts.mixedWords`; action `'remove-with-content'` (§15.3)                                                                                                                                                                                                                                   | always present (0 without `confusionModel: 'language'`)                                                                                                                                                                                                                                                                                                                                                                              |
| exports `CONFUSION_ALPHABETS`, `TARGET_LANGUAGES`, `CONDITIONAL_TWINS`, `twinsOf(ch)`, `resolveWord(word, ctx)`, `RU_CASE_ENDINGS`                                                                                                                                                                                      | —                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `ZERO_WIDTH_INERT_RUN`                                                                                                                                                                                                                                                                                                  | the lenient rules' inert run (4); the strict rules read `zeroWidthRunThreshold`                                                                                                                                                                                                                                                                                                                                                      |
| `WordFinding.skeleton`, `dominantScript`                                                                                                                                                                                                                                                                                | as in §1                                                                                                                                                                                                                                                                                                                                                                                                                             |

Data: the generator emits `src/data/confusion.generated.ts` (packed `cp>alphabetBitmask:targetCp,…`, all 650 letters of the N + M alphabets, §3.4; target restriction and conditional twins are applied at resolver construction) from `confusables.generated.ts` + overrides; the overrides live in a checked-in `scripts/confusion-overrides.json` so a Unicode refresh re-derives without losing them.

## 11. Performance

Measurements (throughput, latency, memory, scaling, cost factors, with the machine and the method) are in [performance.md](./performance.md); `bench/bench.mjs` produces them.

Cost model inside `analyze`:

- `\p{RGI_Emoji}` runs only locally: a sticky match a few code points before each hidden run that touches a pictograph. Hidden-run discovery is a sparse scan.
- The word phase classifies each word once from per-code-point tables; context is a ring of `contextBuffer` words with per-language letter sums, so a window majority is O(1) per word and the memory for context does not grow with the text (`breadth: 'window'`).

`test/performance.test.ts` guards the scaling (time for 4× the input against a bound, long single tokens, dense hidden characters). It runs as its own vitest project (`performance`, `vitest.config.ts`), one file at a time and after every other file has finished (`sequence.groupOrder`), so parallel test files do not skew its timings. Ratio tests time their two sides in turn (small, large, small, …) and compare the medians of the two series, so a burst of host load hits both.

## 12. Tests

- **Documents**: `test/readme.test.ts` runs the examples of README.md, docs/guide.md and the generated tables of this document against the library.
- **Corpus**: `test/corpus.test.ts` scores `test/fixtures/cases.json` per option set (§7).
- **Table**: `test/confusion-table.test.ts` checks the derived twin table and its overrides.
- **Resolver and model**: `test/resolve.test.ts`, `test/confusion-model.test.ts`, `test/lookalike-packs.test.ts`, `test/per-language-rule.test.ts`, `test/neutral-dictionary.test.ts`, `test/references.test.ts`, and a file per group of rules beside them.
- **Hidden characters**: `test/hidden.test.ts`, `test/hidden-content.test.ts`, `test/invisible.test.ts`, `test/terminal.test.ts`, `test/vtparse.test.ts`.
- **Callbacks**: `test/finding-callback.test.ts`.
- **Performance**: `test/performance.test.ts` (§11).

## 13. Known gaps (one place)

Corpus: §7 gives the scores per option set.

Design gaps:

- Russian words quoted in English text fold into English under `'all'` (`I bought сор today` → `cop`); use `'foreign-letters'` or `inputLanguages` (§9, item 1).
- A word of two requested languages is corrected by pieces only: `раураl`, `кey`, `тap`, `Applе`, `Москвa` are reported and left with the default languages (`hostileInput` converts a last one-letter piece; a narrower `targetLanguages` makes the other letters donors) (§4.5, §17.10).
- A single Latin `i` in a Russian word is completed as Ukrainian when Ukrainian is requested (`мiр` → `мір`) (§4.5).
- `иser`, `тail` stay mixed unless `и~u` / `т~m` are enabled; enabling `т~m` breaks Russian words in English context (`роутер` → `poymep`) (§3.3).
- Mid-word I-for-l (`goIang`, `appIe`): no rule without a dictionary (§8.5); case anomaly only at the last letter (§4.6).
- Dotless `ı` reads `i` with `English` requested unless Turkish letters are near: a Turkish word with none of `ğ ş İ` around it, in English text, is converted (§3.4).
- An ASCII digit is never read as a letter (`g00gle`, `paypa1`) (§8.4).
- `χ`~`x` is on although it fails the baseline-clip test (font-dependent, §3.3).
- IPA transcriptions made of donor letters fold (`ɡɪ` → `gi`) (§3.4).
- Palochka after a vowel (Chechen `маӏа`) carries evidence; harmless only while no other requested language can take the word (§4.4).
- Tajik/Uzbek modelled by letter set only; Greek/Hebrew positional rules cover final sigma / final forms only; Hebrew rule not wired (§4.7).
- Whole-script words in their own language's context stay (`СОСА` next to a Russian word) (§9, item 8).
- Swapped `ь`/`ъ` spoofs are not judged (no rule that tells them apart) (§4.7).
- One zero-width bit per letter spread over a text is reported per carrier, not as one payload (§15.5).

## 14. Implementation in `src/`

**Modules**

| module                                                                               | content                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scripts/generate-confusion.mjs` → `src/data/confusion.generated.ts`                 | the 650-letter table of §3.4: per code point an alphabet id and its twins (packed `cp>alphabet:twin,twin;…`), curated additions, conditional pairs tagged with their id; overrides in `scripts/confusion-overrides.json` |
| `src/languages.ts`                                                                   | `LANGUAGES` (letter sets per language), `TARGET_LANGUAGES`, `ORTHOGRAPHY` positional rules, `RU_CASE_ENDINGS`                                                                                                            |
| `src/confusion.ts`                                                                   | `createConfusionModel({ targetLanguages, donorAlphabets, conditionalTwins })` → cached model: `twinIn`, `scriptOf`, `languageViolation`, `caseAnomaly`, `inspect(word)`                                                  |
| `src/resolve.ts`                                                                     | `TokenClassifier` (per-token context facts), the ladder and whole-script modes (`resolveInspected`), `resolveTokens` over a token list: clean-word marking, hyphen compounds, neighbours, ±10 window, fold               |
| `src/hidden.ts`, `src/detectors.ts`, `src/chars.ts`, `src/controls.ts`, `src/ivd.ts` | rules and result types, the hidden-character and control generators (§17.2), `cleanHidden` = phase 1                                                                                                                     |
| `src/core.ts`, `src/terminal.ts`                                                     | merge, tee, look-past view, regions, records (§17.2); terminal layer and backspace (§16.1)                                                                                                                               |
| `src/analyze.ts`, `src/letters.ts`, `src/token.ts`                                   | `analyze` = phase 1 into the letter phase (§17.4): re-chunker, ring, per-token judgement (`analyzeToken`), output in source order; the Latin-model judge for words outside the model (zalgo, styled, illegal)            |
| `src/types.ts`, `src/index.ts`                                                       | options and result fields of §10; exports `TARGET_LANGUAGES`, `CONDITIONAL_TWINS`, `CONFUSION_ALPHABETS`, `RU_CASE_ENDINGS`                                                                                              |

**Options** (all under `AnalyzeOptions`): `confusionModel: 'latin-fold' | 'language'` (default `'latin-fold'`), `hiddenChars: 'lenient' | 'strict'` (default `'lenient'`), `wholeScriptFold: 'off' | 'foreign-letters' | 'all'` (`'all'`), `targetLanguages` (`['English','Russian','Ukrainian','Greek']`), `donorAlphabets` (all non-target), `conditionalTwins` (`{'χ~x','χ~х','ҳ~x','ҳ~χ'}`), `inputLanguages`. Result: `WordFinding.normalized`, `WordFinding.resolution`, `counts.confusableWords/mixedWords`; hidden-character marks and payloads go to the callbacks (§17).

**Test data**: `cases.json` (corpus), hunspell stems for the positional-rule false-positive check (not vendored; `scripts/measure-false-positives.mjs` documents the run), probe list of `prototype-resolve.mjs` as resolver fixtures.

### 14.1 Details

| area                       | in `src/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| hidden-character rules     | `hiddenCharRules`: per-class settings on top of `hiddenChars: 'strict'` (`STRICT_HIDDEN_RULES` = the §6.1 rule set): `softHyphen`, `leadingBom`, `isolatedZeroWidth`, `wordBreakHint`, `joinerInWord`, `zeroWidthInWord`, `zeroWidthRun` (actions `'remove-counted'` / `'remove-silent'` / `'keep'`), `zeroWidthRunThreshold`, `bidiOverrides`, `bidiMarks`, `bidiMarksInRtlText` (`'keep'`), `variationSelectors`, `tags`, `blankFillers`, `otherInvisibles`. Joiners in joining scripts, one valid selector and RGI emoji sequences are always kept |
| extra invisibles in strict | strict also removes (counted, `otherInvisible`) U+17B4/17B5 outside Khmer, U+110B1 outside Kaithi, U+13430–1343F, U+1BCA0–1BCA3, U+1D173–1D17A                                                                                                                                                                                                                                                                                                                                                                                                        |
| rule names                 | `resolution.rule`: `hyphen`, `neighbours`, `window`, `word-majority`, `any-valid`, `case-anomaly`, `conditional-twin`, `evidence`, `one-target`, `primary-target`, `no-valid-language`; evidence kinds `foreign`, `case`, `orthography`, `donor`, `conditional`                                                                                                                                                                                                                                                                                       |
| `resolution` shape         | `language` is a `TargetLanguage` or null; `rejected` is keyed by language                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| signals                    | a word the ladder folded as a whole carries `confusable_word`; a word of mixed scripts carries its category (`mixed_spoof`, `mixed_legitimate`, `mixed_non_legitimate`, §17.10). A word with a hidden character and a look-alike: one finding with both signals under the lenient rules, two findings (the word's, then `invisible`) under the strict rules                                                                                                                                                                                           |
| data format                | `confusion.generated.ts`: `ALPHABET_LETTERS_PACKED` (letters per alphabet, hex, in fold order), `TWIN_PAIRS_PACKED` (`a.bT`, T = `u` UTS #39, `x` cross-case, `c` curated), `CONDITIONAL_TWIN_DATA` per id (each pair once)                                                                                                                                                                                                                                                                                                                           |
| exports                    | `twinsOf(ch, options)`, `resolveWord(word, context, options)`, `STRICT_HIDDEN_RULES`, `DEFAULT_TARGET_LANGUAGES`, `LANGUAGES`                                                                                                                                                                                                                                                                                                                                                                                                                         |
| default path               | `analyze` in one scan pass with per-code-point tables and token spans. Non-string input throws an explicit `TypeError`                                                                                                                                                                                                                                                                                                                                                                                                                                |

Corpus: §7.

## 15. Hidden content

### 15.1 API

What was hidden reaches the report callback (§17.1): one mark per construct, its rule as `kind`, its input range, and `extracted` — the hidden part as the characters of the input. The library decodes nothing: no tag-character text, no selector bytes, no zero-width bits, no hex, no caps; it may leave out a construct's delimiters (a sequence's introducer and terminator, a span's bidi controls) but makes no assumption about the content; callers decode it. `test/helpers/compat.ts` shows a consumer building `payloads` and `content` lists, decoders included, from the report calls.

`'remove-with-content'` (`HiddenContentAction`) applies to `bidiOverrides` (it removes the overridden spans too), `tags`, `variationSelectors`, `zeroWidthRun`, `markStacks` and `markStacksOther` (the run is the content: as `'remove-counted'`); on any other rule it is a RangeError, as is every value no rule knows.

| kind                                                                                                                                                      | `extracted`                                                                  | mode                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------- |
| `tags`                                                                                                                                                    | the tag characters                                                           | rule `tags`                           |
| `variationSelectors`                                                                                                                                      | the selectors the mark removes (a valid first one stays and is not included) | rule `variationSelectors`             |
| `zeroWidthRun`, `invisibleRun`                                                                                                                            | the run's characters, read past removed controls                             | rules `zeroWidthRun`, `invisibleRun`  |
| `markStacks`, `markStacksOther`                                                                                                                           | the marks past the script's limit, which the mark removes (§15.7)            | rules `markStacks`, `markStacksOther` |
| `bidiOverrideSpan`, `bidiReorderSpan`                                                                                                                     | the span in logical order, without its bidi controls (§15.2)                 | rules of their own (default report)   |
| every other carrier (zero-width kinds, soft hyphen, bidi controls and marks, fillers, other invisibles, `invisibleMathOperators`, `invisibleOutsideWord`) | its characters                                                               | its rule                              |

**Scattered payloads**: the library detects no payload spread one carrier per word; this changes neither output, word phase nor counts. Each carrier's report includes its character, so a consumer joins consecutive carrier reports itself (`test/finding-callback.test.ts`, decodes 320 characters spread over 2 560 words).

### 15.2 What counts as a bidi span

The stack follows the explicit-level rules of UAX #9 (X1–X8), without the depth limit. A frame ends at its PDF, at the PDI of an enclosing isolate, or at the end of the paragraph (LF, CR, U+0085, U+2029, FS, GS, RS; not U+2028); a PDF inside an isolate cannot close what is outside it. An embedding or isolate inside an override counts as one unit to it. Of nested spans of one kind, the outermost reversing one is reported.

An override is a span when it **reverses letters or digits**:

- two letters or digits in a row against the forced direction: Latin or digits under RLO, Hebrew or Arabic under LRO; a letter with the forced direction restarts the count;
- an RLO with no RTL letter and at least two visible characters (`\u202E!?\u202C`).

Text that already goes that way shows as it would without the override, so nothing is hidden, and one letter alone has no order to reverse:

| input                                    | Chrome, in the text's own direction | span |
| ---------------------------------------- | ----------------------------------- | ---- |
| `\u202Egnp.exe\u202C`                    | `exe.png`                           | yes  |
| `\u202Dשלום עולם\u202C`                  | letters reversed                    | yes  |
| `\u202Eשלום world\u202C`                 | `dlrow` beside the Hebrew           | yes  |
| `\u202Eמחיר 100\u202C`                   | `001`                               | yes  |
| `\u202Eשלום עולם\u202C`                  | unchanged                           | no   |
| `\u202Eمَرْحَبًا\u202C`                      | unchanged                           | no   |
| `\u202Eמחיר 5\u202C`, one Latin letter   | unchanged                           | no   |
| `\u202Eالسعر \u202D100\u202C ريال\u202C` | unchanged                           | no   |
| `\u202D+972-50-1234567\u202C`            | as written                          | no   |

`docs/evidence/bidi-spans.json` has all 50 samples, measured by the position of each code point in Chrome. A sample is reported if and only if Chrome shows another order than without its controls in the text's own direction, with three exceptions the test names: `\u202Bhello!\u202C` (only the `!` moves), an LRO keeping a phone number as written inside Hebrew (it prevents the digit groups' swap), and an RTL isolate around real RTL letters inside Latin (ordinary mixed-direction text).

### 15.3 `remove-with-content`

- `bidiOverrides`: a `bidi-override` span goes whole, controls, isolates and marks inside it included; the rest of a Trojan Source line (`\u202E…` to the paragraph's end) goes with it. Removed code points count in class `bidiOverrideSpan`, the chunk counts once in `hiddenWords`. A payload inside the span is reported and needs no edit of its own. An override with no span acts as `'remove-counted'`: controls go, letters stay.
- `tags`, `variationSelectors`, `zeroWidthRun`: the run is the content, so the action is `'remove-counted'` plus the report.
- **Embeddings (U+202A, U+202B) never lose their text.** They set a direction, strong letters keep theirs: `\u202Bשלום עולם\u202C` and `\u202Bhello\u202C` show their letters in order, and mixed text swaps its runs the way real RTL paragraphs do. Word processors and browsers wrap RTL text in them, so removing the span would delete legitimate text. Their controls follow the rule.
- **Marks and isolates** are not touched outside a span: rules `bidiMarks` and `bidiMarksInRtlText` decide.

Legitimate RTL text survives: `test/hidden-content.test.ts` runs 28 Hebrew, Arabic, Persian and mixed-direction samples, with and without overrides, embeddings, isolates and marks, and asserts no entry and every letter kept.

### 15.4 Words broken by zero-width characters

Not hidden content: there is nothing behind the character. `fr\u200Bee` → `free`: the mark is reported, with nothing extracted beyond the character. `joinerInWord`, `zeroWidthInWord`, `isolatedZeroWidth`, `wordBreakHint` and `softHyphen` do not accept `remove-with-content` by type; at runtime the value acts as `'remove-counted'`. A run at the threshold is content (`fr` + 4 ZWSP + `ee` has a `zero-width-run` entry) and only the run goes: the mode never removes a letter for a zero-width character.

### 15.5 Payloads one carrier per letter

- **Ideographic variation selectors** (the per-base IVD table ships): a supplement selector (U+E0100–E01EF) is valid only on a base the Ideographic Variation Database registers it for. `src/data/ivd.generated.ts` (`scripts/generate-ivd.mjs`, IVD 2026-08-03: 39 509 entries, 29 642 sequences, 15 304 bases, all Han, all within U+E0100–E011F; `IVD_VERSION`) holds a selector bit mask per base. Any other selector is an orphan: removed, counted, decoded as bytes, and the scattered-payload merge (§15.1) joins one per letter into one `variation-selector` entry: `辻\u{E0151}辻\u{E0152}` → `辻辻`, `content` text `ab`. Kana has no registered base, so a supplement selector on kana is an orphan. Every registered sequence alone keeps its selector (checked against the IVD file, 0 missing, 0 extra).
- **Zero-width bit per letter**: in-word zero-width runs the rules remove, at most 2 code points apart (marks not counted), form a chain. A chain of at least 32 carriers in exactly two symbols whose zero-width-binary reading is printable is a `zero-width-scattered` payload. The library reports each run as its own mark; the chain is the consumer's join (`test/helpers/compat.ts` lists it in `payloads` and `content`). Nothing more is removed than the rules already remove. One symbol (wrap hints, a CMS putting ZWSP into long words) carries no bits; kept joiners never join a chain.
- **No cap on decoded text**: `extracted` is the whole payload.

### 15.6 Known gaps

- Zero-width payloads in other shapes are broken words at most: more than two symbols, 7-bit or LSB-first packing, mixed carriers spread over words, bits in kept joiner positions, chains below 32 carriers.
- Overrides nested past depth 125 do nothing on screen and are reported all the same.

U+061C alone is no RTL text: `RTL_RE` skips it, so `abc\u061C def\u200E` loses both marks, while Arabic and Hebrew text keeps its marks, U+061C included.

### 15.7 Mark stacks

Many marks on a letter make a line unreadable to a person long before they cover it, while a model reads the letters as they are. So a stack past what the script writes is hiding, and is judged per base, by the base's own script: one RTL letter in a word does not exempt the rest (strict only; lenient `analyze` has no mark-stack rule).

- Rules: `markStacks` for scripts that stack marks, `markStacksOther` for those that do not (Latin, Cyrillic, Greek, Armenian, Georgian, Cherokee, Han, kana, Hangul, Common). Default `'remove-counted'`: the first marks up to the limit stay, the rest go, class `markStack`. `'keep'` leaves them and still reports. Strict `analyze` trims those stacks too (`cr̸͈͖͡ypto` → `cr̸͈ypto`: the marks within the limit stay); a word with a trimmed stack reports signal `zalgo`, not `invisible`.
- Counted through hidden characters, so CGJ, a joiner or a selector cannot split a stack. Variation selectors and invisible marks are not counted as marks.
- Limits: `MARK_STACK_LIMITS`, override by `markStackLimits`; a script not named gets `MARK_STACK_DEFAULT_LIMIT` (5). Corpus: `zalgo-003`, a Thai stack, passes.

| script                                                     | limit | deepest real writing tested                        |
| ---------------------------------------------------------- | ----- | -------------------------------------------------- |
| Thai, Lao                                                  | 3     | vowel + tone, 2                                    |
| Arabic, Syriac, N'Ko, Thaana, Mongolian                    | 5     | Quran: shadda, vowel, dagger alef                  |
| Hebrew                                                     | 5     | shin dot, dagesh, vowel, accent, meteg             |
| Indic scripts, Myanmar, Khmer, Kaithi                      | 5     | nukta, vowel, candrabindu, Vedic accent            |
| Tibetan                                                    | 10    | Kalachakra stack, 9                                |
| Latin, Cyrillic, Armenian, Georgian, Cherokee, CJK, Common | 2     | Vietnamese and Yoruba in NFD                       |
| Greek                                                      | 3     | polytonic in NFD (lenient `analyze` calls 3 zalgo) |

**Readability measured**, `node scripts/measure-mark-stacks.mjs` → `docs/evidence/mark-stacks.json`: every letter of a word carries the stack, 3 fonts, worst font, `line-height: normal`, in lines past the line box. No OCR is available here, so this is overrun, not a reading test.

| script     | real text | at limit  | limit + 1 | ×10       | ×40       |
| ---------- | --------- | --------- | --------- | --------- | --------- |
| Thai       | 0         | up 0.85   | up 1.21   | up 3.40   | up 8.04   |
| Lao        | down 0.03 | up 0.11   | up 0.26   | up 1.21   | up 5.96   |
| Arabic     | 0         | up 0.15   | up 0.24   | up 0.56   | up 3.07   |
| Tibetan    | down 0.34 | down 0.57 | n/a       | down 0.57 | down 3.88 |
| Latin      | 0         | up 0.12   | up 0.28   | up 1.53   | up 7.61   |
| Hebrew     | 0         | 0         | 0         | 0         | 0         |
| Devanagari | 0         | 0         | 0         | 0         | 0         |

At its limit no stack leaves its line by a full line. Thai at 3 comes closest: one mark above the 2 tested in real text, kept for safety, and `markStackLimits: { Thai: 2 }` tightens it. In Hebrew and Devanagari these fonts pile marks on one spot, so overrun reads 0 at any depth: the limit there rests on real writing alone. At `line-height: 1.2` real text itself runs into neighbours (Tibetan down 1.72, Arabic up 0.35), so overrun alone cannot be the rule.

## 16. Text rendered over other text

Evidence: `node scripts/measure-overlap.mjs` (Chrome, DejaVu Sans, Noto Sans, Liberation Serif, DejaVu Sans Mono at 32 px; tmux 3.6 pane) → `docs/evidence/overlap.json`, `overlap.png`. `filled` = share of the blank pixels in a base letter's cell that gain ink, worst letter and font; non-covering samples read up to 13 % from layout shift and antialiasing, and a positive control (CSS `letter-spacing: -0.62em` pulling U+2588 over each letter) reads 100 %. `up`/`down` = how far ink leaves its line box, in lines. The word in every sample is benign.

| construct                                                     | measured                                                                                                 | without the terminal layer                                                                                                     | code points alone?                                                              |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| backspace                                                     | terminal: word gone. Chrome: tofu boxes, word visible                                                    | `analyze`: `illegal`, removed. `cleanHidden`: removed, counted. The word stays in the output, not in `content`                 | yes                                                                             |
| bare CR                                                       | terminal: word gone. Chrome: line break, word visible                                                    | **no signal, kept in every mode** (the control rule exempts CR)                                                                | yes; progress-bar logs and CR line endings look the same                        |
| CSI cursor and erase: `ESC[6D`, `ESC[2K`, `ESC[1A`, `ESC[2J`  | terminal: word gone; `ESC[2J` also erases the lines above                                                | `analyze`: `illegal`, only ESC goes, `[6D` is left in `normalized`. `cleanHidden`: the sequence goes, the word stays, no entry | yes                                                                             |
| SGR hiding: `ESC[8m`, `ESC[30;40m`                            | terminal: cells hold the word in conceal or black on black                                               | same; no entry                                                                                                                 | conceal yes; color pairs only those equal by number, themes need rendering      |
| non-CSI: `ESC 7`/`ESC 8`, `ESC c`, OSC, DCS, APC              | terminal: strings swallowed; `ESC c` wipes the screen                                                    | **`cleanHidden` strips only ESC and BEL**: `]0;word`, `Pword\`, `7word8` come out as text, no entry                            | yes (ECMA-48 grammar)                                                           |
| U+009B CSI                                                    | tmux in UTF-8 prints it as a character; other terminals may not                                          | `analyze`: `illegal`. `cleanHidden`: sequence removed                                                                          | yes                                                                             |
| enclosing marks: U+20DD, U+20E0, U+20E3, U+0488, U+0489       | filled ≤ 22 % (two per letter); up 0.08; the word stays legible; U+20DD family is tofu in the fonts here | no signal below 3 per base; zalgo above                                                                                        | yes, but they cover nothing                                                     |
| overlays: U+0336, U+0338, U+20D2                              | filled ≤ 11 %, ×20 no more than ×1: they stack on one spot. Struck through, legible                      | same                                                                                                                           | yes, but they cover nothing                                                     |
| every wide mark ×20 on each letter, Hebrew letter in the word | filled 37 %: the most ink any mark sample reached                                                        | strict: `zalgo`, stripped, `mark-stack` entry. Lenient: `mixed_script` only                                                    | yes (§15.7)                                                                     |
| tall stack, Latin: U+0301 ×40                                 | up 7.4 lines, 5 % of the line above painted over in thin columns                                         | strict: `zalgo`, stripped, also with a Hebrew letter in the word; `mark-stack` entry. Lenient: `zalgo` only without one        | yes (§15.7)                                                                     |
| tall stack, stacking scripts ×40                              | Thai up 8.0 lines, Arabic up 3.1, Tibetan subjoined down 1.7; Hebrew and Devanagari stay in the line     | strict: trimmed to the script's limit, `zalgo`, `mark-stack` entry. Lenient: no signal                                         | yes (§15.7)                                                                     |
| wide glyphs: U+FDFD, U+12031, U+2E3B                          | take their own advance, no overlap                                                                       | no signal                                                                                                                      | nothing to judge                                                                |
| blocks: U+2588, U+2591                                        | fill their own cell only; a cover needs a terminal control or CSS                                        | no signal, kept                                                                                                                | not alone: they look like redaction, cover nothing. The controls are the signal |
| RLO with line breaks, U+2028                                  | no ink over another line: bidi reorders inside a line                                                    | `invisible`; §15                                                                                                               | no overlap to judge                                                             |
| overlap format controls: U+1BCA0, U+13430–1343F               | tofu here: no font for them, overlap not observed                                                        | `invisible`; strict removes them                                                                                               | yes                                                                             |
| CSS: color, `font-size: 0`, negative spacing, positioning     | the control above                                                                                        | not seen: not in the text                                                                                                      | **no: needs rendering, out of scope**                                           |

Findings: in a browser, no code point alone covers a word, but stacks make lines unreadable without covering them, which `filled` does not measure; §15.7 treats them as hiding and measures overrun. In a terminal, controls erase text outright: that class is judged from code points, by the terminal layer below (opt-in); the third column is the behaviour without it.

### 16.1 Terminal controls (`rules.terminal`)

`hiddenCharRules.terminal` (`{}` = `TERMINAL_RULES`) replaces the control-character grammar with the terminal layer of `src/terminal.ts`; `cleanTerminal(text, rules?)` runs it with every other rule off. Defaults: plain colour SGR goes silently; conceal, same colour, string sequences with their bodies, backspace and erase are removed and counted; private modes and `ESC(B` go silently; concealed text is removed and reported; bare CR is kept and reported.

| class                                                               | default                 | `extracted`        |
| ------------------------------------------------------------------- | ----------------------- | ------------------ |
| `sgr`, `eraseAhead`, `otherSequence`                                | `'remove-silent'`       | —                  |
| `sgrConceal`, `sgrSameColor`, `cursorMove`, `erase`, `reset`        | `'remove-counted'`      | —                  |
| `stringSequence` (OSC, DCS, SOS, PM, APC)                           | `'remove-with-content'` | the body           |
| `terminalConcealed` (from the SGR that hides to the one that shows) | `'remove-counted'`      | the concealed text |
| `backspace`, `backspaceFlood` (one report per area)                 | `'remove-counted'`      | the erased letters |
| `bareCR` (a line break, kept, reported, not counted)                | `'keep'`                | —                  |

- **Parser**: `src/vtparse.ts`, the DEC/ANSI state machine of vt100.net as a transition table (state × character class → action, next state). Invalid sequences are consumed and ignored (`otherSequence`); CAN/SUB abort a sequence; an ESC inside one restarts parsing with a new sequence; C0 controls within a CSI or escape sequence are executed and the sequence goes on (the sequence's marks are the pieces around them, the first carrying its count; a backspace there erases, a line feed stays); inside a string body C0 controls other than the terminators are body. Where xterm.js refines vt100.net it is followed: `:` is a parameter byte (`38:5:1`), and a code point ≥ U+00A0 inside a CSI or escape sequence aborts it (consumed). `ESC N x` (SS2) dispatches at `N`; `x` stays text. Every string body (OSC, DCS data, SOS, PM, APC) takes characters from U+00A0 up. `scripts/fuzz-vtparse.mjs` compares the parser's events with xterm.js (`@xterm/headless` 6.1, read-only local copy): 620 000 random sequences, no difference outside the counted, intended ones (the line-end rule below, BEL in DCS/SOS/PM/APC, xterm.js's own APC states and its CSI fast path after a C0).
- **String sequences**: the body ends at its terminator — BEL (any string type), `ESC \`, U+009C, CAN/SUB, another ESC — across line breaks. Only when no terminator exists later in the text does it end at its line end; the failed search is remembered (`StringMemo`).
- **Backspace**: `BackspaceScan` scans forward over `\b`, ESC, U+009B, CR, LF only. An ESC, or a U+009B that starts a CSI (the cp1252 `›` guard applied): its sequence is parsed right there and becomes a known span of the line (a BS the parser executes inside it erases from the sequence's start). A CR or LF outside a sequence: a line end (`backspaceLineStop`, default true), the line's spans cleared; an executed CR/LF inside a CSI counts as one too. A backspace run walks back with a pending-erase counter, bounded by the line end, skipping the line's known spans (sequences, earlier areas: an area that walks over an earlier one takes it in); controls and invisible characters walked over go with the area and take no cell; leftover backspaces make the area `backspaceFlood`. One path: no buffer, no backward search. A lone CR is a line end like LF: nothing is overwritten (no console mode); `bareCR: 'keep'` (default) leaves it as written, reported, not counted.
- **Streaming and pieces**: a line's areas are final when the scan passes its line end; only the open line is held (with `backspaceLineStop: false` the whole text is one line). An area removes pieces — the erased cells with the controls walked over, the backspaces — not the sequences between them, which keep their own rules (`ab ESC[31m cd⟨BS⟩×3 X` with `sgr: 'keep'` → `a ESC[31m X`). Each piece is a layer mark; the area is reported once, by its first piece (its whole span, `extracted`: all its erased letters, count: all its backspaces), the other pieces are removed unreported. The marks are interleaved first into the terminal layer's stream at equal positions; the parser skips characters a removed piece holds, and every hidden-character detector reads past the pieces through the layer view: an erased right-to-left letter is no text, so a bidi mark left with no right-to-left letter is removed (`A⟨RLM⟩א⟨BS⟩B` → `AB`). Nothing is copied or reassembled.
- **Cells**: every character is one cell, wide (CJK) characters included; controls, format characters, marks and Hangul fillers take none. Documented limitation: a terminal shows a wide character in 2 columns, so the library erases more of them (`漢字⟨BS⟩⟨BS⟩`: a terminal erases `字`, the library both); a tab is a control and takes no cell (`ab⟨TAB⟩⟨BS⟩X`: the library erases `b`). A 2-cell table comes with CJK support.
- **Bare CR**: a CR not followed by LF or the text end, judged when the next character that is no sequence comes. A lone CR is a line break. `'keep'` (default) / `'report'`: report mode, kept as written, not counted; `'newline'`: replaced by LF; `'ignored'`: no mark; `'overwrite'` and `'newline-counted'` throw a `RangeError`. Strict `analyze` reports a word whose removals are all terminal classes as `illegal`.

## 17. Finding callbacks

Code: `src/core.ts` (merge, view, regions, records), `src/detectors.ts`, `src/controls.ts` (rule generators), `src/vtparse.ts` and `src/terminal.ts` (terminal layer, backspace, §16.1), `src/letters.ts` (word phase), `src/neutral.ts` (neutral dictionary), `src/scriptinfo.ts` (per-script table), `src/hidden-words.ts` (strict `analyze`'s hidden-character words), `src/hidden.ts`, `src/analyze.ts`. Tests: `test/finding-callback.test.ts` (one block per rule, fuzz, stress), `test/neutral-dictionary.test.ts`, `test/vtparse.test.ts`, `test/terminal.test.ts`, `test/performance.test.ts`.

### 17.1 API

```ts
cleanHidden(text, rules?, { onReport, onCleanup, onRecord, signal }): string
cleanTerminal(text, terminalRules?, callbacks?): string
analyze(text, options?, { onReport, onCleanup, onRecord, onWord, signal }): AnalysisResult

interface Mark { kind; start; length; extracted: string | null; count }   // report call
interface Region { start; length; original }                               // cleanup call
onWord(start, end, cleaned, replacement, reason)                           // word call
interface OutputRecord { start; length; text }                             // records
```

- **One streaming API**: both functions take the same callbacks; there are no record generators. Usage patterns (a pull stream, counters, payload joins, decoded text) are the consumer's.
- **Results**: `cleanHidden` returns the cleaned text. `analyze` returns `AnalysisResult` (§1's fields), with the language model's `WordFinding.normalized`/`resolution` and `counts.confusableWords`/`mixedWords`; strict mode lists each word with a `'remove-counted'` hidden character as an `invisible` (`zalgo`, `illegal`) finding.
- **Report** (`onReport`): one call per mark per rule, in position order (phase 1), the rule as `kind`, the hidden part in `extracted` as the characters of the input (§15.1, §16.1): nothing is decoded. Rules in cleanup mode report too. A report-mode mark is made only for a listener. No counted/silent flag: the silent rules (`softHyphen`, `leadingBom`, `isolatedZeroWidth`, `wordBreakHint`) and `possibleLigatureBreak` are kinds of their own; the consumer decides by kind what it counts. A rule value no rule knows is a RangeError.
- **Cleanup** (`onCleanup`): one call per region of overlapping cleanup marks (touching marks are separate regions), with the region's source text and `cleanup`, every rule's default applied. A returned string goes into the consumer's records only.
- **Records** (`onRecord`): phase 1's output with the cleanup returns, in both functions. In `analyze` the word phase reads phase 1's library output (under the language model a removed control, escape sequence or hidden character is absent there: it joins its neighbours, also beside an inner dash and at the `×` rule's edges; the removed ranges are phase 1's records, every form phase 1 removes included; VT and FF, which `analyze` otherwise removes as illegal code points, are written as a line feed there, so the words on either side stay apart and a line break is a line and paragraph boundary as LF is; reported `illegal` all the same; FS–US stay removed; the default path removes VT and FF); its result combines no callback returns.
- **Word** (`onWord`, `analyze`): words with a signal; words converted through neutral characters with no spoof (`reason.signals` empty, `converted`, `toLang`; not listed in the result's `words`); and words past `WORD_CAP` (`reason.tooBig`, `replacement` = `cleaned`). `cleaned` is the phase-1 text of the word; `start`/`end` are offsets into the input. `reason`: `signals`, `converted` and `toLang` under both models (`toLang`: the target language converted into: the first requested language of the alphabet holding the converted letters, else the first requested one of it; the Latin-fold model's: `'English'`), and the ladder's `rule` under the language model. A word whose only change is a removed hidden character gets no word call. Word calls come after the report and cleanup calls of the text around their word: a word waits in the ring until its context is read.
- **Stop**: `signal: AbortSignal`. The scan itself stops: phase 1 reads it before every mark and before its last records, the word phase every 4 096 code units of its scan and before every word it judges or outputs; the result covers what was done before.

### 17.2 Phase 1

- **Generators**: the control layer (`controlMarks`, or the terminal layer with its backspace pre-cleanup), `invisibles` (soft hyphen, blank fillers, other invisibles, bidi controls and marks, tag runs, selector runs, `invisibleRun`), `zeroWidthRuns`, `markStacks` (a code-unit scan with a per-code-point table), `bidiSpans`, and `analyze`'s `illegalChars`, `encodingDamage`, `invisibleOutsideWord`, and in strict `analyze` `mojibake`. Each yields marks in position order.
- **Modes**: every finding comes from a rule with a mode — `'ignored'` (no mark), `'keep'` (report), `'remove-counted'`/`'remove-silent'` (cleanup; the two differ only in strict `analyze`'s hidden-character words), `'remove-with-content'` where content can go. `invisibleRun`, `bidiOverrideSpan`, `bidiReorderSpan` default to report. Two more mode names work beside them: `'report'` is `'keep'`, `'cleanup'` the rule's strict cleanup default (`'remove-counted'` where that is no removal), in `terminal` too.
- **`analyze`'s rules**: the findings between words are phase-1 rules with modes — `illegal` (`'remove-counted'`), `encodingDamage` (`'keep'`), and on the default path `invisibleOutsideWord` (`'remove-counted'`, a run between words with a letter; its reports carry the run's characters). On the default path these removals leave the word structure as the tokenizer of §1 sees it: the word pass reads their characters and the output drops them by position. `illegal` leaves what the control layer holds (a removal, a replacement, a sequence the terminal layer reports). Two U+FFFD runs with only removed text between them are one `encoding_damage` finding; a finding inside another rule's removal (a span removed with its content) goes with it.
- **Merge**: `Merger`, one head per generator; the lowest start first; on equal starts the generator listed first (the pre-cleanup stream, then the control layer, then the others in the order above). Mark length plays no role. A generator advances only when its head is taken; a finished one leaves the list.
- **Limits**: one `constructLimit` (default 4,096 code points; measured: largest real mark-to-RTL distance 234, hidden runs 789, words 2,210) bounds every phase-1 construct of unlimited length, every limit counted in code points: hidden-character runs, hidden-character words, concealed terminal spans and mojibake spans are read in chunks of it, with no special report; a backspace erases at most that many cells; a bidi override, embedding or isolate not closed within it is closed there and reported through `onLostBound` (`bidiFrame`); the RTL lookahead reaches that far. Escape-string bodies (OSC, DCS, SOS, PM, APC) have their own `terminal.stringLimit` (default 16 Mi code points, so inline images and clipboard payloads stay whole): with no terminator within it the body ends at its line end, reported through `onLostBound` (`escapeString`). The ring's size counts words only; text between words (an over-cap word, a long gap) is buffered, and no word is judged before its context arrives.
- **Right-to-left text**: whether a bidi mark sits in RTL text (marks under the RTL rule; runs of bidi marks alone are exempt) is computed per UAX #9 paragraph, in the invisibles detector (strict) and the outside-word scan (lenient, the default path too): a mark after a right-to-left letter of its paragraph is in RTL text at once; one before any waits for its own lookahead of `constructLimit` code points: an RTL letter of the same paragraph within it → in RTL text; the paragraph's end or the reach → not.
- **Look-past**: every hidden-character detector reads the control layer through a `Tee` into a `View`: `ZW <ctl> ZW` is one run, a removed control is no neighbour, VT/FF/NEL are the space they become. The zero-width generator classifies its own runs and emits each one once it is complete.
- **Regions**: marks join while the next starts before the region's end; inside a region each mark keeps what earlier marks left of it, a removal running on from the one before extends it.
- **Seam rule**: on unless `seamSpaces: false` (a rules object without the key has it on). At a removal seam `<before><space>` + `<space><after>` keeps one U+0020; the dropped space is a record of its own; a dropped space opens no new seam; a default `' '` emission after a removal loses its space. The default path has no seam rule.

### 17.3 Zero-width characters next to letters (strict)

| input                                                        | strict                                                       | lenient                             |
| ------------------------------------------------------------ | ------------------------------------------------------------ | ----------------------------------- |
| ZWSP touching a Latin letter (`fr⟨ZWSP⟩ee`)                  | removed (`zeroWidthInWord`), listed                          | removed                             |
| ZWNJ between `f` and `f`/`i`/`l`/`t`                         | removed, kind `possibleLigatureBreak` (silent: not listed)   | removed, listed                     |
| ZWSP/ZWNJ touching one letter (`کتاب⟨ZWNJ⟩ `, `/⟨ZWSP⟩path`) | removed, listed; ZWJ not covered                             | kept beside a joining-script letter |
| 2 or more zero-width characters in a row                     | `zeroWidthRun`, removed, listed (`zeroWidthRunThreshold` 2)  | a run of 4 (§1)                     |
| one carrier per word                                         | each report carries its character; joining is the consumer's | —                                   |

`possibleLigatureBreak` takes lowercase `f` only, . `invisibleRun` reads the same threshold: with 2, two adjacent carriers that are not all zero-width are a run (reported by default).

### 17.4 Phase 2: the word phase

- **Input**: phase 1's records only — untouched source, removals (a removal joins its neighbours), default emissions (text between words), and removals the word phase tokenizes all the same (`analyze`'s rules above).
- **Re-chunker**: one pass over the records yields chunks: the text before a word (its leading gap) and the word as phase 1 output it, with its source positions; trailing text forms a final wordless chunk. A gap is kept as a source range while untouched, as text once phase 1 changed it. The Latin-fold model's styled runs (two or more circled/parenthesized/squared letters outside any word) are chunks of their own and words to the word callback.
- **Word cap**: `WORD_CAP` = 250 code points, with any of `hiddenChars: 'strict'`, the language model, `neutralAlphabet`; the default path judges every word. Past it the word is in skip mode: only the source ranges of its kept pieces are recorded, not text; it is not judged, the word call has `tooBig` with `replacement` = `cleaned`, the output keeps it as phase 1 output it.
- **Ring**: typed arrays indexed by slot — start, end, flags, the languages it votes for and its letters, whether every letter is in the model, the left clean neighbour, the paragraph id, the leading gap — and the pending inspection only for words whose resolution depends on context. `contextBuffer` (default 100) words; with the window a word is judged when the read-ahead reaches `contextBuffer − 1 − majorityWindow` words past it, or the text ends. `contextBuffer` smaller than `2 × majorityWindow + 1` is a RangeError naming both values.
- **Context window**: one window, ±`majorityWindow` words within the word's paragraph, read from the ring: the dominant script, "any word is mixed", the ladder's step-2 majority and the Turkish check for `ı`; `breadth: 'all'` (the default without the language model) reads every word for the first two; it is measured less accurate than the window where they differ.
- **Nearest words** (one definition): the nearest voting word on the left by its converted form, the nearest on the right only when it needs no conversion (no donor its letters do not keep, not pending, not mixed), within the paragraph and the ring; nearest-word selection is by the script of most of its letters and non-Latin digits, donors left out. The ladder's step 1 (the languages both nearest words share) and the context of donors (§17.8) read it.
- **No clearing**; **paragraph marker**: a blank line before a word sets a marker on it; the neighbour search and the majority window stop there. CR, LF and CRLF in any combination are each one line break (`\r\r`, `\r\n\r\n` and `\n\n` are all a blank line).
- **Output**: chunks go out in source order once their word is judged; untouched chunks extend one pending source range.

### 17.5 Phases (strict `analyze`)

- **Phase 1, mojibake** (`src/mojibake.ts`, rule `mojibake`: `'keep'` in strict `analyze`, `'ignored'` in `cleanHidden`): UTF-8 read as Windows-1252 / Latin-1 or Windows-1251, found on the source before the control layer removes anything (`â\x80\x99` included). A hit is a lead character (bytes C2–F4) and exactly the continuation characters (80–BF) of one valid UTF-8 code point in a block real text uses. Windows-1252: the strict guards (a non-Latin letter only in a run; a Latin letter through a punctuation continuation only before a letter or in a run), or the mirrored script context (Latin-looking garbage in a word whose other letters are Cyrillic/Greek, or a word of sequences between such words). Windows-1251: strict2 (letters-only sequences only from `Р С Г В` and in runs of equal length, no combining marks), or the script context with the strict guards (Cyrillic-looking garbage in a word of Latin letters, word unit), or `вЂњ`/`вЂќ`. One report per span of adjacent sequences: `extracted` is the text it encodes, `count` its sequences. One pass over the text with a byte table per page.
- **Visibility token**: the word of §17.4, words joined by an inner dash between letters made one token (`NTLM-хеш`; apostrophes already join), with each mojibake span a non-breaking part of it (`todayâ€™s` is one token); a control removed inside a span does not cut it. A span encoding a space stays a gap. Letters inside spans cast no vote: not in the dominant script, the window's counts, the ladder's majority or the nearest-word votes.
- **Phase 2**: a token whose letters, mojibake included, map into one target is one word, judged whole. Inside a span its letters are judged with the word (`ВІРЅ` → `BIPS`, a spoof); its other characters (neutral ones too: `™`, `µ`, `©`) are encoded bytes, kept as written, out of the core.
- **Phase 3**: a token with a letter no target takes, or a mixed word holding a span (the resolver fits no alphabet), is read with each span as the text it encodes and split at each spaced/spaceless script border, never inside a grapheme cluster or a span; characters of neither side go with the spaced side (`click©` + `用`, `用` + `µsername`). A token with one piece and no span is judged whole. Each piece is judged as a word (the encoded text kept, then written back as the span: `用Ⅰâ€™m` judged as `用` + `Ⅰ’m`). Words and pieces within a visibility token take their context from outside it (nearest words and window outside it); parts of one token are never context for each other, and the ladder has no hyphen step there. The token is the unit of context and report only. Dash parts of one language (all letters in one requested language they share) are judged together as one word; parts of different languages, and parts of no one language, are separate words with context from outside the token. A token whose parts give nothing is not reported (`IP-адрес`, `NTLM-хеш`, `α-частица` stay; `реалити-шоу` in English text stays, it cannot fold whole; `хе-хе` → `xe-xe`, `apple-рау` → `apple-pay` in English text). In its neighbours' context window, a token of several scripts counts as its dash parts, affixes excluded (`GPS-прибора` votes Russian). A piece of spaceless letters with nothing to judge is kept.
- **Report**: one finding and one word call per token, naming the whole token: the pieces' outputs joined, their signals merged, one category — `mixed_spoof` when a piece converted look-alikes, `mixed_non_legitimate` when a piece (or the token's letters without its spans) holds scripts that may not share a word, else `mixed_legitimate`. A converted token votes on the left by its converted letters.

### 17.6 The judge by model

- **The default path** (Latin-fold model, lenient): `analyzeToken` (§1).
- **Strict, Latin-fold model**: `analyzeToken` without its zalgo stripping (phase 1 trims stacks, `markStacksOther` is cleanup in strict `analyze` too, the marks within the limit stay) and without invisible detection (phase 1's); neutral letters are written as their Latin letters before the word is judged.
- **Language model**: the resolver judges the word's core. Strict: the resolver alone (no `analyzeToken`: zalgo is phase 1's, styling the neutral alphabet's, foreign scripts §17.10's); a word with a kelvin, ångström or ohm sign is judged by `analyzeToken` too (`p⟨K⟩ypal` is flagged). Lenient: `analyzeToken` judges what the model does not cover (zalgo, invisibles, styling when the neutral alphabet is off), never a foreign script's mix; a word with foreign letters and nothing to fold is judged whole, so hidden characters are judged by the letters around them (the per-letter exemption of §1).
- **Plan**: a word with neutral, kept or foreign characters is classified once, when it closes, with no context. Each position is core, converted (a neutral character or digit look-alike written as its base in the core before judging), following (written in the word's alphabet after judging), kept (as written) or foreign. A mark goes with the character before it. The output is rebuilt by position: each core or converted position takes its own units of the core's output (a unit is a character with the marks and invisible characters after it); when the core's output has another number of units the word stays as written.
- **Kept letters** (with the neutral dictionary on): a letter outside the model and the dictionary of script Common or Inherited (`ـ`, `ー`, `ℏ`, `ℹ`, a math letter under math switch 1) is kept; the rest of the word is judged.

### 17.7 Neutral dictionary

`neutralAlphabet` (on by default with `hiddenChars: 'strict'`, off otherwise). `neutralInfo(cp)` gives each character one category, its base and the base's script, and `standalone` (converted alone; the category's default):

| category         | members                                                                                                                                                                                                                                                                           | alone     | in a word                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | spoof                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `visibleStyle`   | circled, parenthesized, squared letters (`ⓐ ⒜ 🄰`), negative squared and circled letters (`🅰 🅐`), regional indicators used as letters (`🇦`; a flag pair stays), letter pairs (`🄭 🄮 🅊–🅏`); letters whose compatibility form is ASCII letters (fullwidth `Ｐ`, ligatures `ﬁ` → `fi`) | kept      | follows the word's conversion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | no                                                                                                 |
| `disguise`       | Mathematical Alphanumeric and Letterlike letters whose form is one Latin, Cyrillic or Greek letter, math Greek; `ϕ ϵ ϑ ϰ ϱ ϖ ϐ ϒ`                                                                                                                                                 | converted | converted before the word is judged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | yes                                                                                                |
| `sameReading`    | U+2160–2188 with an ASCII form (`Ⅱ` → `II`); in a word of another target through its Latin letters' twins (`Ⅹорошо` → `Хорошо`)                                                                                                                                                   | converted | converted before the word is judged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | in a word of a script written with spaces                                                          |
| `separator`      | `№`; `㍻ ㍼ ㍽ ㍾ ㍿`                                                                                                                                                                                                                                                             | kept      | a boundary on both sides                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | —                                                                                                  |
| `tailMark`       | `© ® ™ ℠ 🅪 🅫 🅬`                                                                                                                                                                                                                                                                   | kept      | joins the word before it and ends it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | —                                                                                                  |
| `unit`           | `ℓ ℃ ℉`, U+3371–33DF and U+33FF (`㎏ ㎡ …`) but the rows above and below, `㋌ ㋍ ㋎`                                                                                                                                                                                              | kept      | at its end kept; at its start or middle it follows and the word call has it (`aℓl` → `all`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | no                                                                                                 |
| `wordSign`       | `℡` → `TEL`, `℻` → `FAX`; English word abbreviations as NFKC writes them (`㏂ ㏘ ㏇ ㏒ ㏑ ℅ ℀ ℁ ℆ ₨ ㉐ ㋏ 🆐`); a separate word stays in Latin letters, inside a word of another target through its Latin letters' twins                                                           | converted | converted before the word is judged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | touching anything but a separator, a digit or a spaceless letter                                   |
| `unitPrefix`     | `µ` (category 8)                                                                                                                                                                                                                                                                  | kept      | at the word's start or right after its digits (`5µm`) kept when the rest is a unit of the unit list (`sec m s g l ℓ L A V W F H K J N Pa Hz mol M Ω Sv Gy cd lm lx Wb T C bar in S Bq eV rad sr Ci Torr atm cal Da kat b ohm`, digits or a power after it) or nothing, the rest judged without it; otherwise, and elsewhere, `u` (Latin), `μ` (Greek; a Greek word too: `µε` → `με`); no replacement in a Russian or Ukrainian word (kept). The Greek letter `μ` directly before a unit of the list is a unit prefix too and stays (`μs`, `5μm`, `μℓ`; a dash part too: `μs-pulse`); the list holds `sec` too (`µsec`, `μsec` stay) | elsewhere: yes                                                                                     |
| `japaneseSquare` | `㍵` oV, `㏍` KK, `㏚` PR                                                                                                                                                                                                                                                         | converted | converted through its Latin letters                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | outside Japanese text: no letter of a spaceless script in the word or its nearest words; alone too |
| `undecided`      | none left                                                                                                                                                                                                                                                                         | kept      | joins an open word, kept                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | —                                                                                                  |

- **Not neutral**: the long s `ſ` and the lunate sigma `ϲ Ϲ` (ordinary donors); the unconverted classes (modifier letters `\p{Lm}`, `ª`, `º`, U+2070–209F); canonical duplicates (kelvin, ångström, ohm signs are `K`, `Å`, `Ω`); letters of real scripts (look-alikes are donors, §17.8); `𝚤` and other math forms whose base is no target letter.
- **Following** under the language model: written in the word's language — the resolver's language, else the language of the core's letters — as the base when the base is one of its letters, else through the base letter's same-case twin; with no twin as written. Under the Latin-fold model following characters are written as their base before the word is judged.
- **Words of following characters only**: written in a requested language all of them map into — a language of the alphabet their own letters share, else the context's language (both nearest words', else the window's), else the requested languages in request order (`ⓐⓑ` → `ab`, `toLang: 'English'`).
- **Per-language rule for neutrals and donors**: a neutral or styled character inside a word, a donor folded inside a one-script word (`það` → `pað`), a neutral suffix run and a one-letter affix test take twins only from the word's language: the first requested language, in request order, holding all the word's letters and taking every such character (a resolved word: the language it was folded into). No Ukrainian letter goes into a Russian word: `былⓘ` keeps `i` (reported), `сьогоднⓘ` → `сьогодні` (shared letters fit Ukrainian). A same-script pair and the case-anomaly fold within a script are per language too. The dominant script (`breadth`) and the nearest-word selection (`voteOf`) stay by script: they serve the Latin-fold model's token judge, and donor-script contexts outside the target languages (digits of other scripts); no target choice reads them.
- **Spoof**: the word gets `confusable_word` when its conversions are a spoof by the table; any other conversion goes to the word callback with no signal.
- **Math switches**: `keepMathLetters: true` leaves the disguises out of the dictionary and does not judge a word whose letters are math letters, or math letters and Greek (`ℎν`, `𝑘𝑇𝜈`); a math letter in any other word is kept and the rest judged. `hiddenCharRules.invisibleMathOperators` (absent: `otherInvisibles`) is the rule of U+2061–2064, report kind `invisibleMathOperators`. Math switch 3 (`mathTarget: true`, off by default and not part of strict's defaults): a Math target language written with Latin, Greek and math letters plus `µ` and `ℓ`; such a word is native to Math and stays as written (`ρσ`, `xℓ`, `𝑘𝑇𝜈`), one mixing Latin and Greek is `mixed_legitimate` (`αFβγ`, `cosβcosα`), not a spoof.

### 17.8 Look-alike packs

- **Packs**: one directional map per target language, donor → target letter. `defaultPacks()` per language: the twin table's pairs into its letters (each twin pair both ways), `ı` → `i` for the target languages of Latin letters (an intra-Latin fold applies only if every letter of the folded word, accents included, is in one such target language: `lınk` → `link`, `ışık` stays), and the reviewed donor rows (177 rows in `src/data/`; Latin target letters into English, Cyrillic ones into Russian, `Ћ` into Serbian, Greek into Greek).
- **Requested targets only**: every choice reads the call's `targetLanguages` with every applied pair change (`add`/`remove`, additional packs, conditional twins): target choice, legitimacy (a whole-script word fits a requested language of its script; `сір` with English+Russian is evidence, legitimate once Ukrainian is requested), proof letters (a foreign letter is evidence only with a twin under the call's mapping), the palochka digraph (only with a requested language that has it), Latin-extra donors (a European letter is a donor only when European is not requested and it has a twin among the requested Latin letters: of `þ ð ß æ œ ø ł đ ı` that is `þ` → `p`, with `ı` → `i` the English pack's own pair; `ð ß æ œ ø ł đ` have none and stay Latin letters; a one-script word no requested language takes whole folds its donors and keeps the rest: `það` → `pað`), the window and nearest-word votes (only requested languages), case-anomaly folds into `l` (only when a language of Latin letters is requested), Russian apostrophe endings (only when Russian is requested), "holds a target letter" the target characters of the donor context and the affix suffixes (full lists, judged under the mapping). Under the language model the UTS #39 skeleton folds no word: the resolver alone does. A neutral converts to its plain form (English letters), and inside a word of a requested target continues through the effective twins into it (`пⓐпа` → `папа`; with `а` removed from the Russian pack, `пaпа`). Unrequested languages and the base twin table are used only to build data; digit readings stay shared. Orthography rules restrict the candidate targets a fold may go to; they are not enforced on text (`paᏏy` is no Russian or Ukrainian `раЬу`); a whole word of a requested language that breaks one is no evidence and stays (`σσ`, `προσ`); case-anomaly evidence is no language rule and stays. A mixed word converts only into a requested target that already holds one of its letters (with `targetLanguages: ['Greek', 'Ukrainian']`, `ΠI` → `ΠΙ`, never `ПІ`); with none of its letters in a target (`ᎪᏢᏢꓡꓰ`) every target that takes it is a candidate; with no candidate left the chunk rule decides. Word majority decides a mixed word only with at least `ladder.wordMajorityMinLetters` (3) letters of the leading alphabet and `ladder.wordMajorityMinShare` (2/3) of the word's letters (a word of two requested languages does not reach this step: with English and Russian requested `сoр` is corrected by pieces to `сор`; with `targetLanguages: ['English']` it is `cop`). Several targets and no context or majority: the primary target, else the next requested one, by an order built once with the model (the lunate sigma `ϲ` alone: `c` with English first, `с` with Russian first).
- **Same-script pairs**: a pair may map a letter into a target of its own script when it is outside the twin table (`ı` → `i`, `ſ` → `s` in English, `ϲ` → `σ`, `Ϲ` → `Σ` in Greek); such a word folds within its script by conditional evidence when every folded letter is in one requested language of it (Latin with accents, other scripts by NFD base). The lunate sigma's other pairs are ordinary (`c`/`C` English, `с`/`С` Russian and Ukrainian), as is every fold of these donors: a spoof (`ſecure` → `secure`). Loop guard: a pack never maps a letter of its own language as a donor (European's pack has no `ı` → `i`). The table pair `ſ` → `f` is replaced in English (`REPLACED_TABLE_PAIRS`). No Greek final form is chosen (`λογοϲ` → `λογοσ`).
- **Additional packs**: the conditional twins of §3.3 by id (default `χ~x`, `χ~х`, `ҳ~x`, `ҳ~χ`; `ı~i` is also a default pair) and `optional` (pairs judged optional: `𐔓` → `n`, `𐊖` → `s`, `𑣬` → `X`, `𑣥` → `z`, `𑣜` → `γ`), off by default.
- **Builder**: `buildLookalikes({ additional, add, remove })` builds a configuration once (cached by its content); `analyze` takes it as `lookalikes`; the default is `defaultLookalikes()`. `add` and `remove` take pairs per target language, so any pair can be changed in either direction. `conditionalTwins` is read as `additional` when `lookalikes` is absent.
- **Rules**: packs hold pairs only; language letters and orthography stay with the target language (§4.4–4.7).
- **Donor alphabet**: letters, digits or marks of scripts outside the twin table that an enabled pack maps form the model alphabet `Donor`, never a fold target. A donor folds only with its whole word: in a word with a letter or digit of its own script that has no mapping it is that script's writing (`שלום`, `باA2DP`, `۱۵`).
- **Case**: a donor without letter case folds to the case of its target, in a lowercase word too (`pꓮypal` → `pAypal`); a pair given in a pack (reviewed rows, added pairs) keeps its case (`Ⳝ` → `δ`); the caseless cap-height strokes (`CASE_STROKES`: Lisu `ꓲ`, Latin `ǀ`, `ߊ ᛁ ⵏ 𐊊 𐌉 𐌠 𖼨 𞣇`, Arabic alef `ا`) read English `I` between two uppercase letters, between one and a word edge, or alone (`ꓲ am` → `I am`; the Latin `ǀ` too, though a lone letter of an alphabet otherwise needs evidence); at a word's start before lowercase, `I` when one or two letters follow (`ꓲf` → `If`), else `l` (`ꓲike` → `like`; a word start is the text's start or a separator, not an inner apostrophe, dash or digit: `we'ꓲl` → `we'll`, `5ꓲb` → `5lb`); `l` otherwise (`ꓡꓲꓢꓔ` → `LIST`, `ꓲNFO` → `INFO`, `pꓲxel` → `plxel`, `Aꓲb` → `Alb`). Vav `ו` reads `i` only (too low for `l`); final nun `ן` and the slanted digit ones `١` `۱` read `l`; `ǀ` has no `i` reading. Real text: 377 lone strokes (all in Arabic text), none converted.
- **Digits of other scripts**: a digit of a script other than Common with no mapping is outside the model; in a word it stays as written, out of the core, and is placed like a foreign letter (`pa١pal` is `mixed_script`).
- **Digit look-alikes**: the reviewed set (`ꛯ Ϩ Ⲝ Ⳅ ३ ૩ 𖼻 𑣊 𑢯 𑢻 Ꮾ Ϭ 𑣕 𐓒 𑣆 ୨ ৭ ⳋ ੧ 𑢬 𑣌`), `Ꮞ` → `4`, `৪` → `8`: a class of the word phase, converted to the digit before the word is judged, alone too, and a spoof (`error Ꮞ04` → `error 404`). With the language model or the neutral dictionary; not on the default path.
- **Context of donors**: a donor in a word with no target character (for a digit look-alike: no target letter, no ASCII digit) stays when a nearest word on either side is its own script. By language too: a word whose letters, donors and plain letters alike, all belong to one unrequested language stays as written when a nearest word on either side is of that language, or one such language holds more letters of the window than all its other voting words together (per language, never merged); a word votes as converted (`read the ВООК НОТ now`: `BOOK` is English, so `НОТ` folds too), and a word with a letter of a requested language votes for that language only. Such a kept word gets no report when both nearest words share its language (`выполняет их по порядку`); otherwise it is kept and reported as `whole_word_lookalike` (e.g. `pay via Рау сейчас`: a foreign-phrase edge, or a word kept by the window alone) (`по` in Russian text with only English requested; `new`, `on` in English text with only Russian requested); a word with a letter of a requested language is not affected (`раураl`, and `НОТ` in English text, still fold). A digit look-alike also stays next to another character of its own script in the word (`१९३५`); Arabic-Indic digits count as Arabic. A donor converts standalone (one donor letter folds). A word only one target can take folds into it, whatever the context; several targets and no context target: the primary target (first of `targetLanguages`). A multi-target donor follows the word's target (`Ϭ` → `б` in a Russian word, `6` otherwise). Turkish `ı` stays when its word or a word of the context window holds `ğ`, `ş` or `İ`.

### 17.9 Per-script table

`src/scriptinfo.ts`: one table, each script with independent properties — `spaceless` (Thai, Lao, Khmer, Myanmar, Tibetan, Han, Hiragana, Katakana: the word-break hint's scripts, the context of lone styled letters) and `recommended` (UTS #31 Recommended Scripts) with `HIGHLY_RESTRICTIVE` (the UTS #39 sets with Han), read by `moderatelyRestrictive`.

### 17.10 Foreign scripts (language model)

- Letters are target or donor (in the model), neutral, or foreign: a letter outside the model of a real script (not Common or Inherited), and a digit of such a script with no mapping. Marks on a foreign letter go with it.
- A word's script set (target, donor and foreign letters; Common and Inherited left out) is checked against UTS #39 Moderately Restrictive (`moderatelyRestrictive`); how the word is reported is by category (below). There is no placement option.
- Foreign letters are never folded: the core is resolved and folded, the foreign letters are written back as they were (`pаypal用` → `paypal用`). The core alone votes as context.

- **Categories** (language model): a word holding a target letter and letters of two scripts or more (as written, its neutrals as their letters) carries one of `mixed_spoof` (look-alikes in it were converted, a spoof), `mixed_legitimate` (one requested language's letters, the rest written without spaces, or a UTS #39 Highly Restrictive set: `Smith는`; not a spoof) or `mixed_non_legitimate` (otherwise: spaced scripts glued, nothing converted; reported, not a spoof) in place of `mixed_script`. The categories appear in `signals` only when set; the default path reports `mixed_script`. The Moderately Restrictive set does not decide a spoof. The categories only add: a word of look-alikes of two scripts or more with no target letter as written is judged by its output when folded (`ᎪᏢᏢꓡꓰ` → `APPLE`, `mixed_spoof`), and is `mixed_spoof` when kept as written (`wholeScriptFold: 'off'`).
- **Mixed words**: detection, correction and reporting are separate stages. Pieces are runs of letters of a single alphabet; borders are where two pieces touch on screen, in the display order of the Unicode Bidirectional Algorithm (UAX #9, `src/bidi.ts`, Bidi_Class from the UCD via `scripts/generate-bidi-classes.py`; run only for a word holding a right-to-left character) with the paragraph's direction (its line's first strong letter); a dash, apostrophe, digit or other non-letter between them is no border. A word is detected when a border letter has a twin in a requested language the other side is written in (the languages holding all the word's requested-language letters of that side's alphabet: in `мыiр` the `р` side is Russian, as `ы` is; never another language of its alphabet), checked both ways; affixes do not exempt detection. Correction: a one-letter piece that is not the last on screen, or a piece of any length between two pieces, whose letters all have twins in a language a glued neighbour is written in, converts (marks kept, composed where Unicode composes them), and only toward the side whose alphabet holds more of the word's letters (`Cпросите` → `Спросите`, `pаypalя` → `paypalя`, `gооgle.com` → `google.com`, a spoof); first and last multi-letter pieces stay report-only. Everything else detected is reported, `mixed_non_legitimate`, not converted (`timея`, `ЮKassa`, `Пersona`, `importancем`, `раураl`). With `hostileInput` a last one-letter piece converts too (`Applе` → `Apple`). Scripts that touch only across a separator form no mixed word (`iPhone'ах`). An `x`-like letter (`x`, `х`, `χ` and other donors of `x`; a styled, fullwidth or math `x` too; a subscript or modifier `x` never: `2ₓ3` stays) between two numbers (runs of decimal digits of any script and digit look-alikes; after hidden-character removal) is written `×` before the word is judged, and the word is then judged as usual, its digit look-alikes and digit readings included (`৪x৪` → `8×8`, `10x1০` → `10×10`, spoofs). Blocked by a letter (a neutral letter too), a dash (the Unicode Dash property: `-`, `–`, `−`) or a connector (`\p{Pc}`: `_`, `＿`) right before the first number, a dash or connector right after the second, and a first number that is one digit of value zero (`0x1F`, `０x1F`, `a1x1`, `H264x265`, `mixtral-8x22b`, `mixtral–8x22b`, `4x4_drive` stay; `200x200px` converts). The word callback names the word as phase 1 output it; a donor written `×` alone is a non-spoof conversion (`300х300пкс` → `300×300пкс`); an English `x` alone is normalised without a call (`1920x1080` → `1920×1080`). Digits are ignored at a border: letters on both sides of them touch, and pieces count as if the digits were absent (`а1admin` → `a1admin`; `admin1а`, `Win11Рго` reported). The last piece is the last in the word's own reading order (the one holding its last letter as stored; a word with no right-to-left letter: the rightmost). A paragraph ends at CR, LF, U+2029, NEL and FS/GS/RS; its direction is its first strong character, isolates skipped. Whole words beside their own language: a whole word of a requested language's letters is not folded by context (nearest words or window) when a nearest word on either side (numbers skipped) is a clean word of its own language (wholly its letters, taken whole by no other requested alphabet); it is reported in its own category `whole_word_lookalike` (not a spoof; kept as written), not converted (`сап` beside `спасибо`); `ВООК НОТ` both fold in English text. HTML character references (`&nbsp;`, `&amp;`, `&#160;`, `&#x41;`; the full HTML5 named list with `;`, the 106 legacy names and numeric references also without it, a legacy name without `;` only when no `=`, letter, mark or number of any script follows (`&section=1`, `&regionCode=mde`, `a&copyжурнал`, `&copy²` stay text; option `htmlNamedReferences: 'strict'`: names only with `;`, numeric references unchanged), as the HTML tokenizer reads text content; the attribute-value exception is not applied to plain text; numeric with any number of leading zeros, U+0080–009F as Windows-1252, zero, a surrogate or past U+10FFFF as U+FFFD) are decoded once, before phase 1, in strict mode under the language model (`src/references.ts`): every phase-1 rule and the word phase read the input with each reference replaced by its character, so a reference behaves like the raw character in every rule (hidden characters, bidi spans, mojibake, word boundaries, the neutral and digit rules; `p&#1072;ypal` → `paypal`, `pay&shy;pal` → the soft-hyphen report, `Hello&lt;сор&gt;world` → `cop`). Positions and text map back to the input: every report, region, record and word call gives input positions (records join to the output: each record is written as the output is, a record holding a reference without `;` waiting until what follows is known), and an `extracted` that is the reported characters gives them as written. Each reference is also reported (`htmlReference`, `extracted` as written). The output keeps a reference as written unless its character changed (a word's text it shares with the input at both ends is written as the input has it: `C&#1087;росите` → `С&#1087;росите`, `уда&#1088;éние` → `уда&#1088;е́ние`); a reference without `;` is written decoded where what follows it in the output would extend it or end it with `;` (`a&copy⟨SHY⟩x` → `a©x`, `&#1072⟨SHY⟩;` → `а;`), and of such references in a row one written decoded decodes those before it that it would extend (`&copy&#x35⟨ESC⟩[0mbi` → `©5bi`), so the output reads as the input's references did. The one difference from the raw characters: letters a reference encodes cast no vote, and a word of references only is no word for that neighbour test. Words of two requested languages: a word (per dash or apostrophe part; styled and math letters are no letters of a requested alphabet) holding letters of two or more requested languages (no one requested language holds all its requested-language letters; Russian and Ukrainian count as two) is corrected by pieces only, never by whole-word mapping; other words keep whole-word mapping (one language, donor-only, donors of unrequested languages), and the piece rules follow when they are not converted whole. Stress: a Latin precomposed stressed vowel inside a Russian word takes its base's Russian twin with the combining acute (`замóк` → `замо́к`).
- **Affixes** (prefix–body–suffix): an affix is written in one script, all its letters in one requested language of it (its letters may have twins elsewhere: `IP-`, `HTTP-`, `α-`). A suffix is the last chunk on that language's grammar list; a one-letter suffix with a twin in the body's language needs a dash or apostrophe to set it off (`iPhone'а`; glued `Applе` is none). Dash and apostrophe parts are separate words. No prefix lists exist: a prefix applies only when a dash sets it off, stands first, is shorter than the body, the word holding no other dash before the suffix (`жtimе`, `ЕЦChatGPT`: no prefix). Affix logic applies only when the affix's language differs from the body's (the body's letters of the affix's script do not all fit it; `Wi-Fi`, `кое-кто`, `dедnoted` have none). Affixes keep their letters (the piece rules do not convert them) and are what `affixSeparator` sets off; a word the piece rules correct into one alphabet has none (`ударéние`). By default the whole-word conversion comes first and the affix logic only for a word not converted whole; with `affixSeparator` the affix logic comes first.
- **One splitter, RTL awareness, styled dash parts**: the affix rules split a word into pieces as the mixed-word rules do (on-screen order, digits ignored: `iPhone12ах` keeps its suffix test); a right-to-left word's suffix is its last piece in reading order. `rtlAwareness` (default true) is the switch for on-screen order in both; off reads stored order. A lone styled letter (neutral `visibleStyle`) that is a dash part of a token with letters elsewhere is part of the word, as glued: the token is judged as its unstyled form, so its language comes from outside the token (`ⓟ-ривет` in Russian text → `р-ривет`, as `p-ривет`) and its category is the unstyled form's (`ⓜ-сервер` → `m-сервер`, no signal, as `m-сервер`; `ｉ-phone` → `i-phone`, no signal). Math letters, Roman numerals, units, separators and marks in dash parts keep their own rules (`ⓘ-𝐩hone` → `i-phone`, a spoof; `ⓐ-5`, `µ-op`, `ℓ-bottle` stay).
- **`affixSeparator`** (option, default undefined): a string inserted between a real unseparated suffix and the body; the affix stays as written and is no spoof (`в Windowsах` → `в Windows-ах`). An affix already set off by a dash or apostrophe keeps its own separator. With `''` a word kept by its affix is unchanged and not reported.
- **`oneLetterDashAffix`** (setting, default none; names checked like `targetLanguages`): the requested languages whose one-letter dash prefix with a twin in the body's language is an affix, in every mode (`affixSeparator` included). Off for every language by default: the letter is part of the word, the parts are judged as one word, and it converts (`Р-aypal` → `P-aypal`, `π-калибровка` → `п-калибровка`, spoofs). A one-letter end part converts whatever the setting unless it is on a suffix list (`plan-В` → `plan-B`); a one-letter part read in a listed suffix's language makes no affix (`В-est` → `B-est`, a spoof). Marks stay with their letter (`е́-mail` → `é-mail`). A Roman numeral part on a word of a script written with spaces is a spoof (`ⅰ-phone`). A neutral that reads as a letter (`ⓐ`, `ⅰ`, `𝐨`) next to a dash joins the token too (the word call names the whole token, `ⅰ-phone`).

### 17.11 Behaviour summary

- `cleanHidden` returns the text; marks, regions and records go to the callbacks
- no decoding: `extracted` is the input's characters
- seam rule on (strict)
- possible ligature break, a silent kind
- zero-width run threshold 2 (strict)
- strict `analyze` runs the escape-sequence parser (no backspace erase); each removed sequence a finding
- stacked marks only through phase 1
- neutral dictionary on in strict; categories decide conversion and spoof
- foreign scripts and digits of other scripts; categories in place of `mixed_script`
- look-alike packs (reviewed donor rows, `ı` → `i`, digit look-alikes, digit readings)
- the long s reads `s` on every path, the default one too (`ſecure` → `secure`; UTS #39 lists `f`)
- requested targets and the call's pairs only; language rules only narrow targets
- chunk rule and affixes for mixed words of spaced scripts
- mojibake reported in phase 1; non-breaking spans; phases 2 and 3
- word cap of 250 code points, with `hiddenChars: 'strict'`, the language model or `neutralAlphabet`
- one context window, paragraph-bounded; one nearest-word definition
- a supplement selector valid only if the IVD registers it for its base
- U+009B before a letter is cp1252 `›`, not a CSI (`src/terminal.ts`)

### 17.12 Tests

- Rules: a block per rule and per defect (`test/finding-callback.test.ts`, `test/neutral-dictionary.test.ts`, `test/lookalike-packs.test.ts` and the rule tests beside them), asserting outputs.
- Corpus (`test/corpus.test.ts`): the score per option set is printed as a measurement (§7).
- Resolver (`test/resolve-parity.test.ts`): for words decided as a whole, the resolver of `src/` equals the stand-alone resolver (`scripts/prototype-resolve.mjs`) under every `wholeScriptFold` mode, in three groups with their own floors: the synthetic probe sentences, the corpus (the fixture inputs as they are and a 512 KB benchmark text built from them) and the 1 MB realistic text. Words of two requested languages (corrected by pieces) and whole words kept beside a word of their own language are outside that comparison and have tests of their own.
- Parser (`test/vtparse.test.ts`): one test per transition rule and a 2 000-string property test; `scripts/fuzz-vtparse.mjs` against xterm.js (§16.1).
- Performance guards (`test/performance.test.ts`): linear phase 1 on dense removals, emissions, backspace floods, backspaces over sequences and unterminated strings; one long token of mojibake or regional indicators is linear.

### 17.13 Performance

Measurements: [performance.md](./performance.md). What the cost consists of:

- Strict + language: the neutral dictionary, digit look-alikes, digit readings and pack donors are table lookups per code point until a word needs its plan; a word is classified once. The mojibake pre-pass is one scan with a byte table per code page.
- `analyze` default: on the dense text the cost is the per-letter exemptions with the nearest-letter scripts and the emoji-sequence lookup.
- The output sink concatenates its first 1 024 pieces, then joins pieces every 1 024; ring slots by bit mask; no per-word allocation for skip mode or the judge's flags.
