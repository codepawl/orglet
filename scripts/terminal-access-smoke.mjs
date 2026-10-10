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
const env = { ...process.env, ORGLET_SKIP_ACCOUNT_CHOICE: '1', ORGLET_DEMO_REPLIES: '1' };
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

  // Stage C: a one-shot pairing for a folder grant on a temp folder, applied, listed, noticed and undone from Settings.
  // The chat needs a row for Undo, so one demo turn is sent first (the demo switch is on for this smoke only).
  const listed = await rawRequest({ op: 'list', token });
  const orgletName = listed.value.orglets[0].name;
  const sent = await rawRequest({ op: 'send', token, to: orgletName, message: 'hello', files: [], wait: true, timeoutSeconds: 30 });
  assert.equal(sent.ok, true, 'the demo turn gives the chat a row');
  const folder = await mkdtemp(join(tmpdir(), 'orglet-grant-folder-'));
  const grant = { action: 'folder', to: orgletName, path: folder, permissions: ['read'] };
  assert.equal((await rawRequest({ op: 'held', token, request: grant })).code, 'locked', 'a grant is locked with the token alone');
  // The last held operations: a skill is not trusted, and a server is not saved, with the token alone.
  assert.equal((await rawRequest({ op: 'held', token, request: { action: 'skill-review', skill: 'Helper', hash: 'b'.repeat(64) } })).code, 'locked', 'trusting a skill package is locked with the token alone');
  const serverDraft = { name: 'Notes', enabled: true, transport: { kind: 'stdio', command: 'npx', args: [], env: [{ name: 'API_KEY' }] } };
  assert.equal((await rawRequest({ op: 'held', token, request: { action: 'mcp-save', servers: [serverDraft], secrets: { Notes: { API_KEY: 'x' } } } })).code, 'locked', 'saving an MCP server is locked with the token alone');
  const grantPairing = await rawRequest({ op: 'pair-start', token, scope: 'one', operation: grant });
  assert.equal(grantPairing.ok, true);
  await dialog.waitFor();
  assert.ok((await dialog.innerText()).includes(folder), 'the dialog says the folder in words before any code is typed');
  const grantCode = (await dialog.locator('.terminal-pairing-code').innerText()).replace(/[^A-Z0-9]/g, '');
  const grantKey = (await rawRequest({ op: 'pair-finish', token, pairingId: grantPairing.value.pairingId, code: grantCode })).value.key;
  const otherFolder = await rawRequest({ op: 'held', token, elevation: grantKey, request: { ...grant, path: await mkdtemp(join(tmpdir(), 'orglet-other-')) } });
  assert.equal(otherFolder.code, 'locked', 'a key made for one folder does not open another');
  const granted = await rawRequest({ op: 'held', token, elevation: grantKey, request: grant });
  assert.equal(granted.ok, true, 'the matching key applies the grant');
  assert.equal((await rawRequest({ op: 'held', token, elevation: grantKey, request: grant })).code, 'locked', 'a one key is spent');
  const refusedRoot = await rawRequest({ op: 'pair-start', token, scope: 'setup' });
  const rootCode = (await dialog.locator('.terminal-pairing-code').innerText()).replace(/[^A-Z0-9]/g, '');
  const setupKey = (await rawRequest({ op: 'pair-finish', token, pairingId: refusedRoot.value.pairingId, code: rootCode })).value.key;
  const dataFolderGrant = await rawRequest({ op: 'held', token, elevation: setupKey, request: { ...grant, path: directory } });
  assert.equal(dataFolderGrant.ok, false, 'the data folder cannot be granted from a terminal');

  // Stage D: a web search key saved through an elevated request is in no answer and no journal row.
  const secret = 'exa-smoke-SECRET-0123456789';
  const saved = await rawRequest({ op: 'held', token, elevation: setupKey, request: { action: 'search-key', provider: 'exa', secret } });
  assert.equal(saved.ok, true, 'the key is saved');
  assert.equal(JSON.stringify(saved).includes(secret), false, 'no answer repeats the key');
  const refusedWithoutKey = await rawRequest({ op: 'held', token, request: { action: 'search-key', provider: 'exa', secret } });
  assert.equal(refusedWithoutKey.code, 'locked');
  assert.equal(JSON.stringify(refusedWithoutKey).includes(secret), false);
  assert.equal((await readFile(join(directory, 'terminal-journal.jsonl'), 'utf8')).includes(secret), false, 'the journal never holds the key');
  await rawRequest({ op: 'elevation-end', token });

  const grantWords = 'Let a chat work in a folder';
  // The grant's notice is in the window's list of what finished: Activity, Done.
  await page.locator(`.area-tile[data-name="${label('Hoạt động')}"]`).click();
  await page.locator('.sidebar').getByRole('button', { name: new RegExp('^' + label('Xong')) }).first().click();
  await page.getByText(grantWords).first().waitFor();
  assert.ok((await page.locator('.page-body').innerText()).includes(label('chỉ đọc')), 'the level is said in the app language');
  await openSettings(page);
  await page.getByRole('tab', { name: label('Dữ liệu'), exact: true }).click();
  // The row of the grant that was applied, not the refused one for the data folder above it.
  const grantRow = page.locator('.terminal-journal-row', { hasText: folder }).first();
  await grantRow.waitFor();
  assert.equal(await page.locator('.terminal-journal').innerText().then(text => text.includes(secret)), false, 'Settings never shows the key');
  await page.locator('.terminal-journal').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/terminal-grant-journal.png' });
  await grantRow.getByRole('button', { name: label('Hoàn tác') }).click();
  await grantRow.getByText(label('Đã hoàn tác')).waitFor();
  await page.keyboard.press('Escape');
  console.log(JSON.stringify({ result: 'passed', checks: ['locked with the token alone', 'code only in the window', 'wrong code and wrong key refused', 'key opens a held operation', 'journal row without the key', 'End now locks again', 'folder grant: dialog words, matching key only, spent once, data folder refused, noticed, undone from Settings', 'web search key saved and absent from answers, journal and Settings'] }));
} finally {
  await app.close();
}
