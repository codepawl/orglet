# Contributing

Thanks for helping with Orglet. Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md). Security problems go through [SECURITY.md](SECURITY.md), not public issues.

AI-assisted code is welcome. Unstructured dumps that ignore this repo's layout, naming, or [product direction](docs/product.md) are not. When you review a pull request, judge the diff: "an agent wrote it" is neither a reason to merge nor a reason to reject. If you work with a coding agent, read [Using AI coding agents](#using-ai-coding-agents) below and point the agent at [AGENTS.md](AGENTS.md).

## Before you start

- For anything larger than a small fix, open an [issue](https://github.com/codepawl/orglet/issues) first so we can agree on the approach. Questions and ideas go to [Discussions](https://github.com/codepawl/orglet/discussions).
- Read [docs/product.md](docs/product.md). New features should fit who Orglet is for and stay off its **Not now** list.
- Skim the [docs map](docs/README.md) so you know which page describes the part you are changing.
- Match nearby code. Do not reformat unrelated files or invent a parallel structure. There is no ESLint or Prettier; the file you are in is the style guide.

## Set up

You need Node **24.19** or newer, pnpm **11.19.0**, and Windows or macOS. Linux builds in CI and starts headless, but nobody has used it on a real desktop yet.

```
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` opens the Electron app with a Researcher orglet that has no model yet; connect one to chat. The tests and the packaged smokes need no key: they run on sample replies, which the test setup and the smoke launcher turn on with `ORGLET_DEMO_REPLIES=1`. `pnpm dev:web` serves the renderer alone with no desktop data bridge; it cannot prove a change to the core or IPC.

The layout of `apps/desktop/src` (main, preload, renderer, core, shared, profiler) is described in [AGENTS.md](AGENTS.md#understand-the-repo); the rules for each layer are in the [technical guide](docs/technical-guide.md).

## Checks

Run these locally before every pull request:

| Command | What it does |
|---|---|
| `pnpm typecheck` | `tsc --noEmit` over the whole repo |
| `pnpm test` | The vitest integration suite in `tests/integration`, and the UI kit's own tests in `packages/orglet-ui/test`; the files that start a real Chrome run one at a time (`vitest.config.ts`) |
| `pnpm --config.verify-deps-before-run=false --dir services/market install --frozen-lockfile`, then service `typecheck` and `test` with the same prefix | Required for Market service changes: pinned tooling, tracked local D1 migrations, actual Worker repository/anonymous-handler tests. Install the root workspace first. Windows, macOS and Linux CI run these separately from the root suite. |
| `pnpm --config.verify-deps-before-run=false --dir services/sync install --frozen-lockfile`, then service `typecheck`, `test` and `check:deploy` with the same prefix | Required for sync service changes: signature verification, native Durable Object SQLite persistence, atomic batches, privacy, encryption and cursors. The dry run creates no cloud resources. See [service checks](services/sync/README.md). |
| `pnpm --filter @codepawlhq/orglet-ui build`, then `pnpm --filter @codepawlhq/orglet-ui check:package` | Builds the UI kit and checks the package someone would install: publint for its `package.json`, Are the Types Wrong for its types. Run it when you touch `packages/orglet-ui`. |
| `pnpm --filter @codepawlhq/orglet-ui docs`, then `check:docs` | Rewrites the kit's README table, `llms.txt` and skill from `docs/components/*.md`; the check fails when one is stale or an export has no page. Run it after adding or changing a kit component. |
| `pnpm i18n:keys` | Lists English translations that are missing or unused. Run it whenever you touch UI text. |

The packaged smokes drive a real Electron window and are CI's job after typecheck and test. Run the ones that match your change when you touch packaging, preload, the isolation backend, or a smoke script:

| Command | What it covers |
|---|---|
| `pnpm build` then `pnpm test:desktop` | A real window, renderer isolation, sources, export, keyboard, history after restart |
| `pnpm make` then `pnpm test:packaged` | The packaged executable, DuckDB, a crew template with checks, backup and restore |
| `pnpm test:harness` | Settings → Local harnesses with fixture CLIs; never starts a harness run |
| `pnpm build` then `pnpm test:cli` | The shipped `orglet` command against the packaged app: send and read with Demo, JSON, a refused token and operation, background startup without windows, explicit desktop open and normal app launch; never edits PATH |
| `pnpm build` then `pnpm test:alignment` | Measures alignment on the main screens at 1200×820 and 740×600 in both themes: icon and text centre lines, text starts in a column, gaps, wrapped or clipped labels, sideways scroll. Run it after any UI change; see the [technical guide](docs/technical-guide.md#alignment-check) |
| `pnpm build` then `pnpm test:market-publishing` | Real packaged main, core, preload and renderer with trusted in-process account/Market fixtures: orglet and crew publishing, exact public preview, source invalidation, no implicit send, and immutable retry after restart. Measures Vietnamese/English form and preview in both themes and sizes; does not verify authenticated Worker HTTP or production login. |
| `pnpm build` then `pnpm test:market-moderation` | Real packaged report/reviewer UI with trusted transports: full inert text, previous approved version, keyboard/focus, conflicts, service pauses, revoked reviewer hints and exact retry after SQLite/app restart. Measures VI/EN, both themes and window sizes; does not verify authenticated Worker HTTP. |
| `pnpm build` then `pnpm test:sync-privacy` | Real packaged renderer, preload, core and SQLite: keyboard saves for orglet/chat privacy, side-thread inheritance, restart persistence and VI/EN layouts in both themes and window sizes. Uses Demo; no account transport or live provider. |
| `pnpm stress -- --tiers=x1,x10` (`--exe=<packaged Orglet.exe>` after `pnpm build`) | Seeds a synthetic profile of 20 to 500 orglets and up to 200,000 turns and prints how long the core's commands, start, search, backup and sync take on it; not part of CI. See [Scale](docs/technical-guide.md#scale) |
| `pnpm test:isolation` (`--packaged` after `pnpm build`) | The Windows sandbox for workspace files and commands; needs a supported Windows host |
| `pnpm test:routines`, `pnpm test:skills`, `pnpm test:knowledge`, `pnpm test:run-audit`, `pnpm test:findings`, `pnpm test:revisions`, `pnpm test:sidebar`, `pnpm test:spaces`, `pnpm test:i18n`, `pnpm test:custom-connections` | One packaged flow each; see the [technical guide](docs/technical-guide.md#checks-and-packaging) |

Do not run `pnpm test:live` unless you have set `ORGLET_LIVE_KEY_FILE` to your own key; it makes one paid request. Never search a machine for keys to make it run.

`pnpm build` then `node scripts/agent-bench/run.mjs --provider cursor` (or `claude-code`, `codex`; `--only finance,swe`) runs eight live tasks shaped after well-known benchmarks: finance (FinanceBench), paperwork (OfficeBench), web research (GAIA), a failing test (SWE-bench), data analysis (DABench), a colleague's ask (MT-Bench), a short email (WritingBench) and a channel where a lead splits the work. Each plants a wrong premise, so it shows whether an orglet checks it, uses its tools, answers in the person's language, reacts and talks like a colleague. It uses your signed-in CLI and its plan, one fresh profile and one recorded window per task, and saves the chat, every app error and a video with the waits cut out; `node scripts/agent-bench/grade.mjs <folder>` scores what can be measured. Read the chats for tone. `--provider demo` only proves the pipeline. The `po-simple`, `po-data` and `po-writing` tasks build a channel with a lead and `--crew-size N` orglets in all, most of them with unrelated jobs, and grade whether the lead answers alone or hands the work to the one that fits; the grades also count the runs and the seconds of each turn, so the same tasks at 2, 4 and 8 orglets show what a bigger channel costs.

## Where things go

- **Docs land with the feature.** A feature or UX change updates the [README](README.md) and the relevant page under `docs/` in the same pull request: how it works, not only that it shipped. User pages follow [docs/writing.md](docs/writing.md); product-spec pages keep their precise language. A new user-facing page gets a row in the [docs map](docs/README.md) and, when you can, a mascot from `pnpm images:orglets` as described there.
- **UI text is translated.** Source strings are Vietnamese, `t('...')` in the renderer; English (US and UK) lives in `apps/desktop/src/shared/locales/en.ts`. Add both in the same change, then run `pnpm i18n:keys`. Errors raised in core or main are Vietnamese too, so `tMessage` can translate them.
- **UI stays quiet.** One sidebar, one main column, the composer at the bottom, details on demand. Use the tokens in `apps/desktop/src/renderer/styles.css` and the components in `packages/orglet-ui` before writing raw controls. No neon, gradients as branding, org charts, or marketing chrome; spacing is already tight, do not inflate it.
- **Trust boundaries hold.** The renderer never sees a saved key, the file system or the database. Backups, templates and logs must not grow secrets. A worker reads only what the chat attached or granted. Imported skill scripts are never executed.
- **Tests describe behaviour.** Prefer `tests/integration/*.test.ts`. Do not weaken a test to make it pass.

## Pull requests

1. Branch from `main` and keep the pull request to one change. No drive-by refactors, formatting, or unrelated files.
2. Fill in the [pull request template](.github/pull_request_template.md): what changed, why it fits, and exactly which checks you ran.
3. Write a specific title. It needs no issue prefix.
4. On your first pull request, include the CLA sentence from [License and CLA](#license-and-cla).

### CI

Pull requests run three workflows. Docs-only changes trigger them too.

| Workflow | File | What it runs | Merge gate |
|---|---|---|---|
| Windows desktop | [`desktop.yml`](.github/workflows/desktop.yml) | `pnpm audit --prod --audit-level=high`, `pnpm typecheck`, `pnpm test`, the UI kit's build and package checks; in parallel `pnpm make` and the packaged smokes, including `pnpm test:harness` | **Required**: the check named `test` |
| macOS desktop | [`macos.yml`](.github/workflows/macos.yml) | `pnpm typecheck`, `pnpm test`, `pnpm make`; signs when Developer ID secrets exist, notarizes on `main` | Runs on PRs; not the required check |
| Linux desktop | [`linux.yml`](.github/workflows/linux.yml) | `pnpm typecheck`, `pnpm test`, `pnpm make`, a headless packaged smoke | Runs on PRs; not the required check |

A green macOS or Linux job does not replace the Windows `test` check. Dependabot's minor and patch updates merge on their own once that check passes ([`dependabot-auto-merge.yml`](.github/workflows/dependabot-auto-merge.yml)); major updates wait for a person.

## Releases

Releases are a maintainer action; do not push a release tag or open a GitHub Release from a pull request.

1. The version in `package.json` is set to the release version and landed on `main` through a normal pull request.
2. Once the Windows desktop workflow is green on that commit, the maintainer pushes an **annotated** tag `vX.Y.Z` on it whose message is the release notes.
3. [`release.yml`](.github/workflows/release.yml) does the rest on GitHub's side, and no build passes through anyone's machine. It checks the tag against `package.json`, waits for the Windows, macOS and Linux builds of that commit, and publishes the GitHub Release with the tag message as its notes plus a generated **Downloads** line. Windows (Setup, ZIP and updater files) must be green or nothing ships; the notarized macOS ZIP and the experimental Linux ZIP are attached when their builds passed and skipped with a note otherwise.
4. The same run then starts [`npm-installer.yml`](.github/workflows/npm-installer.yml), which publishes `@codepawlhq/orglet` at the tag's version, and opens a pull request in `codepawl/codepawl-web` that refreshes the site's download snapshot. orglet.codepawl.com already reads the latest release live. Orglet has no PyPI package.
5. Installed copies pick the release up through the built-in updater within a few hours.

The full checklist, including signing and what the release notes must say, is [docs/windows-release-gates.md](docs/windows-release-gates.md).

## Using AI coding agents

Cursor, Copilot, Claude Code, Codex and similar tools are fine to use here. The bar for the pull request is the same as for a hand-written one, so it is on you to check what the agent produced.

**Point the agent at [AGENTS.md](AGENTS.md).** It is the map of this repo for agents: the layout, the commands, the conventions, and the things not to do. Claude Code reads it through `CLAUDE.md`, Copilot through `.github/copilot-instructions.md` and Cursor through `.cursor/rules/orglet.mdc`; those three files only point at it. For any other tool, paste a link to it into the first prompt. When a task is larger than a small fix, have the agent read the issue and the relevant `docs/` page before it edits anything.

**What reviewers expect from an AI-assisted pull request:**

- One change per pull request. An agent that "also fixed" something nearby has made a second pull request's worth of work; split it out or drop it.
- Tests for the behaviour, in `tests/integration` (or `packages/orglet-ui/test` for a UI kit component), and the checks above actually run. Say in the pull request which ones you ran and which you did not.
- Docs in the same pull request, in the register of the page you touch. A feature with no doc change is not finished.
- UI copy added as Vietnamese source strings with English in `en.ts`, and `pnpm i18n:keys` clean.
- No secrets, keys, `.env` files or SQLite databases in the diff, and no absolute paths from your machine in docs or tests.
- A description you wrote and understand. If you cannot explain a line the agent produced, ask it to simplify or remove it.

**Do not let an agent:**

- push tags, open a GitHub Release, or change the release workflow to make one happen;
- add `--force`, `--yolo` or any auto-approve flag to the Cursor, Claude Code or Codex harness launch, or loosen the flags that keep a harness run inside its copy;
- weaken, skip or delete a test to get a green run, or mark a partial failure as success anywhere the app shows it;
- search your machine for API keys, read `~/.claude`, `~/.codex` or a browser profile, or set `ORGLET_LIVE_KEY_FILE` for you;
- overwrite `AGENTS.md`, `CLAUDE.md` or your own home-directory agent config with something it generated;
- expand into the [Not now](docs/product.md#not-now) list because it seemed like a natural next step.

## License and CLA

Orglet is licensed under [AGPL-3.0](LICENSE). Every contributor must accept the [Contributor License Agreement](CLA.md) before a pull request can be merged. It lets CodePawl also offer Orglet under other licenses. You keep the copyright to your work.

To accept it, write this in your first pull request:

> I have read the CLA and agree to it for all my contributions to Orglet.
