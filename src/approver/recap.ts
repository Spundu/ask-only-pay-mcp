// The recap a person reads before deciding (SPEC.md §7). Built from the stored ask only, never from
// anything the agent sends later, so what the person approves is exactly what is recorded.

import type { Ask } from './store.js';

/** Every recap line fits in this many columns, so the terminal never wraps one by itself. */
export const MAX_LINE = 76;
const LABEL = 13; // "  checkout:  "
const WIDTH = MAX_LINE - LABEL;
/** Starts every continuation line: text from the agent can never begin a line the way the approver's do. */
const MORE = '  ' + ' '.repeat(LABEL - 4) + '> ';

/**
 * Text from an ask, safe to print. Shown as \u{…} escapes: control characters (which could move the cursor
 * or redraw the terminal), format characters (bidirectional overrides, zero-width and tag characters, which
 * could reorder or hide text), separators, private-use and unassigned code points, variation selectors,
 * blank fillers, and every space but the plain one. Runs of plain spaces become one.
 */
export function safe(text: string): string {
  return text
    .replace(
      // eslint-disable-next-line no-misleading-character-class -- combining code points are listed on purpose, to escape them
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cn}\u{a0}\u{1680}\u{2000}-\u{200a}\u{202f}\u{205f}\u{3000}\u{fe00}-\u{fe0f}\u{e0100}-\u{e01ef}\u{34f}\u{115f}\u{1160}\u{17b4}\u{17b5}\u{2800}\u{3164}\u{ffa0}]/gu,
      (c) => `\\u{${c.codePointAt(0)!.toString(16)}}`,
    )
    .replace(/ {2,}/g, ' ');
}

/** One labelled field, cut into lines of at most WIDTH characters; later lines start with MORE. */
function field(label: string, value: string): string[] {
  const chars = [...value];
  const lines: string[] = [];
  for (let i = 0; i < chars.length || i === 0; i += WIDTH) {
    lines.push((i === 0 ? `  ${`${label}:`.padEnd(LABEL - 2)}` : MORE) + chars.slice(i, i + WIDTH).join(''));
  }
  return lines;
}

/** A one-line summary of what an ask does, from its stored fields (the console repeats it on a decision). */
export function summary(ask: Ask): string {
  const b = ask.body;
  const text = b.kind === 'pay' ? `PAY ${b.fields.amount} ${b.fields.currency} at ${new URL(b.fields.checkout_url).host}` : `CREATE AN ACCOUNT at ${new URL(b.fields.provider_url).host}`;
  return [...text].slice(0, WIDTH).join('');
}

export function recap(ask: Ask, now: number): string {
  const minutes = Math.max(0, Math.ceil((ask.expiresAt - now) / 60));
  const b = ask.body;
  const lines = [`[ask ${ask.id}] ${b.kind === 'pay' ? `PAY ${b.fields.amount} ${b.fields.currency}` : 'CREATE AN ACCOUNT'}`];
  if (b.kind === 'pay') {
    const url = new URL(b.fields.checkout_url);
    lines.push(...field('to', safe(b.fields.merchant)), ...field('card', b.fields.card_handle), ...field('site', url.host), ...field('checkout', url.href));
  } else {
    const url = new URL(b.fields.provider_url);
    lines.push(...field('site', url.host), ...field('signup', url.href), ...field('identity', b.fields.identity_handle ?? 'primary'));
  }
  if (b.fields.reason) lines.push(...field('reason', `(from the agent, unchecked) ${safe(b.fields.reason)}`));
  lines.push(...field('expires', `in ${minutes} min`), `  approve ${ask.id}   or   deny ${ask.id}`);
  return lines.join('\n');
}
