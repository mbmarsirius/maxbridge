# Spec — Maxbridge Signed `.dmg` Bundle (Sprint 3)

End-to-end recipe to produce `Maxbridge.dmg` that:

- Code-signed with the company Apple Developer ID Application certificate.
- Notarized by Apple (no Gatekeeper "unidentified developer" warning).
- Installs by drag-and-drop to `/Applications`.
- Auto-updates without re-prompting Gatekeeper.
- Bundles the Node runtime so the user does NOT need to install Node themselves.
- Bundles the Maxbridge UI + proxy server.
- Does NOT bundle the Anthropic `claude` CLI — that's downloaded separately by the user (the CLI is the legal-clean OAuth source; us shipping it would muddy the "we just shell out to Anthropic's official tool" defense).

---

## 1. Prerequisites — what Mus needs to set up once

These are one-time setup tasks on Mus's company Apple Developer account. Each takes 5–15 minutes.

### 1.1 Apple Developer account requirements
- ✅ Active company Apple Developer Program membership ($99/year — Mus has).
- Account role: Account Holder OR Admin (not just App Manager).
- Company name as it should appear in macOS "verified by …": this is what the Developer ID cert binds to.

### 1.2 Generate the **Developer ID Application** certificate
This is the cert that signs the `.app` bundle inside the `.dmg`.

```bash
# On Mus's Mac, in Keychain Access:
# 1. Keychain Access → Certificate Assistant → Request a Certificate from a Certificate Authority
# 2. Email: <admin email on Apple Dev account>
# 3. Common Name: Maxbridge (or company legal name)
# 4. Saved to disk (NOT email request) → CertificateSigningRequest.certSigningRequest
```

Then upload to Apple:
1. https://developer.apple.com/account → Certificates, IDs & Profiles → Certificates → "+"
2. Type: **Developer ID Application** (not Mac App Store distribution).
3. Upload the CSR file from above.
4. Download the issued `.cer`.
5. Double-click to install in Keychain → it pairs with the private key.

Verify:
```bash
security find-identity -v -p codesigning | grep "Developer ID Application"
# Expected: 1 line with "Developer ID Application: <Company> (TEAMID)"
```

Capture the `TEAMID` (10-char string in parentheses) — needed for notarization.

### 1.3 Generate the **Developer ID Installer** certificate (optional, only if shipping `.pkg`)
Skip — Maxbridge ships `.dmg`, not `.pkg`. Drag-to-Applications is friendlier than installer wizards for this audience.

### 1.4 Create an **App-Specific Password** for `notarytool`
Apple requires app-specific passwords for CLI notarization (not your main Apple ID password).

1. https://account.apple.com → Sign-In and Security → App-Specific Passwords → Generate.
2. Label: `maxbridge-notarytool`.
3. Save the resulting password (looks like `abcd-efgh-ijkl-mnop`) into Mus's password manager.

### 1.5 Store credentials in macOS Keychain for `notarytool`

```bash
xcrun notarytool store-credentials "maxbridge-notarytool" \
  --apple-id "admin@yourcompany.com" \
  --team-id "ABCDE12345" \
  --password "abcd-efgh-ijkl-mnop"
```

Now `notarytool` can be invoked by name: `--keychain-profile "maxbridge-notarytool"`.

---

## 2. Tauri bundle config

`src-tauri/tauri.conf.json` — already partially updated, needs signing identity + updater fields:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Maxbridge",
  "version": "0.1.0",
  "identifier": "ai.maxbridge.app",
  "build": {
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build",
    "devUrl": "http://localhost:1420",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [{
      "title": "Maxbridge",
      "width": 980, "height": 720,
      "resizable": true,
      "minWidth": 760, "minHeight": 560
    }],
    "security": { "csp": "default-src 'self'; connect-src 'self' http://127.0.0.1:7423 https://api.maxbridge.ai" }
  },
  "bundle": {
    "active": true,
    "targets": ["dmg"],
    "publisher": "Maxbridge",
    "category": "DeveloperTool",
    "shortDescription": "Use your Claude Max subscription with any local app — no API key.",
    "longDescription": "Maxbridge runs a local-only HTTP proxy on your Mac that lets OpenAI/Anthropic-compatible apps talk to Claude Opus 4.7 through your existing Claude Max OAuth session. Zero API keys, zero data leaves your machine.",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns"
    ],
    "macOS": {
      "minimumSystemVersion": "13.0",
      "signingIdentity": "Developer ID Application: <Company> (ABCDE12345)",
      "providerShortName": "ABCDE12345",
      "entitlements": "src-tauri/Entitlements.plist",
      "exceptionDomain": "127.0.0.1",
      "hardenedRuntime": true
    },
    "resources": [
      "../node-runtime/**/*",
      "../server-bundle/**/*"
    ]
  },
  "plugins": {
    "updater": {
      "active": true,
      "endpoints": ["https://api.maxbridge.ai/v1/updater/{{target}}/{{current_version}}"],
      "dialog": false,
      "pubkey": "<bundled Ed25519 pubkey for update signature verification>",
      "windows": { "installMode": "passive" }
    }
  }
}
```

`signingIdentity` must match what `security find-identity` showed.

---

## 3. Entitlements (`src-tauri/Entitlements.plist`)

Hardened Runtime is required for notarization. We need a few entitlements because we spawn a child process (`claude`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.app-sandbox</key>
  <false/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
  <key>com.apple.security.cs.allow-dyld-environment-variables</key>
  <true/>
  <key>com.apple.security.network.client</key>
  <true/>
  <key>com.apple.security.network.server</key>
  <true/>
</dict>
</plist>
```

Key rationale:
- `app-sandbox = false` — we MUST be unsandboxed to spawn `claude` from `/usr/local/bin` or wherever it lives. (App Store would force sandbox; we're direct-distributing.)
- `disable-library-validation` — Node's V8 loads dynamic libraries that aren't signed by us.
- `network.client` + `network.server` — outbound (Anthropic via CLI) and inbound (proxy on 127.0.0.1).
- No microphone, camera, location, contacts — Maxbridge needs none of these.

---

## 4. Bundling Node runtime

Tauri ships a Rust shell — no Node by default. We need Node to run the proxy. Two approaches; we pick **Approach B** for speed and reliability.

### Approach A — Compile to a single binary (faster runtime, harder packaging)
Use `pkg` or `bun build --compile` to produce a self-contained executable from `server/index.ts`. Bundle that binary as a Tauri sidecar.
- Pro: no Node install needed; smaller bundle.
- Con: Bun-compiled binaries don't always handle the full Node ecosystem correctly; debugging weird deps gets painful.

### Approach B — Bundle Node + run our TS via tsx (chosen)
Embed a portable Node 20 runtime inside the `.app`. Spawn it from Tauri's Rust shell:

```
Maxbridge.app/
└── Contents/
    ├── MacOS/
    │   └── Maxbridge          (Tauri-built binary)
    └── Resources/
        ├── node-runtime/
        │   └── bin/node       (~80MB)
        ├── server-bundle/
        │   └── server/
        │       └── index.js   (esbuild-bundled, no node_modules needed)
        └── ...
```

**Build steps (run before `tauri build`):**

```bash
# 1. Download Node runtime for arm64-darwin and x64-darwin
mkdir -p node-runtime/arm64 node-runtime/x64
curl -L https://nodejs.org/dist/v20.18.0/node-v20.18.0-darwin-arm64.tar.gz | \
  tar xz -C node-runtime/arm64 --strip-components=1
curl -L https://nodejs.org/dist/v20.18.0/node-v20.18.0-darwin-x64.tar.gz | \
  tar xz -C node-runtime/x64 --strip-components=1

# 2. esbuild the server into a single self-contained .js file
mkdir -p server-bundle
npx esbuild server/index.ts \
  --bundle --platform=node --target=node20 \
  --external:fsevents \
  --outfile=server-bundle/server.js
```

**Tauri Rust shell (`src-tauri/src/main.rs`)** spawns the proxy on app launch:

```rust
use tauri::Manager;
use std::process::Command;

fn main() {
  tauri::Builder::default()
    .setup(|app| {
      let resource_path = app.path_resolver().resource_dir().unwrap();
      let node_bin = resource_path.join("node-runtime/bin/node");
      let server_js = resource_path.join("server-bundle/server.js");

      let mut child = Command::new(node_bin)
        .arg(server_js)
        .env("MAXBRIDGE_PORT", "7423")
        .spawn()
        .expect("Failed to start Maxbridge proxy");

      app.manage(child);
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
```

App quit signal kills the child — clean shutdown.

Trade-off: bundle size grows from ~10MB to ~90MB. Acceptable for a one-time download.

---

## 5. Build pipeline — local + CI

### 5.1 Local build (Mus's Mac)

```bash
# From ~/Desktop/maxbridge/
npm run build:bundle      # custom script: download node-runtime + esbuild server
npx tauri build           # produces target/release/bundle/dmg/Maxbridge_0.1.0_universal.dmg
```

The DMG is signed automatically (because `signingIdentity` is set in `tauri.conf.json`).

### 5.2 Notarize

```bash
xcrun notarytool submit \
  src-tauri/target/release/bundle/dmg/Maxbridge_0.1.0_universal.dmg \
  --keychain-profile "maxbridge-notarytool" \
  --wait

# Wait ~3–10 minutes. On success:
xcrun stapler staple \
  src-tauri/target/release/bundle/dmg/Maxbridge_0.1.0_universal.dmg

# Verify:
spctl --assess --type install --verbose \
  src-tauri/target/release/bundle/dmg/Maxbridge_0.1.0_universal.dmg
# Expected: "accepted" + "notarized Developer ID"
```

### 5.3 CI (GitHub Actions, Sprint 3.5)

`.github/workflows/release.yml` — triggered on git tag `v*`:

```yaml
name: Release
on: { push: { tags: ['v*'] } }
jobs:
  build:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - uses: dtolnay/rust-toolchain@stable
      - name: Import Apple cert
        env:
          MAC_CERT_BASE64: ${{ secrets.MAC_CERT_BASE64 }}
          MAC_CERT_PASSWORD: ${{ secrets.MAC_CERT_PASSWORD }}
        run: |
          # Decode and install the .p12 cert into a temp keychain
          ...
      - name: Build + notarize
        env:
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
          APPLE_PASSWORD: ${{ secrets.APPLE_APP_PASSWORD }}
        run: |
          npm ci
          npm run build:bundle
          npx tauri build
          xcrun notarytool submit ... --wait
          xcrun stapler staple ...
      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with: { name: dmg, path: src-tauri/target/release/bundle/dmg/*.dmg }
      - name: Publish update manifest
        run: ./scripts/publish-update-manifest.sh
```

---

## 6. Auto-updater

Tauri's built-in updater plugin polls our endpoint on app start (with a 4h dedupe):

`GET https://api.maxbridge.ai/v1/updater/darwin-aarch64/0.1.0`

Response (200) when an update exists:

```json
{
  "version": "0.1.1",
  "notes": "Bug fixes and stability improvements.",
  "pub_date": "2026-04-25T12:00:00Z",
  "url": "https://releases.maxbridge.ai/0.1.1/Maxbridge_0.1.1_aarch64.dmg",
  "signature": "<base64 Ed25519 sig of the .dmg>"
}
```

(Or 204 No Content when up to date.)

The `signature` is verified by the Tauri updater plugin against the bundled pubkey before installing — this prevents an attacker who somehow took over our release host from pushing malicious updates.

Generating the keypair (one-time, on Mus's Mac):

```bash
npx @tauri-apps/cli signer generate -w ~/.maxbridge/updater_key
# Pubkey → src-tauri/tauri.conf.json plugins.updater.pubkey
# Private key → encrypted, stored as GitHub Actions secret TAURI_PRIVATE_KEY
```

Each release, CI signs the DMG:

```bash
npx @tauri-apps/cli signer sign \
  -k $TAURI_PRIVATE_KEY \
  -p $TAURI_KEY_PASSWORD \
  src-tauri/target/release/bundle/dmg/Maxbridge_0.1.1_aarch64.dmg
# → outputs Maxbridge_0.1.1_aarch64.dmg.sig
```

The CI step `publish-update-manifest.sh` uploads both the DMG and its `.sig`, then writes a JSON manifest the updater endpoint serves.

---

## 7. Icons + branding assets

Required files in `src-tauri/icons/`:

```
icon.icns           (macOS bundle icon — 1024x1024 source @ all sizes)
icon.ico            (Windows, future)
icon.png            (Linux, future)
32x32.png
128x128.png
128x128@2x.png      (256x256 actual)
```

Create via `cargo tauri icon path/to/source-1024.png` (auto-generates all sizes).

**Source icon spec:**
- 1024×1024 PNG with transparent background.
- macOS rounded-square mask applied automatically by macOS — design on a square, leave 12% padding.
- Single visual mark — Mus picks. Suggested motif: a stylized "bridge" or "M" silhouette, calm tone matching the design system (teal/indigo accent on neutral).

Hand the icon source to whoever does Maxbridge's brand identity (Claude Design or a designer). Until then, use a placeholder generated in Figma.

---

## 8. Distribution

Two CDNs, separate concerns:

- **`releases.maxbridge.ai`** — DMG + .sig hosting. Static, served by Cloudflare R2. Versioned paths: `/0.1.0/Maxbridge_0.1.0_aarch64.dmg`. Public-read, no auth.
- **`api.maxbridge.ai/v1/updater/...`** — manifest endpoint, returns the latest version JSON. Cloudflare Worker; reads from R2 metadata.

The landing page download button hits `https://releases.maxbridge.ai/latest/Maxbridge.dmg` — a redirect to the current latest. Maintained by the same CI script that publishes releases.

---

## 9. Verification matrix (run before EVERY release)

| Test                                                           | How                                                                | Pass criteria                                  |
|----------------------------------------------------------------|--------------------------------------------------------------------|------------------------------------------------|
| Cert is valid                                                  | `security find-identity -v -p codesigning`                         | "Developer ID Application: …" present.         |
| App is signed                                                  | `codesign -dv --verbose=4 Maxbridge.app`                           | Authority chain ends in Apple Root CA.         |
| Hardened Runtime enabled                                       | `codesign -dvv Maxbridge.app 2>&1 \| grep -i runtime`              | "runtime" flag present.                        |
| Notarization stapled                                           | `stapler validate Maxbridge.dmg`                                   | "The validate action worked!"                  |
| Gatekeeper accepts                                             | `spctl --assess --type install Maxbridge.dmg`                      | "accepted"                                     |
| Fresh-Mac install (clean macOS VM)                             | Open the DMG, drag to Applications, double-click                   | No warnings; app launches; proxy bound on 7423.|
| Updater signature                                              | Trigger update from 0.1.0 → 0.1.1 in dev                           | Update applies silently, app relaunches.       |

Failing any row blocks the release.

---

## 10. Cost summary (Mus-side, recurring)

- Apple Developer Program: $99/year (already paid).
- Cloudflare Workers: $0–5/month at launch volume.
- Cloudflare R2: ~$0.015/GB/month + $0.36/million ops (free tier covers launch).
- Resend (email): free up to 3000/mo, then $20/month.
- Domain `maxbridge.ai`: ~$30/year (already may need to be registered).

Total recurring: <$25/month at <1000 customers, <$60/month at <10k.

---

## 11. Open questions for Mus

1. **Universal binary vs arm64-only?** Universal (Intel + Apple Silicon) doubles bundle size. Mac Intel sales <5% in 2026; recommend arm64-only for v1, add Intel only if a customer asks.
2. **Auto-update policy.** Default: silently install on next app start (Tauri `installMode: passive`). Alternative: prompt user before install (more "macOS native" feel). Recommend passive — solo founders don't want to babysit changelogs.
3. **Crash reporting.** Sentry is the obvious pick (free tier covers launch volume). Privacy positioning conflict — need to explicitly tell user "we collect crash dumps, can opt out". Recommend opt-IN (off by default), with a toggle in the wizard's "Help us improve" footer.
4. **Beta channel.** Should there be a `beta` updater channel for power users who want pre-release builds? Recommend not for v1 — adds complexity. Add post-launch when there's a community asking.

When all four are answered, Sprint 3 implementation begins.
