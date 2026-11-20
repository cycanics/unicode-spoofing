import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  // Declarations are bundled by tsup via the JS-based typescript@6 compiler
  // (the native typescript@7 has no Compiler API yet).
  dts: true,
  clean: true,
  sourcemap: true,
  // No source text ships: maps point at positions only (no sourcesContent), and the bundles
  // drop comments (whitespace minification; identifiers and syntax stay as written).
  esbuildOptions(options) {
    options.sourcesContent = false;
    options.minifyWhitespace = true;
    options.legalComments = 'none';
  },
  target: 'node20',
});
