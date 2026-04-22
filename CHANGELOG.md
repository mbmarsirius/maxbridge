# Changelog

## v0.1.8 — 2026-04-22 (cold-install verified end-to-end)

First version confirmed working on a second Mac (beta tester, fresh account, claude CLI 2.1.90). Eight stacked fixes from v0.1.1 → v0.1.8, all root causes identified via iterative cold-install testing. Production-ready.

### The eight fixes (chronological)

| Ver. | Root cause | Fix |
|---|---|---|
| v0.1.1 | Claude CLI 2.1.90 read stdin for ~3s even with `-p <prompt>` and exited non-zero when the parent left stdin as an open-but-empty pipe | `server/local-oauth-bridge.ts` switched from `execFile` to `spawn` with `stdio: ['ignore', 'pipe', 'pipe']` — child sees immediate EOF on stdin |
| v0.1.3a | `claude setup-token` creates a long-lived OAuth token and prints it to stdout, but does NOT persist it to keychain or disk | install.sh parses the printed token out of the tee'd log with pure awk (multi-line terminal wrap handled) and writes it to three destinations: `~/.maxbridge/.env` (600), `~/.zshrc` export, and the launchd plist `EnvironmentVariables` |
| v0.1.3b | Re-running `claude setup-token` INVALIDATES the previous long-lived token for the same account, so stale lines in `~/.zshrc` would poison subsequent runs (especially on a Mac shared between two Anthropic accounts) | install.sh now wipes every `export CLAUDE_CODE_OAUTH_TOKEN=` line from `~/.zshrc`, `~/.zprofile`, `~/.bash_profile`, `~/.profile` before running `claude setup-token`, and `unset`s the current shell's var |
| v0.1.3c | Claude CLI 2.1.90 removed the `--json` flag on `claude auth status`, so the bridge's legacy probe returned `cli-not-logged-in` even when a valid token was in env | `probeLocalBridge` now fast-paths to `state: 'ready'` when `CLAUDE_CODE_OAUTH_TOKEN` starts with `sk-ant-oat01-` and is ≥40 chars. Legacy `auth status --json` probe retained as fallback for older CLIs |
| v0.1.4 | Several advanced flags (`--permission-mode`, `--tools`, `--add-dir`, `--append-system-prompt`) were renamed/reshaped across CLI versions and now reject unknown values | Minimum-viable flag set by default. The advanced flags are opt-in via env vars (`MAXBRIDGE_ENABLE_TOOLS=1`, `MAXBRIDGE_BYPASS_PERMISSIONS=1`, etc.) for power users who know their CLI version supports them |
| v0.1.6 | `proxy.ts` gates the whole local-bridge path behind `cfg.preferLocalBridge`, which defaults to `false`. Without the env var, /v1/messages fell through to BYO-API-key passthrough and returned 503 | install.sh's generated launchd plist now sets `MAXBRIDGE_PREFER_LOCAL_BRIDGE=1` + `MAXBRIDGE_BRIDGE_TIMEOUT_MS=180000` + `MAXBRIDGE_MODEL=claude-opus-4-7` |
| v0.1.7 | On Macs that had been through multiple Maxbridge generations, a zombie daemon (Tauri-era `.app`, hand-crafted launchd plist with a different label, anything bound to port 7423) survived the name-based cleanup. New daemon hit EADDRINUSE in a respawn loop; /v1/messages kept routing to the zombie | Step 2 now has a port-based nuke: `lsof -ti :7423` → SIGTERM → SIGKILL → verify free; plus a sweep of every launchctl label matching `/maxbridge/` |
| **v0.1.8** | **Claude CLI 2.1.90 elevated `--verbose` from optional to REQUIRED when `-p` is combined with `--output-format=stream-json`. The CLI exits 1 with an explicit error message.** Making it opt-in in v0.1.4 was the regression. | **`--verbose` is back in the always-on minimum set.** Other advanced flags stay opt-in. |

### Verified

On a cold Mac with claude 2.1.90, step-9 self-test returns HTTP 200 and a valid Anthropic-Messages assistant text block with `MAXBRIDGE_LIVE`. The beta tester's OpenClaw bot, after install, answers via `maxbridge/claude-opus-4-7` and passes the 5-point verification suite (config routes to maxbridge, proxy in local-oauth mode with `keySource: none`, Claude CLI has `oauthAccount`, `ANTHROPIC_API_KEY` unset, live round-trip returns `msg_localclaw_...` id).

### Remaining known gap (non-blocking)

Step 10 auto-greeting (the bot proactively messaging the user on Telegram after install) can still miss on some OpenClaw configurations where neither `channels.<chan>.allowFrom` is populated nor a recent session matches the `agent:<id>:telegram:direct:<chatId>` regex. In that case the installer prints clear instructions and the user sends one manual message to their bot instead. Tracked for v0.1.9.

---

## v0.1.1 — 2026-04-22 (same-day as v0.1.0)

Killed the Tauri GUI onboarding. Pure-CLI headless daemon install, matching the OpenClaw pattern. Same DMG, same binary, same daemon — the installer just stops opening the app window.

### Changed

- `install.sh` runs `claude setup-token` directly. Anthropic's browser login is triggered inline from the shell. No "Watching for login..." modal. The only manual step is still ~45 seconds of browser OAuth.
- After extracting the DMG, only `server-bundle/` + `node-runtime/` are copied to `~/.maxbridge/`. The `.app` wrapper and `/Applications/Maxbridge.app` are never created.
- Maxbridge now runs as a `launchd` daemon (`ai.maxbridge.proxy`), persistent across logins, auto-restarts on crash.
- Step 2 of install.sh idempotently cleans prior partial installs (daemon, `~/.maxbridge/`, legacy `/Applications/Maxbridge.app`) so retries always succeed.
- `~/.openclaw/openclaw.json` patch is no longer gated on the GUI's `/v1/status` polling — it runs every time based on `claude setup-token` success.

### Fixed

- Cold-user install where the Tauri GUI polled `/v1/status` for 3 minutes and silently failed to detect a completed keychain token, leaving `openclaw.json` unpatched.
- Double-login UX: previously the installer opened a Maxbridge GUI window that asked the user to run `claude setup-token` manually in Terminal, even though install.sh had already installed the CLI. Now install.sh does the login itself, inline.

---

## v0.1.0 — 2026-04-22

First public release. Free forever under MIT license.

### Features

- Local HTTP proxy on `127.0.0.1:7423` exposing Anthropic `/v1/messages` and OpenAI `/v1/chat/completions`
- One-paste terminal install: `curl -fsSL https://install.marsirius.ai | bash`
- Drop-in install for OpenClaw bots: [`install-maxbridge.md`](https://github.com/mbmarsirius/maxbridge/releases/download/v0.1.0/install-maxbridge.md) — same command, just executed by the bot on your Mac
- macOS 13+ on Apple Silicon (M1/M2/M3/M4)
- Claude Opus 4.7 routing via your own Claude Max or Pro subscription
- OAuth session lives in the macOS Keychain (stored by the Claude CLI, never read by Maxbridge)
- `~/.openclaw/openclaw.json` auto-patch with timestamped backup; registers `maxbridge` as a provider and routes the main agent to `maxbridge/claude-opus-4-7`
- Headless background daemon via `launchd` — no `.app`, no GUI window, no menubar icon

### Known Limitations

- Apple Silicon only. Intel Mac support is not planned — the daemon is arm64-only.
- The daemon bundle inside the release DMG is ad-hoc signed but not Apple-notarized yet. The install script uses `curl | bash`, which does not set Gatekeeper's quarantine attribute on the download, so notarization isn't required for install to work. A stapled-notarized release is on the roadmap.
- One install per Mac. `claude setup-token` must run once per Mac. Cross-machine sharing is explicitly unsupported.

### Requirements

- Apple Silicon Mac, macOS 13+
- Your own Claude Max or Pro subscription
- [OpenClaw](https://github.com/openclaw/openclaw) installed and running
- `claude` CLI (auto-installed via Homebrew if missing)

### Install

See [README](./README.md#install-one-paste-90-seconds).

---

## Pre-v0.1.0

Private beta. Not publicly documented.
