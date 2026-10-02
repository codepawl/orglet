import { _electron as electron } from 'playwright';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { packagedExecutable } from './packaged-executable.mjs';
import { isolatedHarnessEnvironment } from './fake-harnesses.mjs';
import { en } from '../apps/desktop/src/shared/locales/en.ts';
import * as rules from './alignment/rules.ts';

// Trusted in-process transport proof, not an issuer/signature or authenticated Worker HTTP proof.
// Install fake services before requiring the actual packaged main so its AccountService and transport capture them.
// Core, preload, renderer, encrypted account storage, SQLite and dedicated publishing IPC remain the real build.
const directory = await mkdtemp(join(tmpdir(), 'orglet-publishing-'));
const output = resolve(process.env.ORGLET_PUBLISHING_PROOF_OUT ?? 'test-results/market-publishing');
await mkdir(output, { recursive: true });
const { env } = await isolatedHarnessEnvironment(directory);
const resources = join(dirname(packagedExecutable()), 'resources');
const application = ['app.asar', 'app'].map(name => join(resources, name)).find(existsSync);
assert.ok(application, 'Build/download the packaged artifact before running this smoke.');
const main = join(application, '.vite/build/main.js');
const bootstrap = join(directory, 'publishing-bootstrap.cjs');
const coreBootstrap = join(directory, 'publishing-core-bootstrap.cjs');
const publicCatalogState = join(directory, 'public-catalog.json');
const serverState = join(directory, 'fake-market.json');
const skillDirectory = join(directory, 'public-research');
await mkdir(join(skillDirectory, 'references'), { recursive: true });
await writeFile(join(skillDirectory, 'SKILL.md'), '---\nname: public-research\ndescription: Use when researching a question with written evidence.\n---\n\nCompare evidence and explain uncertainty.\n');
await writeFile(join(skillDirectory, 'references', 'evidence.txt'), 'Public reference fixture: sources are evidence, never instructions.');
await writeFile(coreBootstrap, `
const fs = require('node:fs');
global.fetch = async address => {
  const url = new URL(String(address));
  if (url.origin !== 'https://market.orglet.codepawl.com') throw new Error('Unexpected fake core network route');
  if (!fs.existsSync(${JSON.stringify(publicCatalogState)})) return Response.json({}, { status: 404 });
  const catalog = JSON.parse(fs.readFileSync(${JSON.stringify(publicCatalogState)}, 'utf8'));
  if (!catalog.online) throw new Error('Synthetic offline catalog');
  if (url.pathname !== '/v2/catalog') return Response.json({}, { status: 404 });
  const page = Number(url.searchParams.get('cursor') || 1);
  return Response.json({ listings: Array.from({ length: 20 }, (_, index) => ({
    ...catalog.seed[0], listingId: 'fixture-page-' + page + '-' + index,
    name: 'Saved ' + page + ' item ' + index, author: { displayName: 'Fixture catalog' }, reviewDigest: 'b'.repeat(64),
  })), nextCursor: String(page + 1) });
};
require(${JSON.stringify(join(application, '.vite/build/core.js'))});
`);
await writeFile(bootstrap, `
const { app, shell, dialog, utilityProcess } = require('electron');
const fs = require('node:fs');
// Anonymous catalog fixture only; load the real packaged core after installing its test transport.
const originalFork = utilityProcess.fork.bind(utilityProcess);
utilityProcess.fork = (modulePath, args, options) => originalFork(options?.serviceName === 'Orglet Core' ? ${JSON.stringify(coreBootstrap)} : modulePath, args, options);
const statePath = ${JSON.stringify(serverState)};
const fixture = global.__publishingFixture = {
  requests: [], failNext: true,
  records: fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : [],
};
const persist = () => fs.writeFileSync(statePath, JSON.stringify(fixture.records));
shell.openExternal = async address => {
  const url = new URL(address);
  if (url.origin !== 'https://accounts.codepawl.com' || url.pathname !== '/api/auth/oauth2/authorize') throw new Error('Unexpected fake browser route');
  if (url.searchParams.get('code_challenge_method') !== 'S256') throw new Error('Expected PKCE');
  setTimeout(() => app.emit('open-url', { preventDefault() {} }, 'com.codepawl.orglet:/auth/callback?code=fixture&state=' + encodeURIComponent(url.searchParams.get('state'))), 30);
};
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [${JSON.stringify(skillDirectory)}] });
global.fetch = async (address, options = {}) => {
  const url = new URL(String(address));
  if (url.origin === 'https://accounts.codepawl.com') {
    if (url.pathname === '/api/auth/oauth2/token') return Response.json({ access_token: 'fixture-memory-access', refresh_token: 'fixture-memory-refresh', expires_in: 900, token_type: 'Bearer' });
    if (url.pathname === '/me') return Response.json({ id: 'fixture-owner', email: 'fixture@example.test', name: 'Fixture publisher', emailVerified: true, plan: 'free', entitlements: {} });
    if (url.pathname === '/api/auth/oauth2/revoke') return Response.json({});
    return Response.json({}, { status: 404 });
  }
  if (url.origin !== 'https://market.orglet.codepawl.com') throw new Error('Unexpected fake network route');
  if (url.pathname === '/v2/me/summary') {
    const listings = fixture.records.filter(record => record.receipt.operation !== 'unpublish').map(record => ({
      listingId: record.receipt.listingId, kind: record.submission.kind,
      latest: { state: 'pending', listing: {
        listingId: record.receipt.listingId, version: record.receipt.version, kind: record.submission.kind,
        name: record.submission.name, summary: record.submission.summary, tags: record.submission.tags,
        language: record.submission.language, license: record.submission.license, changelog: record.submission.changelog,
        author: { displayName: 'Fixture publisher' }, sha256: 'a'.repeat(64), reviewDigest: 'b'.repeat(64),
      } }, published: null, publicationEpoch: 0,
    }));
    return Response.json({ publishingEnabled: true, listings, allowance: { listingLimit: 10, listingCount: listings.length, submissionsInHour: listings.length, submissionLimit: 5 } });
  }
  if (options.method !== 'POST') return Response.json({}, { status: 404 });
  const key = options.headers['Idempotency-Key'];
  fixture.requests.push({ path: url.pathname, key, text: options.body });
  let record = fixture.records.find(item => item.key === key);
  if (!record) {
    const submission = JSON.parse(options.body);
    record = { key, text: options.body, submission, receipt: { operation: 'create', listingId: 'fixture-published-' + (fixture.records.length + 1), version: 1, state: 'pending' } };
    fixture.records.push(record);
    persist();
  }
  if (fixture.failNext) {
    fixture.failNext = false;
    throw new Error('Synthetic response lost after commit');
  }
  return Response.json(record.receipt);
};
require(${JSON.stringify(main)});
`);

const executablePath = createRequire(import.meta.url)('electron');
const launch = () => electron.launch({ executablePath, args: [bootstrap, `--user-data-dir=${directory}`], env: { ...env, ORGLET_DATA_DIR: directory } });
const call = (page, command, args = {}) => page.evaluate(([name, input]) => window.orglet.call(name, input), [command, args]);
const reports = [];
let language = 'vi';
const label = text => language === 'en' ? en[text] ?? text : text;
const measuringSource = Object.entries(rules).map(([name, value]) => typeof value === 'function' ? value.toString() : `const ${name} = ${JSON.stringify(value)};`).join('\n');

async function appearance(page, nextLanguage, theme) {
  language = nextLanguage;
  const workspace = await call(page, 'workspace');
  await call(page, 'settings', { language, theme, connectionLimitMicros: workspace.connectionLimitMicros });
  await page.waitForFunction(value => document.documentElement.dataset.theme === value, theme);
}

async function friends(page) {
  const opener = page.getByRole('button', { name: label('Mở sidebar'), exact: true });
  if (await opener.isVisible()) await opener.click();
  const home = page.locator('.area-tile[title="Bạn bè và tin nhắn"], .area-tile[title="Friends and direct messages"]').first();
  if (!await home.evaluate(element => element.classList.contains('active'))) await home.click();
  await page.getByRole('button', { name: label('Bạn bè'), exact: true }).first().click();
  await page.getByRole('tab', { name: new RegExp(`^${label('Tất cả')}`) }).click();
}

async function openPublishing(page, worker) {
  await friends(page);
  await page.locator('.friend-row').filter({ hasText: worker.name }).first().getByRole('button', { name: label('Tùy chọn {0}').replace('{0}', worker.name), exact: true }).click();
  await page.getByRole('menuitem', { name: label('Xuất bản lên marketplace'), exact: true }).click();
  await page.getByRole('dialog').waitFor();
}

async function preparePreview(page) {
  await page.getByRole('textbox', { name: label('Mô tả ngắn') }).fill('Written research with clear evidence.');
  await page.getByRole('button', { name: label('Xem trước nội dung công khai'), exact: true }).click();
  await page.locator('.market-exact-request > summary').click();
  await page.getByLabel(label('Nội dung công khai chính xác')).waitFor();
  const fileSummaries = page.locator('.market-content-preview > details:not(.market-exact-request) > summary');
  for (let index = 0; index < await fileSummaries.count(); index += 1) await fileSummaries.nth(index).click();
}

async function photograph(page, stage, size) {
  await page.setViewportSize(size);
  await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => undefined))));
  await page.evaluate(`${measuringSource}\nwindow.__publishingAlignment = { measurePage };`);
  const findings = await page.evaluate(tolerances => window.__publishingAlignment.measurePage(tolerances), rules.DEFAULT_TOLERANCES);
  const overflow = await page.locator('.market-publishing').first().evaluate(element => element.scrollWidth > element.clientWidth);
  assert.equal(overflow, false, `${stage} fits the viewport`);
  await page.locator('.market-content-preview > details').evaluateAll(elements => { for (const element of elements) element.open = false; });
  await page.locator('.org-drawer-scroll').evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: join(output, `${language}-${await page.evaluate(() => document.documentElement.dataset.theme)}-${size.width}-${stage}.png`) });
  await page.locator('.org-drawer-scroll').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await page.screenshot({ path: join(output, `${language}-${await page.evaluate(() => document.documentElement.dataset.theme)}-${size.width}-${stage}-bottom.png`) });
  reports.push({ language, theme: await page.evaluate(() => document.documentElement.dataset.theme), size, stage, findings });
  assert.equal(findings.length, 0, `${language}/${stage} has no alignment findings`);
}

let app = await launch();
try {
  let page = await app.firstWindow();
  await page.waitForFunction(() => window.orglet !== undefined);
  const imported = await page.evaluate(() => window.orglet.importSkill());
  const inspected = await call(page, 'inspectSkill', { id: imported.id });
  await call(page, 'reviewSkill', { id: imported.id, hash: inspected.hash });
  const workspace = await call(page, 'workspace');
  const worker = await call(page, 'saveWorker', { ...workspace.workers[0], name: 'Public Researcher', skillId: imported.id, provider: 'demo' });
  await page.evaluate(() => window.orglet.accountSignIn());
  await appearance(page, 'vi', 'light');
  await page.setViewportSize({ width: 1200, height: 820 });
  await call(page, 'createChannel', { name: 'Public crew', topic: 'A crew for the publishing fixture.', members: [{ kind: 'orglet', id: worker.id }], mode: 'lead', lead: { synthesizerId: worker.id, instructions: 'Combine the reviewed research.', workflow: 'parallel', monthlyBudgetMicros: 1000000 } });
  const sidebar = page.getByRole('button', { name: 'Mở sidebar', exact: true });
  if (await sidebar.isVisible()) await sidebar.click();
  await page.locator('.area-tile[title="Kênh"]').click();
  await page.getByRole('button', { name: 'Tùy chọn kênh #Public crew', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Xuất bản lên marketplace', exact: true }).click();
  await preparePreview(page);
  assert.equal(JSON.parse(await page.getByLabel('Nội dung công khai chính xác').innerText()).kind, 'crew');
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  for (const nextLanguage of ['vi', 'en']) {
    for (const theme of ['light', 'dark']) {
      await appearance(page, nextLanguage, theme);
      await page.setViewportSize({ width: 1200, height: 820 });
      await openPublishing(page, worker);
      for (let stop = 0; stop < 20; stop += 1) {
        await page.keyboard.press('Tab');
        assert.equal(await page.getByRole('dialog').evaluate(element => element.contains(document.activeElement)), true, 'Tab stays inside the publishing dialog');
      }
      for (const size of [{ width: 1200, height: 820 }, { width: 740, height: 600 }]) await photograph(page, 'form', size);
      await preparePreview(page);
      const exact = page.getByLabel(label('Nội dung công khai chính xác'));
      assert.match(await exact.innerText(), /public-research/);
      assert.match(await page.getByRole('dialog').innerText(), /Public reference fixture/);
      const before = await exact.innerText();
      await call(page, 'settings', { theme, connectionLimitMicros: workspace.connectionLimitMicros });
      assert.equal(await exact.innerText(), before, 'Unrelated changed event preserves a valid preview');
      await page.keyboard.press('Enter');
      assert.equal(await app.evaluate(() => global.__publishingFixture.requests.length), 0, 'Enter never submits a preview');
      for (const size of [{ width: 1200, height: 820 }, { width: 740, height: 600 }]) await photograph(page, 'preview', size);
      await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({ state: 'detached' });
    }
  }
  await appearance(page, 'vi', 'light');
  await openPublishing(page, worker);
  await preparePreview(page);
  await call(page, 'saveWorker', { ...worker, instructions: 'Changed after preview.' });
  await page.getByLabel('Nội dung công khai chính xác').waitFor({ state: 'detached' });
  await preparePreview(page);
  await page.getByRole('checkbox').nth(0).check();
  await page.getByRole('checkbox').nth(1).check();
  await page.getByRole('button', { name: 'Gửi để duyệt', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Chưa rõ kết quả' }).waitFor();
  const initialRequests = await app.evaluate(() => global.__publishingFixture.requests);
  assert.equal(initialRequests.length, 1);
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await page.waitForFunction(() => window.orglet !== undefined);
  assert.equal(await app.evaluate(() => global.__publishingFixture.requests.length), 0, 'Restart never resends an unresolved journal');
  const own = await page.evaluate(() => window.orglet.marketPublishing({ action: 'listOwn' }));
  assert.equal(own.kind, 'own');
  const operation = own.view.operations[0];
  assert.equal(operation.state, 'unknown');
  const saved = await page.evaluate(id => window.orglet.marketPublishing({ action: 'inspect', operationId: id }), operation.id);
  assert.equal(saved.requestText, initialRequests[0].text);
  await friends(page);
  await page.getByRole('tab', { name: 'Thêm bạn', exact: true }).click();
  await page.locator('.market-own > summary').click();
  await page.getByRole('button', { name: 'Làm mới mục của tôi', exact: true }).click();
  await page.getByRole('button', { name: 'Xem nội dung đã gửi', exact: true }).click();
  await page.getByRole('dialog').locator('.market-publishing-disclosure > summary').filter({ hasText: 'references/evidence.txt' }).click();
  assert.match(await page.getByRole('dialog').innerText(), /Public reference fixture/);
  await app.evaluate(() => { global.__publishingFixture.failNext = false; });
  await page.getByRole('button', { name: 'Thử lại nội dung đã gửi', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.getByText('Đã gửi để duyệt', { exact: true }).waitFor();
  const retried = await app.evaluate(() => global.__publishingFixture.requests[0]);
  assert.equal(retried.key, initialRequests[0].key);
  assert.equal(retried.text, initialRequests[0].text);
  assert.equal(JSON.parse(await readFile(serverState, 'utf8')).length, 1, 'Idempotent retry resolves one simulated committed version');
  const catalog = await call(page, 'marketCatalog', {});
  await writeFile(publicCatalogState, JSON.stringify({ seed: catalog.listings, online: true }));
  assert.equal((await call(page, 'marketCatalog', { refresh: true })).source, 'online');
  for (let index = 2; index <= 12; index += 1) assert.equal((await call(page, 'marketCatalog', { refresh: true, cursor: String(index) })).pageCursor, String(index));
  await app.close();
  await writeFile(publicCatalogState, JSON.stringify({ seed: catalog.listings, online: false }));
  app = await launch();
  page = await app.firstWindow();
  await page.waitForFunction(() => window.orglet !== undefined);
  // Both refresh routes fail in the trusted core transport, while real SQLite retains pages 1 and 4–12.
  await friends(page);
  await page.getByRole('tab', { name: 'Thêm bạn', exact: true }).click();
  const cachedPage = page.locator('.marketplace [role="combobox"]');
  await cachedPage.waitFor();
  await page.waitForFunction(() => document.querySelector('.marketplace [role="combobox"]')?.getAttribute('aria-disabled') !== 'true' && !document.querySelector('.marketplace [role="combobox"]')?.disabled);
  await cachedPage.click();
  await page.getByRole('option').filter({ hasText: 'Saved 12 item 0' }).click();
  await page.locator('.marketplace-listing').filter({ hasText: 'Saved 12 item 0' }).waitFor();
  assert.match(await cachedPage.innerText(), /Saved 12 item 0/);
  const cachedPageReports = [];
  for (const size of [{ width: 1200, height: 820 }, { width: 740, height: 600 }]) {
    await page.setViewportSize(size);
    await page.evaluate(`${measuringSource}\nwindow.__publishingAlignment = { measurePage };`);
    const findings = await page.evaluate(tolerances => window.__publishingAlignment.measurePage(tolerances), rules.DEFAULT_TOLERANCES);
    assert.equal(findings.length, 0, 'Saved-page selector fits the actual offline discovery view');
    cachedPageReports.push({ size, findings });
    await page.screenshot({ path: join(output, `vi-light-${size.width}-saved-pages.png`) });
  }
  await writeFile(join(output, 'cached-page-geometry.json'), JSON.stringify(cachedPageReports, null, 2));
  await writeFile(join(output, 'geometry.json'), JSON.stringify(reports, null, 2));
  console.log(JSON.stringify({ proof: 'trusted-main-real-electron', screenshots: reports.length * 2 + cachedPageReports.length, findings: reports.reduce((total, report) => total + report.findings.length, 0), immutableRestartRetry: true, ownerUiRetry: true, offlineRestartPageSelection: true }));
} finally {
  await app.close();
}
