import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import type { Decisions } from '../../apps/desktop/src/core/decisions/service';
import type { ModelReply } from '../../apps/desktop/src/core/adapters/openai';
import type { Task, Worker } from '../../apps/desktop/src/shared/contracts';
import type { DecisionAnswer, DecisionQuestions } from '../../apps/desktop/src/shared/decisions';
import type { BrowserHost } from '../../apps/desktop/src/shared/browser-host';
import type { DesktopHost, DesktopHostRequest, DesktopTargetFacts } from '../../apps/desktop/src/shared/desktop-host';
import type { DesktopBorrowStep } from '../../apps/desktop/src/shared/desktop';
import type { McpServerConfig } from '../../apps/desktop/src/shared/mcp';
import { capabilitiesForMode, changesMode } from '../../apps/desktop/src/shared/approval-mode';
import { snapshotCapabilities, ToolCapabilities, withCapability, type ToolCapability } from '../../apps/desktop/src/shared/tool-policy';

/*
 * The chat's Mode as permissions. Auto and Bypass are two capabilities (`approval.auto`, `approval.bypass`) that need
 * `workspace.apply`; Manual and Accept edits are the chat without and with `workspace.apply`. The real core runs with a
 * fake model, fake browser and desktop hosts, a real stdio MCP server and a fake decision model, so no browser starts.
 */

const sdk = (path: string) => pathToFileURL(fileURLToPath(new URL(`../../node_modules/@modelcontextprotocol/sdk/dist/esm/${path}`, import.meta.url))).href;

const mcpFixtureSource = (markFile: string) => `
import { Server } from '${sdk('server/index.js')}';
import { StdioServerTransport } from '${sdk('server/stdio.js')}';
import { CallToolRequestSchema, ListToolsRequestSchema } from '${sdk('types.js')}';
import { appendFileSync } from 'node:fs';
const server = new Server({ name: 'fixture', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
  { name: 'write_note', description: 'Writes a note.', inputSchema: { type: 'object', properties: { note: { type: 'string' } } } },
] }));
server.setRequestHandler(CallToolRequestSchema, async request => {
  appendFileSync(${JSON.stringify(markFile)}, String(request.params.arguments?.note) + '\\n');
  return { content: [{ type: 'text', text: 'written' }] };
});
await server.connect(new StdioServerTransport());
`;

// ----- The capabilities -----

describe('the two approval capabilities', () => {
  it('allows at most one of them, and only with workspace.apply', () => {
    const base: ToolCapability[] = ['source.read', 'workspace.apply'];
    expect(ToolCapabilities.safeParse([...base, 'approval.auto']).success).toBe(true);
    expect(ToolCapabilities.safeParse([...base, 'approval.bypass']).success).toBe(true);
    expect(ToolCapabilities.safeParse([...base, 'approval.auto', 'approval.bypass']).success).toBe(false);
    expect(ToolCapabilities.safeParse(['source.read', 'approval.auto']).success).toBe(false);
    expect(ToolCapabilities.safeParse(['source.read', 'approval.bypass']).success).toBe(false);
  });

  it('are in no default, so no existing chat, checkpoint or backup gains them', () => {
    for (const provider of ['openai', 'anthropic', 'codex', 'claude-code', 'cursor', 'gemini', 'ollama', 'demo']) {
      const defaults = snapshotCapabilities(provider);
      expect(defaults).not.toContain('approval.auto');
      expect(defaults).not.toContain('approval.bypass');
      expect(defaults).not.toContain('workspace.apply');
    }
    // A chat saved before the modes existed reads as Manual or Accept edits, exactly as before.
    expect(changesMode(['source.read'], false)).toBe('manual');
    expect(changesMode(['source.read', 'workspace.apply'], false)).toBe('acceptEdits');
  });

  it('go with review: turning workspace.apply off turns the approval mode off', () => {
    const auto = capabilitiesForMode(['source.read'], 'auto');
    expect(withCapability(auto, 'workspace.apply', false)).toEqual(['source.read']);
  });
});

// ----- The core -----

const NOTES = 101;
const notesWindow = `w${NOTES}`;
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const facts = (name: string, controlType: string, actions: string[], extra: Partial<DesktopTargetFacts> = {}) => ({
  name, controlType, automationId: '', className: '', enabled: true, password: false, actions, inDialog: false, defaultButton: false, windowName: 'Notes', ...extra,
});

/** A small notes app as the helper would report it, which counts what reached it. */
class FakeNotes implements DesktopHost {
  saves = 0;
  borrows = 0;
  requests: DesktopHostRequest[] = [];
  private elements = [
    { ref: 'e2', line: '- edit "Note" [ref=e2] actions=set_value', facts: facts('Note', 'edit', ['set_value']) },
    { ref: 'e3', line: '- edit "Password" [ref=e3] [password]', facts: facts('Password', 'edit', ['set_value'], { password: true }) },
    { ref: 'e5', line: '- button "Save" [ref=e5] actions=invoke', facts: facts('Save', 'button', ['invoke']) },
    { ref: 'e8', line: '- pane "Canvas" [ref=e8]', facts: facts('Canvas', 'pane', []) },
  ];

  get acted() {
    return this.requests.filter(request => request.kind === 'act').length;
  }

  async request(request: DesktopHostRequest) {
    this.requests.push(request);
    const window = { handle: NOTES, title: 'Notes', className: 'NotesWindow', processId: 11, executable: 'notes.exe', minimized: false, elevated: false };
    if (request.kind === 'windows') return { windows: [window] };
    if (request.kind === 'forget') return { forgotten: true };
    if (request.kind === 'borrow_stop') return { stopping: true };
    if (request.kind === 'classify') return { person: request.events.map(() => false) };
    if (request.kind === 'bounds') return { bounds: { x: 100, y: 80, width: 640, height: 480 } };
    if (request.kind === 'snapshot') return { ...window, snapshot: this.elements.map(element => element.line).join('\n'), elements: this.elements.length, truncated: false };
    if (request.kind === 'screenshot') return { ...window, png: PIXEL, width: 1, height: 1 };
    const element = this.elements.find(candidate => candidate.ref === request.ref);
    if (request.kind === 'inspect') return { ...window, target: element ? { ref: element.ref, ...element.facts } : null };
    if (!element) return { problem: 'stale' as const };
    if (request.kind === 'borrow_check') return { ...window, point: { x: 40, y: 60 } };
    if (request.kind === 'borrow') {
      this.borrows += 1;
      return { completedSteps: request.steps.length, stoppedBy: null, durationMs: 900, stopLatencyMs: null, restored: { foreground: true, cursor: true }, title: 'Notes' };
    }
    if (request.step.kind === 'invoke') this.saves += 1;
    return { done: true, pending: false, state: {}, cursorMoved: false, foregroundChanged: false, title: 'Notes' };
  }
}

/** A browser host that never starts a browser: one page with a Place order button, or a password field. */
class FakeBrowser {
  orders = 0;
  passwordPage = false;
  requests: string[] = [];

  host(): BrowserHost {
    return { request: async request => {
      this.requests.push(request.kind);
      const view = { tabId: 't1', url: 'https://shop.example/', title: 'Shop' };
      if (request.kind === 'open') return { ...view, status: 200 };
      if (request.kind === 'inspect') {
        const target = this.passwordPage
          ? { ref: 'e6', role: 'textbox', name: 'Password', tag: 'input', inputType: 'password', autocomplete: null, fieldName: 'password', editable: true, submits: false, form: null, link: null, inCaptcha: false }
          : { ref: 'e5', role: 'button', name: 'Place order', tag: 'button', inputType: null, autocomplete: null, fieldName: null, editable: false, submits: true,
            form: { method: 'post' as const, hasPassword: false, submitName: 'Place order' }, link: null, inCaptcha: false };
        return { ...view, target, page: { passwordField: this.passwordPage, cardField: false, payment: false, captcha: false } };
      }
      if (request.kind === 'act') {
        this.orders += 1;
        return { ...view, before: { url: view.url, title: view.title }, changes: '', changesCut: false, dialogs: [], downloadBlocked: false, popupClosed: false, fileChooser: false };
      }
      if (request.kind === 'screenshot') throw new Error('The card works without a picture.');
      return { ended: true };
    } };
  }
}

const riskAnswers = (risky: boolean): Record<string, DecisionAnswer> => ({
  does: { type: 'choice', choice: risky ? 'send' : 'look', probabilities: risky ? { send: 1 } : { look: 1 }, confidence: 1 },
  happens: { type: 'choice', choice: risky ? 'consequential' : 'harmless', probabilities: risky ? { consequential: 1 } : { harmless: 1 }, confidence: 1 },
});

/** The decision model: answers the action-risk question as told, and counts how often it was asked about an action. */
class FakeDecisionModel {
  enabled = true;
  risky = false;
  silent = false;
  actionQuestions = 0;

  isEnabled() {
    return this.enabled;
  }

  async decide(_state: unknown, questions: DecisionQuestions) {
    if (!('does' in questions)) return undefined;
    this.actionQuestions += 1;
    if (this.silent) return new Promise<never>(() => {});
    return { model: 'fake', answers: riskAnswers(this.risky), usage: { inputTokens: 1 } };
  }
}

let directory: string;
let store: Store;
let core: CoreService | undefined;
let notes: FakeNotes;
let browser: FakeBrowser;
let decisionModel: FakeDecisionModel;
let markFile: string;
let script: (() => ModelReply)[];

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orglet-chat-modes-'));
  store = new Store(join(directory, 'state.sqlite'));
  notes = new FakeNotes();
  browser = new FakeBrowser();
  decisionModel = new FakeDecisionModel();
  markFile = join(directory, 'notes.txt');
  await writeFile(join(directory, 'fixture-server.mjs'), mcpFixtureSource(markFile));
  script = [];
});

afterEach(async () => {
  const ending = { core, store, directory };
  core = undefined;
  await ending.core?.mcp.shutdown();
  await ending.core?.runner.shutdown();
  ending.store.close();
  await rm(ending.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

async function until(check: () => boolean, timeoutMs = 20_000) {
  const started = Date.now();
  while (!check() && Date.now() - started < timeoutMs) await new Promise(resolve => setTimeout(resolve, 20));
  expect(check()).toBe(true);
}

const call = (name: string, argumentsValue: unknown): ModelReply => ({ calls: [{ id: id(), name, arguments: JSON.stringify(argumentsValue) }], usage: { input: 100, output: 30 } });
const reply = (message: string) => call('reply', { message, title: null, knowledgeProposals: [] });
const finished = (taskId: string) => ['completed', 'failed', 'cancelled'].includes(store.detail(taskId).task.status) && !core!.runner.isActive(taskId);
const borrowStep = (kind: DesktopBorrowStep['kind'], fields: Partial<DesktopBorrowStep> = {}): DesktopBorrowStep => ({ kind, text: null, keys: null, notches: null, ...fields });

const MANUAL: ToolCapability[] = [];
const ACCEPT_EDITS: ToolCapability[] = ['workspace.apply'];
const AUTO: ToolCapability[] = ['workspace.apply', 'approval.auto'];
const BYPASS: ToolCapability[] = ['workspace.apply', 'approval.bypass'];

/** A core over the fakes, with an orglet that can reach every surface. */
async function newCore() {
  if (core) return store.all<Worker>('workers')[0];
  core = new CoreService(store, () => {}, async () => ({
    async request() {
      return script.shift()?.() ?? reply('Done.');
    },
  }), undefined, undefined, undefined, undefined, undefined, undefined, {}, undefined, {}, browser.host(), notes, ['orglet.exe']);
  core.decisions = decisionModel as unknown as Decisions;
  const server = await core.saveMcpServer({
    id: id(), name: 'Fixture', enabled: true,
    transport: { kind: 'stdio', command: process.execPath, args: [join(directory, 'fixture-server.mjs')], envNames: [] },
  } satisfies McpServerConfig);
  const base = store.all<Worker>('workers')[0];
  await core.command('saveWorker', { ...base, provider: 'openai', mcpServerIds: [server.id] });
  return base;
}

async function startChat(modeCapabilities: ToolCapability[], brief = 'Do the thing'): Promise<string> {
  const worker = await newCore();
  return await core!.command('createTask', {
    workerId: worker.id, brief, sourceIds: [], consent: true, providerScopes: ['openai'], budgetMicros: 100_000,
    toolCapabilities: ['source.read', 'skill.read', 'browser.read', 'browser.act', 'desktop.read', 'desktop.act', ...modeCapabilities],
    browser: { profileId: 'clean', sites: [] },
    desktop: { apps: [{ program: 'notes.exe', name: 'Notes', addedAt: now() }] },
  }) as string;
}

/** The three held actions, each driven by the model script and read back from where it lands. */
const surfaces = {
  desktop: {
    steps: () => [call('desktop_snapshot', { windowId: notesWindow, offset: 0 }), call('desktop_invoke', { windowId: notesWindow, ref: 'e5' }), reply('Saved.')],
    landed: () => notes.saves === 1,
    waiting: (taskId: string) => core!.desktop.live(taskId).approval !== undefined,
    decline: (taskId: string) => core!.command('answerDesktopApproval', { taskId, requestId: core!.desktop.live(taskId).approval!.id, answer: 'decline' }),
    allow: (taskId: string) => core!.command('answerDesktopApproval', { taskId, requestId: core!.desktop.live(taskId).approval!.id, answer: 'allow' }),
    approvedBy: (taskId: string) => core!.desktop.actions(taskId).find(action => action.kind === 'invoke')?.approvedBy,
  },
  browser: {
    steps: () => [call('browser_open', { url: 'https://shop.example/', tabId: null }), call('browser_click', { tabId: 't1', ref: 'e5' }), reply('Ordered.')],
    landed: () => browser.orders === 1,
    waiting: (taskId: string) => core!.browser.live(taskId).approval !== undefined,
    decline: (taskId: string) => core!.command('answerBrowserApproval', { taskId, requestId: core!.browser.live(taskId).approval!.id, answer: 'decline' }),
    allow: (taskId: string) => core!.command('answerBrowserApproval', { taskId, requestId: core!.browser.live(taskId).approval!.id, answer: 'allow' }),
    approvedBy: (taskId: string) => core!.browser.actions(taskId).find(action => action.kind === 'click')?.approvedBy,
  },
  mcp: {
    steps: () => [call('mcp__fixture__write_note', { note: 'hello' }), reply('Noted.')],
    landed: () => existsSync(markFile),
    waiting: (taskId: string) => store.detail(taskId).task.status === 'waiting_input' && !core!.runner.isActive(taskId),
    decline: (taskId: string) => core!.command('answerDecision', { taskId, requestId: store.detail(taskId).task.decisionRequests![0].id, answer: 'refuse' }),
    allow: (taskId: string) => core!.command('answerDecision', { taskId, requestId: store.detail(taskId).task.decisionRequests![0].id, answer: 'once' }),
    approvedBy: (taskId: string) => store.detail(taskId).events.some(event => /^Chế độ (Tự động|Bỏ qua quyền) đã cho phép công cụ MCP/.test(event.message)) ? 'mode' : null,
  },
};
type SurfaceName = keyof typeof surfaces;
const surfaceNames = Object.keys(surfaces) as SurfaceName[];

async function run(surface: SurfaceName, modeCapabilities: ToolCapability[]): Promise<string> {
  script = surfaces[surface].steps().map(step => () => step);
  return startChat(modeCapabilities);
}

describe.each(surfaceNames)('a held %s action', surface => {
  const driver = surfaces[surface];

  it('goes ahead in Auto when the decision model finds it low risk, and the journal says Auto did it', async () => {
    const taskId = await run(surface, AUTO);
    await until(() => finished(taskId));
    expect(driver.landed()).toBe(true);
    expect(decisionModel.actionQuestions).toBeGreaterThan(0);
    if (surface === 'mcp') expect(driver.approvedBy(taskId)).toBe('mode');
    else expect(driver.approvedBy(taskId)).toBe('auto');
    expect(store.get<Task>('tasks', taskId).mcpGrants ?? []).toEqual([]);
  });

  it('still asks the person in Auto when the decision model finds it risky', async () => {
    decisionModel.risky = true;
    const taskId = await run(surface, AUTO);
    await until(() => driver.waiting(taskId));
    expect(driver.landed()).toBe(false);
    await driver.allow(taskId);
    await until(() => finished(taskId));
    expect(driver.landed()).toBe(true);
    if (surface !== 'mcp') expect(driver.approvedBy(taskId)).toBe('person');
  });

  it('asks in Auto when no decision model is connected', async () => {
    decisionModel.enabled = false;
    const taskId = await run(surface, AUTO);
    await until(() => driver.waiting(taskId));
    expect(driver.landed()).toBe(false);
    await driver.decline(taskId);
    await until(() => finished(taskId));
    expect(driver.landed()).toBe(false);
  });

  it('goes ahead in Bypass without asking the decision model, and the journal says Bypass did it', async () => {
    decisionModel.risky = true;
    const taskId = await run(surface, BYPASS);
    await until(() => finished(taskId));
    expect(driver.landed()).toBe(true);
    expect(decisionModel.actionQuestions).toBe(0);
    if (surface === 'mcp') expect(driver.approvedBy(taskId)).toBe('mode');
    else expect(driver.approvedBy(taskId)).toBe('bypass');
  });

  it.each([['Manual', MANUAL], ['Accept edits', ACCEPT_EDITS]])('asks in %s, whatever the decision model would say', async (_name, capabilities) => {
    const taskId = await run(surface, capabilities);
    await until(() => driver.waiting(taskId));
    expect(driver.landed()).toBe(false);
    expect(decisionModel.actionQuestions).toBe(0);
    await driver.decline(taskId);
    await until(() => finished(taskId));
    expect(driver.landed()).toBe(false);
    if (surface !== 'mcp') expect(driver.approvedBy(taskId)).toBeNull();
  });
});

describe('when Auto cannot decide', () => {
  it('asks when the decision model does not answer in time', async () => {
    decisionModel.silent = true;
    const taskId = await run('desktop', AUTO);
    await until(() => surfaces.desktop.waiting(taskId), 15_000);
    expect(notes.saves).toBe(0);
    await surfaces.desktop.decline(taskId);
    await until(() => finished(taskId));
    expect(notes.saves).toBe(0);
  }, 30_000);
});

describe('what no mode approves', () => {
  it.each([['Auto', AUTO], ['Bypass', BYPASS]])('keeps refusing a password field in %s', async (_name, capabilities) => {
    browser.passwordPage = true;
    script = [call('browser_open', { url: 'https://shop.example/', tabId: null }), call('browser_type', { tabId: 't1', ref: 'e6', text: 'hunter2', submit: false }), reply('Could not.')].map(step => () => step);
    const taskId = await startChat(capabilities);
    await until(() => finished(taskId));
    expect(browser.orders).toBe(0);
    expect(core!.browser.actions(taskId).find(action => action.kind === 'type')).toMatchObject({ outcome: 'refused', approvedBy: null });

    // The same for a password field in a desktop app.
    script = [call('desktop_snapshot', { windowId: notesWindow, offset: 0 }), call('desktop_set_value', { windowId: notesWindow, ref: 'e3', text: 'hunter2' }), reply('Could not.')].map(step => () => step);
    await core!.command('reviseTask', { taskId, brief: 'Now the app', sourceIds: [], consent: true, providerScopes: ['openai'], budgetMicros: 100_000 });
    await until(() => core!.desktop.actions(taskId).some(action => action.kind === 'set_value') && finished(taskId));
    expect(notes.acted).toBe(0);
    expect(core!.desktop.actions(taskId).find(action => action.kind === 'set_value')).toMatchObject({ outcome: 'refused', approvedBy: null });
  });

  it('asks about borrowing the real mouse in Auto, and approves it in Bypass', async () => {
    const borrow = () => [call('desktop_borrow_input', { windowId: notesWindow, ref: 'e8', steps: [borrowStep('click'), borrowStep('type', { text: 'hi' })] }), reply('Typed.')];

    script = borrow().map(step => () => step);
    const autoTask = await startChat(AUTO);
    await until(() => core!.desktop.live(autoTask).approval !== undefined);
    expect(core!.desktop.live(autoTask).approval).toMatchObject({ kind: 'borrow' });
    expect(notes.borrows).toBe(0);
    await core!.command('answerDesktopApproval', { taskId: autoTask, requestId: core!.desktop.live(autoTask).approval!.id, answer: 'decline' });
    await until(() => finished(autoTask));
    expect(notes.borrows).toBe(0);
    expect(decisionModel.actionQuestions).toBe(0);

    script = borrow().map(step => () => step);
    const bypassTask = await startChat(BYPASS);
    await until(() => finished(bypassTask));
    expect(notes.borrows).toBe(1);
    expect(core!.desktop.actions(bypassTask).find(action => action.kind === 'borrow')).toMatchObject({ outcome: 'done', approvedBy: 'bypass' });
  });
});

describe('side threads', () => {
  it('start with a copy of the main chat mode and never hold a wider one', async () => {
    const taskId = await startChat(AUTO);
    await until(() => finished(taskId));
    const sideTaskId = await core!.command('startSideThread', {
      taskId, brief: 'On the side', sourceIds: [], consent: true, providerScopes: ['openai'], budgetMicros: 100_000,
    }) as string;
    await until(() => finished(sideTaskId));
    expect(store.get<Task>('tasks', sideTaskId).toolCapabilities).toEqual(store.get<Task>('tasks', taskId).toolCapabilities);
    expect(store.get<Task>('tasks', sideTaskId).toolCapabilities).toContain('approval.auto');

    // Widening the side thread beyond the main chat is refused, and narrowing the main chat narrows the side thread.
    const side = store.get<Task>('tasks', sideTaskId);
    await expect(core!.command('setToolCapabilities', { taskId: sideTaskId, capabilities: capabilitiesForMode(side.toolCapabilities ?? [], 'bypass') })).rejects.toThrow();
    const main = store.get<Task>('tasks', taskId);
    await core!.command('setToolCapabilities', { taskId, capabilities: capabilitiesForMode(main.toolCapabilities ?? [], 'manual') });
    const narrowed = store.get<Task>('tasks', sideTaskId).toolCapabilities ?? [];
    expect(narrowed).not.toContain('approval.auto');
    expect(narrowed).not.toContain('workspace.apply');
  });

  it('cannot start in Bypass from a main chat in Manual', async () => {
    const taskId = await startChat(MANUAL);
    await until(() => finished(taskId));
    const sideTaskId = await core!.command('startSideThread', {
      taskId, brief: 'On the side', sourceIds: [], consent: true, providerScopes: ['openai'], budgetMicros: 100_000,
    }) as string;
    await expect(core!.command('setToolCapabilities', { taskId: sideTaskId, capabilities: BYPASS })).rejects.toThrow();
  });
});
