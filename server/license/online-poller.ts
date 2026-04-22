// Background license poller.
//
// The local `license.json` is authoritative for gate decisions so every
// request stays fast and works offline. But when a paid subscription lapses
// (card expired, user cancelled, Stripe reversed the charge) we want the
// bridge to notice within a few hours — not wait until the JWT's own exp
// claim rolls over in 35 days.
//
// This module runs a single setInterval that calls the license server's
// /license/status endpoint, compares the returned plan + expiresAt against
// the on-disk state, and writes through any changes. If the server says
// the license is revoked / expired / invalid, we immediately downgrade the
// local state so the next /v1/messages call gets a 402.
//
// The poller is deliberately conservative:
//   - No-op for `trial` state (that's purely offline).
//   - No-op for `lifetime` state (JWT self-verifies; no server needed).
//   - Active only when plan === 'monthly' / 'subscription'.
//   - Respects an `MAXBRIDGE_ONLINE_POLL_DISABLED=1` escape hatch for tests.
//   - Tolerates network failures silently — the local state remains valid
//     under the configured grace window.

import { readLicense, writeLicense, type LicenseState } from './store.js';
import { validateOnline } from './client.js';

const DEFAULT_POLL_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface PollerHandle {
  stop: () => void;
}

export function startOnlineLicensePoller(
  opts: { intervalMs?: number } = {},
): PollerHandle {
  if (process.env.MAXBRIDGE_ONLINE_POLL_DISABLED === '1') {
    return { stop: () => {} };
  }
  const intervalRaw = process.env.MAXBRIDGE_ONLINE_POLL_INTERVAL_MS?.trim();
  const interval = opts.intervalMs
    ?? (intervalRaw && Number.isFinite(Number(intervalRaw)) && Number(intervalRaw) > 0
      ? Number(intervalRaw)
      : DEFAULT_POLL_INTERVAL_MS);

  const timer = setInterval(() => {
    void checkOnce();
  }, interval);
  // Kick off an initial check after a short delay (10s) so the app finishes
  // booting before we make a network round-trip.
  const kickoff = setTimeout(() => {
    void checkOnce();
  }, 10_000);
  return {
    stop: () => {
      clearInterval(timer);
      clearTimeout(kickoff);
    },
  };
}

async function checkOnce(): Promise<void> {
  const state = readLicense();
  if (!state) return;
  if (state.licenseType !== 'subscription') return;
  if (!state.token) return;

  const result = await validateOnline(state.token);
  if (!result.ok) {
    // Network failure — leave state alone. The grace window handles brief
    // outages; if it's a real backend issue, the user gets at least their
    // graceUntil window before the gate denies.
    return;
  }

  const now = new Date();
  const changed = applyOnlineResult(state, result, now);
  if (changed) {
    writeLicense(changed);
  }
}

// Small pure function so tests can exercise the merge logic without network.
export function applyOnlineResult(
  state: LicenseState,
  result: {
    ok: true;
    valid: boolean;
    plan: 'lifetime' | 'monthly' | 'trial' | null;
    expiresAt: string | null;
    lastValidated: string;
    status: 'ok' | 'expired' | 'revoked';
  },
  now: Date,
): LicenseState | null {
  let next: LicenseState = {
    ...state,
    lastValidatedAt: result.lastValidated || now.toISOString(),
    lastValidationStatus: result.status,
  };

  if (!result.valid || result.status === 'revoked') {
    // Server says the key is dead — collapse to an expired state so the gate
    // returns 402 on the next request. We keep the token around for audit /
    // upgrade-flow referencing but zero out the active window.
    next = {
      ...next,
      expiresAt: now.toISOString(),
      graceUntil: now.toISOString(),
    };
  } else if (result.expiresAt) {
    // Server says the license is still valid — push the local expiresAt
    // forward to match (handles renewal events).
    next = { ...next, expiresAt: result.expiresAt };
    // Keep a small grace window past the new expiresAt for webhook lag.
    const graceMs = 2 * 60 * 60 * 1000;
    const parsed = Date.parse(result.expiresAt);
    if (Number.isFinite(parsed)) {
      next = { ...next, graceUntil: new Date(parsed + graceMs).toISOString() };
    }
  }

  const same =
    next.expiresAt === state.expiresAt
    && next.graceUntil === state.graceUntil
    && next.lastValidatedAt === state.lastValidatedAt
    && next.lastValidationStatus === state.lastValidationStatus;
  return same ? null : next;
}
