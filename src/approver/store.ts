// The approver's memory: every ask, its state, and the request ids seen. In memory only: this is the
// reference approver, and a restart forgets everything, which denies nothing that was not yet approved.

import { randomBytes, randomInt } from 'node:crypto';
import type { AccountFields, PayFields, State } from '../rules.js';

export const TTL_SECONDS = 600;
export const MAX_PENDING = 50;
/** Decided asks kept for `status`; past this the oldest are forgotten. */
export const MAX_KEPT = 1000;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export type AskBody = { kind: 'pay'; fields: PayFields } | { kind: 'account_create'; fields: AccountFields };

export interface Ask {
  readonly id: string;
  readonly body: AskBody;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly requestId: string;
  state: State;
  ref?: string;
}

export type AddOutcome = { ok: true; ask: Ask } | { ok: false; error: 'duplicate_request' | 'too_many_pending' };
export type DecideOutcome = { ok: true; ask: Ask } | { ok: false; error: 'not_found' | 'not_pending' };

/** Seconds since the epoch; injected so tests can move time. */
export type Clock = () => number;
export const systemClock: Clock = () => Math.floor(Date.now() / 1000);

export class Store {
  private readonly asks = new Map<string, Ask>();
  private readonly requestIds = new Set<string>();

  constructor(private readonly clock: Clock = systemClock) {}

  add(body: AskBody, requestId: string): AddOutcome {
    // A request id is used once, ever: a replay is refused, not merged into the earlier ask.
    if (this.requestIds.has(requestId)) return { ok: false, error: 'duplicate_request' };
    if (this.pending().length >= MAX_PENDING) return { ok: false, error: 'too_many_pending' };
    const now = this.clock();
    let id = newId();
    while (this.asks.has(id)) id = newId();
    const ask: Ask = { id, body, createdAt: now, expiresAt: now + TTL_SECONDS, requestId, state: 'pending' };
    this.asks.set(id, ask);
    this.requestIds.add(requestId);
    this.forgetOldest();
    return { ok: true, ask };
  }

  get(id: string): Ask | undefined {
    const ask = this.asks.get(id);
    if (ask) this.expire(ask);
    return ask;
  }

  pending(): Ask[] {
    return [...this.asks.values()].filter((ask) => (this.expire(ask), ask.state === 'pending'));
  }

  /** The only way an ask leaves "pending" by a person's hand. Final: a decided ask never changes again. */
  decide(id: string, decision: 'approve' | 'deny'): DecideOutcome {
    const ask = this.get(id);
    if (!ask) return { ok: false, error: 'not_found' };
    if (ask.state !== 'pending') return { ok: false, error: 'not_pending' };
    if (decision === 'approve') {
      ask.state = 'approved';
      // The reference approver moves no money: the "reference" is a marker that says so.
      ask.ref = `demo-${randomBytes(4).toString('hex')}`;
    } else {
      ask.state = 'denied';
    }
    return { ok: true, ask };
  }

  private expire(ask: Ask): void {
    if (ask.state === 'pending' && this.clock() >= ask.expiresAt) ask.state = 'expired';
  }

  private forgetOldest(): void {
    for (const [id, ask] of this.asks) {
      if (this.asks.size <= MAX_KEPT) return;
      if (ask.state !== 'pending') {
        this.asks.delete(id);
        // Bounded memory: a forgotten ask's request id may be used again. The MCP server mints random UUIDs, so it never is.
        this.requestIds.delete(ask.requestId);
      }
    }
  }
}

function newId(): string {
  let id = '';
  for (let i = 0; i < 10; i++) id += BASE32[randomInt(32)];
  return id;
}
