#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { install, RELEASES_PAGE } from '../lib/install.js';
import { installedLaunch, windowsAppInstalled } from '../lib/installed.js';

/*
 * `npx @codepawlhq/orglet` installs Orglet; once it is installed, every other argument goes to the app's own `orglet`
 * command (docs/cli.md), so a global install of this package never behaves differently from the command Setup adds.
 * `orglet install` installs or updates to the latest release at any time.
 */

function print(line) {
  process.stdout.write(`${line}\n`);
}

function drawProgress(received, total) {
  if (!process.stdout.isTTY) return;
  const share = total > 0 ? ` ${Math.floor((received / total) * 100)}%` : '';
  process.stdout.write(`\r  ${(received / 1024 / 1024).toFixed(0)} MB${share}   `);
}

async function confirmed(question) {
  if (process.argv.includes('--yes') || process.argv.includes('-y')) return true;
  if (!process.stdin.isTTY) return true;
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await prompt.question(`${question} [Y/n] `)).trim().toLowerCase();
  prompt.close();
  return answer === '' || answer === 'y' || answer === 'yes';
}

async function runInstall() {
  if (!(await confirmed('Install the latest Orglet for this Windows user?'))) {
    print('Nothing was installed.');
    return 0;
  }
  try {
    await install({ log: print, progress: drawProgress });
    return 0;
  } catch (failure) {
    print('');
    print(failure instanceof Error ? failure.message : String(failure));
    return 1;
  }
}

function forward(launch, args) {
  return new Promise(resolve => {
    const child = spawn(launch.command, [...launch.args, ...args], { stdio: 'inherit', env: launch.env });
    child.on('error', failure => {
      print(`Could not start Orglet's command: ${failure.message}`);
      resolve(1);
    });
    child.on('exit', code => resolve(code ?? 1));
  });
}

async function main() {
  const args = process.argv.slice(2).filter(argument => argument !== '--yes' && argument !== '-y');
  if (args[0] === 'install') return runInstall();
  const launch = installedLaunch(process.platform, process.env);
  if (launch) return forward(launch, args);
  if (process.platform === 'win32' && windowsAppInstalled(process.env)) {
    print('Orglet is installed, but its command is switched off. Open Orglet, then Settings → About → Add to PATH.');
    return 1;
  }
  if (process.platform !== 'win32') {
    print(`Orglet is not installed. Download it from ${RELEASES_PAGE}`);
    return 1;
  }
  print('Orglet is not installed yet.');
  return runInstall();
}

process.exitCode = await main();
