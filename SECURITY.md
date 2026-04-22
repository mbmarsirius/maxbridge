# Security Policy

## Reporting a Vulnerability

If you believe you've found a security vulnerability in Maxbridge, please report it privately:

- **Email:** `maxbridge@marsirius.ai`
- **Subject line:** `SECURITY — Maxbridge`

Please do **not** open a public GitHub issue for security reports.

Expected response time: within 48 hours. We'll triage, reply with next steps, and acknowledge public disclosure credit once a fix ships.

## Scope

In scope:
- The Maxbridge macOS app binary and its local HTTP proxy (`127.0.0.1:7423`)
- The install script served by `maxbridge-license.marsirius.workers.dev/install.sh`
- The install artifact at `maxbridge-license.marsirius.workers.dev/install.md`
- The Cloudflare Worker backend (license minting, Stripe webhook — dormant in free build)

Out of scope:
- Third-party dependencies (report upstream)
- Social-engineering attacks against users
- Denial-of-service against the free Worker infrastructure (rate-limited)

## Security Model

**What Maxbridge can see:** your local network traffic to `127.0.0.1:7423` (prompts and responses flowing through the bridge on your own Mac).

**What Maxbridge cannot see:** your OAuth session token (stored in macOS Keychain by the Claude CLI, never read by Maxbridge); your prompts after they leave Claude CLI (direct Claude ↔ Anthropic connection); any traffic not on `127.0.0.1:7423`.

**What the Worker server can see:** the IP address and timing of installs. No prompt content. No OAuth tokens. No email or payment data in the free build.

## Disclosure Timeline

We follow a 90-day coordinated disclosure window. Fixes are shipped in a point release and disclosed via GitHub Security Advisories plus a changelog entry on the next release.
