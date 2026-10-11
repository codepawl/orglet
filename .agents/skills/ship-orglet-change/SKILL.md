---
name: ship-orglet-change
description: Use when a change to the Orglet desktop app is ready to be written, checked on screen or merged, for the lane (git worktree), the packaged-app screenshot check and the pull request that lands it. Triggers on its own for any Orglet change that will become a pull request.
---

# Đưa một thay đổi Orglet lên main

The order of work for one change, from an empty branch to a merged pull request, with the scripts that do the
repeated parts. Paths are relative to the repo root. [orglet-ui](../orglet-ui/SKILL.md) covers what the UI should
be; this covers how a change gets checked and landed.

Run pnpm as `pnpm --config.verify-deps-before-run=false <script>` in a lane: its packages are links to the main
checkout's, and pnpm would otherwise try to reinstall them.

## 1. Where to write it

- **A small change the person is watching in the dev app:** a branch in the main checkout (`git checkout -b <name>`
  from an updated `main`). The dev app hot-reloads it.
- **Anything larger, delegated or done beside another change:** a lane, so the dev app's checkout stays still.

```text
node .agents/skills/ship-orglet-change/scripts/lane.mjs new <name>            # from origin/main
node .agents/skills/ship-orglet-change/scripts/lane.mjs new <name> <branch>   # stacked on an open branch
node .agents/skills/ship-orglet-change/scripts/lane.mjs remove <name>         # after the merge
```

A lane lives in `.claude/worktrees/<name>`. `remove` unlinks the shared package folders before deleting the lane;
never delete a lane's folder by hand, because the links lead into the main checkout's `node_modules`.

## 2. Check it before saying it works

1. `pnpm typecheck`, then `pnpm test` (about four minutes; run it in the background and do something else).
2. `pnpm i18n:keys` when UI text changed: 0 missing.
3. **A UI change is looked at on the rendered screen.** Package the folder you are in, then walk it:

```text
node .agents/skills/ship-orglet-change/scripts/package.mjs    # about 8 minutes, below-normal priority
node test-results/<your-walk>.mjs
```

   Write the walk in `test-results/` (git-ignored) on top of `scripts/walk.mjs` in this skill; its header shows
   the shape. It opens the packaged app off-screen on a throwaway profile and gives you `page`, `step`, `shot`,
   `core` (a core command, to set state up quickly) and `setTheme`. Take the window at 1200x820, the changed part
   in light and dark, and a narrow window (740x600) when layout moved. Print computed values (a size, a colour, a
   saved field) for anything a picture does not prove.
4. **Read every screenshot.** Look at the parts around the change too: rows without room, text that wraps, an icon
   off its line, uneven gaps. Fix what you find and package again.
5. Run the packaged smokes that cover what you touched (`scripts/*-smoke.mjs`, with `ORGLET_TEST_OFFSCREEN=1`).
   `pnpm test:alignment` needs the window on a display, so it runs in CI; a narrow-window or layout change is not
   proven until that job passes.

Never start the app, a dev server or a smoke with `USERPROFILE`, `HOME` or `APPDATA` changed. Only `package.mjs`
changes one, for the build alone.

## 3. Land it

Write the pull request body from `.github/pull_request_template.md` into a file outside the repo: what changed
and why, what you ran with its numbers, and plainly what you did not check. Then:

```text
node .agents/skills/ship-orglet-change/scripts/land.mjs --title "<what the app does now>" --body-file <file> --wait
```

It rebases the branch on the newest `main`, typechecks the joined result, pushes, opens or updates the pull
request, turns on squash auto-merge and, with `--wait`, reports the merge or the failed check. Run it in the
background and carry on. `--check` does the rebase and typecheck only.

- **One sitting, one pull request** for the owner's small requests: add commits to the open branch and land again.
  A large or risky change gets its own.
- **Two open pull requests that touch the same file:** land the second again after the first merges. CI checks each
  against the main it started from, so two green ones can still break main together.
- **A branch stacked on one that was squash-merged:** `git rebase --onto origin/main <old base commit> <branch>`.
- A red check is read, not retried: `gh pr checks <number> -R codepawl/orglet`, then the failing job's log.

## 4. After the merge

Update the main checkout (`git checkout main && git pull --ff-only`), remove the lane, and tell the person what
merged, what was checked and how, and what was not.
