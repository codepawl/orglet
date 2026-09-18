import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { useVietnamese } from './smoke-language.mjs';
import { packagedExecutable } from './packaged-executable.mjs';

const directory = await mkdtemp(join(tmpdir(), 'orglet-finding-ui-')); const data = join(directory, 'data');
const text = join(directory, 'evidence.txt'); const csv = join(directory, 'data.csv');
await writeFile(text, 'Navigation fixture evidence.\nSecond line.'); await writeFile(csv, 'id,value\n1,2\n');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let closed = true;
const launch = async () => { const instance = await electron.launch({ executablePath: packagedExecutable(), args: [`--user-data-dir=${data}`], env }); closed = false; instance.once('close', () => { closed = true; }); return instance; };
let app = await launch();
try {
  let page = await app.firstWindow(); await useVietnamese(page);
  const userData = await app.evaluate(({ app }) => app.getPath('userData'));
  const within = relative(directory, userData); assert.ok(within && !within.startsWith('..') && !isAbsolute(within));
  await app.evaluate(({ dialog }, paths) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths }); }, [text, csv]);
  const fixture = await page.evaluate(async () => {
    const sources = await window.orglet.pickSources(); const workspace = await window.orglet.call('workspace', {});
    const taskId = await window.orglet.call('createTask', { workerId: workspace.workers[0].id, brief: 'Finding navigation UI fixture', sourceIds: sources.map(source => source.id), consent: false, budgetMicros: 1000 });
    await window.orglet.call('profileSources', { taskId, sourceIds: [sources[1].id], idColumn: null });
    return { taskId, sourceIds: sources.map(source => source.id) };
  });
  await page.getByRole('button', { name: /^Finding navigation UI fixture/ }).click();
  await page.locator('.chat-reply, .report').first().waitFor();
  const detail = await page.evaluate(id => window.orglet.call('task', { id }), fixture.taskId);
  await app.close();
  // UI-only fixture: edit only the closed, isolated database. Core authorship/reference behavior is tested separately.
  const db = new DatabaseSync(join(userData, 'orglet.sqlite'));
  const artifact = detail.artifacts[0]; const run = detail.runs[0]; const profile = { ...detail.profiles[0], runId: run.id };
  const findingId = randomUUID();
  artifact.report = { title: 'Evidence navigation fixture', summary: 'Synthetic report for UI navigation; no model analysis.', findings: [{ title: 'Fixture finding', severity: 'info', detail: 'One CSV row and a selected text source.', sourceIds: fixture.sourceIds, coverage: 'Synthetic UI fixture plus actual local row count', category: 'data', recommendation: 'Inspect the linked evidence.', checkerIds: [profile.id], locations: [{ sourceId: fixture.sourceIds[0], startLine: 2, endLine: 2 }], provenance: { findingId, writerId: run.snapshot.worker.id, runId: run.id } }], limitations: ['This report was inserted into an isolated test database, not produced by a model.'] };
  artifact.report.review = { checks: [{ name: 'Run stability', status: 'not_assessed', coverage: 'Run logs were not supplied.', sourceIds: [], checkerIds: [] }], recommendation: 'insufficient_evidence', draftFeedback: 'Please supply run logs before assessing stability.', upstreamFindingIds: [], conflicts: [] };
  artifact.hash = createHash('sha256').update(JSON.stringify(artifact.report)).digest('hex');
  try { db.prepare('UPDATE profiles SET data=? WHERE id=?').run(JSON.stringify(profile), profile.id); db.prepare('UPDATE artifacts SET data=? WHERE id=?').run(JSON.stringify(artifact), artifact.id); }
  finally { db.close(); }
  app = await launch(); page = await app.firstWindow(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: /^Finding navigation UI fixture/ }).click();
  // The report arrives as a file; open it to read.
  await page.locator('.report-file', { hasText: 'Evidence navigation fixture' }).click();
  await page.getByRole('dialog', { name: 'Evidence navigation fixture' }).waitFor();
  await page.getByRole('heading', { name: 'Chưa đủ bằng chứng', exact: true }).waitFor();
  await page.getByText('Run stability · Chưa đánh giá', { exact: true }).click();
  await page.getByText('Run logs were not supplied.', { exact: true }).waitFor();
  await page.getByText('Please supply run logs before assessing stability.', { exact: true }).waitFor();
  await app.evaluate(({ clipboard }) => { globalThis.originalClipboardWrite = clipboard.writeText; clipboard.writeText = text => { globalThis.copiedFeedback = text; }; });
  await page.getByRole('button', { name: 'Sao chép feedback', exact: true }).click();
  await page.getByText('Đã sao chép feedback.', { exact: true }).waitFor();
  assert.equal(await app.evaluate(() => globalThis.copiedFeedback), 'Please supply run logs before assessing stability.');
  await app.evaluate(({ clipboard }) => { clipboard.writeText = globalThis.originalClipboardWrite; });
  await page.getByText('Nguồn gốc finding', { exact: true }).click();
  await page.getByText(`Finding: ${findingId}`, { exact: false }).waitFor();
  await page.getByRole('button', { name: 'evidence.txt', exact: true }).click();
  await page.locator(`#source-${fixture.sourceIds[0]} .source-preview`).filter({ hasText: 'Navigation fixture evidence.' }).waitFor();
  assert.equal(await page.evaluate(() => document.activeElement.id), `source-${fixture.sourceIds[0]}`);
  await page.keyboard.press('Escape');
  await page.locator('.report-file').first().click();
  await page.getByRole('button', { name: 'evidence.txt · dòng 2', exact: true }).click();
  const highlighted = page.locator(`#source-${fixture.sourceIds[0]} .line-highlight`);
  await highlighted.waitFor();
  assert.deepEqual(await highlighted.evaluateAll(lines => lines.map(line => [line.dataset.line, line.textContent])), [['2', '2Second line.\n']]);
  await page.keyboard.press('Escape');
  await page.locator('.report-file').first().click();
  await page.getByRole('button', { name: 'Xem checker 1', exact: true }).click();
  assert.equal(await page.locator(`#checker-${profile.id}`).evaluate(element => element.open), true);
  assert.equal(await page.evaluate(() => document.activeElement.id), `checker-${profile.id}`);
  await page.getByText('1 dòng · 2 cột', { exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(780, 640));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await mkdir('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/finding-evidence.png' }); assert.deepEqual(errors, []);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1200, 820));
  await page.keyboard.press('Escape');
  const result = { directory, taskId: fixture.taskId, findingId, checkerId: profile.id, sourceNavigation: 'passed', checkerNavigation: 'passed', provenance: 'passed', narrow: 'passed' };
  await writeFile('test-results/finding-smoke.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  if (process.argv.includes('--inspect-ui')) { console.log('Finding fixture ready for native computer use; close its window to finish.'); await new Promise(resolve => app.once('close', resolve)); }
} finally { if (!closed) await app.close(); }
