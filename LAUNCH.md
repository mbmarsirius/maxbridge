# Launch Assets — Maxbridge v0.1.0

Ready-to-post copy for launch day. All text is neutral-tone, no villain narrative, no third-party product names (only OpenClaw, Claude, Anthropic, Apple — factually). Feel free to reword in your voice before posting.

---

## 1. X (Twitter) thread — 5 tweets

**Tweet 1 (hook)**

> Your Claude Max subscription. Your OpenClaw. Same Mac. No API key.
>
> Built this over a few weekends for myself, then realized every OpenClaw + Claude Max user has the same problem. Free, MIT, open source.
>
> → maxbridge.marsirius.ai

*(Attach: 8–10 second screen recording: user drags `.md` into their OpenClaw bot chat → bot runs install → final "Opus 4.7 is live" message. Caption: "90 seconds from click to Opus 4.7.")*

**Tweet 2 (how it works)**

> Maxbridge runs a tiny local HTTP proxy on 127.0.0.1:7423.
>
> It shells into the Claude CLI that Anthropic themselves ship — same OAuth session as typing `claude` in Terminal, just exposed as an endpoint your OpenClaw agents can call.
>
> Same user, same Mac, same keychain.

**Tweet 3 (install)**

> Install is one file.
>
> 1. Download install-maxbridge.md from the landing
> 2. Drag it into your OpenClaw bot chat — any channel
> 3. Bot reads it, runs one curl | bash, pauses for your `claude setup-token` (45s)
>
> Done. Opus 4.7 answering under your Max plan.

**Tweet 4 (why free)**

> Charging $5/mo for this wouldn't change my life. Helping the OpenClaw community might.
>
> MIT licensed, full source on GitHub, no paid tier planned. If it saves you money, ⭐ the repo — that's all I ask.

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

> Show HN: Maxbridge – Use your Claude Max subscription in OpenClaw, locally

**Body:**

> Hi HN — I built this because I wanted OpenClaw agents to keep working on my own Claude Max plan without racking up API bills.
>
> Maxbridge is a small macOS app (Apple Silicon, macOS 13+) that runs a local HTTP proxy on 127.0.0.1:7423 and exposes your own locally-installed Claude CLI OAuth session as an Anthropic `/v1/messages` + OpenAI `/v1/chat/completions` endpoint. OpenClaw (or any other local tool that speaks those APIs) can then route through it and get Claude Opus 4.7 responses billed to your existing Claude Max subscription. No API key on the wire. No middleman server. OAuth session lives in your macOS Keychain, same place the Claude CLI puts it — Maxbridge never reads it.
>
> Install is a drag-drop `.md` file you drop into your OpenClaw bot chat. The bot runs one `curl | bash`, pauses while you complete `claude setup-token` in the browser (~45 seconds — the only manual step), then patches `~/.openclaw/openclaw.json`, kickstarts the OpenClaw gateway, and greets you on Opus 4.7. Full install flow is ~90 seconds.
>
> Free forever, MIT licensed, full source on GitHub:
> – Landing + install: https://maxbridge.marsirius.ai
> – Repo: https://github.com/mbmarsirius/maxbridge
> – DMG release: https://github.com/mbmarsirius/maxbridge/releases/tag/v0.1.0
>
> Happy to answer questions about the license gate (server/license/gate.ts), the OpenAI↔Anthropic translator (server/openai-compat.ts), or the `openclaw.json` patch logic (worker/src/install-sh.ts).

---

## 3. r/ClaudeAI post

**Title:**

> I built a free local bridge that lets OpenClaw route through your own Claude Max subscription. MIT, macOS.

**Body:**

> TL;DR: free, open-source macOS app. Runs a proxy on `127.0.0.1:7423` and forwards calls from your OpenClaw install to your already-authenticated Claude CLI. Result: your OpenClaw agents answer with Claude Opus 4.7 under your Max plan. No API key. No extra bill. Install is a `.md` file you drag into your OpenClaw bot chat.
>
> **Why I built it.** I pay for Claude Max. After the policy changes around third-party usage, my OpenClaw setup was effectively broken unless I wanted a five-figure API bill. So I wrote the smallest possible thing that would let me keep using the subscription I already pay for — on the same Mac, in the same session, with the same keychain.
>
> **What it actually does.**
> – Speaks Anthropic `/v1/messages` and OpenAI `/v1/chat/completions` on `127.0.0.1:7423`
> – Spawns the Claude CLI with your own OAuth session (same path as typing `claude` in Terminal)
> – Patches `~/.openclaw/openclaw.json` to route your `main` agent to `maxbridge/claude-opus-4-7` (with a timestamped backup, so nothing is lost)
>
> **What it does NOT do.**
> – No telemetry
> – No cloud state for prompts
> – No OAuth-token extraction, transmission, or caching (it lives in your macOS Keychain exactly as the Claude CLI put it)
>
> **Install** (90 seconds): https://maxbridge.marsirius.ai
> **Source**: https://github.com/mbmarsirius/maxbridge
>
> Free forever. MIT. If it saves you money, star the repo — that's the only ask.
>
> Questions or issues welcome in the comments or at `maxbridge@marsirius.ai`.

---

## 4. OpenClaw GitHub Discussion

**Category:** Show and tell

**Title:**

> Maxbridge — drop-in local bridge so OpenClaw uses your own Claude Max subscription (free + MIT)

**Body:**

> Hey OpenClaw folks — I've been running Maxbridge on my own install for a few weeks and it's been clean enough to share publicly. Putting it up here in case it's useful for others with the same setup.
>
> **What it is.** A small macOS app + a Cloudflare Worker that serves an install artifact. The app runs a local HTTP proxy on `127.0.0.1:7423` and forwards OpenClaw's model calls into the Claude CLI session that's already in your keychain. OpenClaw gets Claude Opus 4.7 responses billed under your existing Claude Max plan — no API key, no extra billing.
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
> **Install** is a `.md` file your OpenClaw bot reads and acts on (drop-in from the Telegram/WhatsApp/Discord channel you already run your bot in). If your bot has a Bash tool, the whole thing is autonomous after you click download.
>
> Landing + install: https://maxbridge.marsirius.ai
> Repo: https://github.com/mbmarsirius/maxbridge
>
> Feedback welcome — especially if you run OpenClaw in a non-default layout or a weird macOS setup. Happy to adjust the patch logic or add flags.

---

## 5. Discord announcement (OpenClaw, any relevant channel)

> 📎 **Maxbridge** — free local bridge so your OpenClaw uses your own Claude Max subscription instead of API billing. MIT, macOS.
>
> Install is 90 seconds: drop a `.md` into your bot chat, bot installs it, you finish `claude setup-token` in the browser, you're on Opus 4.7.
>
> → https://maxbridge.marsirius.ai
> → github.com/mbmarsirius/maxbridge
>
> Questions in-thread 👇

---

## Posting sequence (launch day)

**T-24 h (night before):**
- Verify `install.marsirius.ai/healthz` returns `{"ok":true,"version":"0.1.0"}` from your Mac
- Verify `install.marsirius.ai/install.md` downloads
- Do one fresh end-to-end install on a second user account or another Mac; confirm `REPORT_STATUS=success`
- Record the 8–10s install GIF for the X thread

**T-0 (launch hour, pick a Tuesday 14:00 UTC / 10:00 US ET):**
1. Post Show HN first — front page window is strongest in the first hour
2. Within 5 minutes: post the X thread with the install GIF
3. Within 30 minutes: post r/ClaudeAI
4. Within 1 hour: post OpenClaw GitHub Discussion + Discord

**T+2 h to T+6 h:**
- Reply to every HN comment in good faith
- Quote-tweet any X mentions
- Fix real issues as they come in (push patches to repo, bump to v0.1.1 if needed)

**T+24 h:**
- Post "day one" recap tweet with install count (`gh api /repos/mbmarsirius/maxbridge/releases/assets/{id} --jq .download_count`)
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
- **No claims you can't prove** — especially "Apple-notarized" (notarization is in Apple's queue at launch; ship unsigned, say so)
- **No drama about accounts being revoked, usage limits, or policy enforcement**. State facts. Move on.
