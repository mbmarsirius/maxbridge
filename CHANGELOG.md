# Changelog

## v0.1.0 — 2026-04-22

First public release. Free forever under MIT license.

### Features

- Local HTTP proxy on `127.0.0.1:7423` exposing Anthropic `/v1/messages` and OpenAI `/v1/chat/completions`
- OpenClaw drag-drop install via `install-maxbridge.md` — your OpenClaw bot runs the install autonomously
- Manual install path via `curl -fsSL https://github.com/mbmarsirius/maxbridge/releases/download/v0.1.0/install.sh | bash`
- macOS 13+ on Apple Silicon (M1/M2/M3/M4)
- Claude Opus 4.7 routing via your own Claude Max or Pro subscription
- OAuth session stays in macOS Keychain (same path as the Claude CLI)
- `openclaw.json` auto-patch with timestamped backup; registers `maxbridge` as a provider and routes `main` agent to `maxbridge/claude-opus-4-7`

### Known Limitations

- Apple Silicon only at launch. Intel Mac support is not planned — the proxy runs on arm64 binary.
- The DMG is currently ad-hoc signed but not Apple-notarized yet. Notarization ticket is in Apple's queue; v0.1.1 will ship with a stapled notarization and a signed release note. The install flow uses `curl | bash` which does not set the quarantine attribute, so Gatekeeper is not triggered; if you download the DMG directly in a browser, run `xattr -rd com.apple.quarantine /Applications/Maxbridge.app` after dragging it to `/Applications`.
- One license, one Mac. `claude setup-token` must run once per install. Cross-machine sharing is explicitly unsupported.

### Requirements

- Apple Silicon Mac, macOS 13+
- Your own Claude Max or Pro subscription
- [OpenClaw](https://github.com/openclaw/openclaw) installed and running
- `claude` CLI (auto-installed via Homebrew if missing)

### Install

See [README](./README.md#install-90-seconds).

---

## Pre-v0.1.0

Private beta. Not publicly documented.
