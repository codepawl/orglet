# macOS packaging

ZIP packaging of `Orglet.app` for dogfood. GitHub Actions on `macos-latest` **Developer ID signs and notarizes**: the signing and App Store Connect API key secrets were set on 2026-09-19, and run [35398258178](https://github.com/codepawl/orglet/actions/runs/35398258178) produced a stapled build (`flags=0x10000(runtime)`, `Notarization Ticket=stapled`). This job is **not** the required merge check.

Windows remains first: the required GitHub check is still the **Windows desktop** `test` aggregator. See [windows-release-gates.md](windows-release-gates.md). Do not treat a green macOS job as a substitute for that aggregator.

## Maker config

`forge.config.ts` keeps the Electron Forge stack:

| Maker | Platforms | Output |
|---|---|---|
| `@electron-forge/maker-zip` | `win32`, `darwin` | ZIP under `out/make/zip/<platform>/<arch>/` |
| `@electron-forge/maker-squirrel` | Windows only (Forge skips it on a Mac) | Setup under `out/make/squirrel.windows/` |

On a Mac, `pnpm make` packages `Orglet.app` for the current architecture (`darwin-arm64` on Apple Silicon, `darwin-x64` on Intel) and zips that `.app`. Typical path:

```
out/make/zip/darwin/arm64/Orglet-darwin-arm64-0.2.0.zip
```

The zip contains `Orglet.app`. DuckDB's native addon is included per OS (`@duckdb/node-bindings-darwin-arm64` / `darwin-x64`) and unpacked from ASAR (`.node` / `.dylib`).

`packagerConfig.osxSign` is set only when `APPLE_SIGNING_ENABLED=true` (CI after a successful P12 import). Identity defaults to `Developer ID Application: Xuan An Nguyen (D884WZQ6N4)` (Team ID `D884WZQ6N4`). Hardened runtime uses `build/entitlements.darwin.plist` (app) and `build/entitlements.darwin.inherit.plist` (helpers). Local `pnpm make` without that flag stays unsigned; Electron may still ad-hoc sign Apple Silicon so the binary can launch.

`packagerConfig.osxNotarize` needs Apple ID **or** App Store Connect API key env; a Developer ID `.p12` is not enough. CI uses the API key path (`APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`), so `pnpm make` notarizes and staples in the same step.

There is no DMG maker in this milestone.

## CI

`.github/workflows/macos.yml` (`macOS desktop`) runs on `macos-latest`:

1. `pnpm install --frozen-lockfile`
2. `pnpm typecheck`
3. `pnpm test`
4. Import Developer ID P12 into a job-local keychain when secrets exist (`scripts/ci-macos-import-signing.sh`)
5. `pnpm make` with `APPLE_SIGNING_ENABLED=true` after a successful import
6. `codesign --verify --deep --strict`, then `stapler validate` and `spctl --assess --type execute` on the packaged app. The runner is a real Mac, so these fail the job when a build would warn on download
7. Upload the darwin ZIP as `orglet-macos-signed-zip` or `orglet-macos-unsigned-zip` (14-day retention)

It does **not** run packaged Playwright smokes. Those still belong to the Windows `packaged` job. It does **not** publish a GitHub Release. Fork pull requests get no secrets, so they package unsigned and the Gatekeeper gate is skipped.

Fork pull requests do not receive repository secrets, so those runs stay unsigned.

### GitHub Actions secrets (signing)

Set these on the `codepawl/orglet` repo (**Settings → Secrets and variables → Actions**). Do not commit the P12, password, or private key.

| Secret | Required for | Value |
|---|---|---|
| `APPLE_CERTIFICATE_P12_BASE64` | Signing | Base64 of the Developer ID Application `.p12` (`base64 -i developerid.p12` on macOS, `base64 -w0 developerid.p12` on Linux) |
| `APPLE_CERTIFICATE_PASSWORD` | Signing | P12 password |
| `APPLE_IDENTITY` | Optional | Override; default is `Developer ID Application: Xuan An Nguyen (D884WZQ6N4)` |
| `APPLE_TEAM_ID` | Notarize (Apple ID path) | `D884WZQ6N4` |

The Cursor GitHub App token used by cloud agents cannot write Actions secrets (`secrets` permission missing). A repo admin must paste them in the GitHub UI or run `gh secret set` with a personal token that can.

```
base64 -i developerid.p12 | gh secret set APPLE_CERTIFICATE_P12_BASE64 --repo codepawl/orglet
gh secret set APPLE_CERTIFICATE_PASSWORD --repo codepawl/orglet < p12-password.txt
gh secret set APPLE_IDENTITY --repo codepawl/orglet -b 'Developer ID Application: Xuan An Nguyen (D884WZQ6N4)'
gh secret set APPLE_TEAM_ID --repo codepawl/orglet -b 'D884WZQ6N4'
```

### Notarization secrets

Notarytool needs **one** of these complete sets. CI uses Option A.

**Option A — App Store Connect API key (in use)**

| Secret | What it is |
|---|---|
| `APPLE_API_KEY_P8` | Full contents of `AuthKey_<KeyID>.p8` from [App Store Connect → Integrations → Team Keys](https://appstoreconnect.apple.com/access/integrations/api) |
| `APPLE_API_KEY_ID` | The 10-character Key ID |
| `APPLE_API_ISSUER` | Issuer ID (UUID) |

**Option B — Apple ID**

| Secret | What it is |
|---|---|
| `APPLE_ID` | Apple ID email on the Developer Program team |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password from [appleid.apple.com](https://appleid.apple.com) (**not** the Apple ID password) |
| `APPLE_TEAM_ID` | `D884WZQ6N4` |

CI proves signing in its own log (`codesign --display`: Developer ID Certification Authority, Apple Root CA, `flags=0x10000(runtime)`, `Notarization Ticket=stapled`). On a Mac, confirm the downloaded ZIP the same way:

```
spctl --assess --type execute --verbose Orglet.app
stapler validate Orglet.app
```

Both should succeed, and Gatekeeper should open the app without the right-click workaround. Builds made before 2026-09-19, and fork pull requests, which receive no secrets, are unsigned and still warn.

## Human smoke (An, on a real Mac)

CI `pnpm make` on `macos-latest` is not a substitute for launching the app. This page is the procedure, not a completed tick.

1. **Get the ZIP**  
   Download `orglet-macos-signed-zip` (or `orglet-macos-unsigned-zip` if secrets were missing) from the pull request's **macOS desktop** workflow, or on the Mac run `pnpm install --frozen-lockfile` then `pnpm make` from the same commit.

2. **Unzip**  
   Unzip to a throwaway folder. Confirm `Orglet.app` is inside. There is no DMG.

3. **Signature**  
   `codesign --verify --deep --strict --verbose=2 Orglet.app` and `codesign --display --verbose=2 Orglet.app`. A CI-signed build should show `Developer ID Application: Xuan An Nguyen (D884WZQ6N4)` and `runtime` (hardened runtime). A local unsigned make may show an ad-hoc signature.

4. **Gatekeeper**  
   Until notarization credentials exist, macOS will still say Apple cannot check the app for malicious software. Right-click `Orglet.app` → **Open**. That warning is expected for a signed-but-not-notarized download. It is not a product defect. After notarization, a double-click should open without that workaround.

5. **First launch**  
   The window should open. New data lives under `~/Library/Application Support/Orglet` unless you pass `--user-data-dir`. New installs default to US English and include a **Researcher** worker on **Demo**.

6. **Demo chat**  
   Send a short Demo message. Expect a labelled sample reply and no API call.

7. **DuckDB checker (packaged)**  
   If Playwright can launch the packaged binary: `pnpm test:packaged`. That hits the shipped native addon. If Playwright is not set up, attach a small CSV in the UI and run the local dataset check; expect row counts, not a missing-addon crash.

8. **Optional packaged smokes**  
   `pnpm test:desktop` uses the unpackaged Electron binary (`pnpm dev` / Forge start), not the ZIP. After `pnpm make`, the other `pnpm test:*` scripts resolve `Orglet.app/Contents/MacOS/Orglet`. They are not required CI on macOS yet.

Record the Mac model, macOS version, commit SHA, whether the ZIP came from Actions or a local make, whether `codesign` showed Developer ID, and whether Gatekeeper warned. This document is not that record.

## What this does not claim

- No launch of the app itself: CI checks the signature, the staple and Gatekeeper assessment, not that the window opens
- No universal (`arm64` + `x64`) binary; each make is the runner's arch
- No public macOS GitHub Release; Windows 0.2.x remains the only release platform
- Linux packaging is still coming later
