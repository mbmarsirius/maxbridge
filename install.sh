#!/usr/bin/env bash
# Maxbridge installer — v0.1.0 (tarball-only, zero-GUI)
# Pure background daemon. No .app. No macOS TCC prompts. No Tauri wizard.
# Regenerated on every request from https://install.marsirius.ai.

set -u
export MAXBRIDGE_LICENSE="eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJwbGFuIjoibW9udGhseSIsImlzcyI6Im1heGJyaWRnZS5haSIsImF1ZCI6Im1heGJyaWRnZS1jbGllbnQiLCJzdWIiOiJmcmVlK28tVUZwY1JVQG1heGJyaWRnZS5sb2NhbCIsImp0aSI6Im8tVUZwY1JVaS1tYW5tamNnSmVSRkZuTCIsImlhdCI6MTc3Njg2Njg5NCwiZXhwIjoyMDkyMjI2ODk0fQ.JC6Y7g6iVd7Yrnmm7EvtKjDi_J6pK3wlnQML4ubd53Pp_4k33vNfM2iIMLqJFK1Si-l3LLXo9Uz8F4_46t13Aw"
export MAXBRIDGE_TARBALL_URL="https://github.com/mbmarsirius/maxbridge/releases/download/v0.1.0/maxbridge-daemon-v0.1.1-darwin-arm64.tar.gz"
export MAXBRIDGE_TARBALL_SHA256="b117ebeaaf438e46b6627cde1c67957e7ceec53781c7f1ee14b087ff6e784251"
export MAXBRIDGE_LICENSE_API_BASE="https://install.marsirius.ai"
export MAXBRIDGE_LANDING_URL="https://maxbridge.marsirius.ai"
export MAXBRIDGE_VERSION="0.1.0"

MB_HOME="${HOME}/.maxbridge"
MB_SERVER_DIR="${MB_HOME}/server-bundle"
MB_NODE="${MB_HOME}/node-runtime/bin/node"
MB_PLIST="${HOME}/Library/LaunchAgents/ai.maxbridge.proxy.plist"
MB_LABEL="ai.maxbridge.proxy"
PROXY="http://127.0.0.1:7423"
OPENCLAW_JSON="${HOME}/.openclaw/openclaw.json"
LOG_DIR="${HOME}/Library/Logs/Maxbridge"
LOG_FILE="${LOG_DIR}/install-$(date +%Y%m%d-%H%M%S).log"
LICENSE_FILE="${HOME}/Library/Application Support/Maxbridge/license.json"

mkdir -p "$LOG_DIR"
exec > >(tee -a "$LOG_FILE") 2>&1

step()  { printf '\n━━ %s\n' "$*"; }
ok()    { printf '  ✅ %s\n' "$*"; }
warn()  { printf '  ⚠️  %s\n' "$*"; }
fail()  { printf '  ❌ %s\n' "$*"; exit 1; }

TMP_DIR=""
cleanup() {
  [ -n "$TMP_DIR" ] && [ -d "$TMP_DIR" ] && /bin/rm -rf "$TMP_DIR" 2>/dev/null || true
}
trap cleanup EXIT

step "Maxbridge installer v${MAXBRIDGE_VERSION} — $(date '+%Y-%m-%d %H:%M:%S')"
printf '  log: %s\n' "$LOG_FILE"

# ═══════════════════════════════════════════════════════════════
# 1/9 Pre-flight
# ═══════════════════════════════════════════════════════════════
step "1/9 pre-flight"
OS_MAJOR="$(sw_vers -productVersion | awk -F. '{print $1}')"
[ "$OS_MAJOR" -ge 13 ] || fail "macOS ${OS_MAJOR} too old; Maxbridge needs macOS 13+."
[ "$(uname -m)" = "arm64" ] || fail "Apple Silicon required; got $(uname -m). Intel Macs are not supported."
ok "macOS $(sw_vers -productVersion) · Apple Silicon"

# ═══════════════════════════════════════════════════════════════
# 2/9 Aggressive clean — kill every possible GUI leftover
# ═══════════════════════════════════════════════════════════════
step "2/9 clean any prior install (removes old Tauri .app if present)"

# 2a. Unload the launchd daemon if registered
if /bin/launchctl print "gui/$(/usr/bin/id -u)/${MB_LABEL}" >/dev/null 2>&1; then
  /bin/launchctl bootout "gui/$(/usr/bin/id -u)/${MB_LABEL}" 2>/dev/null || true
fi

# 2b. Kill every process that looks like Maxbridge (daemon, old Tauri app, node server)
/usr/bin/pkill -f "${MB_HOME}/node-runtime/bin/node" 2>/dev/null || true
/usr/bin/pkill -f "/Applications/Maxbridge.app/Contents/MacOS/" 2>/dev/null || true
/usr/bin/pkill -f "${HOME}/Applications/Maxbridge.app/Contents/MacOS/" 2>/dev/null || true
/usr/bin/pkill -x "Maxbridge" 2>/dev/null || true
/usr/bin/pkill -x "localclaw" 2>/dev/null || true
sleep 1

# 2c. Remove daemon files + launch plist
/bin/rm -rf "$MB_HOME" 2>/dev/null || true
/bin/rm -f "$MB_PLIST" 2>/dev/null || true

# 2d. NUKE any legacy Tauri .app bundle — the source of TCC prompts and
#     the old onboarding wizard popups
LEGACY_APP_PATHS=(
  "/Applications/Maxbridge.app"
  "${HOME}/Applications/Maxbridge.app"
  "/Applications/MaxBridge.app"
  "${HOME}/Downloads/Maxbridge.app"
  "${HOME}/Desktop/Maxbridge.app"
)
REMOVED_LEGACY=0
for APP_PATH in "${LEGACY_APP_PATHS[@]}"; do
  if [ -d "$APP_PATH" ]; then
    warn "removing legacy Tauri app: $APP_PATH"
    if /bin/rm -rf "$APP_PATH" 2>/dev/null; then
      REMOVED_LEGACY=1
    else
      warn "could not remove $APP_PATH (permission denied). Attempting with user-owned rm..."
      # chflags to remove locked flag, then try again
      /usr/bin/chflags -R nouchg,noschg "$APP_PATH" 2>/dev/null || true
      /bin/rm -rf "$APP_PATH" 2>/dev/null || warn "manual cleanup required: sudo rm -rf '$APP_PATH'"
    fi
  fi
done
[ "$REMOVED_LEGACY" = 1 ] && ok "old Tauri .app wrapper removed — no more GUI popups"

# 2e. Remove TCC approvals cached for the old .app (won't ask again)
/usr/bin/tccutil reset All ai.marsirius.maxbridge 2>/dev/null || true
/usr/bin/tccutil reset All com.marsirius.maxbridge 2>/dev/null || true
/usr/bin/tccutil reset All maxbridge 2>/dev/null || true

ok "previous state cleaned"

# ═══════════════════════════════════════════════════════════════
# 3/9 Homebrew (bootstrap if missing)
# ═══════════════════════════════════════════════════════════════
step "3/9 Homebrew"
if ! command -v brew >/dev/null 2>&1; then
  warn "Homebrew not found — installing (non-interactive)..."
  NONINTERACTIVE=1 /bin/bash -c "$(/usr/bin/curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" </dev/null     || fail "Homebrew install failed. Install manually from https://brew.sh, then re-run."
  if [ -x /opt/homebrew/bin/brew ]; then eval "$(/opt/homebrew/bin/brew shellenv)"; fi
  if [ -x /usr/local/bin/brew ];  then eval "$(/usr/local/bin/brew shellenv)"; fi
fi
command -v brew >/dev/null 2>&1 || fail "Homebrew still not on PATH after install. Restart Terminal and re-run."
ok "brew: $(command -v brew)"

# ═══════════════════════════════════════════════════════════════
# 4/9 Claude CLI (install if missing)
# ═══════════════════════════════════════════════════════════════
step "4/9 Claude CLI"
CLAUDE_BIN=""
for candidate in "$HOME/.local/bin/claude" "/usr/local/bin/claude" "/opt/homebrew/bin/claude"; do
  [ -x "$candidate" ] && CLAUDE_BIN="$candidate" && break
done
[ -z "$CLAUDE_BIN" ] && command -v claude >/dev/null 2>&1 && CLAUDE_BIN="$(command -v claude)"
if [ -z "$CLAUDE_BIN" ]; then
  warn "Claude CLI not found — installing via Homebrew..."
  brew install anthropic/claude/claude </dev/null >/dev/null 2>&1 || fail "brew install anthropic/claude/claude failed"
  CLAUDE_BIN="$(command -v claude || true)"
fi
[ -n "$CLAUDE_BIN" ] || fail "Claude CLI not installed. Install manually from https://claude.ai/download then re-run."
ok "claude: $CLAUDE_BIN ($("$CLAUDE_BIN" --version 2>/dev/null | head -1 || echo 'version unknown'))"

# ═══════════════════════════════════════════════════════════════
# 5/9 Anthropic OAuth login — THE ONLY MANUAL STEP
# ═══════════════════════════════════════════════════════════════
step "5/9 Claude login (Anthropic OAuth — opens your browser)"
printf '\n'
printf '  ▸ A browser window will open now on anthropic.com.\n'
printf '  ▸ Sign in with your Claude Max (or Pro) account.\n'
printf '  ▸ Approve "Build something great".\n'
printf '  ▸ This is the ONLY manual step — ~45 seconds.\n'
printf '\n'

# BEFORE setup-token runs, aggressively wipe any existing CLAUDE_CODE_OAUTH_TOKEN
# from shell RC files. Reason: setup-token creates a NEW long-lived token and
# Anthropic invalidates the previous one for this account. If an OLD token is
# left in ~/.zshrc (from a prior install, or from a different user sharing this
# Mac), the daemon could pick it up via the bridge's shell-RC fallback scan and
# use an already-invalidated credential — that was the ghost bug behind
# REPORT_STATUS=partial on Macs that had been through multiple installs or
# multiple Anthropic accounts (e.g. a couple sharing one Mac for beta testing).
for RC in "${HOME}/.zshrc" "${HOME}/.zprofile" "${HOME}/.bash_profile" "${HOME}/.profile"; do
  if [ -f "$RC" ]; then
    /usr/bin/sed -i '' '/^export CLAUDE_CODE_OAUTH_TOKEN=/d' "$RC" 2>/dev/null || true
  fi
done
# Also unset in the current shell so the fallback we removed below can't pick up
# the stale value during this installer run.
unset CLAUDE_CODE_OAUTH_TOKEN 2>/dev/null || true

if [ -r /dev/tty ]; then
  "$CLAUDE_BIN" setup-token </dev/tty || fail "claude setup-token did not complete. Run \`claude setup-token\` manually then re-run this installer."
else
  "$CLAUDE_BIN" setup-token || fail "claude setup-token failed. Run \`claude setup-token\` manually then re-run this installer."
fi

# Flush tee buffers so the setup-token output is in the log file before we grep it
sync || true
sleep 0.5

# CRITICAL: claude setup-token v2.1.90 prints the long-lived OAuth token to
# stdout ("sk-ant-oat01-…") and instructs the user to manually
# `export CLAUDE_CODE_OAUTH_TOKEN=<token>`. It does NOT save the token to the
# keychain or any config file. If we don't capture and persist this token, the
# daemon we start in step 7 has no way to authenticate when it spawns `claude`
# and /v1/messages will return empty {} — this was the #1 cause of
# REPORT_STATUS=partial in cold-user tests (2026-04-22).
CLAUDE_OAUTH_TOKEN=""
if [ -f "$LOG_FILE" ]; then
  # Token extraction — pure-awk, no multi-line regex escapes, TS-template-safe.
  #   1. awk finds the block between "Your OAuth token" and "Store this token",
  #      prints it as a single glob (no newlines added).
  #   2. tr strips all whitespace (the CLI wraps the token across terminal
  #      lines for display — we want it joined).
  #   3. grep picks the first sk-ant-oat01-... run of base64url chars.
  CLAUDE_OAUTH_TOKEN=$(/usr/bin/awk '
    /Your OAuth token/ { capture = 1; next }
    /Store this token/ { exit }
    capture { printf "%s ", $0 }
  ' "$LOG_FILE" | /usr/bin/tr -d '[:space:]' | /usr/bin/grep -oE 'sk-ant-oat01-[A-Za-z0-9_-]+' | /usr/bin/head -1)
fi

if [ -z "$CLAUDE_OAUTH_TOKEN" ]; then
  # No fallback to prior env tokens — setup-token just invalidated any prior
  # token for this account. If we couldn't capture the new one, we fail loudly
  # so the user can paste it manually and re-run.
  fail "Could not capture the OAuth token from claude setup-token output. Open $LOG_FILE, find the 'sk-ant-oat01-…' line, then re-run with: CLAUDE_CODE_OAUTH_TOKEN=<token> bash <(curl -fsSL https://raw.githubusercontent.com/mbmarsirius/maxbridge/main/install.sh)"
fi

ok "Claude Max OAuth token captured (${#CLAUDE_OAUTH_TOKEN} chars)"
# Persist token for daemon + user shells. Three destinations:
#   1. ~/.maxbridge/.env (600 perms, machine-readable)
#   2. launchd plist (step 7) — daemon inherits the token at boot, and every
#      `claude` subprocess it spawns inherits it from daemon's env
#   3. ~/.zshrc export — user's own terminal sessions pick it up too
mkdir -p "$MB_HOME"
umask 077
/bin/cat > "$MB_HOME/.env" <<ENV
# Maxbridge daemon environment — DO NOT commit. Generated $(date '+%Y-%m-%d %H:%M:%S').
CLAUDE_CODE_OAUTH_TOKEN=$CLAUDE_OAUTH_TOKEN
ENV
chmod 600 "$MB_HOME/.env"

# Write fresh ~/.zshrc export (the pre-setup-token sed already removed any
# stale prior line, so this just appends the new valid token).
if [ -n "${HOME:-}" ]; then
  ZSHRC="${HOME}/.zshrc"
  touch "$ZSHRC"
  /bin/echo "export CLAUDE_CODE_OAUTH_TOKEN="$CLAUDE_OAUTH_TOKEN"" >> "$ZSHRC"
  ok "token exported in ~/.zshrc for your terminal sessions"
fi

# ═══════════════════════════════════════════════════════════════
# 6/9 Download the daemon tarball + extract
# ═══════════════════════════════════════════════════════════════
step "6/9 download Maxbridge daemon bundle"
TMP_DIR="$(mktemp -d -t maxbridge-install)"
TMP_TAR="${TMP_DIR}/daemon.tar.gz"
printf '  fetching %s ...\n' "$MAXBRIDGE_TARBALL_URL"
/usr/bin/curl -fL --retry 3 --max-time 180 -o "$TMP_TAR" "$MAXBRIDGE_TARBALL_URL" \
  || fail "tarball download failed"
ACTUAL_SHA="$(/usr/bin/shasum -a 256 "$TMP_TAR" | awk '{print $1}')"
[ "$ACTUAL_SHA" = "$MAXBRIDGE_TARBALL_SHA256" ] || fail "sha256 mismatch: expected $MAXBRIDGE_TARBALL_SHA256, got $ACTUAL_SHA"
ok "tarball verified ($(wc -c < "$TMP_TAR" | awk '{print $1}') bytes)"

mkdir -p "$MB_HOME"
/usr/bin/tar -xzf "$TMP_TAR" -C "$MB_HOME" || fail "tar extract failed"
[ -x "$MB_NODE" ]                             || fail "node runtime missing after extract: $MB_NODE"
[ -f "$MB_SERVER_DIR/server.js" ]             || fail "server.js missing after extract"
/usr/bin/xattr -rd com.apple.quarantine "$MB_HOME" 2>/dev/null || true
ok "daemon installed at $MB_HOME"

# Bake license.json (10-year baked JWT → gate.ts sees subscription_active)
/bin/mkdir -p "$(dirname "$LICENSE_FILE")"
/usr/bin/python3 - "$LICENSE_FILE" "$MAXBRIDGE_LICENSE" <<'PY' || warn "could not write license.json"
import json, os, sys, time, base64
path, token = sys.argv[1], sys.argv[2]
def b64d(s):
  s = s + '=' * (-len(s) % 4)
  return json.loads(base64.urlsafe_b64decode(s).decode('utf-8'))
try:
  payload = b64d(token.split('.')[1])
except Exception:
  payload = {}
now = int(time.time())
iat_iso = time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime(payload.get('iat', now)))
exp = payload.get('exp', now + 3650*24*3600)
exp_iso = time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime(exp))
grace_iso = time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime(exp + 2*3600))
state = {
  'version': 1,
  'licenseType': 'subscription' if payload.get('plan') == 'monthly' else (payload.get('plan') or 'subscription'),
  'token': token,
  'email': payload.get('sub', ''),
  'plan': payload.get('plan', 'monthly'),
  'issuedAt': iat_iso,
  'expiresAt': exp_iso,
  'lastValidatedAt': time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime(now)),
  'lastValidationStatus': 'ok',
  'graceUntil': grace_iso,
}
tmp = path + '.tmp'
with open(tmp, 'w') as f: json.dump(state, f, indent=2)
os.chmod(tmp, 0o600)
os.rename(tmp, path)
PY

# ═══════════════════════════════════════════════════════════════
# 7/9 launchd daemon (persistent, auto-restart on crash)
# ═══════════════════════════════════════════════════════════════
step "7/9 start Maxbridge daemon (launchd)"
mkdir -p "$(dirname "$MB_PLIST")"

# Embed the captured OAuth token directly in the plist env so the daemon — and
# any `claude` CLI it spawns — inherits the credential at boot without
# requiring ~/.zshrc sourcing or keychain access. This is what unblocks
# /v1/messages for a clean install.
PLIST_OAUTH_ENTRY=""
if [ -n "$CLAUDE_OAUTH_TOKEN" ]; then
  # XML-escape the token (it's base64url so no entities needed, but be safe)
  PLIST_OAUTH_ENTRY="        <key>CLAUDE_CODE_OAUTH_TOKEN</key><string>${CLAUDE_OAUTH_TOKEN}</string>"
fi

cat > "$MB_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>${MB_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${MB_NODE}</string>
        <string>${MB_SERVER_DIR}/server.js</string>
    </array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>${LOG_DIR}/daemon.out.log</string>
    <key>StandardErrorPath</key><string>${LOG_DIR}/daemon.err.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key><string>production</string>
        <key>HOME</key><string>${HOME}</string>
        <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${HOME}/.local/bin</string>
        <!--
          CRITICAL: preferLocalBridge=1 tells proxy.ts:334 to route /v1/messages
          through the local Claude CLI OAuth bridge. Without it the proxy falls
          through to BYO-API-key passthrough and returns 503 when no API key is
          set, even if CLAUDE_CODE_OAUTH_TOKEN is present in env. Root cause of
          every 503 on a fresh daemon install up to and including v0.1.4.
        -->
        <key>MAXBRIDGE_PREFER_LOCAL_BRIDGE</key><string>1</string>
        <!--
          Opus 4.7 can think for a while on complex prompts. 180s matches Mus's
          proven local dev daemon config. Default (90s) is too tight and causes
          false OpenClaw-gateway timeouts → fallback to non-Maxbridge models.
        -->
        <key>MAXBRIDGE_BRIDGE_TIMEOUT_MS</key><string>180000</string>
        <key>MAXBRIDGE_MODEL</key><string>claude-opus-4-7</string>
${PLIST_OAUTH_ENTRY}
    </dict>
</dict>
</plist>
PLIST

# Lock down plist perms (contains OAuth token)
chmod 600 "$MB_PLIST" 2>/dev/null || true

/bin/launchctl bootstrap "gui/$(/usr/bin/id -u)" "$MB_PLIST" 2>&1 | /usr/bin/grep -v "already loaded" || true

# Wait for /healthz
HEALTH_OK=0
for _ in $(seq 1 30); do
  /usr/bin/curl -fsS --max-time 2 "$PROXY/healthz" >/dev/null 2>&1 && HEALTH_OK=1 && break
  sleep 1
done
[ "$HEALTH_OK" = 1 ] || fail "daemon did not answer /healthz within 30s. Check $LOG_DIR/daemon.err.log"
ok "daemon up on 127.0.0.1:7423"

# ═══════════════════════════════════════════════════════════════
# 8/9 OpenClaw wire-up
# ═══════════════════════════════════════════════════════════════
step "8/9 OpenClaw wire-up"
if [ ! -f "$OPENCLAW_JSON" ]; then
  warn "No ~/.openclaw/openclaw.json found. Maxbridge is running as a standalone proxy on 127.0.0.1:7423 — point any tool there manually."
else
  BACKUP="${OPENCLAW_JSON}.bak-maxbridge-$(date +%Y%m%d-%H%M%S)"
  /bin/cp "$OPENCLAW_JSON" "$BACKUP" || fail "backup failed"
  ok "backup saved: $BACKUP"
  /usr/bin/python3 - "$OPENCLAW_JSON" <<'PY' || fail "openclaw.json patch failed"
import json, sys
p = sys.argv[1]
with open(p) as f: d = json.load(f)
m = d.setdefault('models', {}).setdefault('providers', {})
m['maxbridge'] = {
  'baseUrl': 'http://127.0.0.1:7423',
  'api': 'anthropic-messages',
  'models': [{'id':'claude-opus-4-7','name':'Claude Opus 4.7 (Maxbridge · your Max plan)','contextWindow':200000,'reasoning':False,'maxTokens':8000}],
}
a = d.setdefault('agents', {})
de = a.setdefault('defaults', {})
dm = de.setdefault('model', {})
old = dm.get('primary')
dm['primary'] = 'maxbridge/claude-opus-4-7'
fb = dm.setdefault('fallbacks', [])
if old and old != 'maxbridge/claude-opus-4-7' and old not in fb: fb.insert(0, old)
dm['fallbacks'] = fb
if de.get('timeoutSeconds', 0) < 300: de['timeoutSeconds'] = 300
de.setdefault('llm', {})
if de['llm'].get('idleTimeoutSeconds', 0) < 240: de['llm']['idleTimeoutSeconds'] = 240
for ag in a.get('list', []):
  if ag.get('id') == 'main':
    mm = ag.setdefault('model', {})
    omain = mm.get('primary')
    mm['primary'] = 'maxbridge/claude-opus-4-7'
    if omain and omain != 'maxbridge/claude-opus-4-7':
      fbm = mm.setdefault('fallbacks', [])
      if omain not in fbm: fbm.insert(0, omain)
    break
with open(p, 'w') as f: json.dump(d, f, indent=2)
PY
  ok "openclaw.json patched — main agent routed to maxbridge/claude-opus-4-7"

  if /bin/launchctl print "gui/$(/usr/bin/id -u)/ai.openclaw.gateway" >/dev/null 2>&1; then
    /bin/launchctl kickstart -k "gui/$(/usr/bin/id -u)/ai.openclaw.gateway" && ok "openclaw gateway kickstarted" || warn "gateway kickstart failed — restart OpenClaw manually"
  else
    warn "openclaw gateway launchd job not found — if you run openclaw from the CLI, restart it manually to pick up the new config"
  fi
fi

# ═══════════════════════════════════════════════════════════════
# 9/9 Self-test: actual Opus 4.7 round-trip via Maxbridge
# ═══════════════════════════════════════════════════════════════
step "9/9 end-to-end test (Opus 4.7 round-trip)"
sleep 3

# Capture full response (body + HTTP status) — no -f flag this time so we
# actually SEE errors instead of just the fallback {}.
TEST_TMP="$(mktemp -t maxbridge-test-XXXXXX)"
TEST_HTTP=$(/usr/bin/curl -sS --max-time 45 -o "$TEST_TMP" -w '%{http_code}' \
  -X POST "$PROXY/v1/messages" \
  -H 'content-type: application/json' \
  -d '{"model":"claude-opus-4-7","max_tokens":40,"messages":[{"role":"user","content":"Reply with exactly: MAXBRIDGE_LIVE"}]}' \
  2>/dev/null || echo "000")
TEST_BODY=$(/bin/cat "$TEST_TMP" 2>/dev/null | /usr/bin/head -c 2000)
/bin/rm -f "$TEST_TMP"

printf '  HTTP status: %s\n' "$TEST_HTTP"

# STRICT match — HTTP 200 + actual Claude-Messages content-text shape. The
# old grep matched MAXBRIDGE_LIVE anywhere in the body (including 503 error
# bodies that echoed the prompt), producing false positives. The daemon's
# real success body looks like:
#   {"content":[{"type":"text","text":"MAXBRIDGE_LIVE"}],...}
if [ "$TEST_HTTP" = "200" ] && printf '%s' "$TEST_BODY" | /usr/bin/grep -q '"text":"MAXBRIDGE_LIVE"'; then
  ok "Opus 4.7 returned MAXBRIDGE_LIVE (HTTP 200, valid assistant-text shape)"
  RESULT="success"
else
  if [ "$TEST_HTTP" = "200" ]; then
    warn "HTTP 200 but assistant text did not match expected marker — body may have routed through a fallback model"
  else
    warn "end-to-end test failed with HTTP $TEST_HTTP"
  fi
  printf '  response body (first 2KB):\n'
  printf '    %s\n' "$TEST_BODY" | /usr/bin/sed 's/^/    /' | /usr/bin/head -20
  printf '\n  last 30 lines of daemon stderr log:\n'
  if [ -f "$LOG_DIR/daemon.err.log" ]; then
    /usr/bin/tail -30 "$LOG_DIR/daemon.err.log" 2>/dev/null | /usr/bin/sed 's/^/    /'
  else
    printf '    (no daemon.err.log yet)\n'
  fi
  printf '\n  last 30 lines of daemon stdout log:\n'
  if [ -f "$LOG_DIR/daemon.out.log" ]; then
    /usr/bin/tail -30 "$LOG_DIR/daemon.out.log" 2>/dev/null | /usr/bin/sed 's/^/    /'
  fi
  printf '\n  claude CLI version (matters for flag compatibility):\n'
  "$CLAUDE_BIN" --version 2>&1 | /usr/bin/sed 's/^/    /' || true
  printf '\n  daemon launchd plist env includes:\n'
  /usr/bin/grep -oE '<key>[A-Z_]*</key>\s*<string>[^<]*</string>' "$MB_PLIST" 2>/dev/null | /usr/bin/sed 's/^/    /' | /usr/bin/head -15 || true
  RESULT="partial"
fi

# ═══════════════════════════════════════════════════════════════
# 10/10 Bot greeting + session refresh (best-effort, non-blocking)
# ═══════════════════════════════════════════════════════════════
# Goal: user's Telegram (or any other configured channel) bot proactively
# greets them so they don't have to open Telegram, type /status, /model,
# /restart, or any of the other commands just to verify Maxbridge works.
#
# Universal: OpenClaw is open-source and users can be on any version + any
# custom config. We scan multiple install paths, parse openclaw.json
# defensively, and fall back to a clear copy-paste manual path on ANY
# failure. The greeting never blocks install success.
step "10/10 bot greeting (best-effort)"

OPENCLAW_BIN=""
for candidate in \
    "${HOME}/.npm-global/bin/openclaw" \
    "/opt/homebrew/bin/openclaw" \
    "/usr/local/bin/openclaw" \
    "${HOME}/.local/bin/openclaw" \
    "${HOME}/.bun/bin/openclaw" \
    "${HOME}/.cargo/bin/openclaw"; do
  [ -x "$candidate" ] && OPENCLAW_BIN="$candidate" && break
done
[ -z "$OPENCLAW_BIN" ] && OPENCLAW_BIN="$(command -v openclaw 2>/dev/null || true)"

PRIMARY_CHAT=""
PRIMARY_CHANNEL=""

# Strategy A: parse openclaw.json for allowFrom (works for Macs where the owner
# explicitly pinned their chat ID in the config).
if [ -n "$OPENCLAW_BIN" ] && [ -f "$OPENCLAW_JSON" ]; then
  PARSED=$(/usr/bin/python3 - "$OPENCLAW_JSON" <<'PY' || true
import json, sys
try:
    with open(sys.argv[1]) as f: d = json.load(f)
    channels = d.get("channels", {}) or {}
    for chan_name in ("telegram", "discord"):
        chan = channels.get(chan_name, {}) or {}
        if chan.get("enabled") is False:
            continue
        for acc_name, acc in (chan.get("accounts", {}) or {}).items():
            if acc.get("enabled") is False:
                continue
            for v in acc.get("allowFrom", []) or []:
                v = str(v)
                if v and v != "*":
                    print(f"{chan_name} {v}")
                    sys.exit(0)
        for v in chan.get("allowFrom", []) or []:
            v = str(v)
            if v and v != "*":
                print(f"{chan_name} {v}")
                sys.exit(0)
except Exception:
    pass
PY
  )
  if [ -n "$PARSED" ]; then
    PRIMARY_CHANNEL=$(echo "$PARSED" | awk '{print $1}')
    PRIMARY_CHAT=$(echo "$PARSED" | awk '{print $2}')
  fi
fi

# Strategy B: fall back to the most recent active Telegram session (works for
# Macs where allowFrom isn't pinned — config-by-default lets any user DM the
# bot, so "primary user" = whoever actually DMs it most recently).
# Session keys look like:  agent:<agentId>:telegram:direct:<chatId>
if [ -z "$PRIMARY_CHAT" ] && [ -n "$OPENCLAW_BIN" ]; then
  PARSED=$("$OPENCLAW_BIN" sessions --active 10080 --all-agents --json 2>/dev/null \
    | /usr/bin/python3 - <<'PY' || true
import json, sys, re
try:
    d = json.load(sys.stdin)
    sessions = d.get("sessions", []) or []
    # newest first
    sessions.sort(key=lambda s: s.get("updatedAt", 0), reverse=True)
    for s in sessions:
        key = s.get("key", "")
        m = re.match(r"^agent:[^:]+:(telegram|discord):[^:]+:(.+)$", key)
        if m:
            chan, chat = m.group(1), m.group(2)
            if chat and chat != "*":
                print(f"{chan} {chat}")
                sys.exit(0)
except Exception:
    pass
PY
  )
  if [ -n "$PARSED" ]; then
    PRIMARY_CHANNEL=$(echo "$PARSED" | awk '{print $1}')
    PRIMARY_CHAT=$(echo "$PARSED" | awk '{print $2}')
  fi
fi

GREETING="🎉 Maxbridge active. I'm now running Claude Opus 4.7 through your Max subscription — no API key, no extra billing. Ask me anything. (Type /status anytime to verify the active model.)"

if [ -n "$OPENCLAW_BIN" ] && [ -n "$PRIMARY_CHAT" ] && [ -n "$PRIMARY_CHANNEL" ]; then
  # Clean stale session cache so fresh sessions pick up the new default model.
  # --fix-missing: prune transcripts without backing files. Harmless on clean runs.
  "$OPENCLAW_BIN" sessions cleanup --all-agents --fix-missing >/dev/null 2>&1 || true

  if "$OPENCLAW_BIN" message send --channel "$PRIMARY_CHANNEL" -t "$PRIMARY_CHAT" -m "$GREETING" >/dev/null 2>&1; then
    ok "bot greeting sent via $PRIMARY_CHANNEL to chat $PRIMARY_CHAT — check your phone"
    GREETING_DELIVERED=1
  else
    warn "$PRIMARY_CHANNEL message-send failed (bot token invalid, CLI version skew, or gateway not running)"
    GREETING_DELIVERED=0
  fi
else
  if [ -z "$OPENCLAW_BIN" ]; then
    warn "openclaw CLI not on PATH — skipping auto-greeting"
  elif [ ! -f "$OPENCLAW_JSON" ]; then
    warn "~/.openclaw/openclaw.json not found — skipping auto-greeting"
  else
    warn "could not detect primary chat ID in openclaw.json (no allowFrom list found) — skipping auto-greeting"
  fi
  GREETING_DELIVERED=0
fi

# ═══════════════════════════════════════════════════════════════
# Final summary — tailored to whether greeting was delivered
# ═══════════════════════════════════════════════════════════════
step "done — $RESULT"
printf '\n'
if [ "$RESULT" = "success" ]; then
  printf '  🎉 Maxbridge is live.\n\n'
  printf '     Your OpenClaw main agent now routes to Claude Opus 4.7\n'
  printf '     through your Max subscription. No API key, no extra billing.\n'
  printf '     Daemon runs in the background — no app window, no menubar icon.\n\n'

  if [ "${GREETING_DELIVERED:-0}" = "1" ]; then
    printf '  📱 Your bot just messaged you on %s — open it to reply and start using Opus 4.7.\n' "$PRIMARY_CHANNEL"
    printf '     If /status still shows your previous model, type /model once in the bot chat to refresh.\n\n'
  else
    printf '  📱 Open Telegram (or whichever channel your OpenClaw bot uses).\n'
    printf '     Send any message to your bot — the reply will come via Opus 4.7.\n'
    printf '     If /status still shows your old model, type /model once to refresh.\n\n'
  fi
fi
printf 'REPORT_STATUS=%s\nREPORT_PROXY=%s\nREPORT_LOG=%s\nREPORT_LANDING=%s\nGREETING_DELIVERED=%s\n' "$RESULT" "$PROXY" "$LOG_FILE" "$MAXBRIDGE_LANDING_URL" "${GREETING_DELIVERED:-0}"
