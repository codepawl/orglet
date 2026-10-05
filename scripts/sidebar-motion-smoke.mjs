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
    // A folded sidebar opens from the rail: the tile of the area on screen.
    const button = shouldOpen ? document.querySelector('.area-tile.active') : document.querySelector('[aria-label="Thu gọn sidebar"]');
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
    assert.ok(Math.abs(frame.railLeft - first.railLeft) < 1, 'the permanent rail stays put');
  }
  // The sidebar folds into its rail tile and opens out of it (user, 2026-10-04): shown, it is whole and in place;
  // folded, it is gone; in between it is smaller and partly faded.
  const shown = opening ? last : first;
  const folded = opening ? first : last;
  assert.equal(shown.opacity, 1, 'an open sidebar is fully shown');
  assert.equal(shown.transform, 'none', 'an open sidebar is at its own size');
  assert.ok(folded.opacity < 0.05, 'a folded sidebar is faded out');
  assert.ok(folded.sidebarWidth < shown.sidebarWidth / 2, 'a folded sidebar has shrunk toward its tile');
  assert.ok(frames.some(frame => frame.opacity > 0.05 && frame.opacity < 0.95), 'the fade is sampled part of the way');
  assert.ok(frames.some(frame => frame.sidebarWidth > folded.sidebarWidth + 10 && frame.sidebarWidth < shown.sidebarWidth - 10), 'the size is sampled part of the way');
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

  // A folded sidebar's look lists the tile under the pointer, not only the area on screen, and opening it for good
  // from the tile of the area on screen lists that area again.
  await page.getByRole('button', { name: 'Thu gọn sidebar', exact: true }).click();
  await page.waitForTimeout(800);
  const sidebarTitle = () => page.locator('.sidebar-title').textContent();
  await page.locator('.area-tile.active').hover();
  await page.locator('.sidebar.peek').waitFor();
  const openAreaTitle = await sidebarTitle();
  await page.locator('.area-tile[data-name="Hoạt động"]').hover();
  await page.waitForTimeout(100);
  assert.equal(await sidebarTitle(), 'Hoạt động', 'the look follows the pointer to another tile');
  await page.locator('.area-tile[aria-label="Lịch chạy"]').hover();
  await page.waitForTimeout(100);
  assert.equal(await sidebarTitle(), 'Lịch chạy', 'the look lists a page tile too');
  await page.locator('.sidebar-title').hover();
  await page.waitForTimeout(400);
  assert.equal(await sidebarTitle(), 'Lịch chạy', 'the list stays while the pointer is on it');
  await page.locator('.area-tile.active').click();
  await page.waitForTimeout(800);
  assert.equal(await sidebarTitle(), openAreaTitle, 'the opened sidebar lists the area on screen');

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
  await page.locator('.area-tile.active').click();
  await page.waitForTimeout(800);
  assert.equal(await page.locator('.sidebar').evaluate(element => element.inert), false);
  assert.equal(await page.locator('.sidebar').evaluate(element => getComputedStyle(element).transform), 'none');

  await page.setViewportSize({ width: 740, height: 600 });
  await page.waitForTimeout(800);
  checkMove(await measureMove(page, true), true, true);
  checkMove(await measureMove(page, false), false, true);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('.area-tile.active').focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Thu gọn sidebar', exact: true }).focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.sidebar').evaluate(element => getComputedStyle(element).visibility), 'hidden', 'reduced motion hides the sidebar immediately');
  assert.equal(await page.locator('.sidebar').evaluate(element => getComputedStyle(element).transitionDuration), '0s', 'reduced motion also disables the collapsed selector');
  assert.equal(await page.locator('.app').evaluate(element => getComputedStyle(element).transitionDuration), '0s');
  console.log(JSON.stringify({ result: 'passed', checks: ['wide fold/open in both themes', 'fold/open with Details and members', 'rapid reversal', 'narrow overlay', 'keyboard toggles with reduced motion'] }));
} finally {
  await app.close();
}
