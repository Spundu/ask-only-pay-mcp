// End to end (SPEC.md §8): the built approver and the built MCP server run as real processes, an MCP client
// asks, and the test types on the approver's console as a person would.

import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PAY, REPO, certPath } from './support/fixtures.js';

const MCP = path.join(REPO, 'dist', 'index.js');
const APPROVER = path.join(REPO, 'dist', 'approver', 'main.js');

let approver: ChildProcessWithoutNullStreams;
let console_ = '';
let client: Client;

/** Waits until the approver's console has printed text matching the pattern, and returns the match. */
async function waitFor(pattern: RegExp, from = 0): Promise<RegExpExecArray> {
  for (let i = 0; i < 200; i++) {
    const m = pattern.exec(console_.slice(from));
    if (m) return m;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`approver never printed ${pattern}; it printed:\n${console_}`);
}

type Text = { content: Array<{ type: string; text: string }>; isError?: boolean; structuredContent?: unknown };
async function call(args: unknown): Promise<{ value: Record<string, unknown>; isError: boolean }> {
  const r = (await client.callTool({ name: 'request', arguments: args as Record<string, unknown> })) as Text;
  return { value: JSON.parse(r.content[0]!.text) as Record<string, unknown>, isError: r.isError === true };
}

beforeAll(async () => {
  approver = spawn(process.execPath, [APPROVER], {
    env: {
      ...getDefaultEnvironment(),
      ASK_ONLY_PAY_APPROVER_CERT: certPath('good', 'approver.pem'),
      ASK_ONLY_PAY_APPROVER_KEY: certPath('good', 'approver.key'),
      ASK_ONLY_PAY_APPROVER_CA: certPath('good', 'client-ca.pem'),
      ASK_ONLY_PAY_APPROVER_PORT: '0',
    },
  });
  approver.stdout.on('data', (d: Buffer) => (console_ += d.toString('utf8')));
  approver.stderr.on('data', (d: Buffer) => (console_ += d.toString('utf8')));
  const port = (await waitFor(/listening on https:\/\/127\.0\.0\.1:(\d+)/))[1];

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP],
    env: {
      ...getDefaultEnvironment(),
      ASK_ONLY_PAY_URL: `https://localhost:${port}`,
      ASK_ONLY_PAY_CLIENT_CERT: certPath('good', 'client.pem'),
      ASK_ONLY_PAY_CLIENT_KEY: certPath('good', 'client.key'),
      ASK_ONLY_PAY_CA: certPath('good', 'approver-ca.pem'),
    },
    stderr: 'pipe',
  });
  client = new Client({ name: 'ask-only-pay-e2e', version: '1.0.0' });
  await client.connect(transport);
});

afterAll(async () => {
  await client?.close();
  approver?.kill();
});

describe('end to end', () => {
  it('advertises exactly one tool, which does not claim to be read-only', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['request']);
    expect(tools[0]!.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: true });
    expect(tools[0]!.inputSchema).toMatchObject({ type: 'object', required: ['verb'] });
  });

  it('asks to pay; the person approves on the console; status reads approved', async () => {
    const mark = console_.length;
    const asked = await call({ ...PAY, reason: 'renew the domain' });
    expect(asked.isError).toBe(false);
    expect(Object.keys(asked.value).sort()).toEqual(['approval_id', 'expires_at', 'state']);
    const id = asked.value.approval_id as string;

    // The recap is on the approver's console, and only there.
    await waitFor(new RegExp(`\\[ask ${id}\\] PAY 19\\.00 EUR[\\s\\S]*agent's reason \\(unchecked\\): renew the domain`), mark);
    expect(await call({ verb: 'status', approval_id: id })).toEqual({ value: { approval_id: id, state: 'pending' }, isError: false });

    approver.stdin.write(`approve ${id}\n`);
    await waitFor(new RegExp(`${id}: approved`), mark);
    const status = await call({ verb: 'status', approval_id: id });
    expect(status.value).toMatchObject({ approval_id: id, state: 'approved', ref: expect.stringMatching(/^demo-[0-9a-f]{8}$/) });
  });

  it('asks to create an account; the person denies it', async () => {
    const mark = console_.length;
    const asked = await call({ verb: 'account_create', provider_url: 'https://service.example/signup', identity_handle: 'work' });
    const id = asked.value.approval_id as string;
    await waitFor(new RegExp(`\\[ask ${id}\\] CREATE AN ACCOUNT[\\s\\S]*identity:  work`), mark);
    approver.stdin.write(`deny ${id}\n`);
    await waitFor(new RegExp(`${id}: denied`), mark);
    expect((await call({ verb: 'status', approval_id: id })).value).toEqual({ approval_id: id, state: 'denied' });
  });

  it('answers a bad call with the code INVALID_ARGUMENTS only, never the SDK\'s message', async () => {
    const r = await call({ ...PAY, amount: 19, request_id: 'mine' });
    expect(r).toEqual({ value: { error: 'INVALID_ARGUMENTS' }, isError: true });
  });

  it('answers an unknown id with NOT_FOUND', async () => {
    expect(await call({ verb: 'status', approval_id: 'AAAAAAAAAA' })).toEqual({ value: { error: 'NOT_FOUND' }, isError: true });
  });
});

describe('start-up', () => {
  it('the MCP server refuses to start without its configuration: exit 2, the reason, no path', () => {
    const secret = path.join(REPO, 'no-such-dir', 'client.key');
    const r = spawnSync(process.execPath, [MCP], {
      env: { ...getDefaultEnvironment(), ASK_ONLY_PAY_URL: 'https://localhost:1', ASK_ONLY_PAY_CLIENT_CERT: secret, ASK_ONLY_PAY_CLIENT_KEY: secret, ASK_ONLY_PAY_CA: secret },
      input: '',
      encoding: 'utf8',
    });
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('refusing to start: cannot read the file named by ASK_ONLY_PAY_CLIENT_CERT (ENOENT)');
    expect(r.stderr).not.toContain('no-such-dir');
  });

  it('the approver refuses to start without its certificates', () => {
    const r = spawnSync(process.execPath, [APPROVER], { env: getDefaultEnvironment(), input: '', encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('refusing to start: ASK_ONLY_PAY_APPROVER_CERT is not set');
  });
});
