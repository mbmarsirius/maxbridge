# Patch — `src-tauri/tauri.conf.json`

Per spec §2 and §6. **Do not hand-edit this into production until Mus has:**

1. Run `security find-identity -v -p codesigning` and captured the exact
   "Developer ID Application: …" string (including `(TEAMID)`).
2. Generated the Tauri updater keypair (`npx @tauri-apps/cli signer generate`)
   and captured the **public** key.
3. Confirmed the final `identifier` and `productName` are frozen.

Current file (as of 2026-04-20) ends at line 38 with `"macOS": { "minimumSystemVersion": "13.0" }`. Below is a minimal diff-style description of what to add.

---

## §2 — `bundle.macOS` additions

Replace the current block:

```json
"macOS": {
  "minimumSystemVersion": "13.0"
}
```

with:

```json
"macOS": {
  "minimumSystemVersion": "13.0",
  "signingIdentity": "Developer ID Application: <Company Legal Name> (ABCDE12345)",
  "providerShortName": "ABCDE12345",
  "entitlements": "Entitlements.plist",
  "exceptionDomain": "127.0.0.1",
  "hardenedRuntime": true
}
```

> Note: `entitlements` is a path **relative to `src-tauri/`**, so `Entitlements.plist` resolves to `src-tauri/Entitlements.plist`. The spec text uses `"src-tauri/Entitlements.plist"` which works too, but the relative form is idiomatic.

## §2 — `bundle.resources` additions

Add (alongside `active`, `targets`, etc. inside `bundle`):

```json
"resources": [
  "../node-runtime/**/*",
  "../server-bundle/**/*"
]
```

These paths are relative to `src-tauri/`; they pull the artifacts produced by `scripts/build-bundle.sh` into `Maxbridge.app/Contents/Resources/`.

## §2 — `bundle.icon` list

Add (same level):

```json
"icon": [
  "icons/32x32.png",
  "icons/128x128.png",
  "icons/128x128@2x.png",
  "icons/icon.icns"
]
```

Regenerate these from a 1024×1024 source with `npx tauri icon path/to/source-1024.png` (spec §7).

## §2 — Tighten CSP

Replace:

```json
"security": { "csp": null }
```

with:

```json
"security": {
  "csp": "default-src 'self'; connect-src 'self' http://127.0.0.1:7423 https://api.maxbridge.ai"
}
```

## §6 — Updater plugin

Add a top-level `plugins` section (currently absent from the file):

```json
"plugins": {
  "updater": {
    "active": true,
    "endpoints": [
      "https://api.maxbridge.ai/v1/updater/{{target}}/{{current_version}}"
    ],
    "dialog": false,
    "pubkey": "<paste output of `npx @tauri-apps/cli signer generate` — .pub contents>",
    "windows": { "installMode": "passive" }
  }
}
```

> The `pubkey` is the **public** half of the Ed25519 keypair used by `publish-release.sh` to sign each DMG. The private half never leaves the password manager / GitHub secret `TAURI_PRIVATE_KEY`.

---

## Full merged tauri.conf.json (reference)

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
    "windows": [
      {
        "title": "Maxbridge",
        "width": 980,
        "height": 720,
        "resizable": true,
        "minWidth": 760,
        "minHeight": 560
      }
    ],
    "security": {
      "csp": "default-src 'self'; connect-src 'self' http://127.0.0.1:7423 https://api.maxbridge.ai"
    }
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
    "resources": [
      "../node-runtime/**/*",
      "../server-bundle/**/*"
    ],
    "macOS": {
      "minimumSystemVersion": "13.0",
      "signingIdentity": "Developer ID Application: <Company Legal Name> (ABCDE12345)",
      "providerShortName": "ABCDE12345",
      "entitlements": "Entitlements.plist",
      "exceptionDomain": "127.0.0.1",
      "hardenedRuntime": true
    }
  },
  "plugins": {
    "updater": {
      "active": true,
      "endpoints": [
        "https://api.maxbridge.ai/v1/updater/{{target}}/{{current_version}}"
      ],
      "dialog": false,
      "pubkey": "<paste Ed25519 pubkey here>",
      "windows": { "installMode": "passive" }
    }
  }
}
```

---

## Before applying this patch

- [ ] `src-tauri/Entitlements.plist` created from spec §3.
- [ ] `src-tauri/icons/` populated (`tauri icon …`).
- [ ] Ed25519 keypair generated, private half in password manager.
- [ ] `signingIdentity` string matches `security find-identity` output **exactly** (including spaces and team id in parens).
