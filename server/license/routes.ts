// License HTTP routes.
//
// Wired into `server/proxy.ts` alongside the existing /v1/integrations/*
// routes. The shapes below match spec §5. These routes stay open without a
// license — they ARE how an unlicensed user becomes licensed.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { verifyLifetimeJwt } from './jwt.js';
import { decide } from './gate.js';
import {
  deleteLicense,
  licenseFilePath,
  readLicense,
  writeLicense,
  type LicensePlan,
  type LicenseState,
  type LicenseType,
} from './store.js';
import { startTrial, validateOnline } from './client.js';

// Helpers mirroring the ones in proxy.ts. Kept module-local so this file
// doesn't depend on proxy.ts at import time.
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload).toString(),
    'access-control-allow-origin': '*',
    'x-maxbridge': 'license',
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage, limitBytes = 64_000): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
    total += buf.length;
    if (total > limitBytes) throw new Error('Request body too large');
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function daysBetween(fromMs: number, toMs: number): number {
  const diff = toMs - fromMs;
  if (diff <= 0) return 0;
  return Math.floor(diff / (24 * 60 * 60 * 1000));
}

function buildStatusResponse(state: LicenseState | null, now: Date) {
  if (!state) {
    return {
      licenseType: 'none' as const,
      plan: null,
      email: null,
      expiresAt: null,
      daysRemaining: 0,
      graceActive: false,
      lastValidatedAt: null,
    };
  }
  const verdict = decide(state, now);
  const graceActive = Boolean(verdict.headers['X-Maxbridge-Grace-Active']);
  const expiresAtMs = state.expiresAt ? Date.parse(state.expiresAt) : NaN;
  const daysRemaining = Number.isFinite(expiresAtMs)
    ? daysBetween(now.getTime(), expiresAtMs)
    : state.licenseType === 'lifetime' ? Number.MAX_SAFE_INTEGER : 0;
  return {
    licenseType: state.licenseType,
    plan: state.plan,
    email: state.email,
    expiresAt: state.expiresAt,
    daysRemaining,
    graceActive,
    lastValidatedAt: state.lastValidatedAt,
    allow: verdict.allow,
    reason: verdict.reason,
  };
}

export async function handleLicenseStatus(
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const state = readLicense();
  const body = buildStatusResponse(state, new Date());
  writeJson(res, 200, body);
}

export async function handleStartTrial(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let payload: { email?: unknown } = {};
  try {
    const text = await readBody(req);
    if (text.trim().length > 0) payload = JSON.parse(text);
  } catch (err) {
    writeJson(res, 400, { error: { type: 'maxbridge_license_bad_request', message: (err as Error).message } });
    return;
  }
  const email = typeof payload.email === 'string' ? payload.email.trim() : '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    writeJson(res, 400, {
      error: { type: 'maxbridge_license_bad_request', message: 'email is required and must be a valid address' },
    });
    return;
  }

  const result = await startTrial(email);
  if (!result.ok) {
    console.error(`[maxbridge-license] start-trial failed: ${result.reason} (${result.detail ?? ''})`);
    writeJson(res, 502, {
      error: {
        type: 'maxbridge_license_upstream',
        message: `Could not start trial: ${result.reason}`,
        detail: result.detail,
      },
    });
    return;
  }

  const now = new Date().toISOString();
  const state: LicenseState = {
    version: 1,
    licenseType: 'trial',
    token: result.token,
    email: result.email,
    plan: 'trial',
    issuedAt: result.issuedAt,
    expiresAt: result.expiresAt,
    lastValidatedAt: now,
    lastValidationStatus: 'ok',
    graceUntil: new Date(Date.parse(now) + 72 * 60 * 60 * 1000).toISOString(),
  };
  try {
    writeLicense(state);
  } catch (err) {
    writeJson(res, 500, {
      error: { type: 'maxbridge_license_write_failed', message: (err as Error).message },
    });
    return;
  }
  writeJson(res, 200, { ok: true, expiresAt: result.expiresAt, email: result.email });
}

export async function handleActivate(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let payload: { key?: unknown } = {};
  try {
    const text = await readBody(req);
    if (text.trim().length > 0) payload = JSON.parse(text);
  } catch (err) {
    writeJson(res, 400, { error: { type: 'maxbridge_license_bad_request', message: (err as Error).message } });
    return;
  }
  const key = typeof payload.key === 'string' ? payload.key.trim() : '';
  if (!key) {
    writeJson(res, 400, {
      error: { type: 'maxbridge_license_bad_request', message: 'key is required' },
    });
    return;
  }

  const nowIso = new Date().toISOString();

  // Heuristic: JWTs have three dot-separated segments; opaque server tokens
  // don't. Try JWT verification first; if that fails *not* because of key
  // problems but because the shape is wrong, fall through to the online
  // validate path.
  const looksLikeJwt = key.split('.').length === 3;
  if (looksLikeJwt) {
    const verdict = verifyLifetimeJwt(key);
    if (verdict.valid && verdict.payload) {
      const p = verdict.payload as { sub?: string; plan?: string };
      const state: LicenseState = {
        version: 1,
        licenseType: 'lifetime',
        token: key,
        email: typeof p.sub === 'string' ? p.sub : '',
        plan: 'lifetime',
        issuedAt: nowIso,
        expiresAt: null,
        lastValidatedAt: nowIso,
        lastValidationStatus: 'ok',
        graceUntil: new Date(Date.parse(nowIso) + 72 * 60 * 60 * 1000).toISOString(),
      };
      try {
        writeLicense(state);
      } catch (err) {
        writeJson(res, 500, {
          error: { type: 'maxbridge_license_write_failed', message: (err as Error).message },
        });
        return;
      }
      writeJson(res, 200, { ok: true, plan: 'lifetime', expiresAt: null });
      return;
    }
    // If the pubkey isn't configured yet, we shouldn't hard-fail — fall
    // through to online validation so dev environments can still activate
    // subscription/trial tokens that happen to have three segments.
    if (verdict.reason !== 'no_pubkey_configured') {
      writeJson(res, 400, {
        error: { type: 'maxbridge_license_invalid_key', message: `JWT rejected: ${verdict.reason}` },
      });
      return;
    }
  }

  // Opaque token path — ask the server.
  const online = await validateOnline(key);
  if (!online.ok) {
    writeJson(res, 502, {
      error: {
        type: 'maxbridge_license_upstream',
        message: `Could not validate license: ${online.reason}`,
        detail: online.detail,
      },
    });
    return;
  }
  if (!online.valid) {
    writeJson(res, 400, {
      error: { type: 'maxbridge_license_invalid_key', message: `License not valid (${online.status})` },
    });
    return;
  }

  const licenseType: LicenseType = online.plan === 'lifetime'
    ? 'lifetime'
    : online.plan === 'trial' ? 'trial' : 'subscription';
  const plan: LicensePlan = online.plan === 'lifetime' ? 'lifetime' : online.plan === 'trial' ? 'trial' : 'monthly';

  const state: LicenseState = {
    version: 1,
    licenseType,
    token: key,
    email: '',
    plan,
    issuedAt: nowIso,
    expiresAt: online.expiresAt,
    lastValidatedAt: online.lastValidated,
    lastValidationStatus: 'ok',
    graceUntil: new Date(Date.parse(online.lastValidated) + 72 * 60 * 60 * 1000).toISOString(),
  };
  try {
    writeLicense(state);
  } catch (err) {
    writeJson(res, 500, {
      error: { type: 'maxbridge_license_write_failed', message: (err as Error).message },
    });
    return;
  }
  writeJson(res, 200, { ok: true, plan, expiresAt: online.expiresAt });
}

export async function handleDeactivate(
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    deleteLicense();
  } catch (err) {
    writeJson(res, 500, {
      error: { type: 'maxbridge_license_delete_failed', message: (err as Error).message },
    });
    return;
  }
  writeJson(res, 200, { ok: true, path: licenseFilePath() });
}

// Convenience dispatcher used by proxy.ts. Returns `true` if the path was a
// license route and has been handled; `false` if the caller should continue.
export async function tryHandleLicenseRoute(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  if (pathname === '/v1/license/status' && req.method === 'GET') {
    await handleLicenseStatus(req, res);
    return true;
  }
  if (pathname === '/v1/license/start-trial' && req.method === 'POST') {
    await handleStartTrial(req, res);
    return true;
  }
  if (pathname === '/v1/license/activate' && req.method === 'POST') {
    await handleActivate(req, res);
    return true;
  }
  if (pathname === '/v1/license/deactivate' && req.method === 'POST') {
    await handleDeactivate(req, res);
    return true;
  }
  return false;
}
