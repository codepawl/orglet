import { _electron as electron } from 'playwright';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { useVietnamese, openThreadByBrief } from './smoke-language.mjs';
import { packagedExecutable } from './packaged-executable.mjs';

const directory = await mkdtemp(join(tmpdir(), 'orglet-knowledge-'));
const env = { ...process.env, APPDATA: directory }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: packagedExecutable(), args: [`--user-data-dir=${directory}`], env });
let closed = false; app.once('close', () => { closed = true; });
const workspace = page => page.evaluate(() => window.orglet.call('workspace', {}));
try {
  const page = await app.firstWindow();
  await useVietnamese(page);
  await page.evaluate(() => window.orglet.call('createTemplate', { templateId: 'research-review', provider: 'demo' }));
  await page.getByRole('button', { name: 'Research Review', exact: true }).waitFor();
  const team = (await workspace(page)).teams.find(item => item.name === 'Research Review');

  // Author a team note through the library UI.
  await page.getByRole('button', { name: /^Thư viện/ }).click();
  await page.getByRole('tab', { name: 'Knowledge', exact: true }).click();
  await page.getByRole('button', { name: 'Tạo knowledge', exact: true }).click();
  await page.getByRole('textbox', { name: 'Tiêu đề', exact: true }).fill('Evidence limits');
  await page.getByRole('textbox', { name: 'Nội dung', exact: true }).fill('State which claims lack a cited source before summarizing.');
  await page.getByRole('textbox', { name: 'Tags', exact: true }).fill('evidence, review');
  await page.getByRole('combobox', { name: 'Phạm vi', exact: true }).click(); await page.getByRole('option', { name: team.name, exact: true }).click();
  await page.getByRole('checkbox', { name: /Luôn nạp/ }).check();
  await page.getByRole('button', { name: 'Lưu knowledge', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  const [note] = (await workspace(page)).knowledge;
  assert.deepEqual({ status: note.status, tags: note.tags, pinned: note.pinned, scope: note.scope }, { status: 'approved', tags: ['evidence', 'review'], pinned: true, scope: { type: 'team', id: team.id } });

  // Template transfer carries the team note as a proposal that needs local review.
  const templatePath = join(directory, 'team.json');
  await app.evaluate(({ dialog }, path) => { globalThis.originalSave = dialog.showSaveDialog; globalThis.originalOpen = dialog.showOpenDialog; dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, templatePath);
  assert.equal(await page.evaluate(id => window.orglet.exportTemplate(id), team.id), true);
  const imported = await page.evaluate(() => window.orglet.importTemplate());
  await page.getByRole('button', { name: /Thư viện\s*Cần duyệt/ }).waitFor();
  await page.getByRole('button', { name: /Thư viện/ }).click();
  await page.getByRole('region', { name: 'Chờ duyệt' }).getByRole('button', { name: /Evidence limits/ }).click();
  await page.getByText('Nhập từ template nhóm · v1 · Chờ duyệt').waitFor();
  await page.getByRole('button', { name: 'Duyệt', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  const approved = (await workspace(page)).knowledge.find(item => item.scope.type === 'team' && item.scope.id === imported.id);
  assert.equal(approved.status, 'approved'); assert.equal(approved.revision, 2);
  assert.equal(await page.getByRole('button', { name: /Thư viện\s*Cần duyệt/ }).count(), 0);

  // Keyword search reaches FTS in core.
  await page.getByRole('button', { name: /Thư viện/ }).click();
  await page.getByRole('tab', { name: 'Knowledge', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Tìm knowledge' }).fill('summariz');
  await page.getByRole('region', { name: 'Đã duyệt' }).getByText('Đã duyệt (2)').waitFor();
  await page.getByRole('searchbox', { name: 'Tìm knowledge' }).fill('nothingmatches');
  await page.getByText('Không có mục khớp.').waitFor();
  await page.keyboard.press('Escape');

  // A run in the imported team freezes and shows which note it loaded.
  const taskId = await page.evaluate(async team => window.orglet.call('createTask', { workerId: team.synthesizerId, teamId: team.id, brief: 'Knowledge context fixture', sourceIds: [], consent: false, budgetMicros: 1000 }), imported);
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = await page.evaluate(id => window.orglet.call('task', { id }), taskId);
    if (state.task.status === 'completed') break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const detail = await page.evaluate(id => window.orglet.call('task', { id }), taskId);
  assert.equal(detail.task.status, 'completed');
  for (const run of detail.runs) assert.deepEqual(run.snapshot.context.knowledge.map(item => [item.id, item.revision]), [[approved.id, 2]]);
  await openThreadByBrief(page, 'Knowledge context fixture');
  await page.getByRole('button', { name: 'Chi tiết', exact: true }).click();
  // The context manifest is machine detail, so it sits inside the collapsed technical block.
  await page.locator('.details-technical > summary').click();
  await page.getByText(/Context đã nạp/).first().click();
  await page.getByText('Knowledge: Evidence limits · v2', { exact: false }).first().waitFor();
  // Templates reuse the same text for team instructions and the skill; the manifest shows the duplicate was dropped.
  await page.getByText('Kỹ năng · v1 · trùng nội dung đã nạp').first().waitFor();

  await page.setViewportSize({ width: 760, height: 700 });
  const overflow = await page.evaluate(() => { const drawer = document.querySelector('.drawer-body'); return drawer ? drawer.scrollWidth - drawer.clientWidth : 0; });
  assert.ok(overflow <= 1, `drawer overflow ${overflow}`);
  await app.evaluate(({ dialog }) => { dialog.showSaveDialog = globalThis.originalSave; dialog.showOpenDialog = globalThis.originalOpen; });
  console.log(JSON.stringify({ directory, taskId, knowledge: (await workspace(page)).knowledge.length, result: 'passed' }));
  if (process.argv.includes('--inspect-ui')) await new Promise(resolve => app.once('close', resolve));
} finally { if (!closed) await app.close(); }
