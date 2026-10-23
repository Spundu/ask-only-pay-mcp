import { describe, expect, it } from 'vitest';
import { ApproverClient, ClientError } from '../src/client.js';
import { fakeTransport, json } from './support/fixtures.js';

const FIELDS = { merchant: 'Example Shop', amount: '19.00', currency: 'EUR', card_handle: 'card-2', checkout_url: 'https://shop.example/c' };
const ACK = { approval_id: 'K7Q2M4XZ3A', state: 'pending', expires_at: 1_800_000_000 };
const ID = 'K7Q2M4XZ3A';

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ClientError) return err.code;
    throw err;
  }
  return 'resolved';
}

describe('ApproverClient (SPEC.md §2.1, §2.2)', () => {
  it('can only ask and read: its methods are exactly requestPay, requestAccountCreate and status', () => {
    const methods = Object.getOwnPropertyNames(ApproverClient.prototype).filter((m) => m !== 'constructor' && !m.startsWith('send'));
    expect(methods.sort()).toEqual(['requestAccountCreate', 'requestPay', 'status']);
  });

  it('sends the fields and the request id, and returns the acknowledgement', async () => {
    const t = fakeTransport(json(201, ACK));
    expect(await new ApproverClient(t).requestPay(FIELDS, 'rid-1')).toEqual(ACK);
    expect(t.calls).toEqual([{ method: 'POST', path: '/v1/pay', body: { ...FIELDS, request_id: 'rid-1' } }]);
  });

  it.each([
    ['a recap', { ...ACK, recap: 'PAY 19.00 EUR' }],
    ['a card number', { ...ACK, card: '4111111111111111' }],
    ['a token', { ...ACK, token: 'abc' }],
    ['a state that is not pending', { ...ACK, state: 'approved' }],
    ['a malformed id', { ...ACK, approval_id: 'x' }],
    ['a float expiry', { ...ACK, expires_at: 1.5 }],
    ['an array', [ACK]],
    ['null', null],
  ])('refuses an acknowledgement with %s', async (_what, body) => {
    expect(await code(new ApproverClient(fakeTransport(json(201, body))).requestPay(FIELDS, 'r'))).toBe('APPROVER_RESPONSE_REJECTED');
  });

  it('refuses an answer that is not JSON', async () => {
    expect(await code(new ApproverClient(fakeTransport({ status: 201, body: '<html>' })).requestPay(FIELDS, 'r'))).toBe('APPROVER_RESPONSE_REJECTED');
  });

  it('accepts explicit nulls in a status, as a real server writes them, and drops them', async () => {
    const t = fakeTransport(json(200, { approval_id: ID, state: 'pending', ref: null, error_code: null }));
    expect(await new ApproverClient(t).status(ID)).toEqual({ approval_id: ID, state: 'pending' });
    expect(t.calls[0]).toEqual({ method: 'GET', path: `/v1/result/${ID}` });
  });

  it('refuses a status with a long or odd reference, which could carry data', async () => {
    for (const ref of ['x'.repeat(65), 'has space', 'card:4111']) {
      expect(await code(new ApproverClient(fakeTransport(json(200, { approval_id: ID, state: 'approved', ref }))).status(ID))).toBe('APPROVER_RESPONSE_REJECTED');
    }
  });

  it('refuses a status about another ask', async () => {
    expect(await code(new ApproverClient(fakeTransport(json(200, { approval_id: 'AAAAAAAAAA', state: 'approved' }))).status(ID))).toBe('APPROVER_RESPONSE_REJECTED');
  });

  it.each([
    [404, 'NOT_FOUND'],
    [429, 'TOO_MANY_PENDING'],
    [400, 'APPROVER_REFUSED'],
    [409, 'APPROVER_REFUSED'],
    [500, 'APPROVER_REFUSED'],
    [200, 'APPROVER_REFUSED'],
  ])('maps HTTP %i on an ask to %s, never passing on the approver text', async (status, expected) => {
    const t = fakeTransport(json(status, { error: 'secret detail https://internal.example' }));
    const err = await new ApproverClient(t).requestAccountCreate({ provider_url: 'https://s.example/' }, 'r').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ClientError);
    expect((err as ClientError).code).toBe(expected);
    expect((err as ClientError).message).toBe(expected);
  });

  it('reports a connection failure as APPROVER_UNREACHABLE', async () => {
    expect(await code(new ApproverClient(fakeTransport(new Error('ECONNREFUSED 10.0.0.1:8443'))).status(ID))).toBe('APPROVER_UNREACHABLE');
  });
});
