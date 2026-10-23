// HTTPS with mutual TLS: this side shows its client certificate, and accepts the approver only with a
// certificate from the configured CA, for the expected name. There is no plain-HTTP fallback (SPEC.md §5).

import https from 'node:https';
import { isIP } from 'node:net';
import { checkServerIdentity, type PeerCertificate } from 'node:tls';
import type { Reply, Transport } from './client.js';

export interface TlsMaterial {
  cert: Buffer;
  key: Buffer;
  ca: Buffer;
}

export const TIMEOUT_MS = 10_000;
/** The approver's answers are a few hundred bytes; anything far larger is not one. */
const MAX_REPLY_BYTES = 64 * 1024;

export function httpsTransport(baseUrl: URL, servername: string, tls: TlsMaterial, timeoutMs = TIMEOUT_MS): Transport {
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
          // TLS forbids an IP address as the server name sent (SNI), so it is sent only for a host name; the
          // certificate is always checked against `servername`, IP or name, not against the URL's host.
          ...(isIP(servername) ? {} : { servername }),
          checkServerIdentity: (_host: string, cert: PeerCertificate) => checkServerIdentity(servername, cert),
          cert: tls.cert,
          key: tls.key,
          ca: tls.ca,
          rejectUnauthorized: true,
          agent: false,
          timeout: timeoutMs,
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
      // `timeout` alone is an idle timeout: an approver sending a byte every few seconds would never trip it.
      // The deadline covers the whole call (SPEC.md §4).
      const deadline = setTimeout(() => req.destroy(new Error('deadline')), timeoutMs);
      req.on('close', () => clearTimeout(deadline));
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', reject);
      req.end(payload);
    });

  return {
    post: (path, body) => call('POST', path, body),
    get: (path) => call('GET', path),
  };
}
