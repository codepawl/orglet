/*
 * Opens the packaged app off-screen on a fresh, isolated profile, for a one-off script that looks at a change the way
 * a person would see it. Write the script in test-results/ (git-ignored) of the checkout or lane you packaged, and run
 * it from that folder's root:
 *
 *   // test-results/my-walk.mjs
 *   import { openWalk } from '../.agents/skills/ship-orglet-change/scripts/walk.mjs';
 *   const walk = await openWalk();
 *   try {
 *     await walk.step('settings', async () => {
 *       await walk.page.getByRole('button', { name: walk.label('Cài đặt') }).click();
 *       await walk.shot('settings');
 *     });
 *   } finally {
 *     await walk.close();
 *   }
 *
 *   node test-results/my-walk.mjs
 *
 * The app never appears on the screen and uses no real account, key or harness sign-in. Sample replies are on, so a
 * message gets an answer. Then READ the screenshots: a script that ran is not a screen that looks right.
 */
import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The repo's own smoke helpers, loaded from the folder the script runs in, so a lane uses its own copies. */
async function smokeHelper(file) {
  return import(pathToFileURL(join(process.cwd(), 'scripts', file)).href);
}

export async function openWalk({ width = 1200, height = 820, name = 'walk' } = {}) {
  const { packagedExecutable } = await smokeHelper('packaged-executable.mjs');
  const { isolatedHarnessEnvironment } = await smokeHelper('fake-harnesses.mjs');
  const language = await smokeHelper('smoke-language.mjs');
  const profile = await mkdtemp(join(tmpdir(), `orglet-${name}-`));
  const { env } = await isolatedHarnessEnvironment(profile);
  await mkdir('test-results', { recursive: true });
  const app = await electron.launch({
    executablePath: packagedExecutable(),
    args: [`--user-data-dir=${profile}`],
    env: { ...env, ORGLET_TEST_OFFSCREEN: '1' },
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width, height });
  await language.useEnglish(page);
  await language.openHome(page);

  /** Runs one part of the walk; a failure is printed and the walk goes on, so one broken selector does not hide the rest. */
  const step = async (title, run) => {
    try {
      await run();
    } catch (error) {
      console.log(`STEP FAILED ${title}: ${String(error.message).split('\n')[0]}`);
    }
  };
  /** Saves test-results/<name>-<title>.png, of the whole window or of `clip`, after animations have had time to end. */
  const shot = async (title, clip) => {
    await page.waitForTimeout(400);
    const path = `test-results/${name}-${title}.png`;
    await page.screenshot({ path, ...(clip ? { clip } : {}) });
    return path;
  };
  /** Calls a core command as the window does, for setting up state faster than clicking through it. */
  const core = (command, input = {}) => page.evaluate(([commandName, commandInput]) => window.orglet.call(commandName, commandInput), [command, input]);
  const setTheme = async theme => {
    await core('settings', { theme });
    await page.waitForFunction(wanted => document.documentElement.dataset.theme === wanted, theme);
  };

  return { app, page, step, shot, core, setTheme, label: language.label, openHome: () => language.openHome(page), openSettings: () => language.openSettings(page), close: () => app.close() };
}
