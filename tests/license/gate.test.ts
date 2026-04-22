// Truth-table tests for the pure license-gate decision function.
//
// The gate must be side-effect-free; these tests exercise it with synthetic
// LicenseState values so we cover every branch in spec §4 without touching
// disk, network, or crypto.
//
// The lifetime-JWT branches need a real Ed25519 keypair so `verifyLifetimeJwt`
// works. We generate one at suite setup, write the PEM to a tempfile, and
// point the verifier at it via MAXBRIDGE_LICENSE_PUBKEY_PATH.

import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { decide } from '../../server/license/gate';
import { _resetPubkeyCache } from '../../server/license/jwt';
import type { LicenseState } from '../../server/license/store';

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

interface TestKeypair {
  privatePem: string;
  publicPem: string;
}

function mintJwt(kp: TestKeypair, payload: Record<string, unknown>): string {
  const header = { alg: 'EdDSA', typ: 'JWT' };
  const headerB64 = b64url(Buffer.from(JSON.stringify(header), 'utf8'));
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const signingInput = Buffer.from(`${headerB64}.${payloadB64}`, 'utf8');
  const sig = sign(null, signingInput, kp.privatePem);
  return `${headerB64}.${payloadB64}.${b64url(sig)}`;
}

function isoFromNow(now: Date, deltaMs: number): string {
  return new Date(now.getTime() + deltaMs).toISOString();
}

const NOW = new Date('2026-04-20T18:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

let kp: TestKeypair;
let tempPubkeyPath: string;
let prevEnv: string | undefined;

beforeAll(() => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  kp = {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
  const dir = mkdtempSync(join(tmpdir(), 'maxbridge-license-test-'));
  tempPubkeyPath = join(dir, 'pubkey.pem');
  writeFileSync(tempPubkeyPath, kp.publicPem, 'utf8');
  prevEnv = process.env.MAXBRIDGE_LICENSE_PUBKEY_PATH;
  process.env.MAXBRIDGE_LICENSE_PUBKEY_PATH = tempPubkeyPath;
  _resetPubkeyCache();
});

afterAll(() => {
  if (prevEnv === undefined) delete process.env.MAXBRIDGE_LICENSE_PUBKEY_PATH;
  else process.env.MAXBRIDGE_LICENSE_PUBKEY_PATH = prevEnv;
  _resetPubkeyCache();
});

function trialState(overrides: Partial<LicenseState> = {}): LicenseState {
  return {
    version: 1,
    licenseType: 'trial',
    token: 'mb_live_trial_xyz',
    email: 'u@example.com',
    plan: 'trial',
    issuedAt: isoFromNow(NOW, -3 * DAY),
    expiresAt: isoFromNow(NOW, 4 * DAY),
    lastValidatedAt: isoFromNow(NOW, -1 * 60 * 60 * 1000),
    lastValidationStatus: 'ok',
    graceUntil: isoFromNow(NOW, 71 * 60 * 60 * 1000),
    ...overrides,
  };
}

function subState(overrides: Partial<LicenseState> = {}): LicenseState {
  return {
    version: 1,
    licenseType: 'subscription',
    token: 'mb_live_sub_abc',
    email: 'u@example.com',
    plan: 'monthly',
    issuedAt: isoFromNow(NOW, -30 * DAY),
    expiresAt: isoFromNow(NOW, 30 * DAY),
    lastValidatedAt: isoFromNow(NOW, -1 * 60 * 60 * 1000),
    lastValidationStatus: 'ok',
    graceUntil: isoFromNow(NOW, 71 * 60 * 60 * 1000),
    ...overrides,
  };
}

function lifetimeState(token: string, overrides: Partial<LicenseState> = {}): LicenseState {
  return {
    version: 1,
    licenseType: 'lifetime',
    token,
    email: 'buyer@example.com',
    plan: 'lifetime',
    issuedAt: isoFromNow(NOW, -10 * DAY),
    expiresAt: null,
    lastValidatedAt: isoFromNow(NOW, -10 * DAY),
    lastValidationStatus: 'ok',
    graceUntil: isoFromNow(NOW, 72 * 60 * 60 * 1000),
    ...overrides,
  };
}

describe('decide() — spec §4 truth table', () => {
  it('denies when state is null (no license file)', () => {
    const v = decide(null, NOW);
    expect(v.allow).toBe(false);
    expect(v.nextStep).toBe('start_trial_or_buy');
    expect(v.reason).toBe('no_license');
  });

  it('denies when licenseType is explicitly "none"', () => {
    const state: LicenseState = trialState({ licenseType: 'none' });
    const v = decide(state, NOW);
    expect(v.allow).toBe(false);
    expect(v.nextStep).toBe('start_trial_or_buy');
  });

  it('allows a trial within expires_at', () => {
    const v = decide(trialState(), NOW);
    expect(v.allow).toBe(true);
    expect(v.reason).toBe('trial_active');
    expect(v.headers['X-Maxbridge-Grace-Active']).toBeUndefined();
  });

  it('allows a trial past expires_at but within grace, with grace header', () => {
    const state = trialState({
      expiresAt: isoFromNow(NOW, -1 * 60 * 60 * 1000), // 1h past expiry
      graceUntil: isoFromNow(NOW, 24 * 60 * 60 * 1000), // 24h remaining grace
    });
    const v = decide(state, NOW);
    expect(v.allow).toBe(true);
    expect(v.reason).toBe('trial_grace');
    expect(v.headers['X-Maxbridge-Grace-Active']).toBe('1');
  });

  it('denies a trial past both expires_at and graceUntil', () => {
    const state = trialState({
      expiresAt: isoFromNow(NOW, -5 * DAY),
      graceUntil: isoFromNow(NOW, -1 * 60 * 60 * 1000),
    });
    const v = decide(state, NOW);
    expect(v.allow).toBe(false);
    expect(v.reason).toBe('trial_expired');
    expect(v.nextStep).toBe('trial_expired');
    // Every denial carries an upgrade URL so downstream callers can surface
    // it in a 402 response (the OpenClaw gateway + OpenAI-compat paths both
    // rely on this).
    expect(v.upgradeUrl).toMatch(/^https?:\/\/.+/);
  });

  it('allows an active subscription within expires_at', () => {
    const v = decide(subState(), NOW);
    expect(v.allow).toBe(true);
    expect(v.reason).toBe('subscription_active');
  });

  it('allows a lapsed subscription within grace window', () => {
    const state = subState({
      expiresAt: isoFromNow(NOW, -2 * 60 * 60 * 1000),
      graceUntil: isoFromNow(NOW, 60 * 60 * 60 * 1000),
    });
    const v = decide(state, NOW);
    expect(v.allow).toBe(true);
    expect(v.reason).toBe('subscription_grace');
    expect(v.headers['X-Maxbridge-Grace-Active']).toBe('1');
  });

  it('denies a subscription past both expires_at and graceUntil', () => {
    const state = subState({
      expiresAt: isoFromNow(NOW, -10 * DAY),
      graceUntil: isoFromNow(NOW, -1 * DAY),
    });
    const v = decide(state, NOW);
    expect(v.allow).toBe(false);
    expect(v.reason).toBe('subscription_lapsed');
    expect(v.nextStep).toBe('subscription_lapsed');
  });

  it('allows a valid lifetime JWT within the 1-year update window', () => {
    const iatSec = Math.floor(NOW.getTime() / 1000) - 10 * 24 * 3600;
    const updatesUntilSec = Math.floor(NOW.getTime() / 1000) + 180 * 24 * 3600;
    const token = mintJwt(kp, {
      sub: 'buyer@example.com',
      plan: 'lifetime',
      iat: iatSec,
      updates_until: updatesUntilSec,
      issuer: 'maxbridge.ai',
      key_id: 'v1',
    });
    const v = decide(lifetimeState(token), NOW);
    expect(v.allow).toBe(true);
    expect(v.reason).toBe('lifetime_active');
  });

  it('allows a valid lifetime JWT past the update window (silent, with frozen-updates header)', () => {
    // updates_until was 400 days ago — we are past updates_until + 365d.
    const updatesUntilSec = Math.floor(NOW.getTime() / 1000) - 400 * 24 * 3600;
    const token = mintJwt(kp, {
      sub: 'buyer@example.com',
      plan: 'lifetime',
      iat: Math.floor(NOW.getTime() / 1000) - 800 * 24 * 3600,
      updates_until: updatesUntilSec,
      issuer: 'maxbridge.ai',
      key_id: 'v1',
    });
    const v = decide(lifetimeState(token), NOW);
    expect(v.allow).toBe(true);
    expect(v.reason).toBe('lifetime_past_update_window');
    expect(v.headers['X-Maxbridge-Updates-Frozen']).toBe('1');
  });

  it('denies a lifetime license whose JWT is tampered (bad signature)', () => {
    const updatesUntilSec = Math.floor(NOW.getTime() / 1000) + 180 * 24 * 3600;
    const token = mintJwt(kp, {
      sub: 'buyer@example.com',
      plan: 'lifetime',
      iat: Math.floor(NOW.getTime() / 1000),
      updates_until: updatesUntilSec,
      issuer: 'maxbridge.ai',
      key_id: 'v1',
    });
    const parts = token.split('.');
    // Flip one char in the payload segment — signature no longer matches.
    const tampered = `${parts[0]}.${parts[1].slice(0, -1)}X.${parts[2]}`;
    const v = decide(lifetimeState(tampered), NOW);
    expect(v.allow).toBe(false);
    expect(v.nextStep).toBe('lifetime_key_invalid');
    expect(v.reason).toMatch(/lifetime_key_invalid/);
  });

  it('denies a lifetime license whose JWT is malformed', () => {
    const v = decide(lifetimeState('not-a-jwt'), NOW);
    expect(v.allow).toBe(false);
    expect(v.nextStep).toBe('lifetime_key_invalid');
    expect(v.reason).toMatch(/malformed_jwt/);
  });

  it('treats a subscription revoked / status=revoked still within expires_at as allowed (gate honors expiresAt, background thread is responsible for marking licenseType=none on revoke)', () => {
    // Per spec §4 the gate only looks at licenseType + expires/grace. It is
    // the background revalidation thread's job (spec §4 last paragraph) to
    // rewrite licenseType when the server marks a token revoked. This test
    // pins that behaviour so future refactors don't accidentally read
    // lastValidationStatus inside decide().
    const state = subState({ lastValidationStatus: 'revoked' });
    const v = decide(state, NOW);
    expect(v.allow).toBe(true);
  });

  it('denies a license with an unknown licenseType defensively', () => {
    // Force-cast to simulate a corrupted or future-version file that made it
    // past the schema check.
    const state = { ...trialState(), licenseType: 'weird' } as unknown as LicenseState;
    const v = decide(state, NOW);
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/unknown_license_type/);
  });
});
