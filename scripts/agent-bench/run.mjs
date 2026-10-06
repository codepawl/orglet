// Runs the live agent tasks in tasks.mjs against the packaged app, one fresh profile and one recorded window per task,
// and saves what happened: the video (idle stretches sped up), the chat as JSON and Markdown, and every console or
// page error. `grade.mjs` scores the saved chats. Real models are called; nothing here fakes a reply unless
// --provider demo is given, which only proves the pipeline.
//
//   node scripts/agent-bench/run.mjs --provider cursor [--only finance,swe] [--out <folder>] [--timeout-minutes 15]

import { _electron as electron } from 'playwright';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packagedExecutable } from '../packaged-executable.mjs';
import { openChannels, openHome, useVietnamese } from '../smoke-language.mjs';
import { tasks } from './tasks.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures');
const finished = new Set(['completed', 'failed', 'cancelled', 'partial', 'waiting_input', 'paused']);

function parseArguments(argv) {
  const options = { provider: 'cursor', only: undefined, out: undefined, timeoutMinutes: 15 };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--provider') options.provider = argv[++index];
    else if (argument === '--only') options.only = argv[++index].split(',');
    else if (argument === '--out') options.out = resolve(argv[++index]);
    else if (argument === '--timeout-minutes') options.timeoutMinutes = Number(argv[++index]);
    else throw new Error(`Unknown argument ${argument}`);
  }
  return options;
}

const options = parseArguments(process.argv.slice(2));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outRoot = options.out ?? join(tmpdir(), `orglet-agent-bench-${stamp}`);
await mkdir(outRoot, { recursive: true });

const callCore = (page, command, args) => page.evaluate(([name, input]) => window.orglet.call(name, input), [command, args]);

/** The next file or folder dialog answers with these paths, as if the person picked them. */
async function answerNextDialog(app, paths) {
  await app.evaluate(({ dialog }, picked) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: picked }); }, paths);
}

async function launch(profile, videoDir) {
  const env = { ...process.env, ORGLET_SKIP_ACCOUNT_CHOICE: '1', ORGLET_ANALYTICS: 'off' };
  delete env.ELECTRON_RUN_AS_NODE;
  if (options.provider === 'demo') env.ORGLET_DEMO_REPLIES = '1';
  const app = await electron.launch({ executablePath: packagedExecutable(), args: [`--user-data-dir=${profile}`], env, recordVideo: { dir: videoDir, size: { width: 1280, height: 800 } } });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setSize(1280, 800); window.center(); });
  return { app, page };
}

/** The orglet or the channel the task talks to, set up the way a person would have it. */
async function setUp(app, page, task, workDir) {
  const workspace = await callCore(page, 'workspace', {});
  const base = workspace.workers[0];
  if (task.template) {
    // A template starts on Demo, as Add orglet makes it; then each of its orglets moves to the connection under test.
    const team = await callCore(page, 'createTemplate', { templateId: task.template, provider: 'demo' });
    const members = (await callCore(page, 'workspace', {})).workers.filter(worker => [...team.memberIds, team.synthesizerId].includes(worker.id));
    for (const member of members) await callCore(page, 'saveWorker', { ...member, provider: options.provider, expectedRevision: member.revision });
    if (task.capabilities.length) await callCore(page, 'setToolCapabilities', { teamId: team.id, capabilities: task.capabilities });
    return { teamId: team.id, workerId: team.synthesizerId, label: `#${team.name}` };
  }
  const worker = await callCore(page, 'saveWorker', { name: task.orglet, instructions: base.instructions, provider: options.provider, skillId: base.skillId, description: task.benchmark });
  await callCore(page, 'setToolCapabilities', { workerId: worker.id, capabilities: task.capabilities });
  if (task.folder) {
    const folder = join(workDir, task.folder);
    await cp(join(fixtures, task.folder), folder, { recursive: true });
    spawnSync('git', ['init', '-q'], { cwd: folder });
    spawnSync('git', ['-c', 'user.name=bench', '-c', 'user.email=bench@example.com', 'add', '-A'], { cwd: folder });
    spawnSync('git', ['-c', 'user.name=bench', '-c', 'user.email=bench@example.com', 'commit', '-q', '-m', 'start'], { cwd: folder });
    await answerNextDialog(app, [folder]);
    await page.evaluate(([workerId, permissions]) => window.orglet.pickNewChatWorkspace({ workerId }, permissions), [worker.id, task.folderPermissions]);
  }
  return { workerId: worker.id, label: task.orglet };
}

async function openChat(page, target) {
  if (target.teamId) {
    await openChannels(page);
    await page.getByRole('button', { name: target.label, exact: true }).first().click();
  } else {
    await openHome(page);
    await page.locator('.sidebar').getByText(target.label, { exact: true }).first().click();
  }
  await page.getByRole('textbox', { name: /Tin nhắn|Nhắn/ }).first().waitFor();
}

async function attachFiles(app, page, task, workDir) {
  if (!task.files.length) return;
  const copies = [];
  for (const file of task.files) {
    const copy = join(workDir, 'files', file);
    await mkdir(dirname(copy), { recursive: true });
    await cp(join(fixtures, file), copy);
    copies.push(copy);
  }
  await answerNextDialog(app, copies);
  await page.getByRole('button', { name: 'Thêm nguồn' }).first().click();
  await page.getByRole('menuitem', { name: /Tệp/ }).click();
  await page.waitForTimeout(1500);
}

/** Types the message the way a person does, then sends it and answers a consent prompt if one appears. */
async function send(page, message, problems) {
  // The connection's sign-in is read when the app starts; sending waits until the bar no longer asks to connect.
  await page.getByText('Cần kết nối trước khi gửi.').waitFor({ state: 'detached', timeout: 90_000 }).catch(() => problems.push('composer still asked to connect after 90 s'));
  const box = page.getByRole('textbox', { name: /Tin nhắn|Nhắn/ }).first();
  await box.click();
  const typingStarted = Date.now();
  await box.pressSequentially(message, { delay: 8, timeout: 180_000 });
  const typingMs = Date.now() - typingStarted;
  if (typingMs > message.length * 40) problems.push(`typing ${message.length} characters took ${typingMs} ms`);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
  return typingMs;
}

async function chatOf(page, target, startedAt) {
  const workspace = await callCore(page, 'workspace', {});
  const task = workspace.tasks.find(item => (target.teamId ? item.teamId === target.teamId : item.workerId === target.workerId && !item.teamId) && !item.sideOf && Date.parse(item.createdAt ?? 0) >= startedAt - 60_000)
    ?? workspace.tasks.find(item => (target.teamId ? item.teamId === target.teamId : item.workerId === target.workerId) && !item.sideOf);
  return task ? callCore(page, 'task', { id: task.id }) : undefined;
}

async function waitForAnswer(page, target, startedAt) {
  const deadline = Date.now() + options.timeoutMinutes * 60_000;
  let detail;
  while (Date.now() < deadline) {
    detail = await chatOf(page, target, startedAt);
    if (detail && finished.has(detail.task.status) && !detail.runs.some(run => run.status === 'running' || run.status === 'queued')) return { detail, timedOut: false };
    await page.waitForTimeout(3000);
  }
  return { detail, timedOut: true };
}

function transcriptOf(task, detail, problems) {
  const lines = [`# ${task.id} · ${task.benchmark}`, '', `Status: ${detail?.task.status ?? 'no chat'}`, ''];
  lines.push(`**Person:** ${task.message}`, '');
  for (const request of detail?.task.decisionRequests ?? []) lines.push(`**Question:** ${request.question} · options: ${request.options.join(" / ")} · answer: ${request.answer ?? "-"}`, "");
  for (const artifact of detail?.artifacts ?? []) {
    const author = detail.runs.find(run => run.id === artifact.runId)?.snapshot.worker.name ?? '?';
    lines.push(`**${author}:** ${artifact.report.summary}`, '');
  }
  const reactions = detail?.task.messageReactions ?? [];
  if (reactions.length) lines.push(`Reactions: ${JSON.stringify(reactions)}`, '');
  lines.push('## Steps', ...(detail?.events ?? []).map(event => `- ${event.message}`), '');
  for (const run of detail?.runs ?? []) if (run.error) lines.push(`Run ${run.snapshot.worker.name} ${run.status}: ${run.error}`);
  if (problems.length) lines.push('', '## Problems', ...problems.map(problem => `- ${problem}`));
  return lines.join('\n');
}

/** Drops the frames where nothing moves, so a long wait plays in a moment and the typing and the answer stay. */
function speedUp(input, output) {
  const result = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', input, '-vf', 'mpdecimate=hi=64*24:lo=64*8:frac=0.2,setpts=N/(25*TB)', '-r', '25', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '26', output], { encoding: 'utf8' });
  return result.status === 0 ? undefined : result.stderr;
}

const selected = tasks.filter(task => !options.only || options.only.includes(task.id));
const summary = [];
for (const task of selected) {
  const taskDir = join(outRoot, task.id);
  const profile = await mkdtemp(join(tmpdir(), `orglet-bench-${task.id}-`));
  await mkdir(taskDir, { recursive: true });
  const problems = [];
  const { app, page } = await launch(profile, join(taskDir, 'raw'));
  page.on('console', message => { if (message.type() === 'error') problems.push(`console: ${message.text().slice(0, 400)}`); });
  page.on('pageerror', error => problems.push(`page error: ${error.message.slice(0, 400)}`));
  app.process().stderr?.on('data', chunk => { const text = String(chunk); if (/error|exception/i.test(text) && !/DevTools|GPU|gpu_|Autofill/.test(text)) problems.push(`main: ${text.trim().slice(0, 400)}`); });
  let detail;
  let timedOut = false;
  try {
    await useVietnamese(page);
    const settings = await callCore(page, 'workspace', {});
    await callCore(page, 'settings', { theme: settings.theme, connectionLimitMicros: settings.connectionLimitMicros, showWork: true });
    const target = await setUp(app, page, task, taskDir);
    await openChat(page, target);
    await attachFiles(app, page, task, taskDir);
    const startedAt = Date.now();
    await send(page, task.message, problems);
    ({ detail, timedOut } = await waitForAnswer(page, target, startedAt));
    // A question with choices is answered the way the person would, by clicking the choice, and the run goes on.
    for (let round = 0; round < 2 && !timedOut && task.answer && detail?.task.status === 'waiting_input'; round++) {
      const asked = detail.task.decisionRequests?.findLast(request => !request.answer && !request.interruptedAt);
      const choice = asked?.options.find(option => task.answer.test(option));
      if (!choice) break;
      await page.getByRole('button', { name: choice, exact: true }).first().click();
      ({ detail, timedOut } = await waitForAnswer(page, target, startedAt));
    }
    if (timedOut) problems.push(`timed out after ${options.timeoutMinutes} minutes`);
    // Let the answer settle on screen, then scroll to the end so the video ends on it.
    await page.locator('.thread-scroll').evaluate(element => { element.scrollTop = element.scrollHeight; }).catch(() => {});
    await page.waitForTimeout(4000);
    await page.screenshot({ path: join(taskDir, 'end.png') });
  } catch (error) {
    problems.push(`runner: ${error.message.split('\n')[0]}`);
    await page.screenshot({ path: join(taskDir, 'error.png') }).catch(() => {});
  } finally {
    await app.close().catch(() => {});
  }
  await writeFile(join(taskDir, 'chat.json'), JSON.stringify({ task, detail, problems, timedOut }, null, 2));
  await writeFile(join(taskDir, 'chat.md'), transcriptOf(task, detail, problems));
  const raw = (await readdir(join(taskDir, 'raw')).catch(() => [])).find(name => name.endsWith('.webm'));
  if (raw) {
    const failed = speedUp(join(taskDir, 'raw', raw), join(taskDir, `${task.id}.mp4`));
    if (failed) problems.push(`video: ${failed.trim().slice(0, 200)}`);
  }
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(() => {});
  summary.push({ id: task.id, status: detail?.task.status ?? 'none', answers: detail?.artifacts.length ?? 0, problems: problems.length });
  console.log(JSON.stringify(summary.at(-1)));
}
await writeFile(join(outRoot, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(`Saved in ${outRoot}`);
