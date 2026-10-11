#!/usr/bin/env node
/*
 * Packages the app in the current folder (`pnpm build`) for an on-screen check, at below-normal priority so the machine
 * stays usable. Run it from the checkout or lane to package. It takes about eight minutes; run it in the background.
 *
 *   node .agents/skills/ship-orglet-change/scripts/package.mjs
 *
 * The log goes to test-results/package.log; the last lines are printed when it ends.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, openSync, readFileSync } from 'node:fs';
import { constants, setPriority, tmpdir } from 'node:os';
import { join } from 'node:path';

mkdirSync('test-results', { recursive: true });
const logPath = join('test-results', 'package.log');
const log = openSync(logPath, 'w');

// Electron Forge fails on Windows when the profile folder's path is long; a short one for this child only avoids it.
// It is for packaging alone: never start the app, a dev server or a smoke with this variable changed.
const environment = process.platform === 'win32' ? { ...process.env, USERPROFILE: join(tmpdir(), 'ofh') } : process.env;

const child = spawn('pnpm', ['--config.verify-deps-before-run=false', 'build'], { env: environment, shell: true, stdio: ['ignore', log, log] });
try {
  setPriority(child.pid, constants.priority.PRIORITY_BELOW_NORMAL);
} catch {
  /* the build still runs at normal priority */
}
child.on('exit', code => {
  const lines = readFileSync(logPath, 'utf8').trimEnd().split('\n');
  console.log(lines.slice(-4).join('\n'));
  console.log(code === 0 ? 'Packaged. Walk it with a script built on scripts/walk.mjs.' : `Packaging failed with exit code ${code}; read ${logPath}.`);
  process.exit(code ?? 1);
});
