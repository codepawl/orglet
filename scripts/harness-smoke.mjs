import { _electron as electron } from 'playwright';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { useVietnamese } from './smoke-language.mjs';

const pills = { not_installed: 'Chưa cài', detected: 'Đã thấy · chưa đăng nhập', signed_in_ready: 'Đã đăng nhập · sẵn sàng', signed_in: 'Đã đăng nhập', auth_error: 'Lỗi đăng nhập' };
const hint = { not_installed: name => `Cài và đăng nhập ${name} trên máy này`, detected: name => `Đăng nhập ${name} trên máy này`, auth_error: name => `Sửa đăng nhập ${name} trên máy này` };

// Machine-independent: compares the UI with whatever the packaged core detects here. Never starts a harness run.
const directory = await mkdtemp(join(tmpdir(), 'orglet-harness-ui-'));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: resolve('out/Orglet-win32-x64/Orglet.exe'), args: [`--user-data-dir=${directory}`], env });
let closed = false; app.once('close', () => { closed = true; });
try {
  const page = await app.firstWindow(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await useVietnamese(page);
  const detected = await page.evaluate(() => window.orglet.call('harnesses', { refresh: true }));
  assert.deepEqual(detected.map(item => item.id), ['claude-code', 'codex', 'cursor']);
  for (const item of detected) {
    assert.ok(['not_installed', 'detected', 'signed_in', 'auth_error'].includes(item.status), JSON.stringify(item));
    assert.ok(typeof item.loginCommand === 'string' && item.loginCommand.length > 0, JSON.stringify(item));
    if (item.status !== 'not_installed') assert.ok(/\d+\.\d+/.test(item.version), JSON.stringify(item));
    if (item.id === 'cursor') assert.equal(item.runnable, false);
    else assert.equal(item.runnable, true);
  }

  await page.getByRole('button', { name: /^Cài đặt/ }).click();
  await page.getByRole('tab', { name: 'Harness trên máy', exact: true }).click();
  const section = page.getByRole('region', { name: 'Harness trên máy' });
  await section.waitFor();
  await section.getByText('không chuyển sang Demo', { exact: false }).waitFor();
  for (const item of detected) {
    const row = section.locator('.harness-row', { hasText: item.name });
    await row.getByText(item.name, { exact: true }).waitFor();
    const expectedPill = item.status === 'signed_in' && item.runnable ? pills.signed_in_ready : item.status === 'signed_in' ? pills.signed_in : pills[item.status];
    await row.getByText(expectedPill, { exact: true }).waitFor();
    if (item.status !== 'not_installed' && item.version) await row.getByText(item.version, { exact: true }).waitFor();
    if (item.status !== 'signed_in') {
      await row.getByRole('button', { name: 'Sao chép lệnh' }).first().waitFor();
      await row.getByText(item.loginCommand, { exact: true }).waitFor();
    }
    if (item.status === 'auth_error') await row.getByText('Lỗi đăng nhập', { exact: true }).waitFor();
  }
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
  const harnessOptions = options.filter(text => /^(Claude Code|Codex|Cursor)/.test(text));
  assert.deepEqual(harnessOptions.map(text => text.startsWith('Claude Code') ? 'claude-code' : text.startsWith('Codex') ? 'codex' : 'cursor'), ['claude-code', 'codex']);
  await page.screenshot({ path: 'test-results/model-select.png' });
  await page.keyboard.press('Escape');
  const first = detected.find(item => item.runnable);
  if (first) {
    await model.click(); await page.getByRole('option', { name: new RegExp(`^${first.name}`) }).click();
    await page.getByText(`Dùng bản ${first.name} đã cài`, { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Lưu nhân viên', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.getByRole('textbox', { name: 'Nội dung công việc' }).fill('Harness send gate');
    const send = page.getByRole('button', { name: 'Gửi công việc', exact: true });
    assert.equal(await page.getByText('Giới hạn task', { exact: false }).count(), 0);
    const demoNote = page.getByText('Đang dùng Demo', { exact: false });
    if (first.status === 'signed_in') {
      for (let attempt = 0; attempt < 20 && await send.isDisabled(); attempt++) await page.waitForTimeout(100);
      assert.equal(await send.isEnabled(), true);
      assert.equal(await page.getByRole('switch').count(), 0);
      assert.equal(await demoNote.count(), 0);
    } else {
      assert.equal(await send.isDisabled(), true);
      assert.equal(await demoNote.count(), 0);
      const label = hint[first.status === 'auth_error' ? 'auth_error' : first.status === 'detected' ? 'detected' : 'not_installed'](`${first.name} trên máy này`);
      await page.getByRole('button', { name: label, exact: true }).waitFor();
      await page.getByRole('button', { name: label, exact: true }).click();
      await page.getByRole('tab', { name: 'Harness trên máy', exact: true }).waitFor();
      await page.getByRole('region', { name: 'Harness trên máy' }).getByText(first.name, { exact: true }).waitFor();
    }
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ directory, detected: detected.map(({ id, version, auth, status }) => ({ id, version, auth, status })), result: 'passed' }));
} finally { if (!closed) await app.close(); }
