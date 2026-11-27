/**
 * Cryptographic Pilot Access Gate (`web/auth-gate.js`)
 *
 * Verifies the user-entered pilot passcode against `LE_CONFIG.ACCESS_GATE` using
 * 120,000-iteration PBKDF2-HMAC-SHA256 in the browser's Web Crypto API (`crypto.subtle`),
 * with constant-time comparison and progressive brute-force throttling.
 *
 * Security Guarantees:
 * - Plaintext passcode is NEVER stored in repository files, URLs, cookies, `localStorage`, or `sessionStorage`.
 * - Held strictly in private module closure RAM for the active tab and wiped immediately on `lockStudioSession()` or tab close.
 */

import { LE_CONFIG } from './config.js';

let unlockedPasscodeInRam = '';
let failedAttempts = 0;

function hexToBytes(hex) {
  const clean = String(hex || '').trim();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function constantTimeHexEqual(aHex, bHex) {
  const a = String(aHex || '').toLowerCase();
  const b = String(bHex || '').toLowerCase();
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function isGateEnabled() {
  return Boolean(
    LE_CONFIG.ACCESS_GATE?.ENABLED &&
      LE_CONFIG.ACCESS_GATE?.SALT_HEX &&
      LE_CONFIG.ACCESS_GATE?.HASH_HEX,
  );
}

export function isStudioUnlocked() {
  if (!isGateEnabled()) return true;
  return Boolean(unlockedPasscodeInRam);
}

export function getUnlockedPasscode() {
  return unlockedPasscodeInRam;
}

export function lockStudioSession() {
  unlockedPasscodeInRam = '';
}

export async function verifyPilotPasscode(rawInput) {
  if (!isGateEnabled()) {
    unlockedPasscodeInRam = 'open';
    return { ok: true };
  }

  const candidate = String(rawInput || '').trim();
  if (!candidate) {
    return { ok: false, error: 'Please enter the pilot access passcode.' };
  }

  // Progressive brute-force delay after 2 failed attempts
  if (failedAttempts >= 2) {
    const delayMs = Math.min(6000, (failedAttempts - 1) * 1200);
    await new Promise((res) => setTimeout(res, delayMs));
  }

  const encoder = new TextEncoder();
  const saltBytes = hexToBytes(LE_CONFIG.ACCESS_GATE.SALT_HEX);
  const iterations = Number(LE_CONFIG.ACCESS_GATE.ITERATIONS || 120000);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(candidate),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  );

  const candidateHex = bytesToHex(new Uint8Array(derivedBits));
  const matched = constantTimeHexEqual(candidateHex, LE_CONFIG.ACCESS_GATE.HASH_HEX);

  if (!matched) {
    failedAttempts += 1;
    return {
      ok: false,
      error:
        failedAttempts >= 3
          ? `Incorrect passcode (attempt ${failedAttempts}). Please check with the project owner.`
          : 'Incorrect pilot access passcode. Please try again.',
    };
  }

  failedAttempts = 0;
  unlockedPasscodeInRam = candidate;
  return { ok: true };
}
