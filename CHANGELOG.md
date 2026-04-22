# Changelog

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
