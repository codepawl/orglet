# Windows release gates

Required pull-request CI is the **Windows desktop** workflow (`.github/workflows/desktop.yml`). It runs on `windows-latest`. There is no separate Linux typecheck/test workflow.

| Gate | When | Blocks merge |
|---|---|---|
| `pnpm audit --prod --audit-level=high` | Fail-fast job (`typecheck and test`) | Yes, production CVEs only |
| `pnpm typecheck` and `pnpm test` | Same fail-fast job | Yes |
| `pnpm make` and packaged smokes, including `pnpm test:harness` | After fail-fast succeeds (`packaged`) | Yes, via the required `test` aggregator |

The GitHub required check name remains `test`. That job does not run the suite again; it fails unless both Windows jobs succeeded.

`pnpm test:harness` always installs fixture CLIs so the packaged UI asserts **detected ≠ signed-in** (Claude Code logged out) and **auth-fail ≠ Demo** (unread Codex login status does not show Demo). It still lists Cursor as a catalog row (usually not installed) and checks status pills plus copy-login commands. It never starts a harness run and never calls a paid provider.

`extract-zip` currently has high advisories (`GHSA-jmr9-qjv8-65gv`, `GHSA-7pqw-9j4j-h8q3`) through `@electron/packager`. That tree is a **dev/packaging** dependency, so `--prod` does not report it and this workflow does not ignore those GHSAs. Do not allowlist a production CVE.

Not in this workflow: nightly extra Windows jobs, live API keys, or paid provider calls.
