#!/usr/bin/env bash
#
# verify-release.sh — Spec §9 verification matrix.
#
# Run this before every release. Prints a PASS/FAIL table and exits non-zero
# if any row fails. Safe to run on CI or locally.
#
# Usage:
#   scripts/verify-release.sh                                              # auto-pick
#   scripts/verify-release.sh path/to/Maxbridge.app path/to/Maxbridge.dmg  # explicit

set -uo pipefail  # NOTE: no -e — we want to report failures, not abort on them.
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "$SCRIPT_DIR/_lib.sh"

cd "$MAXBRIDGE_ROOT"

APP_PATH="${1:-}"
DMG_PATH="${2:-}"

if [[ -z "$APP_PATH" ]]; then
  APP_PATH="$(ls -1dt src-tauri/target/release/bundle/macos/Maxbridge.app 2>/dev/null | head -n1 || true)"
fi
if [[ -z "$DMG_PATH" ]]; then
  # shellcheck disable=SC2012
  DMG_PATH="$(ls -1t src-tauri/target/release/bundle/dmg/Maxbridge_*.dmg 2>/dev/null | head -n1 || true)"
fi

log "App : ${APP_PATH:-<not found>}"
log "DMG : ${DMG_PATH:-<not found>}"

# ---- Result table --------------------------------------------------------
declare -a ROW_NAMES=()
declare -a ROW_STATUS=()   # PASS / FAIL / SKIP
declare -a ROW_DETAIL=()

record() {
  ROW_NAMES+=("$1")
  ROW_STATUS+=("$2")
  ROW_DETAIL+=("$3")
}

check() {
  local name="$1"; shift
  local detail
  if detail="$("$@" 2>&1)"; then
    record "$name" PASS "$(printf '%s' "$detail" | head -n1)"
  else
    record "$name" FAIL "$(printf '%s' "$detail" | head -n3 | tr '\n' ' | ')"
  fi
}

# ---- Row 1: Developer ID Application cert present ------------------------
r1() {
  local out
  out="$(security find-identity -v -p codesigning 2>&1)" || return 1
  grep -q "Developer ID Application" <<<"$out" || { echo "$out"; return 1; }
  grep "Developer ID Application" <<<"$out" | head -n1
}
check "Developer ID Application cert present" r1

# ---- Row 2: app signed, auth chain ok ------------------------------------
r2() {
  [[ -n "$APP_PATH" && -d "$APP_PATH" ]] || { echo "APP not found"; return 1; }
  local out
  out="$(codesign -dv --verbose=4 "$APP_PATH" 2>&1)" || { echo "$out"; return 1; }
  grep -q "Authority=Developer ID Application" <<<"$out" || { echo "no Developer ID authority"; return 1; }
  grep -q "Authority=Apple Root CA"             <<<"$out" || { echo "no Apple Root CA authority"; return 1; }
  grep "Authority=" <<<"$out" | head -n1
}
check "App signed (auth chain ends in Apple Root CA)" r2

# ---- Row 3: Hardened Runtime flag on app ---------------------------------
r3() {
  [[ -n "$APP_PATH" && -d "$APP_PATH" ]] || { echo "APP not found"; return 1; }
  local out
  out="$(codesign -dvv "$APP_PATH" 2>&1)" || { echo "$out"; return 1; }
  grep -qiE 'flags=.*runtime' <<<"$out" || { echo "runtime flag missing"; return 1; }
  grep -iE 'flags=' <<<"$out" | head -n1
}
check "Hardened Runtime flag enabled" r3

# ---- Row 4: Stapler validate DMG -----------------------------------------
r4() {
  [[ -n "$DMG_PATH" && -f "$DMG_PATH" ]] || { echo "DMG not found"; return 1; }
  local out
  out="$(xcrun stapler validate "$DMG_PATH" 2>&1)" || { echo "$out"; return 1; }
  grep -qE 'worked|valid' <<<"$out" || { echo "$out"; return 1; }
  printf '%s' "$out" | tail -n1
}
check "Notarization staple valid" r4

# ---- Row 5: spctl accepts DMG --------------------------------------------
r5() {
  [[ -n "$DMG_PATH" && -f "$DMG_PATH" ]] || { echo "DMG not found"; return 1; }
  local out
  out="$(spctl --assess --type install --verbose "$DMG_PATH" 2>&1)" || { echo "$out"; return 1; }
  grep -q "accepted" <<<"$out" || { echo "$out"; return 1; }
  printf '%s' "$out" | head -n1
}
check "Gatekeeper accepts DMG (spctl)" r5

# ---- Render table --------------------------------------------------------
FAILS=0
printf '\n%s==== Verification matrix ====%s\n' "$C_BOLD" "$C_RESET"
printf '  %-50s  %-6s  %s\n' "CHECK" "RESULT" "DETAIL"
printf '  %-50s  %-6s  %s\n' "--------------------------------------------------" "------" "------"
for i in "${!ROW_NAMES[@]}"; do
  local_status="${ROW_STATUS[$i]}"
  case "$local_status" in
    PASS) color="$C_GREEN"; symbol="PASS" ;;
    FAIL) color="$C_RED";   symbol="FAIL"; FAILS=$((FAILS+1)) ;;
    *)    color="$C_YELLOW"; symbol="SKIP" ;;
  esac
  printf '  %-50s  %s%-6s%s  %s\n' \
    "${ROW_NAMES[$i]}" \
    "$color" "$symbol" "$C_RESET" \
    "${ROW_DETAIL[$i]}"
done

echo
if [[ "$FAILS" -eq 0 ]]; then
  ok "All checks passed. Safe to publish."
  exit 0
else
  err "$FAILS check(s) FAILED. Do NOT publish."
  exit 1
fi
