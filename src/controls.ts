/** The control layer without the terminal grammar: one mark per control character or CSI sequence. */

import type { RawMark } from './core';
import { modeOf, type Action } from './detectors';

/**
 * Control characters; built from a string, the literal would trip no-control-regex.
 * U+009B is also cp1252 `›` read as Latin-1: as a CSI it needs a parameter, or a
 * final that is not a letter followed by a letter (`Home \u009B Products` keeps `Products`).
 */
export const CONTROL_SOURCE =
  '\\u001B\\[[0-?]*[ -/]*[@-~]|\\u009B(?:[0-?]+[ -/]*[@-~]|[ -/]*(?:[@[-`{-~]|[A-Za-z](?!\\p{L})))|[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F\\uFFFE]';
/** VT, FF and NEL separate words, as in extracted PDF text. */
export const CONTROL_SPACE_RE = /^[\v\f\u0085]$/;

/** Rule `controlChars`: C0 controls except tab, LF, CR; DEL; C1; U+FFFE; a CSI sequence as one. */
export function* controlMarks(text: string, action: Action, listen: boolean): Generator<RawMark> {
  const mode = modeOf(action);
  if (mode === null || (mode === 'report' && !listen)) return;
  const re = new RegExp(CONTROL_SOURCE, 'gu');
  const counted = action !== 'remove-silent';
  for (let m = re.exec(text); m; m = re.exec(text)) {
    yield {
      rule: 'controlChars',
      cls: 'controlChar',
      start: m.index,
      end: m.index + m[0].length,
      n: 1,
      value: CONTROL_SPACE_RE.test(m[0]) ? ' ' : '',
      mode,
      counted,
      layer: true,
    };
  }
}
