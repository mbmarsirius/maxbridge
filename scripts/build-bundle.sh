#!/usr/bin/env bash
#
# build-bundle.sh — Spec §4 (Approach B).
#
# Produces the two artifacts `tauri build` expects inside Resources:
#   node-runtime/           (portable Node 20.18.0 for arm64-darwin)
#   server-bundle/server.js (esbuild single-file server)
#
# Idempotent — re-running with a warm cache should take <5 seconds.

set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "$SCRIPT_DIR/_lib.sh"

cd "$MAXBRIDGE_ROOT"

# ---- Config --------------------------------------------------------------
NODE_VERSION="${NODE_VERSION:-20.18.0}"
NODE_ARCH="darwin-arm64"
NODE_TARBALL="node-v${NODE_VERSION}-${NODE_ARCH}.tar.gz"
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_TARBALL}"
NODE_CACHE_DIR="${HOME}/.cache/maxbridge-node"
NODE_CACHE_FILE="${NODE_CACHE_DIR}/${NODE_TARBALL}"

RUNTIME_DIR="${MAXBRIDGE_ROOT}/node-runtime"
BUNDLE_DIR="${MAXBRIDGE_ROOT}/server-bundle"
BUNDLE_FILE="${BUNDLE_DIR}/server.js"
ENTRYPOINT="server/index.ts"
HEALTH_PORT="${MAXBRIDGE_PORT:-7423}"
HEALTH_URL="http://127.0.0.1:${HEALTH_PORT}/healthz"

# ---- Preflight -----------------------------------------------------------
log "Maxbridge build-bundle starting (root=${MAXBRIDGE_ROOT})"

if [[ "$(uname -s)" != "Darwin" ]]; then
  die "This script must run on macOS (uname=$(uname -s))."
fi
if [[ "$(uname -m)" != "arm64" ]]; then
  die "This script requires Apple Silicon (uname -m=$(uname -m)). Intel Mac not supported for v1 — see spec §11."
fi

require_cmd curl
require_cmd tar
require_cmd npx
require_cmd node
require_cmd curl

[[ -f "$ENTRYPOINT" ]] || die "Server entrypoint not found: $ENTRYPOINT"

# ---- 1. Fetch Node runtime -----------------------------------------------
mkdir -p "$NODE_CACHE_DIR"
if [[ -f "$NODE_CACHE_FILE" ]]; then
  ok "Node runtime cache hit: $NODE_CACHE_FILE ($(human_size "$NODE_CACHE_FILE"))"
else
  log "Downloading Node ${NODE_VERSION} for ${NODE_ARCH}..."
  curl -fL --progress-bar -o "${NODE_CACHE_FILE}.tmp" "$NODE_URL"
  mv "${NODE_CACHE_FILE}.tmp" "$NODE_CACHE_FILE"
  ok "Cached at $NODE_CACHE_FILE ($(human_size "$NODE_CACHE_FILE"))"
fi

# ---- 2. Extract into node-runtime/ ---------------------------------------
EXTRACTED_NODE="${RUNTIME_DIR}/bin/node"
EXPECTED_VERSION="v${NODE_VERSION}"
REBUILD_RUNTIME=1
if [[ -x "$EXTRACTED_NODE" ]]; then
  CURRENT_VERSION="$("$EXTRACTED_NODE" --version 2>/dev/null || echo unknown)"
  if [[ "$CURRENT_VERSION" == "$EXPECTED_VERSION" ]]; then
    ok "node-runtime/ already at $CURRENT_VERSION — skipping extract."
    REBUILD_RUNTIME=0
  else
    warn "node-runtime/ has $CURRENT_VERSION, expected $EXPECTED_VERSION — re-extracting."
  fi
fi

if [[ "$REBUILD_RUNTIME" -eq 1 ]]; then
  rm -rf "$RUNTIME_DIR"
  mkdir -p "$RUNTIME_DIR"
  log "Extracting Node tarball into $RUNTIME_DIR..."
  tar xzf "$NODE_CACHE_FILE" -C "$RUNTIME_DIR" --strip-components=1
  [[ -x "$EXTRACTED_NODE" ]] || die "Extraction failed — $EXTRACTED_NODE missing."
  ok "Node runtime ready: $("$EXTRACTED_NODE" --version)"
fi

# ---- 3. esbuild the server -----------------------------------------------
mkdir -p "$BUNDLE_DIR"
log "Bundling $ENTRYPOINT → $BUNDLE_FILE ..."
npx --yes esbuild "$ENTRYPOINT" \
  --bundle \
  --platform=node \
  --target=node20 \
  --external:fsevents \
  --outfile="$BUNDLE_FILE" \
  --log-level=warning

[[ -s "$BUNDLE_FILE" ]] || die "esbuild produced no output at $BUNDLE_FILE"
ok "Bundle written ($(human_size "$BUNDLE_FILE"))"

# ---- 4. Smoke test the bundle --------------------------------------------
log "Smoke-testing bundle: $EXTRACTED_NODE $BUNDLE_FILE on port $HEALTH_PORT"

SMOKE_LOG="$(mktemp -t maxbridge-smoke.XXXXXX)"
CHILD_PID=""
cleanup_smoke() {
  if [[ -n "$CHILD_PID" ]] && kill -0 "$CHILD_PID" 2>/dev/null; then
    kill "$CHILD_PID" 2>/dev/null || true
    # give it a beat to die gracefully
    sleep 0.5
    kill -9 "$CHILD_PID" 2>/dev/null || true
  fi
  [[ -f "$SMOKE_LOG" ]] && rm -f "$SMOKE_LOG"
}
trap cleanup_smoke EXIT

MAXBRIDGE_PORT="$HEALTH_PORT" \
NODE_ENV="${NODE_ENV:-production}" \
  "$EXTRACTED_NODE" "$BUNDLE_FILE" >"$SMOKE_LOG" 2>&1 &
CHILD_PID=$!

# Poll up to 3 seconds for healthz.
OK_SMOKE=0
for i in 1 2 3 4 5 6; do
  if curl -fsS --max-time 1 "$HEALTH_URL" >/dev/null 2>&1; then
    OK_SMOKE=1
    break
  fi
  if ! kill -0 "$CHILD_PID" 2>/dev/null; then
    err "Bundle process exited early. Log:"
    cat "$SMOKE_LOG" >&2 || true
    exit 1
  fi
  sleep 0.5
done

if [[ "$OK_SMOKE" -ne 1 ]]; then
  err "Healthcheck at $HEALTH_URL never returned OK. Server log:"
  cat "$SMOKE_LOG" >&2 || true
  exit 1
fi

ok "Healthcheck passed at $HEALTH_URL"
cleanup_smoke
trap - EXIT

# ---- 5. Report -----------------------------------------------------------
printf '\n%s==== Build artifacts ====%s\n' "$C_BOLD" "$C_RESET"
printf '  Node runtime : %s  (%s)\n' "$EXTRACTED_NODE" "$("$EXTRACTED_NODE" --version)"
printf '  Runtime dir  : %s  (%s)\n' "$RUNTIME_DIR" "$(du -sh "$RUNTIME_DIR" 2>/dev/null | awk '{print $1}')"
printf '  Server bundle: %s  (%s)\n' "$BUNDLE_FILE" "$(human_size "$BUNDLE_FILE")"
ok "build-bundle complete."
