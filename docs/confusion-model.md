# Confusion model: per-alphabet word resolution and hidden-character counters

Design for two changes to `@moderation-api/unicode-spoofing` (fork base: upstream `df35416`, v0.4.0):

1. Replace the Latin-only fold of mixed-script words with an explicit per-alphabet **confusion model** that works out which alphabet a scrambled word is really written in, and folds toward that alphabet.
2. Tighten **hidden-character cleanup** to a fixed rule set and add **removal counters** plus **decoded payloads** to the result.

On top of them: the **hidden-content list** and the `remove-with-content` action (§18), and what this library can and cannot judge of text rendered over other text (§19).

Prototypes (plain Node ≥ 20), all run against the checked-in UTS #39 17.0.0 data:

| script                                | what it does                                                                                                                                                            |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/derive-confusion-table.mjs`  | derives the twin table from `src/data/confusables.generated.ts`, applies curated overrides, prints the tables in §5 (`--raw` skips overrides, `--json` dumps the table) |
| `scripts/prototype-resolve.mjs`       | the per-word resolver of §4; prints §6                                                                                                                                  |
| `scripts/prototype-cleanup.mjs`       | hidden-character cleanup + counters + payload decoding of §7; prints §7.3                                                                                               |
| `scripts/prototype-corpus.mjs`        | scores upstream and the fork pipeline on the `cases.json` corpus; prints §8 (imports `dist/`, so run `pnpm build` first)                                                |
| `scripts/measure-digit-pairs.mjs`     | renders digit/letter glyph pairs in 8 fonts (method of §9) → `docs/evidence/digit-pairs.json`, `digit-words.png`; evidence for dropping digits (§9.4)                   |
| `scripts/measure-false-positives.mjs` | false positives of foreign-letter, case-anomaly and positional-rule evidence on token lists, dictionaries and real files (§4.4–4.6)                                     |
| `scripts/measure-bidi-spans.mjs`      | what Chrome shows for 50 bidi samples → `docs/evidence/bidi-spans.json`; `test/hidden-content.test.ts` holds the span definition of §18.2 against it                    |
| `scripts/measure-mark-stacks.mjs`     | how far stacks leave their line and cross the neighbours, by script and depth, against real text → `docs/evidence/mark-stacks.json`; evidence for §18.6                 |
| `scripts/measure-overlap.mjs`         | overlap samples in Chrome (4 fonts) and through a tmux pane, with what the rules do to each → `docs/evidence/overlap.json`, `overlap.png`; evidence for §19             |

They are the reference behaviour of the implementation in `src/` (§17); `test/resolve-parity.test.ts` and `test/hidden.test.ts` check `src/` against them.

## 1. Current behaviour

| concern                       | where                                                 | behaviour                                                                                                                                                                                               |
| ----------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tokenizing                    | `src/analyze.ts:17`                                   | token = run of `\p{L}\p{M}\p{N}\p{Cf}'’`; hyphens split tokens, apostrophes do not                                                                                                                      |
| dominant script               | `src/analyze.ts:451-466`                              | most frequent primary script over all letters in the text; ties go to the first seen                                                                                                                    |
| mixed-script test             | `src/scripts.ts:192-216`                              | a word is mixed when no single script covers all its letters via Script_Extensions; Han+kana, Han+Hangul, Han+Bopomofo are legitimate                                                                   |
| whole-word confusable         | `src/analyze.ts:358-387`                              | single-script word whose UTS #39 skeleton is ASCII; gated on Latin context (`dominantScript === 'Latin'`, any mixed word in the message, or the word is Latin), or on `expectedScripts`                 |
| fold of affected words        | `src/analyze.ts:417-428` → `src/confusables.ts:46-62` | every character goes through `foldChar`, whose target is **always** ASCII; if a character's own prototype is not ASCII its case partner is tried (`К`→`K` lowercased gives `к`→`k`)                     |
| reported skeleton             | `src/analyze.ts:435-437`                              | `WordFinding.skeleton` = UTS #39 skeleton of the raw token                                                                                                                                              |
| invisible exemption by script | `src/analyze.ts:115-138`, `:296`, `:318`              | if any letter of a token is in `FORMAT_CHAR_SCRIPTS` (Arabic, Hebrew, Indic, Thai, …), the **whole token** is exempt from `invisible` and `zalgo`                                                       |
| variation selectors           | `src/analyze.ts:80-82`, `:92-97`, `:301-315`          | `isVariationSelector` covers U+FE00–FE0F and U+180B–180D only; a selector on a letter of a script outside Han/kana/Mongolian is "stray"                                                                 |
| inert zero-width runs         | `src/analyze.ts:149-195`, `:424`                      | a run of ≤ 4 ZWSP/ZWNJ/ZWJ/WJ/BOM with whitespace (or string edge) on both sides is left in `normalized` and not reported                                                                               |
| standalone invisibles         | `src/analyze.ts:514-563`                              | invisible runs outside letter tokens are reported unless a neighbour is `\p{Extended_Pictographic}`, `\p{Me}` or `\p{Regional_Indicator}` (`:47`, `:543-550`)                                           |
| counts                        | `src/analyze.ts:669-674`                              | `{ wordsTotal, wordsAffected }`; `wordsAffected` = number of findings, including standalone invisibles and illegal code points, so it can exceed `wordsTotal` (`test/readme.test.ts:62` asserts 4 vs 5) |

## 2. Problems, with evidence

All rows produced by the built v0.4.0 package (`pnpm build`, `analyze()` from `dist/`).

### 2.1 Fold target is always Latin

| input                                         | `normalized`                   | finding                                 | expected                                 |
| --------------------------------------------- | ------------------------------ | --------------------------------------- | ---------------------------------------- |
| `Пpивет мир` (Latin `p`)                      | `Πpᴎbet мир`                   | `mixed_script`, skeleton `Πpᴎʙeᴛ`       | `Привет мир`                             |
| `Мы пишем Пpивет всем друзьям`                | `Мы пишем Πpᴎbet всем друзьям` | same                                    | `Привет`                                 |
| `ВOДКА` (Latin `O`)                           | `BOДKA`                        | `mixed_script`                          | `ВОДКА`                                  |
| `Kαλημέρα` (Latin `K`)                        | `Kaλhmέpa`                     | skeleton `Kaλn̩μꞓ́pa`                     | `Καλημέρα`                               |
| `GitHub'а` / `GitHub’а` (Russian case ending) | `GitHub'a`                     | `mixed_script`                          | unchanged; legitimate Russian inflection |
| `Ivа’s`                                       | `Iva's`                        | apostrophe U+2019 also rewritten to `'` | `Iva’s`                                  |

Cause: `foldChar` has only one target alphabet. UTS #39 prototypes for Cyrillic/Greek letters that have no ASCII twin are Greek letters (`П→Π`) or small capitals/IPA — 41 of the 202 Latin/Cyrillic/Greek alphabet letters have a prototype outside all three alphabets (`в→ʙ и→ᴎ т→ᴛ н→ʜ м→ʍ к→ĸ η→n̩ ε→ꞓ …`), and `foldChar` falls back to that prototype (`src/confusables.ts:61`). The result is neither the original word nor its real spelling.

### 2.2 Whole-script words depend on letter frequency

| input                           | result                              | note                                                                                                         |
| ------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `НОТ deal today`                | `HOT deal today`, `confusable_word` | Latin wins the letter count                                                                                  |
| `НОТ dog`                       | unchanged, nothing reported         | 3 Cyrillic vs 3 Latin letters; tie goes to the first-seen script (Cyrillic), so `dog` gives no Latin context |
| `НОТ`, `СОК`, `ВОДКА СОК` alone | unchanged                           | correct, but only because the text is Cyrillic-dominant                                                      |

The decision flips on a letter count, not on evidence in the words.

### 2.3 Hidden characters the package lets through

| input                                            | result                                  | issue                                                                                                                   |
| ------------------------------------------------ | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `x` + U+E0110                                    | unchanged, nothing reported             | `isVariationSelector` misses VS17–VS256 (U+E0100–E01EF)                                                                 |
| `h`U+E0151`e`U+E0152`l`U+E0153`lo`               | unchanged                               | one supplement selector per letter = one byte per letter, never seen                                                    |
| `x`U+E0110 U+E0120 U+E0130                       | stripped, reported as `zalgo` only      | supplement selectors are category Mn, so the run is counted as stacked marks                                            |
| `辻`U+E0100 U+E0101 U+E0102                      | `辻`, `zalgo`                           | the valid first IVS is stripped along with the run                                                                      |
| `😀` + 6 tag characters (`ignore`)               | unchanged                               | the standalone pass exempts any run next to a pictograph (`:543-550`), so only real flag tag sequences should be exempt |
| `😀` + VS-encoded `secret`                       | unchanged                               | same exemption; this is the published "emoji smuggling" scheme                                                          |
| `ok 👍` + 8-bit ZWSP/ZWNJ binary                 | unchanged                               | same exemption                                                                                                          |
| `של`U+202E`ום` (RLO inside Hebrew)               | unchanged                               | Hebrew is in `FORMAT_CHAR_SCRIPTS`; whole-token exemption covers bidi overrides                                         |
| `مي` + tag chars + `خ`                           | unchanged                               | Arabic whole-token exemption covers tag characters                                                                      |
| `می` + 5×ZWSP + `خواهم`                          | unchanged                               | Persian whole-token exemption covers a ZW payload run                                                                   |
| `क` + tag char + `ष`                             | unchanged                               | same, Devanagari                                                                                                        |
| `a ​ b` (isolated ZWSP)                          | ZWSP kept                               | inert rule; our rule removes it (silently)                                                                              |
| `a ` + 4×ZWSP + ` b`                             | kept, not reported                      | inert up to 4; our rule counts runs ≥ 4                                                                                 |
| `co­operate` (soft hyphen), U+FEFF at text start | removed **and** reported as `invisible` | our rule removes these silently                                                                                         |

What already matches our rules: ZWSP/WJ/BOM/ZWNJ/ZWJ inside Latin and Cyrillic words are removed and reported; ZWNJ in `می‌خواهم` and `क्‌ष` is kept; emoji ZWJ sequences, the Scotland/England flag tag sequences, keycaps and `❤️` are kept; RLO/isolates without RTL text are removed; RLM inside Hebrew text is kept; `辻`+single IVS is kept; NBSP/thin space are untouched.

## 3. The confusion model

### 3.1 Data

For each **model alphabet** — Latin, Cyrillic, Greek, plus Armenian, Cherokee and Coptic to prove the design extends — the model lists, **per letter and per case**, the letters of every other model alphabet it can be visually mistaken for (its _twins_). A letter with no twin in alphabet X is a **proof letter** against X: a word containing it cannot be X in disguise.

| alphabet                   | letters                                                                    | precomposed letters                                                              |
| -------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Latin                      | `A–Z a–z`                                                                  | judged by NFD base: `é` is judged as `e`; the accent is carried through the fold |
| Cyrillic                   | U+0400–045F, `Ґґ`, palochka `Ӏӏ`, `Үү Һһ Әә Өө`, Komi/Kurdish `ԁ Ԍԍ Ԛԛ Ԝԝ` | same (`Ё` = `Е`+U+0308, `Й` = `И`+U+0306)                                        |
| Greek                      | U+0391–03A9, U+03B1–03C9, `ϳ Ϳ`                                            | same (tonos/dialytika decompose)                                                 |
| Armenian, Cherokee, Coptic | the script's letter blocks                                                 | same                                                                             |

Letters of a model script outside these sets (IPA, small capitals, historic letters) are **exotic**: native to their script, twin-less, and left to the existing Identifier_Status rule (`src/analyze.ts:353-387`).

**Core targets.** A letter is only ever folded **into** a core letter: Latin `A–Za–z`, Cyrillic U+0400–045F + `Ґґ`, Greek U+0391–03C9. Komi `ԁ`, palochka `ӏ` and `һ` stay twins as _sources_ (they are favourite Latin lookalikes), but a Latin letter is never folded into them. Without this rule nearly every Latin `l` would read as Cyrillic `ӏ` and stop proving Latin.

### 3.2 Where the table comes from

**Derived from UTS #39, then curated.** Two alphabet letters of different alphabets are twins when their single-letter UTS #39 skeletons are equal. This keeps the table in step with each Unicode security release (same refresh path as `scripts/generate-confusables.mjs`).

How noisy the derivation is, measured on 17.0.0 for Latin↔Cyrillic↔Greek:

- 101 twin pairs derived; 7 are **cross-case** (UTS #39 clusters ignore case: Cyrillic capital `І`/`Ӏ` and Greek `Ι` sit with Latin small `l`; Cyrillic capital `Ь` with Latin small `b`).
- 41 alphabet letters have a prototype outside every alphabet (small capitals, IPA, digits, multi-character: `в→ʙ т→ᴛ н→ʜ м→ʍ и→ᴎ к→ĸ`, `m→rn`, `Ы→bl`, `Ю→lO`, `б→6`, `З→3`). These come out twin-less, which is what makes them proof letters.
- UTS #39 also lists pairs that the visual study (§9) found distinct in every font: `У/Y`, `ү/y`, `α/a`, `ρ/p`, `ι/i`, `υ/u`, `γ/y`, `ν/v`, `г/r`. They stay in the table: the owner's criterion is running text, not side-by-side glyphs (§9.2).

**Case rules.**

- Twins are case-specific: `В`↔`B` is a twin, `в` has no Latin twin; `Т`↔`T`, `т` none; `Н`↔`H`, `н` none; `М`↔`M`, `м` none. `foldChar`'s case-partner fallback (`src/confusables.ts:51-60`) gets exactly this wrong.
- Cross-case pairs do **not** count, except four directional source→target folds that are real lowercase lookalikes: `І→l`, `Ӏ→l`, `Ι→l`, `Ь→b` (`paypaІ`, `Ьank`).
- When a capital sits among lowercase letters, a lowercase twin is preferred (`paypaІ` → `paypal`, not `paypaI`).
- **Italic twins are conditional, default off** (owner): `т`~~`m`, `п`~~`n`, `и`~`u` look distinct and uncanny to a Cyrillic reader upright, but italic fonts render them pixel-identical (§9.1). They are in the per-pair conditional set (§3.3), off by default; words using them (`тail`, `admiп`) are then mixed, not confusable, and left as written.

**Curated overrides** (`OVERRIDES` in `scripts/derive-confusion-table.mjs`, each with its reason in code). Owner criterion: alike in running text, not glyph-to-glyph.

| change         | pair                 | reason                                                                           |
| -------------- | -------------------- | -------------------------------------------------------------------------------- |
| add            | `ω`~`w`              | alike in running text (owner); no UTS #39 entry                                  |
| moved          | `χ`~~`x`, `η`~~`n`   | now descender twins, enabled per pair (§3.3)                                     |
| keep (UTS #39) | `ш`↔`w`, `σ`↔`o`/`о` | alike (owner); derived as-is, no override                                        |
| not added      | `к`~~`k`, `κ`~~`k`   | distinct: Latin `k`'s ascender stands out (owner). UTS #39 sends both to kra `ĸ` |
| not added      | `п`~`n`              | italic-only lookalike (owner)                                                    |

Result: **102** Latin/Cyrillic/Greek twin pairs (101 derived + `ω`~`w`; 7 cross-case), plus the enabled descender twins: **107** with the default set (§3.3).

**Proof letters against Latin** (no Latin twin in that case; a word containing one cannot be Latin in disguise):

| alphabet                    | lowercase                                                  | uppercase                                          |
| --------------------------- | ---------------------------------------------------------- | -------------------------------------------------- |
| Cyrillic (Russian alphabet) | `б в д ж з и й к л м н п т ф ц ч щ ъ ы ь э ю я` (23 of 33) | `Б Г Д Ж З И Й Л П Ф Ц Ч Ш Щ Ъ Ы Э Ю Я` (19 of 33) |
| Greek                       | `β δ ε ζ η θ κ λ μ ξ π τ φ ψ` (14 of 24)                   | `Γ Δ Θ Λ Ξ Π Σ Φ Ψ Ω` (10 of 24)                   |

**Proof letters against Cyrillic / Greek** (Latin letters with no twin there):

| target   | lowercase                           | uppercase                 |
| -------- | ----------------------------------- | ------------------------- |
| Cyrillic | `b d f g h k l m n q t u v z`       | `D F G L N Q R U V W Z`   |
| Greek    | `b c d e f g h j k l m n q r s t z` | `C D F G J L Q R S U V W` |

Proof letters regained by the owner's re-decision (2026-11-04): Cyrillic `к`, Greek `κ η` against Latin; Latin `k` against Cyrillic and Greek, Latin `n` against Greek. Still lost to curated or kept twins: Cyrillic `ш` (lowercase), Greek `σ ω`, and `χ` while the descender pair `χ`~`x` is enabled (default).

### 3.3 Conditional twins: descender and italic (owner decision)

A separate twin class for pairs that look alike only under some rendering: **descender twins** differ from their twin only below the baseline (each such letter has two matching forms, with and without its descender); **italic twins** match only in italic fonts. The caller enables them **per pair** (`conditionalTwins`: a set of pair ids), not by a global console/web mode: `CONDITIONAL_TWINS` in `scripts/derive-confusion-table.mjs`.

| id    | pairs                         | kind                        | default |
| ----- | ----------------------------- | --------------------------- | ------- |
| `χ~x` | Greek `χ` ↔ Latin `x`         | cross-alphabet              | on      |
| `χ~х` | Greek `χ` ↔ Cyrillic `х`      | cross-alphabet              | on      |
| `ҳ~x` | Cyrillic `ҳ` ↔ `x`, `Ҳ` ↔ `X` | cross-alphabet              | on      |
| `ҳ~χ` | Cyrillic `ҳ` ↔ Greek `χ`      | cross-alphabet              | on      |
| `η~n` | Greek `η` ↔ Latin `n`         | cross-alphabet              | off     |
| `ŋ~n` | Latin `ŋ` → `n`, `Ŋ` → `N`    | intra-Latin fold            | off     |
| `ɳ~n` | Latin `ɳ` → `n`               | intra-Latin fold            | off     |
| `и~u` | Cyrillic `и` ↔ Latin `u`      | italic                      | off     |
| `т~m` | Cyrillic `т` ↔ Latin `m`      | italic                      | off     |
| `п~n` | Cyrillic `п` ↔ Latin `n`      | italic                      | off     |
| `ı~i` | Latin `ı` → `i`               | shape, intra-Latin fold     | off     |
| `ҫ~c` | Cyrillic `ҫ` ↔ `c`, `Ҫ` ↔ `C` | descender                   | off     |
| `ɽ~r` | Latin `ɽ` → `r`               | descender, intra-Latin fold | off     |
| `ʐ~z` | Latin `ʐ` → `z`               | descender, intra-Latin fold | off     |

**Default set (owner, final): `χ~x` `χ~х` `ҳ~x` `ҳ~χ` on; `η~n` `ŋ~n` `ɳ~n` `и~u` `т~m` `п~n` `ı~i` `ҫ~c` `ɽ~r` `ʐ~z` off** (`DEFAULT_CONDITIONAL_TWINS`). `ҳ Ҳ` (Tajik, Uzbek) join the Cyrillic model letters for this, so Tajik and Uzbek are added as languages (§4.4) — otherwise every Tajik word with `ҳ` would carry foreign-letter evidence. Intra-Latin folds (`ŋame` → `name`) apply to Latin words like the case anomaly (§4.5), counted as confusable.

**Measurement** (`scripts/measure-descender-pairs.mjs` → `docs/evidence/descender-pairs.json`, `descender-pairs.png`): each pair rendered at 64 px in the 8 corpus fonts with all ink below the alphabetic baseline erased, then pixel-compared as in §9 (identical = 0 differing pixels, near = < 12 %).

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
- `χ`~`x` is **not** a descender twin by this test (0/8): `χ` straddles the baseline, so its upper half is a `v`/`γ`-like fork. It stays on because the owner reads it as `x` (font-dependent: identical in the owner's terminal font).
- `η ŋ ɳ`~`n`: identical in Noto Sans and DejaVu Sans, distinct in the serifs — font-dependent, so off by default.
- Other pairs that come out identical or near in most fonts once clipped (data only, not enabled): `ç`~~`c` (4 identical / 2 near), `Ç`~~`C` (6/0), `ҫ`~~`c` (0/7), `Ҫ`~~`C` (1/5), `ɽ`~~`r` (3/4), `ʐ`~~`z` (3/2); intra-Cyrillic `қ`~~`к` (1/7), `ң`~~`н` (0/6), `щ`~`ш` (1/6). `ç Ç` are already judged by their NFD base (`c` + cedilla mark), so they need no pair.
- Not alike even clipped: `μ`~~`u`, `щ`~~`w`, `Щ`~~`W`, `Ц`~~`U`, `ʈ`~~`t`, `ς`~~`c` (1 near); `ц`~`u` only in the italics.

**Italic twins, corpus effect** (`--modes`): `+ и~u` alone 222/30, no change in pass/fail (`иser` → `user`, `case_dependent-019` still passes). `+ и~u т~m п~n` 220/32: it folds `тail` → `mail`, `admiп` → `admin`, `тime` → `mime`, `нome` → `ноте`, and breaks two legit Russian rows — `Wi-Fi-роутер` → `Wi-Fi-poymep` and `по e-mail` → `no e-mail` (a Russian word made only of Latin-twinned letters folds to Latin through its Latin context). Glyph evidence: §9.1 (`т п и` pixel-identical to `m n u` in both italic fonts).

### 3.4 Targets and donors: N target languages × (N + M) alphabets (owner decision)

The twin table is pairwise across every letter of **N + M alphabets**; folding happens only **into** one of N target languages:

- **Targets** (`targetLanguages`, N; default `English`, `Russian`, `Ukrainian`, `Greek` — owner, final): fold destinations. A word folds into script T only if one enabled target language of T covers every letter after folding (§4.4b). Any language of §4.4 can be added (`Ukrainian`, `Greek`, `Bulgarian`, `Kazakh`, …); `N = 4` is only the default; the prototype measured N = 2 to 4 (§4.4b).
- **Donors** (`donorAlphabets`, M; default: every alphabet no target uses): letters that may appear as lookalikes — substitutions in a word, and evidence (§4.4) — but are never fold targets. With the default targets: Armenian, Cherokee, Coptic, the Latin extras below, and the letters of target scripts outside every target language (Macedonian `ѕ`, Serbian `ј`, Caucasian `ӏ`, Komi `ԁ`, Greek `ϳ`). For an English + Russian reader Greek and Ukrainian `і ї є ґ` would be donors too. A donor alphabet left out of `donorAlphabets` is outside the model (its words go to the existing path).

**Latin extras** (`LatinExtra`, new donor alphabet in `scripts/derive-confusion-table.mjs`): Latin-script letters of Latin-1/Extended-A/B (U+00C0–024F, non-decomposing), IPA (U+0250–02AF) and phonetic small capitals (U+1D00–1D2B, `ꜰ ꜱ`), kept when UTS #39 gives them a twin in another alphabet, plus a curated small-capital set (`ᴀ`→`a`, `ʙ`→`b`, … `ᴢ`→`z`: they read as the lowercase letter at x-height; UTS #39 maps most of them to themselves). In a configuration, a Latin extra is a donor only if it has a twin among the target Latin letters and is not a letter of a modelled European language (`ı þ ð ß æ œ ø ł đ` stay ordinary Latin). Default donors: `ſ ƍ ƒ Ɩ Ʀ ƽ ƿ ǀ ɑ ɡ ɢ ɣ ɩ ɪ ɯ ɴ ʀ ʋ ʏ ʙ ʜ ʟ ᴀ ᴄ ᴅ ᴇ ᴊ ᴋ ᴍ ᴏ ᴑ ᴘ ᴛ ᴜ ᴠ ᴡ ᴢ ꜰ ꜱ`.

- Measured: with `ı` and `þ` as donors, `legit_latin-003` `İstanbul'da ışık` → `işik` and `legit_latin-007` `þorn` → `porn` (both must_not_flag) fail; hence the European-language exclusion. Owner, final: `ı` is not a donor but a conditional twin `ı~i` (§3.3, default off; on: `Lınkedin` → `Linkedin`, and `legit_latin-003` fails, 223/29); `þ` stays out entirely.
- A word made only of donor letters of no language (`ᴀᴅᴍɪɴ`, upside-down text) carries donor evidence and folds through the ladder: `ᴀᴅᴍɪɴ` → `admin`. Whole words of a donor _language_ (Armenian, Greek by default) follow the whole-script rule (§4.3): folded only with context.

**Table sizes** (UTS #39 17.0.0 + curated + default conditional twins):

| alphabet   | letters | role (default config)                                                                 |
| ---------- | ------- | ------------------------------------------------------------------------------------- |
| Latin      | 52      | target script (English: 26 letters × 2 cases)                                         |
| Cyrillic   | 103     | target script (Russian + Ukrainian: 35 bases); the rest donors                        |
| Greek      | 51      | target script (Greek: 25 letters)                                                     |
| Armenian   | 76      | donor                                                                                 |
| Cherokee   | 172     | donor                                                                                 |
| Coptic     | 114     | donor                                                                                 |
| LatinExtra | 82      | donor (41 in the default config, list above)                                          |
| **total**  | **650** | **643** twin pairs with the default conditional set; 107 of them Latin/Cyrillic/Greek |

Pairs per alphabet pair: Coptic–Cyrillic 52, Cyrillic–LatinExtra 52, Coptic–LatinExtra 48, Cherokee–LatinExtra 47, Cherokee–Cyrillic 45, Latin–LatinExtra 44, Cyrillic–Latin 43, Coptic–Greek 41, Cyrillic–Greek 37, Cherokee–Latin 35, Cherokee–Coptic 32, Greek–LatinExtra 29, Greek–Latin 27, Cherokee–Greek 24, Coptic–Latin 24, Armenian–LatinExtra 17, Armenian–Latin 14, Armenian–Cyrillic 10, Armenian–Greek 8, Armenian–Coptic 8, Armenian–Cherokee 6. Visual evidence for the donor pairs: §9.1 (Armenian `ս օ հ ո` identical to `u o h n` in DejaVu Sans only; `ɡ`≈`g` in sans fonts; Cherokee distinct in every font) — the derivation keeps UTS #39's pairs regardless, as for Latin/Cyrillic/Greek (§3.2).

**Corpus by donor set** (`--modes`): no donors 214/38 (Greek spoofs like `Αpple`, `ρaypal` stop folding: Greek is a donor, not a target), Armenian + Cherokee + Coptic + Greek 222/30, + LatinExtra (default) **224/28** — `ᴀᴅᴍɪɴ` → `admin` (`mixed_script-020`) and the upside-down `styled-011` (flagged as mixed) newly pass.

**Real text** (Markdown scan, 5.83 M tokens, this repo and the test corpus excluded; every non-ASCII token judged alone): 25 occurrences, 13 distinct tokens change. 17 are genuine mixed-script tokens folded correctly (`busіnеss`, `Αpple`, `pɑypal`, `аll`, `liаbility`, `Haимeнование` → `Наименование`); 8 are false positives: the IPA transcription `ɡɪ` → `gi` (3) and a mojibake string (`Î²î²ðì²Ì`, case anomaly, 5 — counted in §4.5 already).

## 4. Resolver algorithm

### 4.1 Steps

Per text:

1. **Tokens.** Tokenize as upstream. **Apostrophe endings:** if a token is `<stem with a Latin letter>` + `'`/`’` + 1–3 Cyrillic letters that form a Russian case ending, the stem is judged alone and the ending is kept as written. Endings (`RU_CASE_ENDINGS`): `а я у ю е и ы ом ем ём ой ей ою ею ов ев ёв ам ям ах ях ами ями`. Anything else is judged as one token, so `pаypal’ѕ` is caught. Hyphens already split tokens (`Docker-контейнер`, `Wi-Fi-роутер`).
2. NFD each token into base letter + marks. If any letter is outside the model (Han, Arabic, …) the resolver does nothing and the existing path decides (`AI技術`, `日本語のtext`).
3. For every model alphabet T: T is **valid** for a word when every letter is native to T or has a same-case (or allowed cross-case) core twin in T. Letters with no twin are the **blockers**.
4. **Internal evidence** of a single-script word against its own script: a lookalike letter outside every language of the script (§4.4), an I-shaped final letter after lowercase letters (§4.5), or a positional spelling rule broken in every language of the script (§4.6).
   A target alphabet T is valid only if the word folded into T fits one of T's languages, positional rules included (`paᏏy` → `раЬу` breaks "no `ь`/`ъ` after a vowel", so Cyrillic is not valid).
5. **Clean words** give context: one model alphabet, not valid in any other model alphabet, no internal evidence (`dog`, `Мы`, `были` are clean; `HOT`, `is`, `now` — valid in Armenian `ո օ ա` — `сор`, `раураӏ` are not). The judged word never counts for itself.
6. Choose the target with the ladder (§4.2); whole-script words follow §4.3.
7. Fold each non-target letter to its best twin in the target (same case first, then alphabet order), re-attach marks, NFC. A capital among lowercase letters takes a lowercase twin (`paypaІ` → `paypal`).

### 4.2 Target ladder (owner decision)

Candidates = valid alphabets — scripts with an enabled target language whose alphabet covers every letter after folding (§4.4b); for a whole-script word, valid alphabets other than its own (§4.3). The first step that names a candidate decides; `rule` records it.

| step | rule                    | decides when                                                                                                                                                                                                                                               | gate |
| ---- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 1    | `hyphen` / `neighbours` | the clean parts of the word's hyphen compound (`СОСА-СОЛА`: `СОЛА`), if any, are all one alphabet; otherwise the nearest clean word on the left **and** the nearest clean word on the right (same paragraph) have the same alphabet; and it is a candidate | no   |
| 2    | `window`                | the clean words within **10 tokens on each side**, same paragraph, have a strict letter majority, and it is a candidate                                                                                                                                    | no   |
| 3    | `word-majority`         | the candidate with the most native letters is strictly ahead and has ≥ 1 native letter                                                                                                                                                                     | —    |
| —    | ~~outnumber gate~~      | **removed** (owner, final): with language-level targets it only broke `раураl` (§4.4b)                                                                                                                                                                     | —    |
| 4    | `any-valid`             | no step-3 leader (tie, or no native letters): the valid alphabet first by script name (Cyrillic < Greek < Latin; only scripts with an enabled target language, §4.4b)                                                                                      | no   |

No candidate at all → flagged, left as written (`rule: 'no-valid-alphabet'`, mixed class).

- **Step 1 needs both sides.** At a text or paragraph edge step 1 does not decide and step 2 does. One-sided neighbours broke `Το iPhone είναι ακριβό` (the only right neighbour `iPhone` is Latin; Greek `Το` folded to `To`); with both sides required the window (Greek 11 letters vs Latin 6) keeps it.
- **Hyphen compounds** (owner decision): parts joined by a single hyphen (`-` U+2010 U+2011) are each other's immediate context. `СОСА-СОЛА` → `СОЛА` is a clean Cyrillic word (`Л` is a proof letter), so `СОСА` is judged Cyrillic: left as written, not a spoof. `СОСА-COLA` → `COLA` is clean Latin → `COCA-COLA`. Parts in two alphabets (`Wi-Fi-роутер`, `Docker-контейнер`) name no alphabet; the ordinary neighbours decide.
- **Window ±10 tokens within the paragraph** (blank line = paragraph break). Ten words a side is one to two sentences, ≈ 100 letters of evidence, enough to outvote a quoted brand or a stray foreign word; the paragraph bound keeps a reply in one language from voting on a quoted paragraph in another; a fixed window keeps the cost linear for unbroken long texts (chat logs, scraped pages) and keeps the decision local where a whole-text majority would let one long section decide for the rest.
- **Context first**: `Bank ассоunt verification` → `account` (both neighbours Latin).
- Without context, step 3 decides: `раураl` → `paypal` (only English fits), `кey` → `кеу`, `тap` → `тар` (only Russian fits), `ΑΡΡLE` → `APPLE`; `иser` has no valid alphabet (`ѕ` is Macedonian, not a target letter) unless `и~u` is enabled (§3.3), then → `user`. No outnumber gate (§4.4b).
- Step 4 (`any-valid`) is reached only by words whose candidates have no native letter or tie: `раураӏ`, `раураІ` (evidence removed Cyrillic; Latin has no native letter), `Αр` (1 Greek + 1 Cyrillic letter → Cyrillic). `paᏏy` used to reach it and fold to `раЬу`; the positional rules now reject Cyrillic, so it is mixed, not confusable, left as written.
- **Step-4 (any-valid) restriction no longer needed**: restricting it to scripts the word already has letters in (`--step5-own-scripts`, measurement flag) changes 0 corpus cases and 0 of the 76 probe lines once the positional rules are in. Not adopted.

### 4.3 Whole-script words and `wholeScriptFold`

A word written entirely in one script S (`НОТ`, `сор`, `раураӏ`). Never below 2 letters, never when S is in `expectedScripts`. A Latin word is never folded out of Latin; the only intra-Latin fold is the case anomaly (§4.5, `paypaI`).

**Upstream v0.4.0** folds a single-script word whose UTS #39 skeleton is ASCII when the text-level dominant script is Latin (letter count over the whole text, the word included), or the message has any mixed word: `НОТ deal today` → `HOT deal today`, `I bought сор today` → `cop`, `go to аррӏе.com` → `apple.com`; it misses `НОТ dog` (3 vs 3 letters, tie → first-seen Cyrillic), `раураӏ` alone, `Зайди на раураӏ сегодня`, and folds nothing with a non-ASCII skeleton (`сок`).

One option, three modes:

| `wholeScriptFold`   | whole-script word **without** internal evidence           | whole-script word **with** internal evidence (§4.4, §4.5) |
| ------------------- | --------------------------------------------------------- | --------------------------------------------------------- |
| `'off'`             | never folded, not flagged                                 | flagged (confusable), left as written                     |
| `'foreign-letters'` | never folded, not flagged                                 | folded by the full ladder (steps 1–4)                     |
| `'all'`             | folded only when step 1 or 2 names another valid alphabet | folded by the full ladder (steps 1–4)                     |

A whole-script word whose context (step 1 or 2) is its own script stays as written, unless it carries evidence. Evidence only counts when another alphabet is valid for the word (Chechen `маӏа` has none, so it is left alone).

**Default: `'all'`** (owner, confirmed) — the mode that matches upstream: upstream folds whole-script words in Latin-dominant text, and `'all'` does the same with word-level context (and also catches `НОТ dog`). `'foreign-letters'` is the narrow rule.

| text                      | upstream v0.4.0        | `'off'`                | `'foreign-letters'`       | `'all'` (default)         |
| ------------------------- | ---------------------- | ---------------------- | ------------------------- | ------------------------- |
| `НОТ dog`                 | unchanged, not flagged | unchanged, not flagged | unchanged, not flagged    | `HOT dog`                 |
| `НОТ deal today`          | `HOT deal today`       | unchanged, not flagged | unchanged, not flagged    | `HOT deal today`          |
| `Мы были в НОТ`           | unchanged              | unchanged              | unchanged                 | unchanged                 |
| `I bought сор today`      | `I bought cop today`   | unchanged              | unchanged                 | `I bought cop today`      |
| `раураӏ` alone            | unchanged, not flagged | flagged, unchanged     | `paypal`                  | `paypal`                  |
| `go to аррӏе.com`         | `go to apple.com`      | flagged, unchanged     | `go to apple.com`         | `go to apple.com`         |
| `Зайди на раураӏ сегодня` | unchanged, not flagged | flagged, unchanged     | `Зайди на paypal сегодня` | `Зайди на paypal сегодня` |
| `раураІ` (Ukrainian `І`)  | unchanged              | flagged, unchanged     | `paypal`                  | `paypal`                  |
| `paypaI` (ASCII)          | unchanged              | flagged, unchanged     | `paypal`                  | `paypal`                  |
| `Το iPhone είναι ακριβό`  | unchanged              | unchanged              | unchanged                 | unchanged                 |

Corpus: `'off'` 217/35, `'foreign-letters'` 219/33, `'all'` 220/32 (§8).

### 4.4 Language alphabets inside a script (owner decision)

`LANGUAGES` in `scripts/prototype-resolve.mjs`, by NFD base letter (so `й ё ї ў ѓ ќ` are judged as `и е і у г к`):

| script   | languages                                                                                                                                                                                                                                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cyrillic | Russian, Ukrainian (`ґ є і`, no `ъ ы э`), Belarusian (`і`, no `щ ъ`), Bulgarian (no `ы э`), Serbian (`ђ ј љ њ ћ џ`), Macedonian (`ѕ ј љ њ џ`), Kazakh (`ә ғ қ ң ө ұ ү һ і`), Tajik (`ғ қ ҳ ҷ`, no `щ ы ь ц`), Uzbek (`қ ғ ҳ`, no `щ ы`), Caucasian palochka languages (Russian + `ӏ` after `г д к л п т ф х ц ч ш щ ж с з` or word-initial) |
| Latin    | one European set: `a–z ß æ œ ø þ ð ı ł đ` (accents are marks)                                                                                                                                                                                                                                                                               |
| Greek    | modern Greek `α–ω ς`                                                                                                                                                                                                                                                                                                                        |

**Foreign-letter evidence** = letters of a single-script word that fall outside the best-fitting language, keeping only those with a twin in another alphabet (lookalikes). Tatar `җ` or Bashkir `ҡ` have no twin: an unmodelled language, not evidence. `ԁ ԛ ԝ`, `ӏ` after a vowel or `р`, Greek `ϳ` are evidence.

- `аррӏе` → evidence `ӏ` (after `р`); `раураӏ` → case anomaly first (§4.5).
- Corpus legit Cyrillic/Greek cases: no evidence on any word (Kazakh, Belarusian, Serbian, Macedonian, Bulgarian, Ukrainian rows all fit).
- Real-text scan (Markdown, 5.83 M tokens, test material excluded): 0 occurrences.
- Known gap: Chechen also writes `Ӏ` as a consonant after vowels (`маӀа`). The positional rule marks such words; they stay unflagged only because no other alphabet is valid for them. A Chechen word made only of Latin-twinned letters plus a post-vowel palochka would be folded.

### 4.4b Target languages (owner decision)

Target validity is judged at **language** level, not script-wide: a word is folded into script T only if every letter after folding is in the alphabet of an **enabled target language** of T, positional rules (§4.6) included. Option `targetLanguages` (`TARGET_LANGUAGES` in `scripts/prototype-resolve.mjs`: `English` = `a–z`, plus every language of §4.4). The other languages still serve as evidence (§4.4); twins into a script are restricted to target-language letters (`ѕ`, `ӏ`, `і` are fold sources, never targets, unless their language is enabled). Scripts with no enabled target language (Armenian, Cherokee, Coptic, Greek by default) are never targets.

| row (no context)      | default targets                        | + `и~u` (§3.3) | with the old outnumber gate | why                                                                                     |
| --------------------- | -------------------------------------- | -------------- | --------------------------- | --------------------------------------------------------------------------------------- |
| `раураl`              | `paypal`                               | `paypal`       | kept (1 vs 5)               | `l` has no Russian twin (`ӏ` is Caucasian), so only English fits all letters            |
| `иser`                | mixed, unchanged                       | `user`         | mixed, unchanged            | `s` has no Russian twin (`ѕ` is Macedonian); `и` has no English twin unless `и~u` is on |
| `кey` / `my кey here` | `кеу`                                  | `кеу`          | kept (1 vs 2)               | `к` has no English twin; `e y` have Russian twins, so only Russian fits                 |
| `тap` / `my тap here` | `тар`                                  | `тар`          | kept (1 vs 2)               | `т` has no English twin (`т~m` off); only Russian fits                                  |
| `ΑΡΡLE`               | `APPLE`                                | `APPLE`        | kept (2 vs 3)               | Greek is not a target; English fits                                                     |
| `cоса` alone          | `соса`                                 | `соса`         | `соса`                      | English and Russian both fit; word majority Cyrillic 3 vs 1                             |
| `Kαλημέρα`            | `Καλημέρα` (Greek is a default target) | `Καλημέρα`     | `Καλημέρα`                  | only Greek fits                                                                         |

**Outnumber gate: removed** (owner, final). Measured before removal: corpus 224/28 without, 223/29 with; the one difference was `whole_script-004` `раураl`. The gate's original purpose (stop `иser` → `иѕег`) is served by the target languages.

**Default target languages** (owner, final): `English`, `Russian`, `Ukrainian`, `Greek`. Corpus: 224/28 for every combination of N = 2 to 4 measured (the corpus has no Ukrainian or Greek word carrying Latin letters). With the defaults `сiла` → `сіла` and `Kαλημέρα` → `Καλημέρα`; cost: a Russian word with a Latin `i` (`мiр`) folds to Ukrainian `мір`, not Russian `мир`.

### 4.5 Case anomaly (owner decision)

A word of ≥ 4 letters whose **last** letter is I-shaped (`I`, Cyrillic `І Ӏ ӏ`, Greek `Ι`) and whose inner letters are all lowercase (the first letter may be a capital) carries case-anomaly evidence: that letter is a lowercase `l` from another alphabet. Candidates are restricted to Latin (the only alphabet with a lowercase I-shaped letter, `l`), and the letter folds to `l`.

- Only the last position: a capital followed by lowercase letters is a camelCase hump (`iPhone GitHub McDonald eBay YouTube getId userId`); so `goIang` and `appIe` are not caught.
- ≥ 4 letters keeps chemical formulas (`NaI AgI CsI PbI2`).
- Palochka after a palochka consonant is exempt (Caucasian digraph `кӏ`, `дӏ`).
- Measured: 52 camelCase/brand/formula/Chechen/Cyrillic-brand tokens (`CASE_LEGIT` in `scripts/measure-false-positives.mjs`) → 1 with evidence (`маӏа`, foreign-letter kind; not flagged, §4.4). Attacks `paypaI раураӏ раураІ gmaiI` caught, `goIang appIe` not. Real-text scan (5.83 M tokens): 6 occurrences, 2 distinct, both false positives — a mojibake string (`Î²î²ðì²Ì`) and a random ID ending in `I` (`ge0ovx2fbI`).

### 4.6 Positional spelling rules (owner decision)

`ORTHOGRAPHY` in `scripts/prototype-resolve.mjs`, applied per language on words of ≥ 2 letters. A word that breaks a rule of every language whose letters it fits is "not this script" (orthography evidence); a folded word that breaks them makes that target invalid. Only positional rules: nothing that tells `ь` from `ъ` (owner: native writers mix them up).

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

Dropped after measuring or by owner: `ъ` only before `е ё ю я` (owner: fires on real misspellings; also breaks pre-1918 `Коммерсантъ`); Bulgarian `ь` only before `о` (distinguishes `ь` usage); `й` before consonant clusters (not solid).

**False-positive data** (`scripts/measure-false-positives.mjs`; dictionaries are hunspell stems, so inflected forms are not covered):

| set                                                                                         | words   | with orthography evidence                                                                                 | would be flagged (readable as another alphabet) |
| ------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `ru_RU`                                                                                     | 146 269 | 0                                                                                                         | 0                                               |
| `uk_UA`                                                                                     | 331 660 | 0                                                                                                         | 0                                               |
| `be_BY`                                                                                     | 83 665  | 0                                                                                                         | 0                                               |
| `bg_BG`                                                                                     | 78 238  | 0 (1 — `Ървин` — before the capital rule skipped the first letter)                                        | 0                                               |
| `kk_KZ`                                                                                     | 54 063  | 0                                                                                                         | 0                                               |
| `sr_RS`                                                                                     | 251 549 | 0                                                                                                         | 0                                               |
| `mn_MN` (Mongolian, not modelled)                                                           | 574 462 | 0                                                                                                         | 0                                               |
| `el_GR`                                                                                     | 828 806 | 8: dictionary run-ons (`Ιησουίτεςό`, `τεχνικέςαυτές`) and `μέσ` (elided; as a token `μέσ'` it is exempt)  | 0                                               |
| `he_IL` (Hebrew rule)                                                                       | 469 750 | 110, all prefix-only dictionary entries (`וכמ`, `ובכ`); 0 real words. Before exempting `פ`: +34 loanwords | — (not wired)                                   |
| Markdown scan (4 109 files, 5.83 M tokens, this repo and the test corpus excluded)          | —       | 0                                                                                                         | 0                                               |
| corpus legit rows; `CASE_LEGIT` list (`Коммерсантъ КамАЗ ВкусВилл МосГорТранс ъгъл ыдыс` …) | —       | 0                                                                                                         | 0                                               |

"Would be flagged" counts words for which another alphabet is valid — evidence only matters then (§4.3).

### 4.7 Results for the listed words

Defaults (`wholeScriptFold: 'all'`). Class: **confusable** = some alphabet fits the whole word (folded, or "kept" when not folded); **mixed** = no alphabet fits (§7.2). Step = the ladder step that decided (§4.2).

| text                                                                                                         | result                                                                              | step / class                                                                             | history                                                          |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `НОТ dog` / `НОТ deal today` / `This is НОТ news`                                                            | `HOT dog` / `HOT deal today` / `This is HOT news`                                   | window / window / neighbours, confusable                                                 | same                                                             |
| `Мы были в НОТ`; `НОТ` alone                                                                                 | unchanged, not flagged                                                              | own-script context / no context                                                          | same                                                             |
| `cоса` / `TЕХ` / `Αрр` / `HОT` / `НOТ` / `CОК` / `COК` alone                                                 | `соса` / `ТЕХ` / `Арр` / `HOT` / `НОТ` / `СОК` / `COK`                              | word-majority, confusable                                                                | same                                                             |
| `drink cоса now` / `open the Αрр`                                                                            | `drink coca now` / `open the App`                                                   | window, confusable                                                                       | same                                                             |
| `Bank ассоunt verification` / `Wе landed at Orly.` / `аррӏе.com`                                             | `account` / `We` / `apple.com`                                                      | neighbours / window / window, confusable                                                 | same                                                             |
| `ΑΡΡLE` / `раураl` alone                                                                                     | `APPLE` / `paypal`                                                                  | word-majority (only English fits), confusable                                            | were kept by the outnumber gate                                  |
| `иser` (alone or in English)                                                                                 | unchanged, flagged; with `и~u` on: `user`                                           | no valid alphabet (`ѕ` is not Russian), mixed                                            | was confusable (kept)                                            |
| `кey` / `тap` (alone or in English)                                                                          | `кеу` / `тар`                                                                       | word-majority (only Russian fits), confusable                                            | were kept by the gate                                            |
| `тail` / `admiп` / `вank` / `тime` / `quіск` / `Пpивеt`                                                      | unchanged, flagged                                                                  | no valid alphabet, mixed                                                                 | same                                                             |
| `paᏏy` (Cherokee `Ꮟ`)                                                                                        | unchanged, flagged                                                                  | no valid alphabet (`раЬу`: `ь` after a vowel), mixed                                     | was `раЬу` (step 5)                                              |
| `ьank` / `ъеst`                                                                                              | unchanged, flagged                                                                  | no valid alphabet, mixed                                                                 | new                                                              |
| `Пpивет` / `Москвa` / `paypaІ` / `шaг` / `pаypal’ѕ`                                                          | `Привет` / `Москва` / `paypal` / `шаг` / `paypal’s`                                 | word-majority, confusable                                                                | same                                                             |
| `Kαλημέρα`                                                                                                   | `Καλημέρα`                                                                          | word-majority (Greek is a default target), confusable                                    | same as before round 6b                                          |
| `ᴀᴅᴍɪɴ` / `ɡoogle` / `pɑypal`                                                                                | `admin` / `google` / `paypal`                                                       | any-valid (donor evidence) / word-majority, confusable                                   | `ᴀᴅᴍɪɴ` new                                                      |
| `İstanbul'da ışık`, `þorn`                                                                                   | unchanged, not flagged                                                              | European-language letters are not donors                                                 | —                                                                |
| `GitHub'а`, `iPhone’ов`; `форк на GіtHub'а`                                                                  | unchanged (case ending); `форк на GitHub'а`                                         | —; word-majority (stem)                                                                  | same                                                             |
| `I bought сок today`                                                                                         | unchanged                                                                           | `к` has no Latin twin                                                                    | same                                                             |
| `I bought сор today` / `the рос here` / `it is сухо here` / `eat уха soup` / `an оса flew` / `add сахар now` | `cop` / `poc` / `cyxo` / `yxa` / `oca` / `caxap`                                    | neighbours (window for `сахар`), confusable; unchanged under `'foreign-letters'`/`'off'` | same                                                             |
| `раураӏ` alone / `Зайди на раураӏ сегодня` / `раураІ`                                                        | `paypal` / `Зайди на paypal сегодня` / `paypal`                                     | any-valid (case anomaly), confusable                                                     | same                                                             |
| `paypaI` / `gmaiI`                                                                                           | `paypal` / `gmail`                                                                  | case-anomaly, confusable                                                                 | same                                                             |
| `Ьр`                                                                                                         | `bp`                                                                                | any-valid (orthography: `Ь` word-initial), confusable                                    | new                                                              |
| `маӏа` (Chechen), `Коммерсантъ`, `Το iPhone είναι ακριβό`                                                    | unchanged, not flagged                                                              | —                                                                                        | same / new / same                                                |
| `g00gle`, `app1e`, `НОВ0СТИ`                                                                                 | unchanged, not flagged                                                              | digits dropped (§9.4)                                                                    | were folded                                                      |
| `СОСА-СОЛА`                                                                                                  | unchanged, not flagged                                                              | hyphen partner `СОЛА` is clean Cyrillic (own script)                                     | same output; corpus expectation changed (§8)                     |
| `СОСА-COLA`                                                                                                  | `COCA-COLA`                                                                         | hyphen, confusable                                                                       | new                                                              |
| `χbox` / `ҳbox` / `Ҳbox` / `paχos`                                                                           | `xbox` / `xbox` / `Xbox` / `paxos`                                                  | word-majority, confusable (descender twins on)                                           | new; with `conditionalTwins: none` all four are mixed, unchanged |
| `ŋame` / `ɳo` / `ηame`                                                                                       | unchanged (pairs off by default); with `ŋ~n` `ɳ~n` `η~n` on: `name` / `no` / `name` | descender (intra-Latin) / word-majority                                                  | new                                                              |
| `ҳа` (Tajik)                                                                                                 | unchanged, not flagged                                                              | fits Tajik                                                                               | new                                                              |
| `pay with раураl today`                                                                                      | `pay with paypal today`                                                             | neighbours, confusable (§4.4b)                                                           | same                                                             |

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

## 6. Resolver prototype output

`node scripts/prototype-resolve.mjs [--whole-script-fold=off|foreign-letters|all] [--twins=id,…|none] [--targets=…] [--donors=…] [--step5-own-scripts]` — each line is one text; per resolved word: `word→normalized kind rule→target`. `kind` = `confusable` (folded, or `(not folded)`: evidence under `'off'`) or `mixed` (no alphabet fits). `ctx` = step-1 alphabet / step-2 alphabet (`-` = none), `valid` = alphabets the whole word fits, `rejected` = alphabets whose fold breaks their language rules, `evidence` = internal evidence (§4.4–4.6).

```
"Пpивет"                   => "Привет"  Пpивет→Привет confusable word-majority→Cyrillic ctx=-/- valid=[Cyrillic]
"Мы пишем Пpивет всем"     => "Мы пишем Привет всем"  Пpивет→Привет confusable neighbours→Cyrillic ctx=Cyrillic/Cyrillic valid=[Cyrillic]
"Hеllo"                    => "Hello"  Hеllo→Hello confusable word-majority→Latin ctx=-/- valid=[Latin]
"wоrld"                    => "world"  wоrld→world confusable word-majority→Latin ctx=-/- valid=[Latin]
"pаypal"                   => "paypal"  pаypal→paypal confusable word-majority→Latin ctx=-/- valid=[Latin]
"busіnеss"                 => "business"  busіnеss→business confusable word-majority→Latin ctx=-/- valid=[Latin]
"quіск"                    (unchanged)  quіск→quіск mixed no-valid-alphabet→- ctx=-/- valid=[]
"HОT"                      => "HOT"  HОT→HOT confusable word-majority→Latin ctx=-/- valid=[Latin,Cyrillic,Greek]
"НOТ"                      => "НОТ"  НOТ→НОТ confusable word-majority→Cyrillic ctx=-/- valid=[Latin,Cyrillic,Greek]
"ВOДКА"                    => "ВОДКА"  ВOДКА→ВОДКА confusable word-majority→Cyrillic ctx=-/- valid=[Cyrillic]
"CОК"                      => "СОК"  CОК→СОК confusable word-majority→Cyrillic ctx=-/- valid=[Latin,Cyrillic]
"COК"                      => "COK"  COК→COK confusable word-majority→Latin ctx=-/- valid=[Latin,Cyrillic]
"TЕХ"                      => "ТЕХ"  TЕХ→ТЕХ confusable word-majority→Cyrillic ctx=-/- valid=[Latin,Cyrillic,Greek]
"cоса"                     => "соса"  cоса→соса confusable word-majority→Cyrillic ctx=-/- valid=[Latin,Cyrillic]
"drink cоса now"           => "drink coca now"  cоса→coca confusable neighbours→Latin ctx=Latin/Latin valid=[Latin,Cyrillic]
"Αрр"                      => "Арр"  Αрр→Арр confusable word-majority→Cyrillic ctx=-/- valid=[Latin,Cyrillic,Greek]
"open the Αрр"             => "open the App"  Αрр→App confusable window→Latin ctx=-/Latin valid=[Latin,Cyrillic,Greek]
"Αpple"                    => "Apple"  Αpple→Apple confusable word-majority→Latin ctx=-/- valid=[Latin]
"Kαλημέρα"                 => "Καλημέρα"  Kαλημέρα→Καλημέρα confusable word-majority→Greek ctx=-/- valid=[Greek]
"οnly"                     => "only"  οnly→only confusable word-majority→Latin ctx=-/- valid=[Latin]
"ΑΡΡLE"                    => "APPLE"  ΑΡΡLE→APPLE confusable word-majority→Latin ctx=-/- valid=[Latin]
"GitHub'а"                 (unchanged)
"форк на GіtHub'а"         => "форк на GitHub'а"  GіtHub'а→GitHub'а confusable word-majority→Latin ctx=-/Cyrillic valid=[Latin]
"pаypal’ѕ"                 => "paypal’s"  pаypal’ѕ→paypal’s confusable word-majority→Latin ctx=-/- valid=[Latin]
"iPhone’ов"                (unchanged)
"Пpивеt"                   (unchanged)  Пpивеt→Пpивеt mixed no-valid-alphabet→- ctx=-/- valid=[]
"Сafé"                     => "Café"  Сafé→Café confusable word-majority→Latin ctx=-/- valid=[Latin]
"Ёлкa"                     => "Ёлка"  Ёлкa→Ёлка confusable word-majority→Cyrillic ctx=-/- valid=[Cyrillic]
"шaг"                      => "шаг"  шaг→шаг confusable word-majority→Cyrillic ctx=-/- valid=[Latin,Cyrillic]
"Ьank"                     => "bank"  Ьank→bank confusable word-majority→Latin ctx=-/- valid=[Latin]
"paypaІ"                   => "paypal"  paypaІ→paypal confusable word-majority→Latin ctx=-/- valid=[Latin,Cyrillic,Greek]
"тime"                     (unchanged)  тime→тime mixed no-valid-alphabet→- ctx=-/- valid=[]
"кey"                      => "кеу"  кey→кеу confusable word-majority→Cyrillic ctx=-/- valid=[Cyrillic]
"Kиев"                     => "Киев"  Kиев→Киев confusable word-majority→Cyrillic ctx=-/- valid=[Cyrillic]
"НОТ"                      (unchanged)
"НОТ dog"                  => "HOT dog"  НОТ→HOT confusable window→Latin ctx=-/Latin valid=[Latin,Cyrillic,Greek]
"НОТ deal today"           => "HOT deal today"  НОТ→HOT confusable window→Latin ctx=-/Latin valid=[Latin,Cyrillic,Greek]
"This is НОТ news"         => "This is HOT news"  НОТ→HOT confusable neighbours→Latin ctx=Latin/Latin valid=[Latin,Cyrillic,Greek]
"Мы были в НОТ"            (unchanged)
"СССР"                     (unchanged)
"СОСА-СОЛА"                (unchanged)
"раураӏ"                   => "paypal"  раураӏ→paypal confusable any-valid→Latin ctx=-/- valid=[Latin,Cyrillic] evidence=case:ӏ
"тип"                      (unchanged)
"опера"                    (unchanged)
"I like опера"             (unchanged)
"тail"                     (unchanged)  тail→тail mixed no-valid-alphabet→- ctx=-/- valid=[]
"иser"                     (unchanged)  иser→иser mixed no-valid-alphabet→- ctx=-/- valid=[]
"admiп"                    (unchanged)  admiп→admiп mixed no-valid-alphabet→- ctx=-/- valid=[]
"вank"                     (unchanged)  вank→вank mixed no-valid-alphabet→- ctx=-/- valid=[]
"Bank ассоunt verification" => "Bank account verification"  ассоunt→account confusable neighbours→Latin ctx=Latin/Latin valid=[Latin]
"Wе landed"                => "We landed"  Wе→We confusable window→Latin ctx=-/Latin valid=[Latin]
"раураl"                   => "paypal"  раураl→paypal confusable word-majority→Latin ctx=-/- valid=[Latin]
"аррӏе.com"                => "apple.com"  аррӏе→apple confusable window→Latin ctx=-/Latin valid=[Latin,Cyrillic] evidence=foreign:ӏ
"I bought сок today"       (unchanged)
"I bought сор today"       => "I bought cop today"  сор→cop confusable neighbours→Latin ctx=Latin/Latin valid=[Latin,Cyrillic]
"the рос here"             => "the poc here"  рос→poc confusable neighbours→Latin ctx=Latin/Latin valid=[Latin,Cyrillic]
"it is сухо here"          => "it is cyxo here"  сухо→cyxo confusable neighbours→Latin ctx=Latin/Latin valid=[Latin,Cyrillic]
"eat уха soup"             => "eat yxa soup"  уха→yxa confusable neighbours→Latin ctx=Latin/Latin valid=[Latin,Cyrillic,Greek]
"an оса flew"              => "an oca flew"  оса→oca confusable neighbours→Latin ctx=Latin/Latin valid=[Latin,Cyrillic]
"add сахар now"            => "add caxap now"  сахар→caxap confusable neighbours→Latin ctx=Latin/Latin valid=[Latin,Cyrillic]
"Мы были в НОТ сегодня"    (unchanged)
"Зайди на раураӏ сегодня"  => "Зайди на paypal сегодня"  раураӏ→paypal confusable any-valid→Latin ctx=Cyrillic/Cyrillic valid=[Latin,Cyrillic] evidence=case:ӏ
"раураІ"                   => "paypal"  раураІ→paypal confusable any-valid→Latin ctx=-/- valid=[Latin,Cyrillic,Greek] evidence=case:І
"paypaI"                   => "paypal"  paypaI→paypal confusable case-anomaly→Latin ctx=-/- valid=[Latin,Cyrillic,Greek] evidence=case:I
"NaI"                      (unchanged)
"my иser name"             (unchanged)  иser→иser mixed no-valid-alphabet→- ctx=Latin/Latin valid=[]
"my кey here"              => "my кеу here"  кey→кеу confusable word-majority→Cyrillic ctx=Latin/Latin valid=[Cyrillic]
"my тap here"              => "my тар here"  тap→тар confusable word-majority→Cyrillic ctx=Latin/Latin valid=[Cyrillic,Greek]
"paᏏy"                     (unchanged)  paᏏy→paᏏy mixed no-valid-alphabet→- ctx=-/- valid=[] rejected=Cyrillic:softHardNotAfterVowel
"маӏа"                     (unchanged)
"Το iPhone είναι ακριβό"   (unchanged)
"Коммерсантъ"              (unchanged)
"ьank"                     (unchanged)  ьank→ьank mixed no-valid-alphabet→- ctx=-/- valid=[]
"ъеst"                     (unchanged)  ъеst→ъеst mixed no-valid-alphabet→- ctx=-/- valid=[]
"oьo"                      (unchanged)  oьo→oьo mixed no-valid-alphabet→- ctx=-/- valid=[] rejected=Cyrillic:softHardNotAfterVowel
"Gοοgle ΑΡΡLΕ"             => "Google APPLE"  Gοοgle→Google confusable word-majority→Latin ctx=-/- valid=[Latin] ; ΑΡΡLΕ→APPLE confusable word-majority→Latin ctx=-/- valid=[Latin]
"СОСА-COLA"                => "COCA-COLA"  СОСА→COCA confusable hyphen→Latin ctx=Latin/Latin valid=[Latin,Cyrillic]
"χbox"                     => "xbox"  χbox→xbox confusable word-majority→Latin ctx=-/- valid=[Latin]
"ҳbox"                     => "xbox"  ҳbox→xbox confusable word-majority→Latin ctx=-/- valid=[Latin]
"paχos"                    => "paxos"  paχos→paxos confusable word-majority→Latin ctx=-/- valid=[Latin]
"ŋame"                     (unchanged)
"ҳа"                       (unchanged)
```

## 7. Hidden-character cleanup and counters

### 7.1 Rules

| class                     | code points                                                                             | keep when                                                                                                                                                                                                                           | otherwise                                                                                   | counted?                                                                                                                                                                                                                                                                                 |
| ------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| soft hyphen               | U+00AD                                                                                  | never                                                                                                                                                                                                                               | remove                                                                                      | silent                                                                                                                                                                                                                                                                                   |
| zero-width                | ZWSP U+200B, WJ U+2060, BOM U+FEFF                                                      | never                                                                                                                                                                                                                               | remove                                                                                      | counted if the run has ≥ 4 code points (steganography) or touches a word on either side (`ad​min`, `at‍ Orly`, `is_​admin`, a broken emoji ZWJ sequence); silent if isolated in whitespace, a BOM at text start, or a word-break hint between Thai/Lao/Khmer/Myanmar/Tibetan/CJK letters |
| joiners                   | ZWNJ U+200C, ZWJ U+200D                                                                 | a single joiner between letters/marks of a joining script (Arabic, Syriac, N'Ko, Mongolian, Indic, Sinhala, Khmer, Myanmar, Tibetan, Kaithi); a ZWJ after a virama at word end (Malayalam chillu); inside an RGI emoji ZWJ sequence | remove                                                                                      | as zero-width                                                                                                                                                                                                                                                                            |
| bidi embeddings/overrides | U+202A–202E                                                                             | never                                                                                                                                                                                                                               | remove                                                                                      | counted                                                                                                                                                                                                                                                                                  |
| bidi marks/isolates       | LRM, RLM, ALM U+061C, U+2066–2069                                                       | the text contains RTL letters                                                                                                                                                                                                       | remove                                                                                      | counted                                                                                                                                                                                                                                                                                  |
| variation selectors       | U+FE00–FE0F, U+E0100–E01EF, Mongolian U+180B–180F                                       | exactly one selector on a base that takes it: VS15/VS16 on `\p{Emoji}`; VS17–256 or VS1–3 on Han/kana; VS1–3 on math symbols (`≨︀`); FVS on Mongolian                                                                                | remove every selector after the first valid one, and orphans                                | counted                                                                                                                                                                                                                                                                                  |
| tag characters            | U+E0000–E007F                                                                           | inside `\p{RGI_Emoji_Tag_Sequence}` (subdivision flags)                                                                                                                                                                             | remove                                                                                      | counted                                                                                                                                                                                                                                                                                  |
| other invisibles          | U+180E, U+2061–2065, CGJ U+034F, U+206A–206F, U+FFF0–FFFB, U+E0080–E00FF, U+E01F0–E0FFF | never                                                                                                                                                                                                                               | remove                                                                                      | counted                                                                                                                                                                                                                                                                                  |
| blank glyphs              | Hangul fillers U+115F/1160/3164/FFA0, Braille blank U+2800, U+1D159                     | never                                                                                                                                                                                                                               | U+0020 between two visible characters (`click⠀here` → `click here`), removed at a word edge | counted                                                                                                                                                                                                                                                                                  |
| visible format characters | Arabic number signs U+0600–0605, U+06DD, U+070F                                         | always                                                                                                                                                                                                                              | —                                                                                           | not touched (they render; upstream treats all `\p{Cf}` as invisible)                                                                                                                                                                                                                     |
| special spaces            | NBSP, U+2000–200A, U+202F, U+3000, …                                                    | always                                                                                                                                                                                                                              | —                                                                                           | not touched                                                                                                                                                                                                                                                                              |

**Decided (owner, 2026-11-04):** a zero-width run that touches a word on **either** side is counted — one side suffices (`at‍ Orly`, `word​ next`, `ad​min`). Only a run with whitespace or a text edge on both sides, a BOM at text start, or a Thai/Lao/Khmer/Myanmar/Tibetan/CJK word-break hint is silent.

Changes against today, by location:

- `inertZeroWidthMask` (`src/analyze.ts:179-195`) stops protecting runs; isolated runs are removed into the silent bucket. The counted threshold moves from > 4 to ≥ 4.
- `FORMAT_CHAR_SCRIPTS` (`:115-138`) splits in two: joining scripts exempt **only** ZWNJ/ZWJ between their letters; stacking scripts (incl. Hebrew, Thai, Lao) exempt only `zalgo`. Bidi controls, tags, selectors and ZW runs inside Arabic/Hebrew/Indic words are judged like anywhere else.
- `isVariationSelector` (`:80-82`) gains U+E0100–E01EF and U+180F; supplement selectors stop counting as combining marks for `zalgo` (`:320-328`).
- The pictograph-neighbour exemption (`:47`, `:543-550`) is replaced by matching real RGI sequences (`\p{RGI_Emoji}`, `v` flag, Node ≥ 20) and protecting only the code points inside a match.
- `isInvisibleChar` (`:105-108`) excludes the visible Arabic number signs.

Control characters (`controlChars`, class `controlChar`, default `remove-counted`): C0 controls except tab, LF and CR, DEL, C1 controls, and U+FFFE; a CSI escape sequence goes whole; VT, FF and NEL become a space. They go before the rest, so one can't split a run past the run rules.

### 7.2 Counting unit and result additions

The counting unit is the **word** (owner decision): a whitespace-delimited chunk with at least one counted removal counts once, however long its payload (a word carrying 200 tag characters = 1). A run standing alone between words is its own chunk and counts once. Silent removals never count. Per-code-point detail lives only in the findings.

The three counters are separate classes and are reported apart; a word lands in at most one of `confusableWords` / `mixedWords`, and may also be in `hiddenWords`:

| counter           | what                                                                                              | why apart                              |
| ----------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `hiddenWords`     | words with a counted hidden character                                                             | —                                      |
| `confusableWords` | words some alphabet fits as a whole: folded by the ladder, or kept (evidence words under `'off'`) | can be read as a word of that alphabet |
| `mixedWords`      | mixed-script words that no alphabet fits (`тail admiп вank paᏏy`)                                 | owner: unlikely to be misread          |

```ts
interface AnalysisResult {
  // existing fields unchanged …
  counts: {
    wordsTotal: number;
    wordsAffected: number;
    /** Words (whitespace-delimited chunks) containing at least one counted hidden character. */
    hiddenWords: number;
    /** Words some alphabet fits as a whole (folded, or kept when wholeScriptFold 'off' stops the fold). */
    confusableWords: number;
    /** Mixed-script words no alphabet fits: "mixed, not confusable". */
    mixedWords: number;
  };
  /** Present only with options.hiddenChars === 'strict'. */
  hidden?: {
    findings: Array<{
      word: string; // the chunk as written
      index: number; // UTF-16 offset
      removed: Partial<Record<HiddenClass, number>>; // code points removed, by class (incl. silent ones)
    }>;
    payloads: Array<{
      kind: 'tag' | 'variation-selector' | 'zero-width-binary';
      index: number; // UTF-16 offset of the run
      length: number; // code points
      decoded: string | null; // printable text, or null
      bytesHex?: string; // when decoded is null: first 32 bytes as hex, '…' if longer
    }>;
  };
}
type HiddenClass =
  | 'bidiOverride'
  | 'bidiOverrideSpan'
  | 'bidiMark'
  | 'tag'
  | 'variationSelector'
  | 'zeroWidthRun'
  | 'zeroWidthInWord'
  | 'otherInvisible'
  | 'blankFiller'
  | 'softHyphen'
  | 'zeroWidth'
  | 'bom';
```

Decoders (≈ 20 lines each in `scripts/prototype-cleanup.mjs`):

- **tag**: `cp − 0xE0000` → ASCII (drops U+E0001 LANGUAGE TAG and U+E007F CANCEL TAG).
- **variation-selector**: U+FE00–FE0F → bytes 0–15, U+E0100–E01EF → 16–255, UTF-8 decode (Butler "emoji smuggling").
- **zero-width-binary**: a run of ≥ 8 using exactly two symbols; both polarities tried, 8-bit MSB-first; accepted if ≥ 90 % of the decoded characters are letters/digits/punctuation/spaces.
- Undecodable VS and two-symbol ZW runs report `bytesHex`, capped at 32 bytes (`PAYLOAD_HEX_CAP`). ZW runs with more than two symbols have no byte reading and report neither.

### 7.3 Prototype output

`node scripts/prototype-cleanup.mjs` on `a private cleanup-case file` (first 23 rows) plus our own cases. Invisible code points shown as `<hex>`, long runs as `<hex>×N`.

| case              | input                                                                                                                            | cleaned     | hidden words | counted (code points)     | silent       | payload                         |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------ | ------------------------- | ------------ | ------------------------------- |
| shy               | co<ad>operate                                                                                                                    | cooperate   | 0            |                           | softHyphen=1 |                                 |
| wj                | a<2060>b                                                                                                                         | ab          | 1            | zeroWidthInWord=1         |              |                                 |
| bomMid            | ab<feff>cd                                                                                                                       | abcd        | 1            | zeroWidthInWord=1         |              |                                 |
| zwspLatin         | fr<200b>ee                                                                                                                       | free        | 1            | zeroWidthInWord=1         |              |                                 |
| zwnjLatin         | fo<200c>o                                                                                                                        | foo         | 1            | zeroWidthInWord=1         |              |                                 |
| zwnjPersian       | می<200c>خواهم                                                                                                                    | =           | 0            |                           |              |                                 |
| zwnjDeva          | क<94d><200c>ष                                                                                                                    | =           | 0            |                           |              |                                 |
| emojiZwj          | 👨<200d>👩<200d>👧                                                                                                               | =           | 0            |                           |              |                                 |
| flagSco           | 🏴<e0067><e0062><e0073><e0063><e0074><e007f>                                                                                     | =           | 0            |                           |              |                                 |
| tagSmuggle        | hi<e0041><e0042><e0043>                                                                                                          | hi          | 1            | tag=3                     |              | tag:"ABC"                       |
| rlo               | abc<202e>def                                                                                                                     | abcdef      | 1            | bidiOverride=1            |              |                                 |
| lrmInEnglish      | hello<200e> world                                                                                                                | hello world | 1            | bidiMark=1                |              |                                 |
| rlmInHebrew       | שלום<200f> abc                                                                                                                   | =           | 0            |                           |              |                                 |
| vsRun             | a<fe0f><fe0f><fe0f>                                                                                                              | a           | 1            | variationSelector=3       |              | variation-selector:hex 0f0f0f   |
| vsHeart           | ❤<fe0f>                                                                                                                          | =           | 0            |                           |              |                                 |
| ivs               | 辻<e0100>                                                                                                                        | =           | 0            |                           |              |                                 |
| vsPayload         | x<e0110><e0120><e0130>                                                                                                           | x           | 1            | variationSelector=3       |              | variation-selector:" 0@"        |
| mixed             | busіnеss                                                                                                                         | =           | 0            |                           |              |                                 |
| cyrWord           | НОТ dog                                                                                                                          | =           | 0            |                           |              |                                 |
| russian           | Привет мир                                                                                                                       | =           | 0            |                           |              |                                 |
| greekMix          | Αpple                                                                                                                            | =           | 0            |                           |              |                                 |
| fullwidth         | Ｇｅｔ                                                                                                                           | =           | 0            |                           |              |                                 |
| zalgoNo           | café                                                                                                                             | =           | 0            |                           |              |                                 |
| vsSuppSingle      | x<e0110>                                                                                                                         | x           | 1            | variationSelector=1       |              |                                 |
| emojiVsPayload    | 😀<e0158><e0159><e0111>                                                                                                          | 😀          | 1            | variationSelector=3       |              | variation-selector:"hi!"        |
| tagAfterEmoji     | 😀<e0069><e0067><e006e><e006f><e0072><e0065>                                                                                     | 😀          | 1            | tag=6                     |              | tag:"ignore"                    |
| zwBinary          | ok <200b><200c><200c><200c><200b>×5<200c><200c><200c><200b><200c><200c><200c><200b><200c><200c><200b><200c><200c><200c><200b> ok | ok ok       | 1            | zeroWidthRun=24           |              | zero-width-binary:"pwn"         |
| zwIsolated        | a <200b> b                                                                                                                       | a b         | 0            |                           | zeroWidth=1  |                                 |
| bomStart          | <feff>hello                                                                                                                      | hello       | 0            |                           | bom=1        |                                 |
| hebrewRLO         | של<202e>ום                                                                                                                       | שלום        | 1            | bidiOverride=1            |              |                                 |
| arabicTag         | مي<e0068><e0069>خ                                                                                                                | ميخ         | 1            | tag=2                     |              | tag:"hi"                        |
| persianZWSPrun    | می<200b>×5خواهم                                                                                                                  | میخواهم     | 1            | zeroWidthRun=5            |              |                                 |
| zwnjBetweenSpaces | a <200c> b                                                                                                                       | a b         | 0            |                           | zeroWidth=1  |                                 |
| keycap            | 1<fe0f><20e3>                                                                                                                    | =           | 0            |                           |              |                                 |
| rliHebrew         | abc <2067>שלום<2069> def                                                                                                         | =           | 0            |                           |              |                                 |
| rliNoRtl          | abc <2067>def<2069>                                                                                                              | abc def     | 1            | bidiMark=2                |              |                                 |
| nbsp              | a<a0>b<2009>c                                                                                                                    | =           | 0            |                           |              |                                 |
| shyCyr            | ко<ad>шка                                                                                                                        | кошка       | 0            |                           | softHyphen=1 |                                 |
| twoWords          | fr<200b>ee mon<200b>ey <e0078>×200                                                                                               | free money  | 3            | tag=200,zeroWidthInWord=2 |              | tag:"xxxxxxxxxxxxxxxxxxxxxxxx…" |
| arabicNumberSign  | <600><661><662><663>                                                                                                             | =           | 0            |                           |              |                                 |
| fnApp             | adm<2061>in                                                                                                                      | admin       | 1            | otherInvisible=1          |              |                                 |
| ivs3              | 辻<e0100><e0101><e0102>                                                                                                          | 辻<e0100>   | 1            | variationSelector=2       |              | variation-selector:hex 101112   |
| emojiVs16         | ☺<fe0f>                                                                                                                          | =           | 0            |                           |              |                                 |
| vs16OnLetter      | a<fe0f>                                                                                                                          | a           | 1            | variationSelector=1       |              |                                 |

Mixed-script rows (`mixed`, `cyrWord`, `greekMix`, `fullwidth`) are untouched here by design: cleanup removes invisibles only, the resolver handles letters.

## 8. Corpus results (`a private test corpus: cases.json`)

`node scripts/prototype-corpus.mjs <cases.json> [--fails] [--whole-script-fold=…] [--descender=…] [--step5-own-scripts] [--modes]` scores two pipelines on the 294-case corpus (133 must_flag, 119 must_not_flag, 42 ambiguous):

- **upstream**: v0.4.0 `analyze()`.
- **fork**: `cleanup` → `resolveText` → upstream `analyze()` for what the prototypes do not cover (zalgo, styled words, illegal code points, words outside the model). Upstream's Latin-only fold of model-script words and its invisible findings are not applied (the prototypes are the authority there).

A case passes when `spoofed` matches `expected.spoofed`, `normalized` equals `expected.normalized` when given, and `normalized` equals the input when `expected.keep` is set. Ambiguous cases are only tallied (how many each pipeline flags).

| category             | upstream pass/fail | fork pass/fail | ambiguous flagged (upstream / fork) |
| -------------------- | ------------------ | -------------- | ----------------------------------- |
| mixed_script         | 14/5               | 19/0           | 0/3 · 0/3                           |
| whole_script         | 7/2                | 9/0            | 0/6 · 0/6                           |
| case_dependent       | 19/0               | 19/0           | 0/2 · 0/2                           |
| legit_ru_tech        | 17/3               | 20/0           | —                                   |
| legit_cyrillic_langs | 9/0                | 9/0            | —                                   |
| legit_greek          | 5/2                | 5/2            | —                                   |
| legit_latin          | 9/0                | 9/0            | —                                   |
| legit_symbols        | 12/0               | 12/0           | 1/1 · 1/1                           |
| hidden_format        | 9/1                | 7/3            | 3/4 · 1/4                           |
| zero_width           | 26/2               | 26/2           | 3/4 · 4/4                           |
| bidi                 | 9/4                | 12/1           | 2/3 · 3/3                           |
| variation_selector   | 11/3               | 14/0           | 0/1 · 0/1                           |
| tag_chars            | 8/1                | 9/0            | 0/2 · 1/2                           |
| zw_stego             | 4/0                | 4/0            | —                                   |
| blank_filler         | 4/3                | 7/0            | 0/1 · 0/1                           |
| zalgo                | 4/2                | 4/2            | 1/1 · 1/1                           |
| styled               | 9/3                | 10/2           | 1/4 · 1/4                           |
| special_space        | 6/0                | 6/0            | 1/2 · 1/2                           |
| control_char         | 2/1                | 2/1            | —                                   |
| mixed_numbers        | 1/2                | 1/2            | 0/3 · 1/3                           |
| idn                  | 5/0                | 5/0            | 0/1 · 0/1                           |
| html_entity          | 8/12               | 8/12           | 0/3 · 0/3                           |
| prompt_injection     | 8/0                | 7/1            | 0/1 · 0/1                           |
| **total**            | 206/46             | 224/28         | 12/42 · 14/42                       |

Defaults (`wholeScriptFold: 'all'`, targets `English`, `Russian`, `Ukrainian`, `Greek`, default donors and conditional twins, no outnumber gate). By mode (`--modes`): `wholeScriptFold` `'off'` 220/32, `'foreign-letters'` 223/29, `'all'` 224/28. Conditional twins none / default / + `η ŋ ɳ` / + `и~u` / + `ҫ~c ɽ~r ʐ~z`: 224/28 each; + `ı~i` 223/29 (`legit_latin-003` Turkish); + `и~u т~m п~n` 222/30 (§3.3). Donors none 221/31, without LatinExtra 222/30, default 224/28 (§3.4). Targets N = 2 to 4 (English + Russian, + Ukrainian, + Greek, both): 224/28 each. `--step5-own-scripts`: no case changes.

History: 91d86e4 219/33 → e7f575d 216/36 → 10cfbea 220/32 → 70ec422 220/32 → fd04378 221/31 → 44f6a5f 224/28 → now **224/28** (round 7: gate removed, targets + Ukrainian + Greek, `ı~i`/`ҫ~c`/`ɽ~r`/`ʐ~z` as off-by-default conditional twins; no corpus case changed) (upstream 205/47 → 206/46 after the corpus change below).

Round 6b (language-level targets, donors, gate removed) vs fd04378: newly pass `whole_script-004` `раураl` → `paypal` (gate gone; only English fits), `mixed_script-020` `ᴀᴅᴍɪɴ` → `admin` (Latin extras as donors, small capitals), `styled-011` (upside-down text: its IPA letters are now donors, so the words are flagged as mixed). Output changes without pass/fail change: `кey` → `кеу`, `тap` → `тар` (only Russian fits), `ɡoogle` now resolved by the fork (was upstream's fold), `иser` now mixed (`ѕ` is not Russian), `ſecure` → `fecure` now by the fork (still fails: the corpus expects `secure`). No regressions.

Round 6 changed the corpus, not the outcome: `whole_script-003` `СОСА-СОЛА` was must_flag (expected `COCA-COLA`) and is now must_not_flag (`keep`) — owner: `Л` is a Cyrillic proof letter, so the compound reads as Russian. Both pipelines already left it unchanged and unflagged, so both gain one pass; the fork now decides it through the hyphen partner `СОЛА` (§4.2). The change is recorded in the corpus README ("Changes after build") and in `scripts/build_cases.py`. No fork output changed on any corpus case against 70ec422.

Round 5 (vs 10cfbea): `mixed_script-021` `paᏏy` was `раЬу`, now left as written (Cyrillic breaks "no `ь` after a vowel"); `whole_script-004`, `case_dependent-008/011/019` moved from mixed to confusable. Round 4 (vs e7f575d): newly passed `mixed_script-010/018`, `idn-004` (context overrides the gate) and `whole_script-005` (case anomaly).

Fork failures by cause (28):

| cause                                                   | cases                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **owner decision vs corpus expectation** (§9.2)         | `hidden_format-001` (SHY in `Donau­dampf­schiff­fahrt`: corpus keeps, owner removes), `hidden_format-002/003`, `prompt_injection-005` (SHY in `pay­pal.com`, `pass­word`, `ig­nore`: corpus flags, owner silent), `zero_width-016` (`Auf‌lage`: corpus legit, owner removes+counts ZWNJ in Latin), `zero_width-029` (Thai ZWSP hints: corpus keeps, owner removes) — 6 |
| **inherited from upstream** (same failure in both) — 10 | `legit_greek-004/007` `Δt = 5 μs`, `Σxᵢ` (scientific notation is a none-valid mix, so flagged); `bidi-015` mixed Hebrew/Latin/Arabic token mangled by upstream fold; `zalgo-002/003`; `styled-004/015` (`ſecure` → `fecure`: UTS #39 `ſ`→`f`, corpus wants `secure`); `control_char-003`; `mixed_numbers-001/003`                                                      |
| **out of scope** — 12                                   | `html_entity-*`: the corpus expects entities (`&shy;`, `&#x200B;`, `&#xE0041;`) to be decoded first; neither pipeline decodes HTML                                                                                                                                                                                                                                     |

Against upstream the fork passes 22 cases upstream fails and fails 4 that upstream passes (net +18):

- fork-only passes: Cyrillic-target folds `mixed_script-001…004` (`Москвa` → `Москва` instead of `Mockba`); `whole_script-005/006` (`раураӏ`, `аррӏе.com`); `mixed_script-020` (`ᴀᴅᴍɪɴ`); `styled-011` (upside-down text); Russian case endings `legit_ru_tech-002/008/019` (`GitHub'а`, `Excel'е`); RLM/LRM/isolates kept in RTL text `bidi-010/011/013`; emoji VS and tag payloads `variation_selector-011/013`, `tag_chars-007`; math standardized variant `variation_selector-006` (`≨︀`); blank glyphs `blank_filler-001/003/005`; double ZWJ `zero_width-027`.
- fork-only failures: `hidden_format-002/003`, `prompt_injection-005` (silent soft hyphen), `zero_width-029` (Thai ZWSP removed) — owner decisions the corpus disagrees with.

## 9. Visual test-case study (evidence)

Source: `a private test corpus: README.md`, `screenshots/pairs.json` (8 fonts: Noto Sans/Serif, DejaVu Sans/Mono, Liberation Sans/Serif, Noto Serif italic, Liberation Serif italic; pixel comparison, glyphs side by side). Evidence only; it does not override owner decisions.

### 9.1 Findings

- **Identical in all 8 fonts**: Cyrillic `а е о р с у х ѕ ԛ ԝ`; caps `А В Е М Н О Р С Т Х І Ј Ѕ Ԛ Ԝ`. All are twins in the table.
- **UTS #39-confusable but visibly different in every font**: `У/Y`, `ү/y`, Greek `α ν ρ ι κ υ γ χ`, Latin `ɑ ı ſ/f`, Cherokee, fullwidth/math-bold, `З/3` (except DejaVu Sans Mono). `К/K` differs in most fonts (kinked arm). `к/k` differs in all 8.
- **Italic**: `т п и` are pixel-identical to `m n u` in both italic fonts (`тail`, `иser`, `admiп` read "mail", "user", "admin"; Russian `тип` reads "mun"). Upright `т в н` match small capitals `ᴛ ʙ ʜ`, not `t b h`.
- **Font-dependent**: `ɡ`≈`g` (sans), palochka `ӏ` is cap-height and reads `I` (so `раураӏ` reads "paypaI"), Armenian `ս օ հ ո` ≈ `u o h n` only in DejaVu Sans, `ν`≈`v` only in Liberation Serif italic.
- **Digits** (`pairs.json`): `1/l` and `0/O` are distinguishable by pixels in all 8 fonts (ratios 0.33–0.97); `З/3` is identical in DejaVu Sans Mono. Further digit pairs: §9.4.
- **Not all `\p{Cf}` is invisible**: Arabic number signs U+0600–0605, U+06DD, U+070F render. Cleanup leaves them (§7.1).
- **Legit hidden characters**: German `Auf‌lage` (ZWNJ breaks the `fl` ligature); ICU's `J‏2–‏` and ALM between Arabic-Indic digits reorder display but are legitimate marks (corpus: ambiguous).
- ш/w, σ/o, η/n, ω/w were not among the measured pairs.

### 9.2 Conflicts with owner decisions (for re-decision)

| owner decision                                                    | study says                                                                               | effect if the study wins                                                                               |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `χ`~`x` is a twin (owner: identical in the owner's terminal font) | visibly different in all 8 fonts                                                         | font-dependent: kept as decided (owner)                                                                |
| `к`~~`k`, `κ`~~`k` not twins (owner, 2026-11-04)                  | visibly different in all 8 fonts                                                         | agrees with the study                                                                                  |
| `η`~`n` not a twin (owner, 2026-11-04)                            | not measured                                                                             | —                                                                                                      |
| `ω`~`w`, `ш`↔`w`, `σ`↔`o` twins                                   | not measured                                                                             | no evidence either way                                                                                 |
| UTS #39 pairs kept (`У/Y ү/y α ρ ι υ γ ν г/r`)                    | visibly different in every font                                                          | removing them would make ~10 more letters proof letters                                                |
| italic twins rejected                                             | italic renders `т п и` pixel-identical to `m n u`                                        | the decision stands; these words are flagged as mixed-script, never folded (§4.2)                      |
| soft hyphen removed silently                                      | corpus flags SHY inside a brand/keyword (`pay­pal.com`) and keeps it in German compounds | `spoofed` false where the corpus expects true (3 cases); German compounds lose their hyphenation hints |
| ZWNJ inside a Latin word removed + counted                        | `Auf‌lage` is legitimate German typography                                               | one counted false positive per such word                                                               |
| ZWSP always removed                                               | Thai text uses ZWSP as word-break hints                                                  | Thai text changes (silently); line breaking in Thai degrades after normalization                       |

The study's comparison is glyph-to-glyph. The owner's criterion — alike in running text — is about reading, which the study does not measure. `χ`~`x` is font-dependent: distinct in the 8 study fonts, identical in the owner's terminal font; kept.

### 9.3 Italic twins (proposed by the study, rejected by the owner)

Proposal: add `т`~~`m`, `п`~~`n`, `и`~`u` as a third, italic tier. **Owner decision: no** — to a Cyrillic reader these look distinct. They remain caught by the mixed-script check: flagged, left as written, counted as mixed, not confusable (§4.2).

### 9.4 Digits (dropped by the owner; the measurements are the reason)

Owner decision (round 5): digits as letter confusions are out of the design. The measurement at 10cfbea (prototype gate `0 1 3` + optional `6`~`б`; reproducible from that commit):

- Glyphs (`scripts/measure-digit-pairs.mjs`, `docs/evidence/digit-pairs.json`, `docs/evidence/digit-words.png`): every digit/letter pair is distinguishable by pixels in all 8 fonts except `3`/`З` in DejaVu Sans Mono; `ра6ота`/`работа` and `3`/`З` in caps read alike in sans fonts.
- Gate: digit runs between letters on both sides, ≥ 3 letters, letters ≥ 2 × digits, no hex, consistent case, no camel hump after the run.
- Corpus: 0 cases changed (2 hex HTML entities before the hex rule). 117 curated legit tokens: 0 (not independent: the gate was tuned on them).
- **Real text, 5.83 M Markdown tokens: 111 folds, 34 distinct, ≈ 33 wrong** (`x11spice`, `v1beta`, `x00api`, IDs, key fragments). With a 247 k known-word list: 1 (a leet user name), but attacks caught fell from 14/17 to 11/17 and a word list would have to ship.

### 9.5 Mid-word I-for-l (dropped by the owner; the measurement is the reason)

Owner decision (round 6): no rule for a capital `I` inside a lowercase word (`goIang`, `appIe`) — it cannot be told from camelCase without a dictionary. Measured at 70ec422 for the rule "capital `I` between two lowercase Latin letters, and the `I`→`l` form is a known word" (`/usr/share/dict/words`, 104 k): the Markdown scan (5.83 M tokens) has 2 494 such tokens, 224 distinct (`sessionId` 195, `accountId` 170, `userId` 127, `beginInteraction` 55 …); 0 become a known word. Attacks `appIe paIace heIlo onIine emaiIs bIog` were caught, `goIang` missed (`golang` not in the list). Without the word list every one of the 2 494 camelCase tokens would be a candidate. The case anomaly stays limited to the last letter (§4.5).

## 10. What these decisions break or make worse

1. **Russian words quoted in English text still fold to Latin.** Removing `к~k` cut the set but did not end it: lowercase words built only from `а е о р с у х ш г` fold whenever the other words are Latin — `I bought сор today` → `cop`, `the рос here` → `poc`, `it is сухо here` → `cyxo`, `eat уха soup` → `yxa`, `an оса flew` → `oca`, `add сахар now` → `caxap`. Of 142 815 `ru_RU` hunspell stems (≥ 2 letters, lowercase), 131 fold inside `we saw … today` (`шар` → `wap`, `хор` → `xop`, `гора` → `ropa`); 294 stems use only those letters plus `к`, so dropping `к~k` halved it. Inflected forms are not counted. `ё` folds to `ë` (`серёг` → `cepër`). `сок`, `кора`, `рука`, `кошка` no longer fold. `expectedScripts: ['Cyrillic']` suppresses it. Under `wholeScriptFold: 'foreign-letters'` or `'off'` none of them fold (§4.3); the proposed default `'all'` keeps folding them, as upstream does.
2. **No outnumber gate: one target-language fit is enough.** `кey` → `кеу` and `тap` → `тар` (Russian is the only target language that fits every letter) — nonsense or a different word, but a reader of the original sees `key`/`tap`. With no context the minority alphabet wins whenever it is the only fit (`раураl` → `paypal`, wanted; `кey` → `кеу`, not).
3. **Positional rules judge only folds into Cyrillic and Greek.** They stopped `paᏏy` → `раЬу`; a step-5 fold into an alphabet with no rules (Latin, Armenian, Cherokee, Coptic) is still unchecked. No corpus case or probe reaches that (§4.2).
4. **Target languages decide what can be fixed.** With the final defaults (English, Russian, Ukrainian, Greek) Latin letters in a Greek word (`Kαλημέρα`) or a Ukrainian word (`сiла`) fold back; a language not enabled (Serbian `ј`, Macedonian `ѕ`, Kazakh `қ`) is only evidence, and its words with Latin letters stay mixed. A Russian word with a Latin `i` folds to Ukrainian (`мiр` → `мір`). (Armenian/Cherokee/Coptic are donors, never targets, so `now` is a clean context word; `THE` is not — it fits Russian `ТНЕ`.)
5. **Case anomaly sees only the last letter** (mid-word rule dropped, §9.5). `paypaI`, `gmaiI`, `раураӏ`, `раураІ` are caught; `goIang`, `appIe` (I-shaped capital inside, followed by lowercase) are indistinguishable from camelCase (`getId`) and pass. A random ID or mojibake ending in `I` after lowercase letters is flagged.
6. **Palochka languages are approximated.** `ӏ` is allowed after `г д к л п т ф х ц ч ш щ ж с з`; Chechen also writes it after vowels (`маӏа`). Such words get evidence; they stay unflagged only when no other alphabet fits them.
7. **Orthography evidence needs ≥ 2 letters and only positional rules.** Misspellings that swap `ь`/`ъ` are deliberately not judged; a spoof that only swaps them (`подъезд` ↔ `подьезд`) is invisible to these rules. Dictionaries cover stems, not inflected forms.
8. **Whole-script attacks in their own script's context pass** without evidence (a Cyrillic `СОСА` next to a Russian word stays Cyrillic); `раураl` alone now folds (§4.4b).
9. **Hyphen partners outrank neighbours.** A part of a hyphen compound is judged by its partners only: `СОСА-COLA` → `COCA-COLA` even inside Russian text; `СОСА-СОЛА` stays Cyrillic even inside English text.
10. **Descender twins are font-dependent by design.** `χ`~~`x` fails the baseline-clip test in all 8 fonts but is on by default (owner's font); `η ŋ ɳ`~~`n` are identical only in some sans fonts and are off. Callers pick the set; a different default changes which Greek/Tajik letters are proof letters.
11. **Tajik and Uzbek are modelled only by letter set** (needed once `ҳ` became a model letter); no positional rules, no dictionary measurement (no Tajik/Uzbek Cyrillic hunspell list on this host).
12. **No partial folds.** `Пpивеt` stays `Пpивеt`; `quіск` stays `quіск` (`к` is a proof letter; the existing fixture `test/analyze.test.ts:7` expects `quick` — default mode only, see §13).
13. **Silent soft hyphens** lose three corpus must_flag cases (§8).
14. **Latin extras as donors fold IPA.** An IPA transcription made of donor letters (`ɡɪ` → `gi`) is folded; dotless `ı` and `þ` are kept out of the donors so Turkish and Icelandic stay intact, which leaves `ı`-spoofs (`Lınkedin`) unfolded (§3.4).
15. **Italic twins break Russian words in Latin context** when enabled (`Wi-Fi-роутер` → `Wi-Fi-poymep`, `по e-mail` → `no e-mail`, §3.3); off by default.
16. **Opt-in default** (Q7) means none of this changes upstream behaviour unless the caller asks for it — callers who forget the flag keep `Πpᴎbet`.

## 11. API changes

All additive; default behaviour stays upstream-identical (owner decision). Two opt-in options, plus sub-options of the resolver:

| change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | compatibility                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AnalyzeOptions.confusionModel?: 'latin' \| 'alphabet'`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | default `'latin'` (upstream fold). `'alphabet'` enables the resolver of §4                                                                                                                                          |
| `AnalyzeOptions.hiddenChars?: 'lenient' \| 'strict'`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | default `'lenient'` (upstream). `'strict'` enables the rules of §7.1, `counts.hiddenWords` and `hidden`                                                                                                             |
| `AnalyzeOptions.wholeScriptFold?: 'off' \| 'foreign-letters' \| 'all'`                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | only with `confusionModel: 'alphabet'`; default `'all'` (owner, confirmed; matches upstream's whole-script fold; §4.3)                                                                                              |
| `AnalyzeOptions.conditionalTwins?: ReadonlySet<ConditionalTwinId>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | only with `confusionModel: 'alphabet'`; default `{'χ~x','χ~х','ҳ~x','ҳ~χ'}` (§3.3); ids `η~n` `ŋ~n` `ɳ~n` (descender) and `и~u` `т~m` `п~n` (italic) opt-in; export `CONDITIONAL_TWINS` lists them                  |
| `AnalyzeOptions.targetLanguages?: readonly TargetLanguage[]`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | only with `confusionModel: 'alphabet'`; default `['English', 'Russian', 'Ukrainian', 'Greek']` (owner, final); any language of `TARGET_LANGUAGES`                                                                   |
| `AnalyzeOptions.donorAlphabets?: readonly DonorAlphabet[]`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | only with `confusionModel: 'alphabet'`; default: every alphabet no target language uses (`Armenian`, `Cherokee`, `Coptic`, `LatinExtra` with the default targets); an alphabet left out is outside the model (§3.4) |
| `WordFinding.normalized?: string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | additive; the word after resolution/cleanup. Callers render `` `${f.normalized} (${f.word})` ``                                                                                                                     |
| `WordFinding.resolution?: { class: 'confusable' \| 'mixed'; script: ScriptName \| null; rule: 'neighbours' \| 'window' \| 'word-majority' \| 'any-valid' \| 'case-anomaly' \| 'evidence' \| 'descender' \| 'hyphen' \| 'no-valid-alphabet'; folded: boolean; wouldBe?: ScriptName; context: { neighbours: ScriptName \| null; window: ScriptName \| null }; candidates: ScriptName[]; rejected: Partial<Record<ScriptName, string>>; evidence?: { kind: 'foreign' \| 'case' \| 'orthography' \| 'descender'; letters?: string; rule?: string } }` | additive; only with `confusionModel: 'alphabet'`. `rule` = the ladder step that decided (§4.2); `folded: false` for kept confusable words and all mixed words                                                       |
| `counts.hiddenWords`, `counts.confusableWords`, `counts.mixedWords`                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | additive, always present (0 in lenient mode for `hiddenWords`; 0 for the others without `confusionModel: 'alphabet'`); breaks only deep-equality assertions on `counts`                                             |
| `AnalysisResult.hidden?`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | additive, strict mode only                                                                                                                                                                                          |
| `HiddenCharRules.reportContent?`, action `'remove-with-content'`, `hidden.content?`, class `bidiOverrideSpan`                                                                                                                                                                                                                                                                                                                                                                                                                                     | additive, §18                                                                                                                                                                                                       |
| exports `CONFUSION_ALPHABETS`, `TARGET_LANGUAGES`, `CONDITIONAL_TWINS`, `twinsOf(ch)`, `resolveWord(word, ctx)`, `RU_CASE_ENDINGS`                                                                                                                                                                                                                                                                                                                                                                                                                | additive                                                                                                                                                                                                            |
| `ZERO_WIDTH_INERT_RUN`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | unchanged in lenient mode; in strict mode the same value 4 means "≥ 4 is a payload"                                                                                                                                 |
| `WordFinding.skeleton`, `dominantScript`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | unchanged                                                                                                                                                                                                           |

Data: the generator emits `src/data/confusion.generated.ts` (packed `cp>alphabetBitmask:targetCp,…`, all 650 letters of the N + M alphabets, §3.4; target restriction and conditional twins are applied at resolver construction) from `confusables.generated.ts` + overrides; the overrides live in a checked-in `scripts/confusion-overrides.json` so a Unicode refresh re-derives without losing them.

## 12. Performance

`test/performance.test.ts` budgets 250 ms for a 132 k-character corpus (2 000 paragraphs, one third spoofed) and < 8× time for 4× input. Measured on this host (Node 20.19, median of 7):

| step                                                                                       | ms      |
| ------------------------------------------------------------------------------------------ | ------- |
| current `analyze` (v0.4.0)                                                                 | 119–124 |
| prototype `resolveText`, whole corpus (re-tokenizes, NFD + regex script lookup per letter) | 146     |
| prototype `cleanup` as written (whole-text `\p{RGI_Emoji}` scan)                           | 173–180 |
| sparse hidden-run regex over the whole text                                                | 0.5     |
| `\p{RGI_Emoji}` scan over the whole text                                                   | 111     |

The prototypes are not the implementation; inside `analyze` the costs shrink:

- `\p{RGI_Emoji}` runs only locally: a sticky match a few code points before each hidden run that touches a pictograph. Hidden-run discovery is the 0.5 ms sparse scan.
- The resolver reuses `analyze`'s tokens and its `primaryScript` cache. Context: one pass marks clean words (a twin lookup per letter of each single-script token); step 1 = nearest clean index left/right (two linear sweeps); step 2 = a sliding ±10-token window of clean-word letter counts (prefix sums per alphabet, O(1) per word). Target validity folds the word once per valid alphabet and runs the language check (letter sets + a few positional rules), only for mixed or evidence words.
- Estimate: +10–25 ms on this corpus, about 135–150 ms total: inside 250 ms and linear. The ceiling's headroom on this host is about 1.7×, thinner than its comment ("well under 50ms") suggests.

**Measured as built** (`node --expose-gc scripts/bench-analyze.mjs`, Node 20.19; middle of 3 runs, each the median of 9 calls; heap = growth during one call before GC). Inputs: the `test/performance.test.ts` corpus (132 k chars) and ~1 MB mixed EN/RU Markdown with the corpus inputs sprinkled in (`scripts/realistic-text.mjs`).

| build / options                                        | perf corpus                 | ~1 MB EN/RU Markdown        |
| ------------------------------------------------------ | --------------------------- | --------------------------- |
| upstream v0.4.0                                        | 145 ms, 1.06 MB/s, +12.7 MB | 724 ms, 1.38 MB/s, +24.4 MB |
| `feat/confusion-model`, defaults                       | 28 ms, 5.5 MB/s, +14.9 MB   | 117 ms, 8.5 MB/s, +10.7 MB  |
| `confusionModel: 'alphabet'` + `hiddenChars: 'strict'` | 43 ms, 3.6 MB/s, +13.9 MB   | 63 ms, 15.8 MB/s, +18.9 MB  |
| `confusionModel: 'alphabet'` only                      | 49 ms                       | 89 ms                       |
| `hiddenChars: 'strict'` only                           | 39 ms                       | 99 ms                       |

**Re-measured after the five upstream-bound fixes** (curly apostrophe, CSI sequences, emoji-adjacent payloads, variation selector supplement, per-letter script exemption; `d2b0ce5`), same method and host, upstream measured in the same session:

| build / options                                        | perf corpus         | ~1 MB EN/RU Markdown | vs upstream (perf / 1 MB) |
| ------------------------------------------------------ | ------------------- | -------------------- | ------------------------- |
| upstream v0.4.0                                        | 125.3 ms, 1.23 MB/s | 700.3 ms, 1.43 MB/s  | 1× / 1×                   |
| defaults                                               | 30.8 ms, 4.99 MB/s  | 127.3 ms, 7.86 MB/s  | 4.1× / 5.5×               |
| `confusionModel: 'alphabet'` + `hiddenChars: 'strict'` | 39.5 ms, 3.89 MB/s  | 80.2 ms, 12.48 MB/s  | 3.2× / 8.7×               |
| `confusionModel: 'alphabet'` only                      | 55.0 ms             | 74.8 ms              | 2.3× / 9.4×               |
| `hiddenChars: 'strict'` only                           | 33.2 ms             | 144.6 ms             | 3.8× / 4.8×               |

The fixes cost the defaults about 7 ms on the perf corpus and 13 ms on 1 MB (23 / 114 ms before them, same session): per-letter judging of words with invisibles or marks, and emoji-sequence matching around standalone invisibles (local to the emoji run around each one).

`test/performance.test.ts` budgets with both options: perf corpus < 250 ms, linear scaling < 8×, long tokens < 250 ms; 1 MB input: defaults < 700 ms, both options < 1050 ms (1.5× upstream) and < 1.5× defaults.

The file runs as its own vitest project (`performance`, `vitest.config.ts`), one file at a time and after every other file has finished (`sequence.groupOrder`), so parallel test files do not skew its timings. Ratio tests time their two sides in turn (small, large, small, …) and compare the medians of the two series, so a burst of host load hits both.

## 13. Existing tests that change

Only with the opt-in options; with defaults the suite is unaffected (294/294 pass, `src/` unchanged).

| test                                                                                     | change under `hiddenChars: 'strict'` / `confusionModel: 'alphabet'`                                                        |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `test/invisible.test.ts:278-285` isolated ZW run                                         | `spoofed` stays `false`; `normalized` becomes `'free  money'`                                                              |
| `test/invisible.test.ts:295-301` inert-run threshold                                     | a run of exactly 4 becomes a counted payload; the `inert` case must use 3                                                  |
| `test/invisible.test.ts:144-150` soft hyphen + U+180E                                    | `normalized` unchanged; `invisible` still set (by U+180E); `hiddenWords` 1                                                 |
| `test/invisible.test.ts:310-326` emoji sequences                                         | unchanged; add negative twins (tags/VS/ZW payload after a non-flag emoji, double ZWJ)                                      |
| `test/invisible.test.ts:202` `hi`+VS2–VS6+`there`                                        | still removed; class `variationSelector`                                                                                   |
| `test/readme.test.ts:62` `expect(r.counts).toEqual({ wordsTotal: 4, wordsAffected: 5 })` | `toMatchObject`, because `counts` gains fields even in default mode                                                        |
| `test/analyze.test.ts:129-134` `Ivа’s`                                                   | still `mixed_script`; `normalized` keeps `’`                                                                               |
| `test/analyze.test.ts:162-168` `НОТ deal today`                                          | still `spoofed` (context `deal today` is Latin)                                                                            |
| `test/analyze.test.ts:7` `quіск` fixture                                                 | flagged but left as `quіск` (`к` is a proof letter; no valid alphabet)                                                     |
| `test/known-gaps.test.ts:90-104` standalone `аррӏе`                                      | no longer a gap: foreign-letter evidence `ӏ` removes Cyrillic, step 5 folds it to `apple` (§4.7); the known-gap test flips |

## 14. Test plan

- **Corpus**: `cases.json` (294 cases) is the acceptance corpus, scored per category as in §8. The 6 owner-vs-corpus cases are recorded as expected deviations; the 10 inherited and 12 HTML-entity cases stay listed as known gaps.
- **Table**: snapshot of the derived Latin/Cyrillic/Greek tables; each override must change the raw derivation (an override that no longer matches the data fails loudly after a Unicode refresh).
- **Resolver, per rule**: every row of §4.7 as a fixture, asserting `normalized`, `rule`, `class`, and `counts.confusableWords` / `counts.mixedWords`; every row of the §4.3 mode table under each mode.
- **Descender twins**: each id on and off (`χbox`, `ҳbox`, `ŋame`, `ηame`), default set as in §3.3; Tajik `ҳа` stays unflagged.
- **Hyphen compounds**: `СОСА-СОЛА` unchanged and unflagged, `СОСА-COLA` → `COCA-COLA`, `Wi-Fi-роутер` and `Docker-контейнер` unchanged.
- **False positives**: the `CASE_LEGIT` list of `scripts/measure-false-positives.mjs` stays unflagged; corpus legit Cyrillic/Greek rows carry no evidence; a dictionary sample per modelled language (§4.6 table) carries none.
- **Rendering**: `words[i].normalized` and `words[i].word` give `Привет (Пpивет)`.
- **Hidden chars**: every row of §7.3, asserting `normalized`, `hiddenWords`, per-finding `removed`, `payloads[].decoded` / `bytesHex`; the legitimate-text sweep at `test/invisible.test.ts:328-356` must stay `changed: false` (it does in the prototype: 13/13 unchanged, Trojan Source line cleaned).
- **Defaults**: the existing suite unchanged with no options.
- **Property tests**: random Russian/English/Greek words with one injected lookalike letter: when the original contains a proof letter and has ≥ 3 letters, the resolver returns the original; the judged word never changes its own context majority.
- **Performance**: existing three tests with both options on; add a corpus line with emoji + tag payload so the RGI path is exercised.

## 15. Decisions (final)

The design is closed (owner, round 7). Every decision below is reflected in the prototypes and in §8.

| area               | decision                                                                                                                                                                                                       | section          |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| twin table         | UTS #39 derivation + `ω`~~`w`; not `к`~~`k`, `κ`~~`k`, `п`~~`n`; `ш`↔`w`, `σ`↔`o` kept                                                                                                                         | §3.2             |
| conditional twins  | per-pair set; on: `χ~x` `χ~х` `ҳ~x` `ҳ~χ`; off: `η~n` `ŋ~n` `ɳ~n` `и~u` `т~m` `п~n` `ı~i` `ҫ~c` `ɽ~r` `ʐ~z`                                                                                                    | §3.3             |
| targets × donors   | targets `English`, `Russian`, `Ukrainian`, `Greek`; donors = every other alphabet of the table (Armenian, Cherokee, Coptic, Latin extras) and non-target letters of target scripts; `ı` and `þ` are not donors | §3.4             |
| context            | the judged word and confusable/flagged words never vote; hyphen partners, then both neighbours, then ±10-token window in the paragraph                                                                         | §4.1, §4.2       |
| ladder             | hyphen/neighbours → window → word majority → any valid alphabet; **no outnumber gate**                                                                                                                         | §4.2             |
| whole-script words | `wholeScriptFold` `'off'` / `'foreign-letters'` / `'all'`, default `'all'`                                                                                                                                     | §4.3             |
| target validity    | language level: every letter after folding in one enabled target language, positional rules included                                                                                                           | §4.4b            |
| evidence           | foreign lookalike letters (§4.4), I-shaped final letter after lowercase (§4.5), positional spelling rules (§4.6), donor-only words (§3.4)                                                                      | §4.4–4.6         |
| counters           | `hiddenWords`; `confusableWords` (some alphabet fits the whole word); `mixedWords` (none fits)                                                                                                                 | §7.2             |
| hidden characters  | rule set of §7.1; zero-width run touching a word on either side is counted; soft hyphen silent; ZWNJ in Latin removed + counted; Thai ZWSP removed                                                             | §7.1             |
| dropped            | digits (§9.4); mid-word I-for-l (§9.5); Hebrew final-form rule is defined but not wired                                                                                                                        | §9.4, §9.5, §4.6 |
| corpus             | `whole_script-003` `СОСА-СОЛА` is must_not_flag (Russian)                                                                                                                                                      | §8               |
| defaults           | both options opt-in (`confusionModel: 'alphabet'`, `hiddenChars: 'strict'`); default behaviour upstream-identical                                                                                              | §11              |

## 16. Known gaps (one place)

Corpus, 26 failing cases (`226/26`, `src/` as built; §8 scores the prototypes). `control_char-003` (ANSI escapes) passes since the CSI fix was merged (whole control sequences are stripped); every mode gained that one case:

- **Owner decision vs corpus** (6): soft hyphen silent (`hidden_format-001/002/003`, `prompt_injection-005`), ZWNJ in `Auf‌lage` (`zero_width-016`), Thai ZWSP (`zero_width-029`).
- **Inherited from upstream** (8): scientific notation `Δt = 5 μs`, `Σxᵢ` (`legit_greek-004/007`, flagged as mixed); mixed Hebrew/Latin/Arabic token (`bidi-015`); zalgo normalization (`zalgo-002`); styled text (`styled-004`; `styled-015` `ſecure` → `fecure` where the corpus wants `secure`); mixed-number tokens (`mixed_numbers-001/003`).
- **Out of scope** (12): `html_entity-*` — entities are not decoded.

Design gaps (no corpus case, or accepted by decision):

- Russian words quoted in English text fold to Latin under `'all'` (`сор` → `cop`, 131 dictionary stems); use `'foreign-letters'` or `expectedScripts` (§10.1).
- One target-language fit is enough: `кey` → `кеу`, `тap` → `тар`; `мiр` → Ukrainian `мір` (§4.4b).
- `иser`, `тail`, `admiп` stay mixed unless the italic/`и~u` twins are enabled; enabling `т~m` `п~n` breaks Russian words in Latin context (`роутер` → `poymep`) (§3.3).
- Mid-word I-for-l (`goIang`, `appIe`) — no rule without a dictionary (§9.5); case anomaly only at the last letter (§4.5).
- Dotless-`ı` spoofs (`Lınkedin`) are caught only with `ı~i` on, which breaks Turkish (§3.4).
- Digit spoofs (`g00gle`, `paypa1`) — dropped (§9.4).
- `χ`~`x` is on although it fails the baseline-clip test (font-dependent, §3.3).
- IPA transcriptions made of donor letters fold (`ɡɪ` → `gi`) (§3.4).
- Palochka after a vowel (Chechen `маӏа`) carries evidence; harmless only while no other alphabet fits (§4.4).
- Tajik/Uzbek modelled by letter set only; Greek/Hebrew positional rules cover final sigma / final forms only; Hebrew rule not wired (§4.6).
- Whole-script words in their own script's context stay (`СОСА` next to a Russian word); a hyphen partner outranks the neighbours (§10.8–9).
- Swapped `ь`/`ъ` spoofs are not judged (owner: no rule that tells them apart) (§4.6).
- Partial folds are gone: `Пpивеt`, `quіск` stay as written (§10.12).
- A byte per Han letter in valid selectors (`辻\u{E0151}辻\u{E0152}`) and one zero-width bit per letter are not seen as payloads (§18.5).
- Overprint controls and terminal strings are not reported (§19).

## 17. Implementation in `src/` (as built)

Behind the two opt-in options; with defaults the existing 294-test suite must stay green at every step.

**Modules**

| module                                                               | content                                                                                                                                                                                                                  | from prototype                       |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| `scripts/generate-confusion.mjs` → `src/data/confusion.generated.ts` | the 650-letter table of §3.4: per code point an alphabet id and its twins (packed `cp>alphabet:twin,twin;…`), curated additions, conditional pairs tagged with their id; overrides in `scripts/confusion-overrides.json` | `derive-confusion-table.mjs`         |
| `src/languages.ts`                                                   | `LANGUAGES` (letter sets per language), `TARGET_LANGUAGES`, `ORTHOGRAPHY` positional rules, `RU_CASE_ENDINGS`                                                                                                            | `prototype-resolve.mjs` top half     |
| `src/confusion.ts`                                                   | `createConfusionModel({ targetLanguages, donorAlphabets, conditionalTwins })` → cached model: `twinIn`, `scriptOf`, `languageViolation`, `caseAnomaly`, `inspect(word)`                                                  | `makeResolver` minus `resolveText`   |
| `src/resolve.ts`                                                     | `resolveWords(tokens, model, opts)`: clean-word marking, hyphen compounds, neighbours, ±10 window (prefix sums), ladder, whole-script modes, fold                                                                        | `resolveText`                        |
| `src/hidden.ts`                                                      | strict hidden-character cleanup, counters, payload decoders                                                                                                                                                              | `prototype-cleanup.mjs`              |
| `src/analyze.ts`                                                     | wire both behind `confusionModel: 'alphabet'` / `hiddenChars: 'strict'`; reuse its tokenizer and `primaryScript` cache; keep the upstream path for words outside the model (zalgo, styled, illegal)                      | `prototype-corpus.mjs` `forkAnalyze` |
| `src/types.ts`, `src/index.ts`                                       | options and result fields of §11; exports `TARGET_LANGUAGES`, `CONDITIONAL_TWINS`, `CONFUSION_ALPHABETS`, `RU_CASE_ENDINGS`                                                                                              | —                                    |

**Options** (all under `AnalyzeOptions`): `confusionModel: 'latin' | 'alphabet'` (default `'latin'`), `hiddenChars: 'lenient' | 'strict'` (default `'lenient'`), `wholeScriptFold: 'off' | 'foreign-letters' | 'all'` (`'all'`), `targetLanguages` (`['English','Russian','Ukrainian','Greek']`), `donorAlphabets` (all non-target), `conditionalTwins` (`{'χ~x','χ~х','ҳ~x','ҳ~χ'}`), `expectedScripts` (existing). Result: `WordFinding.normalized`, `WordFinding.resolution`, `counts.hiddenWords/confusableWords/mixedWords`, `hidden`.

**Order of work** (one commit per step, each green; branch `feat/confusion-model`):

1. Generator + `confusion.generated.ts` + snapshot test of the Latin/Cyrillic/Greek tables (§5) and table sizes (650 letters, 643 pairs); a test that every override still changes the raw derivation.
2. `languages.ts` + `confusion.ts` with unit tests: twins per case, target restriction, conditional ids on/off, positional rules, foreign-letter and case-anomaly evidence (the `CASE_LEGIT` list stays clean).
3. `resolve.ts` with fixtures for every row of §4.7 and the mode table of §4.3; property test: a random Russian/English/Greek word with one injected lookalike resolves to the original when the original holds a proof letter.
4. `hidden.ts` with every row of §7.3 and the legitimate-text sweep (`test/invisible.test.ts:328-356` unchanged).
5. Wire into `analyze.ts` behind the options; update the tests listed in §13 (`toMatchObject` on `counts`, opt-in variants).
6. **Corpus test**: port `prototype-corpus.mjs` scoring into `test/corpus.test.ts` over a vendored copy of `cases.json` (or a fixture path); assert `224/28` with the 28 known-gap ids of §16 listed explicitly (a newly failing id fails the test, a newly passing one prompts moving it out of the list); assert upstream mode still scores `206/46`.
7. Performance: the three tests of `test/performance.test.ts` with both options on (budget 250 ms; estimate §12), plus a line with emoji + tag payload and hyphen compounds.
8. README section for the options; the measurement scripts stay in `scripts/` as evidence.

**Test data**: `cases.json` (corpus), hunspell stems for the positional-rule false-positive check (not vendored; `scripts/measure-false-positives.mjs` documents the run), probe list of `prototype-resolve.mjs` as resolver fixtures.

### 17.1 Deviations from the plan

| area                       | as built                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | why                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| hidden-character rules     | `hiddenCharRules`: 15 per-class settings on top of `hiddenChars: 'strict'` (`STRICT_HIDDEN_RULES` = the §7.1 rule set): `softHyphen`, `leadingBom`, `isolatedZeroWidth`, `wordBreakHint`, `joinerInWord`, `zeroWidthInWord`, `zeroWidthRun` (actions `'remove-counted'` / `'remove-silent'` / `'keep'`), `zeroWidthRunThreshold` (4), `bidiOverrides`, `bidiMarks`, `bidiMarksInRtlText` (`'keep'`), `variationSelectors`, `tags`, `blankFillers`, `otherInvisibles`, `decodePayloads` (true). Joiners in joining scripts, one valid selector and RGI emoji sequences are always kept | owner: the rules must be configurable; `'lenient'` stays upstream                                   |
| extra invisibles in strict | strict also removes (counted, `otherInvisible`) U+17B4/17B5 outside Khmer, U+110B1 outside Kaithi, U+13430–1343F, U+1BCA0–1BCA3, U+1D173–1D17A                                                                                                                                                                                                                                                                                                                                                                                                                                        | strict disables upstream's invisible detection, which flags these; the prototype does not list them |
| rule names                 | `resolution.rule`: `hyphen`, `neighbours`, `window`, `word-majority`, `any-valid`, `case-anomaly`, `conditional-twin` (not `descender`), `evidence`, `no-valid-alphabet`; evidence kinds `foreign`, `case`, `orthography`, `donor`, `conditional`                                                                                                                                                                                                                                                                                                                                     | as in the prototype                                                                                 |
| `resolution` shape         | `script` is a `ConfusionAlphabet` or null; no `wouldBe`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | the prototype produces no `wouldBe`                                                                 |
| signals                    | a resolver finding carries `mixed_script` when its Unicode scripts mix, else `confusable_word`. A word with a hidden character and a lookalike gets two findings (resolver finding, then `invisible`). Words with letters outside the model go to the upstream path unfiltered; a non-Latin model word gets no upstream skeleton fold even with zalgo                                                                                                                                                                                                                                 | one finding per concern; the prototype pipeline's static filters replaced by per-token authority    |
| data format                | `confusion.generated.ts`: `ALPHABET_LETTERS_PACKED` (letters per alphabet, hex, in fold order), `TWIN_PAIRS_PACKED` (`a.bT`, T = `u` UTS #39, `x` cross-case, `c` curated), `CONDITIONAL_TWIN_DATA` per id                                                                                                                                                                                                                                                                                                                                                                            | pairs once instead of per-letter adjacency                                                          |
| §4.7 rows                  | `add сахар now` is decided by `neighbours` (not `window`); `ηame` is flagged mixed (left as written)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | prototype output                                                                                    |
| exports                    | `twinsOf(ch, options)`, `resolveWord(word, context, options)`, `STRICT_HIDDEN_RULES`, `PAYLOAD_HEX_CAP`, `DEFAULT_TARGET_LANGUAGES`, `LANGUAGES` added                                                                                                                                                                                                                                                                                                                                                                                                                                | —                                                                                                   |
| default path               | `analyze` rewritten for speed (one scan pass, per-code-point tables, token spans); output identical to v0.4.0 on the corpus, the 1 MB input and 80 000 random strings. Non-string input throws an explicit `TypeError`                                                                                                                                                                                                                                                                                                                                                                | performance (§12)                                                                                   |

Corpus as built (`test/corpus.test.ts`): upstream v0.4.0 206/46, default options (upstream rules plus the fixes sent upstream) 210/42 (`control_char-003`, `tag_chars-007`, `variation_selector-011/013`); alphabet + strict 226/26 (the ids of §16); with `hiddenCharRules: { softHyphen: 'remove-counted', wordBreakHint: 'keep' }` 230/22 (recovers hidden_format-002/003, prompt_injection-005, zero_width-029); `wholeScriptFold` `'off'` 222/30, `'foreign-letters'` 225/27. Each mode is one case up on the scores before the CSI fix (`control_char-003`).

## 18. Hidden content

### 18.1 API

Opt-in. Without `reportContent` or a `remove-with-content` rule, no field is added and no code runs (`test/hidden-content.test.ts` compares both over the corpus).

```ts
type HiddenContentAction = HiddenAction | 'remove-with-content'; // bidiOverrides, tags, variationSelectors, zeroWidthRun, markStacks, markStacksOther

interface HiddenCharRules {
  // …
  reportContent?: boolean; // default false; on whenever a rule is 'remove-with-content'
}

interface HiddenReport {
  // …
  content?: HiddenContent[]; // `cleanHidden(...).content`, `analyze(...).hidden.content`
}

interface HiddenContent {
  kind: HiddenContentKind;
  index: number; // start, UTF-16 offset into the input
  end: number; // end, exclusive
  length: number; // code points: the carriers of an encoded run; a bidi or mark-stack entry whole
  text: string | null; // decoded, or the span in logical order without bidi controls
  readable: boolean; // text is printable (encoded) or has a visible character (bidi, mark-stack)
  removed: boolean; // gone from `cleaned`
  bytesHex?: string; // an encoded run with no text: first 32 bytes
  parts?: { start: number; end: number }[]; // one payload over several runs
}
```

`content` is reported whatever the rules do: an entry the rules keep has `removed: false`. `decodePayloads` governs `payloads` only.

| kind                 | what                                                                                                                                                            | removal                                         |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `tag`                | tag characters outside RGI sequences, decoded as ASCII                                                                                                          | rule `tags`                                     |
| `variation-selector` | selectors past a valid first one, and orphans, decoded as bytes; a lone one has `bytesHex`                                                                      | rule `variationSelectors`                       |
| `zero-width-binary`  | a zero-width run of ≥ threshold with a two-symbol reading                                                                                                       | rule `zeroWidthRun`                             |
| `zero-width-run`     | the same run with no reading                                                                                                                                    | rule `zeroWidthRun`                             |
| `invisible-run`      | a run of ≥ threshold mixing other invisibles (U+2062/U+2064 bits, fillers, soft hyphens, bidi controls outside RTL text), decoded as bits if it has two symbols | each character's own rule                       |
| `mark-stack`         | letters with more marks than their script writes (§18.6); `text` is the letters with the marks kept                                                             | rules `markStacks`, `markStacksOther`           |
| `bidi-override`      | an LRO/RLO that reverses letters or digits (§18.2)                                                                                                              | with `bidiOverrides: 'remove-with-content'`     |
| `bidi-mark-reorder`  | an RTL embedding or isolate whose RLM/ALM swaps Latin words, in a span with no RTL letter (`‫abc‏ def‬` shows `def abc`)                                        | never with content; its controls by their rules |

**Scattered payloads.** Consecutive runs of one encoded kind merge into one entry when each has at most 2 carriers (16 for zero-width binary) and at most 32 code units lie between them: one selector per letter, one tag per word. `text` is the whole payload, `parts` the ranges to highlight or remove.

### 18.2 What counts as a bidi span

The stack follows the explicit-level rules of UAX #9 (X1–X8), without the depth limit. A frame ends at its PDF, at the PDI of an enclosing isolate, or at the end of the paragraph (LF, CR, U+0085, U+2029, FS, GS, RS; not U+2028); a PDF inside an isolate cannot close what is outside it. An embedding or isolate inside an override counts as one unit to it. Of nested spans of one kind, the outermost reversing one is reported.

An override is a span when it **reverses letters or digits**:

- two letters or digits in a row against the forced direction: Latin or digits under RLO, Hebrew or Arabic under LRO; a letter with the forced direction restarts the count;
- an RLO with no RTL letter and at least two visible characters (`‮!?‬`).

Text that already goes that way shows as it would without the override, so nothing is hidden, and one letter alone has no order to reverse:

| input                        | Chrome, in the text's own direction | span |
| ---------------------------- | ----------------------------------- | ---- |
| `‮gnp.exe‬`                  | `exe.png`                           | yes  |
| `‭שלום עולם‬`                | letters reversed                    | yes  |
| `‮שלום world‬`               | `dlrow` beside the Hebrew           | yes  |
| `‮מחיר 100‬`                 | `001`                               | yes  |
| `‮שלום עולם‬`                | unchanged                           | no   |
| `‮مَرْحَبًا‬`                | unchanged                           | no   |
| `‮מחיר 5‬`, one Latin letter | unchanged                           | no   |
| `‮السعر ‭100‬ ريال‬`         | unchanged                           | no   |
| `‭+972-50-1234567‬`          | as written                          | no   |

`docs/evidence/bidi-spans.json` has all 50 samples, measured by the position of each code point in Chrome. A sample is reported if and only if Chrome shows another order than without its controls in the text's own direction, with three exceptions the test names: `‫hello!‬` (only the `!` moves), an LRO keeping a phone number as written inside Hebrew (it prevents the digit groups' swap), and an RTL isolate around real RTL letters inside Latin (ordinary mixed-direction text).

### 18.3 `remove-with-content`

- `bidiOverrides`: a `bidi-override` span goes whole, controls, isolates and marks inside it included; the rest of a Trojan Source line (`‮…` to the paragraph's end) goes with it. Removed code points count in class `bidiOverrideSpan`, the chunk counts once in `hiddenWords`. A payload inside the span is reported and needs no edit of its own. An override with no span acts as `'remove-counted'`: controls go, letters stay.
- `tags`, `variationSelectors`, `zeroWidthRun`: the run is the content, so the action is `'remove-counted'` plus the report.
- **Embeddings (U+202A, U+202B) never lose their text.** They set a direction, strong letters keep theirs: `‫שלום עולם‬` and `‫hello‬` show their letters in order, and mixed text swaps its runs the way real RTL paragraphs do. Word processors and browsers wrap RTL text in them, so removing the span would delete legitimate text. Their controls follow the rule as before.
- **Marks and isolates** are not touched outside a span: rules `bidiMarks` and `bidiMarksInRtlText` decide.

Legitimate RTL text survives: `test/hidden-content.test.ts` runs 28 Hebrew, Arabic, Persian and mixed-direction samples, with and without overrides, embeddings, isolates and marks, and asserts no entry and every letter kept.

### 18.4 Words broken by zero-width characters

Not hidden content: there is nothing behind the character. `fr​ee` → `free`, with `findings` and counters as before and no entry in `content`. `joinerInWord`, `zeroWidthInWord`, `isolatedZeroWidth`, `wordBreakHint` and `softHyphen` do not accept `remove-with-content` by type; at runtime the value acts as `'remove-counted'`. A run at the threshold is content (`fr` + 4 ZWSP + `ee` has a `zero-width-run` entry) and only the run goes: the mode never removes a letter for a zero-width character.

### 18.5 Known gaps

- Valid selectors carry no entry, so a byte per Han letter passes (`辻\u{E0151}辻\u{E0152}`). One zero-width bit per letter is a broken word to §18.4.
- `text` of a very long payload is not capped.
- Overrides nested past depth 125 do nothing on screen and are still reported.

U+061C alone is no RTL text: `RTL_RE` skips it, so `abc\u061C def\u200E` loses both marks, while Arabic and Hebrew text keeps its marks, U+061C included.

### 18.6 Mark stacks

Many marks on a letter make a line unreadable to a person long before they cover it, while a model reads the letters as they are. So a stack past what the script writes is hiding, and is judged per base, by the base's own script: one RTL letter in a word no longer exempts the rest (strict only; lenient `analyze` stays upstream).

- Rules: `markStacks` for scripts that stack marks, `markStacksOther` for those that do not (Latin, Cyrillic, Greek, Armenian, Georgian, Cherokee, Han, kana, Hangul, Common). Default `'remove-counted'`: the first marks up to the limit stay, the rest go, class `markStack`. `'keep'` leaves them and still reports. Strict `analyze` sets `markStacksOther: 'keep'`, because its `zalgo` signal already judges those bases and strips their word; a stack it trims reports signal `zalgo`, not `invisible`.
- Counted through hidden characters, so CGJ, a joiner or a selector cannot split a stack. Variation selectors and invisible marks are not counted as marks.
- Limits: `MARK_STACK_LIMITS`, override by `markStackLimits`; a script not named gets `MARK_STACK_DEFAULT_LIMIT` (5). Corpus: `zalgo-003`, a Thai stack, now passes.

| script                                                     | limit | deepest real writing tested                                   |
| ---------------------------------------------------------- | ----- | ------------------------------------------------------------- |
| Thai, Lao                                                  | 3     | vowel + tone, 2                                               |
| Arabic, Syriac, N'Ko, Thaana, Mongolian                    | 5     | Quran: shadda, vowel, dagger alef                             |
| Hebrew                                                     | 5     | shin dot, dagesh, vowel, accent, meteg                        |
| Indic scripts, Myanmar, Khmer, Kaithi                      | 5     | nukta, vowel, candrabindu, Vedic accent                       |
| Tibetan                                                    | 10    | Kalachakra stack, 9                                           |
| Latin, Cyrillic, Armenian, Georgian, Cherokee, CJK, Common | 2     | Vietnamese and Yoruba in NFD                                  |
| Greek                                                      | 3     | polytonic in NFD (`analyze` still calls 3 zalgo, as upstream) |

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

## 19. Text rendered over other text

Evidence: `node scripts/measure-overlap.mjs` (Chrome, DejaVu Sans, Noto Sans, Liberation Serif, DejaVu Sans Mono at 32 px; tmux 3.6 pane) → `docs/evidence/overlap.json`, `overlap.png`. `filled` = share of the blank pixels in a base letter's cell that gain ink, worst letter and font; non-covering samples read up to 13 % from layout shift and antialiasing, and a positive control (CSS `letter-spacing: -0.62em` pulling U+2588 over each letter) reads 100 %. `up`/`down` = how far ink leaves its line box, in lines. The word in every sample is benign.

| construct                                                     | measured                                                                                                 | rules today                                                                                                                    | code points alone?                                                              |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| backspace                                                     | terminal: word gone. Chrome: tofu boxes, word visible                                                    | `analyze`: `illegal`, removed. `cleanHidden`: removed, counted. The word stays in the output, not in `content`                 | yes                                                                             |
| bare CR                                                       | terminal: word gone. Chrome: line break, word visible                                                    | **no signal, kept in every mode** (the control rule exempts CR)                                                                | yes; progress-bar logs and CR line endings look the same                        |
| CSI cursor and erase: `ESC[6D`, `ESC[2K`, `ESC[1A`, `ESC[2J`  | terminal: word gone; `ESC[2J` also erases the lines above                                                | `analyze`: `illegal`, only ESC goes, `[6D` is left in `normalized`. `cleanHidden`: the sequence goes, the word stays, no entry | yes                                                                             |
| SGR hiding: `ESC[8m`, `ESC[30;40m`                            | terminal: cells hold the word in conceal or black on black                                               | same; no entry                                                                                                                 | conceal yes; color pairs only those equal by number, themes need rendering      |
| non-CSI: `ESC 7`/`ESC 8`, `ESC c`, OSC, DCS, APC              | terminal: strings swallowed; `ESC c` wipes the screen                                                    | **`cleanHidden` strips only ESC and BEL**: `]0;word`, `Pword\`, `7word8` come out as text, no entry                            | yes (ECMA-48 grammar)                                                           |
| U+009B CSI                                                    | tmux in UTF-8 prints it as a character; other terminals may not                                          | `analyze`: `illegal`. `cleanHidden`: sequence removed                                                                          | yes                                                                             |
| enclosing marks: U+20DD, U+20E0, U+20E3, U+0488, U+0489       | filled ≤ 22 % (two per letter); up 0.08; the word stays legible; U+20DD family is tofu in the fonts here | no signal below 3 per base; zalgo above                                                                                        | yes, but they cover nothing                                                     |
| overlays: U+0336, U+0338, U+20D2                              | filled ≤ 11 %, ×20 no more than ×1: they stack on one spot. Struck through, legible                      | same                                                                                                                           | yes, but they cover nothing                                                     |
| every wide mark ×20 on each letter, Hebrew letter in the word | filled 37 %: the most ink any mark sample reached                                                        | strict: `zalgo`, stripped, `mark-stack` entry. Lenient: `mixed_script` only                                                    | yes (§18.6)                                                                     |
| tall stack, Latin: U+0301 ×40                                 | up 7.4 lines, 5 % of the line above painted over in thin columns                                         | strict: `zalgo`, stripped, also with a Hebrew letter in the word; `mark-stack` entry. Lenient: `zalgo` only without one        | yes (§18.6)                                                                     |
| tall stack, stacking scripts ×40                              | Thai up 8.0 lines, Arabic up 3.1, Tibetan subjoined down 1.7; Hebrew and Devanagari stay in the line     | strict: trimmed to the script's limit, `zalgo`, `mark-stack` entry. Lenient: no signal                                         | yes (§18.6)                                                                     |
| wide glyphs: U+FDFD, U+12031, U+2E3B                          | take their own advance, no overlap                                                                       | no signal                                                                                                                      | nothing to judge                                                                |
| blocks: U+2588, U+2591                                        | fill their own cell only; a cover needs a terminal control or CSS                                        | no signal, kept                                                                                                                | not alone: they look like redaction, cover nothing. The controls are the signal |
| RLO with line breaks, U+2028                                  | no ink over another line: bidi reorders inside a line                                                    | `invisible`; §18                                                                                                               | no overlap to judge                                                             |
| overlap format controls: U+1BCA0, U+13430–1343F               | tofu here: no font for them, overlap not observed                                                        | `invisible`; strict removes them                                                                                               | yes                                                                             |
| CSS: color, `font-size: 0`, negative spacing, positioning     | the control above                                                                                        | not seen: not in the text                                                                                                      | **no: needs rendering, out of scope**                                           |

Findings: in a browser, no code point alone covers a word, but stacks make lines unreadable without covering them, which `filled` does not measure; §18.6 treats them as hiding and measures overrun. In a terminal, controls erase text outright: that class is judged from code points and not reported today.
