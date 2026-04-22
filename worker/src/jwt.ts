// Ed25519-signed license JWTs.
//
// The Worker mints a signed JWT for every paid license and ships it to the
// customer embedded in their download. The Maxbridge client verifies offline
// using a bundled public key — no server round-trip required on the hot path.
//
// Claim shape:
//   iss       "maxbridge.ai"
//   aud       "maxbridge-client"
//   sub       customer email
//   jti       unique id (also used as KV key)
//   plan      "monthly" | "lifetime" | "trial"
//   iat       issued at (seconds)
//   exp       expiry (seconds) — for monthlies, set to +35d past issuance so
//             the client has up to a week of webhook-delivery slack before
//             the gate flips to subscription_lapsed.
//   updates_until  (lifetime only) seconds-since-epoch; client silently
//                  allows requests past this but marks `updates_frozen` in
//                  the status header.

import {
  SignJWT,
  jwtVerify,
  importPKCS8,
  importSPKI,
  type KeyLike,
} from 'jose';

export interface LicensePayload {
  iss: string;
  aud: string;
  sub: string;
  jti: string;
  plan: 'monthly' | 'lifetime' | 'trial';
  iat: number;
  exp: number;
  updates_until?: number;
}

const ALG = 'EdDSA';

// Cache imported keys so repeated mint/verify calls inside one Worker instance
// don't re-parse the same PEM. Keyed by the raw PEM string so tests that swap
// keys don't reuse the wrong one.
const privCache = new Map<string, KeyLike>();
const pubCache = new Map<string, KeyLike>();

async function getPrivateKey(pem: string): Promise<KeyLike> {
  const hit = privCache.get(pem);
  if (hit) return hit;
  const full = normalizePem(pem, 'PRIVATE KEY');
  const key = await importPKCS8(full, ALG);
  privCache.set(pem, key);
  return key;
}

async function getPublicKey(pem: string): Promise<KeyLike> {
  const hit = pubCache.get(pem);
  if (hit) return hit;
  const full = normalizePem(pem, 'PUBLIC KEY');
  const key = await importSPKI(full, ALG);
  pubCache.set(pem, key);
  return key;
}

/**
 * Some deploy paths store the PEM body as a single base64 line (no headers)
 * because multi-line secrets are awkward in `wrangler secret put`. This
 * reconstitutes a parseable PEM from either form.
 */
function normalizePem(raw: string, label: 'PRIVATE KEY' | 'PUBLIC KEY'): string {
  const trimmed = raw.trim();
  if (trimmed.includes('-----BEGIN')) return trimmed;
  // Bare base64 body → wrap with headers + 64-char line breaks.
  const body = trimmed.replace(/\s+/g, '');
  const lines: string[] = [];
  for (let i = 0; i < body.length; i += 64) {
    lines.push(body.slice(i, i + 64));
  }
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`;
}

export interface MintArgs {
  email: string;
  plan: 'monthly' | 'lifetime' | 'trial';
  jti: string;
  privateKeyPem: string;
  /**
   * How long after `iat` the token is valid. Defaults:
   *   monthly  → 35 days (webhook slack)
   *   trial    → 24 hours
   *   lifetime → 100 years (effectively forever; ignored by gate, which uses
   *              updates_until for "update window" logic instead)
   */
  ttlSeconds?: number;
  /**
   * For lifetime plans only: the update-subscription end timestamp. Client
   * silently allows requests past it but marks `updates_frozen`.
   */
  updatesUntil?: number;
  now?: Date;
}

export async function mintLicense(args: MintArgs): Promise<string> {
  const now = args.now ?? new Date();
  const iat = Math.floor(now.getTime() / 1000);
  const ttl = args.ttlSeconds ?? defaultTtl(args.plan);
  const exp = iat + ttl;
  const key = await getPrivateKey(args.privateKeyPem);
  const jwt = await new SignJWT({
    plan: args.plan,
    ...(args.plan === 'lifetime' && args.updatesUntil
      ? { updates_until: args.updatesUntil }
      : {}),
  })
    .setProtectedHeader({ alg: ALG, typ: 'JWT' })
    .setIssuer('maxbridge.ai')
    .setAudience('maxbridge-client')
    .setSubject(args.email)
    .setJti(args.jti)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(key);
  return jwt;
}

function defaultTtl(plan: MintArgs['plan']): number {
  switch (plan) {
    case 'monthly':
      return 35 * 24 * 60 * 60;
    case 'trial':
      return 24 * 60 * 60;
    case 'lifetime':
      return 100 * 365 * 24 * 60 * 60;
  }
}

export interface VerifyResult {
  valid: boolean;
  payload?: LicensePayload;
  reason?: string;
}

export async function verifyLicense(
  token: string,
  publicKeyPem: string,
): Promise<VerifyResult> {
  try {
    const key = await getPublicKey(publicKeyPem);
    const { payload } = await jwtVerify(token, key, {
      issuer: 'maxbridge.ai',
      audience: 'maxbridge-client',
    });
    return { valid: true, payload: payload as unknown as LicensePayload };
  } catch (err) {
    return { valid: false, reason: (err as Error).message };
  }
}

/**
 * Mint a short random jti that's also safe to use as a KV key. 24 chars of
 * url-safe base64 = 144 bits of entropy — plenty for non-guessable IDs.
 */
export function generateJti(): string {
  const buf = new Uint8Array(18);
  crypto.getRandomValues(buf);
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}
