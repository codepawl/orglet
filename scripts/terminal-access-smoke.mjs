// Packaged smoke for the decisions held for the person (docs/cli-held-actions-design.md): a held operation is locked
// with the token alone, the window shows a code the pipe never returns, the code typed back issues a key, the key
// opens the operation, and End now closes it again. The terminal's own prompt needs a real terminal, so this speaks
// the pipe directly and reads the code from the window, as the person would.
import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { createConnection } from 'node:net';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { label, useEnglish, openSettings } from './smoke-language.mjs';
import { packagedExecutable } from './packaged-executable.mjs';

const directory = await mkdtemp(join(tmpdir(), 'orglet-terminal-access-'));
const env = { ...process.env, ORGLET_SKIP_ACCOUNT_CHOICE: '1' };
delete env.ELECTRON_RUN_AS_NODE;
await mkdir('test-results', { recursive: true });

/** The same endpoint rule as apps/desktop/src/cli/protocol.ts, written out so the smoke checks the shipped behaviour. */
function endpoint(userData) {
  if (process.platform !== 'win32') return join(userData, 'cli.sock');
  const digest = createHash('sha256').update(win32.resolve(userData).toLowerCase()).digest('hex').slice(0, 16);
  return `\\\\.\\pipe\\orglet-cli-${digest}`;
}

function rawRequest(request) {
  return new Promise((resolveResponse, reject) => {
    const socket = createConnection(endpoint(directory), () => socket.write(`${JSON.stringify(request)}\n`));
    let received = '';
    socket.setEncoding('utf8');
    socket.on('data', chunk => { received += chunk; });
    socket.on('error', reject);
    socket.on('close', () => {
      try {
        resolveResponse(JSON.parse(received.split('\n').filter(Boolean)[0]));
      } catch (error) {
        reject(error);
      }
    });
  });
}

const app = await electron.launch({ executablePath: packagedExecutable(), args: [`--user-data-dir=${directory}`], env });
try {
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1200, height: 820 });
  await useEnglish(page);
  const token = (await readFile(join(directory, 'cli-token'), 'utf8')).trim();
  const heldRequest = { action: 'test', what: 'web-search' };

  const lockedAtFirst = await rawRequest({ op: 'held', token, request: heldRequest });
  assert.equal(lockedAtFirst.code, 'locked', 'the token alone does not reach a held operation');

  const started = await rawRequest({ op: 'pair-start', token, scope: 'decisions' });
  assert.equal(started.ok, true);
  assert.equal(JSON.stringify(started).includes('code'), false, 'the answer to pair-start does not carry the code');
  const second = await rawRequest({ op: 'pair-start', token, scope: 'decisions' });
  assert.equal(second.ok, false, 'a second pairing does not replace the one on screen');

  const dialog = page.locator('.terminal-pairing-dialog');
  await dialog.waitFor();
  assert.equal(await dialog.getByRole('button').count(), 1, 'the dialog has Cancel and no way to allow by a click');
  const shownCode = (await dialog.locator('.terminal-pairing-code').innerText()).replace(/[^A-Z0-9]/g, '');
  assert.equal(shownCode.length, 8);
  await page.screenshot({ path: 'test-results/terminal-pairing.png' });

  const wrongCode = shownCode.startsWith('A') ? `B${shownCode.slice(1)}` : `A${shownCode.slice(1)}`;
  const wrong = await rawRequest({ op: 'pair-finish', token, pairingId: started.value.pairingId, code: wrongCode });
  assert.equal(wrong.ok, false, 'a wrong code issues nothing');
  const finished = await rawRequest({ op: 'pair-finish', token, pairingId: started.value.pairingId, code: shownCode });
  assert.equal(finished.ok, true, 'the code the window shows issues a key');
  const key = finished.value.key;
  await dialog.waitFor({ state: 'detached' });
  await page.locator('.terminal-access-mark').waitFor();

  const wrongKey = await rawRequest({ op: 'held', token, elevation: key.replace(/^./, key.startsWith('0') ? '1' : '0'), request: heldRequest });
  assert.equal(wrongKey.code, 'locked', 'another key stays locked');
  const opened = await rawRequest({ op: 'held', token, elevation: key, request: heldRequest });
  assert.notEqual(opened.code, 'locked', 'the key opens the held operation');
  assert.equal(JSON.stringify(opened).includes(key), false, 'no answer repeats the key');

  await openSettings(page);
  await page.getByRole('tab', { name: label('Dữ liệu'), exact: true }).click();
  await page.locator('.terminal-journal-row').first().waitFor();
  assert.equal((await page.locator('.terminal-journal').innerText()).includes(key), false, 'the journal never holds the key');
  await page.locator('.terminal-journal').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/terminal-journal.png' });
  await page.keyboard.press('Escape');

  const ended = await rawRequest({ op: 'elevation-end', token });
  assert.equal(ended.ok, true);
  const lockedAgain = await rawRequest({ op: 'held', token, elevation: key, request: heldRequest });
  assert.equal(lockedAgain.code, 'locked', 'End now closes the key');
  await page.locator('.terminal-access-mark').waitFor({ state: 'detached' });
  console.log(JSON.stringify({ result: 'passed', checks: ['locked with the token alone', 'code only in the window', 'wrong code and wrong key refused', 'key opens a held operation', 'journal row without the key', 'End now locks again'] }));
} finally {
  await app.close();
}
