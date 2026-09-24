## What changed

One change. Say what you did and why it fits this repo (see `AGENTS.md` and `CONTRIBUTING.md`). Link the issue if there is one.

## How you checked it

List what you actually ran. Leave a box empty rather than ticking it for a check you skipped.

- [ ] `pnpm typecheck` and `pnpm test` pass locally
- [ ] `pnpm i18n:keys` is clean (only if UI text changed; Vietnamese source strings, English in `apps/desktop/src/shared/locales/en.ts`)
- [ ] Packaged smokes I ran, if packaging, preload, isolation or a smoke script changed:
- [ ] I expect GitHub CI: required Windows `desktop.yml` (check name `test`); macOS and Linux also run
- [ ] Nearby code is matched; no unrelated reformat or extra abstraction
- [ ] Feature and UX changes update the README and the relevant `docs/` pages in this pull request
- [ ] No keys, `.env` files, databases or machine-local paths in the diff

## If an AI coding agent helped

Say which tool, and confirm you read the diff yourself. The bar is the same as for hand-written code (see `CONTRIBUTING.md` → Using AI coding agents).

## First pull request

- [ ] I have read the [CLA](https://github.com/codepawl/orglet/blob/main/CLA.md) and agree to it for all my contributions to Orglet.
