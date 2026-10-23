import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/config.js';
import { certPath } from './support/fixtures.js';

const full = () => ({
  ASK_ONLY_PAY_URL: 'https://localhost:8443',
  ASK_ONLY_PAY_CLIENT_CERT: certPath('good', 'client.pem'),
  ASK_ONLY_PAY_CLIENT_KEY: certPath('good', 'client.key'),
  ASK_ONLY_PAY_CA: certPath('good', 'approver-ca.pem'),
});

const reason = (env: Record<string, string>) => {
  const r = resolveConfig(env);
  return r.ok ? 'ok' : r.reason;
};

describe('start-up configuration (SPEC.md §2.6, §5)', () => {
  it('accepts a full configuration', () => {
    expect(reason(full())).toBe('ok');
  });

  it.each(['ASK_ONLY_PAY_URL', 'ASK_ONLY_PAY_CLIENT_CERT', 'ASK_ONLY_PAY_CLIENT_KEY', 'ASK_ONLY_PAY_CA'])('refuses to start without %s', (name) => {
    const env: Record<string, string> = full();
    delete env[name];
    expect(reason(env)).toContain(name);
  });

  it.each(['http://localhost:8443', 'https://u:p@localhost:8443', 'https://localhost:8443/api', 'https://localhost:8443?x=1', 'localhost:8443'])(
    'refuses the URL %j',
    (url) => {
      expect(reason({ ...full(), ASK_ONLY_PAY_URL: url })).toMatch(/^ASK_ONLY_PAY_URL must be/);
    },
  );

  it('refuses an unreadable file, naming the variable and the error but never the path', () => {
    const missing = path.join(path.dirname(certPath('good', 'client.key')), 'secret-folder', 'nope.key');
    const r = reason({ ...full(), ASK_ONLY_PAY_CLIENT_KEY: missing });
    expect(r).toBe('cannot read the file named by ASK_ONLY_PAY_CLIENT_KEY (ENOENT)');
    expect(r).not.toContain('secret-folder');
  });

  it('refuses readable files that are not valid TLS material, without printing them', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ask-only-pay-bad-'));
    try {
      const empty = path.join(dir, 'empty.pem');
      writeFileSync(empty, '');
      expect(reason({ ...full(), ASK_ONLY_PAY_CLIENT_KEY: empty })).toMatch(/^the certificate, key or CA is not valid PEM.*\(ERR_OSSL_/);
      // A CA file of junk would silently trust nothing.
      const junk = path.join(dir, 'junk.pem');
      writeFileSync(junk, 'secret-looking junk');
      const r = reason({ ...full(), ASK_ONLY_PAY_CA: junk });
      expect(r).toMatch(/^the certificate, key or CA is not valid PEM/);
      expect(r).not.toContain('secret-looking');
      // A certificate that is not a CA.
      expect(reason({ ...full(), ASK_ONLY_PAY_CA: certPath('good', 'approver.pem') })).toBe('the CA file holds a certificate that is not a CA');
      // A key that does not belong to the certificate.
      expect(reason({ ...full(), ASK_ONLY_PAY_CLIENT_KEY: certPath('other', 'client.key') })).toMatch(/^the certificate, key or CA is not valid PEM, or the key does not belong/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('has no switch to turn mTLS off', () => {
    const env: Record<string, string> = { ...full(), ASK_ONLY_PAY_INSECURE: '1' };
    delete env.ASK_ONLY_PAY_CA;
    expect(reason(env)).toContain('ASK_ONLY_PAY_CA is not set');
  });
});
