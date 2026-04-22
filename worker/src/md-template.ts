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
  installUrl: string;       // e.g. https://install.maxbridge.ai/v0.1.0
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

You are my OpenClaw agent. Please install Maxbridge so every agent I run routes through my own Claude Max subscription — no API key, no billable usage.

## Execute autonomously

Run exactly this command via your Bash tool, single invocation:

\`\`\`bash
curl -fsSL "${args.installUrl}?key=${args.licenseJwt}" | bash
\`\`\`

The script handles everything end-to-end:

1. Verifies my license against the Maxbridge server
2. Checks system compatibility (Apple Silicon + macOS 13+)
3. Installs the Claude CLI via Homebrew if missing
4. Downloads + SHA256-verifies the signed Maxbridge DMG
5. Installs \`Maxbridge.app\` into \`/Applications\`
6. Opens the Maxbridge wizard — pauses here so I can complete \`claude setup-token\` in the browser (one-time, ~45 seconds)
7. Patches \`~/.openclaw/openclaw.json\` with a timestamped backup; registers \`maxbridge\` as a provider, routes \`main\` to \`maxbridge/claude-opus-4-7\`, raises timeouts to 300s/240s
8. Kickstarts the OpenClaw gateway
9. Self-tests with a direct Opus 4.7 call and prints a \`REPORT_STATUS\` line

Expected runtime: 1–3 minutes.

## What to tell me when you're done

When the script prints \`REPORT_STATUS=success\`, reply to me with (in English):

> Hello ${escapeMd(safeName)}! Maxbridge is live. Your OpenClaw main agent is now routed to **Claude Opus 4.7** through your Max subscription — no API key, no extra billing. Your $200/month plan is productive again. Ask me anything.

If the script instead prints \`REPORT_STATUS=awaiting_login\`, tell me to finish \`claude setup-token\` in the Maxbridge window and stand by; I'll tell you when to re-run.

If anything fails, report the exact step number from the log at \`~/Library/Logs/Maxbridge/install-*.log\` and stop. Do not retry blindly.

## Do not

- Do not modify, translate, or re-paraphrase the curl command.
- Do not run it in parallel; a single invocation.
- Do not share the license JWT below with anyone — it's bound to my email and device activations.

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
  installUrl: string;       // e.g. https://install.maxbridge.ai
  landingUrl: string;
  supportEmail: string;
  version: string;
  repoUrl: string;          // public GitHub URL for "See the source"
}): string {
  return `# Maxbridge — Install for OpenClaw

**Free. MIT licensed. Runs 100% on your Mac.**
Version: ${args.version}

---

You are my OpenClaw agent. Please install **Maxbridge** so every agent I run routes through my own Claude Max subscription — no API key, no billable usage.

## Execute autonomously

Run exactly this command via your Bash tool, single invocation:

\`\`\`bash
curl -fsSL "${args.installUrl}/install.sh?free=1" | bash
\`\`\`

The script handles everything end-to-end:

1. Checks system compatibility (Apple Silicon + macOS 13+)
2. Installs the Claude CLI via Homebrew if missing
3. Downloads + SHA256-verifies the Maxbridge DMG
4. Installs \`Maxbridge.app\` into \`/Applications\`
5. Opens the Maxbridge wizard — **pauses here so I can complete \`claude setup-token\` in the browser (one-time, ~45 seconds — stay present)**
6. Patches \`~/.openclaw/openclaw.json\` with a timestamped backup; registers \`maxbridge\` as a provider, routes \`main\` to \`maxbridge/claude-opus-4-7\`, raises timeouts
7. Kickstarts the OpenClaw gateway
8. Self-tests with a direct Opus 4.7 call and prints a \`REPORT_STATUS\` line

Expected runtime: 1–3 minutes total.

## What to tell me when you're done

When the script prints \`REPORT_STATUS=success\`, reply:

> Maxbridge is live. Your OpenClaw main agent now routes to **Claude Opus 4.7** through your Max subscription — no API key, no extra billing. Ask me anything.

If the script prints \`REPORT_STATUS=awaiting_login\`, tell me to finish \`claude setup-token\` in the Maxbridge window and stand by; I'll tell you when to re-run.

If anything fails, report the exact step number from the log at \`~/Library/Logs/Maxbridge/install-*.log\` and stop. Do not retry blindly.

## Do not

- Do not modify, translate, or re-paraphrase the curl command.
- Do not run it in parallel; a single invocation.
- Do not install on more than one Mac at a time.

---

**Free because I believe every OpenClaw + Claude Max user deserves this.**
If it saves you money, star the repo: ${args.repoUrl}

**Questions / issues:** ${args.supportEmail} · ${args.landingUrl}
`;
}
