# Design Brief #2 — maxbridge.ai Landing Page

**Audience for this brief:** Claude Design. Output is a single-page site in Astro (preferred) or Next.js App Router. Deploys to Vercel or Cloudflare Pages. No CMS. Content lives in the source, edits ship via git.

**Design canvas:** 1440px desktop + 390px mobile. Must score ≥95 on Lighthouse Performance and Accessibility.

---

## 1. Positioning (the one-liner that must carry everything else)

> **Your Claude Max plan, working everywhere on your Mac. No API key. No cloud service. No cost creep.**

Secondary framing that supports it:

- For OpenClaw users orphaned April 4: "Back online — the legal way."
- For Cursor/Cline/Aider users who got tired of API bills: "Use the subscription you already pay for."
- For privacy-minded buyers: "Local-only. Nothing leaves your Mac. Open to audit."

The whole page must make one conversion happen: **paste email → start 7-day free trial → download the signed `.dmg`**.

---

## 2. Who the page is for

Three personas, in order of priority:

1. **Orphaned OpenClaw user (hot lead).** Was running OpenClaw against their Max plan. On April 4 got hit with 5–50× bills or cut off. Actively searching for a fix right now. This person converts in under 3 minutes if the page lands right.
2. **Heavy Cursor/Cline/Aider user.** Pays $200/mo Max *and* ~$300/mo API for agentic coding. Wants to consolidate onto the flat-rate subscription.
3. **Privacy-first Mac power user.** Dislikes sending prompts to 3rd-party services. Maxbridge's "your machine only, we see nothing" is the pitch.

---

## 3. Page sections — order, purpose, exact copy scaffold

### 3.1 Navigation bar

Sticky, 64px tall. Left: `Maxbridge` wordmark. Right: `How it works`, `Pricing`, `FAQ`, `Download →` (primary CTA button).

### 3.2 Hero (fold 1)

- **H1 (72pt desktop / 40pt mobile):** "Use your Claude Max plan in any app on your Mac."
- **Subhead (22pt, 65% opacity, max 540px wide):** "Maxbridge is a one-click local bridge that lets Cursor, OpenClaw, Cline, Aider — any Anthropic-compatible app — run on your own Claude subscription. Billed to Max. Stays on your Mac."
- **Dual CTA row:**
  - Primary button (large): `Start 7-day free trial →`
  - Secondary link: `Watch 30-second demo ▶`
- **Trust micro-copy directly under CTAs (13pt muted):** "No credit card for trial · Cancel any time · $12/mo or $89 lifetime"
- **Hero visual (right half on desktop, below on mobile):** a looped 15–30s screen recording of the app's `welcome → integrations → success` wizard flow. Autoplay, muted, loop. Poster image for slow connections.

### 3.3 The problem we exist for (fold 2 — THIS is the OpenClaw hook)

- **H2:** "If you're paying Max and still getting surprise bills, keep reading."
- **Body (2 columns desktop):**
  - **Left column:** "On April 4, 2026 Anthropic cut off Claude subscriptions from third-party tools. OpenClaw, Cline-via-Max, any agent framework touching your Max plan — all started getting billed at 5–50× their old rate under a new 'extra usage' system. Heavy users saw monthly bills jump from $100 to $2,000+. If that's you, you already know."
  - **Right column:** "Maxbridge is different. It doesn't ask Anthropic for a third-party OAuth path (there isn't one). It runs on your Mac, shells into the official `claude` CLI under your own OAuth session, and translates local HTTP calls into what the CLI expects. The subscription you pay for is yours. We just make it routable."
- **Pull quote block (below the two columns):** a real quote from a beta user (we'll gather these). Placeholder: *"I stopped my $2,100 extra-usage bill the day I installed Maxbridge. First tool I've bought in 2026 that paid for itself in an hour." — [Name, Role, Company]*

### 3.4 How it works (fold 3)

Three-step horizontal flow, each step is a card with an icon, a one-word title, and one sentence:

1. **Download.** `Maxbridge.dmg` → Applications. Opens on first launch.
2. **Log in.** One-click to run `claude setup-token`. Uses your Mac's keychain. We never see the token.
3. **Connect.** One click to wire OpenClaw, Cursor, Cline, or paste a URL into any other app.

Below the cards, a diagram (same visual language as the in-app welcome): user's app → Maxbridge → Claude CLI → Anthropic. Every arrow labeled. Caption: "Nothing routes through our servers. Maxbridge is a local HTTP proxy that shells into Anthropic's own CLI. If our company vanished tomorrow, the app on your Mac keeps working."

### 3.5 What it works with (fold 4)

- **H2:** "Works with what you already use."
- Logo strip (grayscale, desaturated): OpenClaw, Cursor, Cline, Aider, Continue, Zed, Raycast (if Raycast supports Anthropic), plus "+ any OpenAI-compatible client".
- Small copy: "If your app can talk to Anthropic or OpenAI at a custom base URL, it talks to Maxbridge."
- Link: `Full compatibility list →` (scrolls to a section or opens a docs page).

### 3.6 Why it's safe (fold 5 — THE TOS DEFENSE)

This section exists to pre-empt the "isn't this against Anthropic's TOS?" objection. Lead with a confident, factual tone — never defensive.

- **H2:** "Designed inside the lines."
- **Three pillars, each with a short paragraph:**
  - **Your Mac. Your session.** "Maxbridge doesn't mint tokens or impersonate clients. It shells out to the `claude` CLI Anthropic ships. The subscription session is the one the CLI opens when you run `claude setup-token` — on your Mac, in your keychain, the same way you'd use it yourself."
  - **Same machine, same user.** "Maxbridge never tries to reuse your session across machines. Each Mac you install it on needs its own login. This is deliberate. Shared sessions are what Anthropic blocked in April; we don't do that."
  - **No API key required.** "If you have `ANTHROPIC_API_KEY` set, Maxbridge explicitly strips it before spawning the CLI. The only billable mode is: you, your subscription, your Mac. No accidental overage."
- **Quiet footer line:** "We'll move to a sanctioned third-party OAuth path the day Anthropic ships one. Until then, this is the local-only way."

### 3.7 Pricing (fold 6)

Two plans, side-by-side. No enterprise card (adds confusion for a $12 product).

**Plan A — Subscription**
- `$12 / month`
- 7-day free trial (email only, no card)
- Cancel any time from the app
- All features, all updates while subscribed
- *Best for:* trying it out, short-term use

**Plan B — Lifetime**
- `$89 one-time`
- 1 year of updates included
- Then $29/year for continued updates, or keep the last version forever
- *Best for:* long-term users, "I don't want another subscription"

Below both: "Volume discount for teams of 5+? [Contact us →]"

Under the cards, a short reassurance line: "7-day money-back, no questions. If your Mac dies, license transfers — email us."

### 3.8 FAQ (fold 7)

Accordion, 10 questions max. Write them in the order that matches objection flow:

1. **Is this against Claude's Terms of Service?** (The core objection. Answer: "No — Maxbridge runs the official `claude` CLI on your own Mac. Your subscription's local usage is what Anthropic's TOS explicitly allows. What Anthropic blocked in April was third-party services piping subscription quota across users or machines; Maxbridge does neither.")
2. **Will Anthropic block this too?** (Transparency. "Possibly — we can't speak for them. Our architecture is the conservative path: local-only, per-machine, single-user, official CLI. That's the same usage pattern as someone typing into Claude Desktop. If Anthropic ever restricts that, every Claude user is affected, not just us.")
3. **Do you see my prompts?** ("No. Maxbridge runs on your Mac. No data leaves unless Anthropic's CLI sends it to Anthropic — same as Claude Desktop.")
4. **Do you need a credit card for the trial?** ("No. Email only. You'll get a license key by email, good for 7 days.")
5. **What happens after the trial?** ("If you don't subscribe or buy, the app keeps working in a read-only proof mode — you can see the bridge but can't route requests. No data is deleted.")
6. **Does it work without internet?** ("The proxy and CLI run locally. Anthropic's servers still need internet, same as the Claude app.")
7. **Windows/Linux?** ("Mac-only at launch. Windows is on the roadmap; Linux is under consideration if there's demand.")
8. **Can I self-host the license server?** ("Enterprise customers can — ping sales. Individual lifetime licenses are validated once at install and then work offline.")
9. **What if Anthropic changes the CLI?** ("We update Maxbridge within days. The built-in auto-updater handles it.")
10. **How do I get my money back?** ("Email within 7 days for any reason. Full refund.")

### 3.9 Footer

Three columns:

- **Product:** Download, Pricing, Changelog, Roadmap
- **Support:** Docs, Status, Contact, Refund policy
- **Legal:** Terms, Privacy, DMCA, Impressum (the company name, address — whatever the legal entity is)

Copyright line: `© 2026 Maxbridge. Not affiliated with Anthropic PBC.` (Important disclaimer — avoids trademark issues.)

---

## 4. Visual language — keep it calm, technical, trustworthy

- **Color palette:**
  - Background: off-white `#FAFAF7` / dark `#0F1115`.
  - Primary text: `#0A0A0A` / `#F4F4F5`.
  - Accent: a muted teal `#0E7490` or deep indigo `#3730A3`. NOT Anthropic's warm orange.
  - Errors / warnings: red-500. Success: green-600.
- **Typography:** Inter (variable) for UI, iA Writer Quattro or JetBrains Mono for code blocks. System stack fallback. No Google Fonts — self-host everything for performance and privacy.
- **Imagery:** one hero video. All other visuals are SVG diagrams or thin-line icons (no stock photography, no generic SaaS illustrations of happy people with laptops).
- **Spacing:** generous. Each fold should feel like one idea, one breath. Section padding 96px desktop / 48px mobile.
- **Motion:** subtle. Fades on scroll-in, no parallax, no animated gradients.

---

## 5. Technical requirements

- **Stack:** Astro (preferred) with Tailwind, or Next.js 14 App Router. No client-side React needed below the hero fold — use islands for the video player only.
- **Perf budget:** JS ≤ 30KB gzipped on first paint. Hero video lazy-loads only after the poster is visible.
- **Accessibility:** keyboard navigable, ARIA labels, prefers-reduced-motion, prefers-color-scheme, alt text everywhere, headings in correct order.
- **Analytics:** **Plausible or Fathom** (cookieless). No GA, no Facebook pixel, no Hotjar. This is a privacy-positioned product — the page must walk the talk.
- **Tracking:** `trial-started`, `download-clicked`, `checkout-started`, `checkout-completed` — these four events only. Everything else is vanity.
- **SEO:** target "Claude Max third party", "OpenClaw alternative", "Claude Max subscription bridge", "Anthropic subscription proxy". Title and meta-description in the head; Open Graph image is the hero diagram; Twitter card large.

---

## 6. CTAs and the trial funnel

Every primary CTA on the page points to the same place: a modal (or new page) that:

1. Asks for email.
2. Shows Stripe Checkout for either subscription or lifetime (two tabs).
3. For the 7-day free trial: collects email only, no card. Sends a license key and download link to that email. Starts the 7-day clock.
4. For paid plans: Stripe Checkout → webhook issues a license key → sends download + key.

The page itself never collects card data — Stripe Checkout does. The landing page's only database rows are `email, trial_started_at, license_key, plan` (and we only write those from the webhook, not the page).

---

## 7. What this brief does NOT cover

- **Docs site** — separate brief. Use Mintlify or Nextra subdomain `docs.maxbridge.ai`.
- **Blog / changelog** — Sprint 4+. Changelog page stub is fine for v1.
- **Status page** — `status.maxbridge.ai` is out of scope until we have real uptime to show.
- **Affiliate program** — not v1.
- **Localization** — English-only at launch. Turkish (founder's language) planned for v1.1.

---

## 8. Definition of done

- 1 page, <50KB HTML + CSS on first paint, video lazy-loaded.
- Lighthouse Performance ≥ 95, Accessibility ≥ 95, Best Practices = 100.
- `Start 7-day free trial →` clickable at every scroll depth.
- Mobile passes thumb-reachability for primary CTA on 390px width.
- FAQ accordion works without JS (use `<details>`/`<summary>`).
- Hero video has a static poster fallback for reduced-motion users.
- Legal disclaimer in footer: `Not affiliated with Anthropic PBC.`

Hand this brief to Claude Design verbatim. Expect back: Astro project or Next app, deploy-ready, one README with `pnpm dev` / `pnpm build` / `pnpm preview`. Review in order of impact — hero → problem fold → pricing → FAQ.
