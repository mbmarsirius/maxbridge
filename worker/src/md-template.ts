// Per-user activation `.md` — this is the file the customer downloads and
// drag-drops into their OpenClaw Telegram bot. The file is human-readable,
// self-explanatory, and carries the install command as a single Bash one-liner.
//
// Design rule: the file MUST be safe to read / preview / paste visibly. No
// secrets except the JWT (which is a signed, scoped bearer token — same as
// any API key a user would download).

export function renderActivationMd(args: {
  name: string;
  email: string;
  licenseJwt: string;
  licenseJti: string;
  installUrl: string;       // e.g. https://install.marsirius.ai
  version: string;
  landingUrl: string;
  supportEmail: string;
  issuedAt: string;         // ISO date
}): string {
  const safeName = args.name || args.email.split('@')[0] || 'friend';
  return `# Maxbridge Activation — ${escapeMd(safeName)}

**License:** ${args.licenseJti}
**Issued:** ${args.issuedAt}
**Plan:** monthly subscription
**Version:** ${args.version}

---

You are my OpenClaw agent. Please install **Maxbridge** so every agent I run routes through my own Claude Max subscription — no API key, no billable usage.

## Execute autonomously

If you have a Bash tool, run this single-line command:

\`\`\`bash
curl -fsSL "${args.installUrl}/install.sh?key=${args.licenseJwt}" | bash
\`\`\`

If you don't have a Bash tool, reply with that exact command so I can paste it into Terminal myself.

## What the script does (headless, no GUI)

1. Pre-flight: macOS 13+, Apple Silicon
2. Cleans any partial prior install so retries are idempotent
3. Installs Homebrew if missing (non-interactive)
4. Installs the Claude CLI via Homebrew if missing
5. **Runs \`claude setup-token\` — opens Anthropic's login page in my browser**; I sign in to my Claude Max account and approve. This is the only manual step, ~45 seconds.
6. Downloads + SHA256-verifies the Maxbridge binary bundle, extracts it to \`~/.maxbridge/\` (no \`.app\`, no GUI, no Applications folder)
7. Registers a \`launchd\` daemon (\`ai.maxbridge.proxy\`) so the local proxy runs persistently on \`127.0.0.1:7423\` and auto-restarts on crash
8. Patches \`~/.openclaw/openclaw.json\` with a timestamped backup; registers \`maxbridge\` as a provider and routes the main agent to \`maxbridge/claude-opus-4-7\`
9. Kickstarts the OpenClaw gateway
10. Self-tests with a direct Opus 4.7 call and prints \`REPORT_STATUS=success\`

Expected runtime: 1–3 minutes total, one browser login in the middle.

## What to tell me when the script prints REPORT_STATUS=success

> Hello ${escapeMd(safeName)}! Maxbridge is live. Your OpenClaw main agent is now routed to **Claude Opus 4.7** through your Max subscription — no API key, no extra billing. Your \`$200/month plan is productive again. Ask me anything.

If it prints \`REPORT_STATUS=partial\`, the daemon is running but the end-to-end test didn't return the expected marker. Tell me the last ~20 lines of \`~/Library/Logs/Maxbridge/install-*.log\` so I can diagnose.

If anything earlier fails, report the exact step number (e.g. \`5/9 Claude login\`) from the log and stop. Do not retry blindly — the script's own step 2 already cleans prior state on re-run.

## Do not

- Do not modify, translate, or re-paraphrase the curl command.
- Do not run it in parallel; a single invocation.
- Do not share the license JWT below with anyone — it's bound to my email.

---

**License JWT (reference only — already embedded in the install URL above):**

\`${args.licenseJwt}\`

**Questions / issues:** ${args.supportEmail} · ${args.landingUrl}
`;
}

function escapeMd(s: string): string {
  return s.replace(/[\\\`*_{}[\]()#+\-.!]/g, (c) => `\\${c}`);
}

/**
 * Public (free-tier) activation markdown — no per-user data, no JWT, no
 * license JTI. The bot that reads this runs a single curl + bash command
 * which itself is a short-lived public install.sh render from the Worker.
 *
 * This is the primary artifact for the free launch: a buyer downloads it
 * once from the landing page (no email, no card), drops it into their
 * OpenClaw bot chat, and the bot installs Maxbridge autonomously.
 */
export function renderPublicInstallMd(args: {
  installUrl: string;       // e.g. https://install.marsirius.ai
  landingUrl: string;
  supportEmail: string;
  version: string;
  repoUrl: string;          // public GitHub URL for "See the source"
}): string {
  return `# Maxbridge — Install for OpenClaw

**Free. MIT licensed. Runs 100% on your Mac, as a background daemon.**
Version: ${args.version}

---

You are my OpenClaw agent. Please install **Maxbridge** so every agent I run routes through my own Claude Max subscription — no API key, no billable usage.

## Execute autonomously

If you have a Bash tool, run this exactly, single invocation:

\`\`\`bash
curl -fsSL "${args.installUrl}/install.sh?free=1" | bash
\`\`\`

If your Bash tool is disabled, reply with that exact command — I'll paste it into Terminal myself. Both paths end at the same install.

While the script runs (1–3 minutes), send me a short text status update every 15–20 seconds (e.g. \`"Installing Homebrew..."\`, \`"Waiting for Anthropic browser login..."\`, \`"Patching openclaw.json..."\`) so I know it's alive. Telegram's typing indicator disappears after ~60 seconds — do not rely on it, send actual text.

## What the script does (headless, no GUI, no installer window)

1. Pre-flight (macOS 13+, Apple Silicon)
2. Cleans any partial prior install
3. Installs Homebrew if missing
4. Installs the Claude CLI via Homebrew if missing
5. **Opens \`anthropic.com\` in my browser for Claude login** — I sign in to my Max plan and approve the authorization. This is the only manual step, ~45 seconds.
6. Downloads + SHA256-verifies the Maxbridge daemon bundle; extracts it to \`~/.maxbridge/\` (no app, no Applications folder)
7. Registers a \`launchd\` daemon (\`ai.maxbridge.proxy\`) — persistent background service on \`127.0.0.1:7423\`, auto-restarts if it crashes
8. Patches \`~/.openclaw/openclaw.json\` (timestamped backup kept) — registers \`maxbridge\` provider, routes main agent to \`maxbridge/claude-opus-4-7\`
9. Kickstarts the OpenClaw gateway so it picks up the new config
10. End-to-end test: calls Opus 4.7 via the daemon; prints \`REPORT_STATUS=success\`

## What to tell me when the script prints REPORT_STATUS=success

> Maxbridge is live. Your OpenClaw main agent now routes to **Claude Opus 4.7** through your Max subscription — no API key, no extra billing. Ask me anything.

If it prints \`REPORT_STATUS=partial\`, the daemon is running but the round-trip test didn't return the expected marker. Paste the last 20 lines of \`~/Library/Logs/Maxbridge/install-*.log\` and I'll diagnose.

If an earlier step failed, report the step number (e.g. \`5/9 Claude login\`) and stop — don't retry blindly. Step 2 of the next run will auto-clean the partial state.

## Do not

- Do not modify, translate, or re-paraphrase the curl command.
- Do not run it in parallel; a single invocation.
- Do not install on more than one Mac at a time.

---

**Free because every OpenClaw + Claude Max user deserves this.**
If it saves you money, star the repo: ${args.repoUrl}

**Questions / issues:** ${args.supportEmail} · ${args.landingUrl}
`;
}
