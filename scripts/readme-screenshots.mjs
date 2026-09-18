import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { packagedExecutable } from './packaged-executable.mjs';

// Captures the README screenshots from the packaged app, using a throwaway data folder and Demo workers only.
// Build the app with `pnpm make` first, then run `node scripts/readme-screenshots.mjs`.

const outputFolder = resolve('docs/images');
const executablePath = packagedExecutable();
const viewportSize = { width: 1400, height: 880 };

const workers = [
  { name: 'Writer', instructions: 'Write clear, friendly drafts in plain English.' },
  { name: 'Planner', instructions: 'Break goals into small steps with dates.' },
];

const brief = 'Plan the launch of my weekly newsletter next month. Keep it short.';

async function launchApp() {
  const dataFolder = await mkdtemp(join(tmpdir(), 'orglet-readme-'));
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  return electron.launch({ executablePath, args: [`--user-data-dir=${dataFolder}`], env: environment });
}

async function callCore(page, command, args) {
  return page.evaluate(([name, input]) => window.orglet.call(name, input), [command, args]);
}

async function addDemoWorkers(page) {
  const workspace = await callCore(page, 'workspace', {});
  const researcher = workspace.workers[0];
  for (const worker of workers) {
    await callCore(page, 'saveWorker', {
      name: worker.name,
      instructions: worker.instructions,
      provider: 'demo',
      skillId: researcher.skillId,
      taskBudgetMicros: researcher.taskBudgetMicros,
    });
  }
}

async function startTask(page) {
  const workspace = await callCore(page, 'workspace', {});
  const taskId = await callCore(page, 'createTask', {
    workerId: workspace.workers[0].id,
    brief,
    sourceIds: [],
    consent: false,
    providerScopes: [],
    budgetMicros: 100_000,
  });
  await page.waitForFunction(async id => {
    const detail = await window.orglet.call('task', { id });
    return detail.task.status === 'completed';
  }, taskId, { timeout: 30_000 });
  return taskId;
}

async function setTheme(page, theme) {
  const workspace = await callCore(page, 'workspace', {});
  await callCore(page, 'settings', { theme, connectionLimitMicros: workspace.connectionLimitMicros });
  await page.waitForTimeout(400);
}

async function main() {
  await mkdir(outputFolder, { recursive: true });
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await page.setViewportSize(viewportSize);
    await page.waitForFunction(() => window.orglet !== undefined);
    await page.locator('.welcome, .main-pane').first().waitFor();

    await addDemoWorkers(page);
    await setTheme(page, 'light');
    await page.screenshot({ path: join(outputFolder, 'new-task.png') });

    await startTask(page);
    await page.getByRole('button', { name: 'Researcher', exact: true }).click();
    await page.locator('.chat-turn').first().waitFor();
    await page.locator('.thinking').waitFor({ state: 'detached', timeout: 30_000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(outputFolder, 'chat-light.png') });

    await setTheme(page, 'dark');
    await page.screenshot({ path: join(outputFolder, 'chat-dark.png') });
  } finally {
    await app.close();
  }
}

await main();
