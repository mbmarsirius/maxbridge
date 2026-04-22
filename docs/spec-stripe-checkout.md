# Spec — Stripe Checkout + License Server (Sprint 2)

Follow-on to `spec-license-gate.md`. This doc covers the **buy funnel**: landing page → Stripe Checkout → webhook → license issued → email sent → user installs key. And the server repo that does all of that (`maxbridge-license-server`).

---

## 1. Scope

What this spec defines:
- Stripe product and price objects.
- Checkout Session flow for each plan.
- Webhook handler that reconciles Stripe state → D1 database → license token.
- Email delivery on purchase + on trial signup.
- Landing page → server API surface.

What this spec defers:
- Team/volume licensing, affiliate program, coupon strategy — not v1.
- Tax handling — Stripe Tax on, configured per jurisdiction (Mus's company already has this enabled).

---

## 2. Stripe product structure

Two products, three prices.

**Product 1: Maxbridge (subscription)**
- Price A: `$12/month`, recurring, ID: `price_maxbridge_monthly`.
- Metadata: `plan=monthly`, `maxbridge_sku=subscription-v1`.

**Product 2: Maxbridge Lifetime**
- Price B: `$89 one-time`, ID: `price_maxbridge_lifetime`.
- Metadata: `plan=lifetime`, `maxbridge_sku=lifetime-v1`, `updates_months=12`.

**Price C (only if continued-updates is a thing): `$29/year` "Lifetime update pack"**
- ID: `price_maxbridge_updates_renewal`.
- Metadata: `plan=updates_renewal`, `maxbridge_sku=updates-v1`.
- Note: skip this in v1 launch, add post-launch based on demand.

Stripe Tax: enabled. Customer's country determined at Checkout.

---

## 3. Landing page → server API

The landing page is static (Astro). All dynamic actions talk to `api.maxbridge.ai`.

### 3.1 `POST /v1/trial/start`

Body: `{ email: string }`.

Server logic:
1. Validate email format.
2. Look up `customers` by email; insert if new.
3. Reject if this email already has an `active` trial or any paid license (friendly error: "You already have a Maxbridge license — check your inbox or [log in →]").
4. Generate new token: `mb_trial_${nanoid(32)}`.
5. Insert into `licenses` with `plan='trial'`, `expires_at = now + 7 days`, `status='active'`.
6. Send trial email with license key + download link.
7. Return `{ ok: true, expiresAt }`.

Rate limit: 3 trial requests per email per 90 days. 20 per IP per hour.

### 3.2 `POST /v1/checkout/session`

Body: `{ priceId: 'price_maxbridge_monthly' | 'price_maxbridge_lifetime', email?: string }`.

Server logic:
1. Create (or reuse if email known) a Stripe Customer.
2. Create a Stripe Checkout Session with:
   - `mode = 'subscription'` for monthly, `'payment'` for lifetime.
   - `line_items = [{ price: priceId, quantity: 1 }]`.
   - `automatic_tax = { enabled: true }`.
   - `customer_update = { name: 'auto', address: 'auto' }`.
   - `success_url = https://maxbridge.ai/activate?session_id={CHECKOUT_SESSION_ID}`.
   - `cancel_url = https://maxbridge.ai/pricing?canceled=1`.
   - `metadata = { maxbridge_plan: 'monthly'|'lifetime' }`.
3. Return `{ url: session.url }`.
4. Landing page does `window.location = url`.

### 3.3 `GET /v1/checkout/session/:session_id`

Used by the `/activate` landing page (post-purchase return).

Returns the issued license key (after the webhook has written it) or `{ status: 'pending' }` if the webhook hasn't fired yet. Client polls every 2s for up to 30s.

### 3.4 `POST /v1/license/validate`

(Already described in `spec-license-gate.md` §6.)

Body: `{ token: string }`.

Returns:
```json
{
  "valid": true,
  "plan": "monthly",
  "email": "user@example.com",
  "expiresAt": "2026-05-20T18:00:00Z",
  "status": "active"
}
```

Or for invalid:
```json
{ "valid": false, "status": "revoked", "reason": "subscription canceled" }
```

### 3.5 `POST /webhooks/stripe`

The heart of reconciliation. Handles:

| Stripe event                          | Action                                                                 |
|---------------------------------------|------------------------------------------------------------------------|
| `checkout.session.completed` (subscription) | Create `mb_live_*` license, link to `stripe_subscription_id`, set `expires_at` = subscription's current_period_end, email user. |
| `checkout.session.completed` (lifetime)     | Generate signed JWT with `plan: 'lifetime'`, `updates_until: now+365d`. Store token hash in licenses table. Email JWT + download link. |
| `customer.subscription.updated`       | Update `expires_at` to new `current_period_end`.                      |
| `customer.subscription.deleted`       | Set license `status='revoked'`. User's app will find out on next validate (within 6h) or next restart. |
| `charge.refunded`                     | Revoke the license. Email user.                                       |
| `invoice.payment_failed` (after retries) | Set license to `expires_at = now` so grace period starts immediately. |

Webhook signature verified with `stripe.webhooks.constructEvent` using `STRIPE_WEBHOOK_SECRET`. Idempotency via Stripe event id stored in a `webhook_events` table.

---

## 4. Email templates

Three templates, minimal HTML, plaintext alternative.

### 4.1 Trial started

Subject: `Your Maxbridge trial — key inside`

Body:
```
Welcome.

Your 7-day Maxbridge trial starts now.

License key:     mb_trial_AbCdEfGh...
Expires:         April 27, 2026
Download:        https://maxbridge.ai/download

To install:
 1. Download Maxbridge.dmg and drag it to Applications.
 2. Open Maxbridge. Click "I have a license key" and paste the key above.
 3. Follow the setup — 30 seconds.

Questions? Hit reply.

— Maxbridge
```

### 4.2 Subscription purchased

Subject: `Welcome to Maxbridge`

Body: same as trial but with plan details ("Monthly, renews every 20th") and receipt link.

### 4.3 Lifetime purchased

Subject: `Your Maxbridge lifetime license`

Body: includes the signed JWT token, plus a note about the 1-year updates window and how to extend.

Sent via **Resend** (recommended — simplest API, good deliverability). Fallback: Postmark.

All transactional emails have SPF/DKIM/DMARC set on the `maxbridge.ai` domain before launch.

---

## 5. Server stack — chosen architecture

**Hosting:** Cloudflare Workers.

Why:
- Zero server mgmt. Deploys via `wrangler publish`.
- Global latency <50ms (license validation calls happen on every user's laptop, globally).
- D1 (SQLite at edge) is plenty for <100k users. Free tier covers launch.
- Cheap — free tier covers expected volume for months.

**Runtime:** Hono framework (minimal, Cloudflare-native).

**Deps:** `stripe`, `@tsndr/cloudflare-worker-jwt` (for Ed25519 JWT signing), `nanoid`, `zod`.

**Secrets (via Wrangler):**
- `STRIPE_SECRET_KEY` — Stripe API key (livemode).
- `STRIPE_WEBHOOK_SECRET` — for webhook signature verification.
- `LICENSE_SIGNING_PRIVATE_KEY` — Ed25519 private key for lifetime JWTs.
- `RESEND_API_KEY` — email delivery.

**Repo layout** (`maxbridge-license-server`):
```
src/
  index.ts                 (Hono app + route registration)
  routes/
    trial.ts
    checkout.ts
    license.ts
    webhooks.ts
  services/
    stripe.ts              (wraps stripe-node)
    licenses.ts            (DB reads/writes)
    jwt.ts                 (Ed25519 signer)
    email.ts               (Resend client + template loader)
  db/
    schema.sql
    migrations/*.sql
  lib/
    rate-limit.ts
    errors.ts
emails/
  trial-started.html
  subscription-purchased.html
  lifetime-purchased.html
wrangler.toml
```

---

## 6. Critical code paths (Stripe-side)

### 6.1 Creating a Checkout Session (lifetime example)

```ts
// routes/checkout.ts
app.post('/v1/checkout/session', async (c) => {
  const { priceId, email } = await c.req.json();
  const stripe = new Stripe(c.env.STRIPE_SECRET_KEY);

  const session = await stripe.checkout.sessions.create({
    mode: priceId === 'price_maxbridge_lifetime' ? 'payment' : 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    automatic_tax: { enabled: true },
    customer_email: email,
    success_url: 'https://maxbridge.ai/activate?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: 'https://maxbridge.ai/pricing?canceled=1',
    metadata: {
      maxbridge_plan: priceId === 'price_maxbridge_lifetime' ? 'lifetime' : 'monthly',
    },
  });

  return c.json({ url: session.url });
});
```

### 6.2 Webhook: handling a completed lifetime purchase

```ts
// routes/webhooks.ts
case 'checkout.session.completed': {
  const session = event.data.object as Stripe.Checkout.Session;
  const plan = session.metadata?.maxbridge_plan;
  if (plan === 'lifetime') {
    const email = session.customer_details!.email!;
    const customerId = await upsertCustomer(env.DB, email, session.customer as string);
    const jwt = await signLifetimeJwt(env.LICENSE_SIGNING_PRIVATE_KEY, {
      sub: email, plan: 'lifetime', iat: now(), updates_until: now() + YEAR_SECS,
    });
    await insertLicense(env.DB, { token: jwt, customerId, plan: 'lifetime', expiresAt: null });
    await sendLifetimeEmail(env.RESEND_API_KEY, email, jwt);
  } else if (plan === 'monthly') {
    // ... subscription-token path
  }
  break;
}
```

### 6.3 Validation endpoint called from the Maxbridge app

```ts
// routes/license.ts
app.post('/v1/license/validate', async (c) => {
  const { token } = await c.req.json();
  const license = await findLicenseByToken(c.env.DB, token);
  if (!license) return c.json({ valid: false, status: 'not_found' });
  // Refresh last_validated_at — signals engagement.
  await updateLastValidated(c.env.DB, token);
  return c.json({
    valid: license.status === 'active' && (license.expires_at == null || license.expires_at > nowSecs()),
    plan: license.plan,
    email: license.email,
    expiresAt: license.expires_at ? new Date(license.expires_at * 1000).toISOString() : null,
    status: license.status,
  });
});
```

---

## 7. Security / trust boundaries

- **JWT private key** NEVER touches the client. Only exists as a Cloudflare Worker secret.
- **Stripe webhooks** must verify signature. Reject any request without a valid signature.
- **Landing page** never sees the license key — only the post-purchase `/activate` page, which authenticates the request by having the Stripe Checkout session_id (time-limited, one-time).
- **License validation** rate-limit: 1 req/token/minute from a single IP. Legitimate Maxbridge app revalidates every 6h, never hits this ceiling.
- **Trial abuse**: one trial per email per 90 days, one per IP per hour (both enforced). Disposable email services blocked via `disposable-email-domains` list.

---

## 8. What ships in v1 vs v1.1

**v1 launch (must-have):**
- Trial flow.
- Monthly subscription via Checkout.
- Lifetime purchase via Checkout.
- Webhook → license issuance → email.
- `/v1/license/validate` online check.
- Refund revokes license.

**v1.1 (weeks 2–4 after launch, based on user requests):**
- Self-serve license transfer between Macs (limit: 3 transfers/year).
- Volume licensing for teams.
- Updates renewal ($29/year) for lifetime licenses past year 1.
- Affiliate program.

---

## 9. Open questions for Mus

Same file as `spec-license-gate.md §9` — answer them in one place. Additionally:

1. **Stripe account entity** — use the existing company account or spin up a dedicated one for Maxbridge? Dedicated keeps the product isolated if anything goes wrong; existing is fastest to launch.
2. **Customer support channel** — just an email (`support@maxbridge.ai`) or also a Discord/Telegram? Recommend email-only at launch; community later.
3. **Launch date hard target?** With spec approved and design briefs ready, the engineering path from here is ~10–14 days of focused work (license impl + server repo + checkout wiring + signed Tauri bundle + landing page). Confirm the window.

When Mus signs off, the `maxbridge-license-server` repo gets scaffolded and the `server/license/` module gets implemented against this spec.
