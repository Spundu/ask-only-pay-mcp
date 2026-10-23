// The recap cannot be forged or blurred by text from the agent (SPEC.md §7).

import { describe, expect, it } from 'vitest';
import { MAX_LINE, recap, safe } from '../src/approver/recap.js';
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

  it('collapses runs of spaces in agent text', () => {
    expect(recap(ask({ merchant: `Big${' '.repeat(60)}Shop` }), 0)).toContain('  to:        Big Shop\n');
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

  it('leaves ordinary text alone', () => {
    expect(safe('Café Zoë — «plain» 東京')).toBe('Café Zoë — «plain» 東京');
  });
});
