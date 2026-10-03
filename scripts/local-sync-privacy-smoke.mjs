import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { en } from '../apps/desktop/src/shared/locales/en.ts';
import { packagedExecutable } from './packaged-executable.mjs';
import { isolatedHarnessEnvironment } from './fake-harnesses.mjs';
import { useVietnamese, openHome, openThreadByBrief } from './smoke-language.mjs';

// Real packaged renderer → preload → core → SQLite. The throwaway profile uses Demo only.
const directory = await mkdtemp(join(tmpdir(), 'orglet-local-sync-ui-'));
const { env } = await isolatedHarnessEnvironment(directory);
const output = 'test-results/local-sync-privacy';
await mkdir(output, { recursive: true });
const launch = () => electron.launch({ executablePath: packagedExecutable(), args: [`--user-data-dir=${directory}`], env });
const call = (page, command, input) => page.evaluate(({ command, input }) => window.orglet.call(command, input), { command, input });
const workspace = page => call(page, 'workspace', {});
const waitFinished = (page, id) => page.waitForFunction(async id => {
  const detail = await window.orglet.call('task', { id });
  return ['completed', 'partial', 'failed', 'cancelled'].includes(detail.task.status);
}, id);
async function capture(page, name) {
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
    .map(animation => animation.finished.catch(() => undefined))));
  const geometry = await page.locator('[role="dialog"]').evaluate(dialog => {
    const row = dialog.querySelector('.org-switch-field');
    const control = row.querySelector('[role="switch"]').getBoundingClientRect();
    const text = row.querySelector('.org-switch-field-text').getBoundingClientRect();
    const box = row.getBoundingClientRect();
    return { centreDifference: Math.abs(control.y + control.height / 2 - text.y - text.height / 2), clipped: control.right > box.right || text.right > control.left, overflow: dialog.scrollWidth > dialog.clientWidth };
  });
  assert.ok(geometry.centreDifference <= 1, `${name}: switch aligns with its text block`);
  assert.equal(geometry.clipped, false, `${name}: text and switch have separate space`);
  assert.equal(geometry.overflow, false, `${name}: dialog fits`);
  await page.screenshot({ path: `${output}/${name}.png`, animations: 'disabled' });
}
async function chatSettings(page) {
  await page.getByRole('button', { name: 'Tùy chọn cuộc trò chuyện', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Thiết lập chat', exact: true }).click();
}
let app = await launch();
let page;
try {
  page = await app.firstWindow();
  page.on('pageerror', error => console.log('Privacy renderer error:', error.message));
  page.on('console', message => { if (message.type() === 'error') console.log('Privacy renderer console:', message.text()); });
  await page.evaluate(() => {
    window.__privacyChangeCount = 0;
    window.orglet.onChange(() => { window.__privacyChangeCount++; });
  });
  page.setDefaultTimeout(30_000);
  await page.setViewportSize({ width: 1200, height: 820 });
  await useVietnamese(page);
  const worker = (await workspace(page)).workers.find(worker => worker.provider === 'demo');
  assert.ok(worker);
  await openHome(page);
  await page.getByRole('button', { name: 'Bạn bè', exact: true }).first().click();
  await page.getByRole('tab', { name: /^Tất cả/ }).click();
  await page.locator('.friend-row').filter({ hasText: worker.name }).first().getByRole('button', { name: `Tùy chọn ${worker.name}`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Chỉnh sửa', exact: true }).click();
  const privacy = page.getByRole('switch', { name: 'Chỉ trên máy này', exact: true });
  await privacy.focus();
  await page.keyboard.press('Space');
  assert.equal(await privacy.getAttribute('aria-checked'), 'true');
  await capture(page, 'worker-private-vi-light-wide');
  await page.getByRole('button', { name: 'Lưu Tí', exact: true }).click();
  await page.waitForFunction(async id => (await window.orglet.call('workspace', {})).syncLocalOnly.workers.includes(id), worker.id);
  await call(page, 'setSyncLocalOnly', { kind: 'worker', id: worker.id, localOnly: false });
  const brief = 'Privacy smoke main chat';
  const taskId = await call(page, 'createTask', { workerId: worker.id, brief, sourceIds: [], consent: false, budgetMicros: 1000 });
  await waitFinished(page, taskId);
  await openThreadByBrief(page, brief);
  await chatSettings(page);
  await privacy.focus();
  await page.keyboard.press('Space');
  await capture(page, 'chat-private-vi-light-wide');
  await page.getByRole('button', { name: 'Lưu chat', exact: true }).click();
  await page.waitForFunction(async id => (await window.orglet.call('workspace', {})).syncLocalOnly.tasks.includes(id), taskId);
  const sideId = await call(page, 'startSideThread', { taskId, brief: 'Privacy smoke side chat', sourceIds: [], consent: false, providerScopes: [], budgetMicros: 1000 });
  await waitFinished(page, sideId);
  await openThreadByBrief(page, 'Privacy smoke side chat');
  // Wide windows open the side thread beside its main chat; narrow windows use the main pane.
  const sideSettings = page.locator('.thread-pane').getByRole('button', { name: 'Thiết lập chat', exact: true });
  if (await sideSettings.isVisible()) await sideSettings.click();
  else await chatSettings(page);
  assert.equal(await privacy.isDisabled(), true);
  assert.equal(await privacy.getAttribute('aria-checked'), 'true');
  assert.equal(await page.locator('.thread-pane').count(), 1, 'the settings dialog keeps one side-thread panel');
  await capture(page, 'side-inherited-vi-light-wide');
  for (const language of ['vi', 'en']) {
    for (const theme of ['light', 'dark']) {
      for (const [size, viewport] of [['wide', { width: 1200, height: 820 }], ['narrow', { width: 740, height: 600 }]]) {
        const state = await workspace(page);
        console.log(`Appearance: ${language}/${theme}/${size}`);
        await call(page, 'settings', { language, theme, connectionLimitMicros: state.connectionLimitMicros });
        await page.setViewportSize(viewport);
        const label = language === 'vi' ? 'Chỉ trên máy này' : en['Chỉ trên máy này'];
        await page.getByRole('switch', { name: label, exact: true }).waitFor();
        await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
        assert.equal(await page.locator('.thread-pane').count(), 1, 'appearance refresh does not duplicate the side-thread panel');
        await capture(page, `side-inherited-${language}-${theme}-${size}`);
      }
    }
  }
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  await useVietnamese(page);
  const restored = await workspace(page);
  assert.ok(restored.syncLocalOnly.tasks.includes(taskId), 'chat privacy persists after restart');
  assert.ok(restored.syncLocalOnly.inheritedTasks.includes(sideId), 'side thread still inherits its parent privacy');
  assert.equal(restored.syncLocalOnly.workers.includes(worker.id), false, 'independent worker choice also persists');
  const backupPath = join(directory, 'local-recovery.json');
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    dialog.showMessageBox = async (_window, options) => {
      if (options.type === 'error') throw new Error(options.message);
      return { response: 1, checkboxChecked: false };
    };
  }, backupPath);
  assert.equal(await page.evaluate(() => window.orglet.backup()), true);
  await call(page, 'deleteTask', { id: taskId });
  assert.equal(await page.evaluate(() => window.orglet.restore()), true);
  await page.waitForFunction(async id => (await window.orglet.call('workspace', {})).syncLocalOnly.permanentTasks.includes(id), taskId);
  await openThreadByBrief(page, brief);
  await chatSettings(page);
  const recoveredPrivacy = page.getByRole('switch', { name: 'Chỉ trên máy này', exact: true });
  assert.equal(await recoveredPrivacy.isDisabled(), true, 'explicit local recovery cannot reopen the permanently deleted public scope');
  assert.equal(await recoveredPrivacy.getAttribute('aria-checked'), 'true');
  await page.setViewportSize({ width: 740, height: 600 });
  await capture(page, 'permanent-private-vi-dark-narrow');
  await call(page, 'settings', { language: 'en', theme: 'light', connectionLimitMicros: restored.connectionLimitMicros });
  await page.setViewportSize({ width: 1200, height: 820 });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await page.getByRole('switch', { name: en['Chỉ trên máy này'], exact: true }).waitFor();
  await capture(page, 'permanent-private-en-light-wide');
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  await useVietnamese(page);
  assert.ok((await workspace(page)).syncLocalOnly.permanentTasks.includes(taskId), 'the public deletion fence persists after local recovery and restart');
  console.log('Local sync privacy: keyboard save, side-thread inheritance, restart, eight appearance layouts and two permanent-recovery layouts passed.');
} catch (error) {
  console.log('Appearance failure state:', await page?.evaluate(async () => {
    const state = await window.orglet.call('workspace', {});
    return { renderedTheme: document.documentElement.dataset.theme, savedTheme: state.theme, language: state.language,
      changes: window.__privacyChangeCount, alerts: [...document.querySelectorAll('[role="alert"]')].map(element => element.textContent) };
  }).catch(() => undefined));
  await page?.screenshot({ path: `${output}/failure.png` }).catch(() => undefined);
  throw error;
} finally {
  await app.close().catch(() => undefined);
}
