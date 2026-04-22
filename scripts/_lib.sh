#!/usr/bin/env bash
# Shared helpers for Maxbridge build scripts.
# Source via:  source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

# Resolve project root = one level up from this script.
MAXBRIDGE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export MAXBRIDGE_ROOT

# Color handling — respects NO_COLOR and non-TTY stdout.
if [[ -n "${NO_COLOR:-}" || ! -t 1 ]]; then
  C_RESET=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""; C_BOLD=""
else
  C_RESET=$'\033[0m'
  C_RED=$'\033[31m'
  C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'
  C_BLUE=$'\033[34m'
  C_BOLD=$'\033[1m'
fi

_ts() { date +"%Y-%m-%dT%H:%M:%S%z"; }

log()  { printf '%s %s[INFO ]%s %s\n'  "$(_ts)" "$C_BLUE"   "$C_RESET" "$*" >&2; }
ok()   { printf '%s %s[ OK  ]%s %s\n'  "$(_ts)" "$C_GREEN"  "$C_RESET" "$*" >&2; }
warn() { printf '%s %s[WARN ]%s %s\n'  "$(_ts)" "$C_YELLOW" "$C_RESET" "$*" >&2; }
err()  { printf '%s %s[ERROR]%s %s\n'  "$(_ts)" "$C_RED"    "$C_RESET" "$*" >&2; }
die()  { err "$*"; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Required command '$1' not found in PATH."
}

human_size() {
  # portable: `du -h` rounds, prefer awk on byte count
  local f="$1"
  [[ -f "$f" ]] || { echo "missing"; return; }
  local bytes
  bytes=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f" 2>/dev/null || echo 0)
  awk -v b="$bytes" 'BEGIN{
    split("B KB MB GB TB", u);
    i=1; while (b>=1024 && i<5) { b/=1024; i++ }
    printf("%.2f %s", b, u[i]);
  }'
}
