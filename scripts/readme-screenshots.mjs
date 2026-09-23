import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import electronPath from 'electron';
import { packagedExecutable } from './packaged-executable.mjs';

// Captures README / Getting started screenshots from Demo only, in a throwaway data folder.
// Prefers a packaged binary (`pnpm make` / `pnpm build`). On Linux, falls back to unpackaged
// Electron after a Vite compile (`pnpm exec electron-forge package` or a prior `pnpm dev`).

const outputFolder = resolve('docs/images');
const viewportSize = { width: 1400, height: 880 };
const brief = 'Plan the launch of my weekly newsletter next month. Keep it short.';

function launchTarget() {
  try {
    return { executablePath: packagedExecutable(), args: [] };
  } catch (error) {
    // No packaged binary: a prior Vite compile is enough to run unpackaged Electron.
    if (existsSync(resolve('.vite/build/main.js'))) {
      return { executablePath: electronPath, args: ['.'] };
    }
    throw error;
  }
}

async function launchApp() {
  const dataFolder = await mkdtemp(join(tmpdir(), 'orglet-readme-'));
  const environment = { ...process.env, ORGLET_DATA_DIR: dataFolder };
  delete environment.ELECTRON_RUN_AS_NODE;
  const target = launchTarget();
  return electron.launch({ executablePath: target.executablePath, args: [...target.args, `--user-data-dir=${dataFolder}`], env: environment });
}

async function callCore(page, command, args) {
  return page.evaluate(([name, input]) => window.orglet.call(name, input), [command, args]);
}

async function setTheme(page, theme) {
  const workspace = await callCore(page, 'workspace', {});
  await callCore(page, 'settings', { language: workspace.language ?? 'en', theme, connectionLimitMicros: workspace.connectionLimitMicros });
  await page.waitForTimeout(400);
}

async function waitForTask(page, taskId) {
  await page.waitForFunction(async id => {
    const detail = await window.orglet.call('task', { id });
    return ['completed', 'partial', 'failed'].includes(detail.task.status);
  }, taskId, { timeout: 60_000 });
}

async function main() {
  await mkdir(outputFolder, { recursive: true });
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await page.setViewportSize(viewportSize);
    await page.waitForFunction(() => window.orglet !== undefined);
    await page.locator('.welcome, .main-pane').first().waitFor();
    await setTheme(page, 'light');
    await page.getByRole('textbox', { name: 'Message' }).waitFor();
    await page.screenshot({ path: join(outputFolder, 'new-task.png') });

    const team = await callCore(page, 'createTemplate', { templateId: 'research-review', provider: 'demo' });
    await page.getByRole('button', { name: team.name, exact: true }).click();
    await page.getByRole('textbox', { name: 'Message' }).fill(brief);
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    const taskHandle = await page.waitForFunction(async teamId => {
      const workspace = await window.orglet.call('workspace', {});
      return workspace.tasks.find(task => task.teamId === teamId && !task.archivedAt)?.id ?? false;
    }, team.id, { timeout: 15_000 });
    await waitForTask(page, await taskHandle.jsonValue());
    await page.locator('.chat-reply, .report').first().waitFor();
    // The run's island settles into the bar when the run ends; the knowledge offer that may follow (COD-208) can stay in the shot.
    await page.locator('.live-island:not(.live-island-knowledge)').waitFor({ state: 'detached', timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(outputFolder, 'chat-light.png') });

    await setTheme(page, 'dark');
    await page.screenshot({ path: join(outputFolder, 'chat-dark.png') });

    await setTheme(page, 'light');
    await page.getByRole('textbox', { name: 'Message' }).click();
    await page.getByRole('textbox', { name: 'Message' }).fill('@');
    await page.locator('.mention-menu').waitFor();
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(outputFolder, 'mention-picker.png') });
  } finally {
    await app.close();
  }
}

await main();
