# Performance

Measurements of `analyze` and `cleanHidden` on one machine, with the method and
the script that produced them. All numbers are absolute: milliseconds per call,
megabytes of UTF-8 input per second (1 MB = 2^20 bytes), nanoseconds per input
byte, megabytes of memory.

## Method

The script is [`bench/bench.mjs`](../bench/bench.mjs); it runs against the built
library (`npm run build`, then `node bench/bench.mjs`).

**Modes**

| Name               | Options                                                             |
| ------------------ | ------------------------------------------------------------------- |
| default            | none                                                                |
| lenient + alphabet | `{ confusionModel: 'alphabet' }`                                    |
| strict             | `{ hiddenChars: 'strict' }`                                         |
| strict + alphabet  | `{ hiddenChars: 'strict', confusionModel: 'alphabet' }`             |
| … + terminal       | strict + alphabet with `hiddenCharRules: { terminal: {} }`          |
| …, English only    | strict + alphabet with `targetLanguages: ['English']`               |
| cleanHidden        | `cleanHidden(text)`: the hidden-character stage alone, strict rules |

**Inputs**

| Name    | Content                                                                                                                                        |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| mixed   | English and Russian Markdown (prose, lists, links, code blocks, tables) with one input of the spoofing test corpus added to every fourth block |
| english | English sentences only (ASCII)                                                                                                                 |
| russian | Russian sentences only                                                                                                                         |
| refs    | the mixed text with every eighth word written as HTML character references                                                                     |
| escapes | the mixed text as a coloured terminal log: a colour sequence pair around every line, a window-title string every tenth line                    |
| hebrew  | Hebrew sentences with a right-to-left mark after every tenth word and an English word in two of five sentences                                 |
| hidden  | the mixed text with a zero-width space inside every fifth word                                                                                 |

Inputs are generated with a fixed seed and cut to the stated size in UTF-8
bytes.

**Timing.** One process, one thread. After warm-up calls, the same call is
repeated and each call is timed: 30 calls for 1 KB and 100 KB (for 1 KB one
sample is a batch of 200 calls, divided by 200), 15 calls for 1 MB, 11 for the
cost-factor table, 5 for 4 MB and 16 MB. The tables give the median and the
95th percentile. Garbage collection is not forced; it runs when the engine
schedules it and is part of the time.

**With callbacks** means all five callbacks are set (`onReport`, `onCleanup`,
`onRecord`, `onWord`, `onLostBound`), each one incrementing a counter.

**Cold start.** A new process per measurement: the time to import the library,
and the time of the first `analyze` call in that process. Median of 5
processes.

**Memory.** A new process per measurement builds the input and calls `analyze`
three times. _Peak RSS growth_ is the peak resident set size of that process
minus the peak of a process that only builds the input. _Heap held by the
result_ is the JavaScript heap in use after a garbage collection while the
result object is alive, minus the heap before the call.

## Machine

|                             |                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| CPU                         | Intel Core Processor (Broadwell, no TSX, IBRS), as the virtual machine reports it; 4 logical CPUs |
| Memory                      | 15.5 GB                                                                                           |
| OS                          | Linux 7.0.0-42-generic, x64                                                                       |
| Node                        | v20.19.5 (V8 11.3.244.8)                                                                          |
| Library                     | `@cycanics/unspoof` built from commit `a20fa31` (`npm run build`)                                 |
| Load average (1, 5, 15 min) | 0.91, 1.19, 1.00 before the run; 1.73, 1.43, 1.15 after                                           |

The machine was not idle: other processes ran during the measurement, as the
load average shows.

## Throughput and latency

Mixed text. "Callbacks: yes" is the call with all callbacks set. The rows with and
without callbacks differ by a few percent in either direction except at 1 MB in strict + alphabet mode
(147 ms and 185 ms). A second run of the script on a loaded machine gave that
pair in the opposite order, so this measurement does not establish a cost of
setting callbacks.

| mode               | callbacks | size   | median   | p95      | MB/s |
| ------------------ | --------- | ------ | -------- | -------- | ---- |
| default            | no        | 1 KB   | 175 µs   | 228 µs   | 5.6  |
| default            | yes       | 1 KB   | 183 µs   | 210 µs   | 5.3  |
| default            | no        | 100 KB | 13.2 ms  | 14.1 ms  | 7.4  |
| default            | yes       | 100 KB | 13.3 ms  | 14.5 ms  | 7.4  |
| default            | no        | 1 MB   | 140.0 ms | 150.8 ms | 7.1  |
| default            | yes       | 1 MB   | 144.1 ms | 153.4 ms | 6.9  |
| lenient + alphabet | no        | 1 KB   | 156 µs   | 203 µs   | 6.3  |
| lenient + alphabet | yes       | 1 KB   | 153 µs   | 160 µs   | 6.4  |
| lenient + alphabet | no        | 100 KB | 11.7 ms  | 12.9 ms  | 8.3  |
| lenient + alphabet | yes       | 100 KB | 11.1 ms  | 12.4 ms  | 8.8  |
| lenient + alphabet | no        | 1 MB   | 106.0 ms | 112.7 ms | 9.4  |
| lenient + alphabet | yes       | 1 MB   | 105.5 ms | 117.2 ms | 9.5  |
| strict             | no        | 1 KB   | 291 µs   | 307 µs   | 3.3  |
| strict             | yes       | 1 KB   | 293 µs   | 313 µs   | 3.3  |
| strict             | no        | 100 KB | 16.3 ms  | 18.0 ms  | 6.0  |
| strict             | yes       | 100 KB | 16.6 ms  | 17.7 ms  | 5.9  |
| strict             | no        | 1 MB   | 173.7 ms | 187.4 ms | 5.8  |
| strict             | yes       | 1 MB   | 178.7 ms | 191.2 ms | 5.6  |
| strict + alphabet  | no        | 1 KB   | 303 µs   | 318 µs   | 3.2  |
| strict + alphabet  | yes       | 1 KB   | 314 µs   | 332 µs   | 3.1  |
| strict + alphabet  | no        | 100 KB | 14.6 ms  | 16.6 ms  | 6.7  |
| strict + alphabet  | yes       | 100 KB | 14.3 ms  | 15.4 ms  | 6.9  |
| strict + alphabet  | no        | 1 MB   | 146.7 ms | 157.2 ms | 6.8  |
| strict + alphabet  | yes       | 1 MB   | 184.7 ms | 202.5 ms | 5.4  |

## Cold start

Mixed text, new process.

| mode              | size   | import  | first call |
| ----------------- | ------ | ------- | ---------- |
| default           | 1 KB   | 44.8 ms | 14.8 ms    |
| default           | 100 KB | 43.1 ms | 81.7 ms    |
| default           | 1 MB   | 44.1 ms | 420.2 ms   |
| strict + alphabet | 1 KB   | 44.5 ms | 61.1 ms    |
| strict + alphabet | 100 KB | 43.7 ms | 155.0 ms   |
| strict + alphabet | 1 MB   | 45.1 ms | 628.3 ms   |

## Cost factors

Every input at 1 MB, no callbacks.

| input   | mode                            | median   | MB/s  |
| ------- | ------------------------------- | -------- | ----- |
| mixed   | default                         | 151.6 ms | 6.6   |
| mixed   | strict + alphabet               | 145.0 ms | 6.9   |
| mixed   | cleanHidden                     | 13.0 ms  | 76.9  |
| english | default                         | 51.1 ms  | 19.6  |
| english | strict + alphabet               | 63.5 ms  | 15.8  |
| english | cleanHidden                     | 7.04 ms  | 142.0 |
| russian | default                         | 162.0 ms | 6.2   |
| russian | strict + alphabet               | 96.2 ms  | 10.4  |
| russian | strict + alphabet, English only | 775.0 ms | 1.3   |
| russian | cleanHidden                     | 9.98 ms  | 100.2 |
| refs    | default                         | 123.5 ms | 8.1   |
| refs    | strict + alphabet               | 185.6 ms | 5.4   |
| refs    | cleanHidden                     | 12.4 ms  | 80.6  |
| escapes | default                         | 179.1 ms | 5.6   |
| escapes | strict + alphabet               | 215.5 ms | 4.6   |
| escapes | strict + alphabet + terminal    | 216.6 ms | 4.6   |
| escapes | cleanHidden                     | 23.1 ms  | 43.4  |
| hebrew  | default                         | 205.5 ms | 4.9   |
| hebrew  | strict + alphabet               | 864.9 ms | 1.2   |
| hebrew  | cleanHidden                     | 14.9 ms  | 67.2  |
| hidden  | default                         | 251.0 ms | 4.0   |
| hidden  | strict + alphabet               | 233.0 ms | 4.3   |
| hidden  | cleanHidden                     | 30.3 ms  | 33.0  |

What the table shows:

- Clean English prose is the fastest input (15.8 to 19.6 MB/s); most of its
  words need no judging.
- HTML references (5.4 MB/s), escape sequences (4.6 MB/s) and a hidden
  character in every fifth word (4.3 MB/s) each cost time in strict + alphabet
  mode. Turning on the terminal rules does not change the time of the escapes
  input.
- Text in a language that was not requested is the slowest input for the
  alphabet model: Hebrew text 1.2 MB/s; Russian text 1.3 MB/s when English is
  the only requested language, and 10.4 MB/s with the default languages. The
  same inputs run at 4.9 and 6.2 MB/s without options, and `cleanHidden` reads
  the Hebrew input at 67 MB/s: the time is spent judging words, not reading
  direction marks.
- The hidden-character stage alone (`cleanHidden`) runs at 33 to 142 MB/s.

## Known slow inputs

Inputs that are read at a few megabytes per second or less. They are valid
input.

Measured with `node bench/bench.mjs --slow`: 1 MB of each input, no callbacks,
3 warm-up calls, median of 7 calls. Same machine and Node as above; library
built from commit `1d338d3` (the 41b fix: a word of an unrequested language in
text of that language is kept, not converted); load average 1.49, 1.88, 2.20
before this run and 2.98, 2.22, 2.28 after.

**Text whose letters belong to no requested language.** With the alphabet model
every word is still judged, though none of its letters can be converted.
Default languages (`['English', 'Russian', 'Ukrainian', 'Greek']`):

| Text     | No options | `{ confusionModel: 'alphabet' }` | `{ hiddenChars: 'strict', confusionModel: 'alphabet' }` |
| -------- | ---------- | -------------------------------- | ------------------------------------------------------- |
| Hebrew   | 5.8 MB/s   | 1.5 MB/s                         | 1.7 MB/s                                                |
| Arabic   | 6.2 MB/s   | 1.9 MB/s                         | 2.0 MB/s                                                |
| Japanese | 12.3 MB/s  | 2.5 MB/s                         | 2.6 MB/s                                                |
| Chinese  | 12.0 MB/s  | 3.6 MB/s                         | 3.8 MB/s                                                |
| Thai     | 11.3 MB/s  | 4.7 MB/s                         | 5.0 MB/s                                                |

**Text in a language the library knows, when that language was not requested.**
Most letters of such a text look like letters of the requested language, so
most words are judged as possible disguises:

| Text    | `targetLanguages` | No options | `{ confusionModel: 'alphabet', targetLanguages }` | `{ hiddenChars: 'strict', confusionModel: 'alphabet', targetLanguages }` |
| ------- | ----------------- | ---------- | ------------------------------------------------- | ------------------------------------------------------------------------ |
| Russian | `['English']`     | 6.1 MB/s   | 1.0 MB/s                                          | 1.2 MB/s                                                                 |
| English | `['Russian']`     | 19.0 MB/s  | 0.7 MB/s                                          | 0.8 MB/s                                                                 |

The 1 MB calls of this table took 0.8 to 1.4 seconds (837 to 1,435 ms).

**HTML character references and terminal logs.** The mixed text with every
eighth word written as references, and the mixed text as a coloured terminal
log:

| Text                  | No options | `{ confusionModel: 'alphabet' }` | `{ hiddenChars: 'strict', confusionModel: 'alphabet' }` |
| --------------------- | ---------- | -------------------------------- | ------------------------------------------------------- |
| HTML references       | 8.6 MB/s   | 9.2 MB/s                         | 5.0 MB/s                                                |
| Coloured terminal log | 6.0 MB/s   | 6.9 MB/s                         | 4.7 MB/s                                                |

## Scaling

No callbacks. The time per input byte stays constant from 250 KB to 16 MB
(mixed text) and from 250 KB to 4 MB (Hebrew text): the time grows linearly
with the size of the input.

| input  | mode              | size   | median    | MB/s | ns per byte |
| ------ | ----------------- | ------ | --------- | ---- | ----------- |
| mixed  | default           | 250 KB | 36.0 ms   | 6.8  | 141         |
| mixed  | default           | 1 MB   | 151.6 ms  | 6.6  | 145         |
| mixed  | default           | 4 MB   | 621.9 ms  | 6.4  | 148         |
| mixed  | default           | 16 MB  | 2502.9 ms | 6.4  | 149         |
| mixed  | strict + alphabet | 250 KB | 32.4 ms   | 7.5  | 127         |
| mixed  | strict + alphabet | 1 MB   | 143.4 ms  | 7.0  | 137         |
| mixed  | strict + alphabet | 4 MB   | 577.6 ms  | 6.9  | 138         |
| mixed  | strict + alphabet | 16 MB  | 2349.5 ms | 6.8  | 140         |
| hebrew | strict + alphabet | 250 KB | 206.4 ms  | 1.2  | 806         |
| hebrew | strict + alphabet | 1 MB   | 846.9 ms  | 1.2  | 808         |
| hebrew | strict + alphabet | 4 MB   | 3404.8 ms | 1.2  | 812         |

## Memory

Mixed text.

| mode              | callbacks | size  | peak RSS growth | heap held by the result |
| ----------------- | --------- | ----- | --------------- | ----------------------- |
| default           | no        | 1 MB  | 57.3 MB         | 1.0 MB                  |
| strict + alphabet | no        | 1 MB  | 27.8 MB         | 0.6 MB                  |
| strict + alphabet | yes       | 1 MB  | 32.8 MB         | 0.8 MB                  |
| default           | no        | 16 MB | 349.1 MB        | 29.5 MB                 |
| strict + alphabet | no        | 16 MB | 167.2 MB        | 25.1 MB                 |
| strict + alphabet | yes       | 16 MB | 172.5 MB        | 25.2 MB                 |

`analyze` returns the whole cleaned text and the list of affected words, so the
result grows with the input. Peak RSS growth includes memory the engine had not
yet collected. It varies between runs: two runs on this machine gave 27.8 MB and 47.9 MB
for the 1 MB input in strict + alphabet mode.
