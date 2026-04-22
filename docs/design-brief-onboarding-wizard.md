# Design Brief #1 — Maxbridge Onboarding Wizard (Tauri app UI)

**Audience for this brief:** Claude Design (or any LLM-aided designer). The output is a set of React + TSX components that live under `src/wizard/` and replace the current dev proof panel as the default view in `App.tsx`.

**Output format expected:** clean, accessible React 18 components, minimal dependencies (no UI library required — Tailwind optional), keyboard-navigable, dark-mode aware, 980×720 window as the design canvas.

---

## 1. Who is this for

The user just downloaded `Maxbridge.dmg`, dragged it to Applications, and double-clicked it. They:

- Have a Claude Pro or Max subscription already.
- May or may not have the `claude` CLI installed.
- May or may not have run `claude setup-token` yet.
- Probably run OpenClaw (our first-wave audience — orphaned by Anthropic's April 4 lockout).
- Are *not* required to be developers. We assume fluency with "drag to Applications" and "paste a URL into an app's settings," nothing more.

**The product promise the UI must deliver, in under 90 seconds of clicks:** "Your Claude Max plan now works in any local app. Here's the URL. Here's a one-click button to wire up OpenClaw." Done.

---

## 2. Journey — the wizard's state machine

Every screen is a full-height card with a single clear primary action. The state machine:

```
welcome
  └─ "Get started" ─────────────┐
                                │
               ┌────────────────┴──────────────┐
               ▼                               ▼
       check-cli (loading)             (fetch GET /v1/local-bridge)
               │
               ▼
       ┌───────┴───────┐
       │               │
   cli-missing     cli-present
       │               │
       ▼               ▼
   install-cli     check-oauth
       │               │
       │           ┌───┴────┐
       │           ▼        ▼
       │      need-login  oauth-ok
       │           │        │
       │           ▼        │
       │      login-prompt  │
       │           │        │
       └───────────┴────────┘
                   ▼
              integrations
                   │
          ┌────────┼────────────┐
          ▼        ▼            ▼
      openclaw  generic     done (skip/later)
       auto      URL            │
        │        copy           │
        └────────┴───────┬──────┘
                         ▼
                    success (running)
                         │
                         ▼
                 status (menu-bar mode)
```

All state is driven by three HTTP calls against the local proxy (already running as soon as the app launches — the Tauri shell starts it):

- `GET /healthz` — proxy reachable?
- `GET /v1/local-bridge` — `{ state, claudeBinaryDetected, claudeVersion, loggedIn, authMethod }`
- `GET /v1/integrations/openclaw/detect` — `{ installed, providers, hasMaxbridgeProvider, agents }`

---

## 3. Screens — copy, layout, primary action

### 3.1 `welcome`

- **Headline (48pt, left-aligned):** "Use your Claude Max plan anywhere on this Mac."
- **Subhead (18pt, 60% opacity):** "Maxbridge routes local apps — OpenClaw, Cursor, Cline, Aider — through your own subscription. No API key. Nothing leaves your Mac."
- **Visual:** a single animated diagram (static SVG acceptable): your Mac → Maxbridge → Claude CLI OAuth (your Max) → Anthropic. Label under each arrow.
- **Primary CTA:** `Get started →` (full-width dark button at bottom of card).
- **Tertiary link (footer, 12pt muted):** "Already used Maxbridge? Restore license →".

### 3.2 `check-cli` (loading state)

- Full-card spinner + label: "Looking for the Claude CLI on your Mac…".
- Max 3 seconds, then transitions to `cli-missing` or `cli-present`. Never stall — if the probe times out, treat as `cli-missing` with a retry button.

### 3.3 `cli-missing`

- **Headline:** "Let's install the Claude CLI first."
- **Body:** "Maxbridge uses the official `claude` CLI from Anthropic to reach your subscription. It's free, takes ~30 seconds, and stays on your Mac."
- **Two buttons, side by side:**
  - `Open installer page` — primary. Opens `https://claude.ai/download` in the default browser via Tauri's `shell.open`.
  - `I already installed it — recheck` — secondary. Re-runs the CLI probe.
- **Footer micro-copy:** "We never see or store your Claude credentials. The CLI saves a token to your Mac's keychain."

### 3.4 `check-oauth` (inline, no dedicated screen — just a transitional spinner)

Transitions to `oauth-ok` or `need-login` inside ~2 seconds.

### 3.5 `need-login`

- **Headline:** "Log in to Claude — one-time."
- **Body:** "Run `claude setup-token` in your Terminal, then sign in to your Max plan in the browser window that opens. We'll pick it up automatically."
- **Primary CTA:** `Open Terminal and run it for me` — uses Tauri to run `osascript -e 'tell app "Terminal" to do script "claude setup-token"'`.
- **Secondary CTA:** `I did this — recheck`.
- **Status indicator (live):** polls `/v1/local-bridge` every 3s while this screen is visible. When `loggedIn=true && authMethod=oauth_token`, auto-advances to `integrations`.
- **Footer:** small grey text "Using an API key instead? [Advanced options →]" (hides in a drawer — most users don't need this.)

### 3.6 `integrations`

This is the **money screen** — everything before it was prerequisites, this is where the user gets value.

- **Headline:** "What should Maxbridge connect?"
- **Body:** "Pick the apps you want to run through your Max plan. You can add more later."
- **Card grid (3 columns on desktop, 1 on narrow):**

Each card has: app logo (32px), app name, one-line description, status pill, primary CTA.

| Card        | Status pill options                              | Primary CTA                    |
|-------------|--------------------------------------------------|--------------------------------|
| OpenClaw    | `Detected · N agents` / `Not installed`          | `Connect` / `Get OpenClaw`     |
| Cursor      | `Manual setup`                                   | `Show me how`                  |
| Cline       | `Manual setup`                                   | `Show me how`                  |
| Aider       | `Manual setup`                                   | `Copy env vars`                |
| Continue    | `Manual setup`                                   | `Show me how`                  |
| My own app  | `Manual setup`                                   | `Show endpoint`                |

**OpenClaw connect behavior (the hero flow):**

1. User clicks `Connect`.
2. Modal opens with three radio options:
   - `Add Maxbridge as an option (safe)` — calls `POST /v1/integrations/openclaw/install {}`.
   - `Use Maxbridge as the default for all agents` — calls `POST .../install { setAsDefault: true }`.
   - `Pick specific agents…` — reveals a checklist of agent ids from the earlier detect response. On confirm, calls `.../install { setForAgents: [...] }`.
3. On success: toast "OpenClaw updated. Restart the gateway to pick it up." with a `Restart gateway` button (runs `launchctl kickstart -k gui/$UID/ai.openclaw.gateway`).
4. Card status pill becomes `Connected ✓`.

**Manual setup cards** open a side drawer with:
- A copy-pasteable config snippet (see the QUICKSTART.md examples).
- A `Copy` button that copies to clipboard.
- A `Test this app` button (best-effort — opens the app's settings if installable via URL scheme, else just highlights the copy button).

- **Bottom of screen:** `Skip — I'll do this later →` (secondary), `I'm done →` (primary, goes to `success`).

### 3.7 `success`

- **Headline:** "You're bridged."
- **Body:** "Maxbridge is running at `http://127.0.0.1:7423`. Any app you connected is now using your Max plan."
- **Live stat block (3 columns, updates every 2s by polling `/v1/status`):**
  - Requests today: N
  - Model: `claude-opus-4-7`
  - Status: `Live · OAuth · Local-only`
- **Secondary CTA:** `Minimize to menu bar` — hides main window, icon stays in macOS menu bar (next screen).
- **Tertiary link:** "Having trouble? Open logs" — opens the proxy stdout file in Console.app.

### 3.8 `status` (menu-bar mode, not a full screen)

Once the user minimizes, the app lives in the macOS menu bar. Menu items:

- `● Active — 7 req/min` (status indicator, live)
- `Model: claude-opus-4-7`
- `Open dashboard` — re-shows the main window
- `Pause bridge` — stops the proxy until resumed
- `Quit Maxbridge`

---

## 4. Error & edge states (every screen)

- **Proxy unreachable:** full-screen red banner "Maxbridge isn't running. [Restart bridge]". Single button retries startup via Tauri command.
- **Claude CLI crashes mid-session:** toast at bottom, non-blocking, with log-open link.
- **Upstream Anthropic 429/529:** modal "Anthropic rate-limited your subscription. This isn't Maxbridge — try again in a few minutes."
- **License expired** (Sprint 2, out of scope for v1 visual design but leave space): a full-screen paywall state that intercepts `integrations` access until renewal.

---

## 5. Visual language

- **Typography:** system stack (SF Pro on macOS). Headlines 48/36/24/18pt. Body 15pt. Mono code blocks 13pt.
- **Color:** light mode default; follow `prefers-color-scheme`. One accent color — pick a calm teal or deep indigo, NOT orange-red (avoid "Anthropic brand collision"). Errors in red-500, success in green-600.
- **Spacing:** 24px card padding, 16px button padding. Generous whitespace — this is a product that says "calm".
- **Motion:** 200ms ease-out on all transitions. No bouncy springs. No celebratory confetti — we are infrastructure, not a game.
- **Accessibility:** all interactive elements keyboard-focusable, ARIA labels on status pills, prefers-reduced-motion respected.

---

## 6. Copy voice

Clear, confident, ego-free. A few rules:

- Never say "AI" when we mean "Claude" — be specific.
- Never promise what Maxbridge can't do cross-machine (the same-machine constraint is a feature, not a bug — frame it as "trustable, local, yours").
- Every error message tells the user what's next, not just what went wrong.
- Turkish locale support planned but v1 ships English-only.

---

## 7. What this brief does NOT cover

Deliberate scope limits, to be handled in later briefs:

- **License entry / paywall** — design brief #3 after Stripe flow is finalized.
- **Update notifications** — handled by Tauri updater with OS-level UI.
- **Settings screen** — deferred; everything is auto-configured in v1.
- **Multi-account / workspace switching** — not in v1.
- **Non-macOS** — Mac-only at launch.

---

## 8. Files to produce

When Claude Design returns the implementation, it should create:

```
src/
  WizardApp.tsx                  (state machine + router)
  wizard/
    WelcomeStep.tsx
    CliCheckStep.tsx
    CliMissingStep.tsx
    OAuthLoginStep.tsx
    IntegrationsStep.tsx
    OpenClawConnectModal.tsx
    ManualAppDrawer.tsx
    SuccessStep.tsx
    MenuBarView.tsx
    ErrorBanner.tsx
  wizard/lib/
    bridge-client.ts             (typed wrappers around /healthz, /v1/local-bridge, /v1/integrations/*)
    state.ts                     (reducer + action types)
    copy.ts                      (centralized strings, ready for i18n)
  styles/wizard.css              (design tokens + screen layouts)
```

Replace `src/App.tsx` with a thin shell that renders `<WizardApp />` by default and exposes the existing dev `ProofPanel` behind a `?dev=1` query flag for debugging.

---

## 9. Definition of done

- Fresh install → welcome screen in under 1 second.
- Claude CLI present + logged in → user lands on `integrations` in under 3 seconds of clicking "Get started".
- OpenClaw auto-connect happy path: 2 clicks from welcome to "Connected ✓".
- All screens pass keyboard-only navigation (Tab, Enter, Escape).
- Screens render correctly at 760×560 (minimum window size) and 1440×900.
- No external fonts or images loaded at runtime (everything ships with the bundle).

Hand this brief to Claude Design verbatim. Ask for the file list in section 8 as the output. Review the result, iterate on the two screens that do the most work — `integrations` and `success`.
