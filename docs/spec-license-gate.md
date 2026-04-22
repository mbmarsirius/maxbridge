# Spec — License gate (Sprint 2)

This is the architecture spec for the license system inside Maxbridge. Once Mus signs off the choices below, implementation lives in `server/license/*.ts` and a thin Stripe-side companion in a separate `maxbridge-license-server` repo.

---

## 1. What we're protecting

- **Free trial users:** can use the bridge for 7 days from email signup, no card.
- **Paid subscribers ($12/mo):** license valid as long as the Stripe subscription is active.
- **Lifetime buyers ($89):** license valid forever, with 1 year of updates included.

What "license valid" means in practice: `POST /v1/messages` returns `200`. What "license invalid" means: `402 Payment Required` with a clear `next_step` field the wizard can render.

`/healthz`, `/v1/status`, `/v1/local-bridge`, `/v1/integrations/*` stay open even without a license — the user must be able to see the proxy is running and the wizard must be able to function pre-purchase.

---

## 2. Hybrid model — chosen architecture

Two license types, two enforcement paths:

### Type A — Lifetime keys (offline-verifiable)

Issued as a **signed JWT** at purchase time by `api.maxbridge.ai`. Payload:

```json
{
  "sub": "user@example.com",
  "plan": "lifetime",
  "iat": 1776700000,
  "updates_until": 1808236000,
  "issuer": "maxbridge.ai",
  "key_id": "v1"
}
```

Signed with an Ed25519 private key on the server. The Maxbridge app bundles the matching public key. Verification is offline and ~1ms — no network call needed at runtime. Key revocation requires shipping an updated public key in the next app version (acceptable for lifetime tier).

### Type B — Trial + subscription tokens (online check, with grace)

Issued as an opaque token (e.g., `mb_live_AbCdEfGh...`). Stored server-side with metadata. Client validates:

1. On first activation: `POST api.maxbridge.ai/v1/license/validate { token }` → returns `{ valid, plan, expires_at, last_validated }`.
2. On each subsequent app start: re-validate, refresh `last_validated`.
3. On every Nth `/v1/messages` call (N=20): re-validate in the background, non-blocking.
4. **Offline grace:** if validation fails due to network error, accept the token for **72 hours** past `last_validated`. After 72 hours offline, gate closes.

This way: trial revocation = ≤72 hours; subscription cancellation propagates within ≤72 hours; airplane-mode laptop user never gets locked out for legit usage.

---

## 3. Local storage

Path: `~/Library/Application Support/Maxbridge/license.json`.

Permissions: `0600` (user-only read/write).

Schema:

```json
{
  "version": 1,
  "licenseType": "lifetime|subscription|trial|none",
  "token": "mb_live_... or jwt token",
  "email": "user@example.com",
  "plan": "lifetime|monthly|trial",
  "issuedAt": "2026-04-20T18:00:00Z",
  "expiresAt": "2026-04-27T18:00:00Z | null",
  "lastValidatedAt": "2026-04-20T18:30:00Z",
  "lastValidationStatus": "ok|expired|revoked|network_error",
  "graceUntil": "2026-04-23T18:30:00Z"
}
```

If file missing: state is `none` → wizard prompts trial signup or license entry.

---

## 4. Decision tree (the gate's actual logic)

```
on /v1/messages request:
  state = readLicense()
  if state == none:
    return 402 { next_step: "start_trial_or_buy" }
  if licenseType == "lifetime":
    if jwt.verify(token) and now < jwt.updates_until + 365d:
      ALLOW
    elif jwt.verify(token):
      ALLOW (silently)  # past update window — feature freeze, but bridge still works
    else:
      return 402 { next_step: "lifetime_key_invalid" }
  if licenseType in ("trial", "subscription"):
    if now < expiresAt:
      ALLOW
    if now < graceUntil:
      ALLOW (with header X-Maxbridge-Grace-Active: 1)
    return 402 { next_step: "trial_expired" or "subscription_lapsed" }
```

**Background revalidation thread** runs every 6 hours:

- Calls `POST api.maxbridge.ai/v1/license/validate { token }`.
- Updates `lastValidatedAt`, `lastValidationStatus`.
- If status changes from `ok` → `expired/revoked`, immediately writes the new state — next `/v1/messages` is gated.
- If network error: `graceUntil = lastValidatedAt + 72h`, no change to permission until grace expires.

---

## 5. Routes (added to `server/proxy.ts`)

| Method | Path                          | Auth              | Body / Response                                                                |
|--------|-------------------------------|-------------------|--------------------------------------------------------------------------------|
| GET    | `/v1/license/status`          | none              | `{ licenseType, plan, expiresAt, daysRemaining, graceActive }` — wizard reads this on every render. |
| POST   | `/v1/license/start-trial`     | none              | `{ email }` → calls api.maxbridge.ai → returns `{ ok, expiresAt }` — local file written. |
| POST   | `/v1/license/activate`        | none              | `{ key }` → validates with server (or verifies JWT) → writes local file → returns `{ ok, plan, expiresAt }`. |
| POST   | `/v1/license/deactivate`      | none              | Removes local license file. Used when uninstalling or transferring to a new Mac. |

Status route example response:

```json
{
  "licenseType": "subscription",
  "plan": "monthly",
  "email": "user@example.com",
  "expiresAt": "2026-05-20T18:00:00Z",
  "daysRemaining": 30,
  "graceActive": false,
  "lastValidatedAt": "2026-04-20T18:30:00Z"
}
```

---

## 6. Server-side companion (`maxbridge-license-server` repo, separate)

Stack: Node + Hono on Cloudflare Workers (zero-server-mgmt) + D1 (SQLite at edge) + Stripe webhooks.

Tables (D1):

```sql
CREATE TABLE customers (
  id TEXT PRIMARY KEY,                  -- Stripe customer id
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE licenses (
  token TEXT PRIMARY KEY,               -- mb_live_... opaque token
  customer_id TEXT NOT NULL REFERENCES customers(id),
  plan TEXT NOT NULL,                   -- 'trial' | 'monthly' | 'lifetime'
  issued_at INTEGER NOT NULL,
  expires_at INTEGER,                   -- null for lifetime
  status TEXT NOT NULL DEFAULT 'active',-- 'active' | 'expired' | 'revoked'
  stripe_subscription_id TEXT,
  last_validated_at INTEGER
);

CREATE INDEX idx_licenses_customer ON licenses(customer_id);
```

Endpoints:

- `POST /v1/license/start-trial { email }` — issues a new trial token, expires_at = now + 7d, stores customer if new.
- `POST /v1/license/validate { token }` — returns current status; updates `last_validated_at`.
- `POST /webhooks/stripe` — receives `checkout.session.completed`, `customer.subscription.deleted`, `customer.subscription.updated`. Issues/expires/revokes accordingly.
- `POST /v1/license/issue-jwt { customer_id }` — internal, called from the Stripe webhook on lifetime purchase. Generates and emails the signed JWT.

Email flow uses Resend or Postmark. Templates in the server repo.

Public Ed25519 key for JWT verification: bundled in the Maxbridge app as `server/license/pubkey.pem`. Rotation is rare (years), shipped via app update.

---

## 7. UX integration (handoff to the wizard brief)

The wizard already has a state machine; license gating slots in as:

- **Pre-`integrations`:** if `GET /v1/license/status` returns `licenseType: "none"` or expired, show **paywall step** instead of `integrations`.
  - Two CTAs: "Start 7-day free trial" (email field, calls `/v1/license/start-trial`) and "I have a license key" (drawer, calls `/v1/license/activate`).
- **In `success` screen:** show subtle pill "Trial · 5 days left" / "Monthly · renews May 20" / "Lifetime ✓".
- **In `menu-bar`:** if grace is active, the menu shows yellow indicator + "Last verified 8h ago — connect to renew."

This is added to design brief #1 as section 3.7a in a follow-up edit, not now.

---

## 8. Implementation order

Decided sequence for Sprint 2 (in `server/license/`):

1. **`store.ts`** — read/write `license.json` with proper permissions + atomic writes (write to `.tmp` then rename).
2. **`jwt.ts`** — verify Ed25519-signed JWT against bundled pubkey.
3. **`gate.ts`** — pure decision function `decide(state, now) → { allow: bool, reason, headers }`. Unit-testable.
4. **`client.ts`** — calls to `api.maxbridge.ai`. Handles network errors as "grace-eligible".
5. **`routes.ts`** — wires status / start-trial / activate / deactivate into the proxy router.
6. **Apply gate to `passthroughMessages`** — early-return 402 when `decide()` says deny.
7. **Background revalidation timer** — `setInterval(6h)`, with jitter.
8. **Tests** — `tests/license/*.test.ts` covering decide() truth table, file ops, grace expiry.

The license server is a separate concurrent track once this spec is approved.

---

## 9. Open questions for Mus (must answer before implementation)

1. **Trial without card — confirm.** The spec assumes email-only trial. This is the lowest-friction option but means duplicate trials are easy (new email = new trial). Acceptable churn?
2. **Lifetime updates window.** Spec says "1 year of updates included, then $29/year for continued updates, or keep the last version forever." Confirm or change.
3. **Email provider for license delivery.** Resend or Postmark? Both are ~$0–10/mo at our volume.
4. **License-server hosting.** Cloudflare Workers + D1, OR a small Render/Fly node + SQLite? Both work; CF is cheaper at scale and faster globally.
5. **Refund window.** Spec says 7 days. Stripe makes 14 or 30 trivial. Pick.

When Mus answers these, implementation starts.
