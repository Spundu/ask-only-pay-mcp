#!/usr/bin/env node
// ask-only-pay-mcp: the stdio entry point. stdout carries the protocol and nothing else; diagnostics go to
// stderr, and never a path, an argument or an approver's answer.

import process from 'node:process';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { ApproverClient } from './client.js';
import { resolveConfig } from './config.js';
import { NAME, VERSION, createServer } from './server.js';

process.stderr.on('error', () => {});

const config = resolveConfig(process.env);
if (!config.ok) {
  // Fail closed (SPEC.md §2.6): a server that answers "broken" to every call teaches the agent that the
  // approver is unreliable, which is the wrong lesson about the one thing between it and the money.
  process.stderr.write(`${NAME}: refusing to start: ${config.reason}\n`);
  process.exit(2);
}

const client = new ApproverClient(config.transport);
const handle = serveStdio(() => createServer(client), { onerror: (err) => process.stderr.write(`${NAME}: transport error (${err.name})\n`) });
process.stderr.write(`${NAME} ${VERSION} (Node.js ${process.version}) on stdio, approver at ${config.url.host}\n`);

const stop = () => void handle.close().finally(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
// When the host closes stdin, exit after a short grace for the last answers.
const exitSoon = () => setTimeout(() => process.exit(0), 1000).unref();
process.stdin.once('end', exitSoon);
process.stdin.once('close', exitSoon);
