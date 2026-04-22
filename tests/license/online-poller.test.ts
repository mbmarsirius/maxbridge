import { describe, expect, it } from 'vitest';
import { applyOnlineResult } from '../../server/license/online-poller.js';
import type { LicenseState } from '../../server/license/store.js';

const baseState: LicenseState = {
  version: 1,
  licenseType: 'subscription',
  token: 'tok_example',
  email: 'user@example.com',
  plan: 'monthly',
  issuedAt: '2026-04-01T00:00:00.000Z',
  expiresAt: '2026-05-01T00:00:00.000Z',
  lastValidatedAt: '2026-04-20T00:00:00.000Z',
  lastValidationStatus: 'ok',
  graceUntil: '2026-05-03T00:00:00.000Z',
};

describe('applyOnlineResult', () => {
  const now = new Date('2026-04-25T00:00:00.000Z');

  it('pushes expiresAt forward when server confirms a later valid-until', () => {
    const out = applyOnlineResult(baseState, {
      ok: true,
      valid: true,
      plan: 'monthly',
      expiresAt: '2026-06-01T00:00:00.000Z',
      lastValidated: now.toISOString(),
      status: 'ok',
    }, now);
    expect(out).not.toBeNull();
    expect(out?.expiresAt).toBe('2026-06-01T00:00:00.000Z');
    // grace = expiresAt + 2h
    expect(out?.graceUntil).toBe('2026-06-01T02:00:00.000Z');
    expect(out?.lastValidationStatus).toBe('ok');
  });

  it('collapses expiresAt to now when server marks license revoked', () => {
    const out = applyOnlineResult(baseState, {
      ok: true,
      valid: false,
      plan: null,
      expiresAt: null,
      lastValidated: now.toISOString(),
      status: 'revoked',
    }, now);
    expect(out).not.toBeNull();
    expect(out?.expiresAt).toBe(now.toISOString());
    expect(out?.graceUntil).toBe(now.toISOString());
    expect(out?.lastValidationStatus).toBe('revoked');
  });

  it('collapses when server says expired with valid=false', () => {
    const out = applyOnlineResult(baseState, {
      ok: true,
      valid: false,
      plan: 'monthly',
      expiresAt: '2026-04-10T00:00:00.000Z',
      lastValidated: now.toISOString(),
      status: 'expired',
    }, now);
    expect(out).not.toBeNull();
    expect(out?.expiresAt).toBe(now.toISOString());
  });

  it('returns null (no-op) when server echoes the current state unchanged', () => {
    const out = applyOnlineResult(baseState, {
      ok: true,
      valid: true,
      plan: 'monthly',
      expiresAt: baseState.expiresAt,
      lastValidated: baseState.lastValidatedAt,
      status: 'ok',
    }, now);
    // graceUntil would be recomputed to expiresAt+2h, different from base; so
    // this path typically DOES produce a change. We assert that if nothing
    // changed, null is returned — use a base whose grace already matches.
    const tightBase: LicenseState = {
      ...baseState,
      graceUntil: '2026-05-01T02:00:00.000Z',
    };
    const out2 = applyOnlineResult(tightBase, {
      ok: true,
      valid: true,
      plan: 'monthly',
      expiresAt: tightBase.expiresAt,
      lastValidated: tightBase.lastValidatedAt,
      status: 'ok',
    }, now);
    expect(out2).toBeNull();
    // Reference variable to avoid unused-var lint noise while keeping the
    // "change detection" assertion above.
    expect(out?.graceUntil).toBe('2026-05-01T02:00:00.000Z');
  });
});
