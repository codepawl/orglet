# AGENTS.md

Instructions for coding agents (Cursor, Copilot, Claude Code, Codex, and the same tools used by public contributors). Humans follow [CONTRIBUTING.md](CONTRIBUTING.md); this file is the map so an agent does not have to rediscover the repo.

**AI-assisted code is welcome. Sloppy, unstructured, or convention-breaking AI code is not.** "The model wrote it" is neither a reason to merge nor a reason to reject. Judge the diff.

Do not confuse this file with an `AGENTS.md` a worker might write inside a task folder. Never overwrite this repo file, home-directory agent config, or generated harness copies.

## Understand the repo

Read, in this order, only what the task needs:

1. [README.md](README.md) — what Orglet is.
2. [docs/product.md](docs/product.md) — who it is for, how it should feel, **Not now**. New features must fit; do not build the not-now list.
3. [CONTRIBUTING.md](CONTRIBUTING.md) — issues, PRs, CLA, CI.
4. [docs/technical-guide.md](docs/technical-guide.md) — run, providers, harnesses, limits, checks.
5. Neighboring code and tests for the files you will touch.

[docs/implementation_status.md](docs/implementation_status.md) is the ship/verify record. [docs/handoff.md](docs/handoff.md) and `.agents/plans/` are **historical session notes**, not current contracts — prefer `docs/product.md` and the code.

Orglet is a **local Electron desktop app**: a small team of AI workers on the user's computer. No Orglet account or server. Chats, workers and files live in SQLite. Windows is the public 0.2.x target; macOS packaging exists; Linux is later.

```
apps/desktop/src/
  main/           Electron main (windows, IPC, credentials)
  preload/        contextBridge allowlist only
  renderer/       React UI — no fs, no DB, no secrets
  core/           business logic in a utility process
    adapters/     OpenAI / Anthropic / xAI
    harness/      Claude Code / Codex / Cursor Agent CLIs
    orchestration/  runs, teams, routines, checkpoints
    storage/      SQLite, backup, templates
    context/      knowledge + thread compilation
  shared/         Zod contracts, i18n, types used across processes
  profiler/       DuckDB checker (separate process)
tests/integration/   vitest
scripts/             packaged / desktop smokes
docs/                product + how-it-works (update with the feature)
```

Renderer talks to core through `preload` → typed `Bridge` / `commands` in `apps/desktop/src/shared/contracts.ts`. Adapters must not import UI. Do not put business state in React or `localStorage` (UI chrome such as read-stamps is the exception).

## Commands

Node **24.19+**, pnpm **11.19.0**, Windows or macOS.

```
pnpm install --frozen-lockfile
pnpm dev              # Electron app; Researcher starts on Demo
pnpm typecheck
pnpm test             # required locally before a PR
pnpm i18n:keys        # missing/unused English keys (Vietnamese source strings)
```

`pnpm dev:web` is renderer-only and has no desktop data bridge — do not use it to prove core or IPC changes.

Do **not** search the machine for API keys. Do not run `pnpm test:live` unless the user set `ORGLET_LIVE_KEY_FILE`. Packaged smokes (`pnpm make`, `pnpm test:desktop`, `pnpm test:packaged`, …) are CI's job after typecheck/test; run them when you change packaging, preload, or smoke scripts.

There is no ESLint/Prettier. Match the file you are in.

## Work in a structured way

1. **Issue first** when the change is larger than a small fix (GitHub issue for public contributors; Linear `COD-xx` for maintainers).
2. **One pull request, one change.** Do not bundle refactors, drive-by formatting, or unrelated files.
3. **Stay in scope.** Do not take over someone else's in-flight PR or rewrite a subsystem to make your patch nicer.
4. **Match nearby code** — naming, density, CSS variables, component patterns. Do not invent a new abstraction layer, state library, or UI kit.
5. **Docs in the same PR** for feature and UX changes: README plus the relevant `docs/` page (how it works, not only that it shipped). Do not land code-only.
6. **Tests for behavior.** Prefer `tests/integration/*.test.ts`. If you change UI copy, keep Vietnamese source strings and English in `apps/desktop/src/shared/locales/en.ts`.
7. Say in the PR what you ran. Required GitHub check is Windows `desktop.yml` (check name `test`). macOS `macos.yml` also runs; it is not the merge gate.

## Pull requests

Process detail is [CONTRIBUTING.md](CONTRIBUTING.md). Fill [.github/pull_request_template.md](.github/pull_request_template.md).

- Branch from `main`.
- Title: maintainers prefix `COD-xx:`; public contributors write a specific, human title.
- First PR from a person must include: `I have read the CLA and agree to it for all my contributions to Orglet.`
- Do not push release tags. Releases are a maintainer checklist in [docs/windows-release-gates.md](docs/windows-release-gates.md).

## Coding conventions

**UI text.** Source strings are Vietnamese (`t('...')`). English lives in `apps/desktop/src/shared/locales/en.ts` (US default; UK in the same module). Add both in the same change. Core/main errors are Vietnamese too so `tMessage` can translate them.

**UI feel.** Quiet ChatGPT-like shell: sidebar, one main column, composer at the bottom, details on demand. Use tokens in `apps/desktop/src/renderer/styles.css`. No neon, gradients-as-brand, org charts, or extra marketing chrome. Tight spacing already landed; do not inflate it.

**Trust boundaries.** `contextIsolation` on, `nodeIntegration` off, renderer sandboxed. Keys use Electron `safeStorage` in main; the renderer never reads a saved key back. Backups, templates and logs must not grow secrets. Workers read only files attached to that task. Do not execute imported skill scripts. Do not add `--force` / `--yolo` to the Cursor harness. Do not silently fall back to Demo when a harness is logged out.

**Data.** Zod at the IPC and storage edge. Integer money (micros), atomic budget reservation. Skill/instruction edits create a new revision; in-flight runs keep the snapshot they started with. Missing evidence, unknown usage and partial failure stay visible — do not paint them as success.

**Teams.** Clicking a team opens **that team's chat** (one live `tasks` row keyed by `teamId`). A user message is a turn, not a new task row. See [docs/team-chat.md](docs/team-chat.md).

## Do not

- Expand into product.md **Not now** (cloud accounts, org-chart company sim, skill marketplace, scraping model lists).
- Commit `.env`, keys, certificates, or SQLite databases.
- Claim you tested a live provider, installer, or notarized build unless you actually did.
- "Clean up" unrelated files, regenerate lockfiles without a dependency change, or rephrase docs that are already clear.
