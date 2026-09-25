# AGENTS.md

Instructions for coding agents (Cursor, Copilot, Claude Code, Codex, and the same tools used by public contributors). Humans follow [CONTRIBUTING.md](CONTRIBUTING.md); this file is the map so an agent does not have to rediscover the repo. `CLAUDE.md`, `.github/copilot-instructions.md` and `.cursor/rules/orglet.mdc` only point here.

**AI-assisted code is welcome. Sloppy, unstructured, or convention-breaking AI code is not.** "The model wrote it" is neither a reason to merge nor a reason to reject. Judge the diff.

Do not confuse this file with an `AGENTS.md` a worker might write inside a task folder. Never overwrite this repo file, home-directory agent config, or generated harness copies.

## Understand the repo

Read, in this order, only what the task needs:

1. [README.md](README.md) — what Orglet is.
2. [docs/product.md](docs/product.md) — who it is for, how it should feel, **Not now**. New features must fit; do not build the not-now list.
3. [CONTRIBUTING.md](CONTRIBUTING.md) — setup, checks, PRs, CLA, CI, releases.
4. [docs/technical-guide.md](docs/technical-guide.md) — run, providers, harnesses, limits, checks.
5. The how-it-works page for the feature you touch (table below), then neighboring code and tests.

[docs/implementation_status.md](docs/implementation_status.md) is the ship/verify record. [docs/handoff.md](docs/handoff.md) and `.agents/plans/` are **historical session notes**, not current contracts — prefer `docs/product.md` and the code.

Orglet is a **local Electron desktop app**: a small team of AI workers (**orglets**, grouped into **crews**) on the user's computer. No Orglet account or server. Chats, orglets and files live in SQLite. Windows is the public 0.2.x target and updates itself from GitHub Releases; macOS packaging exists; Linux is later.

```
apps/desktop/src/
  main/           Electron main (windows, IPC, credentials, updater)
  preload/        contextBridge allowlist only
  renderer/       React UI — no fs, no DB, no secrets
  core/           business logic in a utility process
    adapters/     OpenAI / Anthropic / xAI / OpenRouter / OpenCode / Ollama
    harness/      Claude Code / Codex / Cursor Agent CLIs
    orchestration/  runs, crews, routines, checkpoints, app proposals, self-improvement
    tools/        the tool catalog, workspace files, commands, web, diff
    storage/      SQLite, backup, erase, templates
    context/      knowledge, memory, thread compilation
  shared/         Zod contracts, i18n, types used across processes
  profiler/       DuckDB checker (separate process)
packages/orglet-ui/  the app's own UI components; use them before raw controls
tests/integration/   vitest
scripts/             packaged / desktop smokes, doc images
docs/                user guide + how-it-works (update with the feature)
```

Renderer talks to core through `preload` → typed `Bridge` / `commands` in `apps/desktop/src/shared/contracts.ts`. Adapters must not import UI. Do not put business state in React or `localStorage` (UI chrome such as read-stamps and the notification list is the exception).

### Where each feature is described

| Feature | Page | Code entry |
|---|---|---|
| Orglet and crew chat, group chats, `@` tags, replies, reactions | [docs/team-chat.md](docs/team-chat.md) | `core/orchestration/team.ts`, `shared/live-task.ts`, `shared/message-interactions.ts` |
| Permissions, working folder, commands, web tools, app-change proposals | [docs/agent-tools.md](docs/agent-tools.md) | `core/tools/catalog.ts`, `core/orchestration/app-proposals.ts` |
| Memory | [docs/memory.md](docs/memory.md) | `core/context/knowledge.ts` |
| Self-improvement proposals | [docs/self-improvement.md](docs/self-improvement.md) | `core/orchestration/self-improvement.ts` |
| The trace in the chat and the diff | [docs/worker-actions.md](docs/worker-actions.md) | `renderer/components/LiveRun.tsx`, `core/tools/workspace-diff.ts` |
| Schedules | [docs/routines.md](docs/routines.md) | `core/orchestration/routines.ts` |
| Connections, harnesses, model lists, limits, updater, erase | [docs/technical-guide.md](docs/technical-guide.md), [docs/capabilities.md](docs/capabilities.md), [docs/model-list-fetch.md](docs/model-list-fetch.md) | `core/harness/`, `core/adapters/`, `main/` |
| Notifications | [docs/chat-guide.md](docs/chat-guide.md#notifications) | `renderer/components/notifications.tsx` |
| The `orglet` terminal command, its pipe and the PATH shim | [docs/cli.md](docs/cli.md) | `cli/`, `main/cli-server.ts`, `main/cli-operations.ts`, `main/cli-path.ts` |
| User-facing pages | [docs/user-guide.md](docs/user-guide.md) and its pages | — |

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

Do **not** search the machine for API keys. Do not run `pnpm test:live` unless the user set `ORGLET_LIVE_KEY_FILE`. Packaged smokes (`pnpm make`, `pnpm test:desktop`, `pnpm test:packaged`, `pnpm test:harness`, `pnpm test:isolation`, …) are CI's job after typecheck/test; run the matching one when you change packaging, preload, the isolation backend, or a smoke script. The full list is in [CONTRIBUTING.md](CONTRIBUTING.md#checks).

There is no ESLint/Prettier. Match the file you are in.

## Work in a structured way

1. **Issue first** when the change is larger than a small fix (GitHub issue for public contributors; Linear `COD-xx` for maintainers).
2. **One pull request, one change.** Do not bundle refactors, drive-by formatting, or unrelated files.
3. **Stay in scope.** Do not take over someone else's in-flight PR or rewrite a subsystem to make your patch nicer.
4. **Match nearby code** — naming, density, CSS variables, component patterns. Do not invent a new abstraction layer, state library, or UI kit.
5. **Docs in the same PR** for feature and UX changes: README plus the relevant `docs/` page (how it works, not only that it shipped). User pages follow [docs/writing.md](docs/writing.md); do not rewrite product-spec pages into casual copy. A new user page gets a row in [docs/README.md](docs/README.md).
6. **Tests for behavior.** Prefer `tests/integration/*.test.ts`. Never weaken a test to make it pass.
7. **UI copy** is a Vietnamese source string with English in `apps/desktop/src/shared/locales/en.ts`, in the same change, and `pnpm i18n:keys` clean.
8. Say in the PR what you ran. Required GitHub check is Windows `desktop.yml` (check name `test`). macOS `macos.yml` and Linux `linux.yml` also run; they are not the merge gate.

## Pull requests

Process detail is [CONTRIBUTING.md](CONTRIBUTING.md). Fill [.github/pull_request_template.md](.github/pull_request_template.md).

- Branch from `main`.
- Title: maintainers prefix `COD-xx:`; public contributors write a specific, human title.
- First PR from a person must include: `I have read the CLA and agree to it for all my contributions to Orglet.`
- Do not push release tags or touch `.github/workflows/release.yml` to ship something. A release is a maintainer pushing an annotated `vX.Y.Z` tag on a green `main` commit; [release.yml](.github/workflows/release.yml) then publishes the GitHub Release from the build CI already made. Checklist: [docs/windows-release-gates.md](docs/windows-release-gates.md).

## Coding conventions

**UI text.** Source strings are Vietnamese (`t('...')`). English lives in `apps/desktop/src/shared/locales/en.ts` (US default; UK in the same module). Add both in the same change. Core/main errors are Vietnamese too so `tMessage` can translate them. On screen, workers are **orglets** and teams are **crews**; older docs and code names still say worker and team.

**UI feel.** Quiet ChatGPT-like shell: sidebar, one main column, composer at the bottom, details on demand. Use tokens in `apps/desktop/src/renderer/styles.css` and the components in `packages/orglet-ui`. No neon, gradients-as-brand, org charts, or extra marketing chrome. Tight spacing already landed; do not inflate it. No spinners after the first frame: waits show the shape of what is coming ([technical guide → Loading](docs/technical-guide.md#loading)).

**Trust boundaries.** `contextIsolation` on, `nodeIntegration` off, renderer sandboxed. Keys use Electron `safeStorage` in main; the renderer never reads a saved key back. Backups, templates and logs must not grow secrets. Workers read only files attached to that chat or inside its granted folder, and edit a private copy. Do not execute imported skill scripts. Do not add `--force` / `--yolo` to the Cursor harness or loosen the restricted flags of any harness. Do not silently fall back to Demo when a harness is logged out. Workspace commands have no network, not even loopback; do not add an exemption.

**Data.** Zod at the IPC and storage edge. Integer money (micros), atomic budget reservation. Orglet, crew, skill and instruction edits create a new revision; in-flight runs keep the snapshot they started with. Missing evidence, unknown usage and partial failure stay visible — do not paint them as success.

**Proposals, not actions.** An orglet asked to set the app up proposes a card the person applies; it never creates, deletes or grants anything itself, and keys, connections, permissions, folders, backups and deletions cannot be proposed at all. Self-improvement changes one sentence of the orglet's own instructions and always waits for a click.

**Chats.** Clicking an orglet or a crew opens **that chat** (one live `tasks` row keyed by `workerId` or `teamId`). A user message is a turn, not a new task row. See [docs/team-chat.md](docs/team-chat.md).

## Do not

- Expand into product.md **Not now** (cloud accounts, org-chart company sim, skill marketplace, scraping model lists).
- Commit `.env`, keys, certificates, or SQLite databases.
- Claim you tested a live provider, installer, updater or notarized build unless you actually did.
- "Clean up" unrelated files, regenerate lockfiles without a dependency change, or rephrase docs that are already clear.
