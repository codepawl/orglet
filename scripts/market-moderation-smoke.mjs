import { _electron as electron } from 'playwright';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { packagedExecutable } from './packaged-executable.mjs';
import { isolatedHarnessEnvironment } from './fake-harnesses.mjs';
import { en } from '../apps/desktop/src/shared/locales/en.ts';
import * as rules from './alignment/rules.ts';

// Trusted transport fixtures installed before real constructors. This does not prove JWT/signature or authenticated Worker HTTP.
// The packaged main, AccountService, utility core, preload and renderer are the actual application in an isolated profile.
const directory = await mkdtemp(join(tmpdir(), 'orglet-moderation-'));
const output = resolve(process.env.ORGLET_MODERATION_PROOF_OUT ?? 'test-results/market-moderation');
await mkdir(output, { recursive: true });
const { env } = await isolatedHarnessEnvironment(directory);
const resources = join(dirname(packagedExecutable()), 'resources');
const application = ['app.asar', 'app'].map(name => join(resources, name)).find(existsSync);
assert.ok(application, 'Build/download the packaged artifact before running this smoke.');
const bootstrap = join(directory, 'moderation-bootstrap.cjs');
const coreBootstrap = join(directory, 'moderation-core-bootstrap.cjs');
const serverState = join(directory, 'fake-moderation-state.json');
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object'
  ? `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}` : JSON.stringify(value);
const hash = text => createHash('sha256').update(text).digest('hex');
const versions = [1, 2].map(version => {
  const submission = { kind: 'orglet', name: 'Review fixture', summary: 'Inspect exact public instructions.', tags: ['review'], language: 'en', license: 'CC-BY-4.0', changelog: version === 2 ? 'Instructions updated for review.' : '', template: {
    format: 'orglet-worker-template', version: 1,
    worker: { name: 'Review fixture', instructions: `Version ${version}: inspect the supplied evidence.\n<script>window.__marketExecuted = true</script>\n${'Read the full literal text and keep private data out. '.repeat(12)}`.trim(), provider: 'demo', avatar: { emoji: '🔎' } },
    skill: { name: 'Evidence', content: 'Check facts and explain uncertainty.' },
  } };
  const { template, ...metadata } = submission;
  return { submission, listing: { ...metadata, listingId: 'listing-moderation-fixture', version, author: { displayName: 'Fixture publisher' }, sha256: hash(JSON.stringify(template)), reviewDigest: hash(canonical(submission)) } };
});
await writeFile(coreBootstrap, `
global.fetch = async address => {
  const url = new URL(String(address));
  if (url.origin !== 'https://market.orglet.codepawl.com') throw new Error('Unexpected core fixture network route');
  if (url.pathname === '/v2/catalog') return Response.json({ listings: [${JSON.stringify(versions[0].listing)}], nextCursor: null });
  return Response.json({}, { status: 404 });
};
require(${JSON.stringify(join(application, '.vite/build/core.js'))});
`);
await writeFile(bootstrap, `
const { app, shell, utilityProcess } = require('electron');
const fs = require('node:fs');
const originalFork = utilityProcess.fork.bind(utilityProcess);
utilityProcess.fork = (modulePath,args,options) => originalFork(options?.serviceName === 'Orglet Core' ? ${JSON.stringify(coreBootstrap)} : modulePath,args,options);
const versions = ${JSON.stringify(versions)};
const reportId = '20000000-0000-4000-8000-000000000001';
const persisted = fs.existsSync(${JSON.stringify(serverState)}) ? JSON.parse(fs.readFileSync(${JSON.stringify(serverState)},'utf8')) : {};
const fixture = global.__moderationFixture = { requests: persisted.requests || [], receipts: new Map(persisted.receipts || []), reviewer: true, failNext: false, staleNext: false, paused: false, approved: persisted.approved || false, reportState: persisted.reportState || 'open', failRead: false, failReports: false, reportPages: false };
const persist = () => fs.writeFileSync(${JSON.stringify(serverState)}, JSON.stringify({requests:fixture.requests,receipts:[...fixture.receipts],approved:fixture.approved,reportState:fixture.reportState}));
const detail = version => ({ listing: versions[version-1].listing, expected: { listingId: versions[0].listing.listingId,version,sha256:versions[version-1].listing.sha256,reviewDigest:versions[version-1].listing.reviewDigest,
  publicationEpoch:0,reviewRevision:version === 1 ? 1 : fixture.approved ? 1 : 0,moderationRevision:0,publishedVersion:fixture.approved ? 2 : 1 },
  state:version === 1 || fixture.approved ? 'approved' : 'pending',reason:'',hidden:false,hiddenReason:'',selfReview:true,reportCount:1 });
shell.openExternal = async address => {
  const url = new URL(address);
  if (url.origin !== 'https://accounts.codepawl.com' || url.pathname !== '/api/auth/oauth2/authorize') throw new Error('Unexpected browser fixture route');
  setTimeout(() => app.emit('open-url',{preventDefault(){}},'com.codepawl.orglet:/auth/callback?code=fixture&state='+encodeURIComponent(url.searchParams.get('state'))),30);
};
global.fetch = async (address,options={}) => {
  const url = new URL(String(address));
  if (url.origin === 'https://accounts.codepawl.com') {
    if (url.pathname === '/api/auth/oauth2/token') return Response.json({access_token:'fixture-memory-access',refresh_token:'fixture-memory-refresh',expires_in:900,token_type:'Bearer'});
    if (url.pathname === '/me') return Response.json({id:'fixture-owner',email:'fixture@example.test',name:'Fixture publisher',emailVerified:true,plan:'free',entitlements:{}});
    if (url.pathname === '/api/auth/oauth2/revoke') return Response.json({});
    return Response.json({}, {status:404});
  }
  if (url.origin !== 'https://market.orglet.codepawl.com') throw new Error('Unexpected main fixture network route');
  if (url.pathname === '/v2/me/moderation') return Response.json({canReview:fixture.reviewer,canReport:!fixture.paused,canWrite:!fixture.paused});
  if (url.pathname === '/v2/me/summary') return Response.json({publishingEnabled:false,listings:[],allowance:{listingLimit:10,listingCount:0,submissionLimit:5,submissionsInHour:0}});
  if (url.pathname.startsWith('/v2/review/') && !fixture.reviewer) return Response.json({code:'review_forbidden'},{status:403});
  if (url.pathname.startsWith('/v2/review/') && fixture.failRead) return Response.json({code:'storage_failed'},{status:503});
  if (options.method !== 'POST') {
    if (url.pathname === '/v2/review/queue') return Response.json({items:fixture.approved ? [] : [detail(2)],nextCursor:null});
    if (url.pathname.endsWith('/reports')) return fixture.failReports ? Response.json({code:'storage_failed'},{status:503}) : Response.json({items:[{id:reportId,listingId:versions[0].listing.listingId,version:2,reason:'privacy',explanation:'<img src=x onerror=window.__marketExecuted=true> Inspect the public instructions.',state:fixture.reportState,revision:fixture.reportState === 'open' ? 0 : 1,createdAt:1000000}],nextCursor:fixture.reportPages && !url.searchParams.has('cursor') ? 'fixture-next' : null});
    if (url.pathname.endsWith('/audit')) return Response.json({items:[],nextCursor:null});
    const match = new RegExp('/versions/([12])(?:/(body))?$').exec(url.pathname);
    if (match) return Response.json(match[2] ? versions[Number(match[1])-1].submission.template : detail(Number(match[1])));
    return Response.json({}, {status:404});
  }
  const key = options.headers['Idempotency-Key'];
  fixture.requests.push({path:url.pathname,key,text:options.body});
  if (fixture.staleNext) {fixture.staleNext=false;persist();return Response.json({code:'stale_review'},{status:409});}
  const input = JSON.parse(options.body);
  let receipt = fixture.receipts.get(key);
  if (!receipt) {
    const operation = url.pathname.endsWith('/report') ? 'report' : url.pathname.endsWith('/resolve') ? 'resolve' : input.decision;
    receipt = {id:require('node:crypto').randomUUID(),operation,listingId:versions[0].listing.listingId,version:operation === 'report' ? input.version : 2,
      state:operation === 'report' ? 'accepted' : operation === 'resolve' ? input.resolution : operation === 'approve' ? 'approved' : operation === 'reject' ? 'rejected' : 'hidden',
      ...(operation === 'report' ? {reportId:require('node:crypto').randomUUID()} : operation === 'resolve' ? {reportId:input.reportId} : {})};
    fixture.receipts.set(key,receipt);
    if (operation === 'approve') fixture.approved=true;
    if (operation === 'resolve') fixture.reportState=input.resolution;
  }
  persist();
  if (fixture.failNext) {fixture.failNext=false;throw new Error('Synthetic committed response lost');}
  return Response.json(receipt);
};
require(${JSON.stringify(join(application, '.vite/build/main.js'))});
`);
const executablePath = createRequire(import.meta.url)('electron');
for (const path of [bootstrap, coreBootstrap]) {
  const syntax = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
}
const launch = () => electron.launch({ executablePath, args: [bootstrap, `--user-data-dir=${directory}`], env: { ...env, ORGLET_DATA_DIR: directory } });
let app = await launch();
const call = (page, command, args = {}) => page.evaluate(([name, input]) => window.orglet.call(name, input), [command, args]);
let language = 'vi';
const label = text => language === 'en' ? en[text] ?? text : text;
const measuringSource = Object.entries(rules).map(([name, value]) => typeof value === 'function' ? value.toString() : `const ${name} = ${JSON.stringify(value)};`).join('\n');
const geometry = [];
async function photograph(page, stage, size) {
  await page.setViewportSize(size);
  await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => undefined))));
  await page.evaluate(`${measuringSource}\nwindow.__moderationAlignment = { measurePage };`);
  const findings = await page.evaluate(tolerances => window.__moderationAlignment.measurePage(tolerances), rules.DEFAULT_TOLERANCES);
  assert.equal(findings.length, 0, `${stage} fits the real shell`);
  const drawer = page.locator('.org-drawer-scroll');
  if (await drawer.count()) await drawer.evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: join(output, `${language}-${await page.evaluate(() => document.documentElement.dataset.theme)}-${size.width}-${stage}.png`) });
  assert.equal(await page.evaluate(() => window.__marketExecuted === true), false, 'Public instructions and evidence stay inert');
  geometry.push({ stage, language, size, findings });
}
async function close(page) {
  const title = await page.locator('.org-drawer-title').innerText();
  await page.keyboard.press('Escape');
  await page.waitForFunction(previous => ![...document.querySelectorAll('.org-drawer-title')].some(element => element.textContent === previous), title);
}
async function explore(page) {
  await page.locator('.app').waitFor();
  const opener = page.getByRole('button', { name: label('Mở sidebar'), exact: true });
  if (await opener.isVisible()) await opener.click();
  await page.locator('.area-tile[title="Bạn bè và tin nhắn"], .area-tile[title="Friends and direct messages"]').first().click();
  await page.getByRole('button', { name: label('Bạn bè'), exact: true }).first().click();
  await page.getByRole('tab', { name: label('Thêm bạn'), exact: true }).click();
  await page.locator('.marketplace-listing').filter({ hasText: 'Review fixture' }).waitFor();
}
async function openReview(page) {
  await page.getByRole('button', { name: label('Duyệt marketplace'), exact: true }).click();
  await page.getByRole('button', { name: label('Xem để duyệt'), exact: true }).click();
  await page.getByRole('dialog').getByText('Version 2: inspect the supplied evidence.', { exact: false }).first().waitFor();
}
const listingMenuLabel = () => label('Tùy chọn {0}').replace('{0}', 'Review fixture');
async function openReport(page) {
  await page.locator('.marketplace-listing').filter({ hasText: 'Review fixture' }).getByRole('button', { name: listingMenuLabel(), exact: true }).click();
  await page.waitForFunction(text => document.activeElement?.getAttribute('role') === 'menuitem' && document.activeElement.textContent.trim() === text, label('Report'));
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
}
try {
  let page = await app.firstWindow();
  await page.waitForFunction(() => window.orglet !== undefined);
  await page.evaluate(() => window.orglet.accountSignIn());
  for (const nextLanguage of ['vi', 'en']) for (const theme of ['light', 'dark']) {
    language = nextLanguage;
    const workspace = await call(page, 'workspace');
    await call(page, 'settings', { language, theme, connectionLimitMicros: workspace.connectionLimitMicros });
    await page.waitForFunction(({ language, theme }) => document.documentElement.lang === language && document.documentElement.dataset.theme === theme, { language, theme });
    await page.setViewportSize({ width: 1200, height: 820 });
    await explore(page);
    await page.getByRole('button', { name: label('Duyệt marketplace'), exact: true }).waitFor();
    for (const size of [{ width: 1200, height: 820 }, { width: 740, height: 600 }]) await photograph(page, 'catalog', size);
    await openReport(page);
    await page.getByRole('textbox', { name: label('Giải thích ngắn'), exact: true }).fill('Please inspect the exact public version.');
    await page.keyboard.press('Enter');
    assert.equal(await app.evaluate(() => global.__moderationFixture.requests.length), 0, 'Enter in explanation does not send a report');
    for (let index = 0; index < 20; index += 1) {
      await page.keyboard.press('Tab');
      assert.equal(await page.getByRole('dialog').evaluate(element => element.contains(document.activeElement)), true);
    }
    for (const size of [{ width: 1200, height: 820 }, { width: 740, height: 600 }]) await photograph(page, 'report', size);
    await close(page);
    await page.waitForFunction(text => document.activeElement?.getAttribute('aria-label') === text, listingMenuLabel());
    await openReview(page);
    await page.locator('.market-review-reports').getByText(new RegExp(label('Riêng tư'))).waitFor();
    assert.match(await page.getByRole('dialog').innerText(), /<script>window.__marketExecuted = true<\/script>/);
    await page.locator('summary').filter({ hasText: label('Phiên bản đang công khai') }).click();
    assert.match(await page.getByRole('dialog').innerText(), /Version 1:/);
    await page.locator('summary').filter({ hasText: label('Phiên bản đang công khai') }).click();
    for (const size of [{ width: 1200, height: 820 }, { width: 740, height: 600 }]) await photograph(page, 'review', size);
    await close(page);
    await page.waitForFunction(text => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === text && button === document.activeElement), label('Xem để duyệt'));
    await close(page);
  }
  language = 'vi';
  const workspace = await call(page, 'workspace');
  await call(page, 'settings', { language, theme: 'light', connectionLimitMicros: workspace.connectionLimitMicros });
  await page.waitForFunction(() => document.documentElement.lang === 'vi');
  await openReport(page);
  await page.getByRole('textbox', { name: 'Giải thích ngắn', exact: true }).fill('Please inspect this public version.');
  await app.evaluate(() => { global.__moderationFixture.failNext = true; });
  await page.getByRole('button', { name: 'Gửi report', exact: true }).click();
  await page.getByText(label('Chưa rõ kết quả. Thử lại sẽ dùng đúng nội dung đã gửi.'), { exact: true }).waitFor();
  const originalReport = await app.evaluate(() => global.__moderationFixture.requests[0]);
  await close(page);
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await page.waitForFunction(() => window.orglet !== undefined);
  await explore(page);
  assert.equal(await app.evaluate(() => global.__moderationFixture.requests.length), 1, 'Restart does not automatically resend a report');
  await page.locator('.market-moderation-pending > summary').click();
  await page.getByRole('button', { name: 'Xem thao tác đã lưu', exact: true }).click();
  assert.deepEqual(JSON.parse(await page.getByRole('dialog').locator('.market-public-prose').innerText()), JSON.parse(originalReport.text));
  await page.getByRole('button', { name: 'Thử lại đúng thao tác', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  const reportRequests = await app.evaluate(() => global.__moderationFixture.requests);
  assert.equal(reportRequests.length, 2); assert.equal(reportRequests[0].text, reportRequests[1].text); assert.equal(reportRequests[0].key, reportRequests[1].key);
  const journal = await page.evaluate(() => window.orglet.marketModeration({action:'journal'}));
  assert.equal(journal.kind, 'journal'); assert.equal(journal.operations.length, 0);
  await app.evaluate(() => { global.__moderationFixture.failRead = true; });
  await page.getByRole('button', { name: 'Duyệt marketplace', exact: true }).click();
  await page.getByText('Dịch vụ duyệt và report chưa sẵn sàng. Hãy thử lại sau.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog').locator('.marketplace-loading').count(), 0, 'Failed reads settle instead of loading forever');
  await app.evaluate(() => { global.__moderationFixture.failRead = false; });
  await page.getByRole('dialog').getByRole('button', {name:'Làm mới',exact:true}).click();
  await page.getByRole('dialog').getByRole('button', {name:'Xem để duyệt',exact:true}).waitFor();
  await close(page);
  await app.evaluate(() => { global.__moderationFixture.failReports = true; });
  await openReview(page);
  await page.getByText('Không tải được report. Thử lại để kiểm tra trước khi quyết định.', {exact:true}).waitFor();
  assert.equal(await page.getByRole('dialog').locator('.marketplace-loading').count(), 0, 'Failed report reads settle with a specific retry');
  assert.equal(await page.getByRole('button', {name:'Duyệt',exact:true}).isDisabled(), true, 'Incomplete report evidence cannot be acknowledged as a complete review');
  await photograph(page, 'failed-reports', {width:740,height:600});
  await app.evaluate(() => { global.__moderationFixture.failReports = false; });
  await page.getByRole('button', {name:'Tải lại report',exact:true}).click();
  await page.locator('.market-review-reports').getByText(/Riêng tư/).waitFor();
  await close(page); await close(page);
  await app.evaluate(() => { global.__moderationFixture.reportPages = true; });
  await openReview(page);
  assert.equal(await page.getByRole('checkbox', {name:'Tôi đã kiểm tra nội dung của đúng phiên bản này.',exact:true}).isDisabled(), true, 'Remaining report pages must be inspected');
  await page.getByText('Xem các trang report còn lại trước khi quyết định.',{exact:true}).waitFor();
  await page.locator('.market-review-reports').getByRole('button',{name:'Trang tiếp theo',exact:true}).click();
  await page.waitForFunction(() => [...document.querySelectorAll('input[type=checkbox]')].some(element => !element.disabled));
  await photograph(page, 'report-last-page', {width:740,height:600});
  await app.evaluate(() => { global.__moderationFixture.reportPages = false; });
  await page.getByRole('textbox', { name: 'Lý do quyết định', exact: true }).fill('Inspected the full public text and evidence.');
  await page.getByRole('checkbox', { name: 'Tôi đã kiểm tra nội dung của đúng phiên bản này.', exact: true }).check();
  await app.evaluate(() => { global.__moderationFixture.staleNext = true; });
  await page.getByRole('button', { name: 'Duyệt', exact: true }).click();
  await page.getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await page.getByText('Nội dung đã đổi. Mở lại phiên bản để xem trước khi quyết định.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('checkbox', { name: 'Tôi đã kiểm tra nội dung của đúng phiên bản này.', exact: true }).isChecked(), false);
  await page.getByRole('button', { name: 'Mở lại phiên bản', exact: true }).click();
  await page.getByRole('textbox', { name: 'Lý do quyết định', exact: true }).fill('Inspected the refreshed exact version.');
  await page.getByRole('checkbox', { name: 'Tôi đã kiểm tra nội dung của đúng phiên bản này.', exact: true }).check();
  await app.evaluate(() => { global.__moderationFixture.failNext = true; });
  await page.getByRole('button', { name: 'Duyệt', exact: true }).click();
  await page.getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await page.getByText('Chưa rõ kết quả. Thử lại sẽ dùng đúng nội dung đã gửi.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Thử lại đúng thao tác', exact: true }).click();
  // A toast from the earlier report retry can still be visible; await this decision's drawer receipt.
  await page.getByRole('dialog').getByText('Đã ghi nhận thao tác.', { exact: true }).waitFor();
  const decisions = await app.evaluate(() => global.__moderationFixture.requests.filter(request => request.path.endsWith('/decision')));
  assert.equal(decisions.length, 3); assert.equal(decisions[1].text, decisions[2].text); assert.equal(decisions[1].key, decisions[2].key);
  await close(page); await close(page);
  await app.evaluate(() => { global.__moderationFixture.paused = true; });
  await page.locator('.marketplace').getByRole('button', {name:'Làm mới',exact:true}).click();
  await openReport(page);
  await page.getByText('Dịch vụ duyệt và report chưa sẵn sàng. Hãy thử lại sau.', {exact:true}).waitFor();
  assert.equal(await page.getByText('Đăng nhập tài khoản đã xác minh để tiếp tục.', {exact:true}).count(),0);
  assert.equal(await page.getByRole('button', {name:'Gửi report',exact:true}).isDisabled(),true);
  await photograph(page,'paused',{width:740,height:600});
  await close(page);
  await app.evaluate(() => { global.__moderationFixture.reviewer = false; });
  await page.locator('.marketplace').getByRole('button', {name:'Làm mới',exact:true}).click();
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Duyệt marketplace'));
  await openReport(page);
  await page.evaluate(() => window.orglet.accountSignOut());
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  assert.equal(await page.getByRole('button', { name: 'Duyệt marketplace', exact: true }).count(), 0);
  await writeFile(join(output, 'geometry.json'), JSON.stringify(geometry, null, 2));
  console.log(JSON.stringify({ proof: 'trusted-transports-real-packaged-electron', screenshots: geometry.length, findings: 0, inertText: true, exactReportRetryAfterRestart: true, noAutomaticResend: true, exactDecisionRetry: true, conflictRefresh: true, queueReturnFocus: true, failedReadSettles: true, failedReportReadSettles: true, localizedReportReasons: true, remainingReportPagesRequired: true, pausedServiceExplanation: true, revokedReviewerUi: true, signOutClearsReviewerUi: true, positiveAuthenticatedWorkerHttp: false }));
} catch (error) {
  const page = app.windows()[0];
  if (page) {
    await page.screenshot({ path: join(output, 'failure.png') }).catch(() => undefined);
    await writeFile(join(output, 'failure-text.txt'), await page.locator('body').innerText()).catch(() => undefined);
  }
  throw error;
} finally { await app.close(); }
