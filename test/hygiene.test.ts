// Repository hygiene: no hidden characters in code, and no private names or machine paths anywhere.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO } from './support/fixtures.js';

const SKIP = new Set(['node_modules', 'dist', '.git', 'coverage', 'certs']);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name) || name === 'package-lock.json') return [];
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

const all = files(REPO);
const rel = (p: string) => path.relative(REPO, p).replaceAll('\\', '/');

describe('hygiene', () => {
  it('has no control, bidi or zero-width characters in code (write them as \\u{…} escapes)', () => {
    const code = all.filter((p) => /\.(ts|mts|mjs|js|json|yml)$/.test(p));
    expect(code.length).toBeGreaterThan(10);
    // eslint-disable-next-line no-control-regex
    const hidden = /[\u{0}-\u{8}\u{b}-\u{c}\u{e}-\u{1f}\u{7f}-\u{9f}\u{ad}\u{200b}-\u{200f}\u{2028}-\u{202e}\u{2060}-\u{206f}\u{feff}]/u;
    expect(code.filter((p) => hidden.test(readFileSync(p, 'utf8'))).map(rel)).toEqual([]);
  });

  it('names no private project, person or machine', () => {
    // The private words are kept as SHA-256 hashes, so this test does not name them either.
    const banned = new Set([
      'dda820158d142a0b73380cd3efa9ff7d9fa11336e9ba4b3693098964537d61a3',
      '795b104abe3e4134960ca245ded0e617f162c751209347b7f003bc35e062f43e',
      '42bda76ffe7cdbda57c5a588398717abc50e6da7c8ed430e66fdfb99f4563f65',
      'bbbf7a6412d6d3e8244ac1fda5e35a20037acee661288cb95b7b18cf469980aa',
      '07d046d5fac12b3f82daf5035b9aae86db5adc8275ebfbf05ec83005a4a8ba3e',
    ]);
    const paths = /[a-z]:\\users\\|\/mnt\/c\/|\/home\/[a-z]+\//i;
    const hits = all.filter((p) => {
      const text = readFileSync(p, 'utf8');
      const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
      return paths.test(text) || words.some((w) => banned.has(createHash('sha256').update(w).digest('hex')));
    });
    expect(hits.map(rel)).toEqual([]);
  });
});
