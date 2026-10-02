import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { packagedExecutable } from './packaged-executable.mjs';
import { isolatedHarnessEnvironment } from './fake-harnesses.mjs';
import { useVietnamese, openHome } from './smoke-language.mjs';

const directory = await mkdtemp(join(tmpdir(), 'orglet-marketplace-'));
const { env } = await isolatedHarnessEnvironment(directory);
await mkdir('test-results', { recursive: true });
const launch = () => electron.launch({ executablePath: packagedExecutable(), args: [`--user-data-dir=${directory}`], env });
const workspace = page => page.evaluate(() => window.orglet.call('workspace', {}));
async function openDiscover(page) {
  await openHome(page);
  await page.getByRole('button', { name: 'Bạn bè', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Thêm bạn', exact: true }).click();
  await page.locator('.marketplace-listing').first().waitFor();
}
let app = await launch();
try {
  let page = await app.firstWindow();
  await page.setViewportSize({ width: 1200, height: 820 });
  await useVietnamese(page);
  await openDiscover(page);
  assert.equal(await page.locator('.marketplace-listing').count(), 2);
  assert.match(await page.locator('.marketplace-source').innerText(), /Danh mục/);
  await page.screenshot({ path: 'test-results/marketplace-light-wide.png' });
  await page.locator('.marketplace-listing').filter({ hasText: 'Research friend' }).getByRole('button', { name: 'Thêm bạn', exact: true }).click();
  await page.getByRole('heading', { name: 'Đang nhắn với Research friend', exact: true }).waitFor();
  const orglet = (await workspace(page)).workers.find(worker => worker.name === 'Research friend');
  assert.ok(orglet);
  assert.equal(orglet.provider, 'demo');
  assert.equal(orglet.autoApplyProposals, undefined);
  assert.equal(orglet.mcpServerIds, undefined);
  assert.equal((await workspace(page)).tasks.length, 0, 'Add never sends a message or creates a chat row');
  await openDiscover(page);
  await page.locator('.marketplace-listing').filter({ hasText: 'Research and review' }).getByRole('button', { name: 'Thêm bạn', exact: true }).click();
  await page.getByRole('heading', { name: 'Đang nhắn với Research and review', exact: true }).waitFor();
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
  assert.equal(await page.locator('.marketplace-listing').count(), 2);
  const overflow = await page.locator('.marketplace').evaluate(element => element.scrollWidth > element.clientWidth);
  assert.equal(overflow, false, 'Discover content fits the narrow panel');
  const before = await page.evaluate(() => window.orglet.call('marketInstallations', {}));
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await page.waitForFunction(() => window.orglet !== undefined);
  const after = await page.evaluate(() => window.orglet.call('marketInstallations', {}));
  assert.deepEqual(after, before, 'origin links survive a packaged app restart');
  console.log('Packaged marketplace smoke passed: Discover, orglet and crew Add, safe defaults, no chat side effects, narrow dark layout, persisted origins.');
} finally { await app.close().catch(() => undefined); }
