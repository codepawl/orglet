import { _electron as electron } from 'playwright';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { packagedExecutable } from './packaged-executable.mjs';
import { useVietnamese, openChannels } from './smoke-language.mjs';

// COD-372: measure the actual packaged shell every frame, including the column that must interpolate.
const directory = await mkdtemp(join(tmpdir(), 'orglet-sidebar-motion-'));
const environment = { ...process.env, ORGLET_SKIP_ACCOUNT_CHOICE: '1' };
delete environment.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: packagedExecutable(), args: [`--user-data-dir=${directory}`], env: environment });

async function measureMove(page, opening) {
  return page.evaluate(async shouldOpen => {
    const shell = document.querySelector('.app');
    const sidebar = document.querySelector('.sidebar');
    const main = document.querySelector('.main-pane');
    const rail = document.querySelector('.area-rail');
    const frames = [];
    const sample = () => {
      const sidebarStyle = getComputedStyle(sidebar);
      const columns = getComputedStyle(shell).gridTemplateColumns.split(' ').map(Number.parseFloat);
      frames.push({ columns, sidebarWidth: sidebar.getBoundingClientRect().width, sidebarRight: sidebar.getBoundingClientRect().right,
        mainLeft: main.getBoundingClientRect().left, railLeft: rail.getBoundingClientRect().left,
        opacity: Number(sidebarStyle.opacity), transform: sidebarStyle.transform, visibility: sidebarStyle.visibility,
        inert: sidebar.inert });
    };
    sample();
    const button = document.querySelector(`[aria-label="${shouldOpen ? 'Mở sidebar' : 'Thu gọn sidebar'}"]`);
    button.click();
    const started = performance.now();
    await new Promise(resolve => {
      const frame = () => {
        sample();
        if (performance.now() - started < 800) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
    return frames;
  }, opening);
}

function checkMove(frames, opening, overlay) {
  const first = frames[0];
  const last = frames.at(-1);
  assert.ok(frames.length > 5, 'motion is sampled over multiple rendered frames');
  for (const frame of frames) {
    assert.equal(frame.columns.length, 4, 'the shell keeps four tracks');
    assert.equal(frame.opacity, 1, 'the sidebar never fades');
    assert.ok(Math.abs(frame.sidebarWidth - first.sidebarWidth) < 1, 'sidebar rows retain their full width');
    assert.ok(Math.abs(frame.railLeft - first.railLeft) < 1, 'the permanent rail stays put');
    if (!overlay) assert.ok(frame.sidebarRight <= frame.mainLeft + 1, 'the sidebar stays behind the moving chat edge');
  }
  if (overlay) {
    assert.ok(frames.every(frame => Math.abs(frame.mainLeft - first.mainLeft) < 1), 'overlay motion leaves the chat in place');
  } else {
    const startWidth = first.columns[1];
    const endWidth = last.columns[1];
    assert.ok(Math.abs(endWidth - startWidth) > 100, 'folding gives the sidebar column to the chat');
    assert.ok(frames.some(frame => frame.columns[1] > Math.min(startWidth, endWidth) + 10 && frame.columns[1] < Math.max(startWidth, endWidth) - 10), 'the grid column interpolates instead of snapping');
  }
  assert.equal(last.visibility, opening ? 'visible' : 'hidden');
  assert.equal(last.inert, !opening, 'closed rows are inert');
}

try {
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1200, height: 820 });
  await useVietnamese(page);
  await page.waitForTimeout(250);
  await page.evaluate(() => document.documentElement.style.setProperty('--motion-base', '600ms'));
  for (const theme of ['light', 'dark']) {
    await page.evaluate(async value => {
      const workspace = await window.orglet.call('workspace', {});
      await window.orglet.call('settings', { language: 'vi', theme: value, connectionLimitMicros: workspace.connectionLimitMicros });
    }, theme);
    checkMove(await measureMove(page, false), false, false);
    checkMove(await measureMove(page, true), true, false);
  }

  await page.getByRole('button', { name: 'Tùy chọn cuộc trò chuyện', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Chi tiết', exact: true }).click();
  await page.waitForTimeout(800);
  checkMove(await measureMove(page, false), false, false);
  checkMove(await measureMove(page, true), true, false);

  await page.evaluate(() => window.orglet.call('createTemplate', { templateId: 'research-review', provider: 'demo' }));
  await openChannels(page);
  await page.getByRole('button', { name: '#Research Review', exact: true }).click();
  await page.locator('.members-pane').waitFor();
  await page.waitForTimeout(800);
  checkMove(await measureMove(page, false), false, false);
  checkMove(await measureMove(page, true), true, false);

  // Interrupt a fold with reopening; the native transition reverses and the rows stay available afterward.
  await page.getByRole('button', { name: 'Thu gọn sidebar', exact: true }).click();
  await page.waitForTimeout(100);
  await page.getByRole('button', { name: 'Mở sidebar', exact: true }).click();
  await page.waitForTimeout(800);
  assert.equal(await page.locator('.sidebar').evaluate(element => element.inert), false);
  assert.equal(await page.locator('.sidebar').evaluate(element => getComputedStyle(element).transform), 'none');

  await page.setViewportSize({ width: 740, height: 600 });
  await page.waitForTimeout(800);
  checkMove(await measureMove(page, true), true, true);
  checkMove(await measureMove(page, false), false, true);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Mở sidebar', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Thu gọn sidebar', exact: true }).focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.sidebar').evaluate(element => getComputedStyle(element).visibility), 'hidden', 'reduced motion hides the sidebar immediately');
  assert.equal(await page.locator('.app').evaluate(element => getComputedStyle(element).transitionDuration), '0s');
  console.log(JSON.stringify({ result: 'passed', checks: ['wide fold/open in both themes', 'fold/open with Details and members', 'rapid reversal', 'narrow overlay', 'keyboard toggles with reduced motion'] }));
} finally {
  await app.close();
}
