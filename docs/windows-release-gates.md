# Windows release gates (Orglet 0.2)

This page is the Windows ship checklist: required pull-request CI, the locked unsigned-installer decision for public 0.2.x, the human installer smoke, and the GitHub Release procedure.

It does **not** record that a smoke already ran. It does **not** create tags or Releases.

| Gate | Who | Blocks |
|---|---|---|
| Windows desktop CI (table below) | GitHub Actions on every PR | Merge |
| Public Setup stays unsigned | Locked product decision for 0.2.x | Do not add a signing pipeline |
| Installer smoke on a clean machine | A human, once before a tag | GitHub Release |
| Git tag + GitHub Release | Maintainer, after they approve | Public 0.2.x ship |

Required pull-request CI is the **Windows desktop** workflow (`.github/workflows/desktop.yml`). It runs on `windows-latest`. A separate **macOS desktop** workflow runs typecheck, tests and `pnpm make` on `macos-latest` for dogfood packaging; it is **not** the required merge check and must not replace the Windows `test` aggregator. See [macos-packaging.md](macos-packaging.md). There is no Linux packaging workflow.

## CI gates

| Gate | When | Blocks merge |
|---|---|---|
| `pnpm audit --prod --audit-level=high` | Fail-fast job (`typecheck and test`) | Yes, production CVEs only |
| `pnpm typecheck` and `pnpm test` | Same fail-fast job | Yes |
| `pnpm make` and packaged smokes, including `pnpm test:harness` | After fail-fast succeeds (`packaged`) | Yes, via the required `test` aggregator |

The GitHub required check name remains `test`. That job does not run the suite again; it fails unless both Windows jobs succeeded.

`pnpm test:harness` always installs fixture CLIs so the packaged UI asserts **detected ≠ signed-in** (Claude Code logged out) and **auth-fail ≠ Demo** (unread Codex login status does not show Demo). It still lists Cursor as a catalog row (usually not installed) and checks status pills plus copy-login commands. It never starts a harness run and never calls a paid provider.

`extract-zip` currently has high advisories (`GHSA-jmr9-qjv8-65gv`, `GHSA-7pqw-9j4j-h8q3`) through `@electron/packager`. That tree is a **dev/packaging** dependency, so `--prod` does not report it and this workflow does not ignore those GHSAs. Do not allowlist a production CVE.

Not in this workflow: nightly extra Windows jobs, live API keys, paid provider calls, or running Squirrel Setup. The packaged job uploads unsigned Squirrel Setup and the win32 ZIP as Actions artifacts (`orglet-windows-unsigned-setup` and `orglet-windows-unsigned-zip`, 14-day retention).

## Signing decision (locked)

Public Windows installers for **0.2.x** are **unsigned**. There is no Authenticode certificate yet. Do not add a signing job, store a certificate, or invent GitHub Actions secrets for this milestone.

Microsoft Defender SmartScreen will typically show **Windows protected your PC** (unknown publisher) when someone runs Setup. That warning is expected.

Put this in the GitHub Release notes, in plain language:

> The Windows installer is unsigned. SmartScreen may warn that Windows protected your PC. That is expected for 0.2.x. If you downloaded Setup from this GitHub Release, choose More info → Run anyway.

Signed builds are a later milestone, only after a code-signing certificate exists. Until then, keep shipping unsigned Setup and ZIP.

## Installer smoke (human gate)

CI builds the installer (`pnpm make`) and runs packaged Playwright smokes against that build with an isolated `--user-data-dir`. It does **not** run Squirrel Setup, does not install like a user, and does not uninstall. After `pnpm make`, it uploads unsigned Setup and ZIP as Actions artifacts.

Run the steps below **once on a clean Windows machine or VM** before tagging a GitHub Release. Packaged CI smokes are not this checklist. A maintainer may later write that they accept CI as enough for a given tag; until they do, a human still has to run Setup.

This page is the procedure, not a completed tick. Do not treat the existence of this list as evidence that someone already installed Setup.

### What CI already covers

| Check | Where |
|---|---|
| `pnpm audit --prod --audit-level=high`, `pnpm typecheck`, `pnpm test` | Fail-fast job (`typecheck and test`) |
| `pnpm make` (ZIP + Squirrel Setup under `out/make`) | `packaged` job |
| Packaged UI smokes, including Settings → Local harnesses with fixture CLIs (`pnpm test:harness`) | `packaged` job |

`pnpm test:harness` never starts a harness run and never calls a paid provider. It is not an installer test.

### What a human must still do

Use Windows 10 or 11 on a machine or VM that does not already have Orglet installed. Prefer a throwaway VM so leftover `%APPDATA%\orglet` data and Start Menu shortcuts are easy to discard.

Copy this list into the release issue or tag notes and tick a step only after you have done it.

1. **Get Setup**  
   Download `orglet-windows-unsigned-setup` (and optionally `orglet-windows-unsigned-zip`) from the Windows `packaged` job on the commit you intend to tag. Or on a Windows build machine: `pnpm install --frozen-lockfile`, then `pnpm make`, and copy `*Setup.exe` from `out/make/squirrel.windows/` (Squirrel; typically `Orglet-<version> Setup.exe`). Optionally keep the ZIP from `out/make/zip/win32/`.

2. **SmartScreen (expected)**  
   Run Setup. If SmartScreen appears, choose **More info** → **Run anyway**. Note whether the warning appeared. For unsigned 0.2.x, a SmartScreen warning is not a product defect.

3. **Install**  
   Finish the Squirrel installer with no error dialog. This is a per-user install (typically under `%LOCALAPPDATA%\orglet`), not Program Files.

4. **First launch**  
   Open Orglet from the Start Menu. The window should open. New installs default to US English and include a **Researcher** worker on **Demo**.

5. **Settings → Local harnesses**  
   Open **Settings** → **Local harnesses**. The tab must open and list Claude Code, Codex and Cursor Agent. On a clean machine they are usually **Not installed**. That is enough here. Also open **Settings** → **Connections** and confirm OpenAI / Anthropic / Grok (xAI) show with no keys. Fixture detected / signed-out / auth-error states are CI's job (`pnpm test:harness`).

6. **Create a Demo worker**  
   In the sidebar, create a worker (**+** next to Workers), keep **Model** on **Demo**, save. Using the seeded Researcher also counts as Demo; still create one extra worker so the create path is exercised.

7. **Send a Demo task**  
   Start a task, assign that Demo worker, send a short message. Expect a labelled Demo sample reply and no API call. Do not import API keys or start Claude Code / Codex for this gate.

8. **Uninstall**  
   Quit Orglet. Uninstall from **Settings → Apps → Installed apps** (Orglet / orglet). Confirm it is gone from the Start Menu and that the old shortcut no longer launches. `%APPDATA%\orglet` may remain; that is leftover workspace data, not a failed uninstall. Remove it by hand if the VM will be reused.

When a human has actually done these steps, record the VM/machine, OS, commit SHA and date on the Linear issue or in the Release draft. This document is not that record.

## Blocked without user input

- Key file path for live OpenAI / xAI acceptance (`pnpm test:live`)
- Clean Windows VM or spare machine for the installer smoke above
- Code-signing certificate (optional for 0.2.x; locked unsigned for public ship — required before claiming a signed release)

## GitHub Release tag

There is **no** GitHub Release on this repository yet. Creating one is a maintainer step after they approve. Do not push a git tag or open a GitHub Release from a docs or CI pull request.

When a maintainer is ready to ship public 0.2.x:

1. Confirm required Windows CI is green on the commit you will tag (the `test` aggregator).
2. Confirm the human installer smoke above has been run on that same commit, **or** the maintainer has written that they accept CI packaged smokes as enough for this tag.
3. Set `package.json` `version` to the 0.2.x you are shipping if it is not already, and land that on `main`.
4. Create an annotated tag on that commit, for example `git tag -a v0.2.0 -m "Orglet 0.2.0"` then `git push origin v0.2.0`. Only a maintainer does this.
5. On GitHub: **Releases → Draft a new release**, choose that tag, and attach the unsigned `Setup.exe` and the ZIP from that commit's `orglet-windows-unsigned-setup` / `orglet-windows-unsigned-zip` artifacts (or a local `pnpm make`).
6. Put the SmartScreen / unsigned paragraph in the release notes (see [Signing decision](#signing-decision-locked)). Link this page. State AGPL-3.0 and that the public GitHub Release ships Windows only. macOS ZIP packaging exists for dogfood (see [macos-packaging.md](macos-packaging.md)) and is not a Release asset.

Do not attach builds from a different commit. Do not upload signing certificates or private keys.
