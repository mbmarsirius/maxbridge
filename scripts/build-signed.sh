#!/usr/bin/env bash
#
# build-signed.sh — full signed + notarized + stapled DMG build.
#
# Prereqs: `bash scripts/sign-setup.sh` has been run and wrote
# `src-tauri/.env.signing`. That env file holds APPLE_SIGNING_IDENTITY and
# the notary keychain profile name.
#
# Steps:
#   1. Rebuild the embedded server bundle (latest code)
#   2. `npm run tauri:build` with APPLE_SIGNING_IDENTITY exported so codesign
#      signs the .app with hardened runtime
#   3. Run scripts/sign-and-notarize.sh (submits to Apple notary, waits,
#      staples, verifies with spctl)
#   4. Copy the stapled DMG to dist-friend/ and update its sha256

set -euo pipefail
MAXBRIDGE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$MAXBRIDGE_ROOT"

ENV_FILE="src-tauri/.env.signing"
if [ ! -f "$ENV_FILE" ]; then
  echo "❌ $ENV_FILE missing. Run: bash scripts/sign-setup.sh" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "$ENV_FILE"
: "${APPLE_SIGNING_IDENTITY:?APPLE_SIGNING_IDENTITY not set in $ENV_FILE}"
: "${MAXBRIDGE_NOTARY_PROFILE:?MAXBRIDGE_NOTARY_PROFILE not set in $ENV_FILE}"
export APPLE_SIGNING_IDENTITY
export APPLE_ID APPLE_TEAM_ID

echo "━━ rebuild server bundle"
bash scripts/build-bundle.sh

echo "━━ tauri build (signed)"
npm run tauri:build

DMG="$(ls -1t src-tauri/target/release/bundle/dmg/Maxbridge_*.dmg 2>/dev/null | head -n1 || true)"
[ -n "$DMG" ] || { echo "❌ No DMG produced." >&2; exit 2; }
echo "  DMG: $DMG"

echo "━━ notarize + staple"
KEYCHAIN_PROFILE="$MAXBRIDGE_NOTARY_PROFILE" bash scripts/sign-and-notarize.sh "$DMG"

echo "━━ stage in dist-friend/"
mkdir -p dist-friend
STAGED="dist-friend/Maxbridge-v0.1.0-signed.dmg"
cp "$DMG" "$STAGED"
SHA="$(shasum -a 256 "$STAGED" | awk '{print $1}')"
echo "  $STAGED"
echo "  sha256: $SHA"

echo
echo "✅ Signed build ready."
echo "  DMG URL (for worker env DMG_URL): upload this to cdn.maxbridge.ai/v0.1.0/Maxbridge.dmg"
echo "  DMG_SHA256 (for worker env): $SHA"
