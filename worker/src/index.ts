// Maxbridge license Worker — main router.
//
// Routes:
//   GET  /healthz                         liveness
//   GET  /license/status?key=<jwt>        current license state (JSON)
//   POST /license/activate                body {key, deviceId}; records activation
//   POST /stripe/webhook                  Stripe webhook handler
//   GET  /v0.1.0                          renders install.sh (shebang-shaped)
//   GET  /v0.1.0?key=<jwt>                same — key accepted via query string
//   GET  /download/:token                 serves per-user .md activation file
//
// All POST bodies are JSON unless otherwise noted. CORS wide-open for GET so
// the landing page can poll status without a Worker proxy.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  mintLicense,
  verifyLicense,
  generateJti,
  type LicensePayload,
} from './jwt.js';
import {
  LicenseKv,
  generateDownloadToken,
  type LicenseRecord,
} from './kv.js';
import {
  verifyStripeSignature,
  parseCheckoutCompleted,
  parseInvoicePaid,
  parseSubscriptionDeleted,
  type StripeEvent,
} from './stripe.js';
import { sendEmail, renderWelcomeEmail } from './email.js';
import { renderInstallSh } from './install-sh.js';
import { renderActivationMd, renderPublicInstallMd } from './md-template.js';

interface Env {
  LICENSES: KVNamespace;
  ASSETS: Fetcher;

  // secrets (wrangler secret put ...)
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  JWT_PRIVATE_KEY: string;
  JWT_PUBLIC_KEY: string;
  RESEND_API_KEY: string;

  // vars (wrangler.toml [vars])
  LANDING_URL: string;
  INSTALL_API_URL: string;
  FROM_EMAIL: string;
  DMG_URL: string;
  DMG_SHA256: string;
  MAXBRIDGE_VERSION: string;
  STRIPE_PRICE_ID: string;
}

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors({
  origin: (origin) => origin,
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['content-type', 'authorization'],
}));

app.get('/healthz', (c) => c.json({ ok: true, version: c.env.MAXBRIDGE_VERSION }));

/**
 * Public install.md — the free-launch artifact. A user downloads this from
 * the landing page (no email, no card), drops it into their OpenClaw bot
 * chat, and the bot runs the install autonomously. No per-user data.
 */
app.get('/install.md', (c) => {
  const md = renderPublicInstallMd({
    installUrl: c.env.INSTALL_API_URL,
    landingUrl: c.env.LANDING_URL,
    supportEmail: c.env.FROM_EMAIL,
    version: c.env.MAXBRIDGE_VERSION,
    repoUrl: 'https://github.com/mbmarsirius/maxbridge',
  });
  return new Response(md, {
    status: 200,
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': 'attachment; filename="install-maxbridge.md"',
      'cache-control': 'public, max-age=300',
    },
  });
});

/**
 * Stripe Checkout Session creator — called by the hero/pricing form in the
 * landing HTML. Keeps the restricted Stripe key server-side; the form POSTs
 * JSON {email?, ref?} and receives a {url} that the browser redirects to.
 */
app.post('/api/checkout', async (c) => {
  const body = await c.req.json<{ email?: string; ref?: string }>().catch(
    () => ({} as { email?: string; ref?: string }),
  );
  const landing = c.env.LANDING_URL;
  const form = new URLSearchParams();
  form.set('mode', 'subscription');
  form.set('line_items[0][price]', c.env.STRIPE_PRICE_ID);
  form.set('line_items[0][quantity]', '1');
  form.set('allow_promotion_codes', 'true');
  form.set('success_url', `${landing}/success?session_id={CHECKOUT_SESSION_ID}`);
  form.set('cancel_url', `${landing}/?canceled=1`);
  if (typeof body.email === 'string' && body.email.includes('@')) {
    form.set('customer_email', body.email);
  }
  if (typeof body.ref === 'string' && body.ref.length > 0 && body.ref.length <= 64) {
    form.set('metadata[ref]', body.ref);
    form.set('subscription_data[metadata][ref]', body.ref);
  }
  const stripeResp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${c.env.STRIPE_SECRET_KEY}`,
      'content-type': 'application/x-www-form-urlencoded',
      'stripe-version': '2024-06-20',
    },
    body: form.toString(),
  });
  const session = (await stripeResp.json().catch(() => ({}))) as Record<string, unknown>;
  if (!stripeResp.ok || typeof session.url !== 'string') {
    const errObj = (session.error ?? {}) as Record<string, unknown>;
    return c.json({
      error: typeof errObj.message === 'string' ? errObj.message : 'Stripe checkout failed',
      stripe_status: stripeResp.status,
    }, 500);
  }
  return c.json({ url: session.url });
});

/**
 * Success page after a completed Stripe Checkout. Kept inline so the Worker
 * doesn't need a second HTML file — the copy is short enough that a template
 * literal is cleaner than a separate asset + fetch.
 */
app.get('/success', (c) => {
  const sessionId = c.req.query('session_id') ?? '';
  const landing = c.env.LANDING_URL;
  return c.html(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Payment received — Maxbridge</title>
<style>
  :root{--ink:#1a1612;--cream:#f4efe5;--lime:#d4ff3a;--muted:#6b6258;}
  html,body{margin:0;padding:0;background:var(--cream);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;}
  main{max-width:560px;margin:64px auto;padding:0 24px;}
  h1{font-size:32px;font-weight:600;margin:0 0 12px 0;letter-spacing:-0.02em;}
  p{color:var(--muted);font-size:16px;line-height:1.6;}
  .card{border:1px solid rgba(26,22,18,0.12);background:#fff;border-radius:12px;padding:24px;margin-top:28px;}
  ol{padding-left:20px;margin:0;color:var(--muted);font-size:14px;line-height:1.7;}
  code{font-family:ui-monospace,Menlo,monospace;font-size:13px;background:rgba(26,22,18,0.06);padding:1px 6px;border-radius:4px;}
  .muted{color:var(--muted);font-size:13px;margin-top:32px;}
  .ref{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:var(--muted);word-break:break-all;}
</style>
</head><body><main>
  <h1>Payment received. ✓</h1>
  <p>Your license is minting now. We've emailed your activation file — check your inbox (including spam) for a message from <code>${c.env.FROM_EMAIL}</code> within the next minute.</p>
  ${sessionId ? `<p class="ref">Stripe session: ${sessionId.replace(/[^a-zA-Z0-9_]/g, '')}</p>` : ''}
  <div class="card">
    <h2 style="font-size:18px;margin:0 0 12px 0;">What to do next</h2>
    <ol>
      <li>Open the activation email and click <strong>Download activation file</strong> — you'll get a small <code>.md</code> file.</li>
      <li>Open Telegram (or WhatsApp / Signal — whichever channel you use for OpenClaw) on the <em>same Mac where you run OpenClaw</em>. Find your own bot chat.</li>
      <li>Drag the <code>.md</code> file into the chat and send. Your OpenClaw bot will execute the install autonomously.</li>
      <li>When the Maxbridge window asks you to log into Claude — do it. ~45 seconds, one browser tab.</li>
      <li>Your bot greets you: <em>"Opus 4.7 is live via your Max plan."</em> Ask it anything.</li>
    </ol>
  </div>
  <p class="muted">Nothing arrived? Email <a href="mailto:${c.env.FROM_EMAIL}">${c.env.FROM_EMAIL}</a> with your Stripe session id and we'll resend within minutes.</p>
  <p class="muted"><a href="${landing}">← Back to maxbridge</a></p>
</main></body></html>`);
});

/**
 * Online license status check — called by the Maxbridge client's background
 * poller every 6 hours. Returns a shape compatible with the client's
 * `validateOnline` result (see server/license/client.ts).
 */
app.get('/license/status', async (c) => {
  const key = c.req.query('key') ?? '';
  const v = await verifyLicense(key, c.env.JWT_PUBLIC_KEY);
  if (!v.valid || !v.payload) {
    return c.json({ valid: false, status: 'revoked', reason: v.reason ?? 'invalid' }, 200);
  }
  const kv = new LicenseKv(c.env.LICENSES);
  const rec = await kv.getLicense(v.payload.jti);
  const status: 'ok' | 'expired' | 'revoked' =
    !rec ? 'revoked' : rec.status === 'active' ? 'ok' : rec.status === 'lapsed' ? 'expired' : 'revoked';
  return c.json({
    ok: true,
    valid: rec?.status === 'active',
    plan: v.payload.plan,
    expiresAt: rec?.expiresAt ?? null,
    lastValidated: new Date().toISOString(),
    status,
  });
});

/**
 * Records the JWT's first (and subsequent) activations against a device id.
 * Not a hard cap in v1 — we log for audit and may later enforce limits.
 */
app.post('/license/activate', async (c) => {
  const body = await c.req.json<{ key?: string; deviceId?: string; ip?: string }>().catch(() => ({} as any));
  if (!body.key) return c.json({ ok: false, reason: 'missing_key' }, 400);
  const v = await verifyLicense(body.key, c.env.JWT_PUBLIC_KEY);
  if (!v.valid || !v.payload) return c.json({ ok: false, reason: v.reason }, 401);
  const kv = new LicenseKv(c.env.LICENSES);
  const rec = await kv.getLicense(v.payload.jti);
  if (!rec) return c.json({ ok: false, reason: 'license_not_found' }, 404);
  const at = new Date().toISOString();
  const deviceId = (body.deviceId ?? '').slice(0, 128) || 'unknown';
  rec.activations = [...(rec.activations ?? []), { deviceId, at, ip: body.ip }].slice(-20);
  await kv.putLicense(rec);
  return c.json({ ok: true, plan: rec.plan, expiresAt: rec.expiresAt, status: rec.status });
});

/**
 * install.sh — per-user render. Key can be in ?key=... or Authorization
 * bearer. Returns text/x-sh with shebang so `curl|bash` works.
 */
app.get('/v:ver/install.sh', installShHandler);
app.get('/install.sh', installShHandler);
app.get('/v:ver', installShHandler); // friendly — `curl ...install.maxbridge.ai/v0.1.0 | bash`

async function installShHandler(c: {
  req: { query: (k: string) => string | undefined; param: (k: string) => string | undefined; header: (k: string) => string | undefined };
  env: Env;
  text: (body: string, status?: number, headers?: Record<string, string>) => Response;
  json: (body: unknown, status?: number) => Response;
}): Promise<Response> {
  const freeMode = c.req.query('free') === '1';
  let key: string;

  if (freeMode) {
    // Free-launch path: mint an anonymous long-lived JWT on the fly + write
    // a KV record so online status polls validate. No email, no payment.
    const now = new Date();
    const jti = generateJti();
    key = await mintLicense({
      email: `free+${jti.slice(0, 8)}@maxbridge.local`,
      plan: 'monthly',
      jti,
      privateKeyPem: c.env.JWT_PRIVATE_KEY,
      now,
    });
    const expiresAt = new Date(now.getTime() + 3650 * 24 * 60 * 60 * 1000).toISOString(); // +10yr
    const graceUntil = new Date(now.getTime() + 3653 * 24 * 60 * 60 * 1000).toISOString();
    const kv = new LicenseKv(c.env.LICENSES);
    await kv.putLicense({
      jti,
      email: `free+${jti.slice(0, 8)}@maxbridge.local`,
      plan: 'monthly',
      issuedAt: now.toISOString(),
      expiresAt,
      graceUntil,
      activations: [],
      status: 'active',
    });
  } else {
    const authHeader = c.req.header('authorization') ?? '';
    const keyFromAuth = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
    const k = c.req.query('key') ?? keyFromAuth;
    if (!k) {
      return c.text('echo "error: missing ?key=<license> (or ?free=1 for the free build)"; exit 2\\n', 401, {
        'content-type': 'text/plain; charset=utf-8',
      });
    }
    const v = await verifyLicense(k, c.env.JWT_PUBLIC_KEY);
    if (!v.valid) {
      return c.text(`echo "error: invalid license (${v.reason})"; exit 2\\n`, 401, {
        'content-type': 'text/plain; charset=utf-8',
      });
    }
    key = k;
  }

  const sh = renderInstallSh({
    licenseJwt: key,
    dmgUrl: c.env.DMG_URL,
    dmgSha256: c.env.DMG_SHA256,
    licenseApiBase: c.env.INSTALL_API_URL,
    landingUrl: c.env.LANDING_URL,
    version: c.env.MAXBRIDGE_VERSION,
  });
  return c.text(sh, 200, { 'content-type': 'text/x-shellscript; charset=utf-8' });
}

/**
 * One-time download — Stripe checkout success page redirects here with a
 * server-minted token. Token maps to a JTI in KV; first read returns the
 * .md file and marks usedAt (subsequent reads still work; we're lenient to
 * handle users who close the tab and come back).
 */
app.get('/download/:token', async (c) => {
  const token = c.req.param('token');
  const kv = new LicenseKv(c.env.LICENSES);
  const rec = await kv.getDownloadToken(token);
  if (!rec) return c.text('Download link not found or expired.', 404);
  const license = await kv.getLicense(rec.jti);
  if (!license) return c.text('License no longer exists.', 410);
  if (!rec.usedAt) {
    rec.usedAt = new Date().toISOString();
    await kv.putDownloadToken(token, rec);
  }
  const md = renderActivationMd({
    name: license.email.split('@')[0] ?? 'friend',
    email: license.email,
    licenseJwt: await regenTokenForEmail(c.env, license),
    licenseJti: license.jti,
    installUrl: `${c.env.INSTALL_API_URL}/v${c.env.MAXBRIDGE_VERSION}`,
    version: c.env.MAXBRIDGE_VERSION,
    landingUrl: c.env.LANDING_URL,
    supportEmail: c.env.FROM_EMAIL,
    issuedAt: license.issuedAt,
  });
  const filename = `Maxbridge-activate-${license.email.replace(/[^a-z0-9]/gi, '')}.md`;
  return new Response(md, {
    status: 200,
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'private, no-store',
    },
  });
});

/**
 * Regenerate a fresh JWT for a license record. On every download we re-mint
 * so a license downloaded today has a full 35-day TTL ahead of it even if
 * the user paid weeks ago — the record's `expiresAt` is still the
 * authoritative subscription-end date from Stripe.
 */
async function regenTokenForEmail(env: Env, rec: LicenseRecord): Promise<string> {
  return mintLicense({
    email: rec.email,
    plan: rec.plan,
    jti: rec.jti,
    privateKeyPem: env.JWT_PRIVATE_KEY,
  });
}

app.post('/stripe/webhook', async (c) => {
  const sig = c.req.header('stripe-signature') ?? '';
  const raw = await c.req.text();
  const valid = await verifyStripeSignature(raw, sig, c.env.STRIPE_WEBHOOK_SECRET);
  if (!valid) return c.text('bad signature', 400);
  let evt: StripeEvent;
  try {
    evt = JSON.parse(raw) as StripeEvent;
  } catch {
    return c.text('bad json', 400);
  }
  const kv = new LicenseKv(c.env.LICENSES);

  const completed = parseCheckoutCompleted(evt);
  if (completed) {
    const now = new Date();
    const jti = generateJti();
    const token = await mintLicense({
      email: completed.email,
      plan: 'monthly',
      jti,
      privateKeyPem: c.env.JWT_PRIVATE_KEY,
      now,
    });
    const expiresAt = new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000).toISOString();
    const graceUntil = new Date(now.getTime() + 33 * 24 * 60 * 60 * 1000).toISOString();
    const rec: LicenseRecord = {
      jti,
      email: completed.email,
      plan: 'monthly',
      issuedAt: now.toISOString(),
      expiresAt,
      graceUntil,
      activations: [],
      stripeCustomerId: completed.customerId,
      stripeSubscriptionId: completed.subscriptionId,
      status: 'active',
    };
    await kv.putLicense(rec);
    // Mint a one-time download token and send the welcome email.
    const dl = generateDownloadToken();
    await kv.putDownloadToken(dl, { jti, createdAt: now.toISOString() });
    const downloadUrl = `${c.env.LANDING_URL}/download/${dl}`;
    const email = renderWelcomeEmail({
      name: completed.email.split('@')[0] ?? 'friend',
      downloadUrl,
      licenseSlug: jti.slice(0, 8),
      landingUrl: c.env.LANDING_URL,
    });
    await sendEmail({
      apiKey: c.env.RESEND_API_KEY,
      from: `Maxbridge <${c.env.FROM_EMAIL}>`,
      to: completed.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
      replyTo: c.env.FROM_EMAIL,
    });
    // Reference the minted token so lint doesn't complain; we include the
    // first 16 chars in response for debug-level observability.
    return c.json({ ok: true, jti, token_prefix: token.slice(0, 16), downloadUrl });
  }

  const paid = parseInvoicePaid(evt);
  if (paid) {
    const existing = await kv.getLicenseByStripeSubscription(paid.subscriptionId);
    if (existing) {
      const expiresAt = new Date(paid.periodEnd * 1000 + 24 * 60 * 60 * 1000).toISOString();
      const graceUntil = new Date(paid.periodEnd * 1000 + 3 * 24 * 60 * 60 * 1000).toISOString();
      existing.expiresAt = expiresAt;
      existing.graceUntil = graceUntil;
      existing.lastRenewedAt = new Date().toISOString();
      existing.status = 'active';
      await kv.putLicense(existing);
    }
    return c.json({ ok: true, handled: 'invoice.paid' });
  }

  const deleted = parseSubscriptionDeleted(evt);
  if (deleted) {
    const existing = await kv.getLicenseByStripeSubscription(deleted.subscriptionId);
    if (existing) {
      existing.status = 'lapsed';
      await kv.putLicense(existing);
    }
    return c.json({ ok: true, handled: 'customer.subscription.deleted' });
  }

  // Any other event — ACK and move on.
  return c.json({ ok: true, ignored: evt.type });
});

app.onError((err, c) => {
  console.error('[worker] error', err);
  return c.json({ ok: false, error: (err as Error).message }, 500);
});

// Suppress "imported but unused" complaint on LicensePayload (exported for
// downstream consumers who want to construct typed payloads).
export type { LicensePayload };

export default app;
