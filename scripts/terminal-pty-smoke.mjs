// Packaged smoke for the terminal's held commands as a person runs them: the shipped `orglet` command in a real
// pseudo-terminal, the pairing code read from the app's window and typed at the prompt, and secrets typed with echo
// off. `terminal-access-smoke.mjs` speaks the pipe directly; this one proves the command, its prompts and its hidden
// input. Each run prints what the terminal showed, with every typed secret checked to be absent from it.
import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { useEnglish } from './smoke-language.mjs';
import { packagedExecutable } from './packaged-executable.mjs';

const pty = createRequire(import.meta.url)('node-pty');
const executable = packagedExecutable();
const directory = await mkdtemp(join(tmpdir(), 'orglet-terminal-pty-'));
const appEnvironment = { ...process.env, ORGLET_SKIP_ACCOUNT_CHOICE: '1', ORGLET_DEMO_REPLIES: '1' };
delete appEnvironment.ELECTRON_RUN_AS_NODE;
await mkdir('test-results', { recursive: true });

function launcher() {
  if (process.platform === 'win32') return join(dirname(executable), 'resources', 'bin', 'orglet.cmd');
  if (process.platform === 'darwin') return resolve(dirname(executable), '..', 'Resources', 'bin', 'orglet');
  return join(dirname(executable), 'resources', 'bin', 'orglet');
}

/** What the terminal showed, without the escape sequences that move the cursor and colour the text. */
function plainText(raw) {
  return raw.replace(/\x1b\][^\x07]*\x07/g, '').replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\r/g, '');
}

const pause = milliseconds => new Promise(done => setTimeout(done, milliseconds));

/**
 * Runs one command in a pseudo-terminal. While it runs: a pairing dialog in the window has its code typed at the
 * terminal, and each prompt for a secret (a line that stops without a newline after the pairing) gets the next secret.
 */
async function runInTerminal(page, argumentList, { secrets = [], lines = [], seconds = 60, respond } = {}) {
  let responded = false;
  const environment = { ...process.env, ORGLET_USER_DATA: directory };
  delete environment.ELECTRON_RUN_AS_NODE;
  const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
  const shellArguments = process.platform === 'win32' ? ['/d', '/c', launcher(), ...argumentList] : [launcher(), ...argumentList];
  const terminal = pty.spawn(shell, shellArguments, { name: 'xterm-256color', cols: 120, rows: 40, cwd: process.cwd(), env: environment });
  let raw = '';
  let exitCode;
  terminal.onData(chunk => { raw += chunk; });
  terminal.onExit(event => { exitCode = event.exitCode; });
  const dialog = page.locator('.terminal-pairing-dialog');
  const pendingSecrets = [...secrets];
  const pendingLines = [...lines];
  let pairedAt = 0;
  let lastLength = 0;
  let quietSince = Date.now();
  const deadline = Date.now() + seconds * 1000;
  while (exitCode === undefined && Date.now() < deadline) {
    await pause(250);
    if (raw.length !== lastLength) {
      lastLength = raw.length;
      quietSince = Date.now();
    }
    if (await dialog.count()) {
      const code = (await dialog.locator('.terminal-pairing-code').innerText()).replace(/[^A-Z0-9]/g, '');
      await pause(400);
      terminal.write(`${code}\r`);
      await dialog.waitFor({ state: 'detached', timeout: 15000 });
      pairedAt = Date.now();
      quietSince = Date.now();
      continue;
    }
    const quietFor = Date.now() - quietSince;
    if (pairedAt && quietFor > 1500 && pendingSecrets.length) {
      terminal.write(`${pendingSecrets.shift()}\r`);
      quietSince = Date.now();
      continue;
    }
    if (pairedAt && quietFor > 1500 && pendingLines.length) {
      terminal.write(`${pendingLines.shift()}\r`);
      quietSince = Date.now();
      continue;
    }
    // A prompt whose answer depends on what the terminal just printed, answered once.
    if (pairedAt && quietFor > 1500 && respond && !responded) {
      const answer = respond(plainText(raw));
      if (answer !== undefined) {
        responded = true;
        terminal.write(`${answer}\r`);
        quietSince = Date.now();
      }
    }
  }
  if (exitCode === undefined) terminal.kill();
  const shown = plainText(raw);
  for (const secret of secrets) assert.equal(shown.includes(secret), false, `the terminal never shows the secret typed for: orglet ${argumentList.join(' ')}`);
  return { shown, exitCode, paired: pairedAt > 0, secretsLeft: pendingSecrets.length };
}

function report(title, result) {
  console.log(`\n===== orglet ${title} (exit ${result.exitCode}, paired ${result.paired}, secrets left ${result.secretsLeft})`);
  console.log(result.shown.split('\n').filter(line => line.trim()).slice(-22).join('\n'));
}

const app = await electron.launch({ executablePath: executable, args: [`--user-data-dir=${directory}`], env: appEnvironment });
try {
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1200, height: 820 });
  await useEnglish(page);
  await readFile(join(directory, 'cli-token'), 'utf8');

  const sent = await runInTerminal(page, ['send', '--to', 'Researcher', 'Say hello.'], { seconds: 60 });
  report('send', sent);
  assert.equal(sent.exitCode, 0, 'a plain command still runs in a terminal');

  const searchKey = 'exa-pty-SECRET-9876543210';
  const connected = await runInTerminal(page, ['connect', 'search', 'exa'], { secrets: [searchKey] });
  report('connect search exa', connected);
  assert.equal(connected.paired, true, 'connect asks for the window\'s code');
  assert.equal(connected.secretsLeft, 0, 'connect asks for the key after the pairing');
  assert.equal(connected.exitCode, 0, 'the key is saved');

  const connections = await runInTerminal(page, ['show', 'connections']);
  report('show connections', connections);
  assert.equal(connections.shown.includes(searchKey), false, 'show connections never prints a key');

  const programs = await runInTerminal(page, ['show', 'desktop-programs']);
  report('show desktop-programs', programs);

  const desktop = await runInTerminal(page, ['grant', 'desktop', '--to', 'Researcher', '--add', 'notepad.exe']);
  report('grant desktop --add notepad.exe', desktop);
  assert.equal(desktop.paired, true, 'a desktop grant asks for the window\'s code');

  const refusedProgram = await runInTerminal(page, ['grant', 'desktop', '--to', 'Researcher', '--add', 'orglet.exe']);
  report('grant desktop --add orglet.exe', refusedProgram);
  assert.equal(refusedProgram.exitCode, 2, 'the app\'s own program is never granted');
  assert.equal(refusedProgram.paired, false, 'and no code is asked for something that is always refused');

  const folder = await mkdtemp(join(tmpdir(), 'orglet-pty-folder-'));
  const granted = await runInTerminal(page, ['grant', 'folder', folder, '--to', 'Researcher']);
  report('grant folder', granted);
  assert.equal(granted.paired, true, 'a folder grant asks for the code in the window');
  assert.equal(granted.exitCode, 0, 'the folder is granted');
  const refusedOption = await runInTerminal(page, ['grant', 'folder', folder, '--to', 'Researcher', '--no-such-option']);
  report('grant folder (unknown option)', refusedOption);
  assert.equal(refusedOption.exitCode, 2);
  assert.ok(refusedOption.shown.includes('orglet grant --help'), 'the hint names the command that was typed');

  // A skill package imported from a folder waits for a review; the terminal prints it, then takes the hash typed back.
  const skillDirectory = join(directory, 'pty-research');
  await mkdir(skillDirectory, { recursive: true });
  await writeFile(join(skillDirectory, 'SKILL.md'), '---\nname: pty-research\ndescription: Use when researching a question with written evidence.\n---\n\nCompare evidence and explain uncertainty.\n');
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, skillDirectory);
  const importedSkill = await page.evaluate(() => window.orglet.importSkill());
  const skill = await runInTerminal(page, ['skill', 'show', 'pty-research'], {
    seconds: 60,
    respond: shown => shown.match(/\b[0-9a-f]{64}\b/)?.[0].slice(0, 8),
  });
  report('skill show', skill);
  assert.equal(skill.paired, true, 'showing a package to trust asks for the code in the window');
  assert.ok(skill.shown.includes('Compare evidence'), 'the package text is printed before anything is trusted');
  assert.equal(skill.exitCode, 0, 'the package is trusted after its hash is typed back');
  const unknownSkill = await runInTerminal(page, ['skill', 'show', 'General help']);
  report('skill show (not an imported package)', unknownSkill);

  const serversFile = join(directory, 'servers.json');
  const firstSecret = 'mcp-pty-TOKEN-AAAA1111';
  const secondSecret = 'mcp-pty-TOKEN-BBBB2222';
  await writeFile(serversFile, JSON.stringify({ mcpServers: { 'pty-notes': { command: 'node', args: ['notes.js'], env: { NOTES_TOKEN: '', NOTES_REGION: '' } } } }, null, 2));
  const imported = await runInTerminal(page, ['grant', 'mcp-import', serversFile], { secrets: [firstSecret, secondSecret], seconds: 90 });
  report('grant mcp-import', imported);
  assert.equal(imported.paired, true, 'an import asks for the window\'s code');

  const valueFile = join(directory, 'servers-with-value.json');
  await writeFile(valueFile, JSON.stringify({ mcpServers: { leaky: { command: 'node', args: ['x.js'], env: { TOKEN: 'leaked-VALUE-777' } } } }, null, 2));
  const refusedFile = await runInTerminal(page, ['grant', 'mcp-import', valueFile]);
  report('grant mcp-import (file with a value)', refusedFile);
  assert.notEqual(refusedFile.exitCode, 0, 'a file that carries a secret value is refused');
  assert.equal(refusedFile.shown.includes('leaked-VALUE-777'), false, 'the refusal does not repeat the value');
  assert.ok(refusedFile.shown.includes('The file has a value'), 'the refusal is in the language of the terminal');

  const journal = await runInTerminal(page, ['show', 'terminal']);
  report('show terminal', journal);
  for (const secret of [searchKey, firstSecret, secondSecret]) {
    assert.equal(journal.shown.includes(secret), false, 'the journal never shows a secret');
    assert.equal((await readFile(join(directory, 'terminal-journal.jsonl'), 'utf8')).includes(secret), false, 'the journal file never holds a secret');
  }

  // Unlock opens the chat already unlocked; closing that terminal ends the access with it.
  const unlock = await runInTerminal(page, ['unlock'], { seconds: 20 });
  report('unlock', unlock);
  assert.equal(unlock.paired, true, 'unlock asks for the window\'s code');

  console.log(JSON.stringify({ result: 'passed' }));
} finally {
  await app.close();
}
// A pseudo-terminal closed in the middle of a session can keep this process alive.
process.exit(0);
