# User guide

How `@cycanics/unspoof` behaves, area by area, with examples. The
[README](../README.md) has the overview and the option list; the
[technical reference](./confusion-model.md) has the look-alike tables, the rule
definitions and the evidence behind them; [performance](./performance.md) has
the measurements.

- [Reading the examples](#reading-the-examples)
- [Two stages, four modes](#two-stages-four-modes)
- [Requested languages](#requested-languages)
- [Hidden characters](#hidden-characters)
- [Terminal controls and escape sequences](#terminal-controls-and-escape-sequences)
- [Bidirectional text](#bidirectional-text)
- [HTML character references](#html-character-references)
- [Mojibake](#mojibake)
- [Look-alikes and the choice of language](#look-alikes-and-the-choice-of-language)
- [Mixed words and their categories](#mixed-words-and-their-categories)
- [Dashes, apostrophes and affixes](#dashes-apostrophes-and-affixes)
- [Digits and the multiplication sign](#digits-and-the-multiplication-sign)
- [Styled, math and other neutral characters](#styled-math-and-other-neutral-characters)
- [Turkish dotless ı](#turkish-dotless-ı)
- [Limits](#limits)
- [Callbacks](#callbacks)
- [Recipes](#recipes)
- [Errors](#errors)

## Reading the examples

Every example table (a table with an **Input** column; in the source, between
`examples` markers) is printed by
[`scripts/doc-examples.mjs`](../scripts/doc-examples.mjs), which runs each input
through the built library; a test compares these tables with the library. The
other tables (rules, options, types of characters, limits, errors) are written
by hand.

- Unless a table says otherwise, an example runs as
  `analyze(input, { hiddenChars: 'strict', confusionModel: 'language' })`.
- An **Options** column shows what a row adds to those two options; `instead:`
  marks a row that runs with other options.
- **Output** is `result.normalized`, **Spoofed** is `result.spoofed`,
  **Signals** lists the keys of `result.signals` that are `true`.
- **Reports** lists the marks the `onReport` callback received: the rule that
  marked (`kind`) and, where there is one, the hidden part (`extracted`).
- Invisible and control characters are written as escapes (`\u200B`, `\u001B`,
  `\n`). Letters are written as they are, so a look-alike looks like the letter
  it imitates: in `pаypal` the second letter is the Cyrillic `а` (U+0430).

## Two stages, four modes

`analyze` reads the text in two stages:

1. **Hidden characters.** Characters the reader does not see (zero-width
   characters, bidi controls, tag characters, escape sequences, stacked marks)
   are found by rules. Each rule either removes what it found, or only reports
   it, or is off.
2. **Words.** Each word of the cleaned text is judged for look-alike letters:
   converted, reported, or left alone.

Two options choose how each stage works:

| Option           | Value                  | Meaning                                                                                                                                                                                     |
| ---------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hiddenChars`    | `'lenient'` default    | A small fixed set of rules: invisible characters inside words and between them, stacked marks, control characters.                                                                          |
|                  | `'strict'`             | One rule per class of hidden character, each with its own mode (`hiddenCharRules`); escape sequences, mojibake, styled letters.                                                             |
| `confusionModel` | `'latin-fold'` default | The Latin-fold model: every word is compared with Latin letters through the UTS #39 confusables table, with no target languages; a look-alike is replaced by the Latin letter it resembles. |
|                  | `'language'`           | The language model: each word is resolved into one of the languages you request (`targetLanguages`), using the words around it.                                                             |

The same text in the four combinations:

<!-- examples: readme-modes -->

| Input                               | Options                                               | Output                        | Spoofed | Signals                                        |
| ----------------------------------- | ----------------------------------------------------- | ----------------------------- | ------- | ---------------------------------------------- |
| `Пpивет, fr\u200Bee НОТ dog`        | `{}`                                                  | `Πpᴎbet, free HOT dog`        | yes     | `mixed_script`, `confusable_word`, `invisible` |
| `Пpивет, fr\u200Bee НОТ dog`        | `{confusionModel: 'language'}`                        | `Привет, free HOT dog`        | yes     | `confusable_word`, `invisible`, `mixed_spoof`  |
| `Пpивет, fr\u200Bee НОТ dog`        | `{hiddenChars: 'strict'}`                             | `Πpᴎbet, free HOT dog`        | yes     | `mixed_script`, `confusable_word`, `invisible` |
| `Пpивет, fr\u200Bee НОТ dog`        | `{hiddenChars: 'strict', confusionModel: 'language'}` | `Привет, free HOT dog`        | yes     | `confusable_word`, `invisible`, `mixed_spoof`  |
| `p&#1072;ypal 1920x1080 co\u00ADop` | `{}`                                                  | `p&#1072;ypal 1920x1080 coop` | yes     | `invisible`                                    |
| `p&#1072;ypal 1920x1080 co\u00ADop` | `{confusionModel: 'language'}`                        | `p&#1072;ypal 1920×1080 coop` | yes     | `invisible`                                    |
| `p&#1072;ypal 1920x1080 co\u00ADop` | `{hiddenChars: 'strict'}`                             | `p&#1072;ypal 1920x1080 coop` | no      | —                                              |
| `p&#1072;ypal 1920x1080 co\u00ADop` | `{hiddenChars: 'strict', confusionModel: 'language'}` | `paypal 1920×1080 coop`       | yes     | `mixed_spoof`                                  |

<!-- /examples -->

In the first input `Пpивет` is a Russian word with a Latin `p`. The Latin
model replaces its letters by Latin look-alikes and produces a word of no
language; the language model restores the Russian word. `НОТ` is written in
Cyrillic letters next to an English word and becomes `HOT` in every mode.

What only some combinations do:

| Behaviour                                                                          | Needs                                         |
| ---------------------------------------------------------------------------------- | --------------------------------------------- |
| Conversion into a requested language; categories of mixed words                    | `confusionModel: 'language'`                  |
| `x` between digits written as `×`                                                  | `confusionModel: 'language'`                  |
| VT and FF written as a line feed                                                   | `confusionModel: 'language'`                  |
| Rule per class of hidden character, report kinds per rule                          | `hiddenChars: 'strict'`                       |
| Text an escape sequence conceals, and string sequences, removed with their content | `hiddenChars: 'strict'`                       |
| Mojibake reported                                                                  | `hiddenChars: 'strict'`                       |
| Styled letters read inside words (on by default)                                   | `hiddenChars: 'strict'`, or `neutralAlphabet` |
| HTML character references read                                                     | both                                          |
| Words joined by a dash or an apostrophe judged as one token with parts             | both                                          |
| The 250-character word limit                                                       | either                                        |

The rest of this guide describes the two options together, the combination
meant for text that goes to a language model.

## Requested languages

Under the language model the caller names the languages the reader reads:

```ts
analyze(text, { confusionModel: 'language', targetLanguages: ['English', 'Russian'] });
```

The default is `['English', 'Russian', 'Ukrainian', 'Greek']`. The languages
available are the keys of `TARGET_LANGUAGES`: English, European (English
letters plus `ß æ œ ø þ ð ı ł đ`), Russian, Ukrainian, Belarusian, Bulgarian,
Serbian, Macedonian, Kazakh, Tajik, Uzbek, Caucasian (Russian letters plus the
palochka) and Greek.

A target is a **language**, not a script. Russian and Ukrainian are two
languages: `і` is a Ukrainian letter and not a Russian one, `ы` is a Russian
letter and not a Ukrainian one. A word is converted only into a language that
was requested, and the result is spelled with that language's letters only.

Everything else follows from the request:

- A **look-alike** is a pair, one direction: a character that is not a letter
  of language X, and the letter of X a reader of X takes it for. The Cyrillic
  `а` is a look-alike of the English `a`; the English `a` is a look-alike of
  the Russian `а`. The pairs of each language form its _pack_
  (`defaultPacks()`).
- A **donor** is a character that is a letter of no requested language and has
  a pair into one of them: Cherokee `Ꭺ` (reads `A`), Lisu `ꓮ`, the long s `ſ`,
  the Bengali digit `৪` (reads `8`). A letter of a language that was not
  requested is a donor too: with `['English', 'Russian']` the Ukrainian `і`
  is then a letter of no requested language.
- A word written wholly in the letters of a requested language is that
  language's word. It is converted into another requested language only when
  the words around it say so (see
  [Look-alikes and the choice of language](#look-alikes-and-the-choice-of-language)).
- The **order** of the request matters when nothing else decides: the first
  language is the primary target.

What the request changes, on three inputs:

<!-- examples: lookalikes-request -->

| Input                   | Options                                   | Output                  | Spoofed | Signals                |
| ----------------------- | ----------------------------------------- | ----------------------- | ------- | ---------------------- |
| `pay with раураl today` | —                                         | `pay with раураl today` | no      | `mixed_non_legitimate` |
| `pay with раураl today` | `targetLanguages: ['English']`            | `pay with paypal today` | yes     | `mixed_spoof`          |
| `pay with раураl today` | `targetLanguages: ['Russian']`            | `pay with раураl today` | no      | `mixed_non_legitimate` |
| `ϲ`                     | —                                         | `c`                     | yes     | `confusable_word`      |
| `ϲ`                     | `targetLanguages: ['Russian', 'English']` | `с`                     | yes     | `confusable_word`      |
| `ϲ`                     | `targetLanguages: ['Greek']`              | `ϲ`                     | no      | —                      |
| `Привет мiр`            | —                                         | `Привет мір`            | yes     | `mixed_spoof`          |
| `Привет мiр`            | `targetLanguages: ['Russian', 'English']` | `Привет мiр`            | no      | `mixed_non_legitimate` |
| `НОТ dog`               | `targetLanguages: ['Russian']`            | `НОТ dog`               | no      | —                      |
| `Привіт`                | `targetLanguages: ['English', 'Russian']` | `Привіт`                | no      | —                      |
| `þing`                  | `targetLanguages: ['Russian']`            | `þing`                  | no      | —                      |

<!-- /examples -->

- `раураl` is five Russian letters and a Latin `l`. With Russian among the
  requested languages the word holds letters of two requested languages, so the
  library does not guess which one was meant: it reports the word
  (`mixed_non_legitimate`) and leaves it. With English as the only requested
  language the five letters are donors and the word is converted.
- The lunate sigma `ϲ` is a letter of no language here and has a pair into
  English (`c`) and into Russian (`с`). Alone it has no context, so the primary
  target takes it. With Greek as the only requested language the character
  stays as written.
- The Latin `i` in `мiр` has a Ukrainian twin (`і`) and no Russian one, so the
  word can only be completed as a Ukrainian word; without Ukrainian in the
  request it is reported and left.

### Converted or reported

The library converts only where the reader would misread the text, and reports
the rest:

| What is found                                                                      | What happens                                                 | Signal                 | Sets `spoofed` |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------- | -------------- |
| A whole word of look-alikes, and its context names another requested language      | converted (with `wholeScriptFold: 'off'`: kept and reported) | `confusable_word`      | yes            |
| The same, but a word next to it is a clean word of the word's own language         | kept, reported                                               | `whole_word_lookalike` | no             |
| A mixed word whose look-alike letters were converted                               | converted                                                    | `mixed_spoof`          | yes            |
| A mixed word where the other script is written without spaces (Han, kana, Thai, …) | kept, reported                                               | `mixed_legitimate`     | no             |
| Any other mixed word: the mix is visible to the reader                             | kept, reported                                               | `mixed_non_legitimate` | no             |
| A hidden character inside or beside a word, under a counting rule                  | removed                                                      | `invisible`            | yes            |
| Marks stacked on a letter past the limit of its script                             | trimmed to the limit                                         | `zalgo`                | yes            |
| A control character, an escape sequence                                            | removed                                                      | `illegal`              | yes            |
| U+FFFD, the mark a decoder leaves for bytes it could not read                      | kept, reported                                               | `encoding_damage`      | no             |
| A styled letter inside a word (`pⓐypal`), an `x` between digits                    | converted                                                    | none                   | no             |

`spoofed` is `true` when a signal of `SPOOFING_SIGNALS` fired:
`confusable_word`, `mixed_spoof`, `mixed_script` (the Latin-fold model's signal for
a mixed word), `invisible`, `zalgo`, `illegal`.

## Hidden characters

With `hiddenChars: 'strict'` every class of hidden character has a rule, and
every rule has a mode:

| Mode               | Text            | `onReport` | Signal on the word |
| ------------------ | --------------- | ---------- | ------------------ |
| `'remove-counted'` | removed         | called     | yes                |
| `'remove-silent'`  | removed         | called     | no                 |
| `'keep'`           | left as written | called     | no                 |
| `'ignored'`        | left as written | not called | no                 |

`'report'` is another name for `'keep'`, and `'cleanup'` selects the rule's
removing default. `'remove-with-content'` exists for the rules whose characters
hide other text (see [Bidirectional text](#bidirectional-text) and
[Terminal controls](#terminal-controls-and-escape-sequences)).

Every rule and setting of `hiddenCharRules`, with its value in
`STRICT_HIDDEN_RULES` (the defaults of `hiddenChars: 'strict'` and of
`cleanHidden`). Three rules belong to `analyze`, which runs them with a mode of
its own whatever the mode of `hiddenChars`; the table says which:

| Rule                     | Default            | Applies to                                                                                                                     |
| ------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `softHyphen`             | `'remove-silent'`  | U+00AD                                                                                                                         |
| `leadingBom`             | `'remove-silent'`  | U+FEFF at the start of the text                                                                                                |
| `isolatedZeroWidth`      | `'remove-silent'`  | a zero-width character with whitespace or a text edge on both sides                                                            |
| `wordBreakHint`          | `'remove-silent'`  | a zero-width character between Thai, Lao, Khmer, Myanmar, Tibetan or CJK letters                                               |
| `possibleLigatureBreak`  | `'remove-silent'`  | one ZWNJ between `f` and `f`, `i`, `l` or `t` (German `Auf\u200Clage`)                                                         |
| `joinerInWord`           | `'remove-counted'` | one ZWNJ or ZWJ between letters of a script that does not join letters                                                         |
| `zeroWidthInWord`        | `'remove-counted'` | any other zero-width character touching a word                                                                                 |
| `zeroWidthRun`           | `'remove-counted'` | `zeroWidthRunThreshold` (default 2) or more zero-width characters in a row, wherever they are                                  |
| `invisibleRun`           | `'keep'`           | a run of that length of invisible characters that are not all zero-width                                                       |
| `bidiOverrides`          | `'remove-counted'` | the embeddings and overrides U+202A–202E                                                                                       |
| `bidiOverrideSpan`       | `'keep'`           | the text an override shows in another order than it is stored                                                                  |
| `bidiReorderSpan`        | `'keep'`           | words a right-to-left embedding or isolate swaps through a direction mark                                                      |
| `bidiMarks`              | `'remove-counted'` | LRM, RLM, ALM and the isolates in a paragraph with no right-to-left letter                                                     |
| `bidiMarksInRtlText`     | `'keep'`           | the same characters in a paragraph that has right-to-left letters                                                              |
| `variationSelectors`     | `'remove-counted'` | selectors after the first valid one, and selectors that select nothing on their base                                           |
| `tags`                   | `'remove-counted'` | tag characters (U+E0000–E007F) outside emoji flag sequences                                                                    |
| `blankFillers`           | `'remove-counted'` | Hangul fillers, the Braille blank: written as a space between visible characters, removed at a word edge                       |
| `otherInvisibles`        | `'remove-counted'` | the remaining invisible format characters (U+2061–2064, U+180E, U+206A–206F, …)                                                |
| `invisibleMathOperators` | not set            | U+2061–2064 under a rule of their own, for math text; when not set they belong to `otherInvisibles`                            |
| `controlChars`           | `'remove-counted'` | C0 controls except tab, LF and CR; DEL; C1 controls                                                                            |
| `markStacks`             | `'remove-counted'` | combining marks past the limit, on a letter of a script that stacks marks (Thai, Arabic, Hebrew, Tibetan …)                    |
| `markStacksOther`        | `'remove-counted'` | the same on letters of other scripts (Latin, Cyrillic, Greek, …)                                                               |
| `mojibake`               | not set            | UTF-8 read in another encoding, see [Mojibake](#mojibake); not set: off in `cleanHidden`; strict `analyze` runs it as `'keep'` |
| `illegal`                | `'ignored'`        | control characters and noncharacters as findings of `analyze` (signal `illegal`); `analyze` runs it as `'remove-counted'`      |
| `encodingDamage`         | `'ignored'`        | runs of U+FFFD (signal `encoding_damage`); `analyze` runs it as `'keep'`                                                       |
| `invisibleOutsideWord`   | `'ignored'`        | invisible characters between words under the lenient rules; lenient `analyze` runs it as `'remove-counted'`                    |
| `markStackLimits`        | not set            | marks a letter keeps, per script, over `MARK_STACK_LIMITS`                                                                     |
| `terminal`               | not set            | see [Terminal controls](#terminal-controls-and-escape-sequences)                                                               |
| `seamSpaces`             | `true`             | where a removal leaves two spaces around it, one stays                                                                         |
| `zeroWidthRunThreshold`  | `2`                | the run length of `zeroWidthRun` and `invisibleRun`                                                                            |
| `constructLimit`         | `4096`             | see [Limits](#limits)                                                                                                          |

Uses that belong to the writing are kept by every rule: a joiner between
letters of a script that joins letters (Persian, Devanagari), one valid
variation selector, emoji sequences, the tag characters of a flag.

<!-- examples: hidden-strict -->

| Input                                                           | Output                                                          | Spoofed | Signals           | Reports                                              |
| --------------------------------------------------------------- | --------------------------------------------------------------- | ------- | ----------------- | ---------------------------------------------------- |
| `fr\u200Bee money`                                              | `free money`                                                    | yes     | `invisible`       | `zeroWidthInWord` `\u200B`                           |
| `pay\u200Dpal`                                                  | `paypal`                                                        | yes     | `invisible`       | `joinerInWord` `\u200D`                              |
| `Get f\u200B\u200Bree`                                          | `Get free`                                                      | yes     | `invisible`       | `zeroWidthRun` `\u200B\u200B`                        |
| `a\u2060b`                                                      | `ab`                                                            | yes     | `invisible`       | `zeroWidthInWord` `\u2060`                           |
| `co\u00ADoperate`                                               | `cooperate`                                                     | no      | —                 | `softHyphen` `\u00AD`                                |
| `\uFEFFHello`                                                   | `Hello`                                                         | no      | —                 | `leadingBom` `\uFEFF`                                |
| `a \u200B b`                                                    | `a b`                                                           | no      | —                 | `isolatedZeroWidth` `\u200B`                         |
| `Auf\u200Clage`                                                 | `Auflage`                                                       | no      | —                 | `possibleLigatureBreak` `\u200C`                     |
| `ภาษา\u200Bไทย`                                                 | `ภาษาไทย`                                                       | no      | —                 | `wordBreakHint` `\u200B`                             |
| `می\u200Cخواهم کتاب`                                            | `می\u200Cخواهم کتاب`                                            | no      | —                 | —                                                    |
| `Ship it 👨\u200D👩\u200D👧 ℹ\uFE0F`                            | `Ship it 👨\u200D👩\u200D👧 ℹ\uFE0F`                            | no      | —                 | —                                                    |
| `辻\uFE00さん`                                                  | `辻\uFE00さん`                                                  | no      | —                 | —                                                    |
| `A\uFE01\uFE02B`                                                | `AB`                                                            | yes     | `invisible`       | `variationSelectors` `\uFE01\uFE02`                  |
| `Looks helpful!\u{E0068}\u{E0069}`                              | `Looks helpful!`                                                | yes     | `invisible`       | `tags` `\u{E0068}\u{E0069}`                          |
| `🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F} flag` | `🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F} flag` | no      | —                 | —                                                    |
| `buy v\u3164i\u3164agra`                                        | `buy v i agra`                                                  | yes     | `invisible`       | `blankFillers` `\u3164`, `blankFillers` `\u3164`     |
| `x\u2062y`                                                      | `xy`                                                            | yes     | `invisible`       | `otherInvisibles` `\u2062`                           |
| `a\u0001b`                                                      | `ab`                                                            | yes     | `illegal`         | `controlChars`, `illegal`                            |
| `line1\u000Bline2\u000Cline3`                                   | `line1\nline2\nline3`                                           | yes     | `illegal`         | `controlChars`, `illegal`, `controlChars`, `illegal` |
| `Hi Jos�� Luis`                                                 | `Hi Jos�� Luis`                                                 | no      | `encoding_damage` | `encodingDamage`                                     |

<!-- /examples -->

Notes on the table:

- The words of the removals with a signal appear in `result.words` with the
  signal `invisible`; silent removals (`softHyphen`, `leadingBom`,
  `isolatedZeroWidth`, `wordBreakHint`, `possibleLigatureBreak`) reach
  `onReport` only.
- A blank filler between two visible characters is written as a space, because
  that is what the reader sees.
- VT (U+000B) and FF (U+000C) become a line feed.
- U+FFFD is never repaired or removed: the bytes it stands for are gone.
  `encoding_damage` does not set `spoofed`.
- The library does not decode hidden content. `extracted` is the hidden
  characters as the input has them; reading tag characters or variation
  selectors as bytes is up to the caller.

### Stacked marks

A letter keeps as many combining marks as its script writes; the rest are
removed. The limits are in `MARK_STACK_LIMITS` (Thai and Lao 3, Arabic, Hebrew
and the Indic scripts 5, Tibetan 10, Latin and Cyrillic 2, Greek 3; 5 for a
script not listed) and can be changed with `hiddenCharRules.markStackLimits`.

<!-- examples: hidden-marks -->

| Input        | Output       | Spoofed | Signals | Reports                                    |
| ------------ | ------------ | ------- | ------- | ------------------------------------------ |
| `Z̸̢̬̈a̛̠͎lg̕o̶ spam` | `Z̸̢a̛̠lg̕o̶ spam` | yes     | `zalgo` | `markStacksOther` `̬̈`, `markStacksOther` `͎` |
| `ok ส้้้้้้`       | `ok ส้้้`       | yes     | `zalgo` | `markStacks` `้้้`                            |
| `tiếng Việt` | `tiếng Việt` | no      | —       | —                                          |

<!-- /examples -->

### Changing a rule

<!-- examples: hidden-rules -->

| Input                  | Options                                                                 | Output                 | Spoofed | Signals     | Reports                                                                        |
| ---------------------- | ----------------------------------------------------------------------- | ---------------------- | ------- | ----------- | ------------------------------------------------------------------------------ |
| `pay\u00ADpal`         | —                                                                       | `paypal`               | no      | —           | `softHyphen` `\u00AD`                                                          |
| `pay\u00ADpal`         | `hiddenCharRules: {softHyphen: 'remove-counted'}`                       | `paypal`               | yes     | `invisible` | `softHyphen` `\u00AD`                                                          |
| `pay\u00ADpal`         | `hiddenCharRules: {softHyphen: 'keep'}`                                 | `pay\u00ADpal`         | no      | —           | `softHyphen` `\u00AD`                                                          |
| `fr\u200Bee \u202Eabc` | `hiddenCharRules: {zeroWidthInWord: 'report', bidiOverrides: 'report'}` | `fr\u200Bee \u202Eabc` | no      | —           | `zeroWidthInWord` `\u200B`, `bidiOverrides` `\u202E`, `bidiOverrideSpan` `abc` |
| `a \u200B b`           | `hiddenCharRules: {seamSpaces: false}`                                  | `a  b`                 | no      | —           | `isolatedZeroWidth` `\u200B`                                                   |

<!-- /examples -->

### Lenient rules

Without `hiddenChars: 'strict'` the rules are fixed. The differences that
matter: a soft hyphen and a ligature-breaking ZWNJ count as findings, an
isolated zero-width character and a word-break hint stay in the text, a blank
filler is removed without leaving a space, a word with stacked marks loses all
its marks, and of an escape sequence only the control part goes: the text it
conceals and the body of a string sequence stay. Findings inside words reach
the word callback instead of the report callback.

<!-- examples: hidden-lenient -->

| Input                              | Output           | Spoofed | Signals     | Reports                                     |
| ---------------------------------- | ---------------- | ------- | ----------- | ------------------------------------------- |
| `fr\u200Bee money`                 | `free money`     | yes     | `invisible` | —                                           |
| `co\u00ADoperate`                  | `cooperate`      | yes     | `invisible` | —                                           |
| `Auf\u200Clage`                    | `Auflage`        | yes     | `invisible` | —                                           |
| `a \u200B b`                       | `a \u200B b`     | no      | —           | —                                           |
| `ภาษา\u200Bไทย`                    | `ภาษา\u200Bไทย`  | no      | —           | —                                           |
| `buy v\u3164i\u3164agra`           | `buy viagra`     | yes     | `invisible` | —                                           |
| `Looks helpful!\u{E0068}\u{E0069}` | `Looks helpful!` | yes     | `invisible` | `invisibleOutsideWord` `\u{E0068}\u{E0069}` |
| `line1\u000Bline2`                 | `line1line2`     | yes     | `illegal`   | `illegal`                                   |
| `ok \u001B[8msecret\u001B[0m done` | `ok secret done` | yes     | `illegal`   | `illegal`, `illegal`                        |
| `a\u001B]0;title\u0007b`           | `a]0;titleb`     | yes     | `illegal`   | `illegal`, `illegal`                        |

<!-- /examples -->

### `cleanHidden`

`cleanHidden(text, rules?, callbacks?)` runs the hidden-character stage alone
and returns the cleaned text. Look-alikes are not touched:

```ts
import { cleanHidden } from '@cycanics/unspoof';

cleanHidden('fr\u200Bee Pаypal'); // 'free Pаypal' (the Cyrillic а stays)
```

Its defaults are `STRICT_HIDDEN_RULES`; to change one rule, pass
`{ ...STRICT_HIDDEN_RULES, softHyphen: 'keep' }`.

## Terminal controls and escape sequences

Text copied from a terminal, or written for one, can carry escape sequences. A
terminal does not show them; it obeys them. With `hiddenChars: 'strict'` an
escape sequence is read as a whole by the DEC/ANSI parser and removed, and text
the terminal would draw invisibly (concealed, or in its background colour) is
removed with it:

<!-- examples: terminal -->

| Input                                      | Options                                            | Output               | Spoofed | Signals   | Reports                                             |
| ------------------------------------------ | -------------------------------------------------- | -------------------- | ------- | --------- | --------------------------------------------------- |
| `ok \u001B[31mred\u001B[0m done`           | —                                                  | `ok red done`        | yes     | `illegal` | `sgr`, `sgr`                                        |
| `ok \u001B[31mred\u001B[0m done`           | `hiddenCharRules: {terminal: {}}`                  | `ok red done`        | no      | —         | `sgr`, `sgr`                                        |
| `ok \u001B[8msecret\u001B[0m done`         | —                                                  | `ok done`            | yes     | `illegal` | `sgrConceal`, `terminalConcealed` `secret`, `sgr`   |
| `x\u001B[30;40mhidden\u001B[0my`           | —                                                  | `xy`                 | yes     | `illegal` | `sgrSameColor`, `terminalConcealed` `hidden`, `sgr` |
| `a\u001B]0;title\u0007b`                   | —                                                  | `ab`                 | yes     | `illegal` | `stringSequence` `0;title`                          |
| `abc\u001B[2Kdef`                          | —                                                  | `abcdef`             | yes     | `illegal` | `erase`                                             |
| `pass\u0008\u0008\u0008\u0008word`         | —                                                  | `password`           | yes     | `illegal` | `illegal`, `illegal`, `illegal`, `illegal`          |
| `pass\u0008\u0008\u0008\u0008word`         | `hiddenCharRules: {terminal: {}}`                  | `word`               | yes     | `illegal` | `backspace` `pass`                                  |
| `norml\u0008al`                            | `hiddenCharRules: {terminal: {}}`                  | `normal`             | yes     | `illegal` | `backspace` `l`                                     |
| `abc\u0008\u0008\u0008\u0008\u0008\u0008x` | `hiddenCharRules: {terminal: {}}`                  | `x`                  | yes     | `illegal` | `backspaceFlood` `abc`                              |
| `safe\u000Drm -rf ~`                       | —                                                  | `safe\u000Drm -rf ~` | no      | —         | `bareCR`                                            |
| `safe\u000Drm -rf ~`                       | `hiddenCharRules: {terminal: {bareCR: 'newline'}}` | `safe\nrm -rf ~`     | no      | —         | `bareCR`                                            |
| `line\u000D\nnext`                         | —                                                  | `line\u000D\nnext`   | no      | —         | —                                                   |

<!-- /examples -->

`hiddenCharRules: { terminal: {} }` turns on the terminal rules
(`TERMINAL_RULES`), which add two things:

- **A class per sequence, with its own mode.** Colours and other formatting
  (`sgr`), private modes and character sets (`otherSequence`) and erasing after
  the cursor (`eraseAhead`) are removed silently: they hide nothing. Cursor
  moves, erasing, resets, concealed text and string sequences (window titles,
  hyperlinks, clipboard writes: OSC, DCS, APC, PM, SOS) are removed and counted.
- **Backspace erases.** A backspace removes the character before it, up to the
  start of its line (`backspaceLineStop`, default `true`), as on a screen.
  Without the terminal rules a backspace is removed as a control character and
  the text before it stays.

A string sequence is removed with its body (`stringSequence:
'remove-with-content'`); its body is the `extracted` of its report.

`cleanTerminal(text, rules?, callbacks?)` applies the terminal rules alone and
leaves every other character as it is:

```ts
import { cleanTerminal } from '@cycanics/unspoof';

cleanTerminal('ok \u001B[8msecret\u001B[0m done norml\bal'); // 'ok done normal'
```

What the library does not do here:

- **No console mode.** A lone carriage return is a line break, as in a web page
  or an editor, never "return to column 0 and overwrite". `safe\rrm -rf ~`
  stays two lines of text; the CR is kept as written and reported as `bareCR`
  (`terminal: { bareCR: 'newline' }` writes it as a line feed). The library
  does not reproduce the screen of a terminal: cursor moves are removed, not
  followed.
- **One cell per character.** A backspace erases one character, also where a
  terminal draws the character two cells wide (CJK).

## Bidirectional text

Bidi controls change the order in which text is shown without changing the
order in which it is stored, so a reader and a program read different text.

<!-- examples: bidi -->

| Input                                                            | Options                                                   | Output                                   | Spoofed | Signals     | Reports                                                                                                                               |
| ---------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------- | ------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `invoice\u202Egnp.exe`                                           | —                                                         | `invoicegnp.exe`                         | yes     | `invisible` | `bidiOverrides` `\u202E`, `bidiOverrideSpan` `gnp.exe`                                                                                |
| `invoice\u202Egnp.exe`                                           | `hiddenCharRules: {bidiOverrides: 'remove-with-content'}` | `invoice`                                | yes     | `invisible` | `bidiOverrides` `\u202E`, `bidiOverrideSpan` `gnp.exe`                                                                                |
| `Open \u202Egnp.exe\u202C now`                                   | `hiddenCharRules: {bidiOverrides: 'remove-with-content'}` | `Open now`                               | yes     | `invisible` | `bidiOverrides` `\u202E`, `bidiOverrideSpan` `gnp.exe`, `bidiOverrides` `\u202C`                                                      |
| `if (level != "user\u202E \u2066// admin check\u2069 \u2066") {` | —                                                         | `if (level != "user // admin check ") {` | yes     | `invisible` | `bidiOverrides` `\u202E`, `bidiOverrideSpan` ` // admin check ") {`, `bidiMarks` `\u2066`, `bidiMarks` `\u2069`, `bidiMarks` `\u2066` |
| `abc\u200Edef`                                                   | —                                                         | `abcdef`                                 | yes     | `invisible` | `bidiMarks` `\u200E`                                                                                                                  |
| `שלום\u200F עולם`                                                | —                                                         | `שלום\u200F עולם`                        | no      | —           | `bidiMarksInRtlText` `\u200F`                                                                                                         |
| `hello\u200F world\nשלום\u200F עולם`                             | —                                                         | `hello world\nשלום\u200F עולם`           | yes     | `invisible` | `bidiMarks` `\u200F`, `bidiMarksInRtlText` `\u200F`                                                                                   |
| `abc \u2067שלום\u2069`                                           | —                                                         | `abc \u2067שלום\u2069`                   | no      | —           | `bidiMarksInRtlText` `\u2067`, `bidiMarksInRtlText` `\u2069`                                                                          |
| `\u202Eשלום עולם\u202C`                                          | `hiddenCharRules: {bidiOverrides: 'remove-with-content'}` | `שלום עולם`                              | yes     | `invisible` | `bidiOverrides` `\u202E`, `bidiOverrides` `\u202C`                                                                                    |
| `טל \u202D+972-50-1234567\u202C`                                 | `hiddenCharRules: {bidiOverrides: 'remove-with-content'}` | `טל +972-50-1234567`                     | yes     | `invisible` | `bidiOverrides` `\u202D`, `bidiOverrides` `\u202C`                                                                                    |

<!-- /examples -->

- **Overrides and embeddings** (U+202A–202E) are removed. The text an override
  shows reversed is reported as `bidiOverrideSpan`, in stored order. The stored
  order is also what stays in the output: `invoice\u202Egnp.exe` is shown as
  `invoiceexe.png` and becomes `invoicegnp.exe`.
- `bidiOverrides: 'remove-with-content'` also removes the text the override
  reorders, up to its closing control or the end of the line. An override over
  text that already runs the same way hides nothing and loses only its
  controls.
- **Marks and isolates** (LRM, RLM, ALM, U+2066–2069) are judged per paragraph:
  in a paragraph that has a right-to-left letter they belong to the writing and
  stay (`bidiMarksInRtlText`); in a paragraph without one they are removed
  (`bidiMarks`). The paragraph is searched for a right-to-left letter up to
  `constructLimit` characters ahead of the mark.

### Right-to-left letters inside a word

A word that mixes right-to-left and left-to-right letters is shown in another
order than it is stored. With `rtlAwareness` (default `true`) the pieces of
such a word are taken in the order the reader sees them, so "the last piece" of
a mixed word and "a suffix" mean what they mean on screen. With
`rtlAwareness: false` the stored order is used:

<!-- examples: rtl-awareness -->

| Input            | Options               | Output           | Spoofed | Signals                |
| ---------------- | --------------------- | ---------------- | ------- | ---------------------- |
| `שלום iPhoneахא` | —                     | `שלום iPhoneахא` | no      | `mixed_non_legitimate` |
| `שלום iPhoneахא` | `rtlAwareness: false` | `שלום iPhoneaxא` | yes     | `mixed_spoof`          |

<!-- /examples -->

## HTML character references

With both options, HTML character references are read the way a browser reads
them in text, so a look-alike or a hidden character cannot hide behind
`&#1072;`:

<!-- examples: html -->

| Input                           | Options                            | Output                          | Spoofed | Signals           | Reports                                                                  |
| ------------------------------- | ---------------------------------- | ------------------------------- | ------- | ----------------- | ------------------------------------------------------------------------ |
| `p&#1072;ypal now`              | —                                  | `paypal now`                    | yes     | `mixed_spoof`     | `htmlReference` `&#1072;`                                                |
| `p&#x430;ypal now`              | —                                  | `paypal now`                    | yes     | `mixed_spoof`     | `htmlReference` `&#x430;`                                                |
| `p&#1072ypal now`               | —                                  | `paypal now`                    | yes     | `mixed_spoof`     | `htmlReference` `&#1072`                                                 |
| `fr&ZeroWidthSpace;ee`          | —                                  | `free`                          | yes     | `invisible`       | `htmlReference` `&ZeroWidthSpace;`, `zeroWidthInWord` `&ZeroWidthSpace;` |
| `abc&#8203;def`                 | —                                  | `abcdef`                        | yes     | `invisible`       | `htmlReference` `&#8203;`, `zeroWidthInWord` `&#8203;`                   |
| `C&#1087;росите`                | —                                  | `С&#1087;росите`                | yes     | `mixed_spoof`     | `htmlReference` `&#1087;`                                                |
| `Hello&lt;сор&gt;world`         | —                                  | `Hello&lt;cop&gt;world`         | yes     | `confusable_word` | `htmlReference` `&lt;`, `htmlReference` `&gt;`                           |
| `AT&amp;T caf&eacute;`          | —                                  | `AT&amp;T caf&eacute;`          | no      | —                 | `htmlReference` `&amp;`, `htmlReference` `&eacute;`                      |
| `x &copy text`                  | —                                  | `x &copy text`                  | no      | —                 | `htmlReference` `&copy`                                                  |
| `x &copy text`                  | `htmlNamedReferences: 'strict'`    | `x &copy text`                  | no      | —                 | —                                                                        |
| `see &section=1 and &copyright` | —                                  | `see &section=1 and &copyright` | no      | —                 | —                                                                        |
| `a&#0;b`                        | —                                  | `a&#0;b`                        | no      | `encoding_damage` | `htmlReference` `&#0;`, `encodingDamage`                                 |
| `p&#1072;ypal now`              | instead: `{hiddenChars: 'strict'}` | `p&#1072;ypal now`              | no      | —                 | —                                                                        |

<!-- /examples -->

- Numeric references (`&#1072;`, `&#x430;`) are read with or without the
  closing `;`. Named references are read with `;`; the names HTML also accepts
  without it (`&amp`, `&copy`, `&lt`, …) are read without it too, unless `=`,
  a letter or a digit follows (`&section=1`, `&copyright` are text).
  `htmlNamedReferences: 'strict'` reads names only with `;`.
- Every reference is reported as `htmlReference`, with the reference as
  written.
- A reference stays as written in the output unless the character it encodes
  was changed or removed: `AT&amp;T` is untouched, `p&#1072;ypal` becomes
  `paypal`, and in `C&#1087;росите` only the first letter changes.
- Positions in reports, word callbacks and `result.words` are positions in the
  input as written.
- A reference to the code point 0, or past U+10FFFF, encodes U+FFFD
  (`encoding_damage`).

## Mojibake

Mojibake is UTF-8 text that was decoded as Windows-1252, Latin-1 or
Windows-1251 (`donâ€™t` for `don’t`). With `hiddenChars: 'strict'` it is
reported, with the text it encodes as `extracted`, and left as written: the
library does not repair text.

<!-- examples: mojibake -->

| Input              | Options             | Output             | Spoofed | Signals           | Reports             |
| ------------------ | ------------------- | ------------------ | ------- | ----------------- | ------------------- |
| `I donâ€™t know`   | —                   | `I donâ€™t know`   | no      | —                 | `mojibake` `’`      |
| `maÃ®tre`          | —                   | `maÃ®tre`          | no      | —                 | `mojibake` `î`      |
| `Ð¿Ñ€Ð¸Ð²ÐµÑ‚ мир` | —                   | `Ð¿Ñ€Ð¸Ð²ÐµÑ‚ мир` | no      | —                 | `mojibake` `привет` |
| `I donвЂ™t know`   | —                   | `I donвЂ™t know`   | no      | —                 | `mojibake` `’`      |
| `ВІРЅ`             | —                   | `BIPS`             | yes     | `confusable_word` | `mojibake` `²н`     |
| `I donâ€™t know`   | instead: no options | `I donâ€™t know`   | no      | —                 | —                   |

<!-- /examples -->

A mojibake span is still judged as letters, so it cannot hide a spoof: `ВІРЅ`
is the mojibake of `²н` and, at the same time, four letters that read `BIPS`.

## Look-alikes and the choice of language

A word with look-alike letters is resolved in two steps: which requested
languages _can_ take the whole word (every letter is that language's letter or
has a pair into it), and which of them the context names.

<!-- examples: lookalikes-words -->

| Input                       | Output                      | Spoofed | Signals           |
| --------------------------- | --------------------------- | ------- | ----------------- |
| `Login at pаypal.com`       | `Login at paypal.com`       | yes     | `mixed_spoof`     |
| `gооgle.com`                | `google.com`                | yes     | `mixed_spoof`     |
| `Bank aссount verification` | `Bank account verification` | yes     | `mixed_spoof`     |
| `Cпросите у него`           | `Спросите у него`           | yes     | `mixed_spoof`     |
| `ВOДКА`                     | `ВОДКА`                     | yes     | `mixed_spoof`     |
| `Kαλημέρα`                  | `Καλημέρα`                  | yes     | `mixed_spoof`     |
| `Привiт світ`               | `Привіт світ`               | yes     | `mixed_spoof`     |
| `замóк`                     | `замо́к`                     | yes     | `mixed_spoof`     |
| `ᎪᏢᏢꓡꓰ`                     | `APPLE`                     | yes     | `mixed_spoof`     |
| `pꓮypal`                    | `pAypal`                    | yes     | `mixed_spoof`     |
| `paypaו`                    | `paypai`                    | yes     | `mixed_spoof`     |
| `ſecure`                    | `secure`                    | yes     | `confusable_word` |
| `þing`                      | `ping`                      | yes     | `confusable_word` |

<!-- /examples -->

- A look-alike is converted to the letter of the same case; an accent is
  carried over. A Latin stressed vowel in a Russian word becomes the Russian
  vowel with a combining acute (`замóк`).
- A donor without letter case takes the case it looks like: Lisu `ꓮ` reads as a
  capital `A`, also inside a lowercase word.
- A donor is converted with its word, whatever the rest of the word is
  (`paypaו`: the Hebrew vav reads `i`).
- `þ` is not an English letter, and it looks like `p`. Request `European`
  instead of `English` when the text has such letters of its own.

### Context

A word written wholly in one requested language's letters (`НОТ` is a Russian
word as far as its letters go) is converted into another requested language
only by context:

1. the nearest word on each side: if both are written in the same requested
   language and that language can take the word, it decides;
2. otherwise the words within `majorityWindow` (default 10) words on each side:
   the language with most letters decides, if it can take the word.

Context does not cross a blank line: a paragraph is judged on its own.

<!-- examples: lookalikes-context -->

| Input                             | Output                            | Spoofed | Signals                |
| --------------------------------- | --------------------------------- | ------- | ---------------------- |
| `НОТ dog`                         | `HOT dog`                         | yes     | `confusable_word`      |
| `Мы были в НОТ`                   | `Мы были в НОТ`                   | no      | —                      |
| `НОТ`                             | `НОТ`                             | no      | —                      |
| `the сор was here`                | `the cop was here`                | yes     | `confusable_word`      |
| `сор`                             | `сор`                             | no      | —                      |
| `buy аррӏе now`                   | `buy apple now`                   | yes     | `confusable_word`      |
| `Hello world and friends.\nНОТ`   | `Hello world and friends.\nHOT`   | yes     | `confusable_word`      |
| `Hello world and friends.\n\nНОТ` | `Hello world and friends.\n\nНОТ` | no      | —                      |
| `Please read the ВООК now`        | `Please read the BOOK now`        | yes     | `confusable_word`      |
| `Please read the ВООК друг`       | `Please read the ВООК друг`       | no      | `whole_word_lookalike` |

<!-- /examples -->

- A word with no context stays (`НОТ`, `сор` alone).
- **`whole_word_lookalike`**: when the context names another language but a
  word next to the word is a clean word of the word's own language, the word is
  kept and reported. In `Please read the ВООК друг` the Russian word `друг`
  stands next to `ВООК`, so `ВООК` may well be Russian text.
- `аррӏе` carries its own evidence: `ӏ` (the palochka) is not a Russian letter.

`wholeScriptFold` narrows this: `'all'` (default) as described;
`'foreign-letters'` converts a whole word only when it carries evidence of its
own, such as a letter of no requested language; `'off'` never converts a whole
word, and reports the ones with such evidence. `inputLanguages` names
the languages the input is written in (`'Russian'`, `'Greek'`, …): their whole
words are genuine, so a word written wholly in the letters of one of them is
never converted. `targetLanguages` is the other side: the languages the reader
reads, into which conversions go.

<!-- examples: lookalikes-whole -->

| Input           | Options                              | Output          | Spoofed | Signals           |
| --------------- | ------------------------------------ | --------------- | ------- | ----------------- |
| `НОТ dog`       | `wholeScriptFold: 'all'`             | `HOT dog`       | yes     | `confusable_word` |
| `НОТ dog`       | `wholeScriptFold: 'foreign-letters'` | `НОТ dog`       | no      | —                 |
| `buy аррӏе now` | `wholeScriptFold: 'foreign-letters'` | `buy apple now` | yes     | `confusable_word` |
| `buy аррӏе now` | `wholeScriptFold: 'off'`             | `buy аррӏе now` | yes     | `confusable_word` |
| `НОТ dog`       | `inputLanguages: ['Russian']`        | `НОТ dog`       | no      | —                 |

<!-- /examples -->

### No context, several languages

When several requested languages can take a word and no context decides:

- a mixed word goes to the language that holds a clear majority of its letters:
  at least `ladder.wordMajorityMinLetters` (default 3) letters and
  `ladder.wordMajorityMinShare` (default 2/3) of the word;
- otherwise the request order decides: the first requested language that can
  take the word.

A mixed word is converted only into a language that already holds one of its
letters. A word made of donors only (`ᎪᏢᏢꓡꓰ`) can go to any requested language
that can take all of it.

### Context size

`contextBuffer` (default 100) is the number of words kept around the word being
judged; it must be at least `2 × majorityWindow + 1`. `breadth: 'window'` (the
default with the language model) takes every context measure from that buffer,
so the memory used for context does not grow with the text. `breadth: 'all'`
(the default without the language model) reads two measures, the most frequent
script and whether any word is mixed, from the whole text.

## Mixed words and their categories

A mixed word holds letters of two scripts or more. Under the language model it
gets one of three categories:

<!-- examples: mixed -->

| Input                       | Options              | Output                      | Spoofed | Signals                           |
| --------------------------- | -------------------- | --------------------------- | ------- | --------------------------------- |
| `pаypal`                    | —                    | `paypal`                    | yes     | `mixed_spoof`                     |
| `pаypalя`                   | —                    | `paypalя`                   | yes     | `mixed_spoof`                     |
| `Bank ассоunt verification` | —                    | `Bank ассоunt verification` | no      | `mixed_non_legitimate`            |
| `Applе`                     | —                    | `Applе`                     | no      | `mixed_non_legitimate`            |
| `Applе`                     | `hostileInput: true` | `Apple`                     | yes     | `mixed_spoof`                     |
| `timея`                     | —                    | `timея`                     | no      | `mixed_non_legitimate`            |
| `ЮKassa`                    | —                    | `ЮKassa`                    | no      | `mixed_non_legitimate`            |
| `Facebookом`                | —                    | `Facebookом`                | no      | `mixed_non_legitimate`            |
| `paypaוש`                   | —                    | `paypaוש`                   | no      | `mixed_non_legitimate`            |
| `iPhone用`                  | —                    | `iPhone用`                  | no      | `mixed_legitimate`                |
| `pa株ypal`                  | —                    | `pa株ypal`                  | no      | `mixed_legitimate`                |
| `Smith는`                   | —                    | `Smith는`                   | no      | `mixed_legitimate`                |
| `pаypal用`                  | —                    | `paypal用`                  | yes     | `mixed_spoof`                     |
| `Please read the ВООК друг` | —                    | `Please read the ВООК друг` | no      | `whole_word_lookalike`            |
| `НОТ busіnеss`              | instead: no options  | `HOT business`              | yes     | `mixed_script`, `confusable_word` |

<!-- /examples -->

**`mixed_spoof`**: look-alike letters in the word were converted. This is the
only category that sets `spoofed`. A word that holds letters of two requested
languages is corrected only where the correction is not a guess:

- a single look-alike letter that starts the word or stands inside it
  (`pаypal`, `Cпросите`);
- a run of look-alike letters between two pieces of the other alphabet
  (`gооgle`, `aссount`);

each toward the side that holds more of the word's letters. With
`hostileInput: true` a single look-alike letter at the end of the word is
converted too (`Applе`).

**`mixed_legitimate`**: the other script is written without spaces between
words (Han, Hiragana, Katakana, Thai, …), or the scripts are one of the usual
combinations of Chinese, Japanese and Korean text with Latin (`Smith는`).
Writing such a word is normal. It is reported, never converted, never a spoof.
Look-alikes in the part written with spaces are still converted
(`pаypal用` → `paypal用`, a spoof).

**`mixed_non_legitimate`**: scripts written with spaces are glued together and
nothing was converted: a first piece of several look-alikes (`ассоunt`), a
look-alike at the end (`Applе`), an ending in another language glued to a word
(`Facebookом`), letters with no pair at all (`ЮKassa`). The reader sees the
mix, so it is reported and not a spoof. Use the report to flag the word, or
narrow `targetLanguages` if the reader reads one language only.

Under the Latin-fold model a mixed word has one signal, `mixed_script`, and is
converted to Latin letters (last row).

Counters: `counts.mixedWords` counts the words that got a category;
`counts.confusableWords` counts the words some requested language could take
as a whole.

## Dashes, apostrophes and affixes

With both options, words joined by a dash or an apostrophe are read as one
token with parts (`NTLM-хеш`, `iPhone'ах`), and reported as one word.

<!-- examples: affixes -->

| Input                   | Options                           | Output                  | Spoofed | Signals                          |
| ----------------------- | --------------------------------- | ----------------------- | ------- | -------------------------------- |
| `iPhone'ах`             | —                                 | `iPhone'ах`             | no      | —                                |
| `SMS-ах`                | —                                 | `SMS-ах`                | no      | —                                |
| `форк на GitHub'а`      | —                                 | `форк на GitHub'а`      | no      | —                                |
| `NTLM-хеш`              | —                                 | `NTLM-хеш`              | no      | —                                |
| `Wi-Fi`                 | —                                 | `Wi-Fi`                 | no      | —                                |
| `the реалити-шоу is on` | —                                 | `the реалити-шоу is on` | no      | —                                |
| `the хе-хе`             | —                                 | `the xe-xe`             | yes     | `confusable_word`                |
| `buy apple-рау now`     | —                                 | `buy apple-pay now`     | yes     | `confusable_word`, `mixed_spoof` |
| `plan-В`                | —                                 | `plan-B`                | yes     | `mixed_spoof`                    |
| `Р-aypal`               | —                                 | `P-aypal`               | yes     | `mixed_spoof`                    |
| `Р-aypal`               | `oneLetterDashAffix: ['Russian']` | `Р-aypal`               | no      | —                                |
| `Windowsах`             | —                                 | `Windowsах`             | no      | `mixed_non_legitimate`           |
| `Windowsах`             | `affixSeparator: '-'`             | `Windows-ах`            | no      | `mixed_non_legitimate`           |
| `Windowsах`             | `affixSeparator: ''`              | `Windowsах`             | no      | —                                |
| `pаypalя`               | `affixSeparator: '-'`             | `paypal-я`              | yes     | `mixed_spoof`                    |

<!-- /examples -->

- Parts written in different languages are judged as separate words, each with
  the context around the whole token: `NTLM-хеш` is an English word and a
  Russian word. Parts in the same language are judged together
  (`реалити-шоу`, `хе-хе`).
- A **suffix** set off by a dash or an apostrophe stays as written when it is a
  grammatical ending of a requested language other than the word's own
  (`iPhone'ах`, `SMS-ах`, `GitHub'а`). The library has ending lists for
  English, Russian, Ukrainian and Greek.
- A one-letter part whose letter has a twin in the other part's language is
  part of the word and converts (`plan-В`, `Р-aypal`).
  `oneLetterDashAffix: ['Russian']` keeps a one-letter Russian part before a
  dash as a prefix.
- An ending glued to the word without a separator (`Windowsах`) is reported as
  `mixed_non_legitimate`. `affixSeparator` changes that: with a string, a real
  ending is kept and set off by that string (`'-'`: `Windows-ах`; `''`: left as
  written and not reported). Other look-alikes in the word are still converted
  (`pаypalя` → `paypal-я`).

## Digits and the multiplication sign

<!-- examples: digits -->

| Input        | Options                            | Output       | Spoofed | Signals                |
| ------------ | ---------------------------------- | ------------ | ------- | ---------------------- |
| `error Ꮞ04`  | —                                  | `error 404`  | yes     | `confusable_word`      |
| `error ৪০৪`  | —                                  | `error 808`  | yes     | `confusable_word`      |
| `g০০gle`     | —                                  | `google`     | yes     | `confusable_word`      |
| `g൦൦gle`     | —                                  | `google`     | yes     | `confusable_word`      |
| `۱۵`         | —                                  | `۱۵`         | no      | —                      |
| `l0gin`      | —                                  | `l0gin`      | no      | —                      |
| `1920x1080`  | —                                  | `1920×1080`  | no      | —                      |
| `300х300пкс` | —                                  | `300×300пкс` | no      | —                      |
| `4х4`        | —                                  | `4×4`        | no      | —                      |
| `0x1F`       | —                                  | `0x1F`       | no      | —                      |
| `x86 2x`     | —                                  | `x86 2x`     | no      | —                      |
| `Win11Рго`   | —                                  | `Win11Рго`   | no      | `mixed_non_legitimate` |
| `B2В`        | —                                  | `B2В`        | no      | `mixed_non_legitimate` |
| `1920x1080`  | instead: `{hiddenChars: 'strict'}` | `1920x1080`  | no      | —                      |

<!-- /examples -->

- A character that looks like an ASCII digit is converted, alone too: the
  Cherokee `Ꮞ` reads `4`, the Bengali `৪` reads `8`. The conversion is a spoof.
- A character with a digit reading and a letter reading takes the digit inside
  a number and the letter inside a word: the Bengali zero `০` reads `0` in
  `৪০৪` and `o` in `g০০gle`.
- A digit of another script with no ASCII look-alike keeps its word as written
  (`۱۵`: the Persian five looks like no ASCII digit).
- ASCII digits are never read as letters: `l0gin` stays.
- An `x`, or a letter that looks like one, between two digits is written as the
  multiplication sign `×`. This is not a finding; it only keeps the letter from
  being read as part of a word. `0x1F`, `x86` and `2x` are not between digits.
- In a mixed word digits do not separate the pieces: in `B2В` the Latin `B` and
  the Cyrillic `В` meet.

## Styled, math and other neutral characters

Some characters belong to no language and stand for a letter: circled and
fullwidth letters, ligatures, math alphabets, Roman numeral characters, unit
symbols. With `hiddenChars: 'strict'` (or `neutralAlphabet: true`) they are
read by type:

| Type            | Examples         | Alone     | Inside a word                                 | A spoof                                    |
| --------------- | ---------------- | --------- | --------------------------------------------- | ------------------------------------------ |
| visible style   | `ⓐ` `Ｐ` `ﬁ` `🄰` | kept      | written as its letter, in the word's language | no                                         |
| math letter     | `𝐏` `ℝ` `ϕ`      | converted | converted                                     | yes                                        |
| Roman numeral   | `Ⅳ` `ⅽ`          | converted | converted                                     | inside a word of a script with spaces      |
| tail mark       | `©` `®` `™`      | kept      | kept at a word's end; a letter if one follows | when it stands for a letter                |
| separator       | `№`              | kept      | a word boundary                               | no                                         |
| unit            | `ℓ` `℃` `㎏`     | kept      | kept after a number; a letter otherwise       | at the end of a word of letters (`paypaℓ`) |
| unit prefix     | `µ`              | kept      | kept before a unit; a letter otherwise        | when it stands for a letter                |
| word sign       | `℡` `℻`          | `TEL`     | converted                                     | when it touches letters                    |
| caseless stroke | `ꓲ` `ǀ`          | `I`       | `I` or `l`, by the letters around it          | yes                                        |

<!-- examples: neutral -->

| Input             | Output       | Spoofed | Signals                          |
| ----------------- | ------------ | ------- | -------------------------------- |
| `pⓐypal`          | `paypal`     | no      | —                                |
| `see ⓐ here`      | `see ⓐ here` | no      | —                                |
| `Ｇｅｔ ｆｒｅｅ` | `Get free`   | no      | —                                |
| `ﬁnance`          | `finance`    | no      | —                                |
| `пⓐпа`            | `папа`       | no      | —                                |
| `приⓖет`          | `приgет`     | no      | `mixed_non_legitimate`           |
| `𝐩𝐚𝐲𝐩𝐚𝐥`          | `paypal`     | yes     | `confusable_word`                |
| `𝐈 ℝ`             | `I R`        | yes     | `confusable_word`                |
| `cosϕ`            | `cosφ`       | yes     | `confusable_word`, `mixed_spoof` |
| `chapter Ⅳ`       | `chapter IV` | no      | —                                |
| `第Ⅲ章`           | `第III章`    | no      | `mixed_legitimate`               |
| `ⅽlick`           | `click`      | yes     | `confusable_word`                |
| `Ⅹорошо`          | `Хорошо`     | yes     | `confusable_word`                |
| `Brand® now`      | `Brand® now` | no      | —                                |
| `©lick`           | `click`      | yes     | `confusable_word`                |
| `№5`              | `№5`         | no      | —                                |
| `5ℓ 10㎏`         | `5ℓ 10㎏`    | no      | —                                |
| `paypaℓ`          | `paypal`     | yes     | `confusable_word`                |
| `℡ 555`           | `TEL 555`    | no      | —                                |
| `5µm`             | `5µm`        | no      | —                                |
| `µsername`        | `username`   | yes     | `confusable_word`                |
| `xᵢ 1º 10ⁿ`       | `xᵢ 1º 10ⁿ`  | no      | —                                |
| `ꓲ`               | `I`          | yes     | `confusable_word`                |
| `aꓲl`             | `all`        | yes     | `mixed_spoof`                    |
| `作れたｗ`        | `作れたｗ`   | no      | `mixed_legitimate`               |

<!-- /examples -->

- A conversion that is not a spoof (a styled letter written as its letter) is
  not listed in `result.words`; the word callback still gets it, with no
  signal.
- A styled letter whose letter does not fit the word's language makes the word
  mixed (`приⓖет`).
- Superscripts, subscripts, ordinal indicators and modifier letters are not
  converted.
- Beside Japanese or Chinese text a lone styled letter stays (`作れたｗ`).

The switch on its own:

<!-- examples: neutral-switch -->

| Input    | Options                                                        | Output   | Spoofed | Signals |
| -------- | -------------------------------------------------------------- | -------- | ------- | ------- |
| `pⓐypal` | instead: `{confusionModel: 'language'}`                        | `pⓐypal` | no      | —       |
| `pⓐypal` | instead: `{confusionModel: 'language', neutralAlphabet: true}` | `paypal` | no      | —       |
| `pⓐypal` | `neutralAlphabet: false`                                       | `pⓐypal` | no      | —       |

<!-- /examples -->

### Math

The library does not detect math. Text that is known to be math can be passed
with switches that keep what math needs:

| Option                                                | Effect                                                                                              |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `keepMathLetters: true`                               | math letters stay as written; words made of math letters, or math letters and Greek, are not judged |
| `mathTarget: true`                                    | a word of Latin and Greek letters is a word of math: `mixed_legitimate`, not converted              |
| `hiddenCharRules: { invisibleMathOperators: 'keep' }` | the invisible operators U+2061–2064 (function application, invisible times, …) stay                 |

<!-- examples: math -->

| Input        | Options                                             | Output       | Spoofed | Signals                          |
| ------------ | --------------------------------------------------- | ------------ | ------- | -------------------------------- |
| `ℎν`         | —                                                   | `hv`         | yes     | `confusable_word`, `mixed_spoof` |
| `ℎν`         | `keepMathLetters: true`                             | `ℎν`         | no      | —                                |
| `𝑘𝑇𝜈`        | —                                                   | `kTv`        | yes     | `confusable_word`, `mixed_spoof` |
| `𝑘𝑇𝜈`        | `keepMathLetters: true`                             | `𝑘𝑇𝜈`        | no      | —                                |
| `𝐈 ℝ`        | `keepMathLetters: true`                             | `𝐈 ℝ`        | no      | —                                |
| `cosβcosα`   | —                                                   | `cosβcosα`   | no      | `mixed_non_legitimate`           |
| `cosβcosα`   | `mathTarget: true`                                  | `cosβcosα`   | no      | `mixed_legitimate`               |
| `αFβγ`       | `mathTarget: true`                                  | `αFβγ`       | no      | `mixed_legitimate`               |
| `f\u2061(x)` | —                                                   | `f(x)`       | yes     | `invisible`                      |
| `f\u2061(x)` | `hiddenCharRules: {invisibleMathOperators: 'keep'}` | `f\u2061(x)` | no      | —                                |

<!-- /examples -->

## Turkish dotless ı

Turkish is not one of the languages the library knows, and its `ı` looks like
`i`. The library keeps `ı` when the word itself, another part of the same
token, or a word within the context window holds one of the Turkish letters
`ğ`, `ş`, `İ`; otherwise `ı` is read as `i`:

<!-- examples: turkish -->

| Input                       | Output                      | Spoofed | Signals           |
| --------------------------- | --------------------------- | ------- | ----------------- |
| `click the lınk now`        | `click the link now`        | yes     | `confusable_word` |
| `Işık ılık ısıtır`          | `Işık ılık ısıtır`          | no      | —                 |
| `Osmanlı İmparatorluğu yıl` | `Osmanlı İmparatorluğu yıl` | no      | —                 |
| `İstanbul'da ışık`          | `İstanbul'da ışık`          | no      | —                 |
| `the yıl was long`          | `the yil was long`          | yes     | `confusable_word` |

<!-- /examples -->

The last row is the limit of this rule: a Turkish word with no Turkish letter
near it, in English text, is converted. To keep every `ı`, remove the pair:
`buildLookalikes({ remove: { English: [['ı', 'i']] } })` (see
[Custom look-alike packs](#custom-look-alike-packs)).

## Limits

The text is read as a stream; every construct that could otherwise grow
without bound has a limit.

| Limit                                  | Default                | What happens at the limit                                                                                             |
| -------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Word length (`WORD_CAP`)               | 250 characters         | a longer word is not judged and stays as the hidden-character stage left it; `onWord` gets `reason.tooBig`            |
| `hiddenCharRules.constructLimit`       | 4,096 code points      | a longer run of hidden characters, concealed span or mojibake span is reported in pieces of that length               |
|                                        |                        | an override, embedding or isolate not closed within it is closed there: `onLostBound` with `kind: 'bidiFrame'`        |
|                                        |                        | a direction mark looks that far ahead for a right-to-left letter; a backspace run erases at most that many characters |
| `hiddenCharRules.terminal.stringLimit` | 16,777,216 code points | an escape string with no terminator within it ends at the end of its line: `onLostBound` with `kind: 'escapeString'`  |
| `contextBuffer`                        | 100 words              | context for a word comes from this many words around it                                                               |

The word limit applies when either option is set; without options every word
is judged.

`onLostBound(bound)` reports a construct whose end was not found:
`{ kind, start, length }`. An escape string that is never closed would
otherwise swallow the rest of the text:

```ts
const lost = [];
const r = analyze(
  'a\u001B]0;never closed\nnext line',
  { hiddenChars: 'strict', confusionModel: 'language' },
  { onLostBound: (bound) => lost.push(bound) },
);
r.normalized; // 'a\nnext line'
lost; // [{ kind: 'escapeString', start: 1, length: 16 }]
```

A long run of hidden characters is valid input and needs no special report; it
arrives as several marks:

```ts
const tags = String.fromCodePoint(0xe0078).repeat(5000); // 5,000 tag characters
const kinds = [];
cleanHidden(`hi${tags}`, STRICT_HIDDEN_RULES, {
  onReport: (mark) => kinds.push([mark.kind, mark.count]),
});
kinds; // [['tags', 4096], ['tags', 904]]
```

## Callbacks

`analyze(text, options, callbacks)` and `cleanHidden(text, rules, callbacks)`
call back while they read the text. The library's own result does not depend
on what a callback does.

| Callback                                           | Called for                                                                                            |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `onReport(mark)`                                   | every mark of every rule that is not `'ignored'`, in position order                                   |
| `onCleanup(region, cleanup)`                       | every stretch of the input that removals touch; may return the caller's own text for it               |
| `onRecord(record)`                                 | the output of the hidden-character stage, piece by piece, with the caller's `onCleanup` returns       |
| `onWord(start, end, cleaned, replacement, reason)` | `analyze` only: every word the word stage converted or reported, and every word past the length limit |
| `onLostBound(bound)`                               | a construct whose end was not found (see [Limits](#limits))                                           |
| `signal`                                           | an `AbortSignal`; the scan stops at the next mark or word and the result covers what was read         |

A **mark** is `{ kind, start, length, extracted, count }`: the rule, the
position in the input (UTF-16 offsets), the hidden part (or `null`), and what
the rule counts (code points, sequences or backspaces).

`onCleanup` and `onRecord` let the caller build its own output next to the
library's:

```ts
import { cleanHidden, STRICT_HIDDEN_RULES } from '@cycanics/unspoof';

const marks = [];
const out = [];
const cleaned = cleanHidden('fr\u200Bee co\u00ADop', STRICT_HIDDEN_RULES, {
  onReport: (mark) => marks.push(mark.kind),
  onCleanup: (region) => `[${region.original.length} hidden]`,
  onRecord: (record) => out.push(record.text),
});

cleaned; // 'free coop'
marks; // ['zeroWidthInWord', 'softHyphen']
out.join(''); // 'fr[1 hidden]ee co[1 hidden]op'
```

Each record is `{ start, length, text }`: the input range and the text that
replaces it. The records cover the input in order, so they also map a position
in the input to a position in the cleaned text.

The word callback gets the word's position in the input, the word as the
hidden-character stage left it, the library's output for it, and the reason:

```ts
const words = [];
const r = analyze(
  'please pay Pаypаl now, ｆｒｅｅ',
  { hiddenChars: 'strict', confusionModel: 'language' },
  {
    onWord: (start, end, cleaned, replacement, reason) =>
      words.push({ start, end, cleaned, replacement, reason }),
  },
);

r.normalized; // 'please pay Paypal now, free'
words;
// [{ start: 11, end: 17, cleaned: 'Pаypаl', replacement: 'Paypal',
//    reason: { signals: ['mixed_spoof'], converted: true, toLang: 'English' } },
//  { start: 23, end: 27, cleaned: 'ｆｒｅｅ', replacement: 'free',
//    reason: { signals: [], converted: true, toLang: 'English' } }]
r.words.map((w) => w.word); // ['Pаypаl']
```

- In `result.words`, `scripts` holds the scripts of the word's letters where the
  word stage recorded them. It is empty for a hidden-character finding and for
  a mixed word corrected letter by letter (`pаypal`): for those, read the word
  itself.
- `reason.toLang` is the requested language whose letters the output is written
  in (`null` when none is, and always under the Latin-fold model); `reason.rule`
  names the step that decided, for a word judged as a whole (`'neighbours'`,
  `'window'`, `'word-majority'`, `'primary-target'`, …).
- With `hiddenChars: 'strict'` a word whose only finding is a hidden character
  is reported through `onReport`, not `onWord`; it is still listed in
  `result.words`.
- Word calls come later than the report calls for the text around them: a word
  is judged once the words after it have been read.

Stopping early:

```ts
const controller = new AbortController();
let calls = 0;
const r = analyze(
  'pаypal one pаypal two pаypal three',
  { hiddenChars: 'strict', confusionModel: 'language' },
  {
    onWord: () => {
      if (++calls === 2) controller.abort();
    },
    signal: controller.signal,
  },
);
r.normalized; // 'paypal one paypal'
```

## Recipes

### Text for a language model

The model should read what the reader sees. Request the languages your readers
read; with one language, every look-alike has one answer.

```ts
import { analyze } from '@cycanics/unspoof';

const options = {
  hiddenChars: 'strict',
  confusionModel: 'language',
  targetLanguages: ['English'],
  hiddenCharRules: { terminal: {} },
} as const;

export function forModel(text: string): string {
  return analyze(text, options).normalized;
}

forModel('Summarise: the сlient paid 300х200 via Pаypal. Привет!');
// 'Summarise: the client paid 300×200 via Paypal. Привет!'
```

- A word of a language that was not requested stays as written (`Привет`).
- If the text is JSON, parse it first and pass the string values: the library
  reads text, and a JSON escape such as `\u0430` is six ASCII characters to it, not
  the letter `а`.
- If the text is HTML source, character references are read; tags are text.
- If the text may be math, see [Math](#math).

### Scanning untrusted input

For input that is assumed hostile, convert more and remove more, and collect
the reports. The time and the memory of a call grow with the input: in the
measurements of [performance](./performance.md), a 16 MB text took 2.3 s and
167 MB of process memory in strict + language mode, and text in a language that
was not requested was read at 0.7 to 1.3 MB/s.

```ts
const options = {
  hiddenChars: 'strict',
  confusionModel: 'language',
  hostileInput: true,
  hiddenCharRules: {
    terminal: {},
    bidiOverrides: 'remove-with-content',
    softHyphen: 'remove-counted',
  },
} as const;

const marks = [];
const r = analyze('Applе pay\u00ADpal invoice\u202Egnp.exe', options, {
  onReport: (mark) => marks.push(mark.kind),
});

r.normalized; // 'Apple paypal invoice'
r.spoofed; // true
marks; // ['softHyphen', 'bidiOverrides', 'bidiOverrideSpan']
```

`spoofed` answers "was something disguised". For "is anything unusual here",
also read the categories that do not set it: `signals.mixed_non_legitimate`,
`signals.whole_word_lookalike`, `signals.encoding_damage`.

### Report only

To find and not change: ignore `normalized` and read `spoofed`, `signals`,
`words` and the callbacks. Each entry of `words` has the word as written, its
position and its signals:

```ts
const r = analyze(text, { hiddenChars: 'strict', confusionModel: 'language' });
for (const w of r.words) console.log(w.index, w.word, w.signals, w.normalized);
```

To keep hidden characters in the output while still getting the reports, set
their rules to `'report'`:

```ts
analyze('fr\u200Bee \u202Eabc', {
  hiddenChars: 'strict',
  confusionModel: 'language',
  hiddenCharRules: { zeroWidthInWord: 'report', bidiOverrides: 'report' },
}).normalized; // 'fr\u200Bee \u202Eabc'
```

### Custom look-alike packs

The pairs of each language can be changed. Packs are built once, outside the
calls:

```ts
import { analyze, buildLookalikes } from '@cycanics/unspoof';

const lookalikes = buildLookalikes({
  add: { English: [['ƨ', 's']] }, // a pair into English: donor, letter
  remove: { English: [['ı', 'i']] },
});
const options = { hiddenChars: 'strict', confusionModel: 'language', lookalikes } as const;

analyze('paƨƨword', options).normalized; // 'password'
analyze('click the lınk now', options).normalized; // 'click the lınk now'
```

- A pair is one direction: `[donor, letter of the language]`.
- `additional` adds ready-made packs of pairs that look alike only in some
  fonts (`CONDITIONAL_TWINS`); the default is `DEFAULT_ADDITIONAL_PACKS`.
  The pack `'optional'` is the opt-in pack of extra pairs, look-alikes too weak
  to be on by default (`𐔓` for `n`, `𐊖` for `s`): with
  `buildLookalikes({ additional: [...DEFAULT_ADDITIONAL_PACKS, 'optional'] })`,
  `the 𐔓ame here` becomes `the name here`.
  The option `conditionalTwins` selects them without building packs:
  `analyze('иser', { hiddenChars: 'strict', confusionModel: 'language', conditionalTwins: ['и~u'] })`
  gives `user` (with the default packs the word is reported and left).
  `conditionalTwins` is ignored when `lookalikes` is given: put the ids into
  `additional` instead.
- `defaultPacks()` returns the default pairs per language; `twinsOf('а')`
  lists the look-alikes of one letter by alphabet.

### Another set of languages

```ts
analyze('Здравей, cвят', {
  hiddenChars: 'strict',
  confusionModel: 'language',
  targetLanguages: ['English', 'Bulgarian'],
}).normalized; // 'Здравей, свят' (the Latin c becomes the Bulgarian с)
```

## Errors

Options are checked before the text is read. A value outside an option's range
throws a `RangeError`; an unknown name in a list of languages, alphabets or
packs throws a plain `Error` (a context of `resolveWord` that is no language:
a `RangeError`); a text that is no string throws a `TypeError`.

| Input                                                                            | Error                                                                  |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `analyze(5)`                                                                     | `TypeError: analyze: text must be a string`                            |
| `contextBuffer: 5`                                                               | `RangeError`: the buffer must hold `2 × majorityWindow + 1` words      |
| `breadth`, `rtlAwareness`, `htmlNamedReferences` with a value they do not take   | `RangeError`                                                           |
| `hiddenCharRules: { softHyphen: 'nope' }`                                        | `RangeError: analyze: rule softHyphen cannot be "nope"`                |
| `hiddenCharRules: { constructLimit: 0 }`, `terminal: { bareCR: 'overwrite' }`    | `RangeError`                                                           |
| `resolveWord('НОТ', { neighbours: 'Cyrillic' })` (a context that is no language) | `RangeError: resolveWord: context "Cyrillic" is not a target language` |
| `targetLanguages: ['Cyrillic']` (a script, not a language)                       | `Error: unknown target language Cyrillic`                              |
| `oneLetterDashAffix` with a name that is no language                             | `Error: unknown target language …`                                     |
| `donorAlphabets: ['Klingon']`                                                    | `Error: unknown donor alphabet Klingon`                                |
| `conditionalTwins` or `additional` with an unknown id                            | `Error: unknown look-alike pack …`                                     |
