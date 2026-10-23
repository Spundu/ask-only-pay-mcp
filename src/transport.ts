// HTTPS with mutual TLS: this side shows its client certificate, and accepts the approver only with a
// certificate from the configured CA, for the expected name. There is no plain-HTTP fallback (SPEC.md §5).

import https from 'node:https';
import type { Reply, Transport } from './client.js';

export interface TlsMaterial {
  cert: Buffer;
  key: Buffer;
  ca: Buffer;
}

export const TIMEOUT_MS = 10_000;
/** The approver's answers are a few hundred bytes; anything far larger is not one. */
const MAX_REPLY_BYTES = 64 * 1024;

export function httpsTransport(baseUrl: URL, servername: string, tls: TlsMaterial): Transport {
  const call = (method: 'GET' | 'POST', path: string, body?: unknown): Promise<Reply> =>
    new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = https.request(
        {
          protocol: 'https:',
          hostname: baseUrl.hostname.replace(/^\[|\]$/g, ''),
          port: baseUrl.port || 443,
          path,
          method,
          servername,
          cert: tls.cert,
          key: tls.key,
          ca: tls.ca,
          rejectUnauthorized: true,
          agent: false,
          timeout: TIMEOUT_MS,
          headers: {
            accept: 'application/json',
            ...(payload === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_REPLY_BYTES) {
              req.destroy(new Error('reply too large'));
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
          res.on('error', reject);
        },
      );
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', reject);
      req.end(payload);
    });

  return {
    post: (path, body) => call('POST', path, body),
    get: (path) => call('GET', path),
  };
}
