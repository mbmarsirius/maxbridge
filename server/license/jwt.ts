// Ed25519 JWT verifier.
//
// Verifies lifetime-license JWTs issued by api.maxbridge.ai using the bundled
// public key at `server/license/pubkey.pem`. No external dependencies — only
// Node's built-in `crypto`. See spec §2 Type A for the payload shape and §8
// for the implementation order.
//
// The public key file may be an empty placeholder during early development
// (before the license server is deployed). In that case `verifyLifetimeJwt`
// returns { valid: false, reason: 'no_pubkey_configured' } so callers can
// treat it as a dev environment and fall back to other checks.

import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface JwtVerification {
  valid: boolean;
  payload?: Record<string, unknown>;
  reason?: string;
}

function moduleDir(): string {
  try {
    // ESM
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    // CJS fallback (shouldn't happen in this project, which is "type":"module")
    return __dirname;
  }
}

// TODO: Once the license server is live and has minted a real Ed25519 keypair,
// ship the public key in this file. Until then the file is an empty placeholder
// and verifyLifetimeJwt short-circuits with `no_pubkey_configured`.
function pubkeyPath(): string {
  // Allow override for tests — lets the suite point at a fixture keypair.
  const override = process.env.MAXBRIDGE_LICENSE_PUBKEY_PATH?.trim();
  if (override) return override;
  return join(moduleDir(), 'pubkey.pem');
}

let cachedKey: KeyObject | null | 'missing' = null;

function loadPubkey(): KeyObject | null {
  if (cachedKey === 'missing') return null;
  if (cachedKey) return cachedKey;
  const path = pubkeyPath();
  if (!existsSync(path)) {
    cachedKey = 'missing';
    return null;
  }
  let pem: string;
  try {
    pem = readFileSync(path, 'utf8');
  } catch (err) {
    console.error(`[maxbridge-license] Failed to read pubkey at ${path}: ${(err as Error).message}`);
    cachedKey = 'missing';
    return null;
  }
  if (pem.trim().length === 0) {
    // Placeholder — spec §8 allows this during the Sprint 2 development window.
    cachedKey = 'missing';
    return null;
  }
  try {
    const key = createPublicKey({ key: pem, format: 'pem' });
    cachedKey = key;
    return key;
  } catch (err) {
    console.error(`[maxbridge-license] Pubkey at ${path} is not a valid PEM: ${(err as Error).message}`);
    cachedKey = 'missing';
    return null;
  }
}

// Exported for tests so they can force a reload after installing a fixture key.
export function _resetPubkeyCache(): void {
  cachedKey = null;
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4;
  const padded = pad === 0 ? s : s + '='.repeat(4 - pad);
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export function verifyLifetimeJwt(token: string): JwtVerification {
  if (typeof token !== 'string' || token.length === 0) {
    return { valid: false, reason: 'empty_token' };
  }
  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, reason: 'malformed_jwt' };
  }
  const [headerB64, payloadB64, sigB64] = parts;

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(b64urlDecode(headerB64).toString('utf8'));
    payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8'));
  } catch (err) {
    return { valid: false, reason: `header_or_payload_not_json: ${(err as Error).message}` };
  }

  if (header.alg !== 'EdDSA') {
    return { valid: false, reason: `unsupported_alg:${String(header.alg)}` };
  }
  if (header.typ !== undefined && header.typ !== 'JWT') {
    return { valid: false, reason: `unsupported_typ:${String(header.typ)}` };
  }

  const key = loadPubkey();
  if (!key) {
    return { valid: false, reason: 'no_pubkey_configured' };
  }

  const signingInput = Buffer.from(`${headerB64}.${payloadB64}`, 'utf8');
  const signature = b64urlDecode(sigB64);

  let ok = false;
  try {
    // For Ed25519, Node's verify() takes algorithm=null and the KeyObject
    // carries the curve info.
    ok = verify(null, signingInput, key, signature);
  } catch (err) {
    return { valid: false, reason: `verify_threw:${(err as Error).message}` };
  }
  if (!ok) {
    return { valid: false, reason: 'bad_signature' };
  }

  // Minimal payload sanity. The gate enforces `updates_until` semantics — we
  // only check that required fields exist and have plausible types here.
  if (payload.plan !== 'lifetime') {
    return { valid: false, reason: `wrong_plan:${String(payload.plan)}` };
  }
  if (typeof payload.updates_until !== 'number') {
    return { valid: false, reason: 'missing_updates_until' };
  }
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    return { valid: false, reason: 'missing_sub' };
  }

  return { valid: true, payload };
}
