# Windows release gates (Orglet 0.2)

Checklist for a clean-machine install of the unsigned Windows build. Record pass/fail evidence in [release-review.md](release-review.md). Do not claim a signed release until a certificate is actually used.

## Artifacts

From a clean checkout on the release branch:

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm make
```

Expected under `out/make`:

- Squirrel `Setup.exe` (and related nupkg / RELEASES)
- ZIP of the portable `Orglet-win32-x64` tree

Builds are **unsigned** unless `ORGLET_WINDOWS_CERT_FILE` / related env vars are set (see below).

## Clean-machine install / uninstall

Use a spare Windows PC or a fresh VM (not the development session if it is MSIX-virtualized).

1. Copy `Setup.exe` onto the machine.
2. Run the installer; accept defaults.
3. Launch Orglet from the Start menu.
4. Confirm: window opens, Demo worker is present, Settings → Connections shows OpenAI / Anthropic / Grok with no keys.
5. Create a Demo task, send it, accept the sample report.
6. Quit Orglet.
7. Uninstall via Apps & features (or the Squirrel uninstall entry).
8. Confirm Start menu shortcut and install directory are gone.

Record machine OS build, Setup.exe hash, and pass/fail in the release-review gate table.

## Code signing (optional until a cert exists)

Electron Forge / Squirrel on Windows can sign when a certificate is available. Orglet does **not** embed a cert in the repository.

Suggested env vars when a cert is ready (wire into `forge.config.ts` only after the files exist on the build machine):

| Variable | Purpose |
|---|---|
| `ORGLET_WINDOWS_CERT_FILE` | Path to `.pfx` / certificate file |
| `ORGLET_WINDOWS_CERT_PASSWORD` | Certificate password (CI secret) |
| `ORGLET_WINDOWS_TIMESTAMP_URL` | Authenticode timestamp server |

Until those are set and Forge signing is configured, README and release-review must keep saying builds are unsigned.

## Blocked without user input

- Key file path for live OpenAI / xAI acceptance (`pnpm test:live`)
- Clean Windows VM or spare machine for the install checklist above
- Code-signing certificate (optional for 0.2; required before claiming a signed release)
