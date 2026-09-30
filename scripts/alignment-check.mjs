import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as rules from './alignment/rules.ts';
import { en } from '../apps/desktop/src/shared/locales/en.ts';
import { packagedExecutable } from './packaged-executable.mjs';
import { isolatedHarnessEnvironment } from './fake-harnesses.mjs';

// Measures alignment on the packaged app's main screens instead of trusting a screenshot (COD-333). It seeds a
// throwaway workspace on Demo (no provider is called), visits each screen at two window sizes in both themes, and
// runs the checks in scripts/alignment/rules.ts in the window. Findings go to stdout, a JSON report and one outlined
// screenshot per screen that has any. Exits 1 on findings unless --report-only.
//
//   pnpm test:alignment [--report-only] [--all-screenshots] [--only schedules,settings-general] [--language vi|en] [--out <folder>]

const SIZES = [{ width: 1200, height: 820 }, { width: 740, height: 600 }];
const THEMES = ['light', 'dark'];

function parseArguments(argv) {
  const options = { reportOnly: false, allScreenshots: false, only: undefined, language: 'vi', out: undefined };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--report-only') options.reportOnly = true;
    else if (argument === '--all-screenshots') options.allScreenshots = true;
    else if (argument === '--only') options.only = argv[++index].split(',');
    else if (argument === '--language') options.language = argv[++index];
    else if (argument === '--out') options.out = resolve(argv[++index]);
    else throw new Error(`Unknown argument ${argument}`);
  }
  return options;
}

const options = parseArguments(process.argv.slice(2));

/** The label as it reads in the language the check runs in; source strings are Vietnamese. */
function label(vietnamese, values = []) {
  const text = options.language === 'en' ? en[vietnamese] ?? vietnamese : vietnamese;
  return values.reduce((result, value, index) => result.replace(`{${index}}`, value), text);
}

function startsWith(vietnamese) {
  return new RegExp(`^${label(vietnamese).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
}

/** Every exported rule as a declaration, so the functions can call each other by name inside the window. */
function measuringSource() {
  const declarations = Object.entries(rules).map(([name, value]) => typeof value === 'function' ? value.toString() : `const ${name} = ${JSON.stringify(value)};`);
  return `(() => {\n${declarations.join('\n')}\nwindow.__orgletAlignment = { measurePage, measureFamily, drawOutlines, clearOutlines };\n})()`;
}

async function callCore(page, command, input) {
  return page.evaluate(([name, value]) => window.orglet.call(name, value), [command, input]);
}

async function waitForTask(page, taskId) {
  await page.waitForFunction(async id => {
    const detail = await window.orglet.call('task', { id });
    return ['completed', 'partial', 'failed'].includes(detail.task.status);
  }, taskId, { timeout: 90_000 });
}

async function setAppearance(page, theme) {
  const workspace = await callCore(page, 'workspace', {});
  await callCore(page, 'settings', { language: options.language, theme, connectionLimitMicros: workspace.connectionLimitMicros });
  await page.waitForFunction(value => document.documentElement.dataset.theme === value, theme);
}

/** Orglets, a crew with an answered turn, a chat with an answer, and schedules for an orglet and for a crew. */
async function seedWorkspace(page) {
  await page.waitForFunction(() => window.orglet !== undefined);
  await page.locator('.welcome, .main-pane').first().waitFor();
  await setAppearance(page, 'light');
  const initial = await callCore(page, 'workspace', {});
  const researcher = initial.workers[0];
  const extraOrglets = [
    { name: 'Writer', description: 'Drafts posts and replies in a friendly voice', avatar: { mascot: 'pen', color: '#d9480f' } },
    { name: 'Data analyst', description: 'Checks spreadsheets and explains the numbers', avatar: { color: '#1971c2' } },
  ];
  for (const orglet of extraOrglets) {
    await callCore(page, 'saveWorker', { ...orglet, instructions: 'Answer clearly and briefly.', provider: 'demo', skillId: researcher.skillId }).catch(() =>
      callCore(page, 'saveWorker', { name: orglet.name, description: orglet.description, instructions: 'Answer clearly and briefly.', provider: 'demo', skillId: researcher.skillId }));
  }
  const crew = await callCore(page, 'createTemplate', { templateId: 'research-review', provider: 'demo' });
  const crewTaskId = await callCore(page, 'createTask', { workerId: crew.synthesizerId, teamId: crew.id, brief: 'Compare three note-taking apps for a small team and pick one.', sourceIds: [], consent: false, budgetMicros: 1000 });
  await waitForTask(page, crewTaskId);
  const chatTaskId = await callCore(page, 'createTask', { workerId: researcher.id, brief: 'Plan the launch of my weekly newsletter next month. Keep it short.', sourceIds: [], consent: false, budgetMicros: 1000 });
  await waitForTask(page, chatTaskId);
  const base = { enabled: true, task: { sourceIds: [], consent: false, budgetMicros: 50_000 } };
  const schedules = [
    { name: 'Morning digest', schedule: { timeZone: 'Asia/Ho_Chi_Minh', time: '09:00', frequency: 'daily', weekday: 1, dailyCapMicros: 200_000 }, task: { workerId: researcher.id, brief: 'Summarise what changed in my inbox overnight.' } },
    { name: 'Weekly crew review', schedule: { timeZone: 'UTC', time: '16:30', frequency: 'weekly', weekday: 5 }, task: { workerId: crew.synthesizerId, teamId: crew.id, brief: 'Review this week’s notes and list open questions.' } },
    // Off, so its card has no next-run line and the orglet's face sits above an icon in the same column.
    { name: 'Evening wrap-up', enabled: false, schedule: { timeZone: 'Asia/Ho_Chi_Minh', time: '18:00', frequency: 'weekdays', weekday: 1, dailyCapMicros: 100_000 }, task: { workerId: researcher.id, brief: 'Write a short wrap-up of what got done today.' } },
    { name: 'Price watch', schedule: { timeZone: 'Asia/Ho_Chi_Minh', time: '08:00', frequency: 'hours', everyHours: 12, weekday: 1, window: { from: '08:00', to: '20:00' } }, task: { workerId: researcher.id, brief: 'Check the price of the monitor I bookmarked.' } },
  ];
  for (const schedule of schedules) {
    await callCore(page, 'saveRoutine', { ...base, name: schedule.name, enabled: schedule.enabled ?? true, schedule: schedule.schedule, task: { ...base.task, ...schedule.task } });
  }
  return { researcher, crew };
}

async function settle(page) {
  // Measure what the person reads, not the placeholder bars shown while a tab loads (the harness rows take seconds).
  await page.waitForFunction(() => !document.querySelector('.org-skeleton-group'), undefined, { timeout: 30_000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready.then(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))));
  await page.waitForTimeout(300);
}

async function openSidebar(page) {
  const opener = page.getByRole('button', { name: label('Mở sidebar'), exact: true });
  if (!await opener.isVisible()) return;
  // Just after the window widens, the collapsed sidebar's opener can still be on screen and then leave as the sidebar
  // comes back; a click that finds it gone has nothing left to do (it used to wait 30 s for it to return).
  await opener.click({ timeout: 5_000 }).catch(async error => {
    if (await opener.isVisible()) throw error;
  });
}

/** Back to a known state: no dialog, no menu, the sidebar showing the orglet's chat. */
async function reset(page, context) {
  for (let attempt = 0; attempt < 3 && await page.locator('[role=dialog], [role=menu]').count(); attempt++) await page.keyboard.press('Escape');
  // The right panel is part of the page, and a tab remembers it (COD-340): close it so the next screen starts without.
  if (await page.locator('.details-pane').count()) await page.keyboard.press('Escape');
  await openSidebar(page);
  await page.getByRole('button', { name: context.researcher.name, exact: true }).first().click();
  await page.getByRole('textbox', { name: label('Tin nhắn') }).waitFor();
}

async function openSettingsTab(page, tab) {
  await openSidebar(page);
  await page.getByRole('button', { name: startsWith('Cài đặt') }).first().click();
  await page.getByRole('tab', { name: label(tab), exact: true }).click();
}

async function openWorkerTab(page, context, tab) {
  await openSidebar(page);
  await page.getByRole('button', { name: label('Tùy chọn {0}', [context.researcher.name]), exact: true }).click();
  await page.getByRole('menuitem', { name: label('Chỉnh sửa') }).click();
  await page.getByRole('tab', { name: label(tab), exact: true }).click();
}

/** A tab for each of four chats (COD-340), ending on the orglet's own, so the strip shows above the main card. */
async function openTabs(page, context) {
  await openSidebar(page);
  for (const name of [context.crew.name, 'Writer', 'Data analyst', context.researcher.name]) {
    await openSidebar(page);
    await page.getByRole('button', { name, exact: true }).first().click();
  }
  await page.locator('.chat-tabs').waitFor();
}

/** Folds the sidebar to the rail (COD-340); the next reset opens it again. A narrow window has folded it already. */
async function foldSidebar(page) {
  const fold = page.getByRole('button', { name: label('Thu gọn sidebar'), exact: true });
  if (await fold.isVisible()) await fold.click();
  await page.locator('.rail').waitFor();
}

const SCREENS = [
  { name: 'chat', open: async () => {} },
  { name: 'chat-options-menu', open: async page => { await page.getByRole('button', { name: label('Tùy chọn cuộc trò chuyện'), exact: true }).first().click(); await page.getByRole('menu').waitFor(); } },
  { name: 'composer-add-menu', open: async page => { await page.getByRole('button', { name: label('Thêm nguồn'), exact: true }).first().click(); await page.getByRole('menu').waitFor(); } },
  { name: 'crew-chat', open: async (page, context) => { await openSidebar(page); await page.getByRole('button', { name: context.crew.name, exact: true }).first().click(); await page.locator('.chat-reply, .report').first().waitFor(); } },
  { name: 'sidebar-row-menu', open: async (page, context) => { await openSidebar(page); await page.getByRole('button', { name: label('Tùy chọn {0}', [context.researcher.name]), exact: true }).click(); await page.getByRole('menu').waitFor(); } },
  { name: 'schedules', open: async page => { await openSidebar(page); await page.getByRole('button', { name: startsWith('Lịch chạy') }).first().click(); await page.getByRole('region', { name: label('Lịch {0}', ['Morning digest']), exact: true }).waitFor(); } },
  { name: 'schedule-editor', open: async page => { await openSidebar(page); await page.getByRole('button', { name: startsWith('Lịch chạy') }).first().click(); await page.getByRole('button', { name: label('Tạo lịch'), exact: true }).click(); await page.getByLabel(label('Tên lịch'), { exact: true }).waitFor(); } },
  { name: 'empty-chat', open: async page => { await openSidebar(page); await page.getByRole('button', { name: 'Writer', exact: true }).first().click(); await page.getByRole('textbox', { name: label('Tin nhắn') }).waitFor(); } },
  // The open chats as tabs, beside the full sidebar and beside the rail, and with the right panel open (COD-340).
  { name: 'chat-tabs', open: openTabs },
  { name: 'rail', open: async (page, context) => { await openTabs(page, context); await foldSidebar(page); } },
  { name: 'rail-details', open: async (page, context) => {
    await openTabs(page, context);
    await foldSidebar(page);
    await page.getByRole('button', { name: label('Tùy chọn cuộc trò chuyện'), exact: true }).first().click();
    await page.getByRole('menuitem', { name: label('Chi tiết') }).click();
    await page.locator('.details-pane').first().waitFor({ state: 'attached' });
  } },
  { name: 'worker-dialog', open: (page, context) => openWorkerTab(page, context, 'Chung') },
  { name: 'worker-dialog-permissions', open: (page, context) => openWorkerTab(page, context, 'Quyền') },
  // Every Settings tab, in the dialog's order. One family: they share a panel, so their heading, content edges and the
  // lead column of their list rows are compared with each other (familyFindings in rules.ts).
  { name: 'settings-general', family: 'settings', open: page => openSettingsTab(page, 'Chung') },
  { name: 'settings-chat', family: 'settings', open: page => openSettingsTab(page, 'Cuộc trò chuyện') },
  { name: 'settings-connections', family: 'settings', open: page => openSettingsTab(page, 'Kết nối API') },
  { name: 'settings-search', family: 'settings', open: page => openSettingsTab(page, 'Tìm kiếm web') },
  { name: 'settings-harness', family: 'settings', open: page => openSettingsTab(page, 'Harness trên máy') },
  { name: 'settings-mcp', family: 'settings', open: page => openSettingsTab(page, 'MCP') },
  { name: 'settings-browser', family: 'settings', open: page => openSettingsTab(page, 'Trình duyệt') },
  { name: 'settings-costs', family: 'settings', open: page => openSettingsTab(page, 'Chi phí & giới hạn') },
  { name: 'settings-data', family: 'settings', open: page => openSettingsTab(page, 'Dữ liệu') },
  { name: 'settings-account', family: 'settings', open: page => openSettingsTab(page, 'Tài khoản CodePawl') },
  { name: 'settings-about', family: 'settings', open: page => openSettingsTab(page, 'Giới thiệu') },
];

/** Records one measured pass: the findings, printed, and an outlined screenshot when there are any. */
async function record(page, screen, size, theme, family) {
  const findings = await measure(page);
  const pass = { screen, width: size.width, height: size.height, theme, findings };
  if (family) pass.family = { name: family, metrics: await page.evaluate(() => window.__orgletAlignment.measureFamily()) };
  if (findings.length > 0 || options.allScreenshots) {
    pass.screenshot = join(outputFolder, `${screen}-${size.width}x${size.height}-${theme}.png`);
    await screenshotWithOutlines(page, findings, pass.screenshot);
  }
  passes.push(pass);
  console.log(`${screen} ${size.width}x${size.height} ${theme}: ${findings.length === 0 ? 'clean' : `${findings.length} finding${findings.length === 1 ? '' : 's'}`}`);
  for (const finding of findings) printFinding(pass, finding);
}

async function resize(page, size) {
  await app.evaluate(({ BrowserWindow }, { width, height }) => BrowserWindow.getAllWindows()[0].setContentSize(width, height), size);
  await page.waitForFunction(({ width, height }) => innerWidth === width && innerHeight === height, size);
}

/** The first-run question a new install shows before the app (COD-337), measured before the seed replaces it. */
async function measureFirstRun(page) {
  await page.waitForFunction(() => window.orglet !== undefined);
  await page.locator('.account-choice').waitFor();
  for (const theme of THEMES) {
    await setAppearance(page, theme);
    for (const size of SIZES) {
      await resize(page, size);
      await settle(page);
      await record(page, 'first-run', size, theme);
    }
  }
}

async function measure(page) {
  const installed = await page.evaluate(() => window.__orgletAlignment !== undefined);
  if (!installed) await page.evaluate(measuringSource());
  return page.evaluate(tolerances => window.__orgletAlignment.measurePage(tolerances), rules.DEFAULT_TOLERANCES);
}

async function screenshotWithOutlines(page, findings, path) {
  await page.evaluate(list => window.__orgletAlignment.drawOutlines(list), findings);
  await page.screenshot({ path });
  await page.evaluate(() => window.__orgletAlignment.clearOutlines());
}

function printFinding(pass, finding) {
  console.log(`  [${finding.kind}] ${finding.message}`);
  console.log(`      ${finding.selector}${finding.text ? `  "${finding.text}"` : ''}`);
}

const outputFolder = options.out ?? await mkdtemp(join(tmpdir(), 'orglet-alignment-'));
await mkdir(outputFolder, { recursive: true });
const dataFolder = await mkdtemp(join(tmpdir(), 'orglet-alignment-data-'));
// The Harness tab must never read this machine's sign-ins or ask a vendor for plan usage.
const { env } = await isolatedHarnessEnvironment(dataFolder);
// This check measures the first-run account question too (COD-337), so its empty profile is a new install.
delete env.ORGLET_SKIP_ACCOUNT_CHOICE;
const app = await electron.launch({ executablePath: packagedExecutable(), args: [`--user-data-dir=${dataFolder}`], env });
let closed = false;
app.once('close', () => { closed = true; });
const passes = [];
try {
  const page = await app.firstWindow();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  if (!options.only || options.only.includes('first-run')) await measureFirstRun(page);
  const context = await seedWorkspace(page);
  const screens = SCREENS.filter(screen => !options.only || options.only.includes(screen.name));
  for (const theme of THEMES) {
    await setAppearance(page, theme);
    for (const size of SIZES) {
      await resize(page, size);
      for (const screen of screens) {
        await reset(page, context);
        await screen.open(page, context);
        await settle(page);
        await record(page, screen.name, size, theme, screen.family);
      }
    }
  }
} finally {
  if (!closed) await app.close();
  // The seeded workspace is throwaway; a file the app still holds is left for the system's temp cleanup.
  await rm(dataFolder, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 }).catch(() => {});
}

/**
 * Screens of one family at the same size and theme, compared with each other once all are measured. Each finding joins
 * the pass of the screen that disagrees; that pass's outlined screenshot, taken earlier, does not show it.
 */
function compareFamilies() {
  const groups = new Map();
  for (const pass of passes) {
    if (!pass.family?.metrics) continue;
    const key = `${pass.family.name} ${pass.width}x${pass.height} ${pass.theme}`;
    groups.set(key, [...(groups.get(key) ?? []), pass]);
  }
  for (const [key, members] of groups) {
    const findings = rules.familyFindings(members.map(pass => ({ screen: pass.screen, metrics: pass.family.metrics })), rules.DEFAULT_TOLERANCES.column);
    if (findings.length === 0) continue;
    console.log(`\nfamily ${key}: ${findings.length} finding${findings.length === 1 ? '' : 's'}`);
    for (const finding of findings) {
      const pass = members.find(member => member.screen === finding.screen);
      pass.findings.push({ kind: finding.kind, selector: rules.FAMILY_PANEL_SELECTOR, text: finding.screen, message: finding.message, offset: finding.offset, boxes: finding.boxes });
      console.log(`  [${finding.kind}] ${finding.screen}: ${finding.message}`);
    }
  }
}
compareFamilies();

const counts = {};
for (const pass of passes) for (const finding of pass.findings) counts[finding.kind] = (counts[finding.kind] ?? 0) + 1;
const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
const reportPath = join(outputFolder, 'alignment-report.json');
await writeFile(reportPath, JSON.stringify({ language: options.language, tolerances: rules.DEFAULT_TOLERANCES, counts, passes }, null, 2));
console.log(`\n${total === 0 ? 'No alignment findings.' : `${total} finding${total === 1 ? '' : 's'}: ${Object.entries(counts).map(([kind, count]) => `${count} ${kind}`).join(', ')}`}`);
console.log(`Report: ${reportPath}`);
if (total > 0 && !options.reportOnly) process.exitCode = 1;
