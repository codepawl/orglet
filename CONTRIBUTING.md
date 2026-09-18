# Contributing

Thanks for helping with Orglet. Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md). Security problems go through [SECURITY.md](SECURITY.md), not public issues.

## Before you start

- For anything larger than a small fix, open an issue first so we can agree on the approach.
- Read [docs/product.md](docs/product.md). New features should fit who Orglet is for and avoid its "Not now" list.
- The [technical guide](docs/technical-guide.md) explains how to run the app, the tests and the smoke checks.

## Opening a pull request

1. Branch from `main` and keep the pull request to one change.
2. Fill in the [pull request template](.github/pull_request_template.md).
3. Run `pnpm typecheck` and `pnpm test` locally, and say in the pull request what you ran.
4. On your first pull request, include the CLA sentence below.

User-facing text goes through the translation files: Vietnamese source strings, with English in `apps/desktop/src/shared/locales/en.ts`.

Do not push release tags from a pull request. Shipping a public Windows GitHub Release is a maintainer checklist in [docs/windows-release-gates.md](docs/windows-release-gates.md) (unsigned 0.2.x, human installer smoke, then tag).

## CI

Pull requests run two GitHub Actions workflows. Docs-only changes still trigger them.

| Workflow | File | What it runs | Merge gate |
|---|---|---|---|
| Windows desktop | [`.github/workflows/desktop.yml`](.github/workflows/desktop.yml) | Fail-fast `pnpm audit --prod --audit-level=high`, `pnpm typecheck`, `pnpm test`; then `pnpm make` and packaged smokes | **Required** — check name `test` |
| macOS desktop | [`.github/workflows/macos.yml`](.github/workflows/macos.yml) | `pnpm typecheck`, `pnpm test`, `pnpm make` (unsigned ZIP artifact) | Runs on PRs; **not** the required `test` check |

There is no Linux workflow. A green macOS job does not replace the Windows aggregator. Details: [windows-release-gates.md](docs/windows-release-gates.md), [macos-packaging.md](docs/macos-packaging.md).

## License and CLA

Orglet is licensed under [AGPL-3.0](LICENSE). Every contributor must accept the [Contributor License Agreement](CLA.md) before a pull request can be merged. It lets CodePawl also offer Orglet under other licenses. You keep the copyright to your work.

To accept it, write this in your first pull request:

> I have read the CLA and agree to it for all my contributions to Orglet.
