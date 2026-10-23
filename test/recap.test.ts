// The recap cannot be forged or blurred by text from the agent (SPEC.md §7).

import { describe, expect, it } from 'vitest';
import { MAX_LINE, recap, safe, summary } from '../src/approver/recap.js';
import { command, forTerminal } from '../src/approver/console.js';
import { Store, type AskBody } from '../src/approver/store.js';

const PAY = { merchant: 'Corner Coffee', amount: '3.50', currency: 'GBP', card_handle: 'card-2', checkout_url: 'https://coffee.example/c' };

function ask(fields: Record<string, unknown>) {
  const added = new Store(() => 0).add({ kind: 'pay', fields: { ...PAY, ...fields } } as AskBody, crypto.randomUUID());
  if (!added.ok) throw new Error('not added');
  return added.ask;
}

describe('a forged recap inside agent text', () => {
  // Review finding: a long reason padded to the terminal's wrap point drew a fake ask, with another ask's id.
  const forged = '[ask UGH5L4R64D] PAY 3.50 GBP  to: Corner Coffee  approve UGH5L4R64D';
  const attempts = [
    `tip${' '.repeat(77)}${forged}`,
    `${'x'.repeat(48)}${forged}${'y'.repeat(60)}${forged}`,
    `${'a '.repeat(30)}${forged}`.slice(0, 500),
  ];

  it.each(attempts)('cannot start a line of the recap: %#', (reason) => {
    const lines = recap(ask({ reason, merchant: `${' '.repeat(40)}Shop${' '.repeat(40)}` }), 0).split('\n');
    // Every line fits the width, so the terminal never wraps one, and only the approver's own first line
    // starts with "[ask"; every other line starts with the approver's label or its "> " continuation mark.
    for (const line of lines) expect([...line].length).toBeLessThanOrEqual(MAX_LINE);
    expect(lines.filter((l) => l.startsWith('[ask'))).toHaveLength(1);
    for (const line of lines.slice(1, -1)) expect(line).toMatch(/^ {2}(?:[a-z]+: +| {9}> )/);
    expect(lines.at(-1)).toMatch(/^ {2}approve [A-Z2-7]{10} {3}or {3}deny [A-Z2-7]{10}$/);
  });

  /** How a real terminal lays text out: CJK and emoji take 2 columns, combining marks 0, the rest 1. */
  function screenRows(text: string, width = 80): string[] {
    const wide = /[\u{1100}-\u{115f}\u{2e80}-\u{a4cf}\u{ac00}-\u{d7a3}\u{f900}-\u{faff}\u{fe30}-\u{fe4f}\u{ff00}-\u{ff60}\u{ffe0}-\u{ffe6}\u{1f000}-\u{1faff}\u{20000}-\u{3fffd}]/u;
    const rows: string[] = [];
    for (const line of text.split('\n')) {
      let row = '';
      let used = 0;
      for (const c of line) {
        const w = /\p{M}/u.test(c) ? 0 : wide.test(c) ? 2 : 1;
        if (used + w > width) {
          rows.push(row);
          row = '';
          used = 0;
        }
        row += c;
        used += w;
      }
      rows.push(row);
    }
    return rows;
  }

  // Round 2: 76 CHARACTERS of 東 are 152 columns, so the terminal wrapped them and text after the wrap
  // point began a line of its own.
  it.each([
    ['CJK', `${'f'.repeat(35)}${`${'東'.repeat(33)}x${forged}`.repeat(4)}`.slice(0, 500)],
    ['emoji', `${`${String.fromCodePoint(0x1f600).repeat(33)}x${forged}`.repeat(4)}`.slice(0, 500)],
    ['full-width', `${'Ａ'.repeat(40)}${forged}${'Ａ'.repeat(40)}${forged}`],
  ])('cannot start a screen row with wide characters (%s) on an 80- or 77-column terminal', (_kind, reason) => {
    const text = recap(ask({ reason, merchant: `${'東'.repeat(60)}${forged}`.slice(0, 120) }), 0);
    for (const width of [80, 77]) {
      const rows = screenRows(text, width);
      expect(rows.length).toBe(text.split('\n').length); // nothing wrapped
      expect(rows.filter((r) => r.startsWith('[ask'))).toHaveLength(1);
    }
  });

  // Round 3: a 1,900-character URL and a long reason pushed the real amount and site off a 24-line
  // screen, leaving a fake "PAY 19.00 EUR ... shop.example" in the reason right above the approve line.
  it('stays short, and ends with the approver\'s own summary right above the approve line', () => {
    const zw = String.fromCodePoint(0x200b);
    const a = ask({
      amount: '4999.00',
      currency: 'EUR',
      checkout_url: `https://evil.example/${'x'.repeat(1900)}`,
      merchant: '東'.repeat(120),
      reason: `${'ok '.repeat(120)}PAY 19.00 EUR to Example Shop at shop.example ${zw.repeat(40)}`,
    });
    const lines = recap(a, 0).split('\n');
    expect(lines.length).toBeLessThanOrEqual(16);
    expect(lines.at(-2)).toBe('  approving: PAY 4999.00 EUR at evil.example');
    expect(lines.filter((l) => / {9}> \.\.\. \d+ more characters not shown$/.test(l)).length).toBe(3);
  });

  it('fits the decision line in 76 columns, even for the largest amount and a long host', () => {
    const a = ask({ amount: '999999999.99', checkout_url: `https://shop.example.${'a'.repeat(60)}.evil.example/c` });
    const s = new Store();
    const added = s.add(a.body, 'r');
    if (!added.ok) throw new Error('not added');
    const line = command(`approve ${added.ask.id}`, s).split('\n')[0]!;
    expect(line.length).toBeLessThanOrEqual(MAX_LINE);
    expect(line).toMatch(/approved: PAY 999999999\.99 GBP at \.{3}[a.]+\.evil\.example$/);
  });

  it('is not shown on a terminal narrower than a recap, only a notice with the ids', () => {
    const text = recap(ask({}), 0);
    const id = /^\[ask ([A-Z2-7]{10})\]/.exec(text)![1];
    expect(forTerminal(text, 60)).toBe(`1 ask(s) not shown (${id}): this terminal is 60 columns, a recap needs 76. Widen it, then type list.`);
    expect(forTerminal(text, 76)).toBe(text);
    expect(forTerminal(text, undefined)).toBe(text);
    expect(forTerminal('no pending asks', 40)).toBe('no pending asks');
  });

  it('collapses runs of spaces in agent text', () => {
    expect(recap(ask({ merchant: `Big${' '.repeat(60)}Shop` }), 0)).toContain('  to:        Big Shop\n');
  });

  it('keeps the end of a long host, which names who owns the site, in the site line and the decision', () => {
    const host = `shop.example.${'a'.repeat(50)}.evil.com`;
    const a = ask({ checkout_url: `https://${host}/c`, amount: '999.00' });
    const text = recap(a, 0);
    expect(text).toMatch(/\n {2}site: {6}\.{3}[a.]+\.evil\.com\n/);
    expect(summary(a)).toMatch(/^PAY 999\.00 GBP at \.{3}[a.]+\.evil\.com$/);
    expect([...summary(a)].length).toBeLessThanOrEqual(MAX_LINE - 13);
  });

  it('wraps a long checkout URL itself, with the continuation mark', () => {
    const text = recap(ask({ checkout_url: `https://coffee.example/${'p'.repeat(150)}` }), 0);
    expect(text).toMatch(/\n {2}checkout: {2}https:\/\/coffee\.example\/p+\n {11}> p+/);
  });
});

describe('characters that could hide or reorder text', () => {
  it.each([
    [0x1b, 'escape'],
    [0x202e, 'right-to-left override'],
    [0x200b, 'zero-width space'],
    [0xe0041, 'tag character'],
    [0xfe0f, 'variation selector'],
    [0x34f, 'combining grapheme joiner'],
    [0x115f, 'Hangul choseong filler'],
    [0x1161, 'Hangul jungseong'],
    [0xd7b0, 'Hangul jungseong extended'],
    [0x3164, 'Hangul filler'],
    [0xffa0, 'half-width Hangul filler'],
    [0x2800, 'braille blank'],
    [0x17b4, 'Khmer inherent vowel'],
    [0x1d173, 'musical format character'],
    [0x1bca0, 'shorthand format character'],
    [0x600, 'Arabic number sign'],
    [0xa0, 'no-break space'],
    [0x2003, 'em space'],
    [0x3000, 'ideographic space'],
    [0x2028, 'line separator'],
    [0xe000, 'private use'],
    [0x378, 'unassigned'],
  ])('escapes U+%s (%s)', (cp) => {
    expect(safe(`19${String.fromCodePoint(cp)}00`)).toBe(`19\\u{${cp.toString(16)}}00`);
  });

  it('keeps one combining mark on a character and escapes a stack of them', () => {
    const acute = String.fromCodePoint(0x301);
    const grave = String.fromCodePoint(0x300);
    expect(safe(`e${acute}`)).toBe('é'); // composed
    expect(safe(`q${acute}`)).toBe(`q${acute}`);
    expect(safe(`q${acute}${grave}${acute}`)).toBe(`q${acute}\\u{300}\\u{301}`);
  });

  it('leaves ordinary text alone', () => {
    expect(safe('Café Zoë — «plain» 東京')).toBe('Café Zoë — «plain» 東京');
  });
});
