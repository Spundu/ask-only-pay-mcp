#!/usr/bin/env node
// Writes fresh mTLS material for a local run into DIR (SPEC.md §5): two separate CAs, so the client's
// certificate can never pass as the approver's and the other way round. The CA keys are deleted once both
// certificates are signed, so nothing can mint another. Needs `openssl` on the PATH.
//
//   node scripts/certs.mjs DIR [--force]

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const [dir, flag] = process.argv.slice(2);
if (!dir) {
  process.stderr.write('usage: node scripts/certs.mjs DIR [--force]\n');
  process.exit(2);
}
if (existsSync(path.join(dir, 'client.key')) && flag !== '--force') {
  process.stderr.write(`${dir} already holds certificates; pass --force to replace them\n`);
  process.exit(2);
}
mkdirSync(dir, { recursive: true });
const at = (name) => path.join(dir, name);
const openssl = (...args) => execFileSync('openssl', args, { stdio: ['ignore', 'ignore', 'pipe'] });
const DAYS = '30';
const EC = ['-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes'];

function ca(name, cn) {
  openssl('req', '-x509', ...EC, '-keyout', at(`${name}.key`), '-out', at(`${name}.pem`), '-days', DAYS, '-subj', `/CN=${cn}`,
    '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign');
}

function leaf(name, caName, cn, ext) {
  writeFileSync(at(`${name}.ext`), ext);
  openssl('req', '-new', ...EC, '-keyout', at(`${name}.key`), '-out', at(`${name}.csr`), '-subj', `/CN=${cn}`);
  openssl('x509', '-req', '-in', at(`${name}.csr`), '-CA', at(`${caName}.pem`), '-CAkey', at(`${caName}.key`), '-CAcreateserial',
    '-out', at(`${name}.pem`), '-days', DAYS, '-extfile', at(`${name}.ext`));
  for (const temp of [`${name}.csr`, `${name}.ext`]) rmSync(at(temp), { force: true });
}

ca('approver-ca', 'ask-only-pay approver CA');
ca('client-ca', 'ask-only-pay client CA');
leaf('approver', 'approver-ca', 'localhost',
  'basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n');
leaf('client', 'client-ca', 'ask-only-pay-mcp', 'basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=clientAuth\n');
for (const temp of ['approver-ca.key', 'client-ca.key', 'approver-ca.srl', 'client-ca.srl']) rmSync(at(temp), { force: true });

process.stdout.write(`wrote to ${dir}:
  approver.pem, approver.key, client-ca.pem   for the approver
  client.pem, client.key, approver-ca.pem     for the MCP server
`);
