// The shipped `orglet` command against the packaged app (COD-234): launch Orglet on a temporary data folder, then run
// the command the way a terminal would (orglet.cmd through cmd.exe on Windows, the sh launcher elsewhere).
// Run after `pnpm build` or `pnpm make`.
import { _electron as electron } from 'playwright';
import { mkdtemp, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, win32 } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { packagedExecutable } from './packaged-executable.mjs';

const executable = packagedExecutable();
const directory = await mkdtemp(join(tmpdir(), 'orglet-cli-'));
const appEnvironment = { ...process.env, APPDATA: directory };
delete appEnvironment.ELECTRON_RUN_AS_NODE;

/** resources/bin next to the packaged executable, where the launchers ship. */
function launcher() {
  if (process.platform === 'win32') return join(dirname(executable), 'resources', 'bin', 'orglet.cmd');
  if (process.platform === 'darwin') return resolve(dirname(executable), '..', 'Resources', 'bin', 'orglet');
  return join(dirname(executable), 'resources', 'bin', 'orglet');
}

/** The same endpoint rule as apps/desktop/src/cli/protocol.ts, written out so the smoke checks the shipped behaviour. */
function endpoint(userData) {
  if (process.platform !== 'win32') return join(userData, 'cli.sock');
  const digest = createHash('sha256').update(win32.resolve(userData).toLowerCase()).digest('hex').slice(0, 16);
  return `\\\\.\\pipe\\orglet-cli-${digest}`;
}

function quote(argument) {
  return `"${argument.replaceAll('"', '\\"')}"`;
}

/** Runs the shipped command with `ORGLET_USER_DATA` pointing at the smoke's data folder. */
function orglet(userData, ...argumentList) {
  const environment = { ...process.env, ORGLET_USER_DATA: userData };
  delete environment.ELECTRON_RUN_AS_NODE;
  const options = { env: environment, encoding: 'utf8', timeout: 120_000, windowsHide: true };
  const result = process.platform === 'win32'
    // /s keeps cmd from reinterpreting the quotes inside: the whole line runs as typed.
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', `"${[quote(launcher()), ...argumentList.map(quote)].join(' ')}"`], { ...options, windowsVerbatimArguments: true })
    : spawnSync('/bin/sh', [launcher(), ...argumentList], options);
  return { code: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

/** One raw line to the app's pipe, for what the command itself never sends. */
function rawRequest(userData, request) {
  return new Promise((resolveResponse, reject) => {
    const socket = createConnection(endpoint(userData), () => socket.write(`${JSON.stringify(request)}\n`));
    let received = '';
    socket.setEncoding('utf8');
    socket.on('data', chunk => { received += chunk; });
    socket.on('error', reject);
    socket.on('close', () => {
      try { resolveResponse(JSON.parse(received.split('\n')[0])); } catch (error) { reject(error); }
    });
  });
}

function expectOk(result, what) {
  assert.equal(result.code, 0, `${what} exited ${result.code}: ${result.stderr}`);
  return result.stdout;
}

/** Processes started by the command's auto-start carry the smoke's unique data folder on their command line. */
function stopAppsOn(userData) {
  if (process.platform !== 'win32') {
    spawnSync('pkill', ['-f', userData]);
    return;
  }
  const script = `Get-CimInstance Win32_Process -Filter "Name = 'Orglet.exe'" | Where-Object { $_.CommandLine -like '*' + $env:ORGLET_SMOKE_DATA + '*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { env: { ...process.env, ORGLET_SMOKE_DATA: userData }, windowsHide: true });
}

assert.ok(existsSync(launcher()), `No orglet launcher at ${launcher()}`);
let app = await electron.launch({ executablePath: executable, args: [`--user-data-dir=${directory}`], env: appEnvironment });
let closed = false;
app.once('close', () => { closed = true; });
let userData = directory;
try {
  userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'));
  assert.ok(userData.toLowerCase().startsWith(directory.toLowerCase()), 'The CLI smoke needs an isolated data folder');
  await app.firstWindow();
  // The pipe opens once the core is ready; the token file is written just before it.
  const tokenFile = join(userData, 'cli-token');
  for (let attempt = 0; attempt < 60 && !existsSync(tokenFile); attempt++) await new Promise(done => setTimeout(done, 500));
  const token = (await readFile(tokenFile, 'utf8')).trim();
  assert.match(token, /^[a-f0-9]{64}$/);

  const version = expectOk(orglet(userData, '--version'), 'orglet --version');
  assert.match(version, /^orglet \d+\.\d+\.\d+/);
  assert.match(expectOk(orglet(userData, 'send', '--help'), 'orglet send --help'), /--no-wait/);
  assert.match(expectOk(orglet(userData, 'status'), 'orglet status'), /^Orglet \d+\.\d+\.\d+ is running\./);
  assert.match(expectOk(orglet(userData, 'list'), 'orglet list'), /Researcher\s+demo/);

  const answer = expectOk(orglet(userData, 'send', 'hello from the CLI smoke', '--to', 'researcher'), 'orglet send');
  assert.ok(answer.length > 0, 'orglet send printed no answer');
  const read = expectOk(orglet(userData, 'read', '--to', 'Researcher'), 'orglet read');
  assert.equal(read, answer, 'orglet read should print the answer orglet send printed');
  const detail = await app.firstWindow().then(page => page.evaluate(() => window.orglet.call('workspace', {})));
  const chats = detail.tasks.filter(task => !task.teamId && !task.deletedAt);
  assert.equal(chats.length, 1, 'orglet send should use the one chat the composer would');
  assert.equal(chats[0].brief, 'hello from the CLI smoke');

  // A second message continues the same chat as a new turn, exactly like the composer.
  const second = JSON.parse(expectOk(orglet(userData, 'send', 'and a second message', '--to', 'Researcher', '--json'), 'orglet send --json'));
  assert.equal(second.finished, true);
  assert.equal(second.taskId, chats[0].id);
  assert.ok(second.answers.length >= 1 && second.answers[0].text.length > 0);
  const status = JSON.parse(expectOk(orglet(userData, 'status', '--json'), 'orglet status --json'));
  assert.equal(status.orglets >= 1, true);
  assert.equal(`orglet ${status.version}`, version);
  assert.ok(expectOk(orglet(userData, 'open', '--to', 'Researcher'), 'orglet open').includes('Researcher'));

  const unknown = orglet(userData, 'read', '--to', 'Nobody at all');
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /Researcher/);
  assert.equal(orglet(userData, 'send', '--to', 'Researcher').code, 2);

  // What the command never sends: a wrong token, and an operation outside the allowlist with the right one.
  const refused = await rawRequest(userData, { op: 'status', token: 'f'.repeat(64) });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'unauthorized');
  const disallowed = await rawRequest(userData, { op: 'eraseData', token, scope: 'everything' });
  assert.equal(disallowed.code, 'invalid');
  const afterRefusal = await app.firstWindow().then(page => page.evaluate(() => window.orglet.call('workspace', {})));
  assert.ok(afterRefusal.tasks.length >= 1, 'A refused request must not change anything');

  // With the app closed, the command starts it on the same data folder and answers once it is up.
  await app.close();
  const started = orglet(userData, 'status');
  stopAppsOn(userData);
  assert.equal(started.code, 0, `orglet status did not start the app: ${started.stderr}`);
  assert.match(started.stdout, /is running/);
  console.log(`CLI smoke passed: ${version}; answer "${answer.slice(0, 60)}"`);
} finally {
  if (!closed) await app.close();
  stopAppsOn(userData);
}
