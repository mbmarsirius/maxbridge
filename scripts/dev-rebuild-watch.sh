#!/usr/bin/env bash
#
# dev-rebuild-watch.sh — watch server/ and rebuild server-bundle/server.js
# on every change. No signing, no notarization — dev loop only.
#
# Prereq:  chokidar-cli is available via npx (installed on demand).
# Document, don't force: run `npm i -D chokidar-cli` if you want it
# local-cached, otherwise `npx --yes chokidar-cli` fetches it once.

set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "$SCRIPT_DIR/_lib.sh"

cd "$MAXBRIDGE_ROOT"

ENTRYPOINT="server/index.ts"
OUT="server-bundle/server.js"

require_cmd npx

rebuild() {
  log "Rebuilding server bundle..."
  mkdir -p "$(dirname "$OUT")"
  if npx --yes esbuild "$ENTRYPOINT" \
      --bundle --platform=node --target=node20 \
      --external:fsevents \
      --outfile="$OUT" \
      --log-level=warning; then
    ok "Rebuilt $OUT ($(human_size "$OUT"))"
  else
    err "esbuild failed — fix the error and save again."
  fi
}

# Recursive-invocation hook: when chokidar fires, it invokes this script
# with --once. We rebuild and exit immediately.
if [[ "${1:-}" == "--once" ]]; then
  rebuild
  exit 0
fi

# Initial build before starting watcher.
rebuild

log "Watching server/ for changes — Ctrl+C to stop."
exec npx --yes chokidar-cli "server/**/*.ts" "server/**/*.js" \
  --initial=false \
  --command "'$SCRIPT_DIR/dev-rebuild-watch.sh' --once"
