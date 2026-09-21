import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { useVietnamese } from './smoke-language.mjs';
import { packagedExecutable } from './packaged-executable.mjs';

const directory = await mkdtemp(join(tmpdir(), 'orglet-run-audit-ui-'));
const csv = join(directory, 'runs.csv'); const invalid = join(directory, 'invalid.csv');
const lines = ['solution,run,split,metric,status,score,error_code'];
for (let i = 0; i < 15; i++) for (const run of ['1', '2']) {
  lines.push(`s${i},${run},public,fixture-score,completed,${15 - i},`);
  lines.push(`s${i},${run},private,fixture-score,completed,${i},`);
}
lines.push('s14,3,private,fixture-score,failed,0,timeout');
await writeFile(csv, lines.join('\n')); await writeFile(invalid, 'id,score\n1,4\n');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: packagedExecutable(), args: [`--user-data-dir=${join(directory, 'data')}`], env });
let closed = false; app.once('close', () => { closed = true; });
try {
  const page = await app.firstWindow(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await useVietnamese(page);
  await app.evaluate(({ dialog }, paths) => { globalThis.originalRunAuditDialog = dialog.showOpenDialog; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths }); }, [csv, invalid]);
  await page.getByRole('button', { name: 'Thêm nguồn', exact: true }).click(); await page.getByRole('menuitem', { name: /^Tệp/ }).click();
  // Importing runs in the core; sending before both files appear would create a task without sources.
  await page.getByText('runs.csv', { exact: true }).waitFor();
  await page.getByText('invalid.csv', { exact: true }).waitFor();
  await page.getByRole('textbox', { name: 'Tin nhắn', exact: true }).fill('Run audit fixture: fixture-score higher is better.');
  await page.getByRole('button', { name: 'Gửi tin nhắn', exact: true }).click();
  await page.locator('.chat-reply, .report').first().waitFor();
  // The message lists its files as cards; opening one is what the count button used to do.
  await page.locator('.chat-turn .message-files .attachment-open').first().click();
  await page.getByRole('checkbox', { name: 'runs.csv', exact: true }).check();
  assert.equal(await page.getByRole('button', { name: 'Kiểm tra run-log local', exact: true }).isEnabled(), false);
  await page.getByRole('combobox', { name: 'Chiều tối ưu của metric', exact: true }).click(); await page.getByRole('option', { name: 'Điểm cao hơn tốt hơn', exact: true }).click();
  await page.getByRole('checkbox', { name: 'invalid.csv', exact: true }).check();
  assert.equal(await page.getByRole('button', { name: 'Kiểm tra run-log local', exact: true }).isEnabled(), false);
  await page.getByRole('checkbox', { name: 'runs.csv', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Kiểm tra run-log local', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'solution, run, split, metric, status, score' }).waitFor();
  await page.getByRole('checkbox', { name: 'invalid.csv', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: 'runs.csv', exact: true }).check();
  await page.getByRole('button', { name: 'Kiểm tra run-log local', exact: true }).click();
  await page.locator('summary').filter({ hasText: /^Run-log ·/ }).click();
  await page.getByRole('heading', { name: 'Run-log · Cần xem lại failure', exact: true }).waitFor();
  await page.getByText(/60 completed · 1 failed · 0 cancelled/).waitFor();
  await page.getByText('Mã lỗi và trạng thái không hoàn tất', { exact: true }).click();
  await page.getByText('timeout: 1', { exact: true }).waitFor();
  await page.getByText('So sánh rank public/private', { exact: true }).click();
  const rankTable = page.getByRole('table', { name: /Thứ hạng từ điểm trung bình/ });
  await rankTable.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 's14', exact: true }) }).getByRole('cell', { name: '+14', exact: true }).waitFor();
  const detail = await page.evaluate(async () => { const workspace = await window.orglet.call('workspace', {}); return window.orglet.call('task', { id: workspace.tasks[0].id }); });
  const audit = detail.profiles[0].result.runAudit;
  assert.equal(audit.ignoredFailureScores, 1); assert.equal(audit.groups.every(group => group.sampleStdDev === 0), true);
  assert.deepEqual(audit.ranks.find(item => item.solution === 's14'), { solution: 's14', publicRank: 15, privateRank: 1, improvement: 14 });
  assert.equal(detail.profiles.length, 1, 'Invalid audit must not save a profile');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(780, 640));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await mkdir('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/run-audit.png' });
  assert.deepEqual(errors, []);
  await app.evaluate(({ dialog, BrowserWindow }) => { dialog.showOpenDialog = globalThis.originalRunAuditDialog; BrowserWindow.getAllWindows()[0].setSize(1200, 820); });
  const result = { directory, taskId: detail.task.id, rows: audit.rows, failures: audit.failed, improvement: 14, inputError: 'passed', narrow: 'passed' };
  await writeFile('test-results/run-audit-smoke.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  if (process.argv.includes('--inspect-ui')) {
    await page.getByText('So sánh rank public/private', { exact: true }).click();
    console.log('Run audit ready for native computer use; close the fixture window to finish.');
    await new Promise(resolve => app.once('close', resolve));
  }
} finally { if (!closed) await app.close(); }

