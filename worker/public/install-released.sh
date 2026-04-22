#!/usr/bin/env bash
# Maxbridge installer — v0.1.0
# Generated per-user by install.maxbridge.ai. Do not edit; re-request for fresh.

set -u
export MAXBRIDGE_LICENSE="eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJwbGFuIjoibW9udGhseSIsImlzcyI6Im1heGJyaWRnZS5haSIsImF1ZCI6Im1heGJyaWRnZS1jbGllbnQiLCJzdWIiOiJmcmVlK3ZXbnZmMGFQQG1heGJyaWRnZS5sb2NhbCIsImp0aSI6InZXbnZmMGFQTTcyMVRwbWRaWFNqdXoyRCIsImlhdCI6MTc3Njg1MDA3NywiZXhwIjoyMDkyMjEwMDc3fQ.hGUVZ9FO31GARHJrzAEGl1VmT-Vbllqq013NK8V-ZuuWg2fkDhgSUTeZySZ_3pwgZvBZna51l7VQ74tiqZzCBw"
export MAXBRIDGE_DMG_URL="https://github.com/mbmarsirius/maxbridge/releases/download/v0.1.0/Maxbridge-v0.1.0.dmg"
export MAXBRIDGE_DMG_SHA256="af99fdf3d6d05c5068534248228f37f091dcca08fd1712b44d46901d082d01c2"
export MAXBRIDGE_LICENSE_API_BASE="https://install.marsirius.ai"
export MAXBRIDGE_LANDING_URL="https://maxbridge.marsirius.ai"
export MAXBRIDGE_VERSION="0.1.0"

APP_NAME="Maxbridge.app"
APP_DEST="/Applications/${APP_NAME}"
VOLUME_PATH="/Volumes/Maxbridge"
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

cleanup() {
  if [ -d "$VOLUME_PATH" ]; then
    /usr/bin/hdiutil detach "$VOLUME_PATH" -quiet >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

step "Maxbridge installer v${MAXBRIDGE_VERSION} — $(date '+%Y-%m-%d %H:%M:%S')"
printf '  log: %s\n' "$LOG_FILE"

# --- 1. preflight ---
step "1/7 preflight"
OS_MAJOR="$(sw_vers -productVersion | awk -F. '{print $1}')"
[ "$OS_MAJOR" -ge 13 ] || fail "macOS ${OS_MAJOR} too old; needs 13+."
[ "$(uname -m)" = "arm64" ] || fail "Apple Silicon required; got $(uname -m)."
ok "macOS $(sw_vers -productVersion) · Apple Silicon"

# --- 2. Dependencies: Homebrew + Claude CLI ---
step "2/7 dependencies"

# 2a) Homebrew — bootstrap if missing (non-interactive)
if ! command -v brew >/dev/null 2>&1; then
  warn "Homebrew not found — installing..."
  NONINTERACTIVE=1 /bin/bash -c "$(/usr/bin/curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" </dev/null     || fail "Homebrew install failed. Install manually from https://brew.sh then re-run."
  # Add brew to this shell's PATH without asking user to restart terminal
  if [ -x /opt/homebrew/bin/brew ]; then eval "$(/opt/homebrew/bin/brew shellenv)"; fi
  if [ -x /usr/local/bin/brew ];  then eval "$(/usr/local/bin/brew shellenv)"; fi
fi
command -v brew >/dev/null 2>&1 || fail "Homebrew still not on PATH after install. Restart Terminal and re-run."
ok "Homebrew: $(command -v brew)"

# 2b) Claude CLI — install if missing
CLAUDE_BIN=""
for candidate in "$HOME/.local/bin/claude" "/usr/local/bin/claude" "/opt/homebrew/bin/claude"; do
  [ -x "$candidate" ] && CLAUDE_BIN="$candidate" && break
done
[ -z "$CLAUDE_BIN" ] && command -v claude >/dev/null 2>&1 && CLAUDE_BIN="$(command -v claude)"
if [ -z "$CLAUDE_BIN" ]; then
  warn "Claude CLI not found — installing via Homebrew..."
  brew install anthropic/claude/claude >/dev/null 2>&1 || fail "brew install anthropic/claude/claude failed"
  CLAUDE_BIN="$(command -v claude || true)"
fi
[ -n "$CLAUDE_BIN" ] || fail "Claude CLI not installed. Install from https://claude.ai/download"
ok "Claude CLI: $CLAUDE_BIN"

# --- 3. DMG download + verify ---
step "3/7 DMG download"
TMP_DMG="$(mktemp -t maxbridge).dmg"
printf '  fetching %s ...\n' "$MAXBRIDGE_DMG_URL"
/usr/bin/curl -fL --retry 3 --max-time 300 -o "$TMP_DMG" "$MAXBRIDGE_DMG_URL" || fail "DMG download failed"
ACTUAL_SHA="$(/usr/bin/shasum -a 256 "$TMP_DMG" | awk '{print $1}')"
[ "$ACTUAL_SHA" = "$MAXBRIDGE_DMG_SHA256" ] || fail "sha256 mismatch: expected $MAXBRIDGE_DMG_SHA256, got $ACTUAL_SHA"
ok "DMG verified ($(wc -c < "$TMP_DMG" | awk '{print $1}') bytes)"

# --- 4. install app ---
step "4/7 install app"
/usr/bin/pkill -f "/Applications/${APP_NAME}/Contents/MacOS/" 2>/dev/null || true
sleep 1
/usr/bin/hdiutil attach "$TMP_DMG" -nobrowse -noautoopen -quiet || fail "hdiutil attach failed"
[ -d "$VOLUME_PATH/$APP_NAME" ] || fail "$APP_NAME not inside DMG"
[ -d "$APP_DEST" ] && /bin/rm -rf "$APP_DEST"
/bin/cp -R "$VOLUME_PATH/$APP_NAME" "/Applications/" || fail "copy failed"
/usr/bin/xattr -rd com.apple.quarantine "$APP_DEST" 2>/dev/null || true
/usr/bin/hdiutil detach "$VOLUME_PATH" -quiet >/dev/null 2>&1 || true
/bin/rm -f "$TMP_DMG" 2>/dev/null || true
ok "installed at $APP_DEST"

# --- 4.5. bake license into local license.json ---
mkdir -p "$(dirname "$LICENSE_FILE")"
/usr/bin/python3 - "$LICENSE_FILE" "$MAXBRIDGE_LICENSE" <<'PY' || warn "could not write license.json"
import json, os, sys, time, base64
path, token = sys.argv[1], sys.argv[2]
# Decode JWT payload to cache expiresAt locally — gate works offline from this.
def b64d(s):
  s = s + '=' * (-len(s) % 4)
  return json.loads(base64.urlsafe_b64decode(s).decode('utf-8'))
try:
  payload = b64d(token.split('.')[1])
except Exception as e:
  payload = {}
now = int(time.time())
iat_iso = time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime(payload.get('iat', now)))
exp = payload.get('exp', now + 35*24*3600)
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
ok "license activated locally"

# --- 5. launch + health + login ---
step "5/7 launch + login"
/usr/bin/open -a "$APP_DEST" || fail "open failed"
ok "Maxbridge launched"
HEALTH_OK=0
for _ in $(seq 1 30); do
  /usr/bin/curl -fsS --max-time 2 "$PROXY/healthz" >/dev/null 2>&1 && HEALTH_OK=1 && break
  sleep 1
done
[ "$HEALTH_OK" = 1 ] || fail "proxy did not answer /healthz within 30s"
ok "proxy up"

printf '  waiting for OAuth login (complete \`claude setup-token\` in the Maxbridge wizard) ...\n'
LOGGED_IN=0
for _ in $(seq 1 180); do
  STATUS_JSON="$(/usr/bin/curl -fsS --max-time 3 "$PROXY/v1/status" 2>/dev/null || echo '{}')"
  printf '%s' "$STATUS_JSON" | /usr/bin/grep -q '"loggedIn":true' && LOGGED_IN=1 && break
  sleep 1
done
if [ "$LOGGED_IN" != 1 ]; then
  warn "OAuth login not completed within 3 min. Complete \`claude setup-token\` in the wizard, then re-run this installer."
  printf '\nREPORT_STATUS=awaiting_login\nREPORT_PROXY=%s\nREPORT_LOG=%s\n' "$PROXY" "$LOG_FILE"
  exit 0
fi
ok "Claude Max OAuth logged in"

# --- 6. OpenClaw wire-up ---
step "6/7 OpenClaw wire-up"
if [ ! -f "$OPENCLAW_JSON" ]; then
  warn "No ~/.openclaw/openclaw.json — proxy runs standalone; skipping wire-up."
else
  BACKUP="${OPENCLAW_JSON}.bak-maxbridge-$(date +%Y%m%d-%H%M%S)"
  /bin/cp "$OPENCLAW_JSON" "$BACKUP" || fail "backup failed"
  ok "backup: $BACKUP"
  /usr/bin/python3 - "$OPENCLAW_JSON" <<'PY' || fail "openclaw.json patch failed"
import json, sys
p = sys.argv[1]
with open(p) as f: d = json.load(f)
m = d.setdefault('models', {}).setdefault('providers', {})
m['maxbridge'] = {
  'baseUrl': 'http://127.0.0.1:7423',
  'api': 'anthropic-messages',
  'models': [{'id':'claude-opus-4-7','name':'Claude Opus 4.7 (Maxbridge Max OAuth)','contextWindow':200000,'reasoning':False,'maxTokens':8000}],
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
  ok "openclaw.json patched"
fi

step "7/7 gateway reload + verify"
/usr/bin/launchctl kickstart -k "gui/$(id -u)/ai.openclaw.gateway" 2>/dev/null && ok "gateway kickstarted" || warn "gateway kickstart skipped"
sleep 6

TEST_OUT="$(/usr/bin/curl -fsS --max-time 30 -X POST "$PROXY/v1/messages" -H 'content-type: application/json' -d '{"model":"claude-opus-4-7","max_tokens":40,"messages":[{"role":"user","content":"Reply with exactly: MAXBRIDGE_LIVE"}]}' 2>/dev/null || echo '{}')"
if printf '%s' "$TEST_OUT" | /usr/bin/grep -q 'MAXBRIDGE_LIVE'; then
  ok "Opus 4.7 returned MAXBRIDGE_LIVE"
  RESULT="success"
else
  warn "end-to-end test did not return the expected marker. Raw head:"
  printf '%s\n' "$TEST_OUT" | head -c 400
  RESULT="partial"
fi

step "done — $RESULT"
printf '\nREPORT_STATUS=%s\nREPORT_PROXY=%s\nREPORT_LOG=%s\nREPORT_LANDING=%s\n' "$RESULT" "$PROXY" "$LOG_FILE" "$MAXBRIDGE_LANDING_URL"
