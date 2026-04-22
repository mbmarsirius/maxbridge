// License state storage.
//
// Persists the Maxbridge license state to
// `~/Library/Application Support/Maxbridge/license.json` with 0600 perms and
// atomic writes (write to `.tmp` then rename). The schema matches
// spec-license-gate.md §3 exactly. See also ./gate.ts for the pure decision
// function that consumes this state.

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type LicenseType = 'lifetime' | 'subscription' | 'trial' | 'none';
export type LicensePlan = 'lifetime' | 'monthly' | 'trial';
export type ValidationStatus = 'ok' | 'expired' | 'revoked' | 'network_error';

// Schema from spec §3. ISO-8601 strings are stored as strings on disk; callers
// parse them into Date objects as needed (see gate.ts).
export interface LicenseState {
  version: 1;
  licenseType: LicenseType;
  token: string;
  email: string;
  plan: LicensePlan;
  issuedAt: string;
  expiresAt: string | null;
  lastValidatedAt: string;
  lastValidationStatus: ValidationStatus;
  graceUntil: string;
}

// Canonical location per spec §3. Overridable for tests via the env var so the
// unit suite never touches the real user file.
function defaultLicenseDir(): string {
  const override = process.env.MAXBRIDGE_LICENSE_DIR?.trim();
  if (override) return override;
  return join(homedir(), 'Library', 'Application Support', 'Maxbridge');
}

export function licenseFilePath(): string {
  return join(defaultLicenseDir(), 'license.json');
}

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
  }
}

function isLicenseState(v: unknown): v is LicenseState {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if (o.version !== 1) return false;
  if (typeof o.licenseType !== 'string') return false;
  if (!['lifetime', 'subscription', 'trial', 'none'].includes(o.licenseType as string)) return false;
  if (typeof o.token !== 'string') return false;
  if (typeof o.email !== 'string') return false;
  if (typeof o.plan !== 'string') return false;
  if (typeof o.issuedAt !== 'string') return false;
  if (!(o.expiresAt === null || typeof o.expiresAt === 'string')) return false;
  if (typeof o.lastValidatedAt !== 'string') return false;
  if (typeof o.lastValidationStatus !== 'string') return false;
  if (typeof o.graceUntil !== 'string') return false;
  return true;
}

export function readLicense(): LicenseState | null {
  const file = licenseFilePath();
  if (!existsSync(file)) return null;
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    console.error(`[maxbridge-license] Failed to read ${file}: ${(err as Error).message}`);
    return null;
  }
  if (raw.trim().length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`[maxbridge-license] license.json is not valid JSON: ${(err as Error).message}`);
    return null;
  }
  if (!isLicenseState(parsed)) {
    console.error('[maxbridge-license] license.json does not match expected schema; ignoring.');
    return null;
  }
  return parsed;
}

export function writeLicense(state: LicenseState): void {
  const file = licenseFilePath();
  const dir = dirname(file);
  ensureDir(dir);
  const tmp = `${file}.tmp`;
  const payload = JSON.stringify(state, null, 2);
  // Write tmp with 0600, then rename. Rename is atomic on the same filesystem.
  writeFileSync(tmp, payload, { encoding: 'utf8', mode: 0o600 });
  try {
    // Belt-and-suspenders: some umasks mask the `mode` on writeFileSync.
    chmodSync(tmp, 0o600);
  } catch {
    // ignore
  }
  renameSync(tmp, file);
  try {
    chmodSync(file, 0o600);
  } catch {
    // ignore
  }
  try {
    const s = statSync(file);
    const perms = s.mode & 0o777;
    if (perms !== 0o600) {
      console.error(`[maxbridge-license] Warning: ${file} has perms ${perms.toString(8)}, expected 600.`);
    }
  } catch {
    // ignore stat failures
  }
}

export function deleteLicense(): void {
  const file = licenseFilePath();
  if (!existsSync(file)) return;
  try {
    unlinkSync(file);
  } catch (err) {
    console.error(`[maxbridge-license] Failed to delete ${file}: ${(err as Error).message}`);
  }
}
