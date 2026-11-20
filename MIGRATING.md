# Migrating

Breaking changes between published versions, with the old form and the new one.
The [CHANGELOG](https://github.com/cycanics/unspoof/blob/main/CHANGELOG.md) lists every change.

## 0.6.x → 1.0.1

Node.js requirement unchanged (`>=20`). The package stays dual ESM/CJS.

### Option names and values

| 0.6.x                                                             | 1.0.1                                                            | notes                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `confusionModel: 'latin'` (default)                               | `confusionModel: 'latin-fold'` (default)                         | Every word is compared with Latin letters through the UTS #39 confusables table; no target languages. Omitting the option keeps working.                                                                                                                                                                                         |
| `confusionModel: 'alphabet'`                                      | `confusionModel: 'language'`                                     | Each word is resolved into one of the requested `targetLanguages`.                                                                                                                                                                                                                                                               |
| `expectedScripts: ['Cyrillic']`                                   | `inputLanguages: ['Russian']` (or `['Russian', 'Ukrainian']`, …) | The languages the input is written in: a whole word written in the letters of one of them is genuine and never folded, under both models. A script covered every language of that script; name each language now. Unlike `targetLanguages` (what the reader reads), it adds no target. Names are checked like `targetLanguages`. |
| `expectedScripts: ['Latin']`                                      | `inputLanguages: ['English']`                                    | A word with no letter of the named languages is the one flagged as a whole-word look-alike.                                                                                                                                                                                                                                      |
| `conditionalTwins` with `'п~n'`                                   | remove the id                                                    | `п` and `n` are ordinary twins in the English, Russian and Ukrainian packs. To drop them: `buildLookalikes({ remove: { English: [['п', 'n']], Russian: [['n', 'п']], Ukrainian: [['n', 'п']] } })`.                                                                                                                              |
| `conditionalTwins` without `'ı~i'` to keep `ı` (0.6.1)            | `buildLookalikes({ remove: { English: [['ı', 'i']] } })`         | `ı` → `i` is in the default packs of English and European, no longer a conditional twin; `DEFAULT_CONDITIONAL_TWINS` does not list `ı~i`.                                                                                                                                                                                        |
| `hiddenCharRules.reportContent`, `hiddenCharRules.decodePayloads` | removed                                                          | Hidden content streams through `onReport` as the input has it; the library decodes no payload.                                                                                                                                                                                                                                   |

Errors:

- `confusionModel: 'alphabet'` and `'latin'` throw a `RangeError` naming the new value; any other unknown value throws a `RangeError`.
- `expectedScripts` (and `expectedLanguages`) throw a `RangeError` naming `inputLanguages`, in `analyze` and `resolveWord`.
- An unknown hidden-character rule value throws a `RangeError`.
- `conditionalTwins: ['п~n']` throws an `Error` under `confusionModel: 'language'`.
- `resolveWord(word, { neighbours, window })` takes language names; an alphabet name such as `'Cyrillic'` throws a `RangeError`.

### Results and exports

| 0.6.x                                                                                                                                                           | 1.0.1                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cleanHidden(text, rules)` returns `{ cleaned, edits, findings, payloads, content, removed }`                                                                   | `cleanHidden(text, rules?, callbacks?)` returns the cleaned string; marks, regions and records go to `onReport`, `onCleanup`, `onRecord`.                                                                                |
| `analyze(...).hidden`, `counts.hiddenWords`                                                                                                                     | removed; use the `onReport` callback of `analyze`                                                                                                                                                                        |
| exports `PAYLOAD_HEX_CAP`, `HiddenClass`, `HiddenCleanup`, `HiddenContent`, `HiddenContentKind`, `HiddenEdit`, `HiddenFinding`, `HiddenPayload`, `HiddenReport` | removed with the fields above                                                                                                                                                                                            |
| `resolution.script` (an alphabet)                                                                                                                               | removed; the script of the output letters is `TARGET_LANGUAGES[resolution.language].script`                                                                                                                              |
| `resolution.context.neighbours: ConfusionAlphabet \| null`, `context.window` an alphabet                                                                        | `neighbours: TargetLanguage[]` (the languages both nearest words share), `window: TargetLanguage \| null`; `candidates` are languages, `resolution.language` is new                                                      |
| `resolution.rejected` keyed by alphabet                                                                                                                         | keyed by requested language, each with its own reason (`{ Russian: 'softHardNotAfterVowel', Ukrainian: 'softNotAfterVowel' }`)                                                                                           |
| `resolution.rule: 'no-valid-alphabet'`                                                                                                                          | `'no-valid-language'`                                                                                                                                                                                                    |
| `mixed_script` under `confusionModel: 'alphabet'`                                                                                                               | under `'language'`: `mixed_spoof`, `mixed_legitimate` or `mixed_non_legitimate`; the default path keeps `mixed_script`. New signal `whole_word_lookalike` (not a spoof). The new keys appear in `signals` only when set. |

### Behaviour callers should know

- Under `'language'` every decision reads only the requested `targetLanguages`: letters of unrequested languages are not legitimate, and unrequested languages cast no context vote.
- The default path folds the long s `ſ` to `s`, not `f` (`ſecure` → `secure`).
- With `hiddenChars: 'strict'`, `confusionModel: 'language'` or `neutralAlphabet`, a word longer than 250 characters is not judged (`onWord` gets `tooBig`).
- With `hiddenChars: 'strict'` and `confusionModel: 'language'`, HTML character references are decoded before every rule; positions map back to the input.
