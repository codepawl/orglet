import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as rules from './alignment/rules.ts';
import { en } from '../apps/desktop/src/shared/locales/en.ts';
import { packagedExecutable } from './packaged-executable.mjs';
import { isolatedHarnessEnvironment } from './fake-harnesses.mjs';

// Measures alignment on the packaged app's main screens instead of trusting a screenshot (COD-333). It seeds a
// throwaway workspace on Demo (no provider is called; one crew member runs on a local stand-in for Ollama that holds
// its request, so the island on the prompt bar can be measured), visits each screen at two window sizes in both
// themes, and runs the checks in scripts/alignment/rules.ts in the window. Findings go to stdout, a JSON report and one outlined
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

/**
 * A stand-in for Ollama on its fixed local port, so a crew member's run keeps working while the island docked on the
 * prompt bar is measured: it lists one model and holds every chat request open until the check ends. Nothing leaves
 * the machine. Undefined when the port is taken (a real Ollama), and the island screen is then skipped.
 */
async function startHeldModel() {
  const heldResponses = new Set();
  const sendJson = (response, body) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  };
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url.startsWith('/api/tags')) return sendJson(response, { models: [{ name: HELD_MODEL, model: HELD_MODEL, size: 1 }] });
    if (request.method === 'GET' && request.url.startsWith('/v1/models')) return sendJson(response, { object: 'list', data: [{ id: HELD_MODEL, object: 'model', owned_by: 'alignment-check' }] });
    if (request.method === 'POST' && request.url.startsWith('/v1/chat/completions')) {
      heldResponses.add(response);
      request.on('close', () => heldResponses.delete(response));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  const listening = await new Promise(done => {
    server.once('error', () => done(false));
    server.listen(11434, '127.0.0.1', () => done(true));
  });
  if (!listening) return undefined;
  return {
    close: () => {
      for (const response of heldResponses) response.destroy();
      server.close();
    },
  };
}

const HELD_MODEL = 'held:latest';

/**
 * A stand-in for accounts.codepawl.com (COD-344), so Settings → Account can be measured signed in without a real
 * account or a browser: it hands out a token for any code, answers /me with a made-up profile and takes revokes.
 */
async function startFakeAccounts() {
  const sendJson = (response, body) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  };
  const server = createServer((request, response) => {
    if (request.method === 'POST' && request.url.startsWith('/api/auth/oauth2/token')) return sendJson(response, { access_token: 'alignment-access', refresh_token: 'alignment-refresh', expires_in: 900, token_type: 'Bearer' });
    if (request.method === 'GET' && request.url.startsWith('/me')) return sendJson(response, { id: 'alignment', email: 'an@example.com', name: 'An Nguyen', plan: 'free' });
    if (request.method === 'POST') return sendJson(response, {});
    response.writeHead(404);
    response.end();
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

/** Starts a sign-in whose browser never answers, so the Account tab shows its waiting state. */
async function startSignInThatWaits(page) {
  await app.evaluate(({ shell }) => { shell.openExternal = async () => undefined; });
  await page.evaluate(() => { void window.orglet.accountSignIn().catch(() => undefined); });
}

/**
 * Signs in through the real flow with the browser left out: main's `shell.openExternal` is swapped for one that sends
 * the callback straight back, the way a second instance would, and the fake service answers the rest.
 */
async function signInWithoutBrowser(page) {
  await app.evaluate(({ app: electronApp, shell }) => {
    shell.openExternal = async address => {
      const state = new URL(address).searchParams.get('state');
      const argv = [process.execPath, `com.codepawl.orglet://auth/callback?code=alignment&state=${state}`];
      setTimeout(() => electronApp.emit('second-instance', { preventDefault() {} }, argv, process.cwd(), { argv }), 50);
    };
  });
  await page.evaluate(() => window.orglet.accountSignIn());
}

/** A crew whose member runs on the held model, so a turn of it stays working (COD-167 island in a crew chat). */
async function seedIslandCrew(page, researcher) {
  await page.evaluate(() => window.orglet.connect('ollama'));
  const auditor = await callCore(page, 'saveWorker', { name: 'Run auditor', description: 'Reads run logs and says what failed', instructions: 'Answer clearly and briefly.', provider: 'ollama', modelId: HELD_MODEL, skillId: researcher.skillId, avatar: { color: '#2f9e44' } });
  const workspace = await callCore(page, 'workspace', {});
  const writer = workspace.workers.find(worker => worker.name === 'Writer') ?? researcher;
  return callCore(page, 'saveTeam', { name: 'Release crew', instructions: 'Check the release together.', memberIds: [auditor.id, writer.id], synthesizerId: researcher.id, workflow: 'parallel', monthlyBudgetMicros: 10_000_000 });
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
  // An earlier chat of an orglet, replaced by a newer one: it has no row anywhere in the sidebar, so opening it puts it on
  // the Open list (COD-355). Group chats, side threads and schedule runs have their own rows and never go there.
  const analyst = (await callCore(page, 'workspace', {})).workers.find(worker => worker.name === 'Data analyst');
  const earlierChatBrief = 'Check last month’s sign-up numbers.';
  const earlierChatId = await callCore(page, 'createTask', { workerId: analyst.id, brief: earlierChatBrief, sourceIds: [], consent: false, budgetMicros: 1000 });
  await waitForTask(page, earlierChatId);
  const newerChatId = await callCore(page, 'createTask', { workerId: analyst.id, brief: 'Summarise this week’s sign-ups.', sourceIds: [], consent: false, budgetMicros: 1000 });
  await waitForTask(page, newerChatId);
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
  const islandCrew = heldModel ? await seedIslandCrew(page, researcher) : undefined;
  return { researcher, crew, islandCrew, earlierChatBrief };
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
  // A chat keeps the view it was on (COD-355): come back to its messages.
  const chatView = page.getByRole('tab', { name: label('Trò chuyện'), exact: true });
  if (await chatView.count()) await chatView.click();
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

/**
 * The earlier chat opened from search, the way a chat without a row is found again, so it lands on the Open list
 * (COD-355); then back to the orglet's own chat, whose views (Chat, Schedules) show beside its name.
 */
async function openOpenChats(page, context) {
  await page.keyboard.press('Control+K');
  await page.getByRole('dialog').getByRole('combobox').fill(context.earlierChatBrief);
  await page.getByRole('dialog').getByRole('option').filter({ hasText: context.earlierChatBrief }).first().click();
  await page.locator('.open-chat-row .worker.active').waitFor({ state: 'attached' });
  await openSidebar(page);
  await page.getByRole('button', { name: context.researcher.name, exact: true }).first().click();
  await page.locator('.chat-views').waitFor();
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
  // A crew turn at work: the island on the prompt bar, with the member on the held model still working (COD-167).
  { name: 'crew-chat-island', needs: 'islandCrew', open: async (page, context) => {
    context.islandTaskId = await callCore(page, 'createTask', { workerId: context.researcher.id, teamId: context.islandCrew.id, brief: 'Check the last three run logs and say what failed.', sourceIds: [], consent: true, providerScopes: ['ollama'], budgetMicros: 100_000 });
    await openSidebar(page);
    await page.getByRole('button', { name: context.islandCrew.name, exact: true }).first().click();
    await page.locator('.live-island:not(.leaving)').waitFor();
  }, close: async (page, context) => { await callCore(page, 'cancel', { id: context.islandTaskId }); } },
  { name: 'sidebar-row-menu', open: async (page, context) => { await openSidebar(page); await page.getByRole('button', { name: label('Tùy chọn {0}', [context.researcher.name]), exact: true }).click(); await page.getByRole('menu').waitFor(); } },
  { name: 'schedules', open: async page => { await openSidebar(page); await page.getByRole('button', { name: startsWith('Lịch chạy') }).first().click(); await page.getByRole('region', { name: label('Lịch {0}', ['Morning digest']), exact: true }).waitFor(); } },
  { name: 'schedule-editor', open: async page => { await openSidebar(page); await page.getByRole('button', { name: startsWith('Lịch chạy') }).first().click(); await page.getByRole('button', { name: label('Tạo lịch'), exact: true }).click(); await page.getByLabel(label('Tên lịch'), { exact: true }).waitFor(); } },
  { name: 'empty-chat', open: async page => { await openSidebar(page); await page.getByRole('button', { name: 'Writer', exact: true }).first().click(); await page.getByRole('textbox', { name: label('Tin nhắn') }).waitFor(); } },
  // The Open list beside the full sidebar and on the rail, the chat's views, and the right panel (COD-340, COD-355).
  { name: 'open-chats', open: openOpenChats },
  { name: 'chat-view-schedules', open: async (page, context) => {
    await openOpenChats(page, context);
    await page.getByRole('tab', { name: startsWith('Lịch chạy') }).click();
    await page.getByRole('tabpanel').getByRole('region', { name: label('Lịch {0}', ['Morning digest']), exact: true }).waitFor();
  } },
  { name: 'rail', open: async (page, context) => { await openOpenChats(page, context); await foldSidebar(page); } },
  { name: 'rail-details', open: async (page, context) => {
    await openOpenChats(page, context);
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
  { name: 'settings-account', family: 'settings', open: page => openSettingsTab(page, 'Tài khoản') },
  { name: 'settings-account-signing-in', family: 'settings', open: async page => {
    await startSignInThatWaits(page);
    await openSettingsTab(page, 'Tài khoản');
    await page.getByRole('button', { name: label('Hủy'), exact: true }).waitFor();
  }, close: async page => { await page.evaluate(() => window.orglet.accountCancelSignIn()); } },
  { name: 'settings-account-signed-in', family: 'settings', open: async page => {
    await signInWithoutBrowser(page);
    await openSettingsTab(page, 'Tài khoản');
    await page.getByRole('switch', { name: startsWith('Thống kê sử dụng và báo lỗi') }).waitFor();
  }, close: async page => { await page.evaluate(() => window.orglet.accountSignOut()); } },
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
// The signed-in Account screen signs in against a local stand-in; analytics stays off so nothing is sent even there.
const fakeAccounts = await startFakeAccounts();
env.ORGLET_ACCOUNTS_URL = fakeAccounts.url;
env.ORGLET_ANALYTICS = 'off';
const heldModel = await startHeldModel();
const app = await electron.launch({ executablePath: packagedExecutable(), args: [`--user-data-dir=${dataFolder}`], env });
let closed = false;
app.once('close', () => { closed = true; });
const passes = [];
try {
  const page = await app.firstWindow();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  if (!options.only || options.only.includes('first-run')) await measureFirstRun(page);
  const context = await seedWorkspace(page);
  const screens = SCREENS.filter(screen => (!options.only || options.only.includes(screen.name)) && (!screen.needs || context[screen.needs]));
  if (!heldModel) console.log('crew-chat-island skipped: port 11434 is taken, so the held model could not start');
  for (const theme of THEMES) {
    await setAppearance(page, theme);
    for (const size of SIZES) {
      await resize(page, size);
      for (const screen of screens) {
        await reset(page, context);
        await screen.open(page, context);
        await settle(page);
        await record(page, screen.name, size, theme, screen.family);
        if (screen.close) await screen.close(page, context);
      }
    }
  }
} finally {
  if (!closed) await app.close();
  heldModel?.close();
  fakeAccounts.close();
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
