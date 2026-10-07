import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { packagedExecutable } from './packaged-executable.mjs';
import { isolatedHarnessEnvironment } from './fake-harnesses.mjs';
import { label, labelBefore, useEnglish, useFullSidebar, openHome } from './smoke-language.mjs';

const directory = await mkdtemp(join(tmpdir(), 'orglet-marketplace-'));
const { env } = await isolatedHarnessEnvironment(directory);
await mkdir('test-results', { recursive: true });
const launch = () => electron.launch({ executablePath: packagedExecutable(), args: [`--user-data-dir=${directory}`], env });
const workspace = page => page.evaluate(() => window.orglet.call('workspace', {}));
const settle = page => page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => undefined))));
async function openDiscover(page) {
  await openHome(page);
  await page.locator('.sidebar').getByRole('button', { name: 'Marketplace', exact: true }).click();
  await page.locator('.marketplace-listing').first().waitFor();
}
let app = await launch();
try {
  let page = await app.firstWindow();
  await page.setViewportSize({ width: 1200, height: 820 });
  await useEnglish(page);
  await openDiscover(page);
  // The catalog that ships with the app also lists a space; a catalog server from before spaces lists these two.
  for (const name of ['Research friend', 'Research and review']) assert.equal(await page.locator('.marketplace-listing').filter({ hasText: name }).count(), 1, `${name} is listed once`);
  assert.ok(await page.locator('.marketplace-listing').count() <= 3);
  assert.match(await page.locator('.marketplace-source').innerText(), new RegExp(['Danh mục trực tuyến', 'Danh mục đã lưu trên máy', 'Danh mục CodePawl đi kèm app'].map(key => label(key)).join('|')));
  await page.screenshot({ path: 'test-results/marketplace-light-wide.png' });
  await page.locator('.marketplace-listing').filter({ hasText: 'Research friend' }).getByRole('button', { name: label('Thêm'), exact: true }).click();
  await page.getByRole('heading', { name: label('Đang nhắn với {0}', ['Research friend']), exact: true }).waitFor();
  const orglet = (await workspace(page)).workers.find(worker => worker.name === 'Research friend');
  assert.ok(orglet);
  assert.equal(orglet.provider, 'demo');
  assert.equal(orglet.autoApplyProposals, undefined);
  assert.equal(orglet.mcpServerIds, undefined);
  assert.equal((await workspace(page)).tasks.length, 0, 'Add never sends a message or creates a chat row');
  await openDiscover(page);
  await page.locator('.marketplace-listing').filter({ hasText: 'Research friend' }).getByText(label('Đã thêm'), { exact: true }).waitFor();
  assert.equal(await page.locator('.marketplace-listing').filter({ hasText: 'Research friend' }).getByRole('button', { name: label('Thêm bản nữa'), exact: true }).isEnabled(), true);
  await page.locator('.marketplace-listing').filter({ hasText: 'Research and review' }).getByRole('button', { name: label('Thêm'), exact: true }).click();
  await page.getByRole('heading', { name: label('Đang nhắn với {0}', ['Research and review']), exact: true }).waitFor();
  const crew = (await workspace(page)).teams.find(team => team.name === 'Research and review');
  assert.ok(crew);
  assert.equal(crew.memberIds.length, 2);
  assert.ok((await workspace(page)).emptyChannels.some(channel => channel.crewId === crew.id));
  await openDiscover(page);
  await page.evaluate(async () => {
    const workspace = await window.orglet.call('workspace', {});
    await window.orglet.call('settings', { theme: 'dark', connectionLimitMicros: workspace.connectionLimitMicros });
  });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.setViewportSize({ width: 740, height: 600 });
  await page.screenshot({ path: 'test-results/marketplace-dark-narrow.png' });
  // The online catalog and the one that ships with the app also list a space; a catalog server from before spaces lists two.
  const listed = await page.locator('.marketplace-listing').count();
  assert.ok(listed === 2 || listed === 3, `${listed} listings`);
  const overflow = await page.locator('.marketplace').evaluate(element => element.scrollWidth > element.clientWidth);
  assert.equal(overflow, false, 'Discover content fits the narrow panel');
  const before = await page.evaluate(() => window.orglet.call('marketInstallations', {}));
  const catalog = await page.evaluate(() => window.orglet.call('marketCatalog', {}));
  await page.evaluate(async entityId => {
    const workspace = await window.orglet.call('workspace', {});
    const worker = workspace.workers.find(item => item.id === entityId);
    await window.orglet.call('saveWorker', { ...worker, instructions: 'My customized research instructions' });
  }, orglet.id);
  await app.close();
  // An immutable v2 fixture in this throwaway profile exercises the real cached-body IPC update path offline.
  const database = new DatabaseSync(join(directory, 'orglet.sqlite'));
  try {
    const row = database.prepare("SELECT data FROM settings WHERE id LIKE 'marketBody:research-friend:1:%'").get();
    const template = JSON.parse(JSON.parse(row.data));
    template.worker.instructions = 'Research updated questions and clearly distinguish evidence from assumptions.';
    template.skill.content = 'Compare sources, then write a concise evidence note.';
    const body = JSON.stringify(template);
    const sha256 = createHash('sha256').update(body).digest('hex');
    const listing = catalog.listings.find(item => item.listingId === 'research-friend');
    const listings = catalog.listings.map(item => item.listingId === listing.listingId ? { ...item, version: 2, sha256, changelog: 'Updated research instructions and evidence skill.' } : item);
    const save = database.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data');
    save.run('marketCatalog', JSON.stringify({ catalog: { listings }, fetchedAt: new Date().toISOString() }));
    save.run(`marketBody:research-friend:2:${sha256}`, JSON.stringify(body));
  } finally {
    database.close();
  }
  app = await launch();
  page = await app.firstWindow();
  await page.waitForFunction(() => window.orglet !== undefined);
  const after = await page.evaluate(() => window.orglet.call('marketInstallations', {}));
  assert.deepEqual(after.map(item => ({ ...item, updateAvailable: false })), before, 'origin links survive a packaged app restart');
  await openHome(page);
  await page.locator('.sidebar').getByRole('button', { name: label('Tùy chọn {0}', ['Research friend']), exact: true }).first().click();
  await page.getByRole('menuitem', { name: label('Chỉnh sửa'), exact: true }).click();
  await page.locator('.marketplace-profile').waitFor();
  await settle(page);
  await page.screenshot({ path: 'test-results/marketplace-profile-update.png' });
  assert.equal(await page.locator('.marketplace-profile button').getAttribute('type'), 'button');
  await page.locator('.marketplace-profile').getByRole('button', { name: label('Có bản cập nhật'), exact: true }).click();
  await page.locator('.marketplace-update').waitFor();
  await page.getByRole('button', { name: label('Hủy'), exact: true }).click();
  await page.locator('.marketplace-update').waitFor({ state: 'detached' });
  assert.equal(await page.locator('.marketplace-profile').isVisible(), true, 'Review never submits or closes the profile form');
  assert.equal((await workspace(page)).workers.find(worker => worker.id === orglet.id).revision, 2);
  await page.keyboard.press('Escape');
  await page.locator('.marketplace-profile').waitFor({ state: 'detached' });
  await openDiscover(page);
  await page.getByRole('button', { name: label('Xem bản cập nhật'), exact: true }).click();
  await page.locator('.marketplace-update').waitFor();
  assert.match(await page.locator('.marketplace-update').innerText(), /My customized research instructions/);
  assert.ok((await page.locator('.marketplace-update').innerText()).includes(labelBefore('Bạn đã chỉnh sửa bản này. Áp dụng sẽ thay nội dung mẫu bằng bản bên phải; kết nối và quyền trên máy vẫn giữ nguyên.')));
  await page.keyboard.press('Escape');
  await page.locator('.marketplace-update').waitFor({ state: 'detached' });
  assert.equal(await page.getByRole('button', { name: label('Xem bản cập nhật'), exact: true }).evaluate(element => element === document.activeElement), true);
  await page.keyboard.press('Enter');
  await page.locator('.marketplace-update').waitFor();
  await page.getByRole('button', { name: label('Hủy'), exact: true }).click();
  await page.locator('.marketplace-update').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: label('Xem bản cập nhật'), exact: true }).click();
  await page.locator('.marketplace-update').waitFor();
  await page.setViewportSize({ width: 1200, height: 820 });
  await settle(page);
  assert.equal(await page.locator('.marketplace-comparison-columns').first().evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length), 2);
  await page.screenshot({ path: 'test-results/marketplace-update-wide.png' });
  await page.setViewportSize({ width: 580, height: 600 });
  await settle(page);
  assert.equal(await page.locator('.marketplace-comparison-columns').first().evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length), 1);
  await page.screenshot({ path: 'test-results/marketplace-update-narrow.png' });
  assert.equal(await page.locator('.marketplace-update').evaluate(element => element.scrollWidth > element.clientWidth), false);
  await page.getByRole('button', { name: label('Áp dụng bản cập nhật'), exact: true }).click();
  await page.locator('.marketplace-update').waitFor({ state: 'detached' });
  const updated = (await workspace(page)).workers.find(worker => worker.id === orglet.id);
  assert.equal(updated.revision, 3);
  assert.match(updated.instructions, /Research updated questions/);
  await page.setViewportSize({ width: 1200, height: 820 });
  await useFullSidebar(page);
  await openDiscover(page);
  await page.locator('.marketplace-listing').filter({ hasText: 'Research friend' }).getByRole('button', { name: label('Thêm bản nữa'), exact: true }).click();
  await page.getByRole('heading', { name: label('Đang nhắn với {0}', ['Research friend']), exact: true }).waitFor();
  // The crew also contains a friend with that display name; count copies by their listing origin.
  const copies = (await page.evaluate(() => window.orglet.call('marketInstallations', {}))).filter(item => item.listingId === 'research-friend' && item.kind === 'orglet');
  assert.equal(copies.length, 2, 'Add another copy creates a separate local friend');
  assert.equal(new Set(copies.map(copy => copy.entityId)).size, 2);
  assert.equal((await workspace(page)).workers.find(worker => worker.id === orglet.id).revision, 3, 'repeated Add preserves the edited original');
  assert.equal((await workspace(page)).tasks.length, 0, 'repeated Add also creates no chat or turn');
  await openDiscover(page);
  await page.getByText(label('Đã thêm {0} bản trên máy', [2]), { exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/marketplace-installed-copies.png' });
  console.log('Packaged marketplace smoke passed: Discover, orglet and crew Add, safe defaults, no chat side effects, narrow layouts, persisted origins, customized update comparison and revision.');
} finally {
  await app.close().catch(() => undefined);
}
