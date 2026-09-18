# Contributing

Thanks for helping with Orglet. Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md). Security problems go through [SECURITY.md](SECURITY.md), not public issues.

## Before you start

- For anything larger than a small fix, open an issue first so we can agree on the approach.
- Read [docs/product.md](docs/product.md). New features should fit who Orglet is for and avoid its "Not now" list.
- The [technical guide](docs/technical-guide.md) explains how to run the app, the tests and the smoke checks.

## License and CLA

Orglet is licensed under [AGPL-3.0](LICENSE). Every contributor must accept the [Contributor License Agreement](CLA.md) before a pull request can be merged. It lets CodePawl also offer Orglet under other licenses. You keep the copyright to your work.

To accept it, write this in your first pull request:

> I have read the CLA and agree to it for all my contributions to Orglet.

## Pull requests

- Keep each pull request to one change.
- Run `pnpm typecheck` and `pnpm test`, and say in the pull request what you ran. Required GitHub CI is Windows: those checks (plus a production `pnpm audit`) fail fast, then `pnpm make` and packaged smokes run. See [docs/windows-release-gates.md](docs/windows-release-gates.md). A separate macOS job runs typecheck, tests and `pnpm make`; it is not the required `test` check.
- Shipping a public Windows GitHub Release is a separate maintainer checklist on that page (unsigned 0.2.x, human installer smoke, then tag). Do not push release tags from a pull request.
- User-facing text goes through the translation files: Vietnamese source strings, with English in `apps/desktop/src/shared/locales/en.ts`.
