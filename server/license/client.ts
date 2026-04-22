// api.maxbridge.ai HTTP client.
//
// Calls the two license-server endpoints from spec §6. Uses the built-in
// `fetch` global (Node >= 18). Network errors never throw — they resolve to
// `{ ok: false, reason: 'network_error' }` so the caller (the gate / route
// handler) can trigger the 72h offline-grace logic described in spec §2.

const LICENSE_API_BASE = (process.env.MAXBRIDGE_LICENSE_API_BASE?.trim() || 'https://install.marsirius.ai').replace(/\/+$/, '');
const TIMEOUT_MS = 8_000;

export interface ValidateOk {
  ok: true;
  valid: boolean;
  plan: 'lifetime' | 'monthly' | 'trial' | null;
  expiresAt: string | null;
  lastValidated: string;
  status: 'ok' | 'expired' | 'revoked';
}

export interface ValidateErr {
  ok: false;
  reason: 'network_error' | 'bad_response' | 'http_error';
  httpStatus?: number;
  detail?: string;
}

export type ValidateResult = ValidateOk | ValidateErr;

export interface StartTrialOk {
  ok: true;
  token: string;
  email: string;
  plan: 'trial';
  issuedAt: string;
  expiresAt: string;
}

export interface StartTrialErr {
  ok: false;
  reason: 'network_error' | 'bad_response' | 'http_error';
  httpStatus?: number;
  detail?: string;
}

export type StartTrialResult = StartTrialOk | StartTrialErr;

async function postJson(path: string, body: unknown): Promise<{ ok: true; json: any; status: number } | { ok: false; reason: 'network_error' | 'http_error' | 'bad_response'; httpStatus?: number; detail?: string }> {
  const url = `${LICENSE_API_BASE}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    return {
      ok: false,
      reason: 'network_error',
      detail: (err as Error).message,
    };
  }
  clearTimeout(timer);
  const text = await res.text().catch(() => '');
  if (res.status >= 400) {
    return {
      ok: false,
      reason: 'http_error',
      httpStatus: res.status,
      detail: text.slice(0, 500),
    };
  }
  try {
    const json = text.length === 0 ? {} : JSON.parse(text);
    return { ok: true, json, status: res.status };
  } catch (err) {
    return {
      ok: false,
      reason: 'bad_response',
      httpStatus: res.status,
      detail: `non-JSON body: ${(err as Error).message}`,
    };
  }
}

export async function validateOnline(token: string): Promise<ValidateResult> {
  const r = await postJson('/v1/license/validate', { token });
  if (!r.ok) {
    return { ok: false, reason: r.reason, httpStatus: r.httpStatus, detail: r.detail };
  }
  const j = r.json as Partial<ValidateOk> & { valid?: boolean };
  if (typeof j.valid !== 'boolean') {
    return { ok: false, reason: 'bad_response', httpStatus: r.status, detail: 'missing `valid` field' };
  }
  return {
    ok: true,
    valid: j.valid,
    plan: (j.plan as ValidateOk['plan']) ?? null,
    expiresAt: typeof j.expiresAt === 'string' ? j.expiresAt : null,
    lastValidated: typeof j.lastValidated === 'string' ? j.lastValidated : new Date().toISOString(),
    status: (j.status as ValidateOk['status']) ?? (j.valid ? 'ok' : 'expired'),
  };
}

export async function startTrial(email: string): Promise<StartTrialResult> {
  const r = await postJson('/v1/trial/start', { email });
  if (!r.ok) {
    return { ok: false, reason: r.reason, httpStatus: r.httpStatus, detail: r.detail };
  }
  const j = r.json as Partial<StartTrialOk>;
  if (typeof j.token !== 'string' || typeof j.expiresAt !== 'string') {
    return { ok: false, reason: 'bad_response', httpStatus: r.status, detail: 'missing token or expiresAt' };
  }
  return {
    ok: true,
    token: j.token,
    email: typeof j.email === 'string' ? j.email : email,
    plan: 'trial',
    issuedAt: typeof j.issuedAt === 'string' ? j.issuedAt : new Date().toISOString(),
    expiresAt: j.expiresAt,
  };
}
