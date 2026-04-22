<div align="center">

<img width="4800" height="1280" alt="maxbridge-lockup-lime" src="https://github.com/user-attachments/assets/404a17d8-6ad4-49be-abeb-5c41b8c24e0d" />



**Use your Claude Max in OpenClaw. Free.**

A tiny local bridge that pipes your Claude Max subscription into OpenClaw.
Same machine. No API key. No extra bill. No catches.

[**Install Maxbridge — Free**](https://maxbridge.marsirius.ai) · [Website](https://maxbridge.marsirius.ai) · [Report an issue](https://github.com/mbmarsirius/maxbridge/issues)

</div>

---

## What it is

Maxbridge is a small macOS app. It runs a local HTTP proxy on `127.0.0.1:7423` and exposes your locally-installed Claude CLI OAuth session as both Anthropic `/v1/messages` and OpenAI `/v1/chat/completions` endpoints. OpenClaw (and any other local tool that speaks those APIs) can call that endpoint and get Claude Opus 4.7 responses billed to your existing Claude Max subscription — no API key on the wire, nothing routed through anyone else's server.

## How it works

```
OpenClaw ──▶ Maxbridge (127.0.0.1:7423) ──▶ your Claude CLI ──▶ your Claude Max
   ▲                                                                  │
   └──────────────────── response ◀──────────────────────────────────┘
```

1. **Send** — OpenClaw sends your prompt on your Mac, the way it always has.
2. **Receive** — Maxbridge sits on 127.0.0.1:7423 and accepts the call locally.
3. **Route** — Maxbridge shells into the Claude CLI Anthropic themselves ship, using the OAuth session already in your keychain. Same path as typing `claude` in Terminal.
4. **Respond** — Claude Opus 4.7 responds under your Max subscription. No API key on the wire, no middleman server.
5. **No charges** — the only thing Maxbridge adds to your Mac is a menu-bar icon.

## Install (one paste, ~90 seconds)

Paste this in your Mac's Terminal:

```bash
curl -fsSL https://install.marsirius.ai | bash
```

That's the whole install. The script is idempotent — you can re-run it safely; step 2 auto-cleans any partial state from a prior attempt.

**What happens, headlessly:**

1. Pre-flight (macOS 13+, Apple Silicon)
2. Cleans any partial prior install
3. Installs Homebrew if missing
4. Installs the Claude CLI via Homebrew if missing
5. **Opens `anthropic.com` in your browser** for Claude login — you sign in to your Max plan and approve the authorization. This is the *only* manual step, ~45 seconds.
6. Downloads + SHA256-verifies the Maxbridge daemon bundle; extracts Node runtime + server into `~/.maxbridge/` (no `.app`, no Applications folder, no GUI)
7. Registers a `launchd` daemon (`ai.maxbridge.proxy`) — persistent background service on `127.0.0.1:7423`, auto-restarts on crash
8. Patches `~/.openclaw/openclaw.json` (timestamped backup kept) — registers `maxbridge` as a provider, routes the main agent to `maxbridge/claude-opus-4-7`
9. Kickstarts the OpenClaw gateway
10. Self-tests with a real Opus 4.7 round-trip; prints `REPORT_STATUS=success`

End state: Maxbridge running locally at `127.0.0.1:7423` as a background daemon, OpenClaw routed through it, Opus 4.7 answering under your Max plan.

**Prefer to drag-drop into your bot chat?** Download [install-maxbridge.md](https://github.com/mbmarsirius/maxbridge/releases/download/v0.1.0/install-maxbridge.md) and drop it into your OpenClaw bot; it carries the same single command above. The bot just runs it for you. (Secondary path — the terminal one-paste above is the primary, bulletproof install.)

## Requirements

- Apple Silicon Mac (M1/M2/M3/M4), macOS 13+
- Your own Claude Max or Pro subscription
- [OpenClaw](https://github.com/openclaw/openclaw) installed and running
- `claude` CLI (installed automatically via Homebrew if missing)

## Principles

**Local runtime.** Maxbridge binds to `127.0.0.1` only. No inbound from the internet. No telemetry. Your prompts go from your Mac directly to Claude — not through our servers.

**One machine.** `claude setup-token` runs once per install. No cross-machine session sharing — that's the pattern Anthropic's policies explicitly target, and Maxbridge doesn't touch it.

**Your session stays in your keychain.** The Claude OAuth session lives in the macOS Keychain, exactly where the Claude CLI puts it. Maxbridge never reads the token, never transmits it, never caches it.

## FAQ

**Is this allowed?**
Yes. Maxbridge uses only your own locally-installed Claude CLI, the same way typing `claude` in Terminal does. Anthropic re-allowed CLI usage for third-party orchestration in April 2026. Same user, same Mac, same keychain.

**Why free?**
I built this for myself, then realized every OpenClaw + Claude Max user has the same problem. Charging $5/mo wouldn't change my life. Helping the OpenClaw community might.

**Will it always be free?**
Yes. MIT license, no paid tier planned. If you want to support the work, ⭐ the repo or [sponsor on GitHub](https://github.com/sponsors/mbmarsirius).

**Will it work without OpenClaw?**
The proxy is a generic local Anthropic endpoint on `127.0.0.1:7423` — any app that speaks the Anthropic API can use it. But the install flow is built for OpenClaw users.

## Architecture

Everything that makes Maxbridge work is in this repo, MIT licensed, auditable:

```
maxbridge/
├── server/           Node.js proxy + OAuth bridge + OpenAI-compatible translator
│   ├── index.ts          entrypoint — starts the HTTP server, online poller, trial
│   ├── proxy.ts          /v1/messages + /v1/chat/completions + /v1/license/* handlers
│   ├── local-oauth-bridge.ts  spawns the Claude CLI with the user's keychain session
│   ├── openai-compat.ts  translates OpenAI ChatCompletions ↔ Anthropic Messages
│   └── license/          pure license-gate decision + store + online poller
│
├── src-tauri/        Legacy Tauri app shell — retained for the current DMG
│   │                 build but NOT used at runtime. The installer extracts
│   │                 just server-bundle/ + node-runtime/ into ~/.maxbridge/
│   │                 and runs them headlessly via launchd. The DMG is a
│   │                 transport format, not a user-facing app.
│   ├── src/main.rs       legacy spawner (unused by v0.1.1 installer)
│   ├── tauri.conf.json   bundle config
│   └── icons/            app icon set (used only for Finder preview of DMG)
│
├── worker/           Cloudflare Worker — serves install.md + install.sh + static
│   ├── src/              Hono router, JWT mint, md + sh template rendering
│   ├── public/           landing HTML + brand SVGs + styles
│   └── wrangler.toml     custom-domain routes for maxbridge.marsirius.ai +
│                         install.marsirius.ai
│
├── tests/            74 client tests (vitest, NODE_ENV=test required)
├── scripts/          build-bundle.sh, sign-setup.sh, sign-and-notarize.sh
└── docs/             specs: license gate, stripe checkout, tauri bundle,
                      design briefs for the landing + onboarding wizard
```

**The install chain (pure CLI, no GUI):**

1. User pastes `curl -fsSL https://install.marsirius.ai | bash` in their Mac's Terminal (or clicks the button on the landing, or drops `install-maxbridge.md` into their OpenClaw bot — every path converges on this one command).
2. `install.marsirius.ai/` 302-redirects to the static `install.sh` on the GitHub v0.1.0 release (zero DNS-propagation dependency — GitHub's global CDN).
3. install.sh runs linearly: pre-flight → clean prior install → install Homebrew + Claude CLI if missing → `claude setup-token` (opens Anthropic browser login, the only manual step) → download + SHA256-verify the daemon bundle → extract into `~/.maxbridge/` → bootstrap the `launchd` daemon → patch `~/.openclaw/openclaw.json` (backup kept) → kickstart the OpenClaw gateway → end-to-end test → `REPORT_STATUS=success`.
4. Maxbridge runs as a background daemon on `127.0.0.1:7423`. No `.app` in `/Applications`, no GUI onboarding, no menubar icon. Pure service. Your prompts never leave your Mac.

Everything is MIT-licensed and served from GitHub's release CDN (DMG, install.sh, install-maxbridge.md). The Cloudflare Worker at `install.marsirius.ai` exists only to provide the short `curl` URL — it redirects to the GitHub asset.

## Security

If you think you found a vulnerability, email `maxbridge@marsirius.ai` — do not open a public issue. See [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE) — use it, fork it, ship it. Attribution appreciated, not required.

## Credits

Built by [Mustafa Bulutoglulari](https://github.com/mbmarsirius). Powered by [Marsirius AI Labs](https://marsirius.ai). Independent project — not affiliated with Anthropic, OpenClaw, OpenAI, or Apple.

---

<sub>Maxbridge is an independent project by Marsirius Artificial Intelligence Consultants LLC.</sub>
