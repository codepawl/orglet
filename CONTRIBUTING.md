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

`pnpm dev` opens the Electron app with a Researcher orglet on Demo, so nothing needs a key. `pnpm dev:web` serves the renderer alone with no desktop data bridge; it cannot prove a change to the core or IPC.

The layout of `apps/desktop/src` (main, preload, renderer, core, shared, profiler) is described in [AGENTS.md](AGENTS.md#understand-the-repo); the rules for each layer are in the [technical guide](docs/technical-guide.md).

## Checks

Run these locally before every pull request:

| Command | What it does |
|---|---|
| `pnpm typecheck` | `tsc --noEmit` over the whole repo |
| `pnpm test` | The vitest integration suite in `tests/integration` |
| `pnpm i18n:keys` | Lists English translations that are missing or unused. Run it whenever you touch UI text. |

The packaged smokes drive a real Electron window and are CI's job after typecheck and test. Run the ones that match your change when you touch packaging, preload, the isolation backend, or a smoke script:

| Command | What it covers |
|---|---|
| `pnpm build` then `pnpm test:desktop` | A real window, renderer isolation, sources, export, keyboard, history after restart |
| `pnpm make` then `pnpm test:packaged` | The packaged executable, DuckDB, a crew template with checks, backup and restore |
| `pnpm test:harness` | Settings → Local harnesses with fixture CLIs; never starts a harness run |
| `pnpm build` then `pnpm test:cli` | The shipped `orglet` command against the packaged app: send and read with Demo, JSON, a refused token and operation, starting the app; never edits PATH |
| `pnpm test:isolation` (`--packaged` after `pnpm build`) | The Windows sandbox for workspace files and commands; needs a supported Windows host |
| `pnpm test:routines`, `pnpm test:skills`, `pnpm test:knowledge`, `pnpm test:run-audit`, `pnpm test:findings`, `pnpm test:revisions`, `pnpm test:sidebar`, `pnpm test:i18n`, `pnpm test:custom-connections` | One packaged flow each; see the [technical guide](docs/technical-guide.md#checks-and-packaging) |

Do not run `pnpm test:live` unless you have set `ORGLET_LIVE_KEY_FILE` to your own key; it makes one paid request. Never search a machine for keys to make it run.

## Where things go

- **Docs land with the feature.** A feature or UX change updates the [README](README.md) and the relevant page under `docs/` in the same pull request: how it works, not only that it shipped. User pages follow [docs/writing.md](docs/writing.md); product-spec pages keep their precise language. A new user-facing page gets a row in the [docs map](docs/README.md) and, when you can, a mascot from `pnpm images:orglets` as described there.
- **UI text is translated.** Source strings are Vietnamese, `t('...')` in the renderer; English (US and UK) lives in `apps/desktop/src/shared/locales/en.ts`. Add both in the same change, then run `pnpm i18n:keys`. Errors raised in core or main are Vietnamese too, so `tMessage` can translate them.
- **UI stays quiet.** One sidebar, one main column, the composer at the bottom, details on demand. Use the tokens in `apps/desktop/src/renderer/styles.css` and the components in `packages/orglet-ui` before writing raw controls. No neon, gradients as branding, org charts, or marketing chrome; spacing is already tight, do not inflate it.
- **Trust boundaries hold.** The renderer never sees a saved key, the file system or the database. Backups, templates and logs must not grow secrets. A worker reads only what the chat attached or granted. Imported skill scripts are never executed.
- **Tests describe behaviour.** Prefer `tests/integration/*.test.ts`. Do not weaken a test to make it pass.

## Pull requests

1. Branch from `main` and keep the pull request to one change. No drive-by refactors, formatting, or unrelated files.
2. Fill in the [pull request template](.github/pull_request_template.md): what changed, why it fits, and exactly which checks you ran.
3. Write a specific title. Maintainers prefix theirs with the Linear issue (`COD-xx:`); public contributors do not need one.
4. On your first pull request, include the CLA sentence from [License and CLA](#license-and-cla).

### CI

Pull requests run three workflows. Docs-only changes trigger them too.

| Workflow | File | What it runs | Merge gate |
|---|---|---|---|
| Windows desktop | [`desktop.yml`](.github/workflows/desktop.yml) | `pnpm audit --prod --audit-level=high`, `pnpm typecheck`, `pnpm test`; in parallel `pnpm make` and the packaged smokes, including `pnpm test:harness` | **Required**: the check named `test` |
| macOS desktop | [`macos.yml`](.github/workflows/macos.yml) | `pnpm typecheck`, `pnpm test`, `pnpm make`; signs when Developer ID secrets exist, notarizes on `main` | Runs on PRs; not the required check |
| Linux desktop | [`linux.yml`](.github/workflows/linux.yml) | `pnpm typecheck`, `pnpm test`, `pnpm make`, a headless packaged smoke | Runs on PRs; not the required check |

A green macOS or Linux job does not replace the Windows `test` check. Dependabot's minor and patch updates merge on their own once that check passes ([`dependabot-auto-merge.yml`](.github/workflows/dependabot-auto-merge.yml)); major updates wait for a person.

## Releases

Releases are a maintainer action; do not push a release tag or open a GitHub Release from a pull request.

1. The version in `package.json` is set to the release version and landed on `main` through a normal pull request.
2. Once the Windows desktop workflow is green on that commit, the maintainer pushes an **annotated** tag `vX.Y.Z` on it whose message is the release notes.
3. [`release.yml`](.github/workflows/release.yml) does the rest on GitHub's side: it checks the tag against `package.json`, waits for the green Windows build of that commit, downloads the Setup, ZIP and updater files that build already made, and publishes the GitHub Release with the tag message as its notes. No build passes through anyone's machine.
4. Installed copies pick the release up through the built-in updater within a few hours.

The full checklist, including signing and what the release notes must say, is [docs/windows-release-gates.md](docs/windows-release-gates.md).

## Using AI coding agents

Cursor, Copilot, Claude Code, Codex and similar tools are fine to use here. The bar for the pull request is the same as for a hand-written one, so it is on you to check what the agent produced.

**Point the agent at [AGENTS.md](AGENTS.md).** It is the map of this repo for agents: the layout, the commands, the conventions, and the things not to do. Claude Code reads it through `CLAUDE.md`, Copilot through `.github/copilot-instructions.md` and Cursor through `.cursor/rules/orglet.mdc`; those three files only point at it. For any other tool, paste a link to it into the first prompt. When a task is larger than a small fix, have the agent read the issue and the relevant `docs/` page before it edits anything.

**What reviewers expect from an AI-assisted pull request:**

- One change per pull request. An agent that "also fixed" something nearby has made a second pull request's worth of work; split it out or drop it.
- Tests for the behaviour, in `tests/integration`, and the checks above actually run. Say in the pull request which ones you ran and which you did not.
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
