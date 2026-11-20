import { IVD_PACKED } from './data/ivd.generated';

let table: Map<number, number> | null = null;

/** Base → bit mask of its registered supplement selectors (bit k = U+E0100 + k). */
function ivd(): Map<number, number> {
  if (table) return table;
  table = new Map();
  let base = 0;
  for (const entry of IVD_PACKED.split(',')) {
    const colon = entry.indexOf(':');
    base += parseInt(entry.slice(0, colon), 36);
    table.set(base, parseInt(entry.slice(colon + 1), 36));
  }
  return table;
}

/** Whether the Ideographic Variation Database registers `selector` (U+E0100–E01EF) on `base`. */
export function ivdRegistered(base: number, selector: number): boolean {
  const k = selector - 0xe0100;
  if (k < 0 || k > 0xef) return false;
  const mask = ivd().get(base);
  return mask !== undefined && Math.floor(mask / 2 ** k) % 2 === 1;
}
