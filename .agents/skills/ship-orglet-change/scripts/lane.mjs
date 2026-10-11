#!/usr/bin/env node
/*
 * A lane is a git worktree for one change, so two changes can be written at once and the checkout a dev app runs from
 * is left alone. It shares the main checkout's installed packages through directory links instead of installing again.
 *
 *   node .agents/skills/ship-orglet-change/scripts/lane.mjs new <name> [base]     base defaults to origin/main
 *   node .agents/skills/ship-orglet-change/scripts/lane.mjs remove <name>         also deletes the local branch
 *   node .agents/skills/ship-orglet-change/scripts/lane.mjs list
 */
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, rmdirSync, symlinkSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** The folders that hold installed packages; each is linked from the lane to the main checkout's copy. */
const PACKAGE_FOLDERS = ['node_modules', 'packages/orglet-ui/node_modules', 'apps/desktop/node_modules'];

function git(args, options = {}) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...options }).trim();
}

function mainCheckout() {
  // The first worktree git lists is the main checkout, whichever folder this runs from.
  const first = git(['worktree', 'list', '--porcelain']).split('\n').find(line => line.startsWith('worktree '));
  if (!first) throw new Error('This is not a git checkout.');
  return resolve(first.slice('worktree '.length));
}

function lanePath(root, name) {
  if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(name ?? '')) throw new Error('Give the lane a short kebab-case name, for example: search-field');
  return join(root, '.claude', 'worktrees', name);
}

function linkPackages(root, lane) {
  for (const folder of PACKAGE_FOLDERS) {
    const target = join(root, folder);
    const link = join(lane, folder);
    if (!existsSync(target) || existsSync(link)) continue;
    // A junction needs no elevated rights on Windows; elsewhere it is an ordinary directory link.
    symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  }
}

/** Removes the links only. Deleting a lane with its links in place would follow them into the main checkout's packages. */
function unlinkPackages(lane) {
  for (const folder of PACKAGE_FOLDERS) {
    const link = join(lane, folder);
    if (!existsSync(link)) continue;
    if (!lstatSync(link).isSymbolicLink()) throw new Error(`${link} is a real folder, not a link. Remove it by hand after checking what is in it.`);
    if (process.platform === 'win32') rmdirSync(link);
    else unlinkSync(link);
  }
}

function newLane(name, base = 'origin/main') {
  const root = mainCheckout();
  const lane = lanePath(root, name);
  if (existsSync(lane)) throw new Error(`${lane} already exists.`);
  if (base.startsWith('origin/')) git(['fetch', '--quiet', 'origin'], { cwd: root });
  git(['worktree', 'add', '--quiet', '-b', name, lane, base], { cwd: root });
  linkPackages(root, lane);
  console.log(`Lane ${name} is at ${lane}, on ${git(['log', '--oneline', '-1'], { cwd: lane })}`);
  console.log('Run pnpm there as: pnpm --config.verify-deps-before-run=false <script>');
}

function removeLane(name) {
  const root = mainCheckout();
  const lane = lanePath(root, name);
  if (!existsSync(lane)) throw new Error(`${lane} does not exist.`);
  const dirty = git(['status', '--porcelain', '--untracked-files=no'], { cwd: lane });
  if (dirty) throw new Error(`The lane has uncommitted changes:\n${dirty}\nCommit or discard them first.`);
  unlinkPackages(lane);
  git(['worktree', 'remove', '--force', lane], { cwd: root });
  // A branch that was squash-merged does not look merged to git, so it is deleted without that check.
  try { git(['branch', '-D', name], { cwd: root }); } catch { /* the branch was already gone */ }
  console.log(`Lane ${name} is removed.`);
}

const [command, name, base] = process.argv.slice(2);
try {
  if (command === 'new') newLane(name, base);
  else if (command === 'remove') removeLane(name);
  else if (command === 'list') console.log(git(['worktree', 'list']));
  else throw new Error('Usage: lane.mjs new <name> [base] | remove <name> | list');
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
