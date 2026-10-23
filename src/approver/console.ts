// The approver's console: the only place an ask is approved or denied (SPEC.md §7). It reads the
// person's commands, one per line, and answers in plain text.

import { MAX_LINE, recap, summary } from './recap.js';
import type { Clock, Store } from './store.js';
import { systemClock } from './store.js';

const HELP = 'commands: approve ID | deny ID | list | help';

/**
 * What to print on a terminal `width` columns wide (undefined: not a terminal, such as a pipe). A recap is
 * laid out for at least MAX_LINE columns; on a narrower terminal its lines would wrap, and text from the
 * agent could start a row, so it is not shown at all.
 */
export function forTerminal(text: string, width: number | undefined): string {
  if (width === undefined || width >= MAX_LINE || !/^\[ask /m.test(text)) return text;
  const ids = [...text.matchAll(/^\[ask ([A-Z2-7]{10})\]/gm)].map((m) => m[1]);
  return `${ids.length} ask(s) not shown (${ids.join(', ')}): this terminal is ${width} columns, a recap needs ${MAX_LINE}. Widen it, then type list.`;
}

/** Runs one console line and returns what to print. */
export function command(line: string, store: Store, clock: Clock = systemClock): string {
  const [verb = '', id = '', ...rest] = line.trim().split(/\s+/);
  if (verb === '') return '';
  if (verb === 'help' && !id) return HELP;
  if (verb === 'list' && !id) {
    const pending = store.pending();
    return pending.length ? pending.map((ask) => recap(ask, clock())).join('\n\n') : 'no pending asks';
  }
  if ((verb === 'approve' || verb === 'deny') && id && rest.length === 0) {
    // Ids are upper case; accept what a person types.
    const outcome = store.decide(id.toUpperCase(), verb);
    // Says what was decided, from the stored ask: a recap forged inside another ask's text cannot hide it.
    if (outcome.ok) {
      const ref = outcome.ask.ref ? `\n  ${outcome.ask.ref}: no money moved (reference approver)` : '';
      const head = `${outcome.ask.id}: ${outcome.ask.state}: `;
      return `${head}${summary(outcome.ask, MAX_LINE - head.length)}${ref}`;
    }
    if (outcome.error === 'not_found') return `no ask ${id.toUpperCase()}`;
    return `${id.toUpperCase()} is already ${store.get(id.toUpperCase())?.state ?? 'decided'}: a decision is final`;
  }
  return HELP;
}
