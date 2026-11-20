# @cycanics/unspoof

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

Converts text into what a human reader sees, so that a program reading the text
(a language model, a filter, a search index) reads what the reader reads.

A person looking at `pаypal` sees "paypal". A program sees a word with the
Cyrillic letter `а` in it, which is no word it knows. A person looking at
`free` sees "free" even when a zero-width space sits between its letters, and
sees nothing at all of an instruction written in tag characters. The library
closes that gap in three ways:

- it **removes hidden characters**: zero-width characters, bidi controls, tag
  characters, escape sequences, stacked combining marks;
- it **resolves look-alike letters**, word by word, into the languages you
  request (`pаypal` → `paypal` for an English reader, `Пpивет` → `Привет` for a
  Russian one);
- it **reports what it found** through callbacks and in a result object, with
  positions in the input.

TypeScript, no runtime dependencies, ESM and CommonJS builds with type
declarations, Node 20 or later.

- [Install](#install)
- [Quick start](#quick-start)
- [Core concepts](#core-concepts)
- [Modes](#modes)
- [Options](#options)
- [Result and callbacks](#result-and-callbacks)
- [Other exports](#other-exports)
- [What it does not do](#what-it-does-not-do)
- [Performance](#performance)
- [Documentation](#documentation)

## Install

```bash
npm install @cycanics/unspoof
```

## Quick start

```ts
import { analyze } from '@cycanics/unspoof';

// The а in "pаypаl" and the оо in "gооgle" are Cyrillic letters;
// \u200B is a zero-width space.
const text = 'Verify your pаypаl acc\u200Bount at gооgle.com';

const result = analyze(text, {
  hiddenChars: 'strict', // a rule per class of hidden character
  confusionModel: 'language', // resolve look-alikes into the requested languages
  targetLanguages: ['English'], // the languages the reader reads
});

result.normalized; // 'Verify your paypal account at google.com'
result.spoofed; // true
result.signals.mixed_spoof; // true: look-alikes inside words were converted
result.signals.invisible; // true: a hidden character was removed
result.words.map((w) => `${w.word} → ${w.normalized}`);
// ['pаypаl → paypal', 'acc\u200Bount → account', 'gооgle → google']
```

Findings can also be read while the text is processed:

```ts
const words = [];
analyze(
  'please pay Pаypаl now',
  { hiddenChars: 'strict', confusionModel: 'language' },
  {
    onReport: (mark) => console.log(mark.kind, mark.start, mark.length),
    onWord: (start, end, cleaned, replacement, reason) =>
      words.push({ start, end, cleaned, replacement, reason }),
  },
);
// words: [{ start: 11, end: 17, cleaned: 'Pаypаl', replacement: 'Paypal',
//           reason: { signals: ['mixed_spoof'], converted: true, toLang: 'English' } }]
```

In these examples and in the documentation, invisible characters are written as
escapes (`\u200B`); look-alike letters are written as they are.

## Core concepts

**Requested languages.** With `confusionModel: 'language'` you name the
languages the reader reads: `targetLanguages`, default
`['English', 'Russian', 'Ukrainian', 'Greek']`. A word is only ever converted
into one of them, and the first is the primary target, used when nothing else
decides. Targets are languages, not scripts: Russian and Ukrainian are two
languages, and a Russian context never turns a word into a Ukrainian one.
Available: English, European, Russian, Ukrainian, Belarusian, Bulgarian,
Serbian, Macedonian, Kazakh, Tajik, Uzbek, Caucasian, Greek
(`TARGET_LANGUAGES`).

**Look-alikes and donors.** A look-alike is a pair with a direction: a
character that is not a letter of a language, and the letter of that language a
reader takes it for (Cyrillic `а` for English `a`; English `a` for Russian
`а`). A _donor_ is a character that is a letter of no requested language and
looks like a letter of one: Cherokee `Ꭺ`, the long s `ſ`, a Bengali digit that
looks like `8`, or a letter of a language you did not request. The pairs come
in packs, one per language, and can be changed (`buildLookalikes`).

**Context.** A word written wholly in the letters of one requested language
(`НОТ` consists of Russian letters) is converted into another one only when the
words around it are written in that language: `НОТ dog` → `HOT dog`, while
`Мы были в НОТ` and a lone `НОТ` stay. Context is the nearest word on each
side, then a window of 10 words on each side, within a paragraph.

**Converted or reported.** The library converts where the reader would misread
the text, and reports the rest without changing it. `spoofed` is `true` only
when something was disguised:

| Signal                 | Meaning                                                                                                                    | Sets `spoofed` |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `confusable_word`      | a whole word of look-alikes was converted (with `wholeScriptFold: 'off'`: kept and reported)                               | yes            |
| `mixed_spoof`          | a word mixing alphabets had its look-alike letters converted                                                               | yes            |
| `mixed_legitimate`     | a word mixing a script written without spaces (Han, kana, …) with another, or Latin with Chinese, Japanese or Korean; kept | no             |
| `mixed_non_legitimate` | any other word mixing alphabets, nothing converted: the mix is visible to the reader; kept                                 | no             |
| `whole_word_lookalike` | a whole word its context would convert, kept because a word next to it is of the word's own language                       | no             |
| `invisible`            | hidden characters were removed                                                                                             | yes            |
| `zalgo`                | combining marks stacked past the limit of the script were trimmed                                                          | yes            |
| `illegal`              | control characters or escape sequences were removed                                                                        | yes            |
| `encoding_damage`      | U+FFFD, left by a decoder that could not read its input; kept                                                              | no             |
| `mixed_script`         | the Latin-fold model's signal for a word mixing scripts (converted to Latin letters)                                       | yes            |

One example per signal, with `{ hiddenChars: 'strict', confusionModel: 'language' }`:

<!-- examples: readme-signals -->

| Input                       | Output                      | Spoofed | Signals                |
| --------------------------- | --------------------------- | ------- | ---------------------- |
| `НОТ dog`                   | `HOT dog`                   | yes     | `confusable_word`      |
| `pаypal`                    | `paypal`                    | yes     | `mixed_spoof`          |
| `iPhone用`                  | `iPhone用`                  | no      | `mixed_legitimate`     |
| `Smith는`                   | `Smith는`                   | no      | `mixed_legitimate`     |
| `Facebookом`                | `Facebookом`                | no      | `mixed_non_legitimate` |
| `ЮKassa`                    | `ЮKassa`                    | no      | `mixed_non_legitimate` |
| `Please read the ВООК друг` | `Please read the ВООК друг` | no      | `whole_word_lookalike` |
| `fr\u200Bee`                | `free`                      | yes     | `invisible`            |
| `Z̸̢̬̈a̛̠͎lgo`                     | `Z̸̢a̛̠lgo`                     | yes     | `zalgo`                |
| `a\u0001b`                  | `ab`                        | yes     | `illegal`              |
| `Jos�`                      | `Jos�`                      | no      | `encoding_damage`      |

<!-- /examples -->

And with other options:

<!-- examples: readme-signals-other -->

| Input           | Options                                                                       | Output          | Spoofed | Signals           |
| --------------- | ----------------------------------------------------------------------------- | --------------- | ------- | ----------------- |
| `busіnеss`      | `{}`                                                                          | `business`      | yes     | `mixed_script`    |
| `buy аррӏе now` | `{hiddenChars: 'strict', confusionModel: 'language', wholeScriptFold: 'off'}` | `buy аррӏе now` | yes     | `confusable_word` |

<!-- /examples -->

**Hidden characters and rules.** With `hiddenChars: 'strict'` every class of
hidden character has a rule (`softHyphen`, `zeroWidthInWord`, `bidiOverrides`,
`tags`, …) and every rule has a mode: remove and count, remove silently, report
only, or off. Characters that belong to the writing stay: a joiner in Persian
or Devanagari text, one variation selector, emoji sequences, direction marks in
right-to-left text.

**HTML character references.** With both options a reference such as
`&#1072;` or `&ZeroWidthSpace;` is read as the character it encodes, so nothing
hides behind it: `p&#1072;ypal` → `paypal`. A reference whose character is not
changed stays as written (`AT&amp;T`).

**Right-to-left text.** Direction marks are judged per paragraph: kept where
the paragraph has right-to-left letters, removed where it has none. A word that
holds right-to-left letters is read in the order the reader sees it
(`rtlAwareness`, default on).

**Limits.** The text is processed as a stream. With either option set, a word longer than
250 characters is not judged; a construct that never ends (an unterminated escape
string, an unclosed bidi override) is cut at a limit and reported through
`onLostBound`.

Each concept is described with examples in the [guide](./docs/guide.md).

## Modes

Two options select the behaviour of the two stages, hidden characters and
words:

| Mode               | Options                                                 | Hidden characters                      | Look-alikes                                       |
| ------------------ | ------------------------------------------------------- | -------------------------------------- | ------------------------------------------------- |
| Default            | none                                                    | lenient: a small fixed set of rules    | Latin-fold model: replaced by Latin look-alikes   |
| Lenient + language | `{ confusionModel: 'language' }`                        | lenient                                | language model: resolved into requested languages |
| Strict             | `{ hiddenChars: 'strict' }`                             | strict: a rule per class, configurable | Latin-fold model                                  |
| Strict + language  | `{ hiddenChars: 'strict', confusionModel: 'language' }` | strict                                 | language model                                    |

Two inputs in each mode (`Пpивет` is a Russian word with a Latin `p`; `НОТ` is
written in Cyrillic letters):

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

- The **Latin-fold model** compares every word with Latin letters through the
  UTS #39 confusables table and has no target languages: every look-alike is
  replaced by the Latin letter it resembles, whatever language the word is
  written in, so a Russian word with one Latin letter in it comes out as a word
  of no language.
- The **language model** works out which requested language a word belongs to
  and converts toward it, and it reports mixed words by category instead of
  converting all of them.
- **Strict** adds the rule set with per-rule modes and report kinds, escape
  sequences, mojibake reports, and reads styled letters inside words
  (`pⓐypal` → `paypal`).
- **Strict + language** is the combination for text that goes to a large
  language model; HTML character references are read only in this mode.

## Options

`analyze(text, options?, callbacks?)`. Every option is optional.

### Mode

| Option           | Default        | Purpose                                            |
| ---------------- | -------------- | -------------------------------------------------- |
| `hiddenChars`    | `'lenient'`    | `'strict'`: a configurable rule per class          |
| `confusionModel` | `'latin-fold'` | `'language'`: resolve into the requested languages |

### Languages and look-alikes (language model)

| Option             | Default                                        | Purpose                                                                                                                                    |
| ------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `targetLanguages`  | `['English', 'Russian', 'Ukrainian', 'Greek']` | the requested languages, primary first                                                                                                     |
| `lookalikes`       | `defaultLookalikes()`                          | the look-alike packs, built once with `buildLookalikes`                                                                                    |
| `conditionalTwins` | `χ~x`, `χ~х`, `ҳ~x`, `ҳ~χ`                     | extra pairs that look alike only in some fonts (`CONDITIONAL_TWINS`)                                                                       |
| `donorAlphabets`   | every alphabet no requested language uses      | the alphabets whose letters count as look-alikes without being targets                                                                     |
| `inputLanguages`   | none                                           | the languages the input is written in (`'Russian'`, …): their whole words are genuine, never converted (targets are what the reader reads) |

### Word decisions (language model)

| Option               | Default    | Purpose                                                                                                     |
| -------------------- | ---------- | ----------------------------------------------------------------------------------------------------------- |
| `wholeScriptFold`    | `'all'`    | whole words of look-alikes: `'all'` by context, `'foreign-letters'` only with evidence in the word, `'off'` |
| `hostileInput`       | `false`    | also convert a single look-alike letter at the end of a mixed word (`Applе` → `Apple`)                      |
| `affixSeparator`     | not set    | keep a real ending glued to a word and set it off by this string (`'-'`: `Windowsах` → `Windows-ах`)        |
| `oneLetterDashAffix` | none       | languages whose one-letter part before a dash is kept as a prefix (`Р-aypal`)                               |
| `rtlAwareness`       | `true`     | read a word with right-to-left letters in on-screen order                                                   |
| `ladder`             | `3`, `2/3` | `wordMajorityMinLetters`, `wordMajorityMinShare`: when a majority of a word's letters decides its language  |

### Context (language model)

| Option           | Default                                   | Purpose                                                          |
| ---------------- | ----------------------------------------- | ---------------------------------------------------------------- |
| `majorityWindow` | `10`                                      | words on each side that vote on a word's language                |
| `contextBuffer`  | `100`                                     | words kept for context; at least `2 × majorityWindow + 1`        |
| `breadth`        | `'window'` (language model), else `'all'` | `'window'`: all context from the buffer; `'all'`: the whole text |

### Styled and math characters

| Option            | Default                         | Purpose                                                                    |
| ----------------- | ------------------------------- | -------------------------------------------------------------------------- |
| `neutralAlphabet` | on with `hiddenChars: 'strict'` | read circled, fullwidth and math letters, ligatures, Roman numerals, units |
| `keepMathLetters` | `false`                         | keep math letters as written and do not judge words made of them           |
| `mathTarget`      | `false`                         | treat words of Latin and Greek letters as math (`mixed_legitimate`)        |

### Hidden characters (strict)

| Option                                   | Default               | Purpose                                                                                   |
| ---------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------- |
| `hiddenCharRules`                        | `STRICT_HIDDEN_RULES` | the mode of each rule; the full list is in the [guide](./docs/guide.md#hidden-characters) |
| `hiddenCharRules.terminal`               | not set               | `{}` turns on the terminal rules: a class per escape sequence, backspace erases           |
| `hiddenCharRules.invisibleMathOperators` | not set               | `'keep'` keeps U+2061–2064 in math text                                                   |
| `hiddenCharRules.constructLimit`         | `4096`                | how far an unbounded construct is followed, in code points                                |
| `htmlNamedReferences`                    | `'lenient'`           | `'strict'`: named references only with `;` (strict + language)                            |

## Result and callbacks

```ts
const result = analyze('Login at pаypal.com, fr\u200Bee НОТ dog', {
  hiddenChars: 'strict',
  confusionModel: 'language',
});
```

| Field            | Value for the call above                                                 | Meaning                                                                 |
| ---------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `normalized`     | `'Login at paypal.com, free HOT dog'`                                    | the text as the reader sees it                                          |
| `changed`        | `true`                                                                   | `normalized` differs from the input                                     |
| `spoofed`        | `true`                                                                   | a signal that means disguise fired (`SPOOFING_SIGNALS`)                 |
| `signals`        | `confusable_word`, `invisible`, `mixed_spoof` are `true`                 | which signals fired; the four word categories are present only when set |
| `words`          | three entries                                                            | the affected words, in input order                                      |
| `counts`         | `{ wordsTotal: 7, wordsAffected: 3, confusableWords: 1, mixedWords: 1 }` | totals                                                                  |
| `dominantScript` | `'Latin'`                                                                | the most frequent script among the letters                              |

An entry of `words`:

```ts
{
  word: 'НОТ', // as written in the input
  index: 27, // position in the input
  signals: ['confusable_word'],
  scripts: ['Cyrillic'], // scripts of its letters, where the word stage recorded them
  skeleton: 'HOT',
  normalized: 'HOT', // the word in the output
  resolution: {
    // how the language model decided, for a word judged as a whole
    class: 'confusable',
    language: 'English', // the language it was converted into
    rule: 'neighbours', // the step that decided: the nearest words
    folded: true,
    context: { neighbours: ['English'], window: 'English' },
    candidates: ['English', 'Russian', 'Ukrainian', 'Greek'],
    rejected: {},
  },
}
```

Callbacks are the third argument of `analyze`, and of `cleanHidden`:

| Callback                                           | Called for                                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `onReport(mark)`                                   | every mark of every rule: `{ kind, start, length, extracted, count }`                      |
| `onCleanup(region, cleanup)`                       | every stretch of removals; may return the caller's own replacement text                    |
| `onRecord(record)`                                 | the cleaned text piece by piece, `{ start, length, text }`, with the caller's replacements |
| `onWord(start, end, cleaned, replacement, reason)` | `analyze`: every word converted or reported, and every word past the length limit          |
| `onLostBound(bound)`                               | a construct whose end was not found within its limit: `{ kind, start, length }`            |
| `signal`                                           | an `AbortSignal`: stops the scan; the result covers what was read                          |

`reason` of `onWord` is `{ signals?, converted?, toLang?, rule?, tooBig? }`: the
word's signals, whether it was converted, the requested language whose letters
the output is written in (`null` when kept, when no requested language holds the
output, and under the Latin-fold model, which has no languages), the step that decided, and `tooBig: true` for a word past
the length limit.

The library does not decode what it finds: `extracted` is the hidden part as
the input has it (the tag characters, the body of an escape string, the text an
override reverses). The library's result never depends on what a callback
returns. Details and examples: [guide, Callbacks](./docs/guide.md#callbacks).

## Other exports

| Export                                                                       | Purpose                                                                                                      |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `cleanHidden(text, rules?, callbacks?)`                                      | the hidden-character stage alone; returns the cleaned text, look-alikes untouched                            |
| `cleanTerminal(text, rules?, callbacks?)`                                    | escape sequences, backspace and bare CR alone                                                                |
| `buildLookalikes(config)`, `defaultLookalikes()`, `defaultPacks()`           | build, or read, the look-alike packs; `additional: ['optional']` adds the opt-in pack of extra pairs         |
| `resolveWord(word, context?, options?)`                                      | the language model's decision for one word, given the languages of its context                               |
| `twinsOf(char)`                                                              | the look-alikes of one letter, by alphabet                                                                   |
| `skeleton(text)`                                                             | the UTS #39 skeleton, for comparing two identifiers: `skeleton('раураl') === skeleton('paypal')`             |
| `primaryScript(char)`, `SCRIPT_NAMES`                                        | the script of a character; the script names used in `scripts` and `dominantScript`                           |
| `TARGET_LANGUAGES`, `DEFAULT_TARGET_LANGUAGES`                               | the languages and their letters                                                                              |
| `STRICT_HIDDEN_RULES`, `TERMINAL_RULES`, `MARK_STACK_LIMITS`                 | the default rule sets and mark limits                                                                        |
| `WORD_CAP`, `CONSTRUCT_LIMIT`, `STRING_LIMIT`                                | the limits: 250 characters, 4,096 and 16,777,216 code points                                                 |
| `SPOOF_SIGNALS`, `SPOOFING_SIGNALS`                                          | the signal names; the ones that set `spoofed`                                                                |
| `UNICODE_VERSION`, `DATA_DATE`, `IVD_VERSION`                                | the versions of the Unicode data compiled in                                                                 |
| `LANGUAGES`                                                                  | the languages grouped by script, with their letters                                                          |
| `CONFUSION_ALPHABETS`                                                        | the alphabets of the look-alike table: Latin, Cyrillic, Greek, Armenian, Cherokee, Coptic, LatinExtra, Donor |
| `CONDITIONAL_TWINS`, `DEFAULT_CONDITIONAL_TWINS`, `DEFAULT_ADDITIONAL_PACKS` | the font-dependent pairs by id, and the ids on by default                                                    |
| `MARK_STACK_DEFAULT_LIMIT`                                                   | the mark limit of a script `MARK_STACK_LIMITS` does not list (5)                                             |
| `TAIL_MARKS`                                                                 | the code points of the marks that end a word (`©`, `®`, `™`, …)                                              |
| `RU_CASE_ENDINGS`                                                            | the Russian case endings accepted after an apostrophe (`GitHub'а`)                                           |
| `PSEUDO_SCRIPTS`, `SUPPORTED_SCRIPTS`                                        | `Common`, `Inherited`, `Unknown`; the script names this JavaScript engine supports                           |
| `LEGITIMATE_SCRIPT_COMBINATIONS`                                             | Latin-fold model: script mixes that are not `mixed_script` (Han with kana, Hangul or Bopomofo)               |
| `FORMAT_CHAR_SCRIPTS`                                                        | lenient rules: scripts whose letters may carry joiners and stacked marks                                     |
| `ZALGO_MARK_RUN`, `ZERO_WIDTH_INERT_RUN`                                     | lenient rules: marks per letter at which `zalgo` fires (3); longest isolated zero-width run left alone (4)   |

### Types

| Type                                                                                                       | What it describes                                                                                                      |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `AnalyzeOptions`, `AnalysisResult`, `WordFinding`                                                          | the options, the result and one entry of `words`                                                                       |
| `SpoofSignal`, `WordCategory`, `MixedCategory`                                                             | the signal names; the four word categories; the three `mixed_…` ones                                                   |
| `AnalyzeCallbacks`, `CleanupCallbacks`, `HiddenCallbacks`                                                  | the callbacks of `analyze`; of `cleanHidden` and `cleanTerminal` (two names, one type)                                 |
| `Mark`, `Region`, `OutputRecord`, `LostBound`                                                              | the arguments of `onReport`, `onCleanup`, `onRecord`, `onLostBound`                                                    |
| `WordCallback`, `WordReason`                                                                               | the signature of `onWord` and its `reason`                                                                             |
| `HiddenCharRules`, `HiddenAction`, `HiddenContentAction`, `RuleMode`                                       | the rule set; a rule's mode; the modes with `'remove-with-content'`; the three basic modes                             |
| `TerminalRules`, `TerminalClass`                                                                           | the terminal rule set and its report kinds                                                                             |
| `TargetLanguage`, `ScriptName`, `PseudoScript`                                                             | a language name; a script name; `Common`, `Inherited` or `Unknown`                                                     |
| `Lookalikes`, `LookalikeConfig`, `LookalikePack`, `LookalikePair`, `AdditionalPackId`, `ConditionalTwinId` | built packs; the argument of `buildLookalikes`; pairs per language; one pair; pack ids                                 |
| `ConfusionAlphabet`, `DonorAlphabet`, `ConfusionModelOptions`, `Evidence`                                  | an alphabet of the look-alike table; the language options shared by `twinsOf` and `resolveWord`; why a word was judged |
| `WordResolution`, `ResolutionRule`, `ResolveOptions`, `WholeScriptFold`                                    | the result of `resolveWord`; the deciding step; its options; the values of `wholeScriptFold`                           |

## What it does not do

- **No dictionary.** The library does not know words. It decides by letters,
  pairs and context, so it cannot tell that `Applе` (Cyrillic `е`) "must be"
  Apple when Russian is also a requested language: such a word is reported, not
  converted (`hostileInput` converts it). A whole word of look-alikes with no
  context (`сор` alone) stays as written.
- **JSON is text.** A JSON escape such as `\u0430` is six ASCII characters to
  the library, not the letter `а`. Parse JSON first and pass the string values.
- **No math detection.** Math letters are converted like any styled letter
  unless you say the text is math: `keepMathLetters`, `mathTarget` and the
  `invisibleMathOperators` rule.
- **No console mode.** The library does not reproduce a terminal screen. A lone
  carriage return is a line break, not "overwrite the line"; cursor movements
  are removed, not followed. Escape sequences, concealed text and backspace
  erasing are handled (see the guide).
- **No decoding of hidden content.** Tag characters, variation selectors and
  zero-width runs are removed and handed to `onReport` as they are; turning
  them into bytes or text is the caller's.
- **No repair.** Mojibake and U+FFFD are reported and left as written.
- **Not a normalizer.** Superscripts, subscripts and ordinal indicators stay;
  text that needs no conversion is returned unchanged.
- **Not an HTML sanitizer.** Character references are read; tags, attributes
  and scripts are text to the library and pass through.
- **No guarantee.** Whether two characters look alike depends on the font and
  the reader. The pairs are a curated list, not an exhaustive one: a clean
  result means none of the known disguises was found.
- **No size limit of its own.** The time and the memory of a call grow with the
  input (see [Performance](#performance)).
- **A fixed list of languages.** A language outside `TARGET_LANGUAGES` cannot
  be requested. Turkish `ı` is kept only next to other Turkish letters (see the
  guide).

## Performance

Measured with [`bench/bench.mjs`](./bench/bench.mjs) on an Intel Broadwell
virtual machine (4 logical CPUs), Node 20.19.5, one thread, library built from
commit `a20fa31`; median of repeated
calls in a warm process. Input: English and Russian Markdown with spoofed words
added. MB is 2^20 bytes of UTF-8.

| Mode               | 1 KB    | 100 KB  | 1 MB   | Throughput at 1 MB |
| ------------------ | ------- | ------- | ------ | ------------------ |
| Default            | 0.18 ms | 13.2 ms | 140 ms | 7.1 MB/s           |
| Lenient + language | 0.16 ms | 11.7 ms | 106 ms | 9.4 MB/s           |
| Strict             | 0.29 ms | 16.3 ms | 174 ms | 5.8 MB/s           |
| Strict + language  | 0.30 ms | 14.6 ms | 147 ms | 6.8 MB/s           |

- **Time grows linearly with size**: 127 to 140 ns per input byte from 250 KB
  to 16 MB in strict + language mode.
- **The content matters more than the mode** (1 MB, strict + language): clean
  English prose 15.8 MB/s; text with HTML references in every eighth word
  5.4 MB/s; a coloured terminal log 4.6 MB/s; a hidden character in every fifth
  word 4.3 MB/s.
- **Known slow inputs** (language model): text whose letters belong to no
  requested language (Hebrew or Arabic 1.5 to 1.8 MB/s, Japanese, Chinese or
  Thai 2.4 to 5.1 MB/s), and text in a language that was not requested (Russian
  with `targetLanguages: ['English']` 1.1 to 1.3 MB/s, English with
  `['Russian']` 0.7 to 0.8 MB/s). Measurements:
  [Known slow inputs](./docs/performance.md#known-slow-inputs).
- **`cleanHidden` alone** runs at 33 to 142 MB/s on the same inputs.
- **Callbacks**: no cost of setting callbacks could be established. The calls
  with and without them differ by less than the variation between runs.
- **The first call in a new process is slower**: 61 ms for 1 KB and 628 ms for
  1 MB in strict + language mode, after 45 ms to import the library.
- **Memory**: the result of a 16 MB input holds 25 MB of heap; the process's
  peak memory grew by 167 MB during the call (strict + language).

Method, machine and every table: [docs/performance.md](./docs/performance.md).

## Documentation

- [docs/guide.md](./docs/guide.md): behaviour by area with examples (hidden
  characters, terminal controls, bidi, HTML references, mojibake, look-alikes
  and language choice, mixed words, affixes, digits, styled and math
  characters, Turkish, limits, callbacks), and recipes.
- [docs/performance.md](./docs/performance.md): the measurements and how they
  were made.
- [docs/confusion-model.md](./docs/confusion-model.md): the technical
  reference: the look-alike tables, the resolution algorithm, the rule
  definitions, and the evidence behind them.

The examples in this README and in the guide are run against the built library
by [`scripts/doc-examples.mjs`](./scripts/doc-examples.mjs).

Breaking changes between releases are listed in [CHANGELOG.md](./CHANGELOG.md).
To report a vulnerability, see [SECURITY.md](./SECURITY.md).

## Unicode data

The look-alike tables are derived from the Unicode Consortium's
[UTS #39](https://www.unicode.org/reports/tr39/) security data (Unicode
17.0.0) and reviewed pair by pair; variation sequences are checked against the
Ideographic Variation Database. `npm run generate:data` regenerates the data
files. Script classification uses the JavaScript engine's own Unicode property
tables.

## Upgrading

Breaking changes per version, with the old and the new form: [MIGRATING.md](./MIGRATING.md)
(shipped in the package).

## Credits and license

A fork of [`@moderation-api/unicode-spoofing`](https://github.com/moderation-api/unicode-spoofing)
(MIT). Licensed under the [MIT license](./LICENSE).

### Third-party data

The package bundles the HTML named character references of the WHATWG HTML
Living Standard (© WHATWG, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/))
and data derived from Unicode data files (UTS #39, the Unicode Character
Database, the Ideographic Variation Database; © Unicode, Inc.,
[Unicode License v3](https://www.unicode.org/license.txt)). The full notices are
in [LICENSE](./LICENSE), section "Third-party data".
