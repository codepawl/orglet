import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as rules from './alignment/rules.ts';
import { en } from '../apps/desktop/src/shared/locales/en.ts';
import { packagedExecutable } from './packaged-executable.mjs';
import { isolatedHarnessEnvironment } from './fake-harnesses.mjs';
import { openSettings, expandSidebar } from './smoke-language.mjs';
import { writeViewerFixtures } from './viewer-fixtures.mjs';

// Measures alignment on the packaged app's main screens instead of trusting a screenshot (COD-333). It seeds a
// throwaway workspace on Demo (no provider is called; one crew member runs on a local stand-in for Ollama that holds
// its request, so the island on the prompt bar can be measured), visits each screen at two window sizes in both
// themes, and runs the checks in scripts/alignment/rules.ts in the window. Findings go to stdout, a JSON report and one outlined
// screenshot per screen that has any. Exits 1 on findings unless --report-only.
//
//   pnpm test:alignment [--report-only] [--all-screenshots] [--snapshot] [--only schedules,settings-general] [--language en|vi] [--out <folder>]

const SIZES = [{ width: 1200, height: 820 }, { width: 740, height: 600 }];
const THEMES = ['light', 'dark'];

function parseArguments(argv) {
  const options = { reportOnly: false, allScreenshots: false, snapshot: false, only: undefined, language: 'en', out: undefined };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--report-only') options.reportOnly = true;
    else if (argument === '--all-screenshots') options.allScreenshots = true;
    else if (argument === '--snapshot') options.snapshot = true;
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
    if (request.method === 'GET' && request.url.startsWith('/api/tags')) return sendJson(response, { models: [HELD_MODEL, ASKING_MODEL].map(name => ({ name, model: name, size: 1 })) });
    if (request.method === 'GET' && request.url.startsWith('/v1/models')) return sendJson(response, { object: 'list', data: [HELD_MODEL, ASKING_MODEL].map(id => ({ id, object: 'model', owned_by: 'alignment-check' })) });
    if (request.method === 'POST' && request.url.startsWith('/v1/chat/completions')) {
      let body = '';
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => {
        if (JSON.parse(body).model === ASKING_MODEL) return askQuestion(response);
        heldResponses.add(response);
        request.on('close', () => heldResponses.delete(response));
      });
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
/** A model that answers every request by stopping to ask the person a question, so the island's question can be measured. */
const ASKING_MODEL = 'asks:latest';

/** One streamed reply that calls `request_user_decision`, in the chunks an OpenAI-compatible server sends. */
function askQuestion(response) {
  const decision = { question: 'Should the release note go to the early readers first, or to everyone on Friday?', options: ['Early readers first', 'Everyone on Friday', 'Hold it a week'] };
  const chunk = (delta, finish) => ({ id: 'ask', object: 'chat.completion.chunk', created: 0, model: ASKING_MODEL, choices: [{ index: 0, delta, finish_reason: finish ?? null }] });
  const lines = [
    chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_ask', type: 'function', function: { name: 'request_user_decision', arguments: JSON.stringify(decision) } }] }),
    chunk({}, 'tool_calls'),
    { id: 'ask', object: 'chat.completion.chunk', created: 0, model: ASKING_MODEL, choices: [], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } },
  ];
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  response.end(`${lines.map(line => `data: ${JSON.stringify(line)}\n\n`).join('')}data: [DONE]\n\n`);
}

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
  // A side thread of that chat, which opens in the right panel beside it (COD-365).
  // No closing period: the row is named by the chat's title, which drops one (the button's name is the title, not the brief).
  const sideThreadBrief = 'Draft three subject lines for it';
  const sideThreadId = await callCore(page, 'startSideThread', { taskId: chatTaskId, brief: sideThreadBrief, sourceIds: [], consent: false, providerScopes: [], budgetMicros: 1000 });
  await waitForTask(page, sideThreadId);
  // An earlier chat of an orglet, replaced by a newer one: it has no row anywhere in the sidebar, so opening it puts it on
  // the Open list (COD-355). Group chats, side threads and schedule runs have their own rows and never go there.
  const analyst = (await callCore(page, 'workspace', {})).workers.find(worker => worker.name === 'Data analyst');
  const earlierChatBrief = 'Check last month’s sign-up numbers.';
  const earlierChatId = await callCore(page, 'createTask', { workerId: analyst.id, brief: earlierChatBrief, sourceIds: [], consent: false, budgetMicros: 1000 });
  await waitForTask(page, earlierChatId);
  const newerChatId = await callCore(page, 'createTask', { workerId: analyst.id, brief: 'Summarise this week’s sign-ups.', sourceIds: [], consent: false, budgetMicros: 1000 });
  await waitForTask(page, newerChatId);
  await seedViewerFiles(page, analyst);
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
  // One orglet on each stand-in: one stays at work, so its header and the island can be measured mid-turn; one asks.
  const heldOrglet = islandCrew ? islandCrew.memberIds[0] : undefined;
  const askingOrglet = heldModel ? (await callCore(page, 'saveWorker', { name: 'Release planner', description: 'Plans releases and asks before deciding', instructions: 'Answer clearly and briefly.', provider: 'ollama', modelId: ASKING_MODEL, skillId: researcher.skillId, avatar: { color: '#7048e8' } })).id : undefined;
  const channels = await seedChannels(page, crew);
  await seedArchive(page, researcher);
  return { researcher, crew, islandCrew, heldOrglet, askingOrglet, earlierChatBrief, sideThreadBrief, channels };
}

/**
 * One file of every kind the viewer shows, attached to a message in the Data analyst's chat (the native file dialog is
 * answered with the fixtures), so the viewers can be opened from that chat and measured.
 */
async function seedViewerFiles(page, analyst) {
  const files = await writeViewerFixtures(join(dataFolder, 'viewer-files'));
  await app.evaluate(({ dialog }, paths) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths }); }, files.map(file => file.path));
  const sourceIds = (await page.evaluate(() => window.orglet.pickSources())).map(source => source.id);
  const taskId = await callCore(page, 'createTask', { workerId: analyst.id, brief: 'Look through these files.', sourceIds, consent: false, budgetMicros: 1000 });
  await waitForTask(page, taskId);
}

/** Opens one of the seeded files in the viewer, from the Data analyst's chat, and waits until its content is drawn. */
async function openViewerFile(page, name, ready) {
  await openArea(page, 'Trò chuyện');
  await page.locator('.sidebar').getByRole('button', { name: 'Data analyst', exact: true }).first().click();
  await page.getByRole('button', { name: new RegExp('^' + name.replace('.', '\\.')) }).first().click();
  await page.locator('#source-viewer').waitFor();
  await page.locator('#source-viewer ' + ready).first().waitFor();
}

/** A channel of an orglet and a crew with one answered message, and an empty one (COD-361). */
async function seedChannels(page, crew) {
  const writer = (await callCore(page, 'workspace', {})).workers.find(worker => worker.name === 'Writer');
  const members = [{ kind: 'orglet', id: writer.id }, { kind: 'crew', id: crew.id }];
  const channelId = await callCore(page, 'createChannel', { name: 'launch', topic: 'Ship the newsletter on Friday and tell the early readers first', members });
  const workspace = await callCore(page, 'workspace', {});
  const orgletIds = [writer.id, ...[...crew.memberIds, crew.synthesizerId].filter(id => id !== writer.id)];
  const taskId = await callCore(page, 'createTask', { workerId: writer.id, assignees: orgletIds, channelId, brief: 'What should go into Friday’s first issue?', sourceIds: [], consent: false, budgetMicros: 1000 });
  await waitForTask(page, taskId);
  await callCore(page, 'createChannel', { name: 'ideas', topic: '', members: [{ kind: 'orglet', id: workspace.workers[0].id }] });
  // A space with a category (docs/spaces-design.md): one channel for everyone in it, one with its own list.
  const spaceOrgletIds = workspace.workers.slice(0, 3).map(worker => worker.id);
  const spaceId = await callCore(page, 'createSpace', { name: 'Studio', orgletIds: spaceOrgletIds, categories: [{ name: 'Copy' }] });
  const copy = (await callCore(page, 'workspace', {})).spaces.find(space => space.id === spaceId).categories[0];
  const everyone = [{ kind: 'orglet', id: spaceOrgletIds[0] }];
  await callCore(page, 'createChannel', { name: 'general', topic: '', members: everyone, spaceId });
  await callCore(page, 'createChannel', { name: 'drafts', topic: '', members: everyone, spaceId, categoryId: copy.id, access: 'listed' });
  return { launch: '#launch', ideas: '#ideas' };
}

/**
 * One archived orglet, one archived chat of it and one archived channel, so Settings → Lưu trữ shows every group (COD-375).
 * Archived last and kept away from the screens above: none of them is a row anywhere else.
 */
async function seedArchive(page, researcher) {
  const retired = await callCore(page, 'saveWorker', { name: 'Retired helper', description: 'Handled an old project', instructions: 'Answer clearly and briefly.', provider: 'demo', skillId: researcher.skillId });
  const retiredChatId = await callCore(page, 'createTask', { workerId: retired.id, brief: 'Wrap up the old project and list what is left.', sourceIds: [], consent: false, budgetMicros: 1000 });
  await waitForTask(page, retiredChatId);
  const retroChannelId = await callCore(page, 'createChannel', { name: 'retro', topic: '', members: [{ kind: 'orglet', id: researcher.id }] });
  const retroTaskId = await callCore(page, 'createTask', { workerId: researcher.id, assignees: [researcher.id], channelId: retroChannelId, brief: 'What went well last month?', sourceIds: [], consent: false, budgetMicros: 1000 });
  await waitForTask(page, retroTaskId);
  // A finished turn can still be wrapping up when its status flips; the core refuses to archive until it has.
  await archiveWhenIdle(page, 'archiveTask', { id: retiredChatId, archived: true });
  await archiveWhenIdle(page, 'archiveTask', { id: retroTaskId, archived: true });
  await archiveWhenIdle(page, 'archiveEntity', { kind: 'worker', id: retired.id, archived: true });
}

/** Starts a turn in an orglet's main chat on a stand-in model and opens the chat from search until `ready` shows. */
async function openOrgletTurn(page, context, workerId, name, brief, ready) {
  context.turnTaskId = await callCore(page, 'createTask', { workerId, brief, sourceIds: [], consent: true, providerScopes: ['ollama'], budgetMicros: 100_000 });
  await page.keyboard.press('Control+K');
  await page.getByRole('dialog').getByRole('combobox').fill(name);
  await page.getByRole('dialog').getByRole('option').filter({ hasText: name }).first().click();
  await page.locator(ready).waitFor();
}

/** Stops the turn `openOrgletTurn` started and deletes its chat, so the Activity and Archive screens measure the same workspace as before. */
async function stopOrgletTurn(page, context) {
  await callCore(page, 'cancel', { id: context.turnTaskId });
  await page.waitForFunction(async taskId => ['cancelled', 'failed', 'completed'].includes((await window.orglet.call('task', { id: taskId })).task.status), context.turnTaskId);
  await archiveWhenIdle(page, 'archiveTask', { id: context.turnTaskId, archived: true }, 'Công việc đang chạy. Dừng trước khi lưu trữ.');
  await callCore(page, 'deleteTask', { id: context.turnTaskId });
}

async function archiveWhenIdle(page, command, input, expectedBusyMessage) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await callCore(page, command, input);
    } catch (error) {
      if (expectedBusyMessage && !(error instanceof Error && error.message.includes(expectedBusyMessage))) {
        throw error;
      }
      if (attempt >= 40) throw error;
      await page.waitForTimeout(500);
    }
  }
}

async function settle(page) {
  // Measure what the person reads, not the placeholder bars shown while a tab loads (the harness rows take seconds).
  await page.waitForFunction(() => !document.querySelector('.org-skeleton-group'), undefined, { timeout: 30_000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready.then(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))));
  await page.waitForTimeout(300);
}

async function openSidebar(page) {
  await expandSidebar(page);
}

/** Back to a known state: no dialog, no menu, the sidebar showing the orglet's chat. */
async function reset(page, context) {
  for (let attempt = 0; attempt < 3 && await page.locator('[role=dialog], [role=menu]').count(); attempt++) await page.keyboard.press('Escape');
  // The right panel is part of the page, and a tab remembers it (COD-340): close it so the next screen starts without.
  if (await page.locator('.details-pane').count()) await page.keyboard.press('Escape');
  await openArea(page, 'Trò chuyện');
  await page.getByRole('button', { name: context.researcher.name, exact: true }).first().click();
  // A chat keeps the view it was on (COD-355): come back to its messages.
  const backToChat = page.locator('.topbar-back-to-chat');
  if (await backToChat.count()) await backToChat.click();
  await page.getByRole('textbox', { name: label('Tin nhắn') }).waitFor();
}

async function openSettingsTab(page, tab) {
  await openSidebar(page);
  await openSettings(page);
  await page.getByRole('tab', { name: label(tab), exact: true }).click();
}

async function openWorkerTab(page, context, tab) {
  await openArea(page, 'Trò chuyện');
  await page.locator('.sidebar').getByRole('button', { name: label('Tùy chọn {0}', [context.researcher.name]), exact: true }).first().click();
  await page.getByRole('menuitem', { name: label('Chỉnh sửa') }).click();
  await page.getByRole('tab', { name: label(tab), exact: true }).click();
}

/**
 * The earlier chat opened from search, the way a chat without a row is found again, so it lands on the Open list
 * (COD-355); then back to the orglet's own chat, whose other views (Schedules) open from its menu.
 */
async function openOpenChats(page, context) {
  await page.keyboard.press('Control+K');
  await page.getByRole('dialog').getByRole('combobox').fill(context.earlierChatBrief);
  await page.getByRole('dialog').getByRole('option').filter({ hasText: context.earlierChatBrief }).first().click();
  await page.locator('.open-chat-row .worker.active').waitFor({ state: 'attached' });
  await openArea(page, 'Trò chuyện');
  await page.getByRole('button', { name: context.researcher.name, exact: true }).first().click();
  await page.getByRole('textbox', { name: label('Tin nhắn') }).waitFor();
}

/** Folds the sidebar to the rail (COD-340); the next reset opens it again. A narrow window has folded it already. */
async function foldSidebar(page) {
  const fold = page.getByRole('button', { name: label('Thu gọn sidebar'), exact: true });
  if (await fold.isVisible()) await fold.click();
  await page.locator('.app.sidebar-hidden').waitFor();
}

/** The area rail (COD-366): Home lists the orglets, Channels the channels. */
/** The seeded space's tile on the rail, which lists its channels in the sidebar. */
async function openSpace(page) {
  await openSidebar(page);
  await page.locator('.area-tile[data-name="Studio"]').click();
  await page.locator('.sidebar .channel-row').first().waitFor();
}

async function openArea(page, vietnamese) {
  await openSidebar(page);
  await page.locator(`.area-tile[data-name="${label(vietnamese)}"]`).click();
}

const SCREENS = [
  { name: 'chat', open: async () => {} },
  // An answer pointed at: its toolbar floats at its top right (COD-365).
  { name: 'chat-message-toolbar', open: async page => { await page.locator('.main-pane .assistant-message').first().hover(); await page.locator('.main-pane .assistant-message .message-actions').first().waitFor(); } },
  // A side thread opened from its row: in the right panel beside its main chat, or in the main card when the window has no room for the panel.
  { name: 'side-thread-panel', open: async (page, context) => {
    await openSidebar(page);
    await page.getByRole('button', { name: context.sideThreadBrief, exact: true }).click();
    await page.locator('.thread-pane .chat-reply, .main-pane .side-thread-origin').first().waitFor();
  } },
  { name: 'chat-options-menu', open: async page => { await page.getByRole('button', { name: label('Tùy chọn cuộc trò chuyện'), exact: true }).first().click(); await page.getByRole('menu').waitFor(); } },
  { name: 'composer-add-menu', open: async page => { await page.getByRole('button', { name: label('Thêm nguồn'), exact: true }).first().click(); await page.getByRole('menu').waitFor(); } },
  { name: 'crew-chat', open: async (page, context) => { await openArea(page, 'Kênh'); await page.getByRole('button', { name: `#${context.crew.name}`, exact: true }).first().click(); await page.locator('.chat-reply, .report').first().waitFor(); } },
  // A member's profile card and its right-click menu. The member column is only there in a wide window.
  { name: 'member-card', open: async (page, context) => { await openArea(page, 'Kênh'); await page.getByRole('button', { name: `#${context.crew.name}`, exact: true }).first().click(); await page.locator('.chat-reply, .report').first().waitFor(); if (await page.locator('.members-pane').count()) { await page.locator('.member-item .member-row').first().click(); await page.locator('.member-card').waitFor(); } } },
  { name: 'member-menu', open: async (page, context) => { await openArea(page, 'Kênh'); await page.getByRole('button', { name: `#${context.crew.name}`, exact: true }).first().click(); await page.locator('.chat-reply, .report').first().waitFor(); if (await page.locator('.members-pane').count()) { await page.locator('.member-item .member-row').first().click({ button: 'right' }); await page.getByRole('menu').waitFor(); } } },
  // A crew turn at work: the island on the prompt bar, with the member on the held model still working (COD-167).
  { name: 'crew-chat-island', needs: 'islandCrew', open: async (page, context) => {
    context.islandTaskId = await callCore(page, 'createTask', { workerId: context.researcher.id, teamId: context.islandCrew.id, brief: 'Check the last three run logs and say what failed.', sourceIds: [], consent: true, providerScopes: ['ollama'], budgetMicros: 100_000 });
    // The crew's first turn makes its channel, outside every space, and a running channel is not moved into one:
    // it has no row yet, so it is opened the way a chat without a row is, from search.
    await page.keyboard.press('Control+K');
    await page.getByRole('dialog').getByRole('combobox').fill(context.islandCrew.name);
    await page.getByRole('dialog').getByRole('option').filter({ hasText: context.islandCrew.name }).first().click();
    await page.locator('.live-island:not(.leaving)').waitFor();
  }, close: async (page, context) => {
    await callCore(page, 'cancel', { id: context.islandTaskId });
    // Stop requests cancellation; metadata preparation and member runs finish asynchronously.
    await page.waitForFunction(async taskId => {
      const detail = await window.orglet.call('task', { id: taskId });
      return detail.task.status === 'cancelled';
    }, context.islandTaskId);
    // The crew is a channel now: a second turn started the same way would add a second row for it, and the first one would be opened. Archiving the stopped chat leaves the crew its empty channel, which the next first message takes.
    // A cancelled task can still have run cleanup in progress; the archive guard is the authority.
    await archiveWhenIdle(page, 'archiveTask', { id: context.islandTaskId, archived: true }, 'Công việc đang chạy. Dừng trước khi lưu trữ.');
  } },
  // One orglet mid-turn: its header (name, connection, time on one baseline) and the island (user, 2026-10-07).
  { name: 'chat-running', needs: 'heldOrglet', open: (page, context) => openOrgletTurn(page, context, context.heldOrglet, 'Run auditor', 'Check the last run log and say what failed.', '.live-island:not(.leaving)'),
    close: stopOrgletTurn },
  // An orglet that stopped to ask: the question, its choices and a line for the person's own answer, in the island.
  { name: 'decision-island', needs: 'askingOrglet', open: (page, context) => openOrgletTurn(page, context, context.askingOrglet, 'Release planner', 'Plan the release note for Friday.', '.live-island-decision'),
    close: stopOrgletTurn },
  // The same question with a choice picked: its row filled and the note line under the choices.
  { name: 'decision-island-note', needs: 'askingOrglet', open: async (page, context) => {
    await openOrgletTurn(page, context, context.askingOrglet, 'Release planner', 'Plan the release note for Friday.', '.live-island-decision');
    await page.locator('.live-island-choice[role=radio]').first().click();
    await page.locator('.live-island-note').waitFor();
  }, close: stopOrgletTurn },
  // The file viewer's previews (user, 2026-10-07: "file viewers look ugly"): a table, JSON, code, Markdown, a picture and a PDF.
  { name: 'viewer-table', open: page => openViewerFile(page, 'customers.csv', '.preview-table-scroll tbody tr') },
  { name: 'viewer-table-filtered', open: async page => {
    await openViewerFile(page, 'customers.csv', '.preview-table-scroll tbody tr');
    await page.getByRole('searchbox', { name: label('Lọc dòng'), exact: true }).fill('north');
    await page.locator('#source-viewer .preview-bar-summary', { hasText: /^[\d,]+ of / }).waitFor();
  } },
  { name: 'viewer-table-empty', open: async page => {
    await openViewerFile(page, 'customers.csv', '.preview-table-scroll tbody tr');
    await page.getByRole('searchbox', { name: label('Lọc dòng'), exact: true }).fill('zzzz');
    await page.locator('#source-viewer .table-empty').waitFor();
  } },
  { name: 'viewer-json', open: page => openViewerFile(page, 'sample.json', '.json-tree .json-node') },
  { name: 'viewer-json-raw', open: async page => {
    await openViewerFile(page, 'sample.json', '.json-tree .json-node');
    await page.getByRole('tab', { name: label('Văn bản gốc'), exact: true }).click();
    await page.locator('#source-viewer .code-preview').waitFor();
  } },
  { name: 'viewer-code', open: page => openViewerFile(page, 'count-lines.ts', '.code-preview .line-number') },
  { name: 'viewer-code-nowrap', open: async page => {
    await openViewerFile(page, 'count-lines.ts', '.code-preview .line-number');
    await page.getByRole('button', { name: label('Xuống dòng tự động'), exact: true }).click();
    await page.locator('#source-viewer .no-wrap').waitFor();
  } },
  { name: 'viewer-markdown', open: page => openViewerFile(page, 'notes.md', '.markdown-preview .source-document') },
  { name: 'viewer-image', open: async page => {
    await openViewerFile(page, 'disc.png', '.media-image img');
    await page.locator('#source-viewer .media-image img').evaluate(image => image.decode());
  } },
  { name: 'viewer-pdf', open: page => openViewerFile(page, 'report.pdf', '.pdf-page') },
  { name: 'sidebar-row-menu', open: async (page, context) => { await openArea(page, 'Trò chuyện'); await page.getByRole('button', { name: label('Tùy chọn {0}', [context.researcher.name]), exact: true }).first().click(); await page.getByRole('menu').waitFor(); } },
  { name: 'schedules', open: async page => { await openSidebar(page); await page.getByRole('button', { name: startsWith('Lịch chạy') }).first().click(); await page.getByRole('region', { name: label('Lịch {0}', ['Morning digest']), exact: true }).waitFor(); } },
  // The app trigger (stage 4): a connected app, its read-only tool, arguments, how often and words. The app here was
  // never reached, so the form says it has no read-only tool yet; nothing goes over the network.
  { name: 'schedule-editor-app', open: async page => {
    await page.evaluate(() => window.orglet.saveMcpServer({ name: 'Tracker', enabled: true, transport: { kind: 'http', url: 'https://tracker.example/mcp', headers: [], oauth: true } }));
    await openSidebar(page);
    await page.getByRole('button', { name: startsWith('Lịch chạy') }).first().click();
    await page.getByRole('button', { name: label('Tạo lịch'), exact: true }).click();
    await page.getByRole('combobox', { name: label('Bắt đầu') }).click();
    await page.getByRole('option', { name: label('Khi có mục mới trong ứng dụng') }).click();
    await page.locator('.routine-app textarea').waitFor();
  }, close: page => page.evaluate(async () => {
    for (const server of (await window.orglet.call('workspace', {})).mcpServers ?? []) await window.orglet.removeMcpServer(server.id);
  }) },
  { name: 'schedule-editor', open: async page => { await openSidebar(page); await page.getByRole('button', { name: startsWith('Lịch chạy') }).first().click(); await page.getByRole('button', { name: label('Tạo lịch'), exact: true }).click(); await page.getByLabel(label('Tên lịch'), { exact: true }).waitFor(); } },
  // Channels (COD-361): one written in, its settings, a new one, and one still empty.
  { name: 'channel-chat', open: async (page, context) => { await openArea(page, 'Kênh'); await page.getByRole('button', { name: context.channels.launch, exact: true }).first().click(); await page.locator('.topbar-topic').waitFor(); } },
  { name: 'channel-members', open: async (page, context) => {
    await openArea(page, 'Kênh');
    await page.getByRole('button', { name: context.channels.launch, exact: true }).first().click();
    await page.getByRole('button', { name: label('Tùy chọn cuộc trò chuyện'), exact: true }).click();
    await page.getByRole('menuitem', { name: label('Thành viên'), exact: true }).click();
    await page.getByRole('dialog').waitFor();
  } },
  { name: 'channel-empty', open: async (page, context) => { await openArea(page, 'Kênh'); await page.getByRole('button', { name: context.channels.ideas, exact: true }).first().click(); await page.getByRole('textbox', { name: label('Tin nhắn') }).waitFor(); } },
  // A space: its sidebar with a category and a locked channel, its editor, and a channel being made in it.
  { name: 'space-sidebar', open: async page => { await openSpace(page); } },
  { name: 'space-dialog-members', open: async page => { await openSpace(page); await page.getByRole('button', { name: label('Tùy chọn không gian {0}', ['Studio']), exact: true }).click(); await page.getByRole('menuitem', { name: label('Thành viên'), exact: true }).click(); await page.getByRole('dialog').waitFor(); } },
  { name: 'space-dialog-categories', open: async page => { await openSpace(page); await page.getByRole('button', { name: label('Tùy chọn không gian {0}', ['Studio']), exact: true }).click(); await page.getByRole('menuitem', { name: label('Thiết lập không gian'), exact: true }).click(); await page.getByRole('dialog').getByRole('tab', { name: label('Nhóm'), exact: true }).click(); await page.locator('.space-category').first().waitFor(); } },
  // A new category has a dialog of its own, from the space's +: its name, then who is in it.
  { name: 'category-dialog', open: async page => { await openSpace(page); await page.getByRole('button', { name: label('Tạo trong không gian {0}', ['Studio']), exact: true }).click(); await page.getByRole('menuitem', { name: label('Tạo nhóm'), exact: true }).click(); await page.getByRole('dialog').getByRole('textbox', { name: label('Tên nhóm') }).waitFor(); } },
  { name: 'category-dialog-members', open: async page => { await openSpace(page); await page.getByRole('button', { name: label('Tạo trong không gian {0}', ['Studio']), exact: true }).click(); await page.getByRole('menuitem', { name: label('Tạo nhóm'), exact: true }).click(); await page.getByRole('dialog').getByRole('tab', { name: label('Thành viên'), exact: true }).click(); await page.getByRole('dialog').getByRole('combobox').first().waitFor(); } },
  // A new channel starts with a lead who takes untagged messages (owner, 2026-10-07): its How tab with the lead's fields.
  { name: 'channel-dialog-how', open: async page => { await openSpace(page); await page.locator('.sidebar-head').getByRole('button', { name: label('Tạo trong không gian {0}', ['Studio']), exact: true }).click(); await page.getByRole('menuitem', { name: label('Tạo kênh'), exact: true }).click(); await page.getByRole('dialog').getByRole('tab', { name: label('Cách làm việc'), exact: true }).click(); await page.getByRole('dialog').getByText(label('Tí trưởng'), { exact: true }).first().waitFor(); } },
  { name: 'space-channel-dialog', open: async page => { await openSpace(page); await page.locator('.sidebar-head').getByRole('button', { name: label('Tạo trong không gian {0}', ['Studio']), exact: true }).click(); await page.getByRole('menuitem', { name: label('Tạo kênh'), exact: true }).click(); await page.getByRole('dialog').getByRole('tab', { name: label('Thành viên'), exact: true }).click(); await page.locator('.channel-scope').waitFor(); } },
  // The area rail's pages (COD-366): Home's Add orglet page, and Activity.
  { name: 'friends-add', open: async page => { await openArea(page, 'Trò chuyện'); await page.locator('.sidebar').getByRole('button', { name: label('Thêm Tí'), exact: true }).click(); await page.locator('.friends-add-form').waitFor(); } },
  { name: 'marketplace', open: async page => { await openArea(page, 'Trò chuyện'); await page.locator('.sidebar').getByRole('button', { name: 'Marketplace', exact: true }).click(); await page.locator('.marketplace-listing').first().waitFor(); } },
  { name: 'activity', open: async page => { await openArea(page, 'Hoạt động'); await page.locator('.page-body').waitFor(); } },
  { name: 'empty-chat', open: async page => { await openArea(page, 'Trò chuyện'); await page.getByRole('button', { name: 'Writer', exact: true }).first().click(); await page.getByRole('textbox', { name: label('Tin nhắn') }).waitFor(); } },
  // The Open list beside the full sidebar and on the rail, the chat's views, and the right panel (COD-340, COD-355).
  { name: 'open-chats', open: openOpenChats },
  { name: 'chat-view-schedules', open: async (page, context) => {
    await openOpenChats(page, context);
    // The chat's other views open from its menu (user, 2026-10-07).
    await page.getByRole('button', { name: label('Tùy chọn cuộc trò chuyện'), exact: true }).click();
    await page.getByRole('menuitem', { name: startsWith('Lịch chạy') }).click();
    await page.locator('#chat-view-panel').getByRole('region', { name: label('Lịch {0}', ['Morning digest']), exact: true }).waitFor();
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
  // Archived orglets, channels and chats, with Restore and the auto-delete rule (COD-375).
  { name: 'settings-archive', family: 'settings', open: page => openSettingsTab(page, 'Lưu trữ') },
  { name: 'settings-connections', family: 'settings', open: page => openSettingsTab(page, 'Kết nối API') },
  { name: 'settings-search', family: 'settings', open: page => openSettingsTab(page, 'Tìm kiếm web') },
  { name: 'settings-harness', family: 'settings', open: page => openSettingsTab(page, 'Harness trên máy') },
  { name: 'settings-mcp', family: 'settings', open: page => openSettingsTab(page, 'MCP') },
  // An app that signs in through the browser, saved but not signed in yet: its row asks for the sign-in (stage 4).
  // Nothing goes over the network: a server with no sign-in is not even tried.
  { name: 'settings-mcp-sign-in', family: 'settings', open: async page => {
    await page.evaluate(async () => {
      const saved = await window.orglet.saveMcpServer({ name: 'Linear', enabled: true, transport: { kind: 'http', url: 'https://mcp.linear.app/mcp', headers: [], oauth: true } });
      await window.orglet.call('testMcpServer', { id: saved.id });
    });
    await openSettingsTab(page, 'MCP');
    await page.getByText(label('Cần đăng nhập'), { exact: true }).first().waitFor();
  }, close: page => page.evaluate(async () => {
    for (const server of (await window.orglet.call('workspace', {})).mcpServers ?? []) await window.orglet.removeMcpServer(server.id);
  }) },
  // GitHub takes a token: the form opens filled in, with where to make one.
  { name: 'mcp-token-form', family: 'settings', open: async page => {
    await openSettingsTab(page, 'MCP');
    await page.getByRole('button', { name: label('Thêm token'), exact: true }).click();
    await page.getByRole('dialog').getByText(label('Tạo token tại {0}', ['https://github.com/settings/personal-access-tokens/new']), { exact: true }).waitFor();
  } },
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
  if (options.snapshot) await writeFile(join(outputFolder, `${screen}-${size.width}x${size.height}-${theme}.html`), await snapshotHtml(page));
  passes.push(pass);
  console.log(`${screen} ${size.width}x${size.height} ${theme}: ${findings.length === 0 ? 'clean' : `${findings.length} finding${findings.length === 1 ? '' : 's'}`}`);
  for (const finding of findings) printFinding(pass, finding);
}

/**
 * The screen as one HTML file that renders without the app: the DOM as it stands, with every stylesheet's rules
 * written inline and the scripts left out, for page-level tools that take a file (Loupe, 2026-10-07).
 */
async function snapshotHtml(page) {
  return page.evaluate(() => {
    const rules = [...document.styleSheets].flatMap(sheet => {
      try { return [...sheet.cssRules].map(rule => rule.cssText); } catch { return []; }
    });
    const copy = document.documentElement.cloneNode(true);
    copy.querySelectorAll('script, link[rel=stylesheet], style, meta[http-equiv], [data-align-overlay]').forEach(element => element.remove());
    const style = document.createElement('style');
    style.textContent = rules.join('\n');
    copy.querySelector('head').append(style);
    return `<!doctype html>\n${copy.outerHTML}`;
  });
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
