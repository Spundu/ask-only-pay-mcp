// The recap a person reads before deciding (SPEC.md §7). Built from the stored ask only, never from
// anything the agent sends later, so what the person approves is exactly what is recorded.

import type { Ask } from './store.js';

/** Every recap line fits in this many terminal columns, so the terminal never wraps one by itself. */
export const MAX_LINE = 76;
const LABEL = 13; // "  checkout:  "
const WIDTH = MAX_LINE - LABEL;
/** Starts every continuation line: text from the agent can never begin a line the way the approver's do. */
const MORE = '  ' + ' '.repeat(LABEL - 4) + '> ';

/**
 * The columns a character may take, counted on the safe side: printable ASCII takes 1, and anything else
 * is counted as 2, the most a terminal gives one character (CJK and emoji take 2). Counting a narrow
 * character as 2 only makes a line shorter; counting a wide one as 1 would let the terminal wrap it.
 */
export function columns(c: string): number {
  const cp = c.codePointAt(0)!;
  return cp >= 0x20 && cp < 0x7f ? 1 : 2;
}

const escape = (c: string) => `\\u{${c.codePointAt(0)!.toString(16)}}`;

/**
 * Text from an ask, safe to print. Shown as \u{…} escapes: control characters (which could move the cursor
 * or redraw the terminal), format characters (bidirectional overrides, zero-width and tag characters, which
 * could reorder or hide text), separators, private-use and unassigned code points, variation selectors,
 * blank fillers, every space but the plain one, and every combining mark after the first on a character
 * (a stack of marks can be drawn over the lines above and below). Runs of plain spaces become one.
 */
export function safe(text: string): string {
  return text
    .normalize('NFC')
    .replace(
      // eslint-disable-next-line no-misleading-character-class -- combining code points are listed on purpose, to escape them
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cn}\u{a0}\u{1680}\u{2000}-\u{200a}\u{202f}\u{205f}\u{3000}\u{fe00}-\u{fe0f}\u{e0100}-\u{e01ef}\u{34f}\u{115f}\u{1160}-\u{11ff}\u{d7b0}-\u{d7ff}\u{17b4}\u{17b5}\u{2800}\u{3164}\u{ffa0}]/gu,
      escape,
    )
    .replace(/(\p{M})(\p{M}+)/gu, (_all, first: string, rest: string) => first + [...rest].map(escape).join(''))
    .replace(/ {2,}/g, ' ');
}

/** Rows a field may take: the whole recap stays short enough that its first and last lines share a screen. */
const MAX_ROWS = { merchant: 2, url: 3, reason: 4 } as const;

/**
 * One labelled field, cut into lines of at most WIDTH columns; later lines start with MORE. Past `maxRows`
 * the rest is not shown, and the last row says how much was left out.
 */
function field(label: string, value: string, maxRows = Infinity): string[] {
  const rows: string[] = [];
  let row = '';
  let used = 0;
  for (const c of value) {
    const w = columns(c);
    if (used + w > WIDTH) {
      rows.push(row);
      row = '';
      used = 0;
    }
    row += c;
    used += w;
  }
  rows.push(row);
  if (rows.length > maxRows) {
    const shown = rows.slice(0, maxRows - 1);
    const hidden = [...rows.slice(maxRows - 1).join('')].length;
    rows.splice(0, rows.length, ...shown, `... ${hidden} more characters not shown`);
  }
  return rows.map((r, i) => (i === 0 ? `  ${`${label}:`.padEnd(LABEL - 2)}` : MORE) + r);
}

/** A host that fits in `max` columns: the END is kept (it names who owns the site), the cut is marked. */
function hostTail(host: string, max: number): string {
  return host.length <= max ? host : `...${host.slice(-(max - 3))}`;
}

/**
 * A one-line summary of what an ask does, from its stored fields, in at most `max` columns. The recap ends
 * with it, right above the approve line, and the console repeats it on a decision.
 */
export function summary(ask: Ask, max = WIDTH): string {
  const b = ask.body;
  const head = b.kind === 'pay' ? `PAY ${b.fields.amount} ${b.fields.currency} at ` : 'CREATE AN ACCOUNT at ';
  const url = new URL(b.kind === 'pay' ? b.fields.checkout_url : b.fields.provider_url);
  return head + hostTail(url.host, max - head.length);
}

export function recap(ask: Ask, now: number): string {
  const minutes = Math.max(0, Math.ceil((ask.expiresAt - now) / 60));
  const b = ask.body;
  const lines = [`[ask ${ask.id}] ${b.kind === 'pay' ? `PAY ${b.fields.amount} ${b.fields.currency}` : 'CREATE AN ACCOUNT'}`];
  // URLs are stored as the browser resolves them (src/rules.ts): href and host are printable ASCII.
  if (b.kind === 'pay') {
    const url = new URL(b.fields.checkout_url);
    lines.push(...field('to', safe(b.fields.merchant), MAX_ROWS.merchant), ...field('card', b.fields.card_handle), ...field('site', hostTail(url.host, WIDTH)), ...field('checkout', url.href, MAX_ROWS.url));
  } else {
    const url = new URL(b.fields.provider_url);
    lines.push(...field('site', hostTail(url.host, WIDTH)), ...field('signup', url.href, MAX_ROWS.url), ...field('identity', b.fields.identity_handle ?? 'primary'));
  }
  if (b.fields.reason) lines.push(...field('reason', `(from the agent, unchecked) ${safe(b.fields.reason)}`, MAX_ROWS.reason));
  // The approver's own words close the recap, next to the approve line: agent text above cannot be the last
  // thing the person reads before deciding.
  lines.push(...field('expires', `in ${minutes} min`), ...field('approving', summary(ask)), `  approve ${ask.id}   or   deny ${ask.id}`);
  return lines.join('\n');
}
