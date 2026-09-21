# Workspace recovery and rollback

Orglet keeps its workspace in `orglet.sqlite` inside the app data folder (`%APPDATA%\orglet` on Windows, `~/Library/Application Support/Orglet` on macOS, or the folder passed with `--user-data-dir`). The database refuses to open when it was written by a newer schema than the running build.

## What happens on upgrade

When a build with a newer schema opens an older workspace, the core first writes a consistent copy with `VACUUM INTO`:

```
orglet.sqlite.v<old schema>-<unix ms>.bak
```

The copy is taken before any migration statement runs, and the migrations themselves run in one transaction. A failed migration leaves the original file unchanged. Copies are never deleted automatically; remove old ones by hand once the new build has been in use for a while.

Schema history: v1 base tables, v2 checkpoints/leases/step attempts, v3 preflights, v4 routines, v5 multiple preflight scopes per task, v6 knowledge, knowledge revisions and knowledge search, v7–v11 workspace tools and process evidence, v12 budget reconciliation review, and v13 metadata for cited workspace-file reads.

## Rolling back to an older build

1. Quit Orglet completely and check that no Orglet process is left (`Orglet.exe` on Windows).
2. In the app data folder, move `orglet.sqlite`, `orglet.sqlite-wal` and `orglet.sqlite-shm` to a separate folder. Keep them: they hold everything done since the upgrade.
3. Copy the `.bak` file whose name matches the older build's schema and rename the copy to `orglet.sqlite`.
4. Start the older build.

Work done after the upgrade is not in the copy. To carry it back, export a backup JSON from the newer build first. Older builds reject fields they do not know, so this only helps when the older build understands every record in the backup. Otherwise keep using the newer build.

Encrypted API keys live in `openai.credential`, `anthropic.credential`, `xai.credential`, `openrouter.credential`, `opencode-zen.credential`, `opencode-go.credential` and `ollama.credential` next to the database. They are not touched by migrations or by this procedure; leave them in place.

## Validation

`tests/integration/knowledge.test.ts` migrates a v5 workspace to v6 and opens the pre-upgrade copy directly to confirm it still reports schema 5 with the original rows and without the v6 tables. `tests/integration/checkpoints.test.ts` covers the v1 path and refusal of a newer schema.

On 2026-09-21, a controlled Windows trial opened the [v0.2.2 release ZIP](https://github.com/codepawl/orglet/releases/tag/v0.2.2) (commit `bc67ccfb03e65556590644a16d1ee9449a10ca27`, ZIP SHA-256 `8D8CC17B40673AE01E33B6E1D6952BCDAFB11D6464066DFBAC5410F0D35CE604`) with `--user-data-dir` pointing to a disposable folder. The packaged build created one Demo chat and one report. A temporary local Vitest check opened that database with source commit `b7f425d34105671b068d5ead1c1851fe88c1dfe6` (schema 12), confirmed the worker, chat and report persisted, and found a v6 `.bak`. The commands were:

```powershell
node .worktrees\cod94-validation\rollback-smoke.mjs old
node_modules\.bin\vitest.cmd run tests\integration\cod94-local.test.ts
node .worktrees\cod94-validation\rollback-smoke.mjs refuse
node .worktrees\cod94-validation\rollback-smoke.mjs rollback
```

Those harness files were local test fixtures, not repository tests. The `refuse` phase copied the v12 database to a second disposable folder. The v0.2.2 app did not open a workspace window, and the database SHA-256 stayed unchanged. The `rollback` phase moved the v12 database and its WAL/SHM files aside, copied the v6 `.bak` to `orglet.sqlite`, and opened it with v0.2.2. It retained the original Demo worker, chat and report. The preserved v12 file still reports schema 12. No credential files were used or copied in this trial, so preservation of real encrypted credentials was not exercised. The Setup installer and clean-machine installation were not tested.

This does not yet satisfy a two-packaged-build rollback test: all published v0.2.0–v0.2.2 builds use schema 6. The Windows CI ZIP for commit `a16d370e142cceb7bd1d781edbe6586df2db044a` (schema 12; [run 35532453950](https://github.com/codepawl/orglet/actions/runs/35532453950); ZIP SHA-256 `0C9A7B9D7B5E687853CD6E724CC1F47EA6E45F9AFACDE04FCBDDDC25834CFBAB`) was blocked at launch by this machine's Device Guard policy. Repeat the full trial with two permitted packaged builds of different schema versions before closing COD-94.
