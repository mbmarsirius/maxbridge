#!/bin/bash
# Maxbridge preflight — run before handing the repo to a tester.
#
# Exits non-zero on any failure. Safe to re-run.
#
# Checks, in order:
#   - macOS 13+
#   - Node 18.17+ and npm on PATH
#   - node_modules present (runs `npm install` if missing)
#   - `npm run typecheck` clean
#   - `npm test` green
#   - `start.command` is executable
#   - No obvious secrets committed (scans tracked files for sk-ant- prefix)
#
# Does NOT boot the proxy or make live Anthropic calls — that belongs in
# manual verification (see LAUNCH_CHECKLIST.md section A).

set -u
FAIL=0

BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; CYAN=$'\033[36m'; RESET=$'\033[0m'

step()  { printf "${CYAN}==>${RESET} %s\n" "$*"; }
ok()    { printf "    ${GREEN}ok${RESET} %s\n" "$*"; }
bad()   { printf "    ${RED}FAIL${RESET} %s\n" "$*"; FAIL=1; }
warn()  { printf "    ${YELLOW}warn${RESET} %s\n" "$*"; }

cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." || { echo "cannot cd to repo"; exit 1; }
REPO="$(pwd)"
say_repo() { printf "${DIM}%s${RESET}\n" "$REPO"; }

echo "${BOLD}Maxbridge preflight${RESET}"
say_repo
echo

# --- macOS 13+ -------------------------------------------------------------
step "macOS version"
if [[ "$(uname)" != "Darwin" ]]; then
  bad "Not macOS ($(uname)). V0.1 bootstrap assumes macOS 13+."
else
  MACOS_VER="$(sw_vers -productVersion 2>/dev/null || echo unknown)"
  MACOS_MAJOR="${MACOS_VER%%.*}"
  if [[ "$MACOS_MAJOR" =~ ^[0-9]+$ ]] && [[ "$MACOS_MAJOR" -ge 13 ]]; then
    ok "macOS $MACOS_VER"
  else
    bad "macOS $MACOS_VER is older than 13 (Ventura)"
  fi
fi

# --- Node 18.17+ -----------------------------------------------------------
step "Node.js"
if ! command -v node >/dev/null 2>&1; then
  bad "node not found. Install from https://nodejs.org/"
else
  NODE_V="$(node -v | sed 's/^v//')"
  NODE_MAJOR="${NODE_V%%.*}"
  NODE_MINOR="$(echo "$NODE_V" | cut -d. -f2)"
  if [[ "$NODE_MAJOR" -lt 18 ]] || { [[ "$NODE_MAJOR" -eq 18 ]] && [[ "$NODE_MINOR" -lt 17 ]]; }; then
    bad "node $NODE_V is older than 18.17"
  else
    ok "node $NODE_V"
  fi
fi

step "npm"
if ! command -v npm >/dev/null 2>&1; then
  bad "npm not found (unusual — ships with Node)"
else
  ok "npm $(npm -v)"
fi

# --- deps ------------------------------------------------------------------
step "node_modules"
if [[ -d node_modules ]]; then
  ok "present"
else
  warn "missing — running npm install (first-run fix)…"
  if npm install; then
    ok "installed"
  else
    bad "npm install failed"
  fi
fi

# --- typecheck -------------------------------------------------------------
step "typecheck"
if npm run typecheck >/tmp/maxbridge-typecheck.log 2>&1; then
  ok "tsc --noEmit clean"
else
  bad "typecheck failed (see /tmp/maxbridge-typecheck.log)"
fi

# --- tests -----------------------------------------------------------------
step "tests"
if npm test >/tmp/maxbridge-tests.log 2>&1; then
  PASSED="$(grep -Eo 'Tests  [0-9]+ passed' /tmp/maxbridge-tests.log | head -n1 || true)"
  ok "vitest green (${PASSED:-passed})"
else
  bad "tests failed (see /tmp/maxbridge-tests.log)"
fi

# --- start.command executable ---------------------------------------------
step "start.command"
if [[ -x start.command ]]; then
  ok "executable"
else
  bad "not executable — run: chmod +x start.command"
fi

# --- secret scan (tracked files only) -------------------------------------
step "secret scan (tracked files)"
if command -v git >/dev/null 2>&1 && [[ -d .git ]]; then
  HITS="$(git ls-files -z | xargs -0 grep -I -l -E 'sk-ant-[a-zA-Z0-9_-]+' 2>/dev/null || true)"
  if [[ -z "$HITS" ]]; then
    ok "no sk-ant- tokens in tracked files"
  else
    bad "possible Anthropic key in: $HITS"
  fi
else
  warn "not a git checkout — skipping scan"
fi

echo
if [[ "$FAIL" -eq 0 ]]; then
  printf "${GREEN}PREFLIGHT PASS${RESET} — safe to hand off.\n"
  exit 0
else
  printf "${RED}PREFLIGHT FAIL${RESET} — fix the items above before sending to a tester.\n"
  exit 1
fi
