import { describe, expect, it } from 'vitest';
import { ApproverClient } from '../src/client.js';
import { handleRequest } from '../src/tool.js';
import { ACCOUNT, PAY, fakeTransport, json } from './support/fixtures.js';

const ACK = { approval_id: 'K7Q2M4XZ3A', state: 'pending', expires_at: 1_800_000_000 };

describe('the request tool (SPEC.md §3)', () => {
  it('asks to pay with a request id it mints itself, fresh for every ask', async () => {
    const t = fakeTransport(json(201, ACK), json(201, ACK));
    const client = new ApproverClient(t);
    expect(await handleRequest(client, PAY)).toEqual({ ok: true, value: ACK });
    await handleRequest(client, PAY);
    const ids = t.calls.map((c) => (c.body as { request_id: string }).request_id);
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(ids[1]).not.toBe(ids[0]);
    const { verb: _verb, ...fields } = PAY;
    expect(t.calls[0]!.body).toEqual({ ...fields, request_id: ids[0] });
  });

  it('asks to create an account', async () => {
    const t = fakeTransport(json(201, ACK));
    expect(await handleRequest(new ApproverClient(t), { ...ACCOUNT, identity_handle: 'work' }, () => 'rid')).toEqual({ ok: true, value: ACK });
    expect(t.calls[0]).toEqual({ method: 'POST', path: '/v1/account/create', body: { provider_url: ACCOUNT.provider_url, identity_handle: 'work', request_id: 'rid' } });
  });

  it('reads a status', async () => {
    const t = fakeTransport(json(200, { approval_id: 'K7Q2M4XZ3A', state: 'approved', ref: 'demo-0a1b2c3d', error_code: null }));
    expect(await handleRequest(new ApproverClient(t), { verb: 'status', approval_id: 'K7Q2M4XZ3A' })).toEqual({
      ok: true,
      value: { approval_id: 'K7Q2M4XZ3A', state: 'approved', ref: 'demo-0a1b2c3d' },
    });
  });

  it.each([
    ['a request id from the agent', { ...PAY, request_id: 'replay-me' }],
    ['an unknown verb', { verb: 'approve', approval_id: 'K7Q2M4XZ3A' }],
    ['no verb', { merchant: 'x' }],
    ['a field of another verb', { ...PAY, provider_url: 'https://x.example/' }],
    ['a number amount', { ...PAY, amount: 19 }],
    ['a card number as the handle', { ...PAY, card_handle: '4111111111111111' }],
    ['a bad approval id', { verb: 'status', approval_id: '../../admin' }],
    ['null', null],
    ['an array', [PAY]],
  ])('refuses %s with INVALID_ARGUMENTS, without calling the approver', async (_what, args) => {
    const t = fakeTransport();
    expect(await handleRequest(new ApproverClient(t), args)).toEqual({ ok: false, code: 'INVALID_ARGUMENTS' });
    expect(t.calls).toEqual([]);
  });

  it('turns a client failure into its code and anything else into INTERNAL_ERROR', async () => {
    expect(await handleRequest(new ApproverClient(fakeTransport(json(429, {}))), PAY)).toEqual({ ok: false, code: 'TOO_MANY_PENDING' });
    const broken = { requestPay: () => Promise.reject(new TypeError('boom at /srv/keys/client.key')) } as unknown as ApproverClient;
    expect(await handleRequest(broken, PAY)).toEqual({ ok: false, code: 'INTERNAL_ERROR' });
  });
});
