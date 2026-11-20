/**
 * The examples of README.md, docs/guide.md and docs/confusion-model.md as data, and the
 * functions that run them: shared by `scripts/doc-examples.mjs` (which writes the tables into
 * the documents) and `test/readme.test.ts` (which fails when a document and the library differ).
 * Nothing here imports the library: the caller passes `analyze` and the other exports in.
 */

/** Code point ranges printed as escapes: controls, format and other invisible characters. */
const INVISIBLE = [
  [0x00, 0x08],
  [0x0b, 0x1f],
  [0x7f, 0x9f],
  [0xad, 0xad],
  [0x34f, 0x34f],
  [0x61c, 0x61c],
  [0x180e, 0x180e],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x206f],
  [0x2800, 0x2800],
  [0x3164, 0x3164],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
  [0xe0000, 0xe0fff],
];
export const show = (s) =>
  [...s]
    .map((c) => {
      const n = c.codePointAt(0);
      if (c === '\n') return '\\n';
      if (c === '\t') return '\\t';
      if (!INVISIBLE.some(([from, to]) => n >= from && n <= to)) return c;
      const hex = n.toString(16).toUpperCase();
      return n > 0xffff ? `\\u{${hex}}` : `\\u${hex.padStart(4, '0')}`;
    })
    .join('');
export const code = (s) => {
  const t = show(s).replace(/\|/g, '\\|');
  return t.includes('`') ? `\`\` ${t} \`\`` : `\`${t}\``;
};

/** ASCII written as invisible tag characters (U+E0000 + code). */
const tag = (s) => [...s].map((c) => String.fromCodePoint(0xe0000 + c.codePointAt(0))).join('');

const STRICT = { hiddenChars: 'strict' };
const ALPHABET = { confusionModel: 'alphabet' };
const FULL = { hiddenChars: 'strict', confusionModel: 'alphabet' };
const TERMINAL = { ...FULL, hiddenCharRules: { terminal: {} } };
/** docs/confusion-model.md §4.3: whole-script words. */
const WHOLE = [
  'НОТ dog',
  'НОТ deal today',
  'Мы были в НОТ',
  'I bought сор today',
  'раураӏ',
  'go to аррӏе.com',
  'Зайди на раураӏ сегодня',
  'раураІ',
  'paypaI',
  'Το iPhone είναι ακριβό',
];
/** docs/confusion-model.md §4.8. */
const REF_WORDS = [
  'НОТ dog',
  'НОТ deal today',
  'This is НОТ news',
  'Мы были в НОТ',
  'НОТ',
  'cоса',
  'TЕХ',
  'Αрр',
  'HОT',
  'НOТ',
  'CОК',
  'COК',
  'drink cоса now',
  'open the Αрр',
  'Bank ассоunt verification',
  'Wе landed at Orly.',
  'аррӏе.com',
  'ΑΡΡLE',
  'раураl',
  'pay with раураl today',
  'иser',
  'кey',
  'my кey here',
  'тap',
  'тail',
  'admiп',
  'вank',
  'тime',
  'quіск',
  'Пpивеt',
  'paᏏy',
  'ьank',
  'ъеst',
  'Пpивет',
  'Москвa',
  'paypaІ',
  'шaг',
  'pаypal’ѕ',
  'Kαλημέρα',
  'ᴀᴅᴍɪɴ',
  'ɡoogle',
  'pɑypal',
  "İstanbul'da ışık",
  'þorn',
  "GitHub'а",
  'iPhone’ов',
  "форк на GіtHub'а",
  'I bought сок today',
  'I bought сор today',
  'the рос here',
  'it is сухо here',
  'eat уха soup',
  'an оса flew',
  'add сахар now',
  'раураӏ',
  'Зайди на раураӏ сегодня',
  'раураІ',
  'paypaI',
  'gmaiI',
  'Ьр',
  'маӏа',
  'Коммерсантъ',
  'Το iPhone είναι ακριβό',
  'g00gle',
  'app1e',
  'НОВ0СТИ',
  'СОСА-СОЛА',
  'СОСА-COLA',
  'χbox',
  'ҳbox',
  'Ҳbox',
  'paχos',
  'ŋame',
  'ɳo',
  'ηame',
  'ҳа',
];
const rules = (r) => ({ ...FULL, hiddenCharRules: r });
const languages = (...targetLanguages) => ({ ...FULL, targetLanguages });

/**
 * A section: `options` for every case, cases as a string or `[text, options]`
 * (the case's own options, shown in the table), `marks` to list the report callback's marks.
 */
export const SECTIONS = [
  {
    id: 'readme-quick-start',
    options: languages('English'),
    marks: true,
    cases: ['Verify your pаypаl acc\u200Bount at gооgle.com'],
  },
  {
    id: 'readme-modes',
    fullOptions: true,
    cases: [
      ['Пpивет, fr\u200Bee НОТ dog', {}],
      ['Пpивет, fr\u200Bee НОТ dog', ALPHABET],
      ['Пpивет, fr\u200Bee НОТ dog', STRICT],
      ['Пpивет, fr\u200Bee НОТ dog', FULL],
      ['p&#1072;ypal 1920x1080 co\u00ADop', {}],
      ['p&#1072;ypal 1920x1080 co\u00ADop', ALPHABET],
      ['p&#1072;ypal 1920x1080 co\u00ADop', STRICT],
      ['p&#1072;ypal 1920x1080 co\u00ADop', FULL],
    ],
  },
  {
    id: 'readme-signals',
    options: FULL,
    cases: [
      'НОТ dog',
      'pаypal',
      'iPhone用',
      'Smith는',
      'Facebookом',
      'ЮKassa',
      'Please read the ВООК друг',
      'fr\u200Bee',
      'Z\u0338\u0322\u032C\u0308a\u031B\u0320\u034Elgo',
      'a\u0001b',
      'Jos\uFFFD',
    ],
  },
  {
    id: 'readme-signals-other',
    fullOptions: true,
    cases: [
      ['busіnеss', {}],
      ['buy аррӏе now', { ...FULL, wholeScriptFold: 'off' }],
    ],
  },
  {
    // Examples the README gives in its prose and option tables (not rendered as a table).
    id: 'readme-inline',
    cases: [
      ['Пpивет', FULL],
      ['pаypal', FULL],
      ['НОТ dog', FULL],
      ['Мы были в НОТ', FULL],
      ['НОТ', FULL],
      ['сор', FULL],
      ['p&#1072;ypal', FULL],
      ['AT&amp;T', FULL],
      ['pⓐypal', STRICT],
      ['Applе', FULL],
      ['Applе', { ...FULL, hostileInput: true }],
      ['Windowsах', { ...FULL, affixSeparator: '-' }],
      ['Р-aypal', { ...FULL, oneLetterDashAffix: ['Russian'] }],
    ],
  },
  {
    id: 'hidden-strict',
    options: FULL,
    marks: true,
    cases: [
      'fr\u200Bee money',
      'pay\u200Dpal',
      'Get f\u200B\u200Bree',
      'a\u2060b',
      'co\u00ADoperate',
      '\uFEFFHello',
      'a \u200B b',
      'Auf\u200Clage',
      'ภาษา\u200Bไทย',
      'می\u200Cخواهم کتاب',
      'Ship it 👨\u200D👩\u200D👧 ℹ\uFE0F',
      '辻\uFE00さん',
      'A\uFE01\uFE02B',
      `Looks helpful!${tag('hi')}`,
      '🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F} flag',
      'buy v\u3164i\u3164agra',
      'x\u2062y',
      'a\u0001b',
      'line1\u000Bline2\u000Cline3',
      'Hi Jos�� Luis',
    ],
  },
  {
    id: 'hidden-marks',
    options: FULL,
    marks: true,
    cases: ['Z̸̢̬̈a̛̠͎lg̕o̶ spam', `ok ส${'้'.repeat(6)}`, 'tiếng Việt'],
  },
  {
    id: 'hidden-rules',
    marks: true,
    cases: [
      ['pay\u00ADpal', FULL],
      ['pay\u00ADpal', rules({ softHyphen: 'remove-counted' })],
      ['pay\u00ADpal', rules({ softHyphen: 'keep' })],
      ['fr\u200Bee \u202Eabc', rules({ zeroWidthInWord: 'report', bidiOverrides: 'report' })],
      ['a \u200B b', rules({ seamSpaces: false })],
    ],
  },
  {
    id: 'hidden-lenient',
    options: {},
    marks: true,
    cases: [
      'fr\u200Bee money',
      'co\u00ADoperate',
      'Auf\u200Clage',
      'a \u200B b',
      'ภาษา\u200Bไทย',
      'buy v\u3164i\u3164agra',
      `Looks helpful!${tag('hi')}`,
      'line1\u000Bline2',
      'ok \u001B[8msecret\u001B[0m done',
      'a\u001B]0;title\u0007b',
    ],
  },
  {
    id: 'terminal',
    marks: true,
    cases: [
      ['ok \u001B[31mred\u001B[0m done', FULL],
      ['ok \u001B[31mred\u001B[0m done', TERMINAL],
      ['ok \u001B[8msecret\u001B[0m done', FULL],
      ['x\u001B[30;40mhidden\u001B[0my', FULL],
      ['a\u001B]0;title\u0007b', FULL],
      ['abc\u001B[2Kdef', FULL],
      ['pass\b\b\b\bword', FULL],
      ['pass\b\b\b\bword', TERMINAL],
      ['norml\bal', TERMINAL],
      ['abc\b\b\b\b\b\bx', TERMINAL],
      ['safe\rrm -rf ~', FULL],
      ['safe\rrm -rf ~', rules({ terminal: { bareCR: 'newline' } })],
      ['line\r\nnext', FULL],
    ],
  },
  {
    id: 'bidi',
    marks: true,
    cases: [
      ['invoice\u202Egnp.exe', FULL],
      ['invoice\u202Egnp.exe', rules({ bidiOverrides: 'remove-with-content' })],
      ['Open \u202Egnp.exe\u202C now', rules({ bidiOverrides: 'remove-with-content' })],
      ['if (level != "user\u202E \u2066// admin check\u2069 \u2066") {', FULL],
      ['abc\u200Edef', FULL],
      ['שלום\u200F עולם', FULL],
      ['hello\u200F world\nשלום\u200F עולם', FULL],
      ['abc \u2067שלום\u2069', FULL],
      ['\u202Eשלום עולם\u202C', rules({ bidiOverrides: 'remove-with-content' })],
      ['טל \u202D+972-50-1234567\u202C', rules({ bidiOverrides: 'remove-with-content' })],
    ],
  },
  {
    id: 'rtl-awareness',
    cases: [
      ['שלום iPhoneахא', FULL],
      ['שלום iPhoneахא', { ...FULL, rtlAwareness: false }],
    ],
  },
  {
    id: 'html',
    marks: true,
    cases: [
      ['p&#1072;ypal now', FULL],
      ['p&#x430;ypal now', FULL],
      ['p&#1072ypal now', FULL],
      ['fr&ZeroWidthSpace;ee', FULL],
      ['abc&#8203;def', FULL],
      ['C&#1087;росите', FULL],
      ['Hello&lt;сор&gt;world', FULL],
      ['AT&amp;T caf&eacute;', FULL],
      ['x &copy text', FULL],
      ['x &copy text', { ...FULL, htmlNamedReferences: 'strict' }],
      ['see &section=1 and &copyright', FULL],
      ['a&#0;b', FULL],
      ['p&#1072;ypal now', STRICT],
    ],
  },
  {
    id: 'mojibake',
    marks: true,
    cases: [
      ['I donâ€™t know', FULL],
      ['maÃ®tre', FULL],
      ['Ð¿Ñ€Ð¸Ð²ÐµÑ‚ мир', FULL],
      ['I donвЂ™t know', FULL],
      ['ВІРЅ', FULL],
      ['I donâ€™t know', {}],
    ],
  },
  {
    id: 'lookalikes-words',
    options: FULL,
    cases: [
      'Login at pаypal.com',
      'gооgle.com',
      'Bank aссount verification',
      'Cпросите у него',
      'ВOДКА',
      'Kαλημέρα',
      'Привiт світ',
      'замóк',
      'ᎪᏢᏢꓡꓰ',
      'pꓮypal',
      'paypaו',
      'ſecure',
      'þing',
    ],
  },
  {
    id: 'lookalikes-context',
    options: FULL,
    cases: [
      'НОТ dog',
      'Мы были в НОТ',
      'НОТ',
      'the сор was here',
      'сор',
      'buy аррӏе now',
      'Hello world and friends.\nНОТ',
      'Hello world and friends.\n\nНОТ',
      'Please read the ВООК now',
      'Please read the ВООК друг',
    ],
  },
  {
    id: 'lookalikes-request',
    cases: [
      ['pay with раураl today', FULL],
      ['pay with раураl today', languages('English')],
      ['pay with раураl today', languages('Russian')],
      ['ϲ', FULL],
      ['ϲ', languages('Russian', 'English')],
      ['ϲ', languages('Greek')],
      ['Привет мiр', FULL],
      ['Привет мiр', languages('Russian', 'English')],
      ['НОТ dog', languages('Russian')],
      ['Привіт', languages('English', 'Russian')],
      ['þing', languages('Russian')],
    ],
  },
  {
    id: 'lookalikes-whole',
    cases: [
      ['НОТ dog', { ...FULL, wholeScriptFold: 'all' }],
      ['НОТ dog', { ...FULL, wholeScriptFold: 'foreign-letters' }],
      ['buy аррӏе now', { ...FULL, wholeScriptFold: 'foreign-letters' }],
      ['buy аррӏе now', { ...FULL, wholeScriptFold: 'off' }],
      ['НОТ dog', { ...FULL, expectedScripts: ['Cyrillic'] }],
    ],
  },
  {
    id: 'mixed',
    cases: [
      ['pаypal', FULL],
      ['pаypalя', FULL],
      ['Bank ассоunt verification', FULL],
      ['Applе', FULL],
      ['Applе', { ...FULL, hostileInput: true }],
      ['timея', FULL],
      ['ЮKassa', FULL],
      ['Facebookом', FULL],
      ['paypaוש', FULL],
      ['iPhone用', FULL],
      ['pa株ypal', FULL],
      ['Smith는', FULL],
      ['pаypal用', FULL],
      ['Please read the ВООК друг', FULL],
      ['НОТ busіnеss', {}],
    ],
  },
  {
    id: 'affixes',
    cases: [
      ["iPhone'ах", FULL],
      ['SMS-ах', FULL],
      ["форк на GitHub'а", FULL],
      ['NTLM-хеш', FULL],
      ['Wi-Fi', FULL],
      ['the реалити-шоу is on', FULL],
      ['the хе-хе', FULL],
      ['buy apple-рау now', FULL],
      ['plan-В', FULL],
      ['Р-aypal', FULL],
      ['Р-aypal', { ...FULL, oneLetterDashAffix: ['Russian'] }],
      ['Windowsах', FULL],
      ['Windowsах', { ...FULL, affixSeparator: '-' }],
      ['Windowsах', { ...FULL, affixSeparator: '' }],
      ['pаypalя', { ...FULL, affixSeparator: '-' }],
    ],
  },
  {
    id: 'digits',
    cases: [
      ['error Ꮞ04', FULL],
      ['error ৪০৪', FULL],
      ['g০০gle', FULL],
      ['g൦൦gle', FULL],
      ['۱۵', FULL],
      ['l0gin', FULL],
      ['1920x1080', FULL],
      ['300х300пкс', FULL],
      ['4х4', FULL],
      ['0x1F', FULL],
      ['x86 2x', FULL],
      ['Win11Рго', FULL],
      ['B2В', FULL],
      ['1920x1080', STRICT],
    ],
  },
  {
    id: 'neutral',
    options: FULL,
    cases: [
      'pⓐypal',
      'see ⓐ here',
      'Ｇｅｔ ｆｒｅｅ',
      'ﬁnance',
      'пⓐпа',
      'приⓖет',
      '𝐩𝐚𝐲𝐩𝐚𝐥',
      '𝐈 ℝ',
      'cosϕ',
      'chapter Ⅳ',
      '第Ⅲ章',
      'ⅽlick',
      'Ⅹорошо',
      'Brand® now',
      '©lick',
      '№5',
      '5ℓ 10㎏',
      'paypaℓ',
      '℡ 555',
      '5µm',
      'µsername',
      'xᵢ 1º 10ⁿ',
      'ꓲ',
      'aꓲl',
      '作れたｗ',
    ],
  },
  {
    id: 'neutral-switch',
    cases: [
      ['pⓐypal', ALPHABET],
      ['pⓐypal', { ...ALPHABET, neutralAlphabet: true }],
      ['pⓐypal', { ...FULL, neutralAlphabet: false }],
    ],
  },
  {
    id: 'math',
    cases: [
      ['ℎν', FULL],
      ['ℎν', { ...FULL, keepMathLetters: true }],
      ['𝑘𝑇𝜈', FULL],
      ['𝑘𝑇𝜈', { ...FULL, keepMathLetters: true }],
      ['𝐈 ℝ', { ...FULL, keepMathLetters: true }],
      ['cosβcosα', FULL],
      ['cosβcosα', { ...FULL, mathTarget: true }],
      ['αFβγ', { ...FULL, mathTarget: true }],
      ['f\u2061(x)', FULL],
      ['f\u2061(x)', rules({ invisibleMathOperators: 'keep' })],
    ],
  },
  {
    id: 'turkish',
    options: FULL,
    cases: [
      'click the lınk now',
      'Işık ılık ısıtır',
      'Osmanlı İmparatorluğu yıl',
      "İstanbul'da ışık",
      'the yıl was long',
    ],
  },
  {
    id: 'not-json',
    options: FULL,
    cases: ['{"name":"p\\u0430ypal"}', '{"name":"pаypal"}'],
  },
  // docs/confusion-model.md (ids `ref-<section>`).
  {
    id: 'ref-2.1',
    options: {},
    cases: [
      'Пpивет мир',
      'Мы пишем Пpивет всем друзьям',
      'ВOДКА',
      'Kαλημέρα',
      "GitHub'а",
      'GitHub’а',
    ],
  },
  {
    id: 'ref-2.1-alphabet',
    options: ALPHABET,
    cases: [
      'Пpивет мир',
      'Мы пишем Пpивет всем друзьям',
      'ВOДКА',
      'Kαλημέρα',
      "GitHub'а",
      'GitHub’а',
    ],
  },
  { id: 'ref-2.2', options: {}, cases: ['НОТ deal today', 'НОТ dog', 'НОТ', 'СОК', 'ВОДКА СОК'] },
  {
    id: 'ref-2.3',
    fullOptions: true,
    marks: true,
    cases: [
      ['a \u200B b', {}],
      ['a \u200B b', STRICT],
      ['a \u200B\u200B\u200B\u200B b', {}],
      ['a \u200B\u200B\u200B\u200B\u200B b', {}],
      ['a \u200B\u200B b', STRICT],
      ['co\u00ADoperate', {}],
      ['co\u00ADoperate', STRICT],
      ['\uFEFFHello', {}],
      ['\uFEFFHello', STRICT],
    ],
  },
  { id: 'ref-4.3-latin', options: {}, cases: WHOLE },
  { id: 'ref-4.3-all', options: { ...ALPHABET, wholeScriptFold: 'all' }, rule: true, cases: WHOLE },
  {
    id: 'ref-4.3-foreign-letters',
    options: { ...ALPHABET, wholeScriptFold: 'foreign-letters' },
    rule: true,
    cases: WHOLE,
  },
  { id: 'ref-4.3-off', options: { ...ALPHABET, wholeScriptFold: 'off' }, rule: true, cases: WHOLE },
  {
    id: 'ref-4.5',
    fullOptions: true,
    rule: true,
    cases: [
      'раураl',
      'иser',
      'кey',
      'my кey here',
      'тap',
      'ΑΡΡLE',
      'cоса',
      'Kαλημέρα',
      'сiла',
      'мiр',
    ].flatMap((t) => [
      [t, ALPHABET],
      [t, { ...ALPHABET, targetLanguages: ['English'] }],
      [t, { ...ALPHABET, targetLanguages: ['English', 'Russian'] }],
    ]),
  },
  { id: 'ref-4.8', options: ALPHABET, rule: true, cases: REF_WORDS },
];

function runCase(analyze, text, options, section) {
  const withMarks = section.marks;
  const marks = [];
  const result = analyze(text, options, { onReport: (m) => void marks.push(m) });
  const signals = Object.entries(result.signals)
    .filter(([, on]) => on)
    .map(([name]) => `\`${name}\``);
  const cells = [
    code(text),
    code(result.normalized),
    result.spoofed ? 'yes' : 'no',
    signals.join(', ') || '—',
  ];
  if (withMarks)
    cells.push(
      marks.map((m) => `\`${m.kind}\`${m.extracted ? ` ${code(m.extracted)}` : ''}`).join(', ') ||
        '—',
    );
  if (section.rule) {
    const rules = result.words.map((w) => w.resolution?.rule).filter(Boolean);
    cells.push(rules.map((r) => `\`${r}\``).join(', ') || '—');
  }
  return cells;
}

export const optionText = (o) =>
  JSON.stringify(o)
    .replace(/"([A-Za-z]+)":/g, '$1: ')
    .replace(/"/g, "'")
    .replace(/,/g, ', ');

/** What a case's options add to the strict + alphabet pair, or the options that replace it. */
function optionCell(o) {
  const { hiddenChars, confusionModel, ...extra } = o;
  if (hiddenChars !== 'strict' || confusionModel !== 'alphabet')
    return Object.keys(o).length ? `instead: \`${optionText(o)}\`` : 'instead: no options';
  return Object.keys(extra).length ? `\`${optionText(extra).slice(1, -1)}\`` : '—';
}

/** The Markdown table of a section, computed with the given `analyze`. */
export function table(section, analyze) {
  const perCase = !section.options;
  const head = [
    'Input',
    ...(perCase ? ['Options'] : []),
    'Output',
    'Spoofed',
    'Signals',
    ...(section.marks ? ['Reports'] : []),
    ...(section.rule ? ['Rule'] : []),
  ];
  const lines = [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`];
  for (const c of section.cases) {
    const [text, own] = Array.isArray(c) ? c : [c, section.options];
    const cells = runCase(analyze, text, own, section);
    if (perCase)
      cells.splice(1, 0, section.fullOptions ? `\`${optionText(own)}\`` : optionCell(own));
    lines.push(`| ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
}

const BLOCK = /(<!-- examples: ([\w.-]+) -->\n)[\s\S]*?(<!-- \/examples -->)/g;

/** `text` with every `<!-- examples: ID -->` block filled with its section's table. */
export function fill(text, analyze, name = 'text') {
  const byId = new Map(SECTIONS.map((x) => [x.id, x]));
  return text.replace(BLOCK, (all, open, id, close) => {
    if (!byId.has(id)) throw new Error(`${name}: no example section "${id}"`);
    return `${open}\n${table(byId.get(id), analyze)}\n\n${close}`;
  });
}

/** The ids of the example blocks in `text`. */
export const blockIds = (text) => [...text.matchAll(BLOCK)].map((m) => m[2]);

/**
 * The examples of the README and the guide that are not table rows: `[label, value]` pairs,
 * computed with the given library exports.
 */
export function extras({
  analyze,
  buildLookalikes,
  cleanHidden,
  cleanTerminal,
  STRICT_HIDDEN_RULES,
}) {
  const out = [];
  const print = (label, value) => void out.push([label, value]);

  // README: the result object.
  const result = analyze('Login at pаypal.com, fr\u200Bee НОТ dog', FULL);
  print('result', result);

  // Callbacks of cleanHidden.
  const marks = [];
  const records = [];
  const cleaned = cleanHidden('fr\u200Bee co\u00ADop', STRICT_HIDDEN_RULES, {
    onReport: (m) => void marks.push(m),
    onCleanup: (region) => `[${region.original.length} hidden]`,
    onRecord: (r) => void records.push(r),
  });
  print('cleanHidden', { cleaned, marks, records });
  print('cleanHidden default rules', cleanHidden('fr\u200Bee Pаypal'));

  // The word callback.
  const words = [];
  const r2 = analyze('please pay Pаypаl now, ｆｒｅｅ', FULL, {
    onWord: (start, end, cleaned, replacement, reason) =>
      void words.push({ start, end, cleaned, replacement, reason }),
  });
  print('onWord', { normalized: r2.normalized, words, listed: r2.words.map((w) => w.word) });

  // Early stop.
  const controller = new AbortController();
  let calls = 0;
  const r3 = analyze('pаypal one pаypal two pаypal three', FULL, {
    onWord: () => void (++calls === 2 && controller.abort()),
    signal: controller.signal,
  });
  print('abort', { normalized: r3.normalized, calls });

  // Terminal controls alone.
  print('cleanTerminal', cleanTerminal('ok \u001B[8msecret\u001B[0m done norml\bal'));

  // Limits.
  const long = 'pаypal'.repeat(50);
  const big = [];
  const r4 = analyze(long, FULL, { onWord: (s, e, c, r, reason) => void big.push([s, e, reason]) });
  print('word cap', { unchanged: r4.normalized === long, spoofed: r4.spoofed, calls: big });
  for (const [name, o] of [
    ['default', {}],
    ['alphabet', ALPHABET],
    ['strict', STRICT],
  ])
    print(`word cap, ${name}`, { unchanged: analyze(long, o).normalized === long });
  const lost = [];
  const r5 = analyze('a\u001B]0;never closed\nnext line', FULL, {
    onLostBound: (b) => void lost.push(b),
  });
  print('lost escape string', { normalized: r5.normalized, lost });
  const lost2 = [];
  const out2 = cleanHidden(
    'a\u202Eb c d e f g h',
    { ...STRICT_HIDDEN_RULES, constructLimit: 5 },
    { onLostBound: (b) => void lost2.push(b) },
  );
  print('lost bidi frame', { out: out2, lost: lost2 });
  const chunks = [];
  cleanHidden(`hi${tag('x'.repeat(5000))}`, STRICT_HIDDEN_RULES, {
    onReport: (m) => void chunks.push([m.kind, m.count]),
  });
  print('long tag run', chunks);

  // Custom packs.
  const lookalikes = buildLookalikes({ add: { English: [['ƨ', 's']] } });
  print('custom pack', {
    with: analyze('paƨƨword', { ...FULL, lookalikes }).normalized,
    without: analyze('paƨƨword', FULL).normalized,
  });
  print('pair removed', {
    out: analyze('click the lınk now', {
      ...FULL,
      lookalikes: buildLookalikes({ remove: { English: [['ı', 'i']] } }),
    }).normalized,
  });
  print('conditional twin', {
    off: analyze('иser', FULL).normalized,
    on: analyze('иser', { ...FULL, conditionalTwins: ['и~u'] }).normalized,
    withLookalikes: analyze('иser', { ...FULL, lookalikes, conditionalTwins: ['и~u'] }).normalized,
  });

  // Errors.
  for (const [name, f] of [
    ['contextBuffer', () => analyze('x', { ...FULL, contextBuffer: 5 })],
    ['rule value', () => analyze('x', rules({ softHyphen: 'nope' }))],
    ['language', () => analyze('x', languages('Cyrillic'))],
    ['not a string', () => analyze(5)],
  ]) {
    try {
      f();
    } catch (e) {
      print(`error, ${name}`, `${e.name}: ${e.message}`);
    }
  }

  print('optional pack', {
    off: analyze('the 𐔓ame here', FULL).normalized,
    on: analyze('the 𐔓ame here', {
      ...FULL,
      lookalikes: buildLookalikes({ additional: ['χ~x', 'χ~х', 'ҳ~x', 'ҳ~χ', 'optional'] }),
    }).normalized,
  });

  // Recipes of the guide.
  const recipe = (label, input, options, callbacks) => {
    const marks = [];
    const r = analyze(input, options, { onReport: (m) => void marks.push(m.kind), ...callbacks });
    print(label, { input, normalized: r.normalized, spoofed: r.spoofed, marks });
  };
  recipe('recipe, model', 'Summarise: the сlient paid 300х200 via Pаypal. Привет!', {
    ...FULL,
    targetLanguages: ['English'],
    hiddenCharRules: { terminal: {} },
  });
  recipe('recipe, scan', 'Applе pay\u00ADpal invoice\u202Egnp.exe', {
    ...FULL,
    hostileInput: true,
    hiddenCharRules: {
      terminal: {},
      bidiOverrides: 'remove-with-content',
      softHyphen: 'remove-counted',
    },
  });
  recipe('recipe, languages', 'Здравей, cвят', {
    ...FULL,
    targetLanguages: ['English', 'Bulgarian'],
  });
  return out;
}
