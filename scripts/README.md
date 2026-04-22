# Maxbridge build & release scripts

Automation for producing the Maxbridge daemon bundle and the (legacy) DMG artifact.

All scripts are bash, set `-euo pipefail`, log with timestamps, and respect `NO_COLOR`. They resolve the project root from their own location, so they work from any cwd.

---

## Current path — daemon tarball (v0.1.1+)

The public install pipeline ships the daemon as a tarball, not a `.app`:

```
server-bundle/server.js   ← esbuild single-file bundle of server/index.ts
node-runtime/              ← Node 20.18.0 for darwin-arm64, pinned
```

Both are produced by `build-bundle.sh`, then packed with `tar -czf` into `maxbridge-daemon-v0.1.1-darwin-arm64.tar.gz` and attached to the GitHub release. `install.sh` downloads + sha256-verifies + extracts into `~/.maxbridge/` and boots a `launchd` daemon — no `.app`, no Applications folder, no GUI.

| File | Purpose | When to run |
|---|---|---|
| `_lib.sh` | Shared logging + helpers (sourced by every script). | Never directly. |
| `build-bundle.sh` | Downloads Node 20.18.0 (cached at `~/.cache/maxbridge-node/`), extracts to `node-runtime/`, esbuilds `server/index.ts` → `server-bundle/server.js`, smoke-tests it on `:7423/healthz`. | Before every daemon tarball release. |
| `dev-rebuild-watch.sh` | Watches `server/` and rebuilds the bundle on change (no signing). | During dev. |
| `preflight.sh` | Sanity check before development. | Manual. |

## Release steps (daemon-only path)

```bash
# 1. Build the Node bundle + download node-runtime
bash scripts/build-bundle.sh

# 2. Pack tarball (node_modules, include/, and man pages excluded to keep size down)
tar -czf maxbridge-daemon-v0.1.1-darwin-arm64.tar.gz \
  --exclude='node-runtime/include' \
  --exclude='node-runtime/share' \
  --exclude='node-runtime/lib/node_modules/npm' \
  --exclude='node-runtime/lib/node_modules/corepack' \
  server-bundle node-runtime

# 3. Upload to the v0.1.0 GitHub release and update the pinned SHA256 in
#    worker/src/install-sh.ts
gh release upload v0.1.0 maxbridge-daemon-v0.1.1-darwin-arm64.tar.gz --clobber

# 4. Deploy the Worker so the /install.sh?free=1 endpoint renders with the
#    new hash
cd worker && npx wrangler deploy
```

---

## Legacy path — DMG (v0.1.0 only, deprecated)

The original release shipped a Tauri-wrapped `.app` inside a DMG. v0.1.1+ abandoned that path because the `.app` wrapper triggered macOS TCC prompts on some user Macs and added install friction (Applications-folder touch, GUI onboarding wizard). The DMG is retained on the v0.1.0 release for inspection only — `install.sh` no longer downloads it.

The following scripts belong to the legacy DMG pipeline and are kept only for reference:

| File | Purpose |
|---|---|
| `sign-and-notarize.sh` | Pre-flight verifies signature, submits the DMG to Apple notary, staples, runs `spctl`. |
| `publish-release.sh` | Signs the DMG with the Tauri updater key, uploads DMG + `.sig` to R2, writes `latest.json`. |
| `ci-github-actions-release.yml` | Template workflow for automated signed DMG releases. |

None of these need to run for the current daemon-tarball path.

---

## Prerequisites for daemon-tarball builds

- macOS (Apple Silicon) — required because the bundled `node-runtime/` ships the darwin-arm64 binary.
- `curl`, `tar`, `npx`, `node` — standard dev toolchain.
- Internet access for the one-time Node 20.18.0 download (cached after).

Nothing is needed for signing, notarization, or Apple developer tools — those only matter for the legacy DMG path.
