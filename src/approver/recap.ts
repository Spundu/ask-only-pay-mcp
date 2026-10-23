// The recap a person reads before deciding (SPEC.md §7). Built from the stored ask only, never from
// anything the agent sends later, so what the person approves is exactly what is recorded.

import type { Ask } from './store.js';

/**
 * Text from an ask, safe to print: control characters (which could move the cursor or redraw the terminal),
 * bidirectional overrides and zero-width characters (which could make "19.00" read as something else) are
 * shown as \u{…} escapes.
 */
export function safe(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u{0}-\u{1f}\u{7f}-\u{9f}\u{ad}\u{61c}\u{180e}\u{200b}-\u{200f}\u{2028}-\u{202e}\u{2060}-\u{206f}\u{feff}\u{fff9}-\u{fffb}]/gu, (c) => `\\u{${c.codePointAt(0)!.toString(16)}}`);
}

export function recap(ask: Ask, now: number): string {
  const minutes = Math.max(0, Math.ceil((ask.expiresAt - now) / 60));
  const lines: string[] = [];
  const b = ask.body;
  if (b.kind === 'pay') {
    lines.push(`[ask ${ask.id}] PAY ${b.fields.amount} ${b.fields.currency}`);
    lines.push(`  to:        ${safe(b.fields.merchant)}`);
    lines.push(`  card:      ${b.fields.card_handle}`);
    lines.push(`  checkout:  ${safe(b.fields.checkout_url)}`);
    lines.push(`  site:      ${new URL(b.fields.checkout_url).host}`);
  } else {
    lines.push(`[ask ${ask.id}] CREATE AN ACCOUNT`);
    lines.push(`  site:      ${new URL(b.fields.provider_url).host}`);
    lines.push(`  signup:    ${safe(b.fields.provider_url)}`);
    lines.push(`  identity:  ${b.fields.identity_handle ?? 'primary'}`);
  }
  if (b.fields.reason) lines.push(`  agent's reason (unchecked): ${safe(b.fields.reason)}`);
  lines.push(`  expires:   in ${minutes} min`);
  lines.push(`  approve ${ask.id}   or   deny ${ask.id}`);
  return lines.join('\n');
}
