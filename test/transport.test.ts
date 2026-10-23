// The MCP side's limits on a misbehaving approver (SPEC.md §4): a whole-call deadline and a reply-size cap.

import https from 'node:https';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { httpsTransport } from '../src/transport.js';
import { certFile } from './support/fixtures.js';

let server: https.Server;
let port = 0;
const timers = new Set<NodeJS.Timeout>();

beforeAll(async () => {
  server = https.createServer(
    { cert: certFile('good', 'approver.pem'), key: certFile('good', 'approver.key'), ca: certFile('good', 'client-ca.pem'), requestCert: true, rejectUnauthorized: true },
    (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      if (req.url === '/drip') {
        // One byte every 100 ms: never idle long enough to trip an idle timeout.
        const t = setInterval(() => res.write(' '), 100);
        timers.add(t);
        res.on('close', () => clearInterval(t));
      } else if (req.url === '/huge') {
        res.end(`"${'x'.repeat(70 * 1024)}"`);
      } else {
        res.end('{}');
      }
    },
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => {
  for (const t of timers) clearInterval(t);
  server.closeAllConnections();
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

const transport = (timeoutMs?: number) =>
  httpsTransport(new URL(`https://localhost:${port}`), 'localhost', { cert: certFile('good', 'client.pem'), key: certFile('good', 'client.key'), ca: certFile('good', 'approver-ca.pem') }, timeoutMs);

describe('transport limits', () => {
  it('answers a well-behaved approver', async () => {
    expect(await transport().get('/ok')).toEqual({ status: 200, body: '{}' });
  });

  it('gives up on an approver that drips bytes, at the whole-call deadline', async () => {
    const started = Date.now();
    await expect(transport(500).get('/drip')).rejects.toThrow('deadline');
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('gives up on a reply over 64 KiB', async () => {
    await expect(transport().get('/huge')).rejects.toThrow('reply too large');
  });

  it('checks the certificate against the server name given, even an IP address, not the URL host', async () => {
    const tlsGood = { cert: certFile('good', 'client.pem'), key: certFile('good', 'client.key'), ca: certFile('good', 'approver-ca.pem') };
    const url = new URL(`https://localhost:${port}`);
    await expect(httpsTransport(url, '10.9.9.9', tlsGood).get('/ok')).rejects.toThrow();
    await expect(httpsTransport(url, 'evil.test', tlsGood).get('/ok')).rejects.toThrow();
    expect((await httpsTransport(url, '127.0.0.1', tlsGood).get('/ok')).status).toBe(200);
  });

  it('reaches an approver by IP address, checking the certificate\'s IP entry', async () => {
    const t = httpsTransport(new URL(`https://127.0.0.1:${port}`), '127.0.0.1', { cert: certFile('good', 'client.pem'), key: certFile('good', 'client.key'), ca: certFile('good', 'approver-ca.pem') });
    expect((await t.get('/ok')).status).toBe(200);
  });
});
