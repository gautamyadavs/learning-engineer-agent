#!/usr/bin/env node
/**
 * Updates `web/config.js` with a fresh 16-byte random salt and 120,000-iteration
 * PBKDF2-HMAC-SHA256 digest for the Pilot Access Gate — without ever storing
 * the plaintext passcode in source control.
 *
 * Usage:
 *   npm run set-passcode -- "YourNewPilotPasscode"
 */

import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(__dirname, '../web/config.js');

const rawPasscode = (process.argv[2] || '').trim();
if (!rawPasscode || rawPasscode.length < 6) {
  console.error('Usage: npm run set-passcode -- "<passcode-at-least-6-chars>"');
  process.exit(1);
}

const iterations = 120000;
const salt = randomBytes(16);
const derived = pbkdf2Sync(Buffer.from(rawPasscode, 'utf8'), salt, iterations, 32, 'sha256');

const saltHex = salt.toString('hex');
const hashHex = derived.toString('hex');

let content = readFileSync(configPath, 'utf8');
content = content
  .replace(/ITERATIONS:\s*\d+/, `ITERATIONS: ${iterations}`)
  .replace(/SALT_HEX:\s*'[^']*'/, `SALT_HEX: '${saltHex}'`)
  .replace(/HASH_HEX:\s*'[^']*'/, `HASH_HEX: '${hashHex}'`);

writeFileSync(configPath, content, 'utf8');
console.log('Updated web/config.js with new PBKDF2-SHA256 salt & hash (plaintext never stored).');
console.log('If using Cloudflare Worker proxy, sync the same passcode to your Worker secret:');
console.log('  cd proxy && npx wrangler secret put SHARED_ACCESS_CODE');
