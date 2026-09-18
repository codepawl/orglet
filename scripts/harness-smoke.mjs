import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import assert from 'node:assert/strict';
import { useVietnamese } from './smoke-language.mjs';
import { packagedExecutable } from './packaged-executable.mjs';

const pills = { not_installed: 'Chưa cài', detected: 'Đã thấy · chưa đăng nhập', signed_in_ready: 'Đã đăng nhập · sẵn sàng', signed_in: 'Đã đăng nhập', auth_error: 'Lỗi đăng nhập' };
const hint = { not_installed: name => `Cài và đăng nhập ${name} trên máy này`, detected: name => `Đăng nhập ${name} trên máy này`, auth_error: name => `Sửa đăng nhập ${name} trên máy này` };

// Puts two fake CLIs first on PATH so CI always has a logged-out Claude Code and an
// unreadable Codex login probe. Cursor stays whatever the machine has (usually not installed).
// The smoke never starts a harness run and never calls a provider.
async function fakeHarnessPath(directory) {
  const bin = join(directory, 'bin');
  await mkdir(bin, { recursive: true });
  const node = process.execPath;
  const shim = async (name, source) => {
    const script = join(bin, `${name}.mjs`);
    await writeFile(script, source);
    await writeFile(join(bin, `${name}.cmd`), `@echo off\r\n"${node}" "${script}" %*\r\n`);
    await writeFile(join(bin, name), `#!/bin/sh\nexec "${node}" "${script}" "$@"\n`, { mode: 0o755 });
  };
  await shim('claude', `
    const args = process.argv.slice(2);
    if (args[0] === '--version') { process.stdout.write('2.1.10 (Claude Code)\\n'); process.exit(0); }
    if (args[0] === 'auth' && args[1] === 'status') {
      process.stdout.write(JSON.stringify({ loggedIn: false, authMethod: 'none' }));
      process.exit(0);
    }
    process.exit(1);
  `);
  await shim('codex', `
    const args = process.argv.slice(2);
    if (args[0] === '--version') { process.stdout.write('codex-cli 0.154.0\\n'); process.exit(0); }
    if (args[0] === 'login' && args[1] === 'status') {
      process.stderr.write('Error checking login status\\n');
      process.exit(2);
    }
    process.exit(1);
  `);
  return bin;
}

const directory = await mkdtemp(join(tmpdir(), 'orglet-harness-ui-'));
await mkdir('test-results', { recursive: true });
const bin = await fakeHarnessPath(directory);
const pathValue = `${bin}${delimiter}${process.env.PATH ?? process.env.Path ?? ''}`;
const env = { ...process.env, PATH: pathValue, Path: pathValue }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: packagedExecutable(), args: [`--user-data-dir=${directory}`], env });
let closed = false; app.once('close', () => { closed = true; });
const noDemo = async page => {
  assert.equal(await page.getByText('Đang dùng Demo', { exact: false }).count(), 0);
  assert.equal(await page.locator('header .badge', { hasText: /^Demo$/ }).count(), 0);
};
try {
  const page = await app.firstWindow(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await useVietnamese(page);
  const detected = await page.evaluate(() => window.orglet.call('harnesses', { refresh: true }));
  assert.deepEqual(detected.map(item => item.id), ['claude-code', 'codex', 'cursor']);
  const claude = detected.find(item => item.id === 'claude-code');
  const codex = detected.find(item => item.id === 'codex');
  // detect ≠ signed-in: fixture Claude Code is found on disk, not logged_in.
  assert.equal(claude.auth, 'logged_out');
  assert.equal(claude.status, 'detected');
  assert.notEqual(claude.auth, 'logged_in');
  assert.match(claude.version, /\d+\.\d+/);
  // auth-fail ≠ signed-in: fixture Codex login probe stays unknown, not logged_in.
  assert.equal(codex.auth, 'unknown');
  assert.equal(codex.status, 'auth_error');
  assert.notEqual(codex.auth, 'logged_in');
  assert.match(codex.version, /\d+\.\d+/);
  for (const item of detected) {
    assert.ok(['not_installed', 'detected', 'signed_in', 'auth_error'].includes(item.status), JSON.stringify(item));
    assert.ok(typeof item.loginCommand === 'string' && item.loginCommand.length > 0, JSON.stringify(item));
    if (item.status !== 'not_installed') assert.ok(/\d+\.\d+/.test(item.version), JSON.stringify(item));
    assert.equal(item.runnable, true);
  }

  await page.getByRole('button', { name: /^Cài đặt/ }).click();
  await page.getByRole('tab', { name: 'Harness trên máy', exact: true }).click();
  const section = page.getByRole('region', { name: 'Harness trên máy' });
  await section.waitFor();
  // The no-Demo note lives on the settings panel heading. Auth-fail rows also mention it, so do not search the whole panel.
  await page.locator('#settings-panel p.heading-description').getByText('không chuyển sang Demo', { exact: false }).waitFor();
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
  const claudeRow = section.locator('.harness-row', { hasText: 'Claude Code' });
  const codexRow = section.locator('.harness-row', { hasText: 'Codex' });
  await claudeRow.getByText('Đã thấy · chưa đăng nhập', { exact: true }).waitFor();
  assert.equal(await claudeRow.getByText(/^Đã đăng nhập/, { exact: false }).count(), 0);
  await codexRow.getByText('Lỗi đăng nhập', { exact: true }).waitFor();
  await codexRow.getByText('không chuyển sang Demo', { exact: false }).waitFor();
  assert.equal(await codexRow.getByText(/^Đã đăng nhập/, { exact: false }).count(), 0);
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

  const editResearcher = async () => {
    await page.getByRole('button', { name: 'Tùy chọn Researcher', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Chỉnh sửa' }).click();
    return page.getByRole('combobox', { name: 'Model', exact: true });
  };
  const model = await editResearcher();
  await model.click();
  // Accessible names ignore decorative ProviderMark glyphs; allTextContents would see Cursor's "C" monogram.
  for (const name of ['Claude Code', 'Codex', 'Cursor Agent']) {
    await page.getByRole('option', { name: new RegExp(`^${name}`) }).waitFor();
  }
  await page.screenshot({ path: 'test-results/model-select.png' });
  await page.keyboard.press('Escape');

  await model.click(); await page.getByRole('option', { name: /^Claude Code/ }).click();
  await page.getByText('Dùng bản Claude Code đã cài', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Lưu nhân viên', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('textbox', { name: 'Nội dung công việc' }).fill('Harness send gate');
  const send = page.getByRole('button', { name: 'Gửi công việc', exact: true });
  assert.equal(await page.getByText('Giới hạn task', { exact: false }).count(), 0);
  await noDemo(page);
  assert.equal(await send.isDisabled(), true);
  // setupHint uses providerLabel ("Claude Code trên máy này"), not the short catalog name.
  const detectedHint = hint.detected('Claude Code');
  await page.getByRole('button', { name: detectedHint, exact: true }).waitFor();
  await page.getByRole('button', { name: detectedHint, exact: true }).click();
  await page.getByRole('tab', { name: 'Harness trên máy', exact: true }).waitFor();
  await page.getByRole('region', { name: 'Harness trên máy' }).getByText('Claude Code', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  if (await openSidebar.count()) await openSidebar.click();

  const authFailModel = await editResearcher();
  await authFailModel.click(); await page.getByRole('option', { name: /^Codex/ }).click();
  await page.getByText('Dùng bản Codex đã cài', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Lưu nhân viên', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await noDemo(page);
  assert.equal(await page.getByText('Giới hạn task', { exact: false }).count(), 0);
  assert.equal(await send.isDisabled(), true);
  const authFailHint = hint.auth_error('Codex');
  await page.getByRole('button', { name: authFailHint, exact: true }).waitFor();
  await page.getByRole('button', { name: authFailHint, exact: true }).click();
  await page.getByRole('tab', { name: 'Harness trên máy', exact: true }).waitFor();
  await page.getByRole('region', { name: 'Harness trên máy' }).getByText('Codex', { exact: true }).waitFor();

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ directory, detected: detected.map(({ id, version, auth, status }) => ({ id, version, auth, status })), result: 'passed' }));
} finally { if (!closed) await app.close(); }
