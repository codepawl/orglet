import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import type { ModelReply } from '../../apps/desktop/src/core/adapters/openai';
import type { Run, Task, Worker } from '../../apps/desktop/src/shared/contracts';
import {
  capabilitiesWithDesktopLevel, DesktopChoice, desktopLevelOf, narrowDesktopChoice, neverDesktopProgram, type DesktopAction, type DesktopChoice as DesktopChoiceType, type DesktopWindowsView,
} from '../../apps/desktop/src/shared/desktop';
import type { DesktopHost, DesktopHostRequest, DesktopTargetFacts } from '../../apps/desktop/src/shared/desktop-host';
import { snapshotCapabilities, ToolCapabilities, withCapability, type ToolCapability } from '../../apps/desktop/src/shared/tool-policy';
import { permissionState } from '../../apps/desktop/src/shared/capability-status';
import { toolsFor } from '../../apps/desktop/src/core/tools/catalog';
import { SCHEDULE_NO_DESKTOP } from '../../apps/desktop/src/core/orchestration/routines';
import { permissionsOff } from '../../apps/desktop/src/core/orchestration/permission-hints';
import { classifyDesktopStep, desktopRiskReasons, REFUSED_PASSWORD_FIELD } from '../../apps/desktop/src/core/tools/desktop-risk';
import { DESKTOP_NOT_ASKED_HERE, DESKTOP_PERSON_DECLINED, desktopProblems, trimOlderDesktopSnapshots } from '../../apps/desktop/src/core/tools/desktop-tools';

/**
 * Desktop apps (COD-261, phase 2a) without a real app: the risk rules, the grants, the capability rules, and a fake
 * helper that plays a small notes app, driven by a fake model through the whole core. The real helper against a real
 * window is `desktop-helper.test.ts`, which needs a Windows desktop.
 */

function target(overrides: Partial<DesktopTargetFacts> = {}): DesktopTargetFacts {
  return {
    ref: 'e4', name: 'Add line', controlType: 'button', automationId: '', className: '', enabled: true, password: false, actions: ['invoke'],
    inDialog: false, defaultButton: false, windowName: 'Notes', ...overrides,
  };
}

describe('how serious a desktop step is', () => {
  it('lets plain input run and asks before anything named like send, save, delete or close', () => {
    expect(classifyDesktopStep({ kind: 'invoke', target: target() })).toEqual({ risk: 'input', reasons: [] });
    expect(classifyDesktopStep({ kind: 'set_value', target: target({ name: 'Note', controlType: 'edit' }) }).risk).toBe('input');
    for (const name of ['Save', 'Save As…', 'Delete', 'Send', 'Close', 'Don\'t Save', 'Empty Recycle Bin', 'Lưu', 'Xoá', 'Gửi', 'Thoát', 'Đóng']) {
      expect(classifyDesktopStep({ kind: 'invoke', target: target({ name }) }), name).toMatchObject({ risk: 'consequential', reasons: [desktopRiskReasons.wording] });
    }
    // A toggle carries out what its name says too; expanding, selecting and scrolling only move around.
    expect(classifyDesktopStep({ kind: 'toggle', target: target({ name: 'Delete files after upload', controlType: 'check box' }) }).risk).toBe('consequential');
    for (const kind of ['expand', 'collapse', 'select', 'scroll_into_view'] as const) {
      expect(classifyDesktopStep({ kind, target: target({ name: 'Delete' }) }).risk, kind).toBe('input');
    }
    // Accents are the word's own: "mùa" (season) is not "mua" (buy); an unaccented word matches.
    expect(classifyDesktopStep({ kind: 'invoke', target: target({ name: 'Mùa hè' }) }).risk).toBe('input');
    expect(classifyDesktopStep({ kind: 'invoke', target: target({ name: 'Thanh toan' }) }).risk).toBe('consequential');
  });

  it('asks for a dialog\'s default or confirming button, and never enters a password', () => {
    expect(classifyDesktopStep({ kind: 'invoke', target: target({ name: 'Go', inDialog: true, defaultButton: true }) }))
      .toMatchObject({ risk: 'consequential', reasons: [desktopRiskReasons.dialogDefault] });
    expect(classifyDesktopStep({ kind: 'invoke', target: target({ name: 'OK', inDialog: true }) }).reasons).toContain(desktopRiskReasons.dialogConfirm);
    expect(classifyDesktopStep({ kind: 'invoke', target: target({ name: 'Go', defaultButton: true }) }).risk).toBe('input');
    expect(classifyDesktopStep({ kind: 'invoke', target: target({ name: 'OK' }) }).risk).toBe('input');
    expect(classifyDesktopStep({ kind: 'set_value', target: target({ name: 'Account', controlType: 'edit', password: true }) }).refused).toBe(REFUSED_PASSWORD_FIELD);
    expect(classifyDesktopStep({ kind: 'set_value', target: target({ name: 'Mật khẩu', controlType: 'edit' }) }).refused).toBe(REFUSED_PASSWORD_FIELD);
    expect(classifyDesktopStep({ kind: 'set_value', target: target({ name: 'PIN', controlType: 'edit' }) }).refused).toBe(REFUSED_PASSWORD_FIELD);
  });
});

describe('desktop grants and levels', () => {
  const grant = (program: string) => ({ program, name: program, addedAt: now() });

  it('keeps a side thread inside its main chat and never grants the refused programs', () => {
    const main: DesktopChoiceType = { apps: [grant('notepad.exe'), grant('excel.exe')] };
    const side: DesktopChoiceType = { apps: [grant('notepad.exe'), grant('mspaint.exe')] };
    expect(narrowDesktopChoice(side, main).apps.map(app => app.program)).toEqual(['notepad.exe']);
    expect(narrowDesktopChoice(side, { apps: [] }).apps).toEqual([]);
    expect(DesktopChoice.safeParse({ apps: [grant('notepad.exe')] }).success).toBe(true);
    expect(DesktopChoice.safeParse({ apps: [grant('1password.exe')] }).success).toBe(false);
    expect(DesktopChoice.safeParse({ apps: [grant('consent.exe')] }).success).toBe(false);
    expect(DesktopChoice.safeParse({ apps: [grant('Notepad.exe')] }).success).toBe(false);
    expect(DesktopChoice.safeParse({ apps: [grant('C:\\Windows\\notepad.exe')] }).success).toBe(false);
    expect(DesktopChoice.safeParse({ apps: [grant('notepad.exe'), grant('notepad.exe')] }).success).toBe(false);
    expect(neverDesktopProgram('electron.exe', ['electron.exe'])).toBe(true);
    expect(neverDesktopProgram('applicationframehost.exe')).toBe(true);
    expect(neverDesktopProgram('notepad.exe')).toBe(false);
  });

  it('is never a default, keeps its levels cumulative and needs reading to act', () => {
    for (const provider of ['openai', 'anthropic', 'codex', 'claude-code', 'cursor', 'gemini', 'ollama', 'demo']) {
      expect(snapshotCapabilities(provider).some(capability => capability.startsWith('desktop.'))).toBe(false);
    }
    expect(ToolCapabilities.safeParse(['desktop.read', 'desktop.act']).success).toBe(true);
    expect(ToolCapabilities.safeParse(['source.read', 'desktop.act']).success).toBe(false);
    expect(ToolCapabilities.safeParse(['source.read', 'dataset.check', 'skill.read', 'network.web', 'app.propose', 'browser.read', 'browser.act', 'desktop.read', 'desktop.act']).success).toBe(true);
    expect(withCapability(['source.read'], 'desktop.act', true)).toEqual(['source.read', 'desktop.act', 'desktop.read']);
    expect(withCapability(['source.read', 'desktop.read', 'desktop.act'], 'desktop.read', false)).toEqual(['source.read']);
    expect(desktopLevelOf(['desktop.read'])).toBe('read');
    expect(desktopLevelOf(['desktop.act'])).toBe('none');
    expect(capabilitiesWithDesktopLevel(['source.read', 'desktop.read'], 'act')).toEqual(['source.read', 'desktop.read', 'desktop.act']);
    expect(permissionState({ provider: 'openai', capabilities: ['desktop.read', 'desktop.act'] }).desktop).toBe('act');
    const everythingElse: ToolCapability[] = ['source.read', 'dataset.check', 'network.web', 'browser.read', 'browser.act'];
    expect(permissionsOff({ capabilities: everythingElse, workspacePermissions: ['read', 'write', 'execute'], language: 'en', sideThread: false, desktopAvailable: true }))
      .toEqual({ permissions: ['Desktop apps: Read windows'], where: 'Details → Tool permissions' });
    expect(permissionsOff({ capabilities: [...everythingElse, 'desktop.read'], workspacePermissions: ['read', 'write', 'execute'], language: 'en', sideThread: false, desktopAvailable: true })!.permissions)
      .toEqual(['Desktop apps: Read and act']);
    // Where desktop apps do not exist, and on a schedule, there is no switch to point at.
    expect(permissionsOff({ capabilities: everythingElse, workspacePermissions: ['read', 'write', 'execute'], language: 'en', sideThread: false })).toBeNull();
    expect(permissionsOff({ capabilities: everythingElse, workspacePermissions: ['read', 'write', 'execute'], language: 'en', sideThread: false, desktopAvailable: true, schedule: true })).toBeNull();
  });

  it('offers the tools only to a run that froze its programs, never to Demo or a schedule, and acting only with desktop.act', () => {
    const worker = { id: id(), name: 'Actor', provider: 'openai', skillId: id(), instructions: 'x', revision: 1 } as Worker;
    const capabilities: ToolCapability[] = ['source.read', 'desktop.read', 'desktop.act'];
    const chat = { id: id(), toolCapabilities: capabilities } as Task;
    const run = { id: id(), taskId: chat.id, status: 'running', startedAt: now(), error: null,
      snapshot: { worker, skill: { id: id(), name: 's', content: 'c', revision: 1 }, toolCapabilities: capabilities, desktop: { programs: ['notes.exe'] } } } as Run;
    const names = (candidate: Run, task: Task) => toolsFor(candidate, task).flatMap(tool => tool.type === 'function' ? [tool.function.name] : []).filter(name => name.startsWith('desktop_'));
    expect(names(run, chat)).toEqual(['desktop_windows', 'desktop_snapshot', 'desktop_find', 'desktop_screenshot', 'desktop_invoke', 'desktop_set_value', 'desktop_toggle', 'desktop_expand', 'desktop_select', 'desktop_scroll_into_view']);
    expect(names(run, { ...chat, toolCapabilities: ['source.read', 'desktop.read'] })).toEqual(['desktop_windows', 'desktop_snapshot', 'desktop_find', 'desktop_screenshot']);
    expect(names({ ...run, snapshot: { ...run.snapshot, desktop: undefined } }, chat)).toEqual([]);
    expect(names({ ...run, snapshot: { ...run.snapshot, worker: { ...worker, provider: 'demo' } } }, chat)).toEqual([]);
    expect(names(run, { ...chat, routineId: id() })).toEqual([]);
  });

  it('keeps only the latest window snapshot whole', () => {
    const long = 'x'.repeat(5_000);
    const messages = [
      { role: 'tool', content: JSON.stringify({ kind: 'desktop_snapshot', surface: 'desktop', snapshot: long }) },
      { role: 'tool', content: JSON.stringify({ kind: 'desktop_invoke', surface: 'desktop', snapshot: long }) },
      { role: 'tool', content: JSON.stringify({ kind: 'desktop_snapshot', surface: 'desktop', snapshot: long }) },
    ];
    expect(trimOlderDesktopSnapshots(messages)).toBe(true);
    const lengths = messages.map(message => (JSON.parse(message.content) as { snapshot: string }).snapshot.length);
    expect(lengths).toEqual([1_500, 1_500, 5_000]);
    expect(trimOlderDesktopSnapshots(messages)).toBe(false);
  });
});

// ----- The whole core with a fake helper -----

type RunMessage = { role: string; content?: unknown };
type Script = ((messages: RunMessage[]) => ModelReply | Promise<ModelReply>)[];

const NOTES = 101;
const BANK = 202;
const ADMIN = 303;
/** A 1×1 PNG. */
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/** A tiny notes app as the helper would report it, which counts what reached it. */
class FakeNotes implements DesktopHost {
  note = '';
  wrap = false;
  saves = 0;
  deletes = 0;
  requests: DesktopHostRequest[] = [];
  private elements: { ref: string; line: (depth: string) => string; facts: Omit<DesktopTargetFacts, 'ref'> }[] = [
    { ref: 'e1', line: depth => `${depth}- window "Notes" [ref=e1]`, facts: { name: 'Notes', controlType: 'window', automationId: '', className: '', enabled: true, password: false, actions: [], inDialog: false, defaultButton: false, windowName: 'Notes' } },
    { ref: 'e2', line: depth => `${depth}- edit "Note" [ref=e2]${this.note ? ` value="${this.note}"` : ''} actions=set_value`, facts: { name: 'Note', controlType: 'edit', automationId: 'note', className: 'Edit', enabled: true, password: false, actions: ['set_value'], inDialog: false, defaultButton: false, windowName: 'Notes' } },
    { ref: 'e3', line: depth => `${depth}- edit "Password" [ref=e3] [password]`, facts: { name: 'Password', controlType: 'edit', automationId: 'password', className: 'Edit', enabled: true, password: true, actions: ['set_value'], inDialog: false, defaultButton: false, windowName: 'Notes' } },
    { ref: 'e4', line: depth => `${depth}- check box "Wrap lines" [ref=e4] [${this.wrap ? 'checked' : 'unchecked'}] actions=toggle`, facts: { name: 'Wrap lines', controlType: 'check box', automationId: 'wrap', className: 'Button', enabled: true, password: false, actions: ['toggle'], inDialog: false, defaultButton: false, windowName: 'Notes' } },
    { ref: 'e5', line: depth => `${depth}- button "Save" [ref=e5] actions=invoke`, facts: { name: 'Save', controlType: 'button', automationId: 'save', className: 'Button', enabled: true, password: false, actions: ['invoke'], inDialog: false, defaultButton: false, windowName: 'Notes' } },
    { ref: 'e6', line: depth => `${depth}- text "Status: ${this.saves} saved" [ref=e6]`, facts: { name: 'Status', controlType: 'text', automationId: '', className: '', enabled: true, password: false, actions: [], inDialog: false, defaultButton: false, windowName: 'Notes' } },
    { ref: 'e7', line: depth => `${depth}- image "Logo" [ref=e7]`, facts: { name: 'Logo', controlType: 'image', automationId: '', className: '', enabled: true, password: false, actions: [], inDialog: false, defaultButton: false, windowName: 'Notes' } },
  ];

  private window(handle: number) {
    if (handle === NOTES) return { handle, title: 'Notes', className: 'NotesWindow', processId: 11, executable: 'notes.exe', minimized: false, elevated: false };
    if (handle === BANK) return { handle, title: 'Bank', className: 'BankWindow', processId: 22, executable: 'bank.exe', minimized: false, elevated: false };
    return { handle, title: 'Admin tool', className: 'AdminWindow', processId: 33, executable: 'admin.exe', minimized: false, elevated: true };
  }

  private refusal(request: { handle: number; allow: string[] }) {
    const window = this.window(request.handle);
    if (!request.allow.includes(window.executable)) return { problem: 'not_granted' as const };
    if (window.elevated) return { problem: 'elevated' as const };
    return undefined;
  }

  async request(request: DesktopHostRequest) {
    this.requests.push(request);
    if (request.kind === 'windows') return { windows: [this.window(NOTES), this.window(BANK), this.window(ADMIN)] };
    if (request.kind === 'forget') return { forgotten: true };
    const refused = this.refusal(request);
    if (refused) return refused;
    const window = this.window(request.handle);
    if (request.kind === 'snapshot') {
      const snapshot = this.elements.map((element, index) => element.line(index === 0 ? '' : '  ')).join('\n');
      return { ...window, snapshot, elements: this.elements.length, truncated: false };
    }
    if (request.kind === 'screenshot') return { ...window, png: PIXEL, width: 1, height: 1 };
    const element = this.elements.find(candidate => candidate.ref === request.ref);
    if (request.kind === 'inspect') return { ...window, target: element ? { ref: element.ref, ...element.facts } : null };
    if (!element) return { problem: 'stale' as const };
    if (element.facts.name !== request.expect.name) return { problem: 'stale' as const };
    if (request.step.kind === 'set_value') {
      if (element.facts.password) return { problem: 'password' as const };
      this.note = request.step.text ?? '';
    } else if (request.step.kind === 'toggle') {
      this.wrap = !this.wrap;
    } else if (request.step.kind === 'invoke') {
      if (element.facts.name !== 'Save') return { problem: 'not_possible' as const };
      this.saves += 1;
    } else {
      return { problem: 'not_possible' as const };
    }
    return { done: true, pending: false, state: element.ref === 'e2' ? { value: this.note } : {}, cursorMoved: false, foregroundChanged: false, title: 'Notes' };
  }
}

let directory: string;
let store: Store;
let core: CoreService | undefined;
let notes: FakeNotes;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orglet-desktop-'));
  store = new Store(join(directory, 'state.sqlite'));
  notes = new FakeNotes();
});

afterEach(async () => {
  await core?.runner.shutdown();
  core = undefined;
  store.close();
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

async function until(check: () => boolean, timeoutMs = 20_000) {
  const started = Date.now();
  while (!check() && Date.now() - started < timeoutMs) await new Promise(resolve => setTimeout(resolve, 20));
  expect(check()).toBe(true);
}

const call = (name: string, argumentsValue: unknown): ModelReply => ({ calls: [{ id: id(), name, arguments: JSON.stringify(argumentsValue) }], usage: { input: 100, output: 30 } });
const reply = (message: string) => call('reply', { message, title: null, knowledgeProposals: [] });
const finished = (taskId: string) => ['completed', 'failed', 'cancelled'].includes(store.detail(taskId).task.status) && !core!.runner.isActive(taskId);
const toolResults = (messages: RunMessage[]) => messages.filter(message => message.role === 'tool').map(message => JSON.parse(message.content as string));
const notesGrant = (): DesktopChoiceType => ({ apps: [{ program: 'notes.exe', name: 'Notes', addedAt: now() }] });

function newCore(script: Script, seen: { messages: RunMessage[] }) {
  core = new CoreService(store, () => {}, async () => ({
    async request(messages) {
      seen.messages = structuredClone(messages) as RunMessage[];
      const next = script.shift();
      if (!next) return reply('Done.');
      return next(seen.messages);
    },
  }), undefined, undefined, undefined, undefined, undefined, undefined, {}, undefined, {}, undefined, notes, ['orglet.exe']);
  return core;
}

function steps(taskId: string) {
  return core!.desktop.actions(taskId).map((action: DesktopAction) => `${action.kind}:${action.risk}:${action.outcome}`);
}

describe('desktop apps through the core', () => {
  it('reads and fills in without asking, asks before Save, and refuses a password, another app and an admin app', async () => {
    const seen = { messages: [] as RunMessage[] };
    const script: Script = [
      () => call('desktop_windows', {}),
      () => call('desktop_snapshot', { windowId: `w${NOTES}`, offset: 0 }),
      () => call('desktop_set_value', { windowId: `w${NOTES}`, ref: 'e2', text: 'Buy milk' }),
      () => call('desktop_toggle', { windowId: `w${NOTES}`, ref: 'e4' }),
      () => call('desktop_invoke', { windowId: `w${NOTES}`, ref: 'e5' }),
      () => call('desktop_invoke', { windowId: `w${NOTES}`, ref: 'e5' }),
      () => call('desktop_set_value', { windowId: `w${NOTES}`, ref: 'e3', text: 'hunter2' }),
      () => call('desktop_snapshot', { windowId: `w${BANK}`, offset: 0 }),
      () => call('desktop_snapshot', { windowId: `w${ADMIN}`, offset: 0 }),
      () => call('desktop_invoke', { windowId: `w${NOTES}`, ref: 'e7' }),
      () => call('desktop_screenshot', { windowId: `w${NOTES}` }),
      () => reply('Saved once; the second save was declined.'),
    ];
    newCore(script, seen);
    const worker = await core!.command('saveWorker', { ...store.all<Worker>('workers')[0], provider: 'openai' }) as Worker;
    const taskId = await core!.command('createTask', {
      workerId: worker.id, brief: 'Write "Buy milk" in Notes and save it', sourceIds: [], consent: true, providerScopes: ['openai'], budgetMicros: 100_000,
      toolCapabilities: ['source.read', 'skill.read', 'desktop.read', 'desktop.act'], desktop: notesGrant(),
    }) as string;

    await until(() => core!.desktop.live(taskId).approval !== undefined);
    const first = core!.desktop.live(taskId).approval!;
    expect(first).toMatchObject({ kind: 'invoke', element: 'Save', program: 'notes.exe', window: 'Notes', workerName: worker.name, reasons: [desktopRiskReasons.wording] });
    expect(first.screenshotId).toBeTruthy();
    expect(notes.saves).toBe(0);
    expect(notes.note).toBe('Buy milk');
    const detail = await core!.command('task', { id: taskId }) as { desktop?: { approval?: { id: string } } };
    expect(detail.desktop?.approval?.id).toBe(first.id);
    await expect(core!.command('answerDesktopApproval', { taskId: id(), requestId: first.id, answer: 'allow' })).rejects.toThrow();
    await core!.command('answerDesktopApproval', { taskId, requestId: first.id, answer: 'allow' });
    await until(() => notes.saves === 1);

    await until(() => core!.desktop.live(taskId).approval !== undefined && core!.desktop.live(taskId).approval!.id !== first.id);
    await core!.command('answerDesktopApproval', { taskId, requestId: core!.desktop.live(taskId).approval!.id, answer: 'decline' });
    await until(() => finished(taskId));
    expect(store.detail(taskId).task.status).toBe('completed');
    expect(notes.saves).toBe(1);

    const results = toolResults(seen.messages);
    // Only the granted app's windows are listed, the admin one is not granted either.
    expect(results[0].windows.map((window: { windowId: string }) => window.windowId)).toEqual([`w${NOTES}`]);
    expect(results[1]).toMatchObject({ kind: 'desktop_snapshot', surface: 'desktop', source: { windowId: `w${NOTES}`, program: 'notes.exe' } });
    expect(results[1].trust).toMatch(/Untrusted app content/);
    expect(results[2]).toMatchObject({ kind: 'desktop_set_value', done: true, state: { value: 'Buy milk' } });
    expect(results[2].snapshot).toContain('value="Buy milk"');
    expect(results[4].snapshot).toContain('Status: 1 saved');
    expect(results[5]).toMatchObject({ declined: true, error: DESKTOP_PERSON_DECLINED });
    expect(results[6]).toMatchObject({ refused: true, error: REFUSED_PASSWORD_FIELD });
    expect(results[7]).toMatchObject({ refused: true, problem: 'not_granted', error: desktopProblems.not_granted.reason });
    expect(results[8]).toMatchObject({ refused: true, problem: 'not_granted' });
    expect(results[9]).toMatchObject({ refused: true, problem: 'not_possible', error: desktopProblems.not_possible.reason });
    expect(results[9].hint).toMatch(/never uses the real mouse or keyboard/);
    expect(results[10]).toMatchObject({ kind: 'desktop_screenshot', windowId: `w${NOTES}` });
    // The password never reached the app, nor a step on another app's window.
    expect(notes.requests.filter(request => request.kind === 'act' && request.ref === 'e3')).toEqual([]);
    expect(notes.requests.every(request => !('allow' in request) || request.allow.join() === 'notes.exe')).toBe(true);

    expect(steps(taskId)).toEqual([
      'windows:read:done', 'snapshot:read:done', 'set_value:input:done', 'toggle:input:done', 'invoke:consequential:done', 'invoke:consequential:declined',
      'set_value:consequential:refused', 'snapshot:read:refused', 'snapshot:read:refused', 'invoke:input:refused', 'screenshot:read:done',
    ]);
    const saved = core!.desktop.actions(taskId)[4];
    expect(saved).toMatchObject({ program: 'notes.exe', window: 'Notes', target: 'Save', screenshotId: first.screenshotId });
    const events = store.detail(taskId).events.map(event => event.message);
    expect(events).toContain('Đã đọc cửa sổ “Notes”');
    expect(events).toContain('Đã nhập vào “Note” trong “Notes”');
    expect(events).toContain('Đã hỏi để thao tác “Save” trong “Notes” · được phép');
    expect(events).toContain('Đã hỏi để thao tác “Save” trong “Notes” · bị từ chối');
    // What a window said counts as unvetted input, like a web page.
    expect(store.detail(taskId).runs[0].snapshot.desktop).toEqual({ programs: ['notes.exe'] });
    expect(notes.requests.some(request => request.kind === 'forget')).toBe(true);
  });

  it('refuses a consequential step in a group chat, where nobody can be asked', async () => {
    const results: unknown[] = [];
    core = new CoreService(store, () => {}, async () => ({
      async request(messages) {
        const seen = messages.filter(message => message.role === 'tool').length;
        if (seen === 0) return call('desktop_invoke', { windowId: `w${NOTES}`, ref: 'e5' });
        results.push(JSON.parse(messages.at(-1)!.content as string));
        return reply('Saving is left for you.');
      },
    }), undefined, undefined, undefined, undefined, undefined, undefined, {}, undefined, {}, undefined, notes, ['orglet.exe']);
    const first = await core.command('saveWorker', { ...store.all<Worker>('workers')[0], provider: 'openai' }) as Worker;
    const { id: _id, ...draft } = first;
    const second = await core.command('saveWorker', { ...draft, name: 'Second worker' }) as Worker;
    const taskId = await core.command('createTask', {
      workerId: first.id, assignees: [first.id, second.id], brief: 'Save the note', sourceIds: [], consent: true, providerScopes: ['openai'], budgetMicros: 100_000,
      toolCapabilities: ['source.read', 'desktop.read', 'desktop.act'], desktop: notesGrant(),
    }) as string;
    await until(() => finished(taskId));
    expect(results).toHaveLength(2);
    for (const result of results) expect(result).toMatchObject({ refused: true, error: DESKTOP_NOT_ASKED_HERE });
    expect(notes.saves).toBe(0);
    expect(notes.requests.some(request => request.kind === 'act')).toBe(false);
    expect(core.desktop.live(taskId).approval).toBeUndefined();
  });

  it('never lets a schedule use desktop apps, keeps side threads inside the main chat, and never grants Orglet or a password manager', async () => {
    newCore([], { messages: [] });
    const worker = await core!.command('saveWorker', { ...store.all<Worker>('workers')[0], provider: 'openai' }) as Worker;
    const schedule = { timeZone: 'UTC', time: '09:00', frequency: 'daily' as const, weekday: 1 };
    const task = { workerId: worker.id, sourceIds: [], brief: 'Check my notes', consent: true, providerScopes: ['openai' as const], budgetMicros: 100_000 };
    await expect(core!.command('saveRoutine', { name: 'Reads', enabled: true, schedule, task: { ...task, toolCapabilities: ['source.read', 'desktop.read'] } })).rejects.toThrow(SCHEDULE_NO_DESKTOP);
    await expect(core!.command('saveRoutine', { name: 'Grants', enabled: true, schedule, task: { ...task, desktop: notesGrant() } })).rejects.toThrow(SCHEDULE_NO_DESKTOP);

    const scope = { sourceIds: [], consent: true, providerScopes: ['openai' as const], budgetMicros: 100_000 };
    const main = await core!.command('createTask', { workerId: worker.id, brief: 'Hello', ...scope, toolCapabilities: ['source.read', 'desktop.read'] }) as string;
    await until(() => finished(main));
    await core!.command('setDesktop', { taskId: main, desktop: { apps: [...notesGrant().apps, { program: 'excel.exe', name: 'Excel', addedAt: now() }] } });
    await expect(core!.command('setDesktop', { taskId: main, desktop: { apps: [{ program: 'orglet.exe', name: 'Orglet', addedAt: now() }] } })).rejects.toThrow();
    await expect(core!.command('setDesktop', { taskId: main, desktop: { apps: [{ program: 'bitwarden.exe', name: 'Bitwarden', addedAt: now() }] } })).rejects.toThrow();
    const side = await core!.command('startSideThread', { taskId: main, brief: 'Side', ...scope }) as string;
    await until(() => finished(side));
    expect(store.get<Task>('tasks', side).desktop?.apps.map(app => app.program)).toEqual(['notes.exe', 'excel.exe']);
    await expect(core!.command('setDesktop', { taskId: side, desktop: notesGrant() })).rejects.toThrow('Chat phụ dùng ứng dụng của chat chính');
    // Taking an app away in the main chat takes it from the side thread at once.
    await core!.command('setDesktop', { taskId: main, desktop: notesGrant() });
    expect(store.get<Task>('tasks', side).desktop?.apps.map(app => app.program)).toEqual(['notes.exe']);
    expect(core!.desktop.choiceFor({ ...store.get<Task>('tasks', side), desktop: { apps: [...notesGrant().apps, { program: 'excel.exe', name: 'Excel', addedAt: now() }] } }).apps.map(app => app.program)).toEqual(['notes.exe']);

    // The picker leaves out Orglet itself and never grants what cannot be reached.
    const picked = await core!.command('desktopWindows', {}) as DesktopWindowsView;
    expect(picked.available).toBe(true);
    expect(picked.windows.map(window => `${window.program}:${window.elevated}`)).toEqual(['notes.exe:false', 'bank.exe:false', 'admin.exe:true']);
  });

  it('stops using an app the chat takes away in the middle of a run', async () => {
    const seen = { messages: [] as RunMessage[] };
    let taskId = '';
    const script: Script = [
      () => call('desktop_snapshot', { windowId: `w${NOTES}`, offset: 0 }),
      async () => {
        await core!.command('setDesktop', { taskId, desktop: { apps: [] } });
        return call('desktop_snapshot', { windowId: `w${NOTES}`, offset: 0 });
      },
      () => reply('The app was taken away.'),
    ];
    newCore(script, seen);
    const worker = await core!.command('saveWorker', { ...store.all<Worker>('workers')[0], provider: 'openai' }) as Worker;
    taskId = await core!.command('createTask', {
      workerId: worker.id, brief: 'Read my notes', sourceIds: [], consent: true, providerScopes: ['openai'], budgetMicros: 100_000,
      toolCapabilities: ['source.read', 'desktop.read'], desktop: notesGrant(),
    }) as string;
    await until(() => finished(taskId));
    const results = toolResults(seen.messages);
    expect(results[0].kind).toBe('desktop_snapshot');
    expect(results[1]).toMatchObject({ refused: true, problem: 'not_granted' });
  });
});
