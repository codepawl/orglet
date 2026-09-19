# Linux packaging

ZIP packaging of the `Orglet` directory for dogfood, built by GitHub Actions on `ubuntu-latest`. Like the macOS job, this is **not** the required merge check: that remains the **Windows desktop** `test` aggregator. See [windows-release-gates.md](windows-release-gates.md).

Nobody is running Orglet on Linux daily yet. The point of this job is that a Linux contributor gets an artifact and a signal instead of a build they have to trust.

## What is built

`@electron-forge/maker-zip` covers `linux` alongside `win32` and `darwin`. `pnpm make` on Linux produces:

```
out/make/zip/linux/x64/Orglet-linux-x64-0.2.2.zip
```

The zip holds the whole `Orglet` directory, with the `Orglet` binary at its root. Unzip it anywhere and run that binary. DuckDB's native addon is included for both libc flavours (`@duckdb/node-bindings-linux-x64` and `-musl`, plus the arm64 pair), because a glibc and a musl distribution need different addons and pnpm only installs the one the build machine uses.

There is no deb, RPM, AppImage, Flatpak or Snap, and no signing. Add one when someone actually needs it, not before.

## CI

`.github/workflows/linux.yml` runs typecheck, the test suite and `pnpm make`, uploads the zip as `orglet-linux-zip` (14 days), then starts the app under a virtual display and runs `pnpm test:desktop` against it.

Two things are true of the runner rather than of Orglet, so they are fixed in the workflow and not in the app:

- **No screen.** The job installs `xvfb` and runs the smoke through `xvfb-run`.
- **No unprivileged user namespaces.** Ubuntu 24.04 restricts them through AppArmor, and Electron's sandbox needs them, so the job sets `kernel.apparmor_restrict_unprivileged_userns=0`. Never weaken the sandbox in the app to work around a CI host.
- **No keyring.** API keys go through Electron's `safeStorage`, which encrypts through libsecret and needs a running, unlocked keyring; without one the smoke never sees the key saved. The job starts a throwaway `gnome-keyring` under `dbus-run-session` and names `XDG_CURRENT_DESKTOP` so Electron picks libsecret.

## Running it on a desktop Linux

The app has had no manual testing on a Linux desktop. Expect the usual Electron gaps: tray, autostart, file dialogs and the system theme are unverified. Report what breaks rather than assuming it is meant to work.
