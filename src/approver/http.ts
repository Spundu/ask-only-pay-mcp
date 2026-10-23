// The approver's HTTP API (SPEC.md §6). mTLS only: a client without a certificate from the configured CA
// is refused during the TLS handshake. There is no endpoint that approves, cancels or changes an ask.

import https from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import type { TLSSocket } from 'node:tls';
import { z } from 'zod';
import { APPROVAL_ID, accountFields, payFields } from '../rules.js';
import type { Ask, AskBody, Store } from './store.js';

export interface ApproverTls {
  cert: Buffer;
  key: Buffer;
  /** The CA whose client certificates may connect. */
  ca: Buffer;
}

const MAX_BODY_BYTES = 16 * 1024;
/**
 * Connections from one address that have not yet finished their handshake, counted from when the TCP
 * connection is accepted. One MCP server needs one at a time; a host elsewhere that opens many cannot crowd
 * out the real client. A process on the approver's own host shares its address and can (SPEC.md §6).
 */
const MAX_PER_ADDRESS = 8;
/** All open connections: a cap so idle ones from many addresses cannot pile up. */
const MAX_CONNECTIONS = 1024;
const requestId = z.string().uuid();
// The approver checks every field itself: it never trusts the MCP server's checks.
const PayBody = z.strictObject({ ...payFields, request_id: requestId });
const AccountBody = z.strictObject({ ...accountFields, request_id: requestId });
const RESULT_PATH = /^\/v1\/result\/([^/]+)$/;

export function createApproverServer(tls: ApproverTls, store: Store, onAsk: (ask: Ask) => void): https.Server {
  const server = https.createServer(
    // A connection that never finishes its handshake is dropped after 5 s, not Node's default 120 s.
    { cert: tls.cert, key: tls.key, ca: tls.ca, requestCert: true, rejectUnauthorized: true, minVersion: 'TLSv1.2', handshakeTimeout: 5_000 },
    (req, res) => {
      void route(req, res, store, onAsk).catch(() => send(res, 500, { error: 'internal' }));
    },
  );
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.maxConnections = MAX_CONNECTIONS;
  // Connections still in their handshake, by address. A connection leaves the count when its client proves
  // its certificate (secureConnection) or when it closes, whichever is first.
  const handshaking = new Map<string, Set<string>>();
  const settle = (address: string, key: string) => {
    const keys = handshaking.get(address);
    if (keys?.delete(key) && keys.size === 0) handshaking.delete(address);
  };
  server.on('connection', (socket: Socket) => {
    const address = socket.remoteAddress ?? 'unknown';
    const key = `${socket.remotePort ?? 0}`;
    const keys = handshaking.get(address) ?? new Set<string>();
    if (keys.size >= MAX_PER_ADDRESS) {
      socket.destroy();
      return;
    }
    keys.add(key);
    handshaking.set(address, keys);
    socket.once('close', () => settle(address, key));
  });
  server.on('secureConnection', (socket: TLSSocket) => settle(socket.remoteAddress ?? 'unknown', `${socket.remotePort ?? 0}`));
  return server;
}

async function route(req: IncomingMessage, res: ServerResponse, store: Store, onAsk: (ask: Ask) => void): Promise<void> {
  // rejectUnauthorized already refused the handshake; this is the second lock on the same door.
  if (!(req.socket as TLSSocket).authorized) return send(res, 401, { error: 'unauthorized' });
  const path = (req.url ?? '').split('?')[0] ?? '';

  if (req.method === 'POST' && (path === '/v1/pay' || path === '/v1/account/create')) {
    const raw = await readBody(req);
    if (raw === 'too_large') return tooLarge(res);
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return send(res, 400, { error: 'invalid_request' });
    }
    const parsed = (path === '/v1/pay' ? PayBody : AccountBody).safeParse(json);
    if (!parsed.success) return send(res, 400, { error: 'invalid_request' });
    const { request_id, ...fields } = parsed.data;
    const body = (path === '/v1/pay' ? { kind: 'pay', fields } : { kind: 'account_create', fields }) as AskBody;
    const added = store.add(body, request_id);
    if (!added.ok) return send(res, added.error === 'duplicate_request' ? 409 : 429, { error: added.error });
    onAsk(added.ask);
    return send(res, 201, { approval_id: added.ask.id, state: added.ask.state, expires_at: added.ask.expiresAt });
  }

  const match = RESULT_PATH.exec(path);
  if (req.method === 'GET' && match) {
    const id = match[1] ?? '';
    const ask = APPROVAL_ID.test(id) ? store.get(id) : undefined;
    if (!ask) return send(res, 404, { error: 'not_found' });
    return send(res, 200, { approval_id: ask.id, state: ask.state, ref: ask.ref ?? null, error_code: null });
  }

  return send(res, 404, { error: 'not_found' });
}

/** The body, or 'too_large' as soon as it passes the limit: the rest is never read (SPEC.md §6). */
function readBody(req: IncomingMessage): Promise<string | 'too_large'> {
  const declared = Number(req.headers['content-length']);
  if (declared > MAX_BODY_BYTES) return Promise.resolve('too_large');
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.pause();
        resolve('too_large');
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Answers 413 and closes the connection, so the client cannot keep sending. */
function tooLarge(res: ServerResponse): void {
  res.setHeader('connection', 'close');
  send(res, 413, { error: 'too_large' });
  res.on('finish', () => res.socket?.destroy());
}

function send(res: ServerResponse, status: number, body: object): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text), 'cache-control': 'no-store' });
  res.end(text);
}
