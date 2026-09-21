# Windows release gates (Orglet 0.2)

This page is the Windows ship checklist: required pull-request CI, how Windows builds are signed, optional human installer validation, and the GitHub Release procedure. [Orglet 0.2.2](https://github.com/codepawl/orglet/releases/tag/v0.2.2) is already public with Windows Setup and ZIP assets.

It does **not** record that a smoke already ran. It does **not** create tags or Releases.

| Gate | Who | Blocks |
|---|---|---|
| Windows desktop CI (table below) | GitHub Actions on every PR | Merge |
| Windows builds are signed | GitHub Actions on `main` and manual runs, once the Certum secrets exist | A release ships only a signed Setup |
| Packaged Windows smoke | GitHub Actions on the release commit | GitHub Release |
| Installer smoke on a clean machine | Optional human validation | Does not block public 0.2.x |
| Git tag + GitHub Release | Maintainer, after they approve | Public 0.2.x ship |

Required pull-request CI is the **Windows desktop** workflow (`.github/workflows/desktop.yml`). It runs on `windows-latest`. Separate **macOS desktop** and **Linux desktop** workflows run typecheck, tests and `pnpm make` for dogfood packaging; Linux also starts the packaged app headlessly. macOS signs when Developer ID credentials exist and notarizes only when Apple credentials exist. Neither workflow replaces the required Windows `test` aggregator. See [macos-packaging.md](macos-packaging.md) and [linux-packaging.md](linux-packaging.md).

## CI gates

| Gate | When | Blocks merge |
|---|---|---|
| `pnpm audit --prod --audit-level=high` | Fail-fast job (`typecheck and test`) | Yes, production CVEs only |
| `pnpm typecheck` and `pnpm test` | Same fail-fast job | Yes |
| `pnpm make` and packaged smokes, including `pnpm test:harness` | After fail-fast succeeds (`packaged`) | Yes, via the required `test` aggregator |

The GitHub required check name remains `test`. That job does not run the suite again; it fails unless both Windows jobs succeeded.

`pnpm test:harness` always installs fixture CLIs so the packaged UI asserts **detected ≠ signed-in** (Claude Code logged out) and **auth-fail ≠ Demo** (unread Codex login status does not show Demo). It still lists Cursor as a catalog row (usually not installed) and checks status pills plus copy-login commands. It never starts a harness run and never calls a paid provider.

`extract-zip` currently has high advisories (`GHSA-jmr9-qjv8-65gv`, `GHSA-7pqw-9j4j-h8q3`) through `@electron/packager`. That tree is a **dev/packaging** dependency, so `--prod` does not report it and this workflow does not ignore those GHSAs. Do not allowlist a production CVE.

Both advisories are unpatched: 2.0.1 is the newest release of `extract-zip` and it is the affected one, so there is nothing to upgrade to. Both need an attacker-controlled archive, and the only archive this extracts is the Electron distribution that `@electron/get` downloads from Electron's own releases and checks against `SHASUMS256.txt`. Nothing `extract-zip` touches reaches a user's machine. The Dependabot alerts stay **open** on purpose rather than being dismissed: a dismissal also stops the upgrade pull request, and an open alert is how the fix will reach us if one ships. Re-check when Electron Forge next moves its dependencies.

Not in this workflow: nightly extra Windows jobs, live API keys, paid provider calls, or running Squirrel Setup. The packaged job uploads Squirrel Setup and the win32 ZIP as Actions artifacts (`orglet-windows-signed-setup` and `orglet-windows-signed-zip` when it signed, `orglet-windows-unsigned-*` otherwise; 14-day retention).

## Signing

Decision 2026-09-21 (COD-148): Windows builds are signed with a Certum Open Source Code Signing in the Cloud certificate, issued to the maintainer as an individual. Azure Artifact Signing is not an option: its publicly trusted certificates are not offered in Vietnam. Smart App Control blocks an unsigned build outright, so a public Setup must be signed.

- **Where the key lives.** In Certum's cloud HSM. On the runner, SimplySign Desktop logs in and exposes the certificate in `CurrentUserMy`; signtool signs through it. The login step is `dismine/windows-app-signing-setup-action`, pinned to a commit whose source was read in full; SimplySign Desktop is pinned to 9.4.3.90 because the login drives its window with the keyboard.
- **When it signs.** Only on a push to `main` and on a manual run (**Actions → Windows desktop → Run workflow**). Pull requests never log in: three wrong one-time codes lock the Certum account, and several pull requests would log in at once.
- **What gets signed.** `forge.windows.ts`: every exe, DLL and native addon in the app that is not signed yet, then Squirrel's Setup and Update. Files that already carry a valid signature (Microsoft's `wxc-exec.exe`, DuckDB's `duckdb.dll`) keep it. SHA-256 only, timestamped by `http://time.certum.pl`, so a signature outlives the certificate.
- **What CI checks.** Packaging itself fails if any exe, DLL or native addon comes out unsigned (`@electron/windows-sign` only logs a failed signature, so the check looks at the result). After `pnpm make`, `Orglet.exe`, `WorkspaceIntegrate.exe` and Setup must be Valid, signed by `CERTUM_KEY_ID` and timestamped, and `wxc-exec.exe` must still be Microsoft's.
- **Secrets.** `CERTUM_USERNAME` (SimplySign login), `CERTUM_OTP_URI` (the full `otpauth://` link from the SimplySign setup QR code; it replaces the phone app, so guard it like the key), `CERTUM_KEY_ID` (the certificate's SHA-1 thumbprint). Without them CI builds unsigned, as before.
- **Renewal.** A certificate lasts at most 459 days. A new certificate has a new thumbprint, so replace `CERTUM_KEY_ID`. A different name on the certificate starts SmartScreen reputation from zero.

A new certificate has no SmartScreen reputation, so **Windows protected your PC** can still appear for a while, now naming the publisher. Put this in the GitHub Release notes, in plain language:

> Setup is signed. Windows may still show a SmartScreen warning while the certificate builds up its reputation; check that it names Nguyen Xuan An as the publisher, then choose More info → Run anyway.

## Installer smoke (optional human validation)

CI builds the installer (`pnpm make`) and runs packaged Playwright smokes against that build with an isolated `--user-data-dir`. It does **not** run Squirrel Setup, does not install like a user, and does not uninstall. After `pnpm make`, it uploads Setup and ZIP as Actions artifacts.

The maintainer decision in [COD-12](https://linear.app/codepawl/issue/COD-12/release-gate-windows-installer-smoke-checklist-ship) makes green Windows packaged CI sufficient for a public 0.2.x tag. The steps below are useful additional validation on a clean Windows machine or VM; they do not block the tag. Packaged CI smokes are not a Setup installation or uninstall test.

This page is the procedure, not a completed tick. Do not treat the existence of this list as evidence that someone already installed Setup.

### What CI already covers

| Check | Where |
|---|---|
| `pnpm audit --prod --audit-level=high`, `pnpm typecheck`, `pnpm test` | Fail-fast job (`typecheck and test`) |
| `pnpm make` (ZIP + Squirrel Setup under `out/make`) | `packaged` job |
| Packaged UI smokes, including Settings → Local harnesses with fixture CLIs (`pnpm test:harness`) | `packaged` job |

`pnpm test:harness` never starts a harness run and never calls a paid provider. It is not an installer test.

### Optional clean-machine checklist

Use Windows 10 or 11 on a machine or VM that does not already have Orglet installed. Prefer a throwaway VM so leftover `%APPDATA%\orglet` data and Start Menu shortcuts are easy to discard.

Copy this list into the release issue or tag notes and tick a step only after you have done it.

1. **Get Setup**  
   Download `orglet-windows-signed-setup` (and optionally `orglet-windows-signed-zip`) from the Windows `packaged` job on the `main` commit you intend to tag. Or on a Windows build machine: `pnpm install --frozen-lockfile`, then `pnpm make`, and copy `*Setup.exe` from `out/make/squirrel.windows/` (Squirrel; typically `Orglet-<version> Setup.exe`). Optionally keep the ZIP from `out/make/zip/win32/`.

2. **SmartScreen (expected)**  
   Run Setup. If SmartScreen appears, choose **More info** → **Run anyway**. Note whether the warning appeared. A new certificate has no SmartScreen reputation yet, so a warning that names the publisher is not a product defect. A warning that says **Unknown publisher** means Setup is unsigned: stop.

3. **Install**  
   Finish the Squirrel installer with no error dialog. This is a per-user install (typically under `%LOCALAPPDATA%\orglet`), not Program Files.

4. **First launch**  
   Open Orglet from the Start Menu. The window should open. New installs default to US English and include a **Researcher** worker on **Demo**.

5. **Settings → Local harnesses**  
   Open **Settings** → **Local harnesses**. The tab must open and list Claude Code, Codex and Cursor Agent. On a clean machine they are usually **Not installed**. That is enough here. Also open **Settings** → **Connections** and confirm OpenAI / Anthropic / Grok (xAI) / OpenRouter / OpenCode Zen / OpenCode Go show with no keys and Ollama is off. Fixture detected / signed-out / auth-error states are CI's job (`pnpm test:harness`).

6. **Create a Demo worker**  
   In the sidebar, create a worker (**+** next to Workers), keep **Model** on **Demo**, save. Using the seeded Researcher also counts as Demo; still create one extra worker so the create path is exercised.

7. **Send a Demo task**  
   Start a task, assign that Demo worker, send a short message. Expect a labelled Demo sample reply and no API call. Do not import API keys or start Claude Code / Codex for this gate.

8. **Uninstall**  
   Quit Orglet. Uninstall from **Settings → Apps → Installed apps** (Orglet / orglet). Confirm it is gone from the Start Menu and that the old shortcut no longer launches. `%APPDATA%\orglet` may remain; that is leftover workspace data, not a failed uninstall. Remove it by hand if the VM will be reused.

When a human has actually done these steps, record the VM/machine, OS, commit SHA and date on the Linear issue or in the Release draft. This document is not that record.

## Validation not covered by release CI

- Key file path for live OpenAI / xAI acceptance (`pnpm test:live`)
- Clean Windows VM or spare machine for the optional installer smoke above
- A signed Setup running on a machine with Smart App Control enforced (CI checks the signature, not what Windows does with it)

## GitHub Release tag

The repository already has public Windows releases, including [v0.2.2](https://github.com/codepawl/orglet/releases/tag/v0.2.2). New tags and Releases remain maintainer actions. Do not push a git tag or open a GitHub Release from a docs or CI pull request.

When a maintainer is ready to ship public 0.2.x:

1. Confirm required Windows CI is green on the commit you will tag (the `test` aggregator).
2. Confirm the Windows packaged CI job and required `test` aggregator passed on that commit. If a human ran the optional Setup checklist, record its machine, commit and result; never present CI as a clean-machine install.
3. Set `package.json` `version` to the 0.2.x you are shipping if it is not already, and land that on `main`.
4. Create an annotated tag on that commit for the new version, then push it. Only a maintainer does this; do not reuse an existing release tag.
5. On GitHub: **Releases → Draft a new release**, choose that tag, and attach `Setup.exe` and the ZIP from that commit's `orglet-windows-signed-setup` / `orglet-windows-signed-zip` artifacts. A local `pnpm make` is unsigned and is not a release asset.
6. Put the SmartScreen paragraph in the release notes (see [Signing](#signing)). Link this page. State AGPL-3.0 and that the public GitHub Release ships Windows only. macOS and Linux ZIP packaging exist for dogfood and are not Release assets; macOS signing and notarization depend on available credentials.

Do not attach builds from a different commit. Do not upload signing certificates or private keys.
