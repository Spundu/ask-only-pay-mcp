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

  it('has no switch to turn mTLS off', () => {
    const env: Record<string, string> = { ...full(), ASK_ONLY_PAY_INSECURE: '1' };
    delete env.ASK_ONLY_PAY_CA;
    expect(reason(env)).toContain('ASK_ONLY_PAY_CA is not set');
  });
});
