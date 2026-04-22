# Maxbridge build & release scripts

Automation for producing a signed + notarized + R2-published `Maxbridge.dmg`.
Implements [`docs/spec-tauri-bundle.md`](../docs/spec-tauri-bundle.md).

All scripts are bash, set `-euo pipefail`, log with timestamps, and respect
`NO_COLOR`. They resolve the project root from their own location, so they
work from any cwd.

---

## Files

| File | Purpose | When to run |
|---|---|---|
| `_lib.sh` | Shared logging + helpers (sourced by every script). | Never directly. |
| `build-bundle.sh` | Downloads Node 20.18.0 (cached at `~/.cache/maxbridge-node/`), extracts to `node-runtime/`, esbuilds `server/index.ts` → `server-bundle/server.js`, smoke-tests it on `:7423/healthz`. | Before every `tauri build`. |
| `sign-and-notarize.sh` | Pre-flight verifies signature, submits the DMG to Apple notary, staples, runs `spctl`. | After `tauri build`. |
| `publish-release.sh` | Signs the DMG with the Tauri updater key, uploads DMG + `.sig` to R2, writes `latest.json`. | After notarization. |
| `verify-release.sh` | Spec §9 verification matrix — colored PASS/FAIL table, non-zero exit on any failure. | Anytime; mandatory before publish. |
| `dev-rebuild-watch.sh` | Watches `server/` and rebuilds the bundle on change (no signing). | During dev. |
| `ci-github-actions-release.yml` | Template for `.github/workflows/release.yml`. **Do not** move into `.github/workflows/` until secrets are set. | When CI is being turned on. |
| `tauri-conf-patch.md` | Documents the additions needed in `src-tauri/tauri.conf.json` (signingIdentity, hardenedRuntime, resources, updater plugin). | Before first signed build. |
| `preflight.sh` | (Pre-existing) — sanity check before development. | Manual. |

---

## Prerequisites (one-time, on Mus's Mac)

Spec §1 walks through these in detail.

1. **Apple Developer Program** membership (already paid).
2. **Developer ID Application** certificate installed in login keychain.
   Verify: `security find-identity -v -p codesigning | grep "Developer ID Application"`.
3. **App-specific password** for `notarytool`, stored in keychain:
   ```bash
   xcrun notarytool store-credentials "maxbridge-notarytool" \
     --apple-id "admin@yourcompany.com" \
     --team-id "ABCDE12345" \
     --password "abcd-efgh-ijkl-mnop"
   ```
4. **Tauri updater keypair**:
   ```bash
   npx @tauri-apps/cli signer generate -w ~/.maxbridge/updater_key
   # Pubkey → src-tauri/tauri.conf.json plugins.updater.pubkey (see tauri-conf-patch.md)
   # Privkey → password manager + GitHub secret TAURI_PRIVATE_KEY
   ```
5. **Tauri toolchain**: `xcode-select --install`, then `cargo install tauri-cli` (or use `npx tauri` per the npm script).
6. **AWS CLI** for R2 uploads: `brew install awscli`. (Pre-installed on the `macos-14` GitHub runner.)
7. **R2 bucket** `maxbridge-releases` created in Cloudflare, with public-read on `releases.maxbridge.ai`.

### R2 uploader: aws CLI vs rclone

`publish-release.sh` uses the **`aws` CLI** pointed at the R2 S3-compatible
endpoint. Reasons:

- Pre-installed on `macos-14` GitHub runners — zero CI install step.
- One config surface (`AWS_*` env vars) instead of an `rclone.conf` file.
- The R2 API is S3-compatible enough that `aws s3 cp` works without quirks.

If you'd rather use rclone, swap the `aws_r2 s3 cp …` lines for
`rclone copyto …` and add an `rclone.conf` with `type = s3, provider = Cloudflare`.

---

## Local release flow (Mus, ~10 min for the build, ~10 min for notary wait)

```bash
cd ~/Desktop/maxbridge

# 1. Bundle Node + esbuild server, smoke-test
bash scripts/build-bundle.sh

# 2. Build the .app + .dmg (Tauri auto-signs because signingIdentity is set)
npx tauri build

# 3. Notarize + staple + spctl-verify
bash scripts/sign-and-notarize.sh

# 4. Run the spec §9 matrix — must be all-green
bash scripts/verify-release.sh

# 5. Sign DMG with updater key + push DMG/.sig/latest.json to R2
export TAURI_PRIVATE_KEY="$(cat ~/.maxbridge/updater_key)"
export TAURI_KEY_PASSWORD="********"
export R2_ACCESS_KEY_ID="********"
export R2_SECRET_ACCESS_KEY="********"
export R2_ACCOUNT_ID="********"
CREATE_GIT_TAG=1 PUSH_GIT_TAG=1 \
  bash scripts/publish-release.sh           # version comes from tauri.conf.json
```

That's it — the landing page's download button hits `releases.maxbridge.ai/<version>/Maxbridge_<version>_aarch64.dmg`, and any installed app polls `latest.json` and self-updates on next launch.

## CI release flow (when ready)

1. Set the nine `# TODO: set secret …` values in repo Settings → Secrets.
2. Move `scripts/ci-github-actions-release.yml` to `.github/workflows/release.yml`.
3. Bump version in `src-tauri/tauri.conf.json` and `package.json`.
4. `git commit -am "release: 0.1.1" && git tag v0.1.1 && git push --tags`.
5. CI runs the same five steps above.

---

## Dev loop

```bash
bash scripts/dev-rebuild-watch.sh   # rebuilds server-bundle/server.js on save
# in another terminal:
npx tauri dev                        # spawns the proxy from the rebuilt bundle
```

`dev-rebuild-watch.sh` uses `chokidar-cli`. It's pulled on demand via `npx --yes`; if you'd rather have it locally cached, run `npm i -D chokidar-cli`. **Not** added to `package.json` automatically — Mus's call.

---

## Troubleshooting

- **"DMG is not signed with a 'Developer ID Application' authority"** → `signingIdentity` in `tauri.conf.json` doesn't match what's installed in keychain. Run `security find-identity -v -p codesigning` and copy the line **exactly**, including the team-id parens.
- **Notary returns `Invalid`** → `sign-and-notarize.sh` automatically dumps `xcrun notarytool log <id>`. Most common cause: missing hardened-runtime entitlement, or a sub-binary inside the .app that wasn't signed. Tauri normally handles all sub-binaries; if it didn't, check that `node-runtime/bin/node` got signed too.
- **`spctl` says rejected** → staple step failed or the network was down during stapling. Re-run `xcrun stapler staple <dmg>` once the network is healthy.
- **Bundle smoke test fails on port 7423** → another process is bound. `lsof -i:7423` to find it. Re-run `build-bundle.sh` after killing it (or set `MAXBRIDGE_PORT=<other>` for the script).

---

## What this does NOT do

- **Does not** provision the Apple Developer cert (manual, per spec §1.2).
- **Does not** create the Cloudflare R2 bucket / DNS / Worker (one-time infra).
- **Does not** sign macOS installer `.pkg` (Maxbridge ships `.dmg` only — spec §1.3).
- **Does not** edit `src-tauri/tauri.conf.json` automatically — see `tauri-conf-patch.md`.
- **Does not** ship Anthropic's `claude` CLI inside the `.app` (legal-clean separation — spec §0).
