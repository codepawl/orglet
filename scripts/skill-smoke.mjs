import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { useVietnamese } from './smoke-language.mjs';
import { packagedExecutable } from './packaged-executable.mjs';

const directory = await mkdtemp(join(tmpdir(), 'orglet-skill-ui-'));
const skillPath = join(directory, 'review-kit'); const exportPath = join(directory, 'exports');
await mkdir(join(skillPath, 'references'), { recursive: true }); await mkdir(join(skillPath, 'scripts')); await mkdir(exportPath);
await writeFile(join(skillPath, 'SKILL.md'), '---\nname: review-kit\ndescription: Review selected evidence with a checklist.\nallowed-tools: read_source read_skill_resource submit_report\n---\nRead references/checks.md when needed.');
await writeFile(join(skillPath, 'references/checks.md'), 'Check each claim against a selected source.');
await writeFile(join(skillPath, 'scripts/helper.py'), 'raise Exception("DO NOT RUN")');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: packagedExecutable(), args: [`--user-data-dir=${join(directory, 'data')}`], env });
let closed = false; app.once('close', () => { closed = true; });
try {
  const page = await app.firstWindow(); await useVietnamese(page);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ dialog }, path) => { globalThis.skillOriginalOpen = dialog.showOpenDialog; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, skillPath);
  await page.getByRole('button', { name: 'Thư viện', exact: true }).click();
  const validSkill = await readFile(join(skillPath, 'SKILL.md'), 'utf8');
  await writeFile(join(skillPath, 'SKILL.md'), 'Missing frontmatter');
  await page.getByRole('button', { name: 'Nhập từ thư mục', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'frontmatter' }).waitFor();
  await writeFile(join(skillPath, 'SKILL.md'), validSkill);
  await page.getByRole('button', { name: 'Nhập từ thư mục', exact: true }).click();
  await page.getByRole('heading', { name: 'review-kit', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Xác nhận review', exact: true }).isEnabled(), false);
  await page.getByRole('combobox', { name: 'Tệp trong gói', exact: true }).click(); await page.getByRole('option', { name: /^scripts\/helper\.py/ }).click();
  assert.match(await page.getByLabel('Nội dung scripts/helper.py', { exact: true }).inputValue(), /DO NOT RUN/);
  const imported = await page.evaluate(async () => {
    const workspace = await window.orglet.call('workspace', {}); const skill = workspace.skills.find(skill => skill.name === 'review-kit');
    let refused = false;
    try { await window.orglet.call('saveWorker', { ...workspace.workers[0], skillId: skill.id }); } catch { refused = true; }
    return { id: skill.id, hash: skill.package.hash, refused };
  });
  assert.equal(imported.refused, true);
  await page.getByRole('combobox', { name: 'Tệp trong gói', exact: true }).click(); await page.getByRole('option', { name: /^references\/checks\.md/ }).click();
  await page.getByRole('checkbox', { name: /Tôi đã xem nội dung/ }).check();
  await page.getByRole('button', { name: 'Xác nhận review', exact: true }).click();
  const reviewed = await page.evaluate(async id => (await window.orglet.call('workspace', {})).skills.find(skill => skill.id === id), imported.id);
  assert.equal(reviewed.package.reviewedHash, imported.hash);
  // Reviewed from the Library, the editor leads back there on its own instead of closing the panel.
  await page.getByRole('button', { name: 'Nhập từ thư mục', exact: true }).waitFor();
  await page.getByRole('button', { name: /review-kit/ }).click();
  await page.getByText('Đã review trên máy này.', { exact: true }).waitFor();
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, exportPath);
  await page.getByRole('button', { name: 'Xuất gói skill', exact: true }).click();
  await page.getByText('Đã xuất gói skill vào thư mục mới', { exact: true }).waitFor();
  assert.equal(await readFile(join(exportPath, 'review-kit/references/checks.md'), 'utf8'), 'Check each claim against a selected source.');
  assert.equal(JSON.parse(await readFile(join(exportPath, 'review-kit/orglet.json'), 'utf8')).evaluator, 'orglet-report-v1');
  await page.keyboard.press('Escape');
  await writeFile(join(skillPath, 'SKILL.md'), '---\nname: review-kit\ndescription: Unsupported shell fixture.\nallowed-tools: Bash\n---\nRun a script.');
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, skillPath);
  await page.getByRole('button', { name: 'Thư viện', exact: true }).click();
  await page.getByRole('button', { name: 'Nhập từ thư mục', exact: true }).click();
  await page.getByText('Tool chưa hỗ trợ: Bash', { exact: true }).waitFor();
  assert.equal(await page.getByRole('checkbox', { name: /Tôi đã xem nội dung/ }).isEnabled(), false);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Thư viện', exact: true }).click();
  await page.getByText(/Cần review/, { exact: false }).waitFor();
  await page.getByText(/Đã review/, { exact: false }).waitFor();
  await page.getByRole('button', { name: /review-kit.*Cần review/ }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(780, 640));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(overflow, false); assert.deepEqual(errors, []);
  const labelLayout = await page.getByRole('checkbox', { name: /Tôi đã xem nội dung/ }).evaluate(input => ({ direction: getComputedStyle(input.parentElement).flexDirection, width: input.getBoundingClientRect().width }));
  assert.equal(labelLayout.direction, 'row'); assert.ok(labelLayout.width >= 12);
  await mkdir('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/skill-review.png' });
  await app.evaluate(({ dialog, BrowserWindow }) => { dialog.showOpenDialog = globalThis.skillOriginalOpen; BrowserWindow.getAllWindows()[0].setSize(1200, 820); });
  const result = { directory, import: 'passed', reviewGate: 'passed', export: 'passed', unsupportedTool: 'passed', narrow: 'passed' };
  await writeFile('test-results/skill-smoke.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  if (process.argv.includes('--inspect-ui')) {
    console.log('Skill review UI ready for native computer use; close its window when finished.');
    await new Promise(resolve => app.once('close', resolve));
  }
} finally { if (!closed) await app.close(); }
