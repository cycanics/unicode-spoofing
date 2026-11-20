#!/usr/bin/env node
/**
 * Runs every example of README.md, docs/guide.md and docs/confusion-model.md against the built library
 * (`dist/index.js`; run `npm run build` first) and prints the tables the guide
 * embeds: input, output, `spoofed`, signals and, where the section is about
 * hidden characters, the marks of the report callback.
 *
 *   node scripts/doc-examples.mjs                  # every section, as Markdown
 *   node scripts/doc-examples.mjs bidi             # the sections whose id starts with "bidi"
 *   node scripts/doc-examples.mjs --write FILE     # fills FILE's `<!-- examples: ID -->` blocks
 *
 * Invisible and control characters are printed as `\uXXXX` escapes. In a table with an
 * Options column, a row shows what it adds to `{ hiddenChars: 'strict', confusionModel:
 * 'alphabet' }`; "instead:" marks a row that runs with other options.
 * After `--write`, run prettier on the file (it aligns the tables).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SECTIONS, extras, fill, optionText, show, table } from './doc-examples-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lib = await import(pathToFileURL(join(root, 'dist', 'index.js')).href);

const writeAt = process.argv.indexOf('--write');
if (writeAt > 0) {
  const file = process.argv[writeAt + 1];
  writeFileSync(file, fill(readFileSync(file, 'utf8'), lib.analyze, file));
  process.exit(0);
}

const only = process.argv[2];
for (const section of SECTIONS) {
  if (only && !section.id.startsWith(only)) continue;
  const note = section.options ? `: ${optionText(section.options)}` : '';
  console.log(`\n<!-- ${section.id}${note} -->\n\n${table(section, lib.analyze)}`);
}

if (!only || 'extras'.startsWith(only)) {
  console.log('\n<!-- extras -->\n');
  for (const [label, value] of extras(lib)) console.log(`${label}: ${show(JSON.stringify(value))}`);
}
