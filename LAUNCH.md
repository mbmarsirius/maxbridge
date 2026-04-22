# Launch Assets — Maxbridge v0.1.0

Ready-to-post copy for launch day. Neutral-tone, no villain narrative, no third-party product names (only OpenClaw, Claude Max, Anthropic, Apple, macOS). Reword in your voice before posting.

---

## 1. X (Twitter) thread — 5 tweets

**Tweet 1 (hook)**

> Your Claude Max subscription. Your OpenClaw. Same Mac. No API key.
>
> ```
> curl -fsSL https://install.marsirius.ai | bash
> ```
>
> Built this over a few weekends for myself, then realised every OpenClaw + Claude Max user has the same problem. Free. MIT. Open source.
>
> → maxbridge.marsirius.ai

*(Attach: 8–10 second screen recording — paste command, 45s browser login, terminal prints REPORT_STATUS=success, Telegram bot answering on Opus 4.7.)*

**Tweet 2 (how it works)**

> Maxbridge runs as a tiny background daemon on 127.0.0.1:7423 (launchd managed, not an app).
>
> It shells into the Claude CLI that Anthropic themselves ship — same OAuth session as typing `claude` in Terminal — and exposes the result as an Anthropic + OpenAI-compatible local endpoint.
>
> Same user, same Mac, same keychain.

**Tweet 3 (install)**

> One paste in Terminal. ~2 minutes end to end. The script:
>
> 1. Installs Homebrew + Claude CLI silently if missing
> 2. Opens anthropic.com in your browser — you sign in with your Claude Max account + click Approve (~45s, the only manual step)
> 3. Extracts the daemon into ~/.maxbridge/, registers a launchd service
> 4. Patches ~/.openclaw/openclaw.json (timestamped backup)
> 5. Self-tests Opus 4.7 round-trip → REPORT_STATUS=success
>
> Mac mini without a monitor? Screen Sharing during step 2 only; rest is headless.

**Tweet 4 (why free)**

> Charging $5/mo for this wouldn't change my life. Helping the OpenClaw community might.
>
> MIT-licensed, full source on GitHub, no paid tier planned. If it saves you money, ⭐ the repo — that's all I ask.

**Tweet 5 (close)**

> Apple Silicon, macOS 13+, your own Claude Max or Pro, OpenClaw installed.
>
> Questions: maxbridge@marsirius.ai
>
> Repo: github.com/mbmarsirius/maxbridge
> Site: maxbridge.marsirius.ai

---

## 2. Show HN

**Title (≤80 chars):**

> Show HN: Maxbridge – Route your Claude Max subscription into OpenClaw, locally

**Body:**

> Hi HN — I built this because I wanted OpenClaw agents to keep working on my own Claude Max plan without racking up API bills.
>
> Maxbridge is a small Apple Silicon macOS daemon (no GUI, no `.app`) that runs a local HTTP proxy on 127.0.0.1:7423 and exposes your locally-installed Claude CLI OAuth session as an Anthropic `/v1/messages` + OpenAI `/v1/chat/completions` endpoint. OpenClaw (or any other local tool that speaks those APIs) routes through it and gets Claude Opus 4.7 responses billed to your existing Claude Max subscription. No API key on the wire. No middleman server. OAuth session lives in the macOS Keychain, stored by the Claude CLI — Maxbridge never reads it.
>
> Install is one paste in Terminal:
>
>     curl -fsSL https://raw.githubusercontent.com/mbmarsirius/maxbridge/main/install.sh | bash
>
> The script installs Homebrew + the Claude CLI if they're missing, opens anthropic.com in your browser for a one-time Claude Max sign-in (~45s — the only interactive step; need screen access on the target Mac for this moment, Screen Sharing works), drops a `launchd` daemon into `~/.maxbridge/`, patches `~/.openclaw/openclaw.json` with a timestamped backup, and ends with a real Opus 4.7 round-trip test against the new daemon.
>
> Free forever, MIT licensed, full source:
> – Landing + one-paste install: https://maxbridge.marsirius.ai
> – Repo: https://github.com/mbmarsirius/maxbridge
> – Release: https://github.com/mbmarsirius/maxbridge/releases/tag/v0.1.0
>
> Happy to answer questions about the license gate (`server/license/gate.ts`), the OpenAI↔Anthropic translator (`server/openai-compat.ts`), or the `openclaw.json` patch logic (`worker/src/install-sh.ts`).

---

## 3. r/ClaudeAI post

**Title:**

> I built a free local daemon that routes OpenClaw through your own Claude Max subscription. One-paste install, MIT, macOS.

**Body:**

> TL;DR: free, open-source macOS daemon (not an app, no GUI). Runs a proxy on `127.0.0.1:7423` and forwards calls from your OpenClaw install to your already-authenticated Claude CLI. Result: your OpenClaw agents answer with Claude Opus 4.7 under your Max plan. No API key. No extra bill.
>
>     curl -fsSL https://install.marsirius.ai | bash
>
> **Why I built it.** I pay for Claude Max. After the policy changes around third-party usage, my OpenClaw setup was effectively broken unless I wanted a five-figure API bill. So I wrote the smallest possible thing that would let me keep using the subscription I already pay for — on the same Mac, in the same session, with the same keychain.
>
> **What it actually does.**
> – Speaks Anthropic `/v1/messages` and OpenAI `/v1/chat/completions` on `127.0.0.1:7423`
> – Shells into the Claude CLI with your own OAuth session (same path as typing `claude` in Terminal)
> – Patches `~/.openclaw/openclaw.json` to route your `main` agent to `maxbridge/claude-opus-4-7` (timestamped backup kept)
> – Installs and manages itself via `launchd` — background daemon, auto-restart on crash, no `.app` in Applications, no menubar icon
>
> **What it does NOT do.**
> – No telemetry
> – No cloud state for prompts
> – No OAuth-token extraction, transmission, or caching (the token lives in your macOS Keychain, placed there by the Claude CLI, never read by Maxbridge)
>
> **Install** (one paste, ~90 seconds): https://maxbridge.marsirius.ai
> **Source**: https://github.com/mbmarsirius/maxbridge
>
> Free forever. MIT. If it saves you money, star the repo — that's the only ask.
>
> Questions or issues welcome in the comments or at `maxbridge@marsirius.ai`.

---

## 4. OpenClaw GitHub Discussion

**Category:** Show and tell

**Title:**

> Maxbridge — one-paste daemon so OpenClaw routes through your own Claude Max subscription (free + MIT)

**Body:**

> Hey OpenClaw folks — I've been running Maxbridge on my own install for a few weeks and it's been clean enough to share publicly. Putting it up here in case it's useful for others with the same setup.
>
> **What it is.** A small background daemon (no GUI, no `.app`, just a `launchd` service) that runs a local HTTP proxy on `127.0.0.1:7423` and forwards OpenClaw's model calls into the Claude CLI session that's already in your keychain. OpenClaw gets Claude Opus 4.7 responses billed under your existing Claude Max plan — no API key, no extra billing.
>
> **Install** is one paste in Terminal:
>
>     curl -fsSL https://install.marsirius.ai | bash
>
> The script is linear: Homebrew + Claude CLI (if missing) → `claude setup-token` (Anthropic browser OAuth, 45s) → extract the daemon into `~/.maxbridge/` → register as a `launchd` job → patch `openclaw.json` → kickstart the gateway → end-to-end Opus 4.7 test → `REPORT_STATUS=success`. No installer window, no polling, no drag-drop, no `.app` in Applications.
>
> **How it integrates with OpenClaw.** The install script patches `~/.openclaw/openclaw.json`:
>
> – Registers `maxbridge` as a provider on `http://127.0.0.1:7423`
> – Routes `agents.defaults.model.primary` to `maxbridge/claude-opus-4-7`
> – Your existing model becomes a fallback (never dropped)
> – Raises `timeoutSeconds` to 300 and `idleTimeoutSeconds` to 240 (Opus 4.7 sometimes thinks for a bit)
> – Writes a timestamped `.bak` before touching anything
>
> Then it `launchctl kickstart`s `ai.openclaw.gateway` to reload. One roll-back command restores the backup if anything goes sideways.
>
> **Also available**: [`install-maxbridge.md`](https://github.com/mbmarsirius/maxbridge/releases/download/v0.1.0/install-maxbridge.md) — drop it into your OpenClaw bot chat and the bot runs the same curl for you. Same install, just delegated.
>
> Landing: https://maxbridge.marsirius.ai
> Repo: https://github.com/mbmarsirius/maxbridge
>
> Feedback welcome — especially if you run OpenClaw in a non-default layout or a weird macOS setup. Happy to adjust the patch logic or add flags.

---

## 5. Discord announcement (OpenClaw, any relevant channel)

> 📎 **Maxbridge** — free local daemon so your OpenClaw routes through your own Claude Max subscription instead of API billing. MIT, macOS.
>
> One-paste install in Terminal:
> ```
> curl -fsSL https://install.marsirius.ai | bash
> ```
>
> Script handles everything — Homebrew, Claude CLI, launchd daemon, `openclaw.json` patch, gateway kickstart, end-to-end test. ~90 seconds, one browser login.
>
> → https://maxbridge.marsirius.ai
> → github.com/mbmarsirius/maxbridge
>
> Questions in-thread 👇

---

## Posting sequence (launch day)

**T-24 h (night before):**
- Verify `install.marsirius.ai/` returns HTTP 302 to the GitHub release install.sh from your Mac
- Fresh end-to-end install on a second user account or another Mac; confirm `REPORT_STATUS=success` and `/model` in Telegram lists `maxbridge — claude-opus-4-7`
- Record the 8–10s install screen recording for the X thread

**T-0 (launch hour, pick a Tuesday 14:00 UTC / 10:00 US ET):**
1. Post Show HN first — front-page window is strongest in the first hour
2. Within 5 minutes: post the X thread with the install screen recording
3. Within 30 minutes: post r/ClaudeAI
4. Within 1 hour: post OpenClaw GitHub Discussion + Discord

**T+2 h to T+6 h:**
- Reply to every HN comment in good faith
- Quote-tweet any X mentions
- Fix real issues as they come in (push patches to repo, bump to v0.1.2 if needed)

**T+24 h:**
- Post "day one" recap tweet with install count
- Pitch Ben's Bites / TLDR AI / The Rundown (1-liner + link)

**T+72 h:**
- Indie Hackers post
- Product Hunt if install count > 500 (otherwise wait for more signal)

---

## Tone rules — DO NOT BREAK

- **No third-party product names** anywhere (only OpenClaw, Claude Max, Anthropic, Apple, macOS)
- **No villain narrative.** "After Anthropic restricted third-party usage" is fine. "Anthropic banned" is not.
- **No specific enforcement dates** in marketing copy (Feb 19, April 4, etc. — if you use a date, use "April 2026" at most, and only when stating Anthropic RE-ALLOWED CLI usage, never the block)
- **No quoting named individuals** without written permission
- **No claims you can't prove** — especially "Apple-notarized" (notarization is in Apple's queue; ship unsigned, say so)
- **No drama about accounts being revoked, usage limits, or policy enforcement**. State facts. Move on.
