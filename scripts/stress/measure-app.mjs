import { _electron as electron } from 'playwright';
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { stressRoot } from './bundle.mjs';

/**
 * Measures the packaged app on a copy of a seeded profile: how long it takes to start, what the window asks the core
 * for, how long the heaviest chat takes to appear, how long search takes, what one sent message costs in calls and
 * bytes, and the memory of each process. The app runs with the real environment, an isolated `--user-data-dir` and
 * sample replies; it never reaches a model or the network.
 *
 * Usage: node scripts/stress/measure-app.mjs <Orglet.exe> <seed summary.json> [--no-send] [--profile]
 * `--profile` also records the window's CPU profile while the heaviest chat opens and lists where the time went.
 */
const [executable, summaryPath, ...flags] = process.argv.slice(2);
const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
const tier = summary.config.name;
const profileFolder = join(stressRoot, `app-${tier}`);
rmSync(profileFolder, { recursive: true, force: true });
mkdirSync(profileFolder, { recursive: true });
cpSync(summary.databasePath, join(profileFolder, 'orglet.sqlite'));

const environment = { ...process.env, ORGLET_SKIP_ACCOUNT_CHOICE: '1', ORGLET_DEMO_REPLIES: '1' };
delete environment.ELECTRON_RUN_AS_NODE;
const round = value => Math.round(value * 10) / 10;
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const result = { tier };

const launchedAt = Date.now();
const app = await electron.launch({ executablePath: executable, args: [`--user-data-dir=${profileFolder}`], env: environment, timeout: 180_000 });

/** Memory of every process, in megabytes, by kind, plus the renderer's JavaScript heap. */
async function memory(page) {
  const processes = await app.evaluate(({ app: electronApp }) => electronApp.getAppMetrics().map(metric => ({
    type: metric.type, name: metric.name ?? '', megabytes: Math.round(metric.memory.workingSetSize / 1024) })));
  const core = processes.find(entry => entry.name === 'Orglet Core')?.megabytes;
  const renderer = processes.filter(entry => entry.type === 'Tab').reduce((total, entry) => total + entry.megabytes, 0);
  const main = processes.find(entry => entry.type === 'Browser')?.megabytes;
  const heap = await page.evaluate(() => Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576));
  return { mainMB: main, coreMB: core, rendererMB: renderer, rendererHeapMB: heap };
}

/** Counts every command the window sends and every change notice main forwards, with the time and size of each reply. */
async function instrument() {
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    globalThis.stress = { calls: [], changed: 0 };
    const handlers = ipcMain._invokeHandlers;
    const original = handlers.get('orglet:command');
    handlers.set('orglet:command', async (event, raw) => {
      const started = performance.now();
      const reply = await original(event, raw);
      const milliseconds = performance.now() - started;
      let bytes = 0;
      try { bytes = JSON.stringify(reply).length; } catch { bytes = -1; }
      globalThis.stress.calls.push({ command: raw.command, milliseconds, bytes });
      return reply;
    });
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    const send = contents.send.bind(contents);
    contents.send = (channel, ...rest) => {
      if (channel === 'orglet:changed') globalThis.stress.changed += 1;
      return send(channel, ...rest);
    };
  });
}

/** What the window asked for since the last call: per command, how many times, how long, how many bytes. */
async function drainCalls() {
  const data = await app.evaluate(() => {
    const { calls, changed } = globalThis.stress;
    globalThis.stress.calls = [];
    globalThis.stress.changed = 0;
    return { calls, changed };
  });
  const byCommand = {};
  for (const call of data.calls) {
    const entry = byCommand[call.command] ??= { count: 0, milliseconds: 0, bytes: 0 };
    entry.count += 1;
    entry.milliseconds = round(entry.milliseconds + call.milliseconds);
    entry.bytes += call.bytes;
  }
  return { changedEvents: data.changed, byCommand, totalBytes: data.calls.reduce((total, call) => total + Math.max(call.bytes, 0), 0) };
}

try {
  const page = await app.firstWindow();
  result.firstWindowMs = Date.now() - launchedAt;
  await page.waitForFunction(() => window.orglet !== undefined);
  await page.locator('.sidebar .worker').first().waitFor({ timeout: 180_000 });
  result.interactiveMs = Date.now() - launchedAt;
  const processes = await app.evaluate(({ app: electronApp }) => electronApp.getAppMetrics().map(metric => ({ name: metric.name ?? metric.type, created: metric.creationTime })));
  const coreCreated = processes.find(entry => entry.name === 'Orglet Core')?.created;
  const rendererOrigin = await page.evaluate(() => performance.timeOrigin);
  result.coreSpawnToWindowMs = round(rendererOrigin - coreCreated);
  result.sidebar = await page.evaluate(() => ({ orglets: document.querySelectorAll('.sidebar .worker').length, domNodes: document.querySelectorAll('*').length }));
  // Let the start-up traffic (harness checks, backfills) settle before counting.
  await page.waitForTimeout(3000);
  result.memoryAtStart = await memory(page);
  await instrument();

  // The two commands the window sends on every change.
  const heavyId = summary.longChatIds[0] ?? summary.chatIds[0];
  const ipc = await page.evaluate(async id => {
    const measureCall = async (command, args) => {
      const started = performance.now();
      const value = await window.orglet.call(command, args);
      const elapsed = performance.now() - started;
      return { elapsed, size: JSON.stringify(value).length };
    };
    const workspace = [];
    for (let attempt = 0; attempt < 3; attempt += 1) workspace.push(await measureCall('workspace', {}));
    const task = [];
    for (let attempt = 0; attempt < 3; attempt += 1) task.push(await measureCall('task', { id }));
    return { workspace, task };
  }, heavyId);
  result.workspaceCall = { milliseconds: round(median(ipc.workspace.map(entry => entry.elapsed))), payloadBytes: ipc.workspace[0].size };
  result.taskCall = { milliseconds: round(median(ipc.task.map(entry => entry.elapsed))), payloadBytes: ipc.task[0].size };
  result.callsDuringIpcProbe = await drainCalls();

  // Open the heaviest chat from the sidebar and watch the thread appear.
  const expectedTurns = summary.longChatIds.length ? summary.config.longChatTurns : summary.config.turnsPerChat;
  await page.evaluate(() => {
    window.longTasks = [];
    new PerformanceObserver(list => { for (const entry of list.getEntries()) window.longTasks.push(entry.duration); }).observe({ type: 'longtask', buffered: false });
  });
  const profiler = flags.includes('--profile') ? await page.context().newCDPSession(page) : undefined;
  if (profiler) {
    await profiler.send('Profiler.enable');
    await profiler.send('Profiler.setSamplingInterval', { interval: 500 });
    await profiler.send('Profiler.start');
  }
  const opening = await page.evaluate(() => new Promise(resolve => {
    const row = [...document.querySelectorAll('.sidebar .worker')].find(button => button.textContent.trim() === 'Orglet 1');
    if (!row) { resolve({ error: 'Orglet 1 is not in the sidebar' }); return; }
    const started = performance.now();
    let firstPaint;
    let lastCount = -1;
    let lastChange = started;
    row.click();
    const poll = () => {
      const now = performance.now();
      const count = document.querySelectorAll('.user-message').length;
      if (count > 0 && firstPaint === undefined) requestAnimationFrame(() => { firstPaint = performance.now() - started; });
      if (count !== lastCount) { lastCount = count; lastChange = now; }
      if ((count > 0 && now - lastChange > 700) || now - started > 120_000) {
        resolve({ firstPaintMs: firstPaint, settledMs: lastChange - started, userMessages: count, domNodes: document.querySelectorAll('*').length, longTasks: window.longTasks });
        return;
      }
      requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  }));
  result.openHeavyChat = {
    expectedTurns, userMessages: opening.userMessages, firstPaintMs: opening.firstPaintMs === undefined ? undefined : round(opening.firstPaintMs),
    settledMs: opening.settledMs === undefined ? undefined : round(opening.settledMs), domNodes: opening.domNodes,
    longTaskCount: opening.longTasks?.length, longestTaskMs: opening.longTasks?.length ? round(Math.max(...opening.longTasks)) : 0,
    totalLongTaskMs: opening.longTasks?.length ? round(opening.longTasks.reduce((total, value) => total + value, 0)) : 0, error: opening.error,
  };
  if (profiler) {
    const { profile } = await profiler.send('Profiler.stop');
    const self = new Map();
    const deltas = profile.timeDeltas;
    const byId = new Map(profile.nodes.map(node => [node.id, node]));
    profile.samples.forEach((id, index) => {
      const frame = byId.get(id).callFrame;
      const key = `${frame.functionName || '(anonymous)'} ${frame.url.split('/').pop()}:${frame.lineNumber + 1}`;
      self.set(key, (self.get(key) ?? 0) + (deltas[index] ?? 0));
    });
    result.openProfile = [...self].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([name, microseconds]) => `${Math.round(microseconds / 1000)} ms  ${name}`);
  }
  result.callsWhileOpening = await drainCalls();
  result.memoryAfterOpen = await memory(page);

  // Search: type a common word in the sidebar's finder and wait for the results.
  await page.locator('.sidebar-search').click();
  const box = page.getByRole('combobox').first();
  await box.waitFor();
  const searchTiming = await page.evaluate(() => new Promise(resolve => {
    const input = document.querySelector('[role=combobox]');
    const started = performance.now();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'report');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    let lastCount = -1;
    let lastChange = started;
    let first;
    const poll = () => {
      const now = performance.now();
      const count = document.querySelectorAll('[role=option]').length;
      if (count > 0 && first === undefined) first = now - started;
      if (count !== lastCount) { lastCount = count; lastChange = now; }
      if ((count > 0 && now - lastChange > 400) || now - started > 30_000) resolve({ firstResultMs: first, options: count });
      else requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  }));
  result.search = { firstResultMs: searchTiming.firstResultMs === undefined ? undefined : round(searchTiming.firstResultMs), options: searchTiming.options };
  result.callsWhileSearching = await drainCalls();
  await page.keyboard.press('Escape');

  if (!flags.includes('--no-send')) {
    // One message into the heavy chat: how many reads the window repeats and how many bytes they move.
    await page.waitForTimeout(500);
    await drainCalls();
    const composer = page.getByRole('textbox').last();
    await composer.fill('Stress message: summarize the budget forecast.');
    // A long chat shows only its newest turns, so a new answer replaces the oldest one: the last answer's text tells.
    const lastAnswer = () => { const all = document.querySelectorAll('.assistant-message'); return all.length ? all[all.length - 1].textContent : ''; };
    const before = await page.evaluate(lastAnswer);
    const sentAt = Date.now();
    await composer.press('Enter');
    await page.waitForFunction(old => { const all = document.querySelectorAll('.assistant-message'); return all.length > 0 && all[all.length - 1].textContent !== old; }, before, { timeout: 120_000 });
    result.sendToAnswerMs = Date.now() - sentAt;
    await page.waitForTimeout(1500);
    result.callsWhileSending = await drainCalls();
    result.memoryAfterSend = await memory(page);
  }
  result.memoryFinal = await memory(page);
} catch (error) {
  result.error = error instanceof Error ? error.message : String(error);
} finally {
  await app.close().catch(() => undefined);
}
console.log(`APP_RESULT ${JSON.stringify(result)}`);
rmSync(profileFolder, { recursive: true, force: true });
