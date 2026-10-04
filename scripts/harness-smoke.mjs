import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { useVietnamese, openSettings, expandSidebar } from './smoke-language.mjs';
import { packagedExecutable } from './packaged-executable.mjs';
import { isolatedHarnessEnvironment } from './fake-harnesses.mjs';

const pills = { not_installed: 'Chưa cài', detected: 'Chưa đăng nhập', signed_in_ready: 'Sẵn sàng', signed_in: 'Đã đăng nhập', auth_error: 'Lỗi đăng nhập' };
const hint = { not_installed: name => `Cài và đăng nhập ${name} trên máy này`, detected: name => `Đăng nhập ${name} trên máy này`, auth_error: name => `Sửa đăng nhập ${name} trên máy này` };

const directory = await mkdtemp(join(tmpdir(), 'orglet-harness-ui-'));
await mkdir('test-results', { recursive: true });
const { bin, env } = await isolatedHarnessEnvironment(directory);
// On a developer machine a real, installed CLI can outrank its fake (COD-170). It then runs against an empty config
// folder, so it must read as signed out, but the fake's own answers (a version, an unreadable login probe) do not apply.
const usesFake = item => item.executable.toLowerCase().startsWith(bin.toLowerCase());
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
  assert.deepEqual(detected.map(item => item.id), ['claude-code', 'codex', 'cursor', 'gemini']);
  const claude = detected.find(item => item.id === 'claude-code');
  const codex = detected.find(item => item.id === 'codex');
  const gemini = detected.find(item => item.id === 'gemini');
  // A real CLI on this machine, Cursor Agent under the real %LOCALAPPDATA% among them, still reads as signed out.
  for (const item of detected) assert.notEqual(item.auth, 'logged_in', `${item.id} read this machine's sign-in`);
  // Found on PATH with no sign-in in its folder: detected, never ready.
  assert.equal(gemini.auth, 'logged_out');
  assert.equal(gemini.status, 'detected');
  if (usesFake(gemini)) assert.equal(gemini.version, '0.61.0');
  // detect ≠ signed-in: fixture Claude Code is found on disk, not logged_in.
  assert.equal(claude.auth, 'logged_out');
  assert.equal(claude.status, 'detected');
  assert.match(claude.version, /\d+\.\d+/);
  if (usesFake(codex)) {
    // auth-fail ≠ signed-in: fixture Codex login probe stays unknown, not logged_in.
    assert.equal(codex.auth, 'unknown');
    assert.equal(codex.status, 'auth_error');
  } else {
    assert.equal(codex.auth, 'logged_out');
    assert.equal(codex.status, 'detected');
  }
  assert.match(codex.version, /\d+\.\d+/);
  for (const item of detected) {
    // The empty config folders leave no harness signed in, fake or real.
    assert.notEqual(item.auth, 'logged_in', JSON.stringify(item));
    assert.ok(['not_installed', 'detected', 'signed_in', 'auth_error'].includes(item.status), JSON.stringify(item));
    assert.ok(typeof item.loginCommand === 'string' && item.loginCommand.length > 0, JSON.stringify(item));
    if (item.status !== 'not_installed') assert.ok(/\d+\.\d+/.test(item.version), JSON.stringify(item));
    assert.equal(item.runnable, true);
  }

  await openSettings(page);
  await page.getByRole('tab', { name: 'Harness trên máy', exact: true }).click();
  const section = page.getByRole('region', { name: 'Harness trên máy' });
  await section.waitFor();
  // The no-Demo note lives on the settings panel heading. Auth-fail rows also mention it, so do not search the whole panel.
  await page.locator('#settings-panel p.org-panel-heading-description').getByText('không chuyển sang Demo', { exact: false }).waitFor();
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
  await claudeRow.getByText('Chưa đăng nhập', { exact: true }).waitFor();
  assert.equal(await claudeRow.getByText(/^Đã đăng nhập/, { exact: false }).count(), 0);
  if (codex.status === 'auth_error') {
    await codexRow.getByText('Lỗi đăng nhập', { exact: true }).waitFor();
    await codexRow.getByText('không chuyển sang Demo', { exact: false }).waitFor();
  }
  assert.equal(await codexRow.getByText(/^Đã đăng nhập/, { exact: false }).count(), 0);
  const geminiRow = section.locator('.harness-row', { hasText: 'Gemini CLI' });
  await geminiRow.getByText('Chưa đăng nhập', { exact: true }).waitFor();
  // Gemini CLI signs in from its own menu, so the row names the choice to make there.
  await geminiRow.getByText('Sign in with Google', { exact: false }).waitFor();
  await geminiRow.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/settings-harness-gemini.png' });
  await page.getByRole('button', { name: 'Dò lại', exact: true }).click();
  await page.getByText('Đã dò lại harness', { exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/settings-connections.png' });
  await page.setViewportSize({ width: 600, height: 760 });
  assert.equal(await page.evaluate(() => { const panel = document.querySelector('.org-tabbed-dialog-panel'); return panel.scrollWidth > panel.clientWidth + 1; }), false);
  await page.screenshot({ path: 'test-results/settings-connections-narrow.png' });
  await page.setViewportSize({ width: 1200, height: 820 });
  await page.getByRole('tab', { name: 'Chi phí & giới hạn', exact: true }).click();
  await page.screenshot({ path: 'test-results/settings-usage.png' });
  await page.keyboard.press('Escape');
  // The narrow viewport collapsed the sidebar; reopen it before using row menus.
  await expandSidebar(page);

  const editResearcher = async () => {
    await page.getByRole('button', { name: 'Tùy chọn Researcher', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Chỉnh sửa' }).click();
    return page.getByRole('combobox', { name: 'Model', exact: true });
  };
  const model = await editResearcher();
  await model.click();
  // Accessible names ignore decorative ProviderMark glyphs; allTextContents would see Cursor's "C" monogram.
  for (const name of ['Claude Code', 'Codex', 'Cursor Agent', 'Gemini CLI']) {
    await page.getByRole('option', { name: new RegExp(`^${name}`) }).waitFor();
  }
  await page.screenshot({ path: 'test-results/model-select.png' });
  await page.keyboard.press('Escape');

  await model.click(); await page.getByRole('option', { name: /^Claude Code/ }).click();
  await page.getByText('Chạy bằng Claude Code trên máy', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Lưu Tí', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('textbox', { name: 'Tin nhắn' }).fill('Harness send gate');
  const send = page.getByRole('button', { name: 'Gửi tin nhắn', exact: true });
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

  // The login-probe failure path needs the fake Codex; a real one found first only reads as signed out.
  if (codex.status === 'auth_error') {
    const authFailModel = await editResearcher();
    await authFailModel.click(); await page.getByRole('option', { name: /^Codex/ }).click();
    await page.getByText('Chạy bằng Codex trên máy', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Lưu Tí', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await noDemo(page);
    assert.equal(await page.getByText('Giới hạn task', { exact: false }).count(), 0);
    assert.equal(await send.isDisabled(), true);
    const authFailHint = hint.auth_error('Codex');
    await page.getByRole('button', { name: authFailHint, exact: true }).waitFor();
    await page.getByRole('button', { name: authFailHint, exact: true }).click();
    await page.getByRole('tab', { name: 'Harness trên máy', exact: true }).waitFor();
    await page.getByRole('region', { name: 'Harness trên máy' }).getByText('Codex', { exact: true }).waitFor();
  } else {
    console.log(`Skipped the Codex login-probe failure path: a real Codex at ${codex.executable} outranks the fake.`);
  }

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ directory, detected: detected.map(({ id, version, auth, status }) => ({ id, version, auth, status })), result: 'passed' }));
} finally { if (!closed) await app.close(); }
