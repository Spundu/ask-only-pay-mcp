// Runs once before the tests: builds dist/ (the end-to-end tests start the built programs, as a host
// would) and writes two independent sets of certificates, `good` and `other`, with scripts/certs.mjs.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import type { TestProject } from 'vitest/node';

const REPO = path.resolve(import.meta.dirname, '..', '..');

declare module 'vitest' {
  export interface ProvidedContext {
    certDir: string;
  }
}

export default function setup(project: TestProject): () => void {
  execFileSync(process.execPath, [path.join(REPO, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', path.join(REPO, 'tsconfig.json')], { stdio: 'inherit' });
  const dir = mkdtempSync(path.join(tmpdir(), 'ask-only-pay-certs-'));
  for (const set of ['good', 'other']) {
    execFileSync(process.execPath, [path.join(REPO, 'scripts', 'certs.mjs'), path.join(dir, set)], { stdio: 'ignore' });
  }
  project.provide('certDir', dir);
  return () => rmSync(dir, { recursive: true, force: true });
}
