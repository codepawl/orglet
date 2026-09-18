import { _electron as electron } from 'playwright';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { useVietnamese } from './smoke-language.mjs';
import { packagedExecutable } from './packaged-executable.mjs';

// Sidebar editing: double-click rename, press-and-hold reorder, keyboard reorder, and persistence across restarts.
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

  // A single click on the name selects the row and opens or closes its children.
  const researcher = page.getByRole('button', { name: 'Researcher', exact: true });
  const wasOpen = await researcher.getAttribute('aria-expanded');
  await researcher.click();
  assert.notEqual(await researcher.getAttribute('aria-expanded'), wasOpen);
  await researcher.click();
  assert.equal(await researcher.getAttribute('aria-expanded'), wasOpen);

  // Double-click no longer edits a name; a worker is renamed in its edit dialog.
  await page.getByRole('button', { name: 'Researcher', exact: true }).dblclick();
  assert.equal(await page.locator('.row-rename').count(), 0);
  await page.getByRole('button', { name: 'Tùy chọn Researcher', exact: true }).click(); await page.getByRole('menuitem', { name: 'Chỉnh sửa' }).click();
  await page.getByLabel('Tên nhân viên').fill('Lead researcher'); await page.getByRole('button', { name: 'Lưu nhân viên', exact: true }).click();
  await waitFor(async () => (await workspace(page)).workers.some(worker => worker.name === 'Lead researcher'), 'worker rename');

  // Rename a task; leaving the field saves.
  const box = page.getByRole('textbox', { name: 'Nội dung công việc' });
  await page.getByRole('button', { name: 'Lead researcher', exact: true }).click();
  await box.fill('Một brief rất dài về việc review dataset'); await box.press('Enter');
  await page.locator('.chat-reply, .report').first().waitFor();
  const taskButton = page.getByRole('navigation', { name: 'Tất cả công việc' }).getByRole('button', { name: /^Một brief rất dài/ });
  await taskButton.dblclick();
  assert.equal(await page.locator('.row-rename').count(), 0);
  await page.getByRole('navigation', { name: 'Tất cả công việc' }).getByRole('button', { name: /^Tùy chọn công việc Một brief rất dài/ }).click(); await page.getByRole('menuitem', { name: 'Đổi tên' }).click();
  // Escape cancels.
  await page.getByRole('textbox', { name: /^Tên mới cho công việc/ }).fill('Discarded'); await page.keyboard.press('Escape');
  assert.equal((await workspace(page)).tasks[0].title, undefined);
  await page.getByRole('navigation', { name: 'Tất cả công việc' }).getByRole('button', { name: /^Tùy chọn công việc Một brief rất dài/ }).click(); await page.getByRole('menuitem', { name: 'Đổi tên' }).click();
  await page.getByRole('textbox', { name: /^Tên mới cho công việc/ }).fill('Review dataset'); await page.locator('.main-pane').click({ position: { x: 600, y: 400 } });
  await waitFor(async () => (await workspace(page)).tasks[0].title === 'Review dataset', 'task rename');

  // A task under a worker is only a link: no menu there, and opening it asks first unless the user opts out.
  await page.getByRole("button", { name: "Tạo nhân viên", exact: true }).focus();
  const disclosure = page.getByRole("button", { name: "Xem công việc của Lead researcher", exact: true });
  if (await disclosure.getAttribute("aria-expanded") !== "true") await disclosure.click();
  const nested = page.getByRole("group", { name: "Lead researcher", exact: true });
  assert.equal(await nested.getByRole("button", { name: /^Tùy chọn công việc/ }).count(), 0);
  await page.getByRole("button", { name: /Công việc mới/ }).first().click();
  await nested.getByRole("button", { name: /^Review dataset/ }).click();
  const ask = page.getByRole("dialog", { name: "Mở công việc này?" });
  await ask.getByRole("button", { name: "Không", exact: true }).click();
  assert.equal(await ask.count(), 0);
  await nested.getByRole("button", { name: /^Review dataset/ }).click();
  await ask.getByRole("button", { name: "Mở, không hỏi lại", exact: true }).click();
  await waitFor(async () => (await workspace(page)).confirmOpenTask === false, "opt out of the open confirmation");
  await nested.getByRole("button", { name: /^Review dataset/ }).click();
  assert.equal(await page.getByRole("dialog", { name: "Mở công việc này?" }).count(), 0);
  // Re-opening the task that is already shown keeps it on screen instead of waiting forever.
  await nested.getByRole("button", { name: /^Review dataset/ }).click();
  await page.locator(".chat-reply, .report").first().waitFor();
  assert.equal(await page.getByText("Đang mở công việc…").count(), 0);

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
