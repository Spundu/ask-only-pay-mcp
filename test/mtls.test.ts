// The approver's HTTP API over real mTLS, with the certificates from scripts/certs.mjs (SPEC.md §6, §8).

import https from 'node:https';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApproverServer } from '../src/approver/http.js';
import { Store, type Ask } from '../src/approver/store.js';
import { ApproverClient, ClientError } from '../src/client.js';
import { httpsTransport } from '../src/transport.js';
import { certFile } from './support/fixtures.js';

const FIELDS = { merchant: 'Example Shop', amount: '19.00', currency: 'EUR', card_handle: 'card-2', checkout_url: 'https://shop.example/c' };
const store = new Store();
const seen: Ask[] = [];
let port = 0;
let server: https.Server;

beforeAll(async () => {
  server = createApproverServer({ cert: certFile('good', 'approver.pem'), key: certFile('good', 'approver.key'), ca: certFile('good', 'client-ca.pem') }, store, (ask) => seen.push(ask));
  server.on('tlsClientError', () => {});
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const url = () => new URL(`https://localhost:${port}`);
const goodClient = () =>
  new ApproverClient(httpsTransport(url(), 'localhost', { cert: certFile('good', 'client.pem'), key: certFile('good', 'client.key'), ca: certFile('good', 'approver-ca.pem') }));

/** A raw request with any (or no) client certificate; resolves to the status, or the error code. */
function raw(opts: { cert?: Buffer; key?: Buffer; method?: string; path?: string; body?: string }): Promise<number | string> {
  return new Promise((resolve) => {
    const req = https.request(
      { host: '127.0.0.1', port, servername: 'localhost', ca: certFile('good', 'approver-ca.pem'), cert: opts.cert, key: opts.key, method: opts.method ?? 'GET', path: opts.path ?? '/v1/result/AAAAAAAAAA', agent: false },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      },
    );
    req.on('error', (err: NodeJS.ErrnoException) => resolve(err.code ?? err.name));
    req.end(opts.body);
  });
}
const good = { cert: certFile('good', 'client.pem'), key: certFile('good', 'client.key') };

describe('mTLS (SPEC.md §8)', () => {
  it('serves a client with a certificate from the client CA', async () => {
    expect(await raw(good)).toBe(404);
  });

  it('refuses a client with no certificate during the handshake', async () => {
    expect(await raw({})).not.toBeTypeOf('number');
  });

  it('refuses a client whose certificate is from another CA', async () => {
    expect(await raw({ cert: certFile('other', 'client.pem'), key: certFile('other', 'client.key') })).not.toBeTypeOf('number');
  });

  it('refuses the approver\'s own certificate as a client: the two CAs are separate', async () => {
    expect(await raw({ cert: certFile('good', 'approver.pem'), key: certFile('good', 'approver.key') })).not.toBeTypeOf('number');
  });

  it('makes the MCP side refuse an approver whose certificate is from another CA', async () => {
    const client = new ApproverClient(httpsTransport(url(), 'localhost', { ...good, ca: certFile('other', 'approver-ca.pem') }));
    await expect(client.status('AAAAAAAAAA')).rejects.toEqual(new ClientError('APPROVER_UNREACHABLE'));
  });

  it('makes the MCP side refuse an approver whose certificate is for another name', async () => {
    const client = new ApproverClient(httpsTransport(url(), 'approver.example', { ...good, ca: certFile('good', 'approver-ca.pem') }));
    await expect(client.status('AAAAAAAAAA')).rejects.toEqual(new ClientError('APPROVER_UNREACHABLE'));
  });
});

describe('the approver API (SPEC.md §6)', () => {
  it('takes an ask from the real client, shows it, and reports its state', async () => {
    const client = goodClient();
    const ack = await client.requestPay(FIELDS, crypto.randomUUID());
    expect(ack.state).toBe('pending');
    expect(seen.at(-1)?.id).toBe(ack.approval_id);
    expect(await client.status(ack.approval_id)).toEqual({ approval_id: ack.approval_id, state: 'pending' });
    store.decide(ack.approval_id, 'approve');
    expect(await client.status(ack.approval_id)).toMatchObject({ state: 'approved', ref: expect.stringMatching(/^demo-/) });
  });

  it('refuses a replayed request id with 409', async () => {
    const id = crypto.randomUUID();
    await goodClient().requestAccountCreate({ provider_url: 'https://service.example/signup' }, id);
    await expect(goodClient().requestAccountCreate({ provider_url: 'https://service.example/signup' }, id)).rejects.toEqual(new ClientError('APPROVER_REFUSED'));
  });

  it('checks every field itself, whatever the MCP side checked', async () => {
    const post = (body: unknown) => raw({ ...good, method: 'POST', path: '/v1/pay', body: JSON.stringify(body) });
    const ok = { ...FIELDS, request_id: crypto.randomUUID() };
    expect(await post({ ...ok, amount: '19.001' })).toBe(400);
    expect(await post({ ...ok, card_handle: '4111111111111111' })).toBe(400);
    expect(await post({ ...ok, checkout_url: 'http://shop.example/c' })).toBe(400);
    expect(await post({ ...ok, extra: 1 })).toBe(400);
    expect(await post({ ...ok, request_id: 'not-a-uuid' })).toBe(400);
    expect(await raw({ ...good, method: 'POST', path: '/v1/pay', body: '{not json' })).toBe(400);
    expect(await raw({ ...good, method: 'POST', path: '/v1/pay', body: 'x'.repeat(17 * 1024) })).toBe(413);
  });

  it('answers 413 to a body declared too large, without waiting for it', async () => {
    const started = Date.now();
    const status = await new Promise<number | string>((resolve) => {
      const req = https.request(
        { host: '127.0.0.1', port, servername: 'localhost', ca: certFile('good', 'approver-ca.pem'), ...good, method: 'POST', path: '/v1/pay', agent: false, headers: { 'content-length': String(300 * 1024 * 1024) } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
          req.destroy();
        },
      );
      req.on('error', (err: NodeJS.ErrnoException) => resolve(err.code ?? err.name));
      req.write('{'); // and never the rest
    });
    expect(status).toBe(413);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('stops reading a body as soon as it passes 16 KiB, and closes the connection', async () => {
    const result = await new Promise<{ status: number; sentAfter: number }>((resolve) => {
      let sent = 0;
      const req = https.request(
        { host: '127.0.0.1', port, servername: 'localhost', ca: certFile('good', 'approver-ca.pem'), ...good, method: 'POST', path: '/v1/pay', agent: false },
        (res) => {
          res.resume();
          res.on('end', () => resolve({ status: res.statusCode ?? 0, sentAfter: sent }));
        },
      );
      req.on('error', () => resolve({ status: -1, sentAfter: sent }));
      const chunk = Buffer.alloc(64 * 1024, 'x');
      const pump = () => {
        while (sent < 300 * 1024 * 1024 && !req.destroyed && req.write(chunk)) sent += chunk.length;
        if (sent < 300 * 1024 * 1024 && !req.destroyed) req.once('drain', () => ((sent += chunk.length), pump()));
      };
      pump();
    });
    expect([413, -1]).toContain(result.status);
    expect(result.sentAfter).toBeLessThan(64 * 1024 * 1024);
  });

  it('has no way to approve, cancel or change an ask over HTTP', async () => {
    for (const [method, path] of [
      ['POST', '/v1/approve'],
      ['POST', '/v1/result/AAAAAAAAAA'],
      ['PUT', '/v1/pay'],
      ['DELETE', '/v1/result/AAAAAAAAAA'],
      ['GET', '/v1/pay'],
      ['GET', '/v1/result/../approve'],
    ] as const) {
      expect(await raw({ ...good, method, path, body: '{}' })).toBe(404);
    }
  });
});
