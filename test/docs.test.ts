// The documents match the code: SPEC.md is whole, and every name the README and SPEC give exists.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ErrorCode } from '../src/tool.js';
import { REPO } from './support/fixtures.js';

const spec = readFileSync(path.join(REPO, 'SPEC.md'), 'utf8');
const readme = readFileSync(path.join(REPO, 'README.md'), 'utf8');
const source = ['src/config.ts', 'src/approver/main.ts'].map((p) => readFileSync(path.join(REPO, p), 'utf8')).join('\n');

describe('SPEC.md', () => {
  it('is whole: one title, sections 1 to 8 once each and in order', () => {
    expect(spec.match(/^# /gm)).toHaveLength(1);
    expect([...spec.matchAll(/^## (\d+)\. /gm)].map((m) => Number(m[1]))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('gives the handle rule in full', () => {
    expect(spec).toContain('`^[a-z0-9][a-z0-9_-]{0,31}$`');
  });

  it('lists exactly the error codes the tool can return', () => {
    const table = spec.slice(spec.indexOf('## 4.'), spec.indexOf('## 5.'));
    const codes = [...table.matchAll(/^\| `([A-Z_]+)` \|/gm)].map((m) => m[1]).sort();
    const all: ErrorCode[] = ['APPROVER_UNREACHABLE', 'APPROVER_REFUSED', 'APPROVER_RESPONSE_REJECTED', 'NOT_FOUND', 'TOO_MANY_PENDING', 'INVALID_ARGUMENTS', 'INTERNAL_ERROR'];
    expect(codes).toEqual([...all].sort());
  });
});

describe('README.md and SPEC.md name only real environment variables', () => {
  it.each([['README.md', readme], ['SPEC.md', spec]])('%s', (_name, text) => {
    const named = new Set([...text.matchAll(/ASK_ONLY_PAY_[A-Z_]+/g)].map((m) => m[0]));
    expect(named.size).toBeGreaterThan(5);
    for (const name of named) expect(source, name).toContain(name);
  });
});
