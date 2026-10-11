#!/usr/bin/env node
/*
 * Lands the branch in the current folder: puts it on today's main, typechecks the result, pushes, opens the pull
 * request (or updates the open one), turns on squash auto-merge, and can wait for the merge.
 *
 *   node .agents/skills/ship-orglet-change/scripts/land.mjs --title "..." --body-file <path> [--wait]
 *   node .agents/skills/ship-orglet-change/scripts/land.mjs --check        only rebase and typecheck; push nothing
 *
 * Why the rebase and typecheck come first: CI runs each pull request against the main it was opened on. Two pull
 * requests that each pass can break main together (on 2026-10-12 two of them each added the same import to one file).
 * A branch that is rebased on the newest main and typechecked just before it is pushed cannot do that to the pull
 * requests already merged, and one that waits behind another must be landed again after that one merges.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const REPOSITORY = 'codepawl/orglet';
const POLL_SECONDS = 150;

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const flag = name => process.argv.includes(name);

function read(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Runs a command with its output shown; throws with `failure` when it exits non-zero. */
function run(command, args, failure) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' && command === 'pnpm' });
  if (result.status !== 0) throw new Error(failure);
}

function assertReady(branch) {
  if (branch === 'main') throw new Error('This is main. Land a branch: git checkout -b <name>.');
  const dirty = read('git', ['status', '--porcelain', '--untracked-files=no']);
  if (dirty) throw new Error(`Commit or discard these first:\n${dirty}`);
}

/** Puts the branch on the newest main. Returns whether its commits moved, which decides how it is pushed. */
function rebaseOnMain() {
  run('git', ['fetch', '--quiet', 'origin'], 'Could not fetch origin.');
  const before = read('git', ['rev-parse', 'HEAD']);
  const rebase = spawnSync('git', ['rebase', 'origin/main'], { stdio: 'inherit' });
  if (rebase.status !== 0) {
    throw new Error('The branch conflicts with main. Resolve the conflict, run `git rebase --continue`, then land again.\nIf this branch was stacked on one that was squash-merged: git rebase --onto origin/main <the old base commit> <this branch>');
  }
  return read('git', ['rev-parse', 'HEAD']) !== before;
}

function openPullRequest(branch) {
  const found = read('gh', ['pr', 'list', '-R', REPOSITORY, '--head', branch, '--state', 'open', '--json', 'number', '-q', '.[0].number']);
  return found ? Number(found) : undefined;
}

function publish(branch, moved) {
  const hasUpstream = spawnSync('git', ['rev-parse', '--verify', '--quiet', `origin/${branch}`]).status === 0;
  // A rebased branch that was pushed before has to replace what is there; the lease refuses if someone else pushed to it.
  const pushArgs = hasUpstream && moved ? ['push', '--force-with-lease', 'origin', branch] : ['push', '-u', 'origin', branch];
  run('git', pushArgs, 'The push failed.');
  let number = openPullRequest(branch);
  if (!number) {
    const title = option('--title');
    const bodyFile = option('--body-file');
    if (!title || !bodyFile || !existsSync(bodyFile)) throw new Error('A new pull request needs --title "..." and --body-file <an existing file> (fill .github/pull_request_template.md).');
    run('gh', ['pr', 'create', '-R', REPOSITORY, '--base', 'main', '--head', branch, '--title', title, '--body-file', bodyFile], 'Could not open the pull request.');
    number = openPullRequest(branch);
  }
  run('gh', ['pr', 'merge', '-R', REPOSITORY, String(number), '--auto', '--squash'], 'Could not turn on auto-merge.');
  return number;
}

async function waitForMerge(number) {
  for (;;) {
    const view = JSON.parse(read('gh', ['pr', 'view', '-R', REPOSITORY, String(number), '--json', 'state,statusCheckRollup']));
    const failed = (view.statusCheckRollup ?? []).filter(check => check.conclusion === 'FAILURE').map(check => check.name);
    if (view.state === 'MERGED') return console.log(`#${number} is merged. Update main (git checkout main && git pull --ff-only) and remove the lane.`);
    if (view.state === 'CLOSED') throw new Error(`#${number} was closed without merging.`);
    if (failed.length) throw new Error(`#${number} failed: ${failed.join(', ')}. Read the log: gh pr checks ${number} -R ${REPOSITORY}`);
    await sleep(POLL_SECONDS * 1000);
  }
}

try {
  const branch = read('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  assertReady(branch);
  const moved = rebaseOnMain();
  run('pnpm', ['--config.verify-deps-before-run=false', 'typecheck'], 'Typecheck fails on this branch joined with main. Fix it before pushing.');
  if (flag('--check')) {
    console.log('The branch sits on the newest main and typechecks. Nothing was pushed.');
  } else {
    const number = publish(branch, moved);
    console.log(`https://github.com/${REPOSITORY}/pull/${number}`);
    if (flag('--wait')) await waitForMerge(number);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
