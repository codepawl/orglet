import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { Backups } from '../../apps/desktop/src/core/storage/backup';
import { assertToolCall, toolsFor } from '../../apps/desktop/src/core/tools/catalog';
import { checkBrowserUrl, requestRefusal, REFUSED_BLOCKED, REFUSED_CREDENTIALS, REFUSED_PRIVATE, REFUSED_RESTRICTED, REFUSED_SCHEME } from '../../apps/desktop/src/core/tools/browser-policy';
import { findInSnapshot, snapshotPage, trimOlderBrowserSnapshots } from '../../apps/desktop/src/core/tools/browser-tools';
import { routineBrowserApproval } from '../../apps/desktop/src/core/orchestration/routines';
import { PolicyProxy } from '../../apps/desktop/src/browser/proxy';
import { detectBrowser } from '../../apps/desktop/src/browser/detect';
import { BrowserProfiles } from '../../apps/desktop/src/main/browser-profiles';
import { BROWSER_SNAPSHOT_CHARACTERS, browserLevelOf, capabilitiesWithBrowserLevel, narrowBrowserChoice, normalizeBrowserSite, type BrowserChoice, type BrowserSite } from '../../apps/desktop/src/shared/browser';
import type { BrowserHost, BrowserHostRequest, BrowserPolicy } from '../../apps/desktop/src/shared/browser-host';
import { snapshotCapabilities, ToolCapabilities } from '../../apps/desktop/src/shared/tool-policy';
import { permissionState } from '../../apps/desktop/src/shared/capability-status';
import type { ModelReply } from '../../apps/desktop/src/core/adapters/openai';
import type { Routine, Run, Task, Worker } from '../../apps/desktop/src/shared/contracts';
import type { Schedule } from '../../apps/desktop/src/shared/schedule';

/*
 * COD-261, browser use phase 1: the site rules, the capability, side threads, schedules and the journal, without a
 * real browser (browser-tool-loop.test.ts drives one). Loopback servers here stand in for the person's own
 * localhost:3000; the product refuses them unless the chat lists that exact address.
 */

const site = (text: string, decision: BrowserSite['decision'] = 'allowed'): BrowserSite => ({ site: text, decision, addedAt: now() });
const policy = (sites: BrowserSite[] = [], restricted = false): BrowserPolicy => ({ sites, restricted });
const noLookup = async () => { throw new Error('no lookup expected'); };

describe('site list entries', () => {
  it('keeps a site as a host and a non-default port, whatever the person typed', () => {
    expect(normalizeBrowserSite('https://Example.com/pricing?x=1')).toBe('example.com');
    expect(normalizeBrowserSite('example.com')).toBe('example.com');
    expect(normalizeBrowserSite('localhost:3000')).toBe('localhost:3000');
    expect(normalizeBrowserSite('http://127.0.0.1:8080/app')).toBe('127.0.0.1:8080');
    expect(normalizeBrowserSite('https://example.com:443')).toBe('example.com');
    expect(normalizeBrowserSite('[::1]:3000')).toBe('[::1]:3000');
    expect(normalizeBrowserSite('bücher.de')).toBe('xn--bcher-kva.de');
    for (const invalid of ['', 'chrome://settings', 'file:///C:/x', 'user:pass@example.com', 'two words.com', 'javascript:alert(1)']) {
      expect(normalizeBrowserSite(invalid)).toBeUndefined();
    }
  });
});

describe('what the core lets a run open', () => {
  it('never opens settings, extension, file or other non-web pages', () => {
    for (const url of ['chrome://settings', 'edge://settings/profiles', 'chrome://extensions', 'chrome-extension://abc/page.html', 'file:///C:/Windows/win.ini',
      'about:config', 'view-source:https://example.com', 'javascript:alert(1)', 'data:text/html,hi', 'ftp://example.com/x']) {
      expect(checkBrowserUrl(url, policy())).toEqual({ ok: false, reason: REFUSED_SCHEME });
    }
    expect(checkBrowserUrl('https://user:secret@example.com/', policy())).toEqual({ ok: false, reason: REFUSED_CREDENTIALS });
  });

  it('opens public sites on the Clean profile and refuses this computer and local networks by default', () => {
    expect(checkBrowserUrl('https://example.com/pricing', policy()).ok).toBe(true);
    for (const url of ['http://localhost:3000/', 'http://127.0.0.1:8080/', 'http://[::1]:3000/', 'http://192.168.1.1/', 'http://10.0.0.5/',
      'http://169.254.169.254/latest/meta-data/', 'http://printer.local/', 'http://router/', 'http://app.localhost:5173/']) {
      expect(checkBrowserUrl(url, policy())).toEqual({ ok: false, reason: REFUSED_PRIVATE });
    }
  });

  it('opens a local address only when that exact host and port is listed', () => {
    const listed = policy([site('localhost:3000')]);
    expect(checkBrowserUrl('http://localhost:3000/dashboard', listed).ok).toBe(true);
    expect(checkBrowserUrl('http://localhost:3001/', listed).ok).toBe(false);
    expect(checkBrowserUrl('http://127.0.0.1:3000/', listed).ok).toBe(false);
    expect(checkBrowserUrl('http://sub.localhost:3000/', listed).ok).toBe(false);
  });

  it('refuses a blocked site and its subdomains, and a block wins over an allow', () => {
    const blocked = policy([site('facebook.com', 'blocked')]);
    expect(checkBrowserUrl('https://www.facebook.com/', blocked)).toEqual({ ok: false, reason: REFUSED_BLOCKED });
    expect(checkBrowserUrl('https://facebook.com.evil.example/', blocked).ok).toBe(true);
    expect(checkBrowserUrl('https://news.example.com/', policy([site('example.com'), site('news.example.com', 'blocked')]))).toEqual({ ok: false, reason: REFUSED_BLOCKED });
  });

  it('opens only listed sites on a signed-in profile', () => {
    const signedIn = policy([site('dashboard.example.com')], true);
    expect(checkBrowserUrl('https://dashboard.example.com/reports', signedIn).ok).toBe(true);
    expect(checkBrowserUrl('https://mail.example.org/', signedIn)).toEqual({ ok: false, reason: REFUSED_RESTRICTED });
  });

  it('checks every request of a loading page, looking up a name that is not obviously local', async () => {
    const pointsHome = async () => ['127.0.0.1'];
    const pointsOut = async () => ['93.184.216.34'];
    expect(await requestRefusal('https://rebind.example/', policy(), false, pointsHome)).toBe(REFUSED_PRIVATE);
    expect(await requestRefusal('https://cdn.example/app.js', policy(), false, pointsOut)).toBeUndefined();
    // An address the person listed is theirs to name; it is not looked up.
    expect(await requestRefusal('http://devbox.example:8080/', policy([site('devbox.example:8080')]), true, noLookup)).toBeUndefined();
    expect(await requestRefusal('data:image/png;base64,AAAA', policy(), false, noLookup)).toBeUndefined();
    expect(await requestRefusal('data:text/html,<p>page</p>', policy(), true, noLookup)).toBe(REFUSED_SCHEME);
    // On a signed-in profile a page or a frame must be listed; what that page loads from elsewhere need not be.
    expect(await requestRefusal('https://ads.example/frame.html', policy([site('shop.example')], true), true, pointsOut)).toBe(REFUSED_RESTRICTED);
    expect(await requestRefusal('https://cdn.example/app.js', policy([site('shop.example')], true), false, pointsOut)).toBeUndefined();
  });
});

describe('the network gate', () => {
  let target: Server;
  let targetPort: number;
  let hits: number;
  let proxy: PolicyProxy;
  let proxyUrl: URL;
  let rules: BrowserPolicy;

  beforeEach(async () => {
    hits = 0;
    target = createServer((_request, response) => {
      hits += 1;
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.end('local service');
    });
    await new Promise<void>(resolve => target.listen(0, '127.0.0.1', resolve));
    targetPort = (target.address() as AddressInfo).port;
    rules = policy();
    // Every name resolves to this computer: a rebinding name the gate must refuse unless the person listed it.
    proxy = new PolicyProxy(() => rules, async () => ['127.0.0.1']);
    proxyUrl = new URL(await proxy.start());
  });
  afterEach(() => {
    proxy.close();
    target.close();
  });

  const viaProxy = (url: string) => new Promise<number>((resolve, reject) => {
    const request = httpRequest({ host: proxyUrl.hostname, port: proxyUrl.port, path: url, headers: { Host: new URL(url).host } }, response => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    request.on('error', reject);
    request.end();
  });

  const tunnel = (hostPort: string) => new Promise<string>((resolve, reject) => {
    const socket = connect(Number(proxyUrl.port), proxyUrl.hostname, () => socket.write(`CONNECT ${hostPort} HTTP/1.1\r\nHost: ${hostPort}\r\n\r\n`));
    socket.once('data', data => {
      resolve(data.toString().split('\r\n')[0]);
      socket.destroy();
    });
    socket.on('error', reject);
  });

  it('refuses loopback and names that resolve to it, for plain requests and tunnels, until the exact address is listed', async () => {
    expect(await viaProxy(`http://127.0.0.1:${targetPort}/`)).toBe(403);
    expect(await viaProxy(`http://rebind.example:${targetPort}/`)).toBe(403);
    expect(await tunnel(`127.0.0.1:${targetPort}`)).toMatch(/403/);
    expect(hits).toBe(0);
    rules = policy([site(`127.0.0.1:${targetPort}`)]);
    expect(await viaProxy(`http://127.0.0.1:${targetPort}/`)).toBe(200);
    expect(await tunnel(`127.0.0.1:${targetPort}`)).toMatch(/200/);
    expect(hits).toBe(1);
  });

  it('reaches a listed localhost server on 127.0.0.1 when localhost resolves to ::1 first, as it does on Windows', async () => {
    proxy.close();
    // The dogfood page listened on 127.0.0.1 only; taking the first address sent every request to ::1 and got a 502.
    proxy = new PolicyProxy(() => rules, async () => ['::1', '127.0.0.1']);
    proxyUrl = new URL(await proxy.start());
    rules = policy([site(`localhost:${targetPort}`)]);
    expect(await viaProxy(`http://localhost:${targetPort}/`)).toBe(200);
    expect(await tunnel(`localhost:${targetPort}`)).toMatch(/200/);
    expect(hits).toBe(1);
  });
});

describe('the capability and the tools it offers', () => {
  it('is never a default and is one cumulative level', () => {
    for (const provider of ['openai', 'anthropic', 'codex', 'claude-code', 'cursor', 'gemini', 'ollama', 'demo']) {
      expect(snapshotCapabilities(provider)).not.toContain('browser.read');
    }
    expect(ToolCapabilities.safeParse(['browser.read']).success).toBe(true);
    expect(ToolCapabilities.safeParse(['browser.act']).success).toBe(false);
    expect(browserLevelOf(capabilitiesWithBrowserLevel(['source.read'], 'read'))).toBe('read');
    expect(capabilitiesWithBrowserLevel(['source.read', 'browser.read'], 'none')).toEqual(['source.read']);
    expect(permissionState({ provider: 'openai' }).browser).toBe('none');
    expect(permissionState({ provider: 'openai', capabilities: ['browser.read'] }).browser).toBe('read');
  });

  it('offers the browser tools only to a run that started with the browser on, outside planning and Demo', () => {
    const worker = { id: id(), name: 'Reader', provider: 'openai', skillId: id(), instructions: 'x', revision: 1 } as Worker;
    const task = { id: id(), toolCapabilities: ['source.read', 'browser.read'] } as Task;
    const run = { id: id(), taskId: task.id, status: 'running', startedAt: now(), error: null,
      snapshot: { worker, skill: { id: id(), name: 's', content: 'c', revision: 1 }, toolCapabilities: ['source.read', 'browser.read'], browser: { profileId: 'clean' } } } as Run;
    const names = (candidate: Run, chat: Task) => toolsFor(candidate, chat).flatMap(tool => tool.type === 'function' ? [tool.function.name] : []);
    expect(names(run, task)).toEqual(expect.arrayContaining(['browser_open', 'browser_snapshot', 'browser_find', 'browser_screenshot', 'browser_scroll', 'browser_tabs', 'browser_close']));
    // Turned off on the chat since, never frozen on the run, planning, or Demo: no browser.
    expect(names(run, { ...task, toolCapabilities: ['source.read'] }).some(name => name.startsWith('browser_'))).toBe(false);
    expect(names({ ...run, snapshot: { ...run.snapshot, browser: undefined } }, task).some(name => name.startsWith('browser_'))).toBe(false);
    expect(names({ ...run, stage: 'plan' }, task).some(name => name.startsWith('browser_'))).toBe(false);
    expect(names({ ...run, snapshot: { ...run.snapshot, worker: { ...worker, provider: 'demo' } } }, task).some(name => name.startsWith('browser_'))).toBe(false);
    // An old chat that never chose the browser does not get it.
    expect(names({ ...run, snapshot: { ...run.snapshot, toolCapabilities: undefined } }, { ...task, toolCapabilities: undefined }).some(name => name.startsWith('browser_'))).toBe(false);
    expect(() => assertToolCall(run, { ...task, toolCapabilities: ['source.read'] }, 'browser_open', JSON.stringify({ url: 'https://example.com', tabId: null }))).toThrow('Tool không được policy cho phép.');
    expect(() => assertToolCall(run, task, 'browser_open', JSON.stringify({ url: 'https://example.com', tabId: 'tab-1' }))).toThrow();
  });
});

describe('snapshots the worker gets', () => {
  it('comes in parts, finds text in its place, and keeps only the latest one whole', () => {
    const snapshot = Array.from({ length: 2000 }, (_, index) => `- listitem [ref=e${index}]: Row ${index} costs ${index} đồng`).join('\n');
    const first = snapshotPage(snapshot, 0);
    expect(Array.from(first.text).length).toBeLessThanOrEqual(BROWSER_SNAPSHOT_CHARACTERS);
    expect(first.text.endsWith('\n')).toBe(true);
    const second = snapshotPage(snapshot, first.nextOffset!);
    expect(second.text.startsWith('- listitem')).toBe(true);
    const nested = '- main:\n  - list "Plans":\n    - listitem: Pro costs 42 dollars\n    - listitem: Basic costs 12\n- contentinfo: Đồng hồ';
    const found = findInSnapshot(nested, 'COSTS 42');
    expect(found.matches).toEqual([{ line: '- listitem: Pro costs 42 dollars', within: ['- main:', '- list "Plans":'] }]);
    expect(findInSnapshot(nested, 'dong ho').totalMatches).toBe(1);

    const tool = (text: string) => ({ role: 'tool', content: JSON.stringify({ kind: 'browser_snapshot', snapshot: text, source: {} }) });
    const messages = [tool('a'.repeat(5000)), tool('b'.repeat(5000))];
    expect(trimOlderBrowserSnapshots(messages)).toBe(true);
    expect(JSON.parse(messages[0].content as string).snapshot).toHaveLength(1500);
    expect(JSON.parse(messages[1].content as string).snapshot).toHaveLength(5000);
  });
});

describe('side threads and schedules', () => {
  let directory: string;
  let store: Store;
  let core: CoreService;
  let hostRequests: BrowserHostRequest[];
  const schedule: Schedule = { timeZone: 'UTC', time: '09:00', frequency: 'daily', weekday: 1 };
  const answer = (message: string): ModelReply => ({ calls: [{ id: id(), name: 'reply', arguments: JSON.stringify({ message, title: null, knowledgeProposals: [] }) }], usage: { input: 10, output: 5 } });

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'orglet-browser-policy-'));
    store = new Store(join(directory, 'state.sqlite'));
    hostRequests = [];
    const host: BrowserHost = { async request(request) {
      hostRequests.push(request);
      if (request.kind === 'open') return { tabId: 't1', url: request.url, title: 'Page', status: 200 };
      if (request.kind === 'snapshot') return { tabId: 't1', url: 'https://example.com/', title: 'Page', snapshot: '- heading "Hello" [ref=e1]' };
      if (request.kind === 'screenshot') return { tabId: 't1', url: 'https://example.com/', title: 'Page', png: Buffer.from('\x89PNG fake').toString('base64') };
      return { ended: true };
    } };
    let step = 0;
    core = new CoreService(store, () => {}, async () => ({
      async request(messages) {
        const brief = JSON.stringify(messages);
        if (!brief.includes('Read example')) return answer('Xong.');
        step += 1;
        if (step === 1) return { calls: [{ id: id(), name: 'browser_open', arguments: JSON.stringify({ url: 'https://example.com/', tabId: null }) }], usage: { input: 10, output: 5 } };
        if (step === 2) return { calls: [{ id: id(), name: 'browser_snapshot', arguments: JSON.stringify({ tabId: 't1', offset: 0 }) }], usage: { input: 10, output: 5 } };
        if (step === 3) return { calls: [{ id: id(), name: 'browser_screenshot', arguments: JSON.stringify({ tabId: 't1' }) }], usage: { input: 10, output: 5 } };
        if (step === 4) return { calls: [{ id: id(), name: 'propose_settings', arguments: JSON.stringify({ theme: 'dark' }) }], usage: { input: 10, output: 5 } };
        return answer('It says Hello.');
      },
    }), undefined, undefined, undefined, undefined, undefined, undefined, {}, undefined, {}, host);
    const worker = store.all<Worker>('workers')[0];
    await core.command('saveWorker', { ...worker, provider: 'openai' });
  });
  afterEach(async () => {
    await core.runner.shutdown();
    store.close();
    await rm(directory, { recursive: true, force: true });
  });

  async function settled(taskId: string) {
    for (let tries = 0; tries < 500 && (core.runner.isActive(taskId) || ['queued', 'running'].includes(store.detail(taskId).task.status)); tries++) await new Promise(resolve => setTimeout(resolve, 10));
    expect(core.runner.isActive(taskId)).toBe(false);
  }

  const chatInput = (browser: BrowserChoice, brief = 'Hello') => ({
    workerId: store.all<Worker>('workers')[0].id, brief, sourceIds: [], consent: true, providerScopes: ['openai' as const], budgetMicros: 100_000,
    toolCapabilities: ['source.read' as const, 'skill.read' as const, 'app.propose' as const, 'browser.read' as const], browser,
  });

  it('copies the main chat\'s browser into a side thread, never lets it be wider, and narrows it with the main chat', async () => {
    const mainId = await core.command('createTask', chatInput({ profileId: 'clean', sites: [site('localhost:3000'), site('ads.example', 'blocked')] })) as string;
    await settled(mainId);
    const sideId = await core.command('startSideThread', { taskId: mainId, brief: 'Side question', sourceIds: [], consent: true, providerScopes: ['openai'], budgetMicros: 100_000 }) as string;
    await settled(sideId);
    const side = store.get<Task>('tasks', sideId);
    expect(side.browser?.sites.map(entry => entry.site)).toEqual(['localhost:3000', 'ads.example']);
    expect(side.toolCapabilities).toContain('browser.read');
    await expect(core.command('setBrowser', { taskId: sideId, browser: { profileId: 'clean', sites: [site('localhost:3000'), site('localhost:8080')] } })).rejects.toThrow('Chat phụ dùng trình duyệt của chat chính');

    const profileId = id();
    await core.command('setBrowser', { taskId: mainId, browser: { profileId, sites: [site('tracker.example', 'blocked')] } });
    const narrowed = store.get<Task>('tasks', sideId);
    expect(narrowed.browser?.profileId).toBe(profileId);
    expect(narrowed.browser?.sites.map(entry => `${entry.decision}:${entry.site}`).sort()).toEqual(['blocked:ads.example', 'blocked:tracker.example']);
    expect(core.browser.choiceFor(narrowed).sites.some(entry => entry.decision === 'allowed')).toBe(false);
    // The live rule is the same narrowing, even for a side thread whose stored copy is older.
    expect(narrowBrowserChoice({ profileId: 'clean', sites: [site('a.example'), site('b.example')] }, { profileId, sites: [site('a.example')] }))
      .toEqual({ profileId, sites: [site('a.example')].map(entry => ({ ...entry, addedAt: expect.any(String) })) });
  });

  it('journals every step, keeps screenshots out of backups, and deletes both with the chat', async () => {
    const taskId = await core.command('createTask', chatInput({ profileId: 'clean', sites: [] }, 'Read example.com')) as string;
    await settled(taskId);
    const detail = store.detail(taskId);
    expect(detail.task.status).toBe('completed');
    expect(detail.runs[0].snapshot.browser).toEqual({ profileId: 'clean' });
    const actions = core.browser.actions(taskId);
    expect(actions.map(action => [action.kind, action.outcome, action.risk, action.origin])).toEqual([
      ['open', 'done', 'read', 'https://example.com'], ['snapshot', 'done', 'read', 'https://example.com'], ['screenshot', 'done', 'read', 'https://example.com'],
    ]);
    expect(actions[2].screenshotId).toBeTruthy();
    // The run's tabs were closed when it ended.
    expect(hostRequests.at(-1)).toEqual({ kind: 'endRun', runId: detail.runs[0].id });
    expect(detail.events.map(event => event.message)).toEqual(expect.arrayContaining(['Đã mở trang example.com', 'Đã đọc trang example.com', 'Đã chụp màn hình example.com']));
    // Reading a page counts as untrusted input, so what the run proposes waits for a click, like the web.
    expect(detail.appProposals.map(proposal => proposal.hold)).toEqual(['untrusted']);

    const backup = new Backups(store, () => false, () => {}).export();
    expect(backup).not.toContain('browser_actions');
    expect(backup).not.toContain(actions[2].screenshotId!);
    expect(JSON.parse(backup).payload.tasks.find((task: Task) => task.id === taskId).browser).toBeUndefined();
    expect(JSON.parse(backup).payload.runs.find((run: Run) => run.taskId === taskId).snapshot.browser).toBeUndefined();

    await core.command('deleteTask', { id: taskId });
    expect(Number(store.db.prepare('SELECT COUNT(*) AS count FROM browser_actions').get()!.count)).toBe(0);
    expect(Number(store.db.prepare('SELECT COUNT(*) AS count FROM browser_screenshots').get()!.count)).toBe(0);
  });

  it('puts a schedule\'s browser profile and site list in what saving it approves, and gives its runs the same', async () => {
    const worker = store.all<Worker>('workers')[0];
    const plain = { workerId: worker.id, sourceIds: [], brief: 'Scheduled', consent: true, providerScopes: ['openai' as const], budgetMicros: 100_000 };
    const withoutBrowser = await core.command('saveRoutine', { name: 'Plain', enabled: true, schedule, task: plain }) as Routine;
    expect(routineBrowserApproval(plain)).toBeUndefined();
    // Turning the browser on for the same schedule changes what saving approves; the order of the list does not.
    const reading = { ...plain, toolCapabilities: ['source.read' as const, 'browser.read' as const], browser: { profileId: 'clean' as const, sites: [site('a.example'), site('b.example', 'blocked')] } };
    expect(core.routines.configuration(reading)).not.toBe(withoutBrowser.approvedConfig);
    expect(core.routines.configuration({ ...reading, browser: { ...reading.browser, sites: [...reading.browser.sites].reverse() } })).toBe(core.routines.configuration(reading));
    expect(core.routines.configuration({ ...reading, browser: { ...reading.browser, sites: [site('a.example')] } })).not.toBe(core.routines.configuration(reading));
    // A schedule without the browser keeps the approval it had before this change.
    expect(core.routines.configuration(plain)).toBe(withoutBrowser.approvedConfig);

    const saved = await core.command('saveRoutine', { name: 'Reads pages', enabled: true, schedule, task: reading }) as Routine;
    const taskId = await core.routines.runCalled(saved.id, []);
    await settled(taskId);
    const task = store.get<Task>('tasks', taskId);
    expect(task.routineId).toBe(saved.id);
    expect(task.browser?.sites.map(entry => entry.site)).toEqual(['a.example', 'b.example']);
    expect(store.detail(taskId).runs[0].snapshot.toolCapabilities).toContain('browser.read');
  });
});

describe('named profiles', () => {
  it('keeps names and dates in main, one folder each, and forgets a deleted one', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'orglet-browser-profiles-'));
    try {
      const profiles = new BrowserProfiles(join(directory, 'browser'));
      const work = await profiles.create('Work');
      await expect(profiles.create('work')).rejects.toThrow('Đã có hồ sơ cùng tên.');
      expect((await profiles.list()).map(profile => profile.name)).toEqual(['Work']);
      expect(profiles.folderOf(work.id)).toBe(join(directory, 'browser', 'profiles', work.id));
      expect(() => profiles.folderOf('..\\..\\Windows')).toThrow();
      await profiles.clear(work.id);
      await profiles.remove(work.id);
      expect(await profiles.list()).toEqual([]);
      expect(await profiles.has(work.id)).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('finds Chrome before Edge in the standard install folders only', () => {
    const exists = (path: string) => path.endsWith('msedge.exe') || path.endsWith('chrome.exe');
    const env = { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)' };
    expect(detectBrowser('win32', env, exists, () => ['153.0.4234.48', 'SetupMetrics'])).toMatchObject({ kind: 'chrome', version: '153.0.4234.48' });
    expect(detectBrowser('win32', env, path => path.endsWith('msedge.exe'), () => [])).toMatchObject({ kind: 'edge', version: null });
    expect(detectBrowser('win32', env, () => false, () => [])).toBeNull();
  });

  it('reads the version of a Mac browser from its Info.plist, so it is not started just to ask', () => {
    const plist = '<?xml version="1.0"?><plist><dict><key>CFBundleName</key><string>Chrome</string>\n'
      + '\t<key>CFBundleShortVersionString</key>\n\t<string>153.0.4234.48</string></dict></plist>';
    const read = (path: string) => {
      if (!/Google Chrome\.app[\\/]Contents[\\/]Info\.plist$/.test(path)) throw new Error('not there');
      return plist;
    };
    expect(detectBrowser('darwin', {}, path => path.endsWith('Google Chrome'), () => [], read)).toMatchObject({ kind: 'chrome', version: '153.0.4234.48' });
    // A binary plist, or none, leaves the version to be asked of the browser.
    expect(detectBrowser('darwin', {}, path => path.endsWith('Google Chrome'), () => [], () => 'bplist00')).toMatchObject({ kind: 'chrome', version: null });
    expect(detectBrowser('darwin', {}, path => path.endsWith('Microsoft Edge'), () => [], read)).toMatchObject({ kind: 'edge', version: null });
  });
});
