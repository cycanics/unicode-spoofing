/**
 * Decisions 36e (detection, correction, reporting of mixed words; ordering B),
 * 36f (Latin stressed vowels in Russian words) and 40g (`п` ↔ `n` ordinary
 * twins), and the word display order they read (UAX #9).
 */
import { describe, expect, it } from 'vitest';
import { analyze, type AnalyzeOptions } from '../src';
import { displayOrder } from '../src/bidi';
import { createConfusionModel } from '../src/confusion';

const A: AnalyzeOptions = { hiddenChars: 'strict', confusionModel: 'alphabet' };
const ENRU: AnalyzeOptions = { ...A, targetLanguages: ['English', 'Russian'] };
const R = (t: string, o: AnalyzeOptions = A) => {
  const r = analyze(t, o);
  return [r.normalized, r.spoofed, r.words.map((w) => w.signals[0])];
};
// Hebrew vav and shin, written as escapes (stored order).
const VAV = 'ו';
const SHIN = 'ש';

describe('display order of a word (UAX #9)', () => {
  it('a Hebrew run displays reversed; its place depends on the paragraph direction', () => {
    const w = [...`paypa${VAV}${SHIN}`];
    // Left-to-right paragraph: `paypa`, then shin, then vav (shin touches `a`).
    expect(displayOrder(w, false)).toEqual([0, 1, 2, 3, 4, 6, 5]);
    // Right-to-left paragraph: shin, vav, then `paypa` (vav touches `p`).
    expect(displayOrder(w, true)).toEqual([6, 5, 0, 1, 2, 3, 4]);
  });
  it('a word with no right-to-left character keeps its stored order', () => {
    expect(displayOrder([...'pаypal'], true)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('decision 36e: detection, correction, reporting', () => {
  it('a one-letter twin piece that is not the last converts toward the larger alphabet', () => {
    expect(R('Cпросите меня')).toEqual(['Спросите меня', true, ['mixed_spoof']]);
    expect(R('pаypalя')).toEqual(['paypalя', true, ['mixed_spoof']]);
    expect(R('aпd')).toEqual(['and', true, ['mixed_spoof']]);
  });
  it('everything else detected is reported, not converted', () => {
    for (const t of ['timея', 'ЮKassa', 'Пersona', 'importancем', 'раураl', 'admiп'])
      expect(R(t), t).toEqual([t, false, ['mixed_non_legitimate']]);
  });
  it('the hostile-input setting converts a last one-letter twin piece too', () => {
    expect(R('Applе')).toEqual(['Applе', false, ['mixed_non_legitimate']]);
    expect(R('Applе', { ...A, hostileInput: true })).toEqual(['Apple', true, ['mixed_spoof']]);
  });
  it('stored order is not screen order: Hebrew glue in either paragraph direction is no spoof', () => {
    // Left-to-right line: shin (no twin) touches `a`; right-to-left line: the two-letter Hebrew
    // piece touches `p`. Neither has a one-letter piece to correct.
    expect(R(`see paypa${VAV}${SHIN} now`)).toEqual([
      `see paypa${VAV}${SHIN} now`,
      false,
      ['mixed_non_legitimate'],
    ]);
    const he = `שלום paypa${VAV}${SHIN} עכשיו`;
    expect(R(he)).toEqual([he, false, ['mixed_non_legitimate']]);
  });
  it('ordering B applies per dash part', () => {
    expect(R('pаypal-кошелёк')).toEqual(['paypal-кошелёк', true, ['mixed_spoof']]);
    expect(R('Wi-Fi-роутер')).toEqual(['Wi-Fi-роутер', false, []]);
  });
  it('a word of one requested alphabet and donors keeps whole-word mapping', () => {
    expect(R('the ᴀccount is')).toEqual(['the account is', true, ['confusable_word']]);
  });
  it('41i is gone: Greek donors in an English word with Greek unrequested are reported', () => {
    expect(R('σiλ', ENRU)).toEqual(['σiλ', false, ['mixed_non_legitimate']]);
  });
});

describe('decision 36f: a Latin stressed vowel inside a Russian word', () => {
  it('becomes the Russian vowel with the combining acute (one Russian run)', () => {
    expect(R('замóк')).toEqual(['замо́к', true, ['mixed_spoof']]);
    expect(R('ударéние слова')).toEqual(['ударе́ние слова', true, ['mixed_spoof']]);
  });
});

describe('decision 40g: п and n are ordinary twins both ways', () => {
  it('in the default packs', () => {
    const m = createConfusionModel();
    expect(m.twinIn('п', 'Latin')).toBe('n');
    expect(m.twinIn('n', 'Cyrillic')).toBe('п');
  });
  it('a whole Russian word of look-alikes folds by its context', () => {
    expect(R('I like опера')).toEqual(['I like onepa', true, ['confusable_word']]);
  });
});

describe('decision 36e: a twin piece of any length between two pieces (owner, 2026-11-18)', () => {
  it('converts toward the side holding more of the word letters', () => {
    expect(R('gооgle.com')).toEqual(['google.com', true, ['mixed_spoof']]);
    expect(R('pауpal')).toEqual(['paypal', true, ['mixed_spoof']]);
    expect(R('Gοοgle')).toEqual(['Google', true, ['mixed_spoof']]);
  });
  it('first and last multi-letter pieces stay report-only, hostile input included', () => {
    for (const o of [A, { ...A, hostileInput: true }]) {
      expect(R('Bank ассоunt verification', o)).toEqual([
        'Bank ассоunt verification',
        false,
        ['mixed_non_legitimate'],
      ]);
      expect(R('раураl', o)).toEqual(['раураl', false, ['mixed_non_legitimate']]);
    }
  });
});

describe('decision 36e: owner rules of 2026-11-18 (pieces, digits, apostrophes)', () => {
  const HEB = 'שלום';
  it('digits are ignored at a border: letters on both sides of them touch', () => {
    expect(R('а1admin')).toEqual(['a1admin', true, ['mixed_spoof']]);
    for (const t of ['admin1а', 'Win11Рго', 'B2В', 'paypal2рау', 'STM32F103х', 'В4t'])
      expect(R(t), t).toEqual([t, false, ['mixed_non_legitimate']]);
  });
  it('apostrophe parts are separate words, like dash parts', () => {
    expect(R("Use рау'pal now")).toEqual(["Use pay'pal now", true, ['mixed_spoof']]);
    expect(R("buy iPhone'ах now")).toEqual(["buy iPhone'ах now", false, []]);
    expect(R("форк на GitHub'а")).toEqual(["форк на GitHub'а", false, []]);
  });
  it('the last piece is the last in the word’s own reading order', () => {
    expect(R('Cпросите')).toEqual(['Спросите', true, ['mixed_spoof']]);
    // A word with no right-to-left letter reads left to right in Hebrew text too.
    expect(R(`${HEB} Cпросите`)).toEqual([`${HEB} Спросите`, true, ['mixed_spoof']]);
    expect(R(`${HEB} Москвa \u05e2\u05db\u05e9\u05d9\u05d5`)).toEqual([
      `${HEB} Москвa \u05e2\u05db\u05e9\u05d9\u05d5`,
      false,
      ['mixed_non_legitimate'],
    ]);
  });
  it('a styled or math letter is no letter of a requested alphabet (ordering B)', () => {
    expect(R('Σ𝐁')).toEqual(['ΣΒ', true, ['mixed_spoof']]);
    expect(R('хоⓡоⓢо')).toEqual(['xoroso', true, ['mixed_spoof']]);
    expect(R('ΔΩKβ')).toEqual(['ΔΩΚβ', true, ['mixed_spoof']]);
  });
  it('a singleton canonical decomposition is the letter itself', () => {
    expect(R('admιn')).toEqual(['admin', true, ['mixed_spoof']]);
  });
  it('affixSeparator never splits a word 36e corrects into one alphabet', () => {
    expect(R('ударéние', { ...A, affixSeparator: '-' })).toEqual([
      'ударе́ние',
      true,
      ['mixed_spoof'],
    ]);
  });
});

describe('UAX #9 details', () => {
  it('a paragraph ends at CR, LF, U+2029, NEL and FS/GS/RS; isolates are skipped; marks are strong', async () => {
    const { firstStrongRtl, isParaSep } = await import('../src/bidi');
    for (const u of [0x0a, 0x0d, 0x1c, 0x1d, 0x1e, 0x85, 0x2029]) expect(isParaSep(u)).toBe(true);
    expect(firstStrongRtl('⁧abc⁩ ש', 0, 7)).toBe(true);
    expect(firstStrongRtl('‏ abc', 0, 5)).toBe(true);
    expect(firstStrongRtl('‎ ש', 0, 3)).toBe(false);
  });
  it('classes: ⁱ is a letter, math digits are European numbers, ½ is neutral', () => {
    // An RTL paragraph keeps `aⁱ` in stored order (both L); a math digit after a Hebrew letter
    // goes after it on screen at a higher level, `½` takes the paragraph direction.
    expect(displayOrder([...'aⁱ'], true)).toEqual([0, 1]);
    expect(displayOrder(['\u05d0', '\u{1d7ce}', '\u{1d7cf}'], false)).toEqual([1, 2, 0]);
    expect(displayOrder(['\u05d0', '½', '\u05d1'], false)).toEqual([2, 1, 0]);
  });
});

describe('decision 36e: an x between digits (owner, 2026-11-18)', () => {
  const calls = (t: string, o: AnalyzeOptions = A) => {
    const out: string[] = [];
    const r = analyze(t, o, {
      onWord: (_s, _e, c, rp, w) => void out.push(`${c}→${rp}[${(w.signals ?? []).join('+')}]`),
    });
    return [r.normalized, r.spoofed, out];
  };
  it('is a non-letter written as ×, not a spoof', () => {
    expect(calls('фото 300х\u200b300пкс')[0]).toBe('фото 300×300пкс');
    expect(calls('3ⅹ3 and 3ｘ3 and 3𝐱3')[0]).toBe('3×3 and 3×3 and 3×3');
    expect(calls('１x１ 𝟏x𝟐')[0]).toBe('１×１ 𝟏×𝟐');
    expect(calls('фото 300х300пкс')).toEqual([
      'фото 300×300пкс',
      false,
      ['300х300пкс→300×300пкс[]'],
    ]);
    // English `x`: normalisation only, no call; a donor (`х`, `χ`): a reported non-spoof conversion.
    expect(calls('screen 1920x1080 now')).toEqual(['screen 1920×1080 now', false, []]);
    expect(calls('size 2χ3')).toEqual(['size 2×3', false, ['2χ3→2×3[]']]);
  });
  it('HTML character references are read as the character they encode (41o, like 42)', () => {
    // Inside its token, judged as what it encodes; converted only where that character is.
    expect(R('pay p&#1072;ypal now')).toEqual(['pay paypal now', true, ['mixed_spoof']]);
    expect(R('the &#1089;&#1086;&#1088; here')).toEqual([
      'the cop here',
      true,
      ['confusable_word'],
    ]);
    // A reference to a hidden character: judged and removed like that character.
    expect(R('Cп&shy;росите')).toEqual(['Спросите', true, ['mixed_spoof']]);
    // A reference encoding a space separates words; output keeps references as written.
    expect(analyze('Мы&nbsp;Мп&nbsp;сок', A).counts.wordsTotal).toBe(3);
    expect(R('a&amp;b c')).toEqual(['a&amp;b c', false, []]);
    expect(R('plain &lt;b&gt; here')).toEqual(['plain &lt;b&gt; here', false, []]);
    // Letters a reference encodes cast no vote: `сор` keeps its context (no clean neighbour).
    expect(R('Мы &#1089;&#1086;&#1088; сок')).toEqual(['Мы &#1089;&#1086;&#1088; сок', false, []]);
  });
  it('only between two numbers: no hex prefix, no letter before the digits', () => {
    for (const t of ['0x1F', 'flags=0x8000|0x0001', 'a1x1', 'H264x265', 'FJBNF5x1_kA'])
      expect(analyze(t, A).normalized, t).toBe(t);
    expect(analyze('see 1x1.png', A).normalized).toBe('see 1×1.png');
    // A dash or underscore right before the first number or right after the second blocks it;
    // a letter after the second number does not (owner, 2026-11-18).
    for (const t of ['mixtral-8x22b', '1x2-abc', '4x4_drive', 'a_1x2'])
      expect(analyze(t, A).normalized, t).toBe(t);
    expect(analyze('200x200px', A).normalized).toBe('200×200px');
    // Outside the rule the x is an ordinary letter: `8х22b` is a word of its own (the dash
    // joins letters only), and `х` against `b` is a tie: reported, not converted.
    expect(R('mixtral-8х22b')).toEqual(['mixtral-8х22b', false, ['mixed_non_legitimate']]);
    // A look-alike outside the scope: the border rules (reported, not converted).
    expect(R('0х1F')).toEqual(['0х1F', false, ['mixed_non_legitimate']]);
  });
  it('by character class: any dash or connector, any letter-like before, any zero', () => {
    for (const t of [
      'mixtral–8x22b',
      'mixtral—8x22b',
      'a＿1x2',
      '1x2–abc',
      '０x1F',
      'ⓐ1x1',
      '𝐚1x1',
    ])
      expect(calls(t)[0], t).toBe(analyze(t.replace('x', 'y'), A).normalized.replace('y', 'x'));
    expect(calls('size ٣x٤ cm')[0]).toBe('size ٣×٤ cm');
  });
  it('a subscript or modifier x is never converted (30c); a Unicode dash blocks it', () => {
    for (const t of ['2ₓ3', '2ˣ3', '10ₓ5 cm', '1x2−3', '5−1x2']) expect(calls(t)[0], t).toBe(t);
  });
  it('the word phase reads phase 1’s output: a removed control is gone (decision 14)', () => {
    const o = (t: string) => analyze(t, A).normalized;
    expect(o('Please confirm the с\u0007-onstant now')).toBe('Please confirm the c-onstant now');
    expect(o('the с-\u0007onstant')).toBe('the c-onstant');
    expect(o('SMS\u0007-ах')).toBe('SMS-ах');
    expect(o('1x2\u0007-abc')).toBe('1x2-abc');
    expect(o('1x2\u001b[0m-abc')).toBe('1x2-abc');
  });
  it('every form phase 1 removes is no character after a dash and beside the `×` token', () => {
    const E = '\u001b';
    const removed = ['\u0007', '\u001f', '\u007f', '\u0090', '\ufffe', E + '[0m',
      E + '(B', E + '(B' + E + '[m', E + '7', E + '=', '\u009b0m', E + 'P1$r' + E + '\\', E + '[3\u0018',
      E + ']0;t' + E + '\\', E + ']8;;http://x\u0007', '\u00ad', '\u200b']; // prettier-ignore
    const hosts = ['the с-@onstant now', 'the с@-onstant now', 'size 1x2@-abc', 'size 1x2@_drive',
      'size abc-@1x2 cm', 'SMS-@ах', 'the NTLM-@хеш', 'Please pаy@pal now']; // prettier-ignore
    const run = (t: string, o: AnalyzeOptions) => {
      const w: string[] = [];
      const r = analyze(t, o, {
        onWord: (_s, _e, c, rp, y) => void w.push(`${c}→${rp}:${y.signals?.join()}`),
      });
      return [r.normalized, w, r.counts.wordsTotal];
    };
    for (const o of [A, ENRU])
      for (const h of hosts)
        for (const r of removed)
          expect(run(h.replace('@', r), o), JSON.stringify(h.replace('@', r))).toEqual(
            run(h.replace('@', ''), o),
          );
  });
  it('lenient alphabet model: 36e reads the character after a control as phase 1 outputs it', () => {
    const L: AnalyzeOptions = { confusionModel: 'alphabet' };
    for (const [t, out] of [
      ['size 1x2\u0007-abc', 'size 1x2-abc'],
      ['size 1x2\u001b[0m-abc', 'size 1x2-abc'],
    ])
      expect(analyze(t!, L).normalized, JSON.stringify(t)).toBe(out);
    // A removal after the control is no character either; kept invisible characters are not seen.
    for (const [t, out] of [
      ['size 4x4\u0007\ufffe_drive', 'size 4x4_drive'],
      ['size 4x4\u200b_drive', 'size 4x4_drive'],
      ['size 4x4\u00ad_drive', 'size 4x4_drive'],
      ['size _\u200b4x4 cm', 'size _4x4 cm'],
    ])
      expect(analyze(t!, L).normalized, JSON.stringify(t)).toBe(out);
    expect(analyze('4x4\u200b_drive', L).words.map((w) => w.signals)).toEqual([['invisible']]);
    // ESC alone is removed there, the rest of an OSC stays text: `]` follows the token.
    expect(analyze('4x4\u001b]0;t\u0007_drive', L).normalized).toBe('4×4]0;t_drive');
  });
  it('written `×` first, then judged as usual: digit look-alikes and readings convert', () => {
    expect(calls('৪x৪')).toEqual(['8×8', true, ['৪x৪→8×8[confusable_word]']]);
    expect(calls('size 1০x2০ cm')).toEqual([
      'size 10×20 cm',
      true,
      ['1০x2০→10×20[confusable_word]'],
    ]);
    expect(calls('10x1০')[0]).toBe('10×10');
    expect(calls('1x١')[0]).toBe('1×1');
    expect(calls('Ꮞx4')[0]).toBe('4×4');
  });
  it('upstream’s path is unchanged', () => {
    expect(analyze('1920x1080').normalized).toBe('1920x1080');
  });
});

describe('decision 42d: VT and FF are a line feed under the alphabet model', () => {
  const LA: AnalyzeOptions = { confusionModel: 'alphabet' };
  it('the words on either side stay two words; the control is still reported', () => {
    for (const o of [A, ENRU, LA]) {
      const w: string[] = [];
      const r = analyze('Moscow\u000bМосква', o, { onWord: (_s, _e, c) => void w.push(c) });
      expect([r.normalized, r.counts.wordsTotal, w], JSON.stringify(o)).toEqual([
        'Moscow\nМосква',
        2,
        [],
      ]);
      expect(r.words.map((x) => [x.word, x.signals])).toEqual([['\u000b', ['illegal']]]);
      expect(analyze('Moscow\u000cМосква', o).normalized).toBe('Moscow\nМосква');
    }
  });
  it('a line break before the dash: the `×` rule and the dash join see it', () => {
    expect(analyze('1x2\u000b-abc', A).normalized).toBe('1×2\n-abc');
    expect(analyze('1x2\u000b-abc', LA).normalized).toBe('1×2\n-abc');
    expect(analyze('the с-\u000bonstant', A).normalized).toBe('the с-\nonstant');
  });
  it('two make a paragraph break; FS–US stay removed; upstream’s path is unchanged', () => {
    expect(analyze('Моя Mосква\f\fВЕЗЕ', A).normalized).toBe('Моя Москва\n\nВЕЗЕ');
    expect(analyze('a\u001cb', A).normalized).toBe('ab');
    expect(analyze('Moscow\u000bМосква').normalized).toBe('MoscowМосква');
    expect(analyze('Moscow\u000bМосква', { hiddenChars: 'strict' }).normalized).toBe(
      'MoscowМосква',
    );
  });
});

describe('decision 41g: Turkish evidence spans the visibility token', () => {
  it('an apostrophe part keeps its ı when another part holds ğ, ş or İ', () => {
    for (const t of ["Çağı'nın", "İslam'ı", "Paşa'nın"]) expect(R(t), t).toEqual([t, false, []]);
  });
});

describe('decision 41o: a clean neighbour of its own language keeps a whole word', () => {
  const calls = (t: string) => {
    const out: string[] = [];
    const r = analyze(t, A, {
      onWord: (_s, _e, c, rp, w) => void out.push(`${c}→${rp}[${(w.signals ?? []).join('+')}]`),
    });
    return [r.normalized, out];
  };
  it('a clean Russian word beside it: reported, not converted', () => {
    expect(calls('Please confirm the сап (спасибо) before')).toEqual([
      'Please confirm the сап (спасибо) before',
      ['сап→сап[whole_word_lookalike]'],
    ]);
  });
  it('without one, the context still folds; look-alike neighbours are no clean words', () => {
    expect(calls('Please confirm the сап before you')[0]).toBe('Please confirm the can before you');
    expect(calls('please buy the ВООК НОТ today')[0]).toBe('please buy the BOOK HOT today');
  });
  it('numbers and HTML character references are skipped', () => {
    expect(calls('Камера 5&nbsp;Мп')).toEqual(['Камера 5&nbsp;Мп', []]);
    expect(calls('a&amp;b c&#160;d &#x41;bc')).toEqual(['a&amp;b c&#160;d &#x41;bc', []]);
  });
});

describe('decision 41o: the whole_word_lookalike category (owner, 2026-11-18)', () => {
  const calls = (t: string) => {
    const out: string[] = [];
    const r = analyze(t, A, {
      onWord: (_s, _e, c, rp, w) => void out.push(`${c}→${rp}[${(w.signals ?? []).join('+')}]`),
    });
    return [r.normalized, r.spoofed, r.signals.whole_word_lookalike === true, out];
  };
  it('a whole word kept by a clean neighbour: reported in its own category, not a spoof', () => {
    const t1 =
      'CONNECTED_DEVICE Коммуникация с устройствами по Bluetooth, NFC and other channels for every app';
    expect(calls(t1)).toEqual([t1, false, true, ['по→по[whole_word_lookalike]']]);
    const t2 = '| Камера 5&nbsp;Мп, f/2.4, PDAF, OIS, dual pixel, wide lens';
    expect(calls(t2)).toEqual([t2, false, true, ['Мп→Мп[whole_word_lookalike]']]);
    expect(calls('Please read the ВООК друг')).toEqual([
      'Please read the ВООК друг',
      false,
      true,
      ['ВООК→ВООК[whole_word_lookalike]'],
    ]);
  });
  it('without the clean neighbour the context folds it', () => {
    expect(calls('| camera 5&nbsp;Мп, f/2.4, PDAF, OIS, dual pixel, wide lens')[0]).toBe(
      '| camera 5&nbsp;Mn, f/2.4, PDAF, OIS, dual pixel, wide lens',
    );
  });
});

describe('decisions 41l and 42c: digit donors in × words; a removal beside an inner dash', () => {
  const run = (t: string) => {
    const reports: string[] = [];
    const r = analyze(t, A, {
      onReport: (m) => void reports.push(`${m.kind}:${m.extracted ?? 'null'}`),
    });
    return [r.normalized, r.spoofed, reports.filter((x) => !x.startsWith('htmlReference:'))];
  };
  it('D2: digit donors in × words take their digit reading first', () => {
    for (const [t, o] of [
      ['10x1০', '10×10'],
      ['size 1০x2০ cm', 'size 10×20 cm'],
      ['1x١', '1×1'],
    ])
      expect(run(t).slice(0, 2), t).toEqual([o, true]);
  });
  it('D3: a removed hidden character beside an inner dash does not split the token', () => {
    for (const t of ['the с­-onstant now', 'the с-­onstant now'])
      expect(run(t).slice(0, 2), t).toEqual(['the c-onstant now', true]);
  });
});

describe('decisions 37 and 14: caseless strokes; reason.toLang', () => {
  it('Lisu ꓲ: I between capitals or a capital and the edge, l otherwise (37)', () => {
    expect(analyze('ꓡꓲꓢꓔ', A).normalized).toBe('LIST');
    expect(analyze('the ꓲNFO page', A).normalized).toBe('the INFO page');
    expect(analyze('the TAXꓲ page', A).normalized).toBe('the TAXI page');
    expect(analyze('the pꓲxel page', A).normalized).toBe('the plxel page');
    expect(analyze('the Aꓲb page', A).normalized).toBe('the Alb page');
    expect(analyze('the aꓲB page', A).normalized).toBe('the alB page');
    expect(analyze('the ꓲnfo page', A).normalized).toBe('the lnfo page');
  });
  it('37 per donor: every cap-height caseless stroke reads I or l by the same rule', () => {
    for (const d of ['ꓲ', 'ǀ', 'ߊ', 'ᛁ', 'ⵏ', '𐊊', '𐌉', '𐌠', '𖼨', '𞣇', 'ا'])
      for (const o of [A, ENRU]) {
        const out = (t: string) => analyze(t.replace('#', d), o).normalized;
        expect(
          ['L#ST', 'A#', '#D', 'mi#k', 'A#b', 'a#B', '#f you', '#t is', '#ike this'].map(out),
          d,
        ).toEqual(['LIST', 'AI', 'ID', 'milk', 'Alb', 'alB', 'If you', 'It is', 'like this']);
        // Alone (the word's edge on both sides): `I`, the Latin `ǀ` too.
        expect(out('# am here'), d).toBe('I am here');
      }
  });
  it('37: a word start is the text start or a separator, not an inner apostrophe, dash or digit', () => {
    for (const [t, out] of [
      ["we'ꓲl go", "we'll go"],
      ['well-ꓲit', 'well-lit'],
      ['5ꓲb', '5lb'],
      ['10ꓲbs', '10lbs'],
      ['say ꓲt is', 'say It is'],
    ])
      expect(analyze(t!, A).normalized, t).toBe(out);
  });
  it('37: vav reads i only; final nun and the slanted digit ones read l', () => {
    expect(analyze('LוST mוk', A).normalized).toBe('LiST mik');
    expect(analyze('LןST mןk', A).normalized).toBe('LlST mlk');
    expect(analyze('L١ST m۱k', A).normalized).toBe('LlST mlk');
  });
  it('reason.toLang is a target language', () => {
    const langs: unknown[] = [];
    analyze(
      'pаypal and кoшка',
      { ...A, targetLanguages: ['English', 'Russian'] },
      { onWord: (_s, _e, _c, _r, w) => void langs.push(w.toLang) },
    );
    expect(langs).toEqual(['English', 'Russian']);
  });
});

describe('a word’s scripts: an invisible letter belongs to none', () => {
  it('a Hangul filler reaches the word phase (lenient) and adds no script', () => {
    for (const o of [{}, { confusionModel: 'alphabet' }] as AnalyzeOptions[]) {
      expect(analyze('pаㅤypal now', o).words[0]!.scripts, JSON.stringify(o)).toEqual([
        'Latin',
        'Cyrillic',
      ]);
      expect(analyze('ㅤаㅤ', o).words[0]!.scripts).toEqual(['Cyrillic']);
      expect(analyze('aᅟb', o).words[0]!.scripts).toEqual(['Latin']);
    }
  });
});
