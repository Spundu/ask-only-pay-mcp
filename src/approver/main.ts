#!/usr/bin/env node
// ask-only-pay-approver: the reference approver. It serves the HTTP API over mTLS and shows each ask's
// recap on this terminal, where a person types `approve ID` or `deny ID`. It never moves money.

import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import process from 'node:process';
import { createInterface } from 'node:readline';
import { invalidTls } from '../config.js';
import { command, forTerminal } from './console.js';
import { createApproverServer } from './http.js';
import { recap } from './recap.js';
import { Store, systemClock } from './store.js';

const NAME = 'ask-only-pay-approver';

function fail(reason: string): never {
  process.stderr.write(`${NAME}: refusing to start: ${reason}\n`);
  process.exit(2);
}

function file(name: string): Buffer {
  const path = process.env[name]?.trim();
  if (!path) fail(`${name} is not set`);
  try {
    return readFileSync(path);
  } catch (err) {
    fail(`cannot read the file named by ${name} (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})`);
  }
}

const tls = { cert: file('ASK_ONLY_PAY_APPROVER_CERT'), key: file('ASK_ONLY_PAY_APPROVER_KEY'), ca: file('ASK_ONLY_PAY_APPROVER_CA') };
const badTls = invalidTls(tls);
if (badTls) fail(badTls);
const portText = process.env.ASK_ONLY_PAY_APPROVER_PORT?.trim() || '8443';
if (!/^\d{1,5}$/.test(portText) || Number(portText) > 65535) fail('ASK_ONLY_PAY_APPROVER_PORT must be a port number');
const host = process.env.ASK_ONLY_PAY_APPROVER_HOST?.trim() || '127.0.0.1';

const store = new Store();
// A recap only on a terminal wide enough for it (console.ts forTerminal); a pipe gets it as is.
const print = (text: string) => process.stdout.write(`${forTerminal(text, process.stdout.isTTY ? process.stdout.columns : undefined)}\n`);
const server = createApproverServer(tls, store, (ask) => print(`\n${recap(ask, systemClock())}\n`));
server.on('tlsClientError', () => {}); // a refused handshake is the point, not an error to report
server.listen(Number(portText), host, () => {
  const { port } = server.address() as AddressInfo;
  print(`${NAME}: listening on https://${host.includes(':') ? `[${host}]` : host}:${port} (mTLS). No money is ever moved.`);
  print('commands: approve ID | deny ID | list | help');
});
server.on('error', (err) => fail(`cannot listen (${(err as NodeJS.ErrnoException).code ?? err.name})`));

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', (line) => {
  const out = command(line, store);
  if (out) print(out);
});
const stop = () => server.close(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
