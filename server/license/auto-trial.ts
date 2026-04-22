// Auto-provisioned freemium trial.
//
// Goal: every first launch of Maxbridge gets 24 hours of full Opus 4.7 access
// with zero signup friction. After 24 hours the gate returns 402 + an upgrade
// URL; the caller (OpenClaw gateway, Cursor, etc.) follows its configured
// fallback chain, so the user immediately feels the "Opus → GPT downgrade"
// pain and has a strong incentive to upgrade.
//
// Trial length (hours) is controlled by MAXBRIDGE_AUTO_TRIAL_HOURS; the legacy
// MAXBRIDGE_AUTO_TRIAL_DAYS still works for CI/dev who want a multi-day trial.
// Hours wins if both are set. Default: 24h.
//
// Guarantees:
//   - Offline-safe: no network calls during provisioning.
//   - Idempotent: re-running the proxy does NOT regenerate or extend the
//     trial; the on-disk expiresAt is authoritative.
//   - Respects the canonical license file location already used elsewhere
//     (~/Library/Application Support/Maxbridge/license.json), so the gate
//     logic and the trial-extend / paid-upgrade paths keep working.
//   - After expiry, the standard gate (`decide` in ./gate.ts) returns
//     `allow:false, reason:'trial_expired'` with an upgrade_url pointer.
//
// Opt-out: set MAXBRIDGE_AUTO_TRIAL=0. Used by e2e tests that want to
// exercise the no-license denial path directly.

import { randomBytes } from 'node:crypto';
import type { LicenseState } from './store.js';
import { readLicense, writeLicense } from './store.js';

const DEFAULT_TRIAL_HOURS = 24;
// Grace window past expiresAt during which the gate still allows requests
// (flagged as `trial_grace`) so a user who's about to upgrade isn't cut off
// mid-turn. 2h is enough for "start a Stripe checkout, fill in card, get
// webhook → JWT delivered → Maxbridge refreshes local license."
const GRACE_HOURS = 2;

/**
 * Ensure the local license store contains a usable trial state. Returns:
 *   - 'existing'   if a license file already exists (trial or paid); no-op.
 *   - 'provisioned' if we just wrote a new friend-trial state.
 *   - 'disabled'   if MAXBRIDGE_AUTO_TRIAL=0 was set; caller should expect
 *                  the standard no-license gate denial.
 */
export function ensureFriendTrialLicense(
  now: Date = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): 'existing' | 'provisioned' | 'disabled' {
  if (env.MAXBRIDGE_AUTO_TRIAL === '0') {
    return 'disabled';
  }
  const existing = readLicense();
  if (existing) return 'existing';

  // Hours wins if set; fall back to days for backwards compat; else 24h.
  const hoursRaw = env.MAXBRIDGE_AUTO_TRIAL_HOURS?.trim();
  const daysRaw = env.MAXBRIDGE_AUTO_TRIAL_DAYS?.trim();
  const trialMs = (() => {
    if (hoursRaw && Number.isFinite(Number(hoursRaw)) && Number(hoursRaw) > 0) {
      return Number(hoursRaw) * 60 * 60 * 1000;
    }
    if (daysRaw && Number.isFinite(Number(daysRaw)) && Number(daysRaw) > 0) {
      return Number(daysRaw) * 24 * 60 * 60 * 1000;
    }
    return DEFAULT_TRIAL_HOURS * 60 * 60 * 1000;
  })();

  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + trialMs).toISOString();
  const graceUntil = new Date(now.getTime() + trialMs + GRACE_HOURS * 60 * 60 * 1000).toISOString();

  const token = `friend-local-${randomBytes(12).toString('hex')}`;

  const state: LicenseState = {
    version: 1,
    licenseType: 'trial',
    token,
    email: 'trial@maxbridge.local',
    plan: 'trial',
    issuedAt,
    expiresAt,
    lastValidatedAt: issuedAt,
    lastValidationStatus: 'ok',
    graceUntil,
  };
  writeLicense(state);
  return 'provisioned';
}
