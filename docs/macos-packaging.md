# macOS packaging

Unsigned ZIP packaging for dogfood and build-in-public. This is **not** a signed or notarized Mac app, and it is **not** the required merge check.

Windows remains first: the required GitHub check is still the **Windows desktop** `test` aggregator. See [windows-release-gates.md](windows-release-gates.md). Do not treat a green macOS job as a substitute for that aggregator.

## Maker config

`forge.config.ts` keeps the Electron Forge stack:

| Maker | Platforms | Output |
|---|---|---|
| `@electron-forge/maker-zip` | `win32`, `darwin` | ZIP under `out/make/zip/<platform>/<arch>/` |
| `@electron-forge/maker-squirrel` | Windows only (Forge skips it on a Mac) | Setup under `out/make/squirrel.windows/` |

On a Mac, `pnpm make` packages `Orglet.app` for the current architecture (`darwin-arm64` on Apple Silicon, `darwin-x64` on Intel) and zips that `.app`. Typical path:

```
out/make/zip/darwin/arm64/Orglet-darwin-arm64-0.1.0.zip
```

The zip contains `Orglet.app`. It is **not** signed with a Developer ID and **not** notarized. Electron may apply an ad-hoc signature so Apple Silicon can launch the binary. Gatekeeper will still warn.

`packagerConfig` does **not** set `osxSign` or `osxNotarize`. DuckDB's native addon is included per OS (`@duckdb/node-bindings-darwin-arm64` / `darwin-x64`) and unpacked from ASAR (`.node` / `.dylib`).

There is no DMG maker in this milestone.

## CI

`.github/workflows/macos.yml` (`macOS desktop`) runs on `macos-latest`:

1. `pnpm install --frozen-lockfile`
2. `pnpm typecheck`
3. `pnpm test`
4. `pnpm make`
5. Upload the unsigned darwin ZIP as the `orglet-macos-unsigned-zip` Actions artifact (14-day retention)

It does **not** run packaged Playwright smokes. Those still belong to the Windows `packaged` job. It does **not** publish a GitHub Release.

## Human smoke (An, on a real Mac)

CI `pnpm make` on `macos-latest` is not a substitute for launching the app. This page is the procedure, not a completed tick.

1. **Get the ZIP**  
   Either download `orglet-macos-unsigned-zip` from the pull request's **macOS desktop** workflow, or on the Mac run `pnpm install --frozen-lockfile` then `pnpm make` from the same commit.

2. **Unzip**  
   Unzip to a throwaway folder. Confirm `Orglet.app` is inside. Do not expect a DMG or a Developer ID signature.

3. **Gatekeeper (expected)**  
   Right-click `Orglet.app` → **Open**. If macOS says the app cannot be opened because it is from an unidentified developer, choose **Open**. That warning is expected for an unsigned, not-notarized build. It is not a product defect.

4. **First launch**  
   The window should open. New data lives under `~/Library/Application Support/Orglet` unless you pass `--user-data-dir`. New installs default to US English and include a **Researcher** worker on **Demo**.

5. **Demo chat**  
   Send a short Demo message. Expect a labelled sample reply and no API call.

6. **DuckDB checker (packaged)**  
   If Playwright can launch the packaged binary: `pnpm test:packaged`. That hits the shipped native addon. If Playwright is not set up, attach a small CSV in the UI and run the local dataset check; expect row counts, not a missing-addon crash.

7. **Optional packaged smokes**  
   `pnpm test:desktop` uses the unpackaged Electron binary (`pnpm dev` / Forge start), not the ZIP. After `pnpm make`, the other `pnpm test:*` scripts resolve `Orglet.app/Contents/MacOS/Orglet`. They are not required CI on macOS yet.

Record the Mac model, macOS version, commit SHA, whether the ZIP came from Actions or a local make, and whether Gatekeeper warned. This document is not that record.

## What this does not claim

- No Apple Developer ID signing
- No notarization, staple, or hardened runtime entitlements
- No universal (`arm64` + `x64`) binary; each make is the runner's arch
- No public macOS GitHub Release; Windows 0.2.x remains the only release platform
- Linux packaging is still coming later
