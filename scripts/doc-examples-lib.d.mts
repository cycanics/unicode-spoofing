/** Types of `doc-examples-lib.mjs`, for `test/readme.test.ts`. */
export interface ExampleSection {
  id: string;
  options?: object;
  marks?: boolean;
  rule?: boolean;
  fullOptions?: boolean;
  cases: readonly (string | readonly [string, object])[];
}
type Analyze = (text: string, options?: never, callbacks?: never) => unknown;
export const SECTIONS: readonly ExampleSection[];
export function show(text: string): string;
export function code(text: string): string;
export function optionText(options: object): string;
export function table(section: ExampleSection, analyze: Analyze): string;
export function fill(text: string, analyze: Analyze, name?: string): string;
export function blockIds(text: string): string[];
export function extras(library: object): [label: string, value: unknown][];
