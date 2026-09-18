import { _electron as electron } from 'playwright';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { useVietnamese } from './smoke-language.mjs';
import { packagedExecutable } from './packaged-executable.mjs';

// Sidebar: worker click opens chat, press-and-hold reorder, keyboard reorder, persistence across restarts.
const directory = await mkdtemp(join(tmpdir(), 'orglet-sidebar-'));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const launch = () => electron.launch({ executablePath: packagedExecutable(), args: [`--user-data-dir=${directory}`], env });
const workspace = page => page.evaluate(() => window.orglet.call('workspace', {}));
const waitFor = async (check, label) => { for (let i = 0; i < 50; i++) { if (await check()) return; await new Promise(r => setTimeout(r, 100)); } throw new Error(`Timed out: ${label}`); };
let app = await launch();
try {
  let page = await app.firstWindow(); await page.setViewportSize({ width: 1400, height: 900 });
  await useVietnamese(page);
  await page.evaluate(() => window.orglet.call('createTemplate', { templateId: 'research-review', provider: 'demo' }));
  await page.getByRole('button', { name: 'Research Review', exact: true }).waitFor();
  await page.evaluate(() => window.orglet.call('createTemplate', { templateId: 'eris-review', provider: 'demo' }));
  await page.getByRole('button', { name: 'Eris Review', exact: true }).waitFor();

  // Clicking a worker name opens that worker's chat. There is no task-list disclosure.
  const researcher = page.getByRole('button', { name: 'Researcher', exact: true });
  assert.equal(await researcher.getAttribute('aria-expanded'), null);
  await researcher.click();
  await page.getByRole('heading', { name: 'Đang nhắn với Researcher' }).waitFor();
  assert.equal(await researcher.getAttribute('aria-expanded'), null);

  // Double-click no longer edits a name; a worker is renamed in its edit dialog.
  await page.getByRole('button', { name: 'Researcher', exact: true }).dblclick();
  assert.equal(await page.locator('.row-rename').count(), 0);
  await page.getByRole('button', { name: 'Tùy chọn Researcher', exact: true }).click(); await page.getByRole('menuitem', { name: 'Chỉnh sửa' }).click();
  await page.getByLabel('Tên nhân viên').fill('Lead researcher'); await page.getByRole('button', { name: 'Lưu nhân viên', exact: true }).click();
  await waitFor(async () => (await workspace(page)).workers.some(worker => worker.name === 'Lead researcher'), 'worker rename');

  const box = page.getByRole('textbox', { name: 'Tin nhắn' });
  await page.getByRole('button', { name: 'Lead researcher', exact: true }).click();
  await box.fill('Một brief rất dài về việc review dataset'); await box.press('Enter');
  await page.locator('.chat-reply, .report').first().waitFor();
  await page.getByRole('button', { name: 'Tùy chọn cuộc trò chuyện', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Chỉnh sửa' }).click();
  await page.getByLabel('Tên công việc').fill('Review dataset');
  await page.getByRole('button', { name: 'Lưu công việc', exact: true }).click();
  await waitFor(async () => (await workspace(page)).tasks[0].title === 'Review dataset', 'thread rename');
  assert.equal(await page.getByRole('navigation', { name: 'Tất cả công việc' }).count(), 0);

  // Press and hold a worker, drag it to the top.
  const before = (await workspace(page)).workers.map(worker => worker.name);
  const last = before.at(-1);
  const source = page.getByRole('button', { name: last, exact: true });
  const topRow = page.getByRole('button', { name: before[0], exact: true });
  const from = await source.boundingBox(), to = await topRow.boundingBox();
  await page.mouse.move(from.x + 40, from.y + from.height / 2); await page.mouse.down();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.tree-item.dragging').count(), 1, 'held row is lifted');
  await page.locator('.tree-item.dragging .lucide-grip-vertical').waitFor();
  for (let step = 1; step <= 10; step++) await page.mouse.move(from.x + 40, from.y + from.height / 2 + (to.y - from.y - 6) * step / 10);
  await page.screenshot({ path: 'test-results/sidebar-dragging.png', clip: { x: 0, y: 0, width: 260, height: 900 } });
  await page.mouse.up();
  await waitFor(async () => (await workspace(page)).workers[0].name === last, 'drag reorder');
  assert.equal(await page.locator('.tree-item.dragging').count(), 0);

  // Keyboard: Alt+ArrowDown moves the first team down.
  const teams = (await workspace(page)).teams.map(team => team.name);
  await page.getByRole('button', { name: teams[0], exact: true }).focus(); await page.keyboard.press('Alt+ArrowDown');
  await waitFor(async () => (await workspace(page)).teams[0].name === teams[1], 'keyboard reorder');

  const saved = await workspace(page);
  await app.close(); app = await launch(); page = await app.firstWindow();
  await useVietnamese(page);
  const reopened = await workspace(page);
  assert.deepEqual(reopened.workers.map(worker => worker.id), saved.workers.map(worker => worker.id));
  assert.deepEqual(reopened.teams.map(team => team.id), saved.teams.map(team => team.id));
  assert.equal(reopened.tasks[0].title, 'Review dataset');
  console.log(JSON.stringify({ directory, workers: reopened.workers.map(worker => worker.name), teams: reopened.teams.map(team => team.name), result: 'passed' }));
} finally { await app.close(); }
