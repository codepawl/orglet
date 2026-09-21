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

Encrypted API keys live in `openai.credential`, `anthropic.credential`, `xai.credential`, `openrouter.credential` and `ollama.credential` next to the database. They are not touched by migrations or by this procedure; leave them in place.

## Validation

`tests/integration/knowledge.test.ts` migrates a v5 workspace to v6 and opens the pre-upgrade copy directly to confirm it still reports schema 5 with the original rows and without the v6 tables. `tests/integration/checkpoints.test.ts` covers the v1 path and refusal of a newer schema.

The rollback steps above have also been tried by hand with the published v0.2.2 build. It refused to open a workspace written by a newer build and left that file unchanged. Following the steps, it then opened the `.bak` copy with the original workers, chats and reports.

Not tried yet: rolling back between two newer builds, rolling back with real API keys in place, and rolling back a workspace installed with Setup.
