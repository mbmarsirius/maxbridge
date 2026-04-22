#!/usr/bin/env bash
#
# sign-and-notarize.sh — Spec §5.2
#
# Assumes `tauri build` has already produced a signed DMG (signing happens
# automatically because signingIdentity is set in tauri.conf.json).
#
# Usage:
#   scripts/sign-and-notarize.sh                              # auto-pick latest DMG
#   scripts/sign-and-notarize.sh path/to/Maxbridge_X.Y.Z.dmg  # explicit
#
# Required: `xcrun notarytool store-credentials "maxbridge-notarytool" …`
# must have been run once on this machine (see spec §1.5).

set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "$SCRIPT_DIR/_lib.sh"

cd "$MAXBRIDGE_ROOT"

KEYCHAIN_PROFILE="${KEYCHAIN_PROFILE:-maxbridge-notarytool}"
DMG_GLOB="src-tauri/target/release/bundle/dmg/Maxbridge_*.dmg"

# ---- Resolve DMG path ----------------------------------------------------
DMG="${1:-}"
if [[ -z "$DMG" ]]; then
  # pick the newest DMG matching the glob
  # shellcheck disable=SC2012
  DMG="$(ls -1t $DMG_GLOB 2>/dev/null | head -n1 || true)"
  [[ -n "$DMG" ]] || die "No DMG found at $DMG_GLOB — run 'npx tauri build' first."
fi
[[ -f "$DMG" ]] || die "DMG not found: $DMG"
log "Target DMG: $DMG ($(human_size "$DMG"))"

require_cmd xcrun
require_cmd codesign
require_cmd spctl

# ---- Pre-flight: verify codesign -----------------------------------------
log "Pre-flight: codesign -dv --verbose=4"
if ! CODESIGN_OUT="$(codesign -dv --verbose=4 "$DMG" 2>&1)"; then
  err "codesign inspection failed:"
  printf '%s\n' "$CODESIGN_OUT" >&2
  exit 1
fi
printf '%s\n' "$CODESIGN_OUT" >&2

grep -qE 'Authority=Developer ID Application' <<<"$CODESIGN_OUT" \
  || die "DMG is not signed with a 'Developer ID Application' authority. Check tauri.conf.json signingIdentity."

# Team ID appears like "TeamIdentifier=ABCDE12345"
if ! grep -qE 'TeamIdentifier=[A-Z0-9]{10}' <<<"$CODESIGN_OUT"; then
  die "Team ID not found in codesign output — cert may be wrong."
fi

# Hardened Runtime is required on the .app INSIDE the DMG, not the DMG itself
# (DMGs are disk-image containers and don't carry runtime flags). Mount the
# DMG read-only and inspect the embedded Maxbridge.app's codesign flags.
log "Pre-flight: verifying Hardened Runtime on the embedded .app..."
APP_MOUNT="$(mktemp -d -t maxbridge-app-mount.XXXXXX)"
trap 'hdiutil detach "$APP_MOUNT" -quiet >/dev/null 2>&1 || true; rm -rf "$APP_MOUNT" 2>/dev/null || true' EXIT
hdiutil attach "$DMG" -readonly -nobrowse -noautoopen -mountpoint "$APP_MOUNT" -quiet \
  || die "Could not mount DMG for pre-flight app inspection."
APP_PATH="$APP_MOUNT/Maxbridge.app"
[[ -d "$APP_PATH" ]] || die "Mounted DMG does not contain Maxbridge.app at expected path."
APP_CODESIGN="$(codesign -dv --verbose=4 "$APP_PATH" 2>&1 || true)"
if ! grep -qiE 'flags=.*runtime' <<<"$APP_CODESIGN"; then
  printf '%s\n' "$APP_CODESIGN" >&2
  die "Hardened Runtime flag missing on Maxbridge.app inside the DMG. Set bundle.macOS.hardenedRuntime=true + entitlements in tauri.conf.json and rebuild."
fi
hdiutil detach "$APP_MOUNT" -quiet >/dev/null 2>&1 || true
rm -rf "$APP_MOUNT" 2>/dev/null || true
trap - EXIT
ok "Pre-flight passed: Developer ID + hardened runtime (on .app) + team ID present."

# ---- Submit to notarytool ------------------------------------------------
log "Submitting to Apple notary (profile=$KEYCHAIN_PROFILE). This takes 3–10 minutes..."

SUBMIT_LOG="$(mktemp -t notary-submit.XXXXXX)"
set +e
xcrun notarytool submit "$DMG" \
  --keychain-profile "$KEYCHAIN_PROFILE" \
  --wait \
  --output-format json \
  >"$SUBMIT_LOG" 2>&1
SUBMIT_RC=$?
set -e

cat "$SUBMIT_LOG" >&2

# Parse submission id (JSON output has "id": "UUID").
SUBMISSION_ID="$(sed -n 's/.*"id": *"\([^"]*\)".*/\1/p' "$SUBMIT_LOG" | head -n1 || true)"
STATUS="$(sed -n 's/.*"status": *"\([^"]*\)".*/\1/p' "$SUBMIT_LOG" | head -n1 || true)"

rm -f "$SUBMIT_LOG"

print_log_and_fail() {
  err "Notarization failed (status=$STATUS, rc=$SUBMIT_RC)."
  if [[ -n "$SUBMISSION_ID" ]]; then
    err "Pulling full notary log for submission $SUBMISSION_ID:"
    xcrun notarytool log "$SUBMISSION_ID" \
      --keychain-profile "$KEYCHAIN_PROFILE" >&2 || true
  else
    err "Could not parse a submission id to fetch logs."
  fi
  exit 1
}

[[ "$SUBMIT_RC" -eq 0 ]] || print_log_and_fail
[[ "$STATUS" == "Accepted" ]] || print_log_and_fail

ok "Notarization accepted (submission=$SUBMISSION_ID)."

# ---- Staple --------------------------------------------------------------
log "Stapling ticket to DMG..."
xcrun stapler staple "$DMG"
ok "Staple complete."

# ---- Verify --------------------------------------------------------------
log "Gatekeeper verification: spctl --assess --type install --verbose"
ASSESS_OUT="$(spctl --assess --type install --verbose "$DMG" 2>&1 || true)"
printf '%s\n' "$ASSESS_OUT" >&2

if ! grep -qE 'accepted' <<<"$ASSESS_OUT"; then
  die "spctl did NOT accept the DMG. Gatekeeper will block users."
fi

ok "spctl accepted — DMG is ready to ship."
printf '\n%s==== Notarized DMG ====%s\n' "$C_BOLD" "$C_RESET"
printf '  Path   : %s\n' "$DMG"
printf '  Size   : %s\n' "$(human_size "$DMG")"
printf '  SHA256 : %s\n' "$(shasum -a 256 "$DMG" | awk '{print $1}')"
