import { _electron as electron } from 'playwright';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

// Machine-independent: compares the UI with whatever the packaged core detects here. Never starts a harness run.
const directory = await mkdtemp(join(tmpdir(), 'orglet-harness-ui-'));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: resolve('out/Orglet-win32-x64/Orglet.exe'), args: [`--user-data-dir=${directory}`], env });
let closed = false; app.once('close', () => { closed = true; });
try {
  const page = await app.firstWindow(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: 'Bạn muốn giao việc gì?' }).waitFor();
  const detected = await page.evaluate(() => window.orglet.call('harnesses', { refresh: true }));
  for (const item of detected) assert.ok(['claude-code', 'codex'].includes(item.id) && /\d+\.\d+/.test(item.version), JSON.stringify(item));

  await page.getByRole('button', { name: /^Cài đặt/ }).click();
  await page.getByRole('tab', { name: 'Harness trên máy', exact: true }).click();
  const section = page.getByRole('region', { name: 'Harness trên máy' });
  await section.waitFor();
  if (!detected.length) await section.getByText('Chưa tìm thấy Claude Code hoặc Codex trên máy này.').waitFor();
  for (const item of detected) { await section.getByText(item.name, { exact: true }).waitFor(); await section.getByText(item.version, { exact: true }).waitFor(); }
  await page.getByRole('button', { name: 'Dò lại', exact: true }).click();
  await page.getByText('Đã dò lại harness.', { exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/settings-connections.png' });
  await page.setViewportSize({ width: 600, height: 760 });
  assert.equal(await page.evaluate(() => { const panel = document.querySelector('.settings-panel'); return panel.scrollWidth > panel.clientWidth + 1; }), false);
  await page.screenshot({ path: 'test-results/settings-connections-narrow.png' });
  await page.setViewportSize({ width: 1200, height: 820 });
  await page.getByRole('tab', { name: 'Chi phí & giới hạn', exact: true }).click();
  await page.screenshot({ path: 'test-results/settings-usage.png' });
  await page.keyboard.press('Escape');
  // The narrow viewport collapsed the sidebar; reopen it before using row menus.
  const openSidebar = page.getByRole('button', { name: 'Mở sidebar', exact: true });
  if (await openSidebar.count()) await openSidebar.click();

  await page.getByRole('button', { name: 'Tùy chọn Researcher', exact: true }).click(); await page.getByRole('menuitem', { name: 'Chỉnh sửa' }).click();
  const model = page.getByRole('combobox', { name: 'Model', exact: true });
  await model.click();
  const options = await page.getByRole('option').allTextContents();
  assert.deepEqual(options.filter(text => /^(Claude Code|Codex)/.test(text)).map(text => text.startsWith('Claude Code') ? 'claude-code' : 'codex'), detected.map(item => item.id));
  await page.screenshot({ path: 'test-results/model-select.png' });
  await page.keyboard.press('Escape');
  const first = detected[0];
  if (first) {
    await model.click(); await page.getByRole('option', { name: new RegExp(`^${first.name}`) }).click();
    await page.getByText(`Dùng bản ${first.name} đã cài`, { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Lưu nhân viên', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.getByRole('textbox', { name: 'Nội dung công việc' }).fill('Harness send gate');
    const send = page.getByRole('button', { name: 'Gửi công việc', exact: true });
    assert.equal(await page.getByText('Giới hạn task', { exact: false }).count(), 0);
    if (first.auth === 'logged_out') {
      assert.equal(await send.isDisabled(), true);
      await page.getByRole('button', { name: `Cài và đăng nhập ${first.name} trên máy này`, exact: true }).waitFor();
    } else {
      // Picking the harness is enough: there is no separate permission step before sending.
      for (let attempt = 0; attempt < 20 && await send.isDisabled(); attempt++) await page.waitForTimeout(100);
      assert.equal(await send.isEnabled(), true);
      assert.equal(await page.getByRole('switch').count(), 0);
    }
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ directory, detected: detected.map(({ id, version, auth }) => ({ id, version, auth })), result: 'passed' }));
} finally { if (!closed) await app.close(); }
