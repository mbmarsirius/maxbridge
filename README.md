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

## Install (90 seconds)

**The fast path — let your OpenClaw bot install it:**

1. Download [**install-maxbridge.md**](https://install.marsirius.ai/install.md) (no card, no email).
2. Drag the `.md` into your OpenClaw bot chat on the Mac where you run OpenClaw.
3. Your bot reads the instruction and runs one `curl | bash`. Maxbridge downloads, installs, and asks you to complete `claude setup-token` in the browser (~45 seconds — the only manual step). When that's done, the bot wires up `~/.openclaw/openclaw.json`, kickstarts the OpenClaw gateway, and greets you on Opus 4.7.

**The manual path** (if you prefer to install by hand):

```bash
curl -fsSL "https://install.marsirius.ai/install.sh?free=1" | bash
```

Either way you end on the same result: Maxbridge running locally at `127.0.0.1:7423`, OpenClaw routed through it, Opus 4.7 answering under your Max plan.

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
├── src-tauri/        Tauri (Rust) app shell — produces the DMG
│   ├── src/main.rs       spawns the bundled Node server, exposes menubar
│   ├── tauri.conf.json   bundle config
│   └── icons/            app icon set (rendered from brand/maxbridge-appicon.svg)
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

**The install chain:**

1. User clicks **Install Maxbridge — Free** on the landing → browser downloads `install-maxbridge.md` from `install.marsirius.ai/install.md`
2. User drags the `.md` into their OpenClaw bot chat. Bot reads the markdown and runs `curl -fsSL https://install.marsirius.ai/install.sh?free=1 | bash`
3. The Worker mints an anonymous, long-lived JWT on the fly (no email, no payment) and inlines it into a fresh install.sh render
4. install.sh preflights the Mac, installs Claude CLI via Homebrew if missing, downloads + SHA256-verifies the DMG from the GitHub release, installs `/Applications/Maxbridge.app`, opens the wizard
5. User completes `claude setup-token` in the browser (~45 seconds — the only manual step; Maxbridge never sees the OAuth token)
6. install.sh patches `~/.openclaw/openclaw.json` (timestamped backup), kickstarts the OpenClaw gateway, runs an end-to-end test to Opus 4.7, prints `REPORT_STATUS=success`

No cloud state beyond the Worker that serves the install artifact. Your prompts never leave your Mac.

## Security

If you think you found a vulnerability, email `maxbridge@marsirius.ai` — do not open a public issue. See [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE) — use it, fork it, ship it. Attribution appreciated, not required.

## Credits

Built by [Mustafa Bulutoglulari](https://github.com/mbmarsirius). Powered by [Marsirius AI Labs](https://marsirius.ai). Independent project — not affiliated with Anthropic, OpenClaw, OpenAI, or Apple.

---

<sub>Maxbridge is an independent project by Marsirius Artificial Intelligence Consultants LLC.</sub>
