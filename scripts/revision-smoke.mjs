import { _electron as electron } from 'playwright';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const directory = await mkdtemp(join(tmpdir(), 'orglet-revision-'));
const env = { ...process.env, APPDATA: directory }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: resolve('out/Orglet-win32-x64/Orglet.exe'), args: [`--user-data-dir=${directory}`], env });
let closed = false; app.once('close', () => { closed = true; });
try {
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: 'Bạn muốn giao việc gì?' }).waitFor();
  const original = join(directory, 'original.csv'), added = join(directory, 'supplement.csv');
  await writeFile(original, 'id,label\n1,old\n'); await writeFile(added, 'id,label\n2,new\n3,new\n');
  await app.evaluate(({ dialog }, path) => { globalThis.originalOpen = dialog.showOpenDialog; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, original);
  await page.getByRole('button', { name: 'Tạo nhóm', exact: true }).click();
  await page.getByRole('button', { name: 'Eris Review', exact: true }).click();
  const id = await page.evaluate(async () => {
    const sources = await window.orglet.pickSources(); const workspace = await window.orglet.call('workspace', {}); const team = workspace.teams.find(team => team.name === 'Eris Review');
    return window.orglet.call('createTask', { workerId: team.synthesizerId, teamId: team.id, brief: 'Revision UI fixture', sourceIds: sources.map(source => source.id), consent: false, budgetMicros: 1000 });
  });
  await page.getByRole('button', { name: /^Revision UI fixture/ }).click();
  // The follow-up bar's add button is enabled once the run has finished.
  await page.locator('button[aria-label="Đính kèm tệp"]:not([disabled])').waitFor();
  const before = await page.evaluate(id => window.orglet.call('task', { id }), id);
  assert.equal(before.artifacts.length, 4);
  assert.equal(before.task.status, 'waiting_input');
  await page.getByText('Chờ bổ sung bằng chứng. Đính kèm thêm nguồn để kiểm tra lại, hoặc chấp nhận báo cáo cùng các giới hạn đã nêu.', { exact: true }).waitFor();
  await page.locator('.report-file').last().click();
  await page.getByRole('button', { name: 'Ghi nhận giới hạn', exact: true }).click();
  await page.keyboard.press('Escape');
  assert.equal((await page.evaluate(id => window.orglet.call('task', { id }), id)).task.status, 'waiting_input');
  assert.equal(await page.getByRole('button', { name: 'Thử lại với thiết lập hiện tại', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Đính kèm tệp', exact: true }).click();
  await page.getByRole('textbox', { name: /Tin nhắn/ }).fill('Review supplemented evidence from UI');
  await page.getByRole('button', { name: 'Bỏ nguồn original.csv', exact: true }).click();
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, added);
  await page.getByRole('button', { name: 'Bổ sung tệp', exact: true }).click();
  await page.getByRole('button', { name: 'Bỏ nguồn supplement.csv', exact: true }).waitFor();
  await page.getByText('Giới hạn này tính cả các tin nhắn trước.', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Gửi tin nhắn', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = await page.evaluate(id => window.orglet.call('task', { id }), id);
    if (state.task.inputRevision === 1 && state.task.status === 'waiting_input') break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const after = await page.evaluate(id => window.orglet.call('task', { id }), id);
  assert.equal(after.task.inputRevision, 1); assert.equal(after.task.brief, before.task.brief);
  assert.equal(after.task.status, 'waiting_input');
  assert.equal(after.task.currentInput.brief, 'Review supplemented evidence from UI');
  assert.equal(after.task.currentInput.sourceIds.length, 1); assert.equal(after.task.sourceIds.length, 2);
  assert.equal(after.preflights.length, 2);
  for (const artifact of before.artifacts) assert.deepEqual(after.artifacts.find(row => row.id === artifact.id), artifact);
  assert.equal(after.runs.filter(run => run.snapshot.inputRevision === 1).length, 4);
  for (const run of after.runs.filter(run => run.snapshot.inputRevision === 1)) assert.deepEqual(run.snapshot.input.sourceIds, after.task.currentInput.sourceIds);
  // Both messages stay in one thread; only the latest report can be accepted.
  await page.getByText('Review supplemented evidence from UI', { exact: true }).waitFor();
  assert.equal(await page.locator('.report-file', { hasText: 'Báo cáo mẫu' }).count(), 2);
  // Only the latest report can be accepted.
  await page.locator('.report-file').first().click();
  assert.equal(await page.getByRole('button', { name: 'Chấp nhận báo cáo', exact: true }).count(), 0);
  await page.keyboard.press('Escape');
  await page.locator('.report-file').last().click();
  assert.equal(await page.getByRole('button', { name: 'Chấp nhận báo cáo', exact: true }).count(), 1);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Đính kèm tệp', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: /Tin nhắn/ }).inputValue(), '');
  assert.equal(await page.getByRole('button', { name: 'Bỏ nguồn original.csv', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Bỏ nguồn supplement.csv', exact: true }).waitFor();
  await app.evaluate(({ dialog }) => { dialog.showOpenDialog = globalThis.originalOpen; });
  console.log(JSON.stringify({ directory, taskId: id, revision: 1, artifacts: 8, preflights: 2, result: 'passed' }));
  if (process.argv.includes('--inspect-ui')) await new Promise(resolve => app.once('close', resolve));
} finally { if (!closed) await app.close(); }



