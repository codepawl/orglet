import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { useVietnamese, openThreadByBrief } from './smoke-language.mjs';
import { packagedExecutable } from './packaged-executable.mjs';
const directory = await mkdtemp(join(tmpdir(), 'orglet-package-'));
const env = { ...process.env, APPDATA: directory }; delete env.ELECTRON_RUN_AS_NODE;
let closed = false;
const launch = async data => {
  const instance = await electron.launch({ executablePath: packagedExecutable(), args: [`--user-data-dir=${data}`], env });
  closed = false; instance.once('close', () => { closed = true; }); return instance;
};
let app = await launch(directory);
try {
  const userData = await app.evaluate(({ app }) => app.getPath('userData'));
  assert.ok(userData.toLowerCase().startsWith(directory.toLowerCase()), 'Packaged smoke requires isolated APPDATA');
  let page = await app.firstWindow(); await useVietnamese(page);
  const csv = join(directory, 'sample.csv'); await writeFile(csv, 'id,label\n1,alpha\n2,beta\n2,gamma\n');
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, csv);
  const result = await page.evaluate(async () => {
    const sources = await window.orglet.pickSources(); const workspace = await window.orglet.call('workspace', {});
    const id = await window.orglet.call('createTask', { workerId: workspace.workers[0].id, brief: 'Packaged native checker fixture', sourceIds: sources.map(s => s.id), consent: false, budgetMicros: 1000 });
    const profile = await window.orglet.call('profileSources', { taskId: id, sourceIds: [sources[0].id], idColumn: 'id' });
    return { id, profile };
  });
  assert.equal(result.profile.datasets[0].rows, 3); assert.equal(result.profile.datasets[0].id.duplicateNonNull, 1);
  await page.evaluate(() => window.orglet.call('createTemplate', { templateId: 'eris-review', provider: 'demo' }));
  await page.getByRole('button', { name: 'Tùy chọn hội Eris Review', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Tùy chọn hội Eris Review', exact: true }).click(); await page.getByRole('menuitem', { name: 'Chỉnh sửa' }).click();
  await page.getByRole('tab', { name: 'Checklist', exact: true }).click();
  assert.equal(await page.getByLabel(/^Tên mục \d+$/).count(), 5);
  await page.getByLabel('Tên mục 1', { exact: true }).fill('Mục tiêu và GPU relevance');
  await page.getByRole('button', { name: 'Thêm mục kiểm tra', exact: true }).click();
  await page.getByLabel('Tên mục 6', { exact: true }).fill('Mục tiêu và GPU relevance');
  await page.getByRole('button', { name: 'Lưu hội', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'không để trống hoặc trùng tên' }).waitFor();
  await page.getByRole('button', { name: 'Bỏ mục 6', exact: true }).click();
  assert.equal(await page.getByRole('combobox', { name: 'Bằng chứng cho mục 5', exact: true }).getAttribute('data-value'), 'run_audit');
  await page.getByRole('tab', { name: 'Dataset', exact: true }).click();
  assert.equal(await page.getByRole('switch', { name: 'Kiểm tra dataset trước khi review', exact: true }).getAttribute('aria-checked'), 'true');
  await page.getByLabel('Cột ID (không bắt buộc)', { exact: true }).fill('id');
  const compareTwo = page.getByRole('switch', { name: 'Đối chiếu schema và ID khi task có đúng hai dataset', exact: true });
  await compareTwo.click();
  assert.equal(await compareTwo.getAttribute('aria-checked'), 'false');
  await page.getByRole('button', { name: 'Lưu hội', exact: true }).click();
  const preflightTaskId = await page.evaluate(async sourceId => {
    const workspace = await window.orglet.call('workspace', {}); const team = workspace.teams.find(team => team.name === 'Eris Review');
    return window.orglet.call('createTask', { workerId: team.synthesizerId, teamId: team.id, brief: 'Packaged automatic preflight', sourceIds: [sourceId], consent: false, budgetMicros: 1000 });
  }, result.profile.datasets[0].sourceId);
  await openThreadByBrief(page, 'Packaged automatic preflight');
  await page.locator('.report-file', { hasText: 'Báo cáo mẫu' }).first().waitFor();
  await page.locator('.report-file').first().click();
  const preflightDetail = await page.evaluate(id => window.orglet.call('task', { id }), preflightTaskId);
  assert.equal(preflightDetail.preflights[0].status, 'complete'); assert.equal(preflightDetail.profiles.length, 1);
  assert.equal(preflightDetail.profiles[0].result.datasets[0].id.duplicateNonNull, 1);
  assert.equal(preflightDetail.artifacts.length, 4);
  assert.equal(preflightDetail.task.evidenceRequests.length, 1);
  assert.equal(preflightDetail.task.evidenceRequests[0].state, "pending");
  await page.getByRole("button", { name: "Ghi nhận giới hạn", exact: true }).waitFor();
  const review = preflightDetail.artifacts.find(artifact => preflightDetail.runs.some(run => run.id === artifact.runId && run.stage === 'synthesis')).report.review;
  assert.equal(review.recommendation, 'insufficient_evidence'); assert.equal(review.checks.length, 5);
  assert.ok(review.checks.every(check => check.status === 'not_assessed'));
  await page.getByRole('heading', { name: 'Chưa đủ bằng chứng', exact: true }).waitFor();
  await page.getByText('Run stability · Chưa đánh giá', { exact: true }).click();
  const layout = await page.evaluate(() => ({ viewport: innerHeight, main: document.querySelector('.main-pane').getBoundingClientRect().bottom, settings: document.querySelector('.sidebar-footer').getBoundingClientRect().bottom }));
  assert.ok(layout.main <= layout.viewport + 1 && layout.settings <= layout.viewport + 1, 'Long report and role list must keep main/sidebar footers inside the viewport');
  console.log(JSON.stringify({ automaticPreflight: 'passed', taskId: preflightTaskId, checks: preflightDetail.profiles.length, reports: preflightDetail.artifacts.length, layout }));
  await page.keyboard.press('Escape');
  await page.locator('.doc-viewer').waitFor({ state: 'detached' });
  const templatePath = join(directory, 'team-template.json');
  await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }); }, templatePath);
  await page.getByRole('button', { name: 'Tùy chọn hội Eris Review', exact: true }).click(); await page.getByRole('menuitem', { name: 'Chỉnh sửa' }).click();
  await page.getByRole('button', { name: 'Xuất template đã lưu', exact: true }).click();
  await page.getByText('Đã xuất template', { exact: true }).waitFor();
  const template = JSON.parse(await readFile(templatePath, 'utf8'));
  assert.equal(template.team.reviewPolicy.requiredChecks.length, 5);
  assert.equal(template.team.reviewPolicy.requiredChecks[0].name, 'Mục tiêu và GPU relevance');
  assert.equal(template.format, 'orglet-team-template'); assert.equal(template.team.preflight.idColumn, 'id');
  template.team.name = 'Imported review'; await writeFile(templatePath, JSON.stringify(template));
  await page.keyboard.press('Escape');
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, templatePath);
  await page.getByRole('button', { name: 'Tạo hội', exact: true }).click();
  await page.getByRole('button', { name: 'Nhập template', exact: true }).click();
  await page.getByRole('button', { name: 'Tùy chọn hội Imported review', exact: true }).waitFor();
  const importedWorkspace = await page.evaluate(() => window.orglet.call('workspace', {}));
  assert.equal(importedWorkspace.teams.length, 2); assert.equal(importedWorkspace.tasks.length, 2);
  assert.notDeepEqual(importedWorkspace.teams[0].memberIds, importedWorkspace.teams[1].memberIds);
  console.log(JSON.stringify({ templateRoundtrip: 'passed', templatePath }));
  const taskWorkspace = join(directory, 'task-workspace');
  await mkdir(taskWorkspace);
  assert.equal(await page.evaluate(taskId => window.orglet.call('workspaceAccess', { taskId }), result.id), null);
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async (_window, options) => {
      globalThis.workspaceGrantTitle = options.title;
      return { canceled: false, filePaths: [path] };
    };
  }, taskWorkspace);
  const grant = await page.evaluate(taskId => window.orglet.pickWorkspace(taskId, ['read', 'write']), result.id);
  assert.equal(grant.name, 'task-workspace');
  assert.equal(grant.directory, undefined);
  assert.equal(await app.evaluate(() => globalThis.workspaceGrantTitle), 'Chọn workspace: đọc và sửa file');
  const bypass = await page.evaluate(async taskId => {
    try {
      await window.orglet.call('grantWorkspace', { taskId, directory: 'C:\\', permissions: ['read', 'write'] });
      return true;
    } catch { return false; }
  }, result.id);
  assert.equal(bypass, false, 'Renderer cannot submit its own workspace path');
  await page.evaluate(taskId => window.orglet.call('revokeWorkspace', { taskId }), result.id);
  assert.equal((await page.evaluate(taskId => window.orglet.call('workspaceAccess', { taskId }), result.id)).revoked, true);
  await page.evaluate(taskId => window.orglet.pickWorkspace(taskId, ['read']), result.id);
  console.log(JSON.stringify({ workspaceGrantBridge: 'passed' }));
  await openThreadByBrief(page, 'Packaged native checker fixture');
  await page.getByRole('button', { name: 'Tùy chọn cuộc trò chuyện', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Chi tiết', exact: true }).click();
  const toolsPanel = page.locator('.task-tools');
  await toolsPanel.getByRole('heading', { name: 'Quyền công cụ', exact: true }).waitFor();
  assert.equal(await toolsPanel.getByRole('button', { name: 'Đổi thư mục hoặc quyền', exact: true }).isDisabled(), true, 'Demo must state its unsupported tools');
  const originalWorker = await page.evaluate(async taskId => {
    const detail = await window.orglet.call('task', { id: taskId });
    const workspace = await window.orglet.call('workspace', {});
    const worker = workspace.workers.find(person => person.id === detail.task.workerId);
    await window.orglet.call('saveWorker', { ...worker, provider: 'openai' });
    return worker;
  }, result.id);
  const folderAccess = toolsPanel.getByRole('combobox', { name: 'Quyền cho thư mục được chọn', exact: true });
  await folderAccess.focus();
  await folderAccess.press('ArrowDown');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  assert.equal(await folderAccess.getAttribute('data-value'), 'execute');
  await toolsPanel.getByRole('button', { name: 'Đổi thư mục hoặc quyền', exact: true }).click();
  await page.waitForFunction(async taskId => (await window.orglet.call('workspaceAccess', { taskId }))?.permissions.includes('execute'), result.id);
  assert.equal(await app.evaluate(() => globalThis.workspaceGrantTitle), 'Chọn workspace: đọc, sửa file và chạy lệnh');
  await toolsPanel.getByRole('button', { name: 'Thu hồi quyền thư mục', exact: true }).click();
  await toolsPanel.getByText('Chưa cấp thư mục làm việc', { exact: true }).waitFor();
  const webAccess = toolsPanel.getByRole('switch', { name: 'Đọc và tìm kiếm web', exact: true });
  await webAccess.focus();
  await webAccess.press('Space');
  await page.waitForFunction(async taskId => (await window.orglet.call('task', { id: taskId })).task.toolCapabilities?.includes('network.web'), result.id);
  await webAccess.press('Space');
  await page.waitForFunction(async taskId => !(await window.orglet.call('task', { id: taskId })).task.toolCapabilities?.includes('network.web'), result.id);
  await page.evaluate(async worker => { await window.orglet.call('saveWorker', worker); }, originalWorker);
  // DOM geometry checks work without desktop screenshots or computer-use automation.
  await page.setViewportSize({ width: 780, height: 700 });
  const toolLayout = await toolsPanel.evaluate(panel => {
    const row = panel.querySelector('.switch-field');
    const title = row.querySelector('.switch-field-text').getBoundingClientRect();
    const control = row.querySelector('[role=switch]').getBoundingClientRect();
    return { overflow: panel.scrollWidth > panel.clientWidth + 1,
      centerDifference: Math.abs(title.y + title.height / 2 - control.y - control.height / 2) };
  });
  assert.equal(toolLayout.overflow, false);
  assert.ok(toolLayout.centerDifference < 1, 'Permission switch and its label block must share a vertical center');
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.getByRole('button', { name: 'Đóng panel', exact: true }).click();
  if (await page.getByRole('button', { name: 'Mở sidebar', exact: true }).count()) {
    await page.getByRole('button', { name: 'Mở sidebar', exact: true }).click();
  }
  await page.evaluate(taskId => window.orglet.pickWorkspace(taskId, ['read']), result.id);
  console.log(JSON.stringify({ taskToolPermissionsUI: 'passed', toolLayout }));
  const backupPath = join(directory, 'workspace.json');
  await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }); }, backupPath);
  await page.getByRole('button', { name: 'Cài đặt', exact: true }).click(); await page.getByRole('tab', { name: 'Dữ liệu', exact: true }).click();
  await page.getByRole('button', { name: 'Lưu bản sao lưu', exact: true }).click();
  await page.getByText('Đã lưu bản sao lưu', { exact: true }).waitFor();
  const backup = JSON.parse(await readFile(backupPath, 'utf8'));
  assert.equal(backup.payload.profiles.length, 2); assert.equal(backup.payload.artifacts.length, 5); assert.equal(backup.payload.preflights.length, 1);
  assert.equal(backup.payload.sources[0].path, undefined);
  await app.close();
  // Seed crash evidence only after the isolated app has closed its database.
  const recoveryDatabase = new DatabaseSync(join(userData, 'orglet.sqlite'));
  const recoveryRunId = randomUUID();
  const recoveryProcessId = randomUUID();
  const privateDirectory = join(directory, 'private-recovery-copy');
  await mkdir(privateDirectory);
  await writeFile(join(privateDirectory, 'note.txt'), 'Private edit for inspection');
  await writeFile(join(taskWorkspace, 'note.txt'), 'Current user file');
  const reviewAssignment = 'Review findings. ' + 'Check the recorded evidence and preserve unresolved disagreements. '.repeat(4);
  try {
    const task = JSON.parse(recoveryDatabase.prepare('SELECT data FROM tasks WHERE id=?').get(result.id).data);
    const worker = JSON.parse(recoveryDatabase.prepare('SELECT data FROM workers WHERE id=?').get(task.workerId).data);
    const skill = JSON.parse(recoveryDatabase.prepare('SELECT data FROM skills LIMIT 1').get().data);
    const storedGrant = JSON.parse(recoveryDatabase.prepare('SELECT data FROM workspace_grants WHERE task_id=?').get(task.id).data);
    const workspaceGrant = { id: storedGrant.id, taskId: task.id, revision: storedGrant.revision, permissions: storedGrant.permissions };
    const run = { id: recoveryRunId, taskId: task.id, stage: 'member', status: 'failed', error: 'Packaged recovery fixture',
      startedAt: new Date().toISOString(), snapshot: { worker: { ...worker, name: 'Fixture researcher' }, skill, workspaceGrant,
        assignment: { workerId: worker.id, brief: 'Inspect the source' } } };
    recoveryDatabase.prepare('UPDATE tasks SET data=? WHERE id=?').run(JSON.stringify({ ...task, status: 'failed' }), task.id);
    recoveryDatabase.prepare('INSERT INTO runs(id,task_id,data) VALUES(?,?,?)').run(run.id, task.id, JSON.stringify(run));
    const changedFile = { path: 'note.txt', hash: createHash('sha256').update('Private edit for inspection').digest('hex'), bytes: 27,
      expectedHash: createHash('sha256').update('Original file').digest('hex'), status: 'conflict' };
    recoveryDatabase.prepare('INSERT INTO workspace_copies(run_id,data) VALUES(?,?)').run(run.id, JSON.stringify({
      runId: run.id, grant: workspaceGrant, directory: privateDirectory, state: 'conflict',
      baseline: { files: [], omitted: [] }, kind: 'copy', changes: [changedFile],
    }));
    const dependentId = randomUUID();
    const dependent = { ...run, id: randomUUID(), status: 'interrupted', error: 'Waiting for prerequisite',
      snapshot: { worker: { ...worker, id: dependentId, name: 'Fixture reviewer' }, skill,
        assignment: { workerId: dependentId, brief: reviewAssignment, dependsOn: [worker.id] } } };
    recoveryDatabase.prepare('INSERT INTO runs(id,task_id,data) VALUES(?,?,?)').run(dependent.id, task.id, JSON.stringify(dependent));
    const process = { id: recoveryProcessId, runId: run.id, state: 'uncertain', exitCode: null,
      command: { program: 'node', arguments: ['fixture.cjs'], timeoutMs: 1000 }, stdout: '🙂'.repeat(16001), stderr: 'fixture error' };
    recoveryDatabase.prepare('INSERT INTO workspace_processes(id,run_id,data) VALUES(?,?,?)')
      .run(process.id, run.id, JSON.stringify(process));
    recoveryDatabase.prepare("INSERT INTO tool_calls(run_id,call_id,fingerprint,state,output,replay) VALUES(?,?,?,'uncertain',NULL,'never')")
      .run(run.id, 'recovery-fixture', 'a'.repeat(64));
  } finally { recoveryDatabase.close(); }
  app = await launch(directory);
  page = await app.firstWindow();
  await useVietnamese(page);
  await openThreadByBrief(page, 'Packaged native checker fixture');
  await page.locator('.team-progress').getByText('Fixture reviewer · Bị gián đoạn · Chờ Fixture researcher', { exact: true }).waitFor();
  await page.locator('.team-progress').getByText('Fixture researcher · Cần xem lại · Inspect the source', { exact: true }).waitFor();
  const assignmentDetails = page.locator('.team-progress details');
  assert.equal(await assignmentDetails.getAttribute('open'), null);
  await assignmentDetails.locator('summary').focus();
  await page.keyboard.press('Enter');
  assert.equal(await assignmentDetails.locator('p').innerText(), reviewAssignment);
  assert.notEqual(await assignmentDetails.getAttribute('open'), null);
  console.log(JSON.stringify({ teamDependencyProgressUI: 'passed', assignmentDescription: 'passed', keyboardDisclosure: 'passed' }));
  await page.getByRole('button', { name: 'Tùy chọn cuộc trò chuyện', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Chi tiết', exact: true }).click();
  const recoveryPanel = page.locator('.workspace-recovery');
  await recoveryPanel.getByRole('heading', { name: 'File và tiến trình', exact: true }).waitFor();
  await recoveryPanel.getByRole('button', { name: 'Xem bản sửa riêng', exact: true }).click();
  const privateEdit = recoveryPanel.locator('pre').filter({ hasText: 'Private edit for inspection' });
  const privateEditError = recoveryPanel.getByRole('alert');
  const previewOutcome = await Promise.race([
    privateEdit.waitFor().then(() => null),
    privateEditError.waitFor().then(() => privateEditError.innerText()),
  ]);
  assert.equal(previewOutcome, null, `Private edit preview failed: ${previewOutcome}`);
  assert.equal(await readFile(join(taskWorkspace, 'note.txt'), 'utf8'), 'Current user file');
  await recoveryPanel.locator('summary').filter({ hasText: 'Chưa rõ kết quả' }).click();
  await recoveryPanel.getByRole('button', { name: 'Xem đầu ra', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.workspace-process-output pre')].some(pre => [...(pre.textContent ?? '')].length === 16000));
  await recoveryPanel.getByRole('button', { name: 'Trang đầu ra tiếp theo', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.workspace-process-output pre')].some(pre => pre.textContent === '🙂'));
  await recoveryPanel.getByRole('button', { name: /^Giữ file hiện tại ·/ }).click();
  await page.getByRole('button', { name: 'Quay lại kiểm tra', exact: true }).click();
  assert.equal((await page.evaluate(taskId => window.orglet.call('workspaceRecovery', { taskId }), result.id)).attempts[0].retired, false);
  await recoveryPanel.getByRole('button', { name: /^Giữ file hiện tại ·/ }).click();
  await page.getByRole('button', { name: 'Giữ file hiện tại', exact: true }).click();
  await page.waitForFunction(async taskId => (await window.orglet.call('workspaceRecovery', { taskId })).attempts[0]?.retired, result.id);
  const recoveryState = await page.evaluate(taskId => window.orglet.call('workspaceRecovery', { taskId }), result.id);
  assert.equal(recoveryState.processes[0].state, 'uncertain');
  assert.equal(recoveryState.uncertainCalls[0].callId, 'recovery-fixture');
  const recoveredDetail = await page.evaluate(id => window.orglet.call('task', { id }), result.id);
  assert.equal(recoveredDetail.runs.find(run => run.id === recoveryRunId).status, 'failed');
  assert.equal(recoveredDetail.artifacts.length, 1);
  console.log(JSON.stringify({ workspaceRecoveryUI: 'passed', preservedFailure: true }));
  await app.close();
  const restoreDirectory = await mkdtemp(join(tmpdir(), 'orglet-restored-'));
  app = await launch(restoreDirectory); page = await app.firstWindow();
  await useVietnamese(page);
  await app.evaluate(({ dialog }, path) => {
    globalThis.orgletTestDialogs = { open: dialog.showOpenDialog, message: dialog.showMessageBox };
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  }, backupPath);
  await page.getByRole('button', { name: 'Cài đặt', exact: true }).click(); await page.getByRole('tab', { name: 'Dữ liệu', exact: true }).click();
  await page.getByRole('button', { name: 'Khôi phục từ tệp', exact: true }).click();
  await page.getByText('Đã khôi phục các mục còn thiếu', { exact: true }).waitFor();
  const restored = await page.evaluate(id => window.orglet.call('task', { id }), result.id);
  assert.equal(restored.artifacts.length, 1); assert.equal(restored.profiles[0].result.datasets[0].rows, 3);
  assert.equal(restored.sources[0].revoked, true); assert.equal(restored.task.consent, false);
  assert.equal(await page.evaluate(taskId => window.orglet.call('workspaceAccess', { taskId }), result.id), null);
  const restoredPreflight = await page.evaluate(id => window.orglet.call('task', { id }), preflightTaskId);
  assert.equal(restoredPreflight.task.evidenceRequests[0].state, "pending");
  assert.equal(restoredPreflight.preflights[0].profileIds.length, 1); assert.equal(restoredPreflight.profiles[0].result.datasets[0].rows, 3);
  assert.deepEqual(await page.evaluate(() => window.orglet.connections()), { openai: false, anthropic: false, xai: false, openrouter: false, ollama: false });
  await app.evaluate(({ dialog }) => { dialog.showOpenDialog = globalThis.orgletTestDialogs.open; dialog.showMessageBox = globalThis.orgletTestDialogs.message; });
  await page.keyboard.press('Escape');
  console.log(JSON.stringify({ backupRestore: 'passed', restoreDirectory, backupPath, restoredReports: restored.artifacts.length, restoredChecks: restored.profiles.length }));
  console.log(JSON.stringify({ userData, taskId: result.id, engine: result.profile.engine, rows: 3, duplicateIds: 1 }, null, 2));
  if (process.argv.includes('--inspect-ui')) {
    await openThreadByBrief(page, 'Packaged automatic preflight');
    await page.getByRole('button', { name: 'Xem kiểm tra trước review', exact: true }).waitFor();
    console.log('Packaged UI ready for computer use; close its window when finished.');
    await new Promise(resolve => app.once('close', resolve));
  }
} finally { if (!closed) await app.close(); }
