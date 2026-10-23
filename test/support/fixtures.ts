// Shared test helpers: certificates from the global setup, a valid ask, and a fake transport.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { inject } from 'vitest';
import type { Reply, Transport } from '../../src/client.js';

export const REPO = path.resolve(import.meta.dirname, '..', '..');

/** A path in one of the two certificate sets (`good`, `other`). */
export function certPath(set: 'good' | 'other', name: string): string {
  return path.join(inject('certDir'), set, name);
}

export function certFile(set: 'good' | 'other', name: string): Buffer {
  return readFileSync(certPath(set, name));
}

export const PAY = {
  verb: 'pay',
  merchant: 'Example Shop',
  amount: '19.00',
  currency: 'EUR',
  card_handle: 'card-2',
  checkout_url: 'https://shop.example/checkout/123',
} as const;

export const ACCOUNT = { verb: 'account_create', provider_url: 'https://service.example/signup' } as const;

export interface Call {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
}

/** A transport that answers every call with the next reply, and records the calls. */
export function fakeTransport(...replies: Array<Reply | Error>): Transport & { calls: Call[] } {
  const calls: Call[] = [];
  const next = async (call: Call): Promise<Reply> => {
    calls.push(call);
    const reply = replies.shift() ?? new Error('no reply left');
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return {
    calls,
    post: (p, body) => next({ method: 'POST', path: p, body }),
    get: (p) => next({ method: 'GET', path: p }),
  };
}

export const json = (status: number, body: unknown): Reply => ({ status, body: JSON.stringify(body) });
