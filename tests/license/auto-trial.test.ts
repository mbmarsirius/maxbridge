import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureFriendTrialLicense } from '../../server/license/auto-trial.js';

/**
 * Auto-trial is an autoescape path we ship in every build so the first run
 * "just works" without online calls. These tests lock down:
 *   - default window is 24h (not 365d — regression from the freemium pivot)
 *   - env overrides honoured
 *   - idempotent (existing file not clobbered)
 *   - license.json actually has trial shape
 */
describe('ensureFriendTrialLicense', () => {
  let tmp: string;
  let origEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'mxb-autotrial-'));
    origEnv = { ...process.env };
    process.env.MAXBRIDGE_LICENSE_DIR = tmp;
    delete process.env.MAXBRIDGE_AUTO_TRIAL;
    delete process.env.MAXBRIDGE_AUTO_TRIAL_HOURS;
    delete process.env.MAXBRIDGE_AUTO_TRIAL_DAYS;
  });

  afterEach(() => {
    process.env = origEnv;
    rmSync(tmp, { recursive: true, force: true });
  });

  it('provisions a 24h trial by default when no license file exists', () => {
    const now = new Date('2026-04-21T10:00:00.000Z');
    const result = ensureFriendTrialLicense(now);
    expect(result).toBe('provisioned');

    const file = join(tmp, 'license.json');
    expect(existsSync(file)).toBe(true);
    const state = JSON.parse(readFileSync(file, 'utf8'));

    expect(state.licenseType).toBe('trial');
    expect(state.plan).toBe('trial');
    expect(state.issuedAt).toBe(now.toISOString());

    // 24h exactly
    const expires = Date.parse(state.expiresAt);
    expect(expires - now.getTime()).toBe(24 * 60 * 60 * 1000);

    // grace = 24h + 2h
    const grace = Date.parse(state.graceUntil);
    expect(grace - now.getTime()).toBe(26 * 60 * 60 * 1000);
  });

  it('honors MAXBRIDGE_AUTO_TRIAL_HOURS override', () => {
    process.env.MAXBRIDGE_AUTO_TRIAL_HOURS = '72';
    const now = new Date('2026-04-21T10:00:00.000Z');
    ensureFriendTrialLicense(now);
    const state = JSON.parse(readFileSync(join(tmp, 'license.json'), 'utf8'));
    const expires = Date.parse(state.expiresAt);
    expect(expires - now.getTime()).toBe(72 * 60 * 60 * 1000);
  });

  it('honors legacy MAXBRIDGE_AUTO_TRIAL_DAYS override', () => {
    process.env.MAXBRIDGE_AUTO_TRIAL_DAYS = '7';
    const now = new Date('2026-04-21T10:00:00.000Z');
    ensureFriendTrialLicense(now);
    const state = JSON.parse(readFileSync(join(tmp, 'license.json'), 'utf8'));
    const expires = Date.parse(state.expiresAt);
    expect(expires - now.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('prefers HOURS over DAYS when both are set', () => {
    process.env.MAXBRIDGE_AUTO_TRIAL_HOURS = '1';
    process.env.MAXBRIDGE_AUTO_TRIAL_DAYS = '30';
    const now = new Date('2026-04-21T10:00:00.000Z');
    ensureFriendTrialLicense(now);
    const state = JSON.parse(readFileSync(join(tmp, 'license.json'), 'utf8'));
    const expires = Date.parse(state.expiresAt);
    expect(expires - now.getTime()).toBe(1 * 60 * 60 * 1000);
  });

  it('returns "existing" without rewriting when a license file already exists', () => {
    ensureFriendTrialLicense(new Date('2026-04-21T10:00:00.000Z'));
    const contents1 = readFileSync(join(tmp, 'license.json'), 'utf8');
    const r2 = ensureFriendTrialLicense(new Date('2026-04-22T10:00:00.000Z'));
    expect(r2).toBe('existing');
    const contents2 = readFileSync(join(tmp, 'license.json'), 'utf8');
    expect(contents2).toBe(contents1);
  });

  it('returns "disabled" and writes nothing when MAXBRIDGE_AUTO_TRIAL=0', () => {
    process.env.MAXBRIDGE_AUTO_TRIAL = '0';
    const r = ensureFriendTrialLicense(new Date());
    expect(r).toBe('disabled');
    expect(existsSync(join(tmp, 'license.json'))).toBe(false);
  });
});
