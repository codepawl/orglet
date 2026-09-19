# Writing docs

Use this when you add or change pages under `docs/`, or user-facing parts of the [README](../README.md). It is not a second copy of [AGENTS.md](../AGENTS.md) or [CONTRIBUTING.md](../CONTRIBUTING.md).

## Default voice

Write so someone new can follow without guessing.

- Plain words. Short sentences. One idea per paragraph.
- Numbered steps for anything the reader should do, in the order they do it.
- Use the names the app shows. English docs use the US English labels (the default). Vietnamese source strings stay in the app; do not mix both on one page unless you are explaining a translation.
- Link to another page instead of repeating it.
- Say what is unfinished when it changes what the reader should expect (unsigned Windows, not notarized on macOS, Demo vs a real model).

Anyone should get it. That means clear, not cute. Do not add slang, jokes, or extra metaphors.

## Exception: product specs and specialist pages

Some pages are the contract. Keep their precise language. Do not rewrite them into casual copy. Do not drop field names, limits, or fail-closed rules to sound friendlier.

That includes [product.md](product.md), [capabilities.md](capabilities.md), [team-chat-context.md](team-chat-context.md), [model-list-fetch.md](model-list-fetch.md), scheduler policy in [routines.md](routines.md), [recovery.md](recovery.md), and the release checklists.

Academic or specialized notes stay academic. The exception is the language, not an excuse to skip steps or hide limits.

## Where a new page goes

1. Give it one job: start here, how it works, a decision, or a ship record.
2. Add it to the [docs map](README.md) in the same pull request.
3. Keep the flat `docs/` layout unless a real group of pages needs a subfolder. Do not invent a parallel tree.

User guides that are not written yet stay as a row in the map. Do not add empty stub files.

When the app's layout changes (sidebar, composer, font), replace the shots in `docs/images/` with `pnpm images:readme` after a local `pnpm make` (or, on Linux, a Vite compile plus unpackaged Electron). Keep the files the README and Getting started already link.

`docs/images/social-preview.png` is the card GitHub, Slack and X show for a repository link. `pnpm images:social` redraws it from the mascots and the product line; it needs no packaged build. GitHub has no API for the social preview, so after changing it someone has to upload the file under Settings → General → Social preview.

## Do not

- Duplicate [AGENTS.md](../AGENTS.md) (how coding agents work in this repo) or [CONTRIBUTING.md](../CONTRIBUTING.md) (how humans open a pull request). Point at them.
- Rewrite a page that is already clear.
- Change app fonts, UI, or add @tags from a docs-only change.
- Put secrets, keys, or machine-local paths that are not examples into docs.
