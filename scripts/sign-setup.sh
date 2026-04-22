#!/usr/bin/env bash
#
# sign-setup.sh — one-time interactive preflight for signed + notarized builds.
#
# Runs you through (in order):
#   1. Check Xcode command-line tools
#   2. Find a `Developer ID Application` cert in the keychain; if none, open
#      the page where you can create one (Xcode > Settings > Accounts OR the
#      developer.apple.com portal)
#   3. Collect your Apple ID email + Team ID + app-specific password and
#      store them in keychain under profile name `maxbridge-notarytool` so
#      subsequent `xcrun notarytool submit --keychain-profile` calls work
#      without ever touching the password again
#   4. Write the chosen signing identity into `.env.signing` which the sign
#      build picks up via APPLE_SIGNING_IDENTITY.
#
# After this succeeds, `bash scripts/build-signed.sh` will produce a signed,
# notarized, stapled DMG end-to-end.
#
# App-specific password generation (do this once, takes 30 seconds):
#   1. Open https://account.apple.com → Sign-In and Security
#   2. Under "App-Specific Passwords", click "+"
#   3. Name it "maxbridge-notarize"
#   4. Copy the abcd-efgh-ijkl-mnop string; paste when this script prompts.

set -euo pipefail

MAXBRIDGE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$MAXBRIDGE_ROOT"

say()  { printf '\n▶ %s\n' "$*"; }
ok()   { printf '  ✅ %s\n' "$*"; }
warn() { printf '  ⚠️  %s\n' "$*"; }
fail() { printf '  ❌ %s\n' "$*"; exit 1; }

say "1/4 Xcode command-line tools"
if ! xcode-select -p >/dev/null 2>&1; then
  warn "xcode-select not configured. Installing command-line tools…"
  xcode-select --install || true
  fail "Re-run this script after the Xcode command-line tools installer finishes."
fi
ok "$(xcode-select -p)"

say "2/4 Developer ID Application certificate"
IDENTITIES="$(security find-identity -p codesigning -v | grep "Developer ID Application" || true)"
if [ -z "$IDENTITIES" ]; then
  warn "No 'Developer ID Application' cert in your login keychain."
  printf '\n  Generate one of two ways (easiest first):\n\n'
  printf '  (A) Xcode path — recommended:\n'
  printf '     • Open Xcode → Settings → Accounts\n'
  printf '     • Select your Apple ID (+ add it if missing)\n'
  printf '     • Click "Manage Certificates…" → "+" → "Developer ID Application"\n'
  printf '     • Xcode installs it into your keychain automatically\n\n'
  printf '  (B) Portal path:\n'
  printf '     • Open Keychain Access → Certificate Assistant → Request a Certificate from a Certificate Authority\n'
  printf '       (email = your Apple ID, "Saved to disk", leave CA blank)\n'
  printf '     • Visit https://developer.apple.com/account/resources/certificates\n'
  printf '     • Click "+" → "Developer ID Application" → upload the CSR you just saved\n'
  printf '     • Download the .cer → double-click to install in keychain\n\n'
  read -r -p "  When the certificate is installed, press Enter to rescan... " _
  IDENTITIES="$(security find-identity -p codesigning -v | grep "Developer ID Application" || true)"
  [ -n "$IDENTITIES" ] || fail "Still no Developer ID Application cert. Check Keychain Access > My Certificates."
fi
printf '%s\n' "$IDENTITIES"
# If there's exactly one cert, pick it; otherwise prompt.
CERT_COUNT=$(printf '%s\n' "$IDENTITIES" | wc -l | awk '{print $1}')
if [ "$CERT_COUNT" = "1" ]; then
  IDENTITY="$(printf '%s' "$IDENTITIES" | sed -n 's/.*"\(Developer ID Application:.*\)".*/\1/p')"
else
  printf '\n  Multiple certs found. Paste the full identity string you want to use:\n  > '
  read -r IDENTITY
fi
[ -n "$IDENTITY" ] || fail "Empty identity."
ok "Using identity: $IDENTITY"

# Extract Team ID (last 10-char bracket block of the identity).
TEAM_ID="$(printf '%s' "$IDENTITY" | sed -n 's/.*(\([A-Z0-9]\{10\}\)).*/\1/p')"
[ -n "$TEAM_ID" ] || fail "Could not extract Team ID from identity: $IDENTITY"
ok "Team ID: $TEAM_ID"

say "3/4 Apple ID + app-specific password"
read -r -p "  Apple ID email (used for Developer account): " APPLE_ID
[ -n "$APPLE_ID" ] || fail "Email is required."

printf "\n  Paste the APP-SPECIFIC PASSWORD (format abcd-efgh-ijkl-mnop).\n"
printf "  Generate at https://account.apple.com → Sign-In and Security → App-Specific Passwords if you don't have one.\n"
printf "  Input is hidden.\n  > "
read -r -s APP_PW
printf '\n'
[ -n "$APP_PW" ] || fail "Password is required."

# Store it in keychain via notarytool so we never read/keep it in shell history.
if xcrun notarytool store-credentials "maxbridge-notarytool" \
  --apple-id "$APPLE_ID" \
  --team-id "$TEAM_ID" \
  --password "$APP_PW"; then
  ok "Stored keychain profile 'maxbridge-notarytool'."
else
  fail "notarytool store-credentials failed — password rejected or network blocked."
fi

say "4/4 Persisting identity for the build"
ENV_FILE="${MAXBRIDGE_ROOT}/src-tauri/.env.signing"
{
  printf 'APPLE_SIGNING_IDENTITY="%s"\n' "$IDENTITY"
  printf 'APPLE_ID="%s"\n' "$APPLE_ID"
  printf 'APPLE_TEAM_ID="%s"\n' "$TEAM_ID"
  printf '# Keychain profile storing the app-specific password:\n'
  printf 'MAXBRIDGE_NOTARY_PROFILE="maxbridge-notarytool"\n'
} >"$ENV_FILE"
chmod 600 "$ENV_FILE"
ok "Wrote $ENV_FILE (perms 0600)."

# Make sure it's gitignored.
if ! grep -qE '^src-tauri/\.env\.signing' "${MAXBRIDGE_ROOT}/.gitignore" 2>/dev/null; then
  printf '\nsrc-tauri/.env.signing\n' >>"${MAXBRIDGE_ROOT}/.gitignore"
  ok "Added src-tauri/.env.signing to .gitignore."
fi

printf "\n"
ok "Preflight complete. Next:"
printf "    bash scripts/build-signed.sh     # builds + notarizes + staples\n"
