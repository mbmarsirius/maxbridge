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

## Install (one paste, ~2 minutes)

Paste this in your Mac's Terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/mbmarsirius/maxbridge/main/install.sh | bash
```

That's the whole install. The script is idempotent — you can re-run it safely; step 2 auto-cleans any partial state from a prior attempt.

### What you'll see — step by step

| Time | Phase | What happens | You do |
|---|---|---|---|
| 0–10s | Pre-flight | macOS + Apple Silicon check; removes any previous Maxbridge | nothing |
| 10–40s | Dependencies | Homebrew + Claude CLI installed silently (skipped if already present; +2–3 min on a fresh Mac with no brew) | nothing |
| **40–90s ★** | **Claude login** | A browser window opens to `anthropic.com` | **Sign in with your Claude Max/Pro account → click Approve. ~45 seconds. This is the ONLY manual step.** |
| 90–120s | Daemon + wire-up | Downloads Maxbridge (29 MB, SHA-verified), extracts into `~/.maxbridge/`, registers a `launchd` service. Patches `~/.openclaw/openclaw.json` (timestamped backup kept) to route your main agent to `maxbridge/claude-opus-4-7`. Kickstarts the OpenClaw gateway. | nothing |
| 120s | Self-test + done | Real Opus 4.7 round-trip. Terminal prints `REPORT_STATUS=success`. | Open Telegram (or whichever channel your bot uses) and send any message — the reply comes via your Max plan. |

### Running on a Mac mini with no monitor?

Step ★ opens a browser on the Mac's screen, so you'll need Screen Sharing (System Settings → General → Sharing), a VNC client, or a physical display plugged in to click through the Anthropic login. After the OAuth step, the install is fully headless — you can close Screen Sharing and let it finish.

### How to verify it worked (the 5-point proof)

If you want to confirm Maxbridge is genuinely running Opus 4.7 through your Max OAuth (not an API fallback), run these from your Mac's Terminal after install:

```bash
# 1. OpenClaw is pointed at Maxbridge (not Anthropic's endpoint)
grep -A2 '"main"' ~/.openclaw/openclaw.json | grep model
#    → "model": "maxbridge/claude-opus-4-7"

# 2. The daemon is running in local-oauth mode (no API key)
curl -sS http://127.0.0.1:7423/v1/status | python3 -m json.tool | head -20
#    → "mode": "local-oauth", "keySource": "none"

# 3. Claude CLI is authenticated via OAuth token (not API key)
grep -E 'authMethod|oauthAccount' ~/.claude.json | head
#    → "oauthAccount": { ... }

# 4. No Anthropic API key is set anywhere
echo "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-none}" && env | grep -i anthropic_api_key || echo "not set"
#    → ANTHROPIC_API_KEY=none

# 5. Live round-trip — Opus 4.7 via Maxbridge
curl -sS -X POST http://127.0.0.1:7423/v1/messages \
  -H 'Content-Type: application/json' \
  -d '{"model":"claude-opus-4-7","max_tokens":32,"messages":[{"role":"user","content":"Reply with exactly: MAXBRIDGE_LIVE"}]}'
#    → {"id":"msg_localclaw_...","model":"claude-opus-4-7",
#       "content":[{"type":"text","text":"MAXBRIDGE_LIVE"}], ...}
```

The `msg_localclaw_` id prefix signs that the response came from the local bridge. If you were hitting Anthropic's API directly it would be `msg_01...`.

### Alternative: drag-drop into your OpenClaw bot

Download [install-maxbridge.md](https://github.com/mbmarsirius/maxbridge/releases/download/v0.1.0/install-maxbridge.md) and drop it into your OpenClaw bot chat. The bot reads it and runs the same `curl | bash` for you. The OAuth browser step still happens on the Mac — so this path also needs screen access during that ~45 seconds.

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

## Troubleshooting

**`REPORT_STATUS=partial` after install.** The installer now prints the exact failure reason when the step-9 self-test fails: HTTP status code, response body (first 2 KB), last 30 lines of `~/Library/Logs/Maxbridge/daemon.err.log`, and your `claude --version`. Read that block — it points at the real cause. The most common cases are:

- `port 7423 is held by: <PID>` → another process is bound. Run `sudo lsof -i :7423` to identify, stop it, re-run the installer.
- `When using --print, --output-format=stream-json requires --verbose` → you hit an old daemon bundle. Re-run the installer; step 2 now aggressively cleans prior state.
- `Command failed: claude ...` with a long flag list → same as above; an ancestor Maxbridge version is answering. Re-run.

**The bot still replies with `openai-codex/gpt-5.4` (or another fallback model) after install.** OpenClaw caches the active model per session. Run `/model` in the bot chat once to reset the session to the new default (`maxbridge/claude-opus-4-7`). You only need to do this once per session. After that, `/status` will show `maxbridge/claude-opus-4-7` and every reply comes via your Max plan.

**Anthropic login browser didn't open automatically.** The Claude CLI prints a fallback URL — copy it into any browser on any device, sign in, and paste the resulting code back in the Terminal. The installer waits for you.

**macOS asks "rg would like to access files in your Documents folder" (or Desktop, iCloud Drive).** This is macOS Sequoia's App Management feature kicking in when Claude's Grep tool scans files on first use. Click Allow for each folder you want Claude to read; the approvals are persistent (you only do it once per folder, ever).

**I run OpenClaw in a custom layout and the `openclaw.json` patch broke something.** Every patch keeps a timestamped backup at `~/.openclaw/openclaw.json.bak-maxbridge-<date>`. To roll back: `mv ~/.openclaw/openclaw.json.bak-maxbridge-<date> ~/.openclaw/openclaw.json` then restart your OpenClaw gateway.

**Uninstall.** Run this:

```bash
launchctl bootout "gui/$(id -u)/ai.maxbridge.proxy" 2>/dev/null
rm -rf ~/.maxbridge ~/Library/LaunchAgents/ai.maxbridge.proxy.plist ~/Library/Logs/Maxbridge
# Restore your openclaw.json from the backup if you want to unwire OpenClaw too:
ls -1t ~/.openclaw/openclaw.json.bak-maxbridge-* 2>/dev/null | head -1 | xargs -I{} mv {} ~/.openclaw/openclaw.json
```

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
└── scripts/          build-bundle.sh (daemon bundle), preflight.sh,
                      legacy DMG tooling (sign-and-notarize.sh,
                      publish-release.sh) retained for reference
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

Built by [Mustafa Bulutoglulari](https://github.com/mbmarsirius). Powered by [Marsirius AI Labs](https://www.marsirius.ai). Independent project — not affiliated with Anthropic, OpenClaw, OpenAI, or Apple.

## With thanks

- [@alexfinnX](https://x.com/alexfinnX) — for the *"figure it out"* mantra that every good Claw session leans on. Stuck? Ask your Claw. It'll figure it out.
- [@steipete](https://x.com/steipete) — sweet revenge 😉

---

<sub>Maxbridge is an independent project by Marsirius Artificial Intelligence Consultants LLC.</sub>
