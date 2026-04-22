# Maxbridge — Install for OpenClaw

**Free. MIT licensed. Runs 100% on your Mac, as a background daemon.**
Version: 0.1.0

---

You are my OpenClaw agent. Please install **Maxbridge** so every agent I run routes through my own Claude Max subscription — no API key, no billable usage.

## Execute autonomously

If you have a Bash tool, run this exactly, single invocation:

```bash
curl -fsSL "https://github.com/mbmarsirius/maxbridge/releases/download/v0.1.0/install.sh" | bash
```

If your Bash tool is disabled, reply with that exact command — I'll paste it into Terminal myself. Both paths end at the same install.

While the script runs (1–3 minutes), send me a short text status update every 15–20 seconds (e.g. `"Installing Homebrew..."`, `"Waiting for Anthropic browser login..."`, `"Patching openclaw.json..."`) so I know it's alive. Telegram's typing indicator disappears after ~60 seconds — do not rely on it, send actual text.

## What the script does (headless, no GUI, no installer window)

1. Pre-flight: macOS 13+, Apple Silicon
2. Cleans any partial prior install (retries are idempotent)
3. Installs Homebrew if missing (non-interactive)
4. Installs the Claude CLI via Homebrew if missing
5. **Opens `anthropic.com` in my browser** — I sign in to my Claude Max plan and approve the authorization. This is the only manual step, ~45 seconds.
6. Downloads + SHA256-verifies the Maxbridge daemon bundle; extracts server + Node runtime into `~/.maxbridge/` (no app, no Applications folder)
7. Registers a `launchd` daemon (`ai.maxbridge.proxy`) — persistent background service on `127.0.0.1:7423`, auto-restarts on crash
8. Patches `~/.openclaw/openclaw.json` (timestamped backup kept) — registers `maxbridge` provider, routes the main agent to `maxbridge/claude-opus-4-7`
9. Kickstarts the OpenClaw gateway so it picks up the new config
10. End-to-end test: calls Opus 4.7 via the daemon; prints `REPORT_STATUS=success`

## What to tell me when the script prints REPORT_STATUS=success

> **Maxbridge is live.** Your OpenClaw main agent now routes to **Claude Opus 4.7** through your Max subscription — no API key, no extra billing. Ask me anything.

If it prints `REPORT_STATUS=partial`, the daemon is running but the Opus 4.7 round-trip test didn't return the expected marker. Paste the last 20 lines of `~/Library/Logs/Maxbridge/install-*.log` and I'll diagnose.

If an earlier step failed, report the step number (e.g. `5/9 Claude login`) and stop. Don't retry blindly — step 2 of the next run auto-cleans partial state.

## Do not

- Do not modify, translate, or re-paraphrase the curl command.
- Do not run it in parallel; a single invocation.
- Do not install on more than one Mac at a time.

---

**Free because every OpenClaw + Claude Max user deserves this.**
If it saves you money, star the repo: https://github.com/mbmarsirius/maxbridge

**Questions / issues:** maxbridge@marsirius.ai · https://maxbridge.marsirius.ai
