import { _electron as electron } from 'playwright';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { useVietnamese } from './smoke-language.mjs';
import { packagedExecutable } from './packaged-executable.mjs';

// Language setting: switch to English, check UI text, a translated core error and persistence, then switch back.
const directory = await mkdtemp(join(tmpdir(), 'orglet-i18n-'));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const launch = () => electron.launch({ executablePath: packagedExecutable(), args: [`--user-data-dir=${directory}`], env });
const errors = [];
// Records the title of the next native open dialog without showing it.
const dialogTitle = async (app, page) => {
  await app.evaluate(({ dialog }) => { globalThis.lastTitle = null; dialog.showOpenDialog = async (_window, options) => { globalThis.lastTitle = options.title; return { canceled: true, filePaths: [] }; }; });
  await page.evaluate(() => window.orglet.pickSources());
  return app.evaluate(() => globalThis.lastTitle);
};
let app = await launch();
try {
  let page = await app.firstWindow(); await page.setViewportSize({ width: 1400, height: 900 });
  page.on('pageerror', error => errors.push(error.message));
  assert.equal(await useVietnamese(page), 'en', 'a new install starts in US English');
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'vi');

  await page.getByRole('button', { name: /^Cài đặt/ }).click();
  await page.getByRole('combobox', { name: 'Ngôn ngữ', exact: true }).click();
  await page.getByRole('option', { name: 'English (US)', exact: true }).click();
  // The dialog re-renders in English once the dictionary chunk has loaded.
  await page.getByRole('combobox', { name: 'Language', exact: true }).waitFor();
  await page.getByRole('tab', { name: 'API connections', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
  await page.screenshot({ path: 'test-results/i18n-settings-en.png' });
  // Native dialogs follow the saved language straight away.
  assert.equal(await dialogTitle(app, page), 'Choose sources: text up to 256 KB; CSV, JSONL, Parquet up to 32 MB each');
  await page.keyboard.press('Escape');

  await page.getByRole('heading', { name: 'Chatting with Researcher' }).waitFor();
  // The starters themselves come from the worker's role, so this checks the one stable row in that list.
  await page.getByRole('button', { name: 'Schedule this message', exact: true }).waitFor();
  assert.ok(await page.locator('.suggestions button').count() > 1, 'the empty chat offers starters');
  for (const name of ['New team', 'New worker']) await page.getByRole('button', { name, exact: true }).first().waitFor();
  assert.equal(await page.getByRole('button', { name: 'New task', exact: true }).count(), 0);
  assert.equal(await page.getByRole('navigation', { name: 'All tasks' }).count(), 0);
  await page.getByRole('button', { name: /^Schedules/ }).click();
  await page.getByText('No schedules yet.', { exact: true }).waitFor();
  await page.keyboard.press('Escape');

  // Validation text in dialogs follows the language too.
  await page.getByRole('button', { name: 'New team', exact: true }).click();
  await page.getByRole('button', { name: 'Save team', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Enter a team name.' }).waitFor();
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'test-results/i18n-home-en.png' });

  // Persists across restarts.
  await app.close(); app = await launch(); page = await app.firstWindow(); await page.setViewportSize({ width: 1400, height: 900 });
  await page.getByRole('heading', { name: 'Chatting with Researcher' }).waitFor();
  assert.equal((await page.evaluate(() => window.orglet.call('workspace', {}))).language, 'en');
  assert.equal(await dialogTitle(app, page), 'Choose sources: text up to 256 KB; CSV, JSONL, Parquet up to 32 MB each', 'language is read at startup');
  // British English: same text with UK spellings.
  await page.getByRole('button', { name: /^Settings/ }).click();
  await page.getByRole('combobox', { name: 'Language', exact: true }).click();
  await page.getByRole('option', { name: 'English (UK)', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.lang === 'en-GB');
  await page.screenshot({ path: 'test-results/i18n-settings-gb.png' });
  await page.keyboard.press('Escape');
  // A UK check needs a word the two spellings differ on. The starters under the greeting come from the worker's
  // role and none of them carry one, so this uses the avatar picker's Customise, which is always there.
  await page.getByRole('button', { name: 'New worker', exact: true }).first().click();
  await page.getByRole('button', { name: 'Customise', exact: true }).waitFor();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /^Settings/ }).click();
  await page.getByRole('combobox', { name: 'Language', exact: true }).click();
  await page.getByRole('option', { name: 'Tiếng Việt', exact: true }).click();
  await page.getByRole('combobox', { name: 'Ngôn ngữ', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('heading', { name: 'Đang nhắn với Researcher' }).waitFor();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ directory, result: 'passed' }));
} finally { await app.close(); }
