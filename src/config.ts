// The MCP server's start-up configuration, as a pure decision so the fail-closed rules are tested
// (SPEC.md §2.6, §5). Every refusal names the variable, never its value: the value is a path to a key.

import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createSecureContext } from 'node:tls';
import { httpsTransport } from './transport.js';
import type { Transport } from './client.js';

export type ConfigResult = { ok: true; transport: Transport; url: URL } | { ok: false; reason: string };

const FILES = ['ASK_ONLY_PAY_CLIENT_CERT', 'ASK_ONLY_PAY_CLIENT_KEY', 'ASK_ONLY_PAY_CA'] as const;

export function resolveConfig(env: NodeJS.ProcessEnv): ConfigResult {
  const raw = env.ASK_ONLY_PAY_URL?.trim();
  if (!raw) return { ok: false, reason: 'ASK_ONLY_PAY_URL is not set' };
  const url = baseUrl(raw);
  if (!url) return { ok: false, reason: 'ASK_ONLY_PAY_URL must be https://host[:port], with no path, query or user name' };

  const files: Partial<Record<(typeof FILES)[number], Buffer>> = {};
  for (const name of FILES) {
    const path = env[name]?.trim();
    if (!path) return { ok: false, reason: `${name} is not set (mTLS is required; there is no way to turn it off)` };
    try {
      files[name] = readFileSync(path);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? 'unknown error';
      return { ok: false, reason: `cannot read the file named by ${name} (${code})` };
    }
  }

  const material = { cert: files.ASK_ONLY_PAY_CLIENT_CERT!, key: files.ASK_ONLY_PAY_CLIENT_KEY!, ca: files.ASK_ONLY_PAY_CA! };
  const bad = invalidTls(material);
  if (bad) return { ok: false, reason: bad };
  const servername = env.ASK_ONLY_PAY_SERVERNAME?.trim() || url.hostname.replace(/^\[|\]$/g, '');
  return { ok: true, transport: httpsTransport(url, servername, material), url };
}

/**
 * Readable is not enough: an empty or broken PEM file would start a server whose every call fails. Loading
 * the material once here refuses it at start, with OpenSSL's reason code and never the file's content.
 */
export function invalidTls(material: { cert: Buffer; key: Buffer; ca: Buffer }): string | undefined {
  try {
    createSecureContext(material);
    // A CA file of junk is silently an empty trust list, so read it as a certificate too.
    if (!new X509Certificate(material.ca).ca) return 'the CA file holds a certificate that is not a CA';
    return undefined;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? 'unknown error';
    return `the certificate, key or CA is not valid PEM, or the key does not belong to the certificate (${code})`;
  }
}

function baseUrl(raw: string): URL | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  const bare = url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/';
  return bare && url.hostname ? url : undefined;
}
