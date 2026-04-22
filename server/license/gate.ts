// Pure license-gate decision function.
//
// Implements the spec §4 decision tree. This module is deliberately
// side-effect-free: it takes a `LicenseState | null` plus the current time
// and returns a verdict. That makes the full truth table unit-testable
// without touching disk, network, or child processes. See
// tests/license/gate.test.ts.

import { verifyLifetimeJwt } from './jwt.js';
import type { LicenseState } from './store.js';

export interface GateDecision {
  allow: boolean;
  reason: string;
  // Extra HTTP response headers to attach (e.g. X-Maxbridge-Grace-Active: 1).
  headers: Record<string, string>;
  // When allow === false, a short machine-readable next-step hint so the
  // wizard / UI can branch without parsing `reason`.
  nextStep?:
    | 'start_trial_or_buy'
    | 'lifetime_key_invalid'
    | 'trial_expired'
    | 'subscription_lapsed';
  // URL the caller should open (or include in its error surface) so the user
  // can upgrade. Rendered when allow === false.
  upgradeUrl?: string;
}

// Central upgrade destination. Overridable via env so dev/staging can point
// at a local landing page; production users always end up on maxbridge.ai.
const UPGRADE_URL_DEFAULT = 'https://maxbridge.marsirius.ai/upgrade';
function getUpgradeUrl(licenseId?: string): string {
  const base = (process.env.MAXBRIDGE_UPGRADE_URL?.trim() || UPGRADE_URL_DEFAULT).replace(/\/+$/, '');
  // If we have a token id, pass it so the checkout session can be linked
  // back to the existing local trial (optional upsell attribution).
  return licenseId ? `${base}?ref=${encodeURIComponent(licenseId.slice(0, 32))}` : base;
}

// Spec §4: lifetime licenses continue to work past the 1-year update window.
// The update-window math adds 365d to `updates_until`; beyond that, feature
// updates are frozen but the bridge itself still runs (ALLOW silently).
// This function keeps the math explicit so tests can exercise all branches.
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t);
}

export function decide(state: LicenseState | null, now: Date): GateDecision {
  // Test-only bypass. Requires BOTH the explicit opt-in env var AND
  // NODE_ENV=test so the shipped production bundle (NODE_ENV=production in
  // the Tauri launcher) can never satisfy this branch. Tests set both; the
  // signed build users run ignores both. This closes the MAXBRIDGE_LICENSE_BYPASS
  // backdoor that was safe in the friend-test era but would let any user
  // with the DMG bypass billing at launch.
  if (
    process.env.NODE_ENV === 'test'
    && process.env.MAXBRIDGE_LICENSE_BYPASS === '1'
  ) {
    return {
      allow: true,
      reason: 'license_bypass_env_test',
      headers: { 'X-Maxbridge-License-Bypass': '1' },
    };
  }
  if (!state || state.licenseType === 'none') {
    return {
      allow: false,
      reason: 'no_license',
      headers: {},
      nextStep: 'start_trial_or_buy',
      upgradeUrl: getUpgradeUrl(),
    };
  }

  if (state.licenseType === 'lifetime') {
    const jwt = verifyLifetimeJwt(state.token);
    if (!jwt.valid) {
      return {
        allow: false,
        reason: `lifetime_key_invalid:${jwt.reason ?? 'unknown'}`,
        headers: {},
        nextStep: 'lifetime_key_invalid',
        upgradeUrl: getUpgradeUrl(state.token),
      };
    }
    const updatesUntilSec = Number((jwt.payload as { updates_until?: number })?.updates_until);
    const updatesUntilMs = Number.isFinite(updatesUntilSec) ? updatesUntilSec * 1000 : 0;
    const freezeAtMs = updatesUntilMs + ONE_YEAR_MS;
    if (now.getTime() < freezeAtMs) {
      return { allow: true, reason: 'lifetime_active', headers: {} };
    }
    // Past update window — spec §4 says ALLOW silently. Feature updates are
    // frozen but the bridge keeps working. We still attach a header so the
    // UI can render a "update subscription expired" nudge if it wants.
    return {
      allow: true,
      reason: 'lifetime_past_update_window',
      headers: { 'X-Maxbridge-Updates-Frozen': '1' },
    };
  }

  if (state.licenseType === 'trial' || state.licenseType === 'subscription') {
    const expiresAt = parseDate(state.expiresAt);
    const graceUntil = parseDate(state.graceUntil);

    if (expiresAt && now.getTime() < expiresAt.getTime()) {
      return {
        allow: true,
        reason: state.licenseType === 'trial' ? 'trial_active' : 'subscription_active',
        headers: {},
      };
    }

    if (graceUntil && now.getTime() < graceUntil.getTime()) {
      return {
        allow: true,
        reason: state.licenseType === 'trial' ? 'trial_grace' : 'subscription_grace',
        headers: { 'X-Maxbridge-Grace-Active': '1' },
      };
    }

    return {
      allow: false,
      reason: state.licenseType === 'trial' ? 'trial_expired' : 'subscription_lapsed',
      headers: {},
      nextStep: state.licenseType === 'trial' ? 'trial_expired' : 'subscription_lapsed',
      upgradeUrl: getUpgradeUrl(state.token),
    };
  }

  // Unknown licenseType — be conservative and deny.
  return {
    allow: false,
    reason: `unknown_license_type:${String((state as LicenseState).licenseType)}`,
    headers: {},
    nextStep: 'start_trial_or_buy',
    upgradeUrl: getUpgradeUrl(),
  };
}
