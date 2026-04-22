#!/usr/bin/env bash
#
# publish-release.sh — Spec §6 + §8
#
# Takes a notarized DMG, signs it with the Tauri updater Ed25519 key,
# uploads DMG + .sig to Cloudflare R2, and updates latest.json.
#
# Usage:
#   scripts/publish-release.sh                 # version read from tauri.conf.json
#   scripts/publish-release.sh 0.1.1           # explicit version
#
# Required env:
#   TAURI_PRIVATE_KEY       — contents of the Ed25519 private key (or path)
#   TAURI_KEY_PASSWORD      — password for the key
#   R2_ACCESS_KEY_ID        — Cloudflare R2 access key
#   R2_SECRET_ACCESS_KEY    — Cloudflare R2 secret
#   R2_ACCOUNT_ID           — Cloudflare account id (for endpoint URL)
#   R2_BUCKET               — default: maxbridge-releases
#
# Chosen uploader: **aws CLI pointed at the R2 S3-compatible endpoint**.
# Rationale: zero extra install on GitHub runners (aws is pre-installed on
# `macos-14`), whereas rclone needs a setup step. rclone is a fine alt —
# see scripts/README.md for the switch.

set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "$SCRIPT_DIR/_lib.sh"

cd "$MAXBRIDGE_ROOT"

# ---- Resolve version -----------------------------------------------------
VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  # Cheap JSON-pluck, no jq dependency: match  "version": "x.y.z"
  VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
    src-tauri/tauri.conf.json | head -n1)"
fi
[[ -n "$VERSION" ]] || die "Could not determine version."
log "Release version: $VERSION"

DMG_NAME="Maxbridge_${VERSION}_aarch64.dmg"
# The exact name Tauri produces depends on its version; common forms:
#   Maxbridge_0.1.0_aarch64.dmg    (Tauri v2, arm64)
#   Maxbridge_0.1.0_universal.dmg  (universal binary)
# We look for the first match.
DMG_CANDIDATES=(
  "src-tauri/target/release/bundle/dmg/Maxbridge_${VERSION}_aarch64.dmg"
  "src-tauri/target/release/bundle/dmg/Maxbridge_${VERSION}_universal.dmg"
  "src-tauri/target/release/bundle/dmg/Maxbridge_${VERSION}_x64.dmg"
)
DMG=""
for c in "${DMG_CANDIDATES[@]}"; do
  if [[ -f "$c" ]]; then DMG="$c"; break; fi
done
[[ -n "$DMG" ]] || die "No DMG matching version $VERSION found under src-tauri/target/release/bundle/dmg/"
log "DMG: $DMG ($(human_size "$DMG"))"

# ---- Required env --------------------------------------------------------
: "${TAURI_PRIVATE_KEY:?TAURI_PRIVATE_KEY env var is required}"
: "${TAURI_KEY_PASSWORD:?TAURI_KEY_PASSWORD env var is required}"
: "${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID env var is required}"
: "${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY env var is required}"
: "${R2_ACCOUNT_ID:?R2_ACCOUNT_ID env var is required}"
R2_BUCKET="${R2_BUCKET:-maxbridge-releases}"
R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
PUBLIC_HOST="${PUBLIC_HOST:-releases.maxbridge.ai}"

require_cmd npx
require_cmd aws
require_cmd shasum

# ---- Sign with Tauri updater key -----------------------------------------
SIG_FILE="${DMG}.sig"
log "Signing DMG with Tauri updater key → $SIG_FILE"

# The Tauri signer reads the private key either inline or from file. Inline
# values may have literal newlines — write to a tempfile so npx sees a path.
TMP_KEY="$(mktemp -t tauri-key.XXXXXX)"
cleanup_key() { rm -f "$TMP_KEY"; }
trap cleanup_key EXIT
printf '%s' "$TAURI_PRIVATE_KEY" >"$TMP_KEY"

npx --yes @tauri-apps/cli signer sign \
  -k "$TMP_KEY" \
  -p "$TAURI_KEY_PASSWORD" \
  "$DMG"

[[ -f "$SIG_FILE" ]] || die "Signer did not produce $SIG_FILE"
SIGNATURE="$(cat "$SIG_FILE")"
ok "Updater signature written: $SIG_FILE"

# ---- Compute metadata ----------------------------------------------------
SHA256="$(shasum -a 256 "$DMG" | awk '{print $1}')"
PUB_DATE="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
BYTES="$(stat -f%z "$DMG" 2>/dev/null || stat -c%s "$DMG")"
DOWNLOAD_URL="https://${PUBLIC_HOST}/${VERSION}/${DMG_NAME}"

# ---- Upload to R2 --------------------------------------------------------
export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="auto"

aws_r2() {
  aws --endpoint-url "$R2_ENDPOINT" "$@"
}

log "Uploading DMG → s3://${R2_BUCKET}/${VERSION}/${DMG_NAME}"
aws_r2 s3 cp "$DMG" "s3://${R2_BUCKET}/${VERSION}/${DMG_NAME}" \
  --content-type "application/x-apple-diskimage"

log "Uploading signature → s3://${R2_BUCKET}/${VERSION}/${DMG_NAME}.sig"
aws_r2 s3 cp "$SIG_FILE" "s3://${R2_BUCKET}/${VERSION}/${DMG_NAME}.sig" \
  --content-type "text/plain"

ok "Artifacts uploaded."

# ---- Write latest.json ---------------------------------------------------
LATEST_JSON="$(mktemp -t latest.XXXXXX.json)"
cleanup_json() { rm -f "$LATEST_JSON"; cleanup_key; }
trap cleanup_json EXIT

# Standard Tauri updater manifest shape, matches spec §6.
cat >"$LATEST_JSON" <<EOF
{
  "version": "${VERSION}",
  "notes": "Release ${VERSION}. See CHANGELOG.md for details.",
  "pub_date": "${PUB_DATE}",
  "platforms": {
    "darwin-aarch64": {
      "url": "${DOWNLOAD_URL}",
      "signature": "${SIGNATURE}",
      "sha256": "${SHA256}",
      "size": ${BYTES}
    }
  }
}
EOF

log "latest.json preview:"
cat "$LATEST_JSON" >&2

log "Uploading latest.json → s3://${R2_BUCKET}/latest.json"
aws_r2 s3 cp "$LATEST_JSON" "s3://${R2_BUCKET}/latest.json" \
  --content-type "application/json" \
  --cache-control "public, max-age=60"

ok "latest.json published."

# ---- Optional: git tag ---------------------------------------------------
if [[ "${CREATE_GIT_TAG:-0}" == "1" ]]; then
  if git rev-parse --git-dir >/dev/null 2>&1; then
    TAG="v${VERSION}"
    if git rev-parse "$TAG" >/dev/null 2>&1; then
      warn "Tag $TAG already exists locally — skipping."
    else
      log "Creating git tag $TAG"
      git tag -a "$TAG" -m "Maxbridge $TAG"
      if [[ "${PUSH_GIT_TAG:-0}" == "1" ]]; then
        git push origin "$TAG"
        ok "Pushed tag $TAG to origin."
      else
        log "Tag created locally. Push manually: git push origin $TAG"
      fi
    fi
  else
    warn "Not a git repo — skipping tag."
  fi
fi

printf '\n%s==== Release published ====%s\n' "$C_BOLD" "$C_RESET"
printf '  Version   : %s\n' "$VERSION"
printf '  DMG       : %s\n' "$DOWNLOAD_URL"
printf '  Signature : %s.sig\n' "$DOWNLOAD_URL"
printf '  SHA256    : %s\n' "$SHA256"
printf '  Size      : %s bytes (%s)\n' "$BYTES" "$(human_size "$DMG")"
printf '  Manifest  : https://%s/latest.json\n' "$PUBLIC_HOST"
ok "Done."
