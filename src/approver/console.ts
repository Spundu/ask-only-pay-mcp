// The approver's console: the only place an ask is approved or denied (SPEC.md §7). It reads the
// person's commands, one per line, and answers in plain text.

import { recap } from './recap.js';
import type { Clock, Store } from './store.js';
import { systemClock } from './store.js';

const HELP = 'commands: approve ID | deny ID | list | help';

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
    if (outcome.ok) return `${outcome.ask.id}: ${outcome.ask.state}${outcome.ask.ref ? ` (${outcome.ask.ref}, no money moved: reference approver)` : ''}`;
    if (outcome.error === 'not_found') return `no ask ${id.toUpperCase()}`;
    return `${id.toUpperCase()} is already ${store.get(id.toUpperCase())?.state ?? 'decided'}: a decision is final`;
  }
  return HELP;
}
