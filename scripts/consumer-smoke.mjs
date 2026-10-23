// Consumer smoke test (CI): run from an empty project where the PACKED tarball is installed. It uses the
// installed bins only: writes certificates, starts the approver, connects an MCP client to the MCP server,
// asks to pay, approves on the approver's console, and reads the decision.

import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';

const bin = (name) => path.join(process.cwd(), 'node_modules', 'ask-only-pay-mcp', ...name.split('/'));
const certs = mkdtempSync(path.join(tmpdir(), 'ask-only-pay-smoke-'));
execFileSync(process.execPath, [bin('scripts/certs.mjs'), certs], { stdio: 'inherit' });
const at = (name) => path.join(certs, name);

let out = '';
const approver = spawn(process.execPath, [bin('dist/approver/main.js')], {
  env: { ...getDefaultEnvironment(), ASK_ONLY_PAY_APPROVER_CERT: at('approver.pem'), ASK_ONLY_PAY_APPROVER_KEY: at('approver.key'), ASK_ONLY_PAY_APPROVER_CA: at('client-ca.pem'), ASK_ONLY_PAY_APPROVER_PORT: '0' },
});
approver.stdout.on('data', (d) => (out += d));
approver.stderr.on('data', (d) => (out += d));

async function waitFor(pattern) {
  for (let i = 0; i < 400; i++) {
    const m = pattern.exec(out);
    if (m) return m;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`approver never printed ${pattern}:\n${out}`);
}

let client;
try {
  const port = (await waitFor(/listening on https:\/\/127\.0\.0\.1:(\d+)/))[1];
  client = new Client({ name: 'consumer-smoke', version: '1.0.0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [bin('dist/index.js')],
    env: { ...getDefaultEnvironment(), ASK_ONLY_PAY_URL: `https://localhost:${port}`, ASK_ONLY_PAY_CLIENT_CERT: at('client.pem'), ASK_ONLY_PAY_CLIENT_KEY: at('client.key'), ASK_ONLY_PAY_CA: at('approver-ca.pem') },
  }));
  const ask = async (args) => JSON.parse((await client.callTool({ name: 'request', arguments: args })).content[0].text);
  const { approval_id: id } = await ask({ verb: 'pay', merchant: 'Example Shop', amount: '19.00', currency: 'EUR', card_handle: 'card-2', checkout_url: 'https://shop.example/c' });
  await waitFor(new RegExp(`\\[ask ${id}\\] PAY 19\\.00 EUR`));
  approver.stdin.write(`approve ${id}\n`);
  await waitFor(new RegExp(`${id}: approved`));
  const status = await ask({ verb: 'status', approval_id: id });
  if (status.state !== 'approved' || !/^demo-[0-9a-f]{8}$/.test(status.ref)) throw new Error(`unexpected status ${JSON.stringify(status)}`);
  console.log(`consumer smoke test passed: ${id} approved (${status.ref})`);
} finally {
  await client?.close();
  approver.kill();
}
