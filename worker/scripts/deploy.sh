#!/usr/bin/env bash
# Maxbridge Worker — one-shot deploy helper.
#
# Prereqs (user does once):
#   1. wrangler login
#   2. wrangler kv:namespace create LICENSES       → copy id into wrangler.toml
#   3. node scripts/gen-keypair.mjs                → copy the two PEMs aside
#   4. wrangler secret put STRIPE_SECRET_KEY       (from dashboard.stripe.com)
#   5. wrangler secret put STRIPE_WEBHOOK_SECRET   (after webhook created)
#   6. wrangler secret put JWT_PRIVATE_KEY         (paste PEM body as one line)
#   7. wrangler secret put JWT_PUBLIC_KEY          (paste PEM body as one line)
#   8. wrangler secret put RESEND_API_KEY          (from resend.com dashboard)
#
# Deploy = this script: `bash scripts/deploy.sh`
#
# Post-deploy:
#   - Note the *.workers.dev URL (or custom domain if configured).
#   - Add it as Stripe webhook endpoint (Events: checkout.session.completed,
#     invoice.paid, customer.subscription.deleted). Paste signing secret into
#     step 5 above if you skipped it.
#   - Point DNS: install.maxbridge.ai  CNAME -> maxbridge-license.<workers.dev>

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "━━ pre-deploy checks"
if ! command -v wrangler >/dev/null 2>&1; then
  if [ -x "node_modules/.bin/wrangler" ]; then
    WRANGLER="node_modules/.bin/wrangler"
  else
    echo "wrangler not installed. run: npm install" >&2
    exit 1
  fi
else
  WRANGLER="wrangler"
fi

echo "━━ typecheck"
npm run typecheck
echo "  ✅ types OK"

echo "━━ test"
npm run test
echo "  ✅ tests pass"

echo "━━ validate wrangler.toml"
if grep -q "REPLACE_WITH_KV_ID" wrangler.toml; then
  echo "  ❌ wrangler.toml still has REPLACE_WITH_KV_ID. Run:" >&2
  echo "     $WRANGLER kv:namespace create LICENSES" >&2
  echo "     then paste the returned id into wrangler.toml" >&2
  exit 2
fi
echo "  ✅ wrangler.toml looks populated"

echo "━━ deploy"
$WRANGLER deploy

echo
echo "✅ Worker deployed. Check https://dash.cloudflare.com/?to=/:account/workers/services/view/maxbridge-license for the public URL."
echo
echo "Next:"
echo "  - Add a Stripe webhook endpoint pointing at <worker_url>/stripe/webhook"
echo "  - Point install.maxbridge.ai DNS at the worker (add a custom domain in wrangler dashboard)"
