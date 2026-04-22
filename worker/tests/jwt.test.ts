import { describe, expect, it } from 'vitest';
import { mintLicense, verifyLicense, generateJti } from '../src/jwt.js';
import { generateKeyPairSync } from 'node:crypto';

// Generate an Ed25519 keypair per test run so we don't need static fixtures.
function genKeys(): { priv: string; pub: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const priv = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  const pub = publicKey.export({ type: 'spki', format: 'pem' }) as string;
  return { priv, pub };
}

describe('jwt mint + verify', () => {
  it('round-trips a monthly license with expected claims', async () => {
    const { priv, pub } = genKeys();
    const jti = generateJti();
    const jwt = await mintLicense({
      email: 'buyer@example.com',
      plan: 'monthly',
      jti,
      privateKeyPem: priv,
    });
    const v = await verifyLicense(jwt, pub);
    expect(v.valid).toBe(true);
    expect(v.payload?.sub).toBe('buyer@example.com');
    expect(v.payload?.plan).toBe('monthly');
    expect(v.payload?.jti).toBe(jti);
    expect(v.payload?.iss).toBe('maxbridge.ai');
    expect(v.payload?.aud).toBe('maxbridge-client');
  });

  it('rejects a token signed by the wrong key', async () => {
    const a = genKeys();
    const b = genKeys();
    const jwt = await mintLicense({
      email: 'x@y.com',
      plan: 'monthly',
      jti: generateJti(),
      privateKeyPem: a.priv,
    });
    const v = await verifyLicense(jwt, b.pub);
    expect(v.valid).toBe(false);
  });

  it('honors a custom ttlSeconds', async () => {
    const { priv, pub } = genKeys();
    const now = new Date('2026-05-01T00:00:00Z');
    const jwt = await mintLicense({
      email: 'x@y.com',
      plan: 'trial',
      jti: generateJti(),
      privateKeyPem: priv,
      ttlSeconds: 3600,
      now,
    });
    const v = await verifyLicense(jwt, pub);
    expect(v.valid).toBe(true);
    const expected = Math.floor(now.getTime() / 1000) + 3600;
    expect(v.payload?.exp).toBe(expected);
  });

  it('generateJti produces urlsafe tokens of expected length', () => {
    for (let i = 0; i < 10; i++) {
      const t = generateJti();
      expect(t.length).toBe(24);
      expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});
