import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import type { ModelReply } from '../../apps/desktop/src/core/adapters/openai';
import type { Run, Task, Worker } from '../../apps/desktop/src/shared/contracts';
import {
  BORROW_KEYS, capabilitiesWithDesktopLevel, DESKTOP_BORROW_LIMIT_MS, DesktopBorrowArgs, DesktopChoice, desktopLevelOf, estimateBorrowMs, MAX_BORROW_STEPS, MAX_BORROW_TEXT_CHARACTERS,
  narrowDesktopChoice, neverDesktopProgram, type DesktopAction, type DesktopApprovalView, type DesktopBorrowStep, type DesktopChoice as DesktopChoiceType, type DesktopWindowsView,
} from '../../apps/desktop/src/shared/desktop';
import type { DesktopBorrowResult, DesktopHost, DesktopHostRequest, DesktopTargetFacts } from '../../apps/desktop/src/shared/desktop-host';
import type { DesktopOverlayState } from '../../apps/desktop/src/shared/desktop-overlay';
import { translateMessage } from '../../apps/desktop/src/shared/i18n';
import { en } from '../../apps/desktop/src/shared/locales/en';
import { snapshotCapabilities, ToolCapabilities, withCapability, type ToolCapability } from '../../apps/desktop/src/shared/tool-policy';
import { permissionState } from '../../apps/desktop/src/shared/capability-status';
import { toolsFor } from '../../apps/desktop/src/core/tools/catalog';
import { SCHEDULE_NO_DESKTOP } from '../../apps/desktop/src/core/orchestration/routines';
import { permissionsOff } from '../../apps/desktop/src/core/orchestration/permission-hints';
import { classifyDesktopStep, desktopRiskReasons, REFUSED_PASSWORD_FIELD } from '../../apps/desktop/src/core/tools/desktop-risk';
import {
  borrowGate, borrowSeconds, borrowStopReasons, DESKTOP_BORROW_NOT_AGAIN, DESKTOP_BORROW_NOT_NEEDED, DESKTOP_BORROW_TOO_LONG, DESKTOP_NOT_ASKED_HERE, DESKTOP_PERSON_DECLINED, desktopEvents,
  desktopProblems, stoppedByPerson, trimOlderDesktopSnapshots,
} from '../../apps/desktop/src/core/tools/desktop-tools';

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
    expect(names(run, chat)).toEqual(['desktop_windows', 'desktop_snapshot', 'desktop_find', 'desktop_screenshot', 'desktop_invoke', 'desktop_set_value', 'desktop_toggle', 'desktop_expand', 'desktop_select', 'desktop_scroll_into_view', 'desktop_borrow_input']);
    expect(names(run, { ...chat, toolCapabilities: ['source.read', 'desktop.read'] })).toEqual(['desktop_windows', 'desktop_snapshot', 'desktop_find', 'desktop_screenshot']);
    expect(names({ ...run, snapshot: { ...run.snapshot, desktop: undefined } }, chat)).toEqual([]);
    expect(names({ ...run, snapshot: { ...run.snapshot, worker: { ...worker, provider: 'demo' } } }, chat)).toEqual([]);
    expect(names(run, { ...chat, routineId: id() })).toEqual([]);
    // Borrowing the real mouse always asks the person: a group chat's or a crew's run has nobody to ask.
    expect(names({ ...run, stage: 'group' }, chat)).not.toContain('desktop_borrow_input');
    expect(names({ ...run, stage: 'member' }, chat)).not.toContain('desktop_borrow_input');
    expect(names({ ...run, stage: 'synthesis' }, chat)).not.toContain('desktop_borrow_input');
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

type BorrowRequest = Extract<DesktopHostRequest, { kind: 'borrow' }>;

/** A tiny notes app as the helper would report it, which counts what reached it. */
class FakeNotes implements DesktopHost {
  note = '';
  wrap = false;
  saves = 0;
  deletes = 0;
  /** What reached the canvas, which draws itself: only a borrowed keyboard can type into it. */
  canvas = '';
  canvasClicks = 0;
  requests: DesktopHostRequest[] = [];
  /** How a borrow ends; by default every step runs. */
  borrowAnswer?: (request: BorrowRequest) => DesktopBorrowResult | Promise<DesktopBorrowResult>;
  private elements: { ref: string; line: (depth: string) => string; facts: Omit<DesktopTargetFacts, 'ref'> }[] = [
    { ref: 'e1', line: depth => `${depth}- window "Notes" [ref=e1]`, facts: { name: 'Notes', controlType: 'window', automationId: '', className: '', enabled: true, password: false, actions: [], inDialog: false, defaultButton: false, windowName: 'Notes' } },
    { ref: 'e2', line: depth => `${depth}- edit "Note" [ref=e2]${this.note ? ` value="${this.note}"` : ''} actions=set_value`, facts: { name: 'Note', controlType: 'edit', automationId: 'note', className: 'Edit', enabled: true, password: false, actions: ['set_value'], inDialog: false, defaultButton: false, windowName: 'Notes', box: { x: 120, y: 140, width: 200, height: 24 } } },
    { ref: 'e3', line: depth => `${depth}- edit "Password" [ref=e3] [password]`, facts: { name: 'Password', controlType: 'edit', automationId: 'password', className: 'Edit', enabled: true, password: true, actions: ['set_value'], inDialog: false, defaultButton: false, windowName: 'Notes' } },
    { ref: 'e4', line: depth => `${depth}- check box "Wrap lines" [ref=e4] [${this.wrap ? 'checked' : 'unchecked'}] actions=toggle`, facts: { name: 'Wrap lines', controlType: 'check box', automationId: 'wrap', className: 'Button', enabled: true, password: false, actions: ['toggle'], inDialog: false, defaultButton: false, windowName: 'Notes' } },
    { ref: 'e5', line: depth => `${depth}- button "Save" [ref=e5] actions=invoke`, facts: { name: 'Save', controlType: 'button', automationId: 'save', className: 'Button', enabled: true, password: false, actions: ['invoke'], inDialog: false, defaultButton: false, windowName: 'Notes' } },
    { ref: 'e6', line: depth => `${depth}- text "Status: ${this.saves} saved" [ref=e6]`, facts: { name: 'Status', controlType: 'text', automationId: '', className: '', enabled: true, password: false, actions: [], inDialog: false, defaultButton: false, windowName: 'Notes' } },
    { ref: 'e7', line: depth => `${depth}- image "Logo" [ref=e7]`, facts: { name: 'Logo', controlType: 'image', automationId: '', className: '', enabled: true, password: false, actions: [], inDialog: false, defaultButton: false, windowName: 'Notes' } },
    { ref: 'e8', line: depth => `${depth}- pane "Canvas" [ref=e8]`, facts: { name: 'Canvas', controlType: 'pane', automationId: 'canvas', className: 'Canvas', enabled: true, password: false, actions: [], inDialog: false, defaultButton: false, windowName: 'Notes' } },
    { ref: 'e9', line: depth => `${depth}- text "Canvas: ${this.canvas}" [ref=e9]`, facts: { name: 'Canvas text', controlType: 'text', automationId: '', className: '', enabled: true, password: false, actions: [], inDialog: false, defaultButton: false, windowName: 'Notes' } },
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
    if (request.kind === 'borrow_stop') return { stopping: true };
    const refused = this.refusal(request);
    if (refused) return refused;
    const window = this.window(request.handle);
    if (request.kind === 'bounds') return { bounds: { x: 100, y: 80, width: 640, height: 480 } };
    if (request.kind === 'snapshot') {
      const snapshot = this.elements.map((element, index) => element.line(index === 0 ? '' : '  ')).join('\n');
      return { ...window, snapshot, elements: this.elements.length, truncated: false };
    }
    if (request.kind === 'screenshot') return { ...window, png: PIXEL, width: 1, height: 1 };
    const element = this.elements.find(candidate => candidate.ref === request.ref);
    if (request.kind === 'inspect') return { ...window, target: element ? { ref: element.ref, ...element.facts } : null };
    if (!element) return { problem: 'stale' as const };
    if (element.facts.name !== request.expect.name) return { problem: 'stale' as const };
    if (request.kind === 'borrow_check') return element.facts.password ? { problem: 'password' as const } : { ...window, point: { x: 40, y: 60 } };
    if (request.kind === 'borrow') {
      if (this.borrowAnswer) return this.borrowAnswer(request);
      for (const step of request.steps) {
        if (step.kind === 'click') this.canvasClicks += 1;
        if (step.kind === 'type') this.canvas += step.text ?? '';
      }
      return { completedSteps: request.steps.length, stoppedBy: null, durationMs: 1_800, stopLatencyMs: null, restored: { foreground: true, cursor: true }, title: 'Notes' };
    }
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

// ----- Borrowing the real mouse and keyboard (phase 2b) -----

const borrowStep = (kind: DesktopBorrowStep['kind'], fields: Partial<DesktopBorrowStep> = {}): DesktopBorrowStep => ({ kind, text: null, keys: null, notches: null, ...fields });
const borrowCall = (windowId: string, ref: string, steps: DesktopBorrowStep[]) => call('desktop_borrow_input', { windowId, ref, steps });

describe('when a borrow may be offered and how long it may take', () => {
  it('takes only flat, bounded plans, with no Escape and no shortcut but Ctrl+Home and Ctrl+End', () => {
    const windowId = `w${NOTES}`;
    const valid = (steps: unknown[]) => DesktopBorrowArgs.safeParse({ windowId, ref: 'e8', steps }).success;
    expect(valid([borrowStep('click'), borrowStep('type', { text: 'Buy milk\n' }), borrowStep('keys', { keys: ['Ctrl+End', 'Enter'] }), borrowStep('scroll', { notches: -3 })])).toBe(true);
    expect(valid([borrowStep('click', { text: 'x' })])).toBe(false);
    expect(valid([borrowStep('type')])).toBe(false);
    expect(valid([borrowStep('scroll', { notches: 0 })])).toBe(false);
    expect(valid([{ kind: 'keys', text: null, keys: ['Escape'], notches: null }])).toBe(false);
    expect(valid([{ kind: 'keys', text: null, keys: ['Ctrl+S'], notches: null }])).toBe(false);
    expect(valid(Array.from({ length: MAX_BORROW_STEPS + 1 }, () => borrowStep('click')))).toBe(false);
    expect(valid([borrowStep('type', { text: 'a'.repeat(300) }), borrowStep('type', { text: 'b'.repeat(101) })])).toBe(false);
    expect(BORROW_KEYS).not.toContain('Escape');
    // The largest plans the schema allows still fit inside the time limit, so the limit only ever cuts a borrow that
    // went wrong, never a normal one in the middle of its text.
    const longestTyping = Array.from({ length: MAX_BORROW_STEPS }, () => borrowStep('type', { text: 'x'.repeat(MAX_BORROW_TEXT_CHARACTERS / MAX_BORROW_STEPS) }));
    const longestKeys = Array.from({ length: MAX_BORROW_STEPS }, () => borrowStep('keys', { keys: Array.from({ length: 10 }, () => 'Down' as const) }));
    expect(estimateBorrowMs(longestTyping)).toBeLessThanOrEqual(DESKTOP_BORROW_LIMIT_MS);
    expect(estimateBorrowMs(longestKeys)).toBeLessThanOrEqual(DESKTOP_BORROW_LIMIT_MS);
    expect(DESKTOP_BORROW_LIMIT_MS).toBe(10_000);
    expect(DESKTOP_BORROW_TOO_LONG).toContain(`${DESKTOP_BORROW_LIMIT_MS / 1000} giây`);
  });

  it('offers a borrow only for what the background cannot do, or did not manage on that element', () => {
    const type = [borrowStep('type', { text: 'hi' })];
    expect(borrowGate({ steps: type, actions: ['set_value'], triedInBackground: false })).toEqual({ allowed: false, tool: 'desktop_set_value' });
    expect(borrowGate({ steps: [borrowStep('click')], actions: ['invoke'], triedInBackground: false })).toMatchObject({ allowed: false });
    expect(borrowGate({ steps: type, actions: [], triedInBackground: false })).toEqual({ allowed: true });
    expect(borrowGate({ steps: [borrowStep('click'), ...type], actions: [], triedInBackground: false })).toEqual({ allowed: true });
    // Keys and the wheel have no background tool at all.
    expect(borrowGate({ steps: [borrowStep('keys', { keys: ['Enter'] })], actions: ['set_value'], triedInBackground: false })).toEqual({ allowed: true });
    // A background step that came back not possible opens the way even when the element claims the pattern.
    expect(borrowGate({ steps: type, actions: ['set_value'], triedInBackground: true })).toEqual({ allowed: true });
  });

  it('words the journal and tells the person\'s stops from the others', () => {
    for (const reason of ['person_mouse', 'person_key', 'escape'] as const) expect(stoppedByPerson(reason)).toBe(true);
    for (const reason of ['time_limit', 'foreground_changed', 'focus_changed', 'no_foreground', 'run_stopped', null] as const) expect(stoppedByPerson(reason)).toBe(false);
    expect([borrowSeconds(0), borrowSeconds(400), borrowSeconds(2_600)]).toEqual([1, 1, 3]);
    expect(desktopEvents.borrowed(3, 'Untitled - Notepad')).toBe('Đã mượn chuột 3 giây trong “Untitled - Notepad” · bạn cho phép');
    expect(translateMessage(en, desktopEvents.borrowed(3, 'Untitled - Notepad'))).toBe('Borrowed the mouse for 3 s in “Untitled - Notepad” · you allowed');
    expect(translateMessage(en, desktopEvents.borrowStopped(1, 'Notes'))).toBe('Borrowed the mouse for 1 s in “Notes” · you stopped it');
    expect(translateMessage(en, desktopEvents.borrowCut(2, 'Notes', borrowStopReasons.time_limit))).toBe('Borrowed the mouse for 2 s in “Notes” · stopped early: the time limit ran out');
    expect(translateMessage(en, desktopEvents.borrowDeclined('Notes'))).toBe('Asked to borrow the mouse in “Notes” · declined');
    for (const words of Object.values(borrowStopReasons)) expect(en[words], words).toBeTruthy();
  });
});

describe('borrowing through the core', () => {
  async function soloChat(script: Script, seen: { messages: RunMessage[] }) {
    newCore(script, seen);
    const worker = await core!.command('saveWorker', { ...store.all<Worker>('workers')[0], provider: 'openai' }) as Worker;
    const taskId = await core!.command('createTask', {
      workerId: worker.id, brief: 'Write "Buy milk" on the canvas in Notes', sourceIds: [], consent: true, providerScopes: ['openai'], budgetMicros: 100_000,
      toolCapabilities: ['source.read', 'skill.read', 'desktop.read', 'desktop.act'], desktop: notesGrant(),
    }) as string;
    return { taskId, worker };
  }

  async function nextApproval(taskId: string, after?: string): Promise<DesktopApprovalView> {
    await until(() => {
      const approval = core!.desktop.live(taskId).approval;
      return approval !== undefined && approval.id !== after;
    });
    return core!.desktop.live(taskId).approval!;
  }

  it('refuses what the background can do, a password and another app, then asks, borrows once, and never asks again after a decline', async () => {
    const seen = { messages: [] as RunMessage[] };
    const notesWindow = `w${NOTES}`;
    const script: Script = [
      () => call('desktop_snapshot', { windowId: notesWindow, offset: 0 }),
      () => borrowCall(notesWindow, 'e2', [borrowStep('type', { text: 'Buy milk' })]),
      () => borrowCall(notesWindow, 'e3', [borrowStep('type', { text: 'hunter2' })]),
      () => borrowCall(`w${BANK}`, 'e2', [borrowStep('click')]),
      () => borrowCall(notesWindow, 'e8', [borrowStep('click'), borrowStep('type', { text: 'Buy milk\n' })]),
      () => call('desktop_invoke', { windowId: notesWindow, ref: 'e7' }),
      () => borrowCall(notesWindow, 'e7', [borrowStep('click')]),
      () => borrowCall(notesWindow, 'e8', [borrowStep('type', { text: 'again' })]),
      () => reply('Typed on the canvas; the logo click was declined.'),
    ];
    const { taskId, worker } = await soloChat(script, seen);

    const first = await nextApproval(taskId);
    expect(first).toMatchObject({ kind: 'borrow', element: 'Canvas', program: 'notes.exe', window: 'Notes', workerName: worker.name, borrow: { limitSeconds: 10 } });
    expect(first.borrow!.steps).toEqual([borrowStep('click'), borrowStep('type', { text: 'Buy milk\n' })]);
    expect(first.reasons).toContain(desktopRiskReasons.borrow);
    expect(first.screenshotId).toBeTruthy();
    // Nothing reached the app before the answer; only a check that sends no input was made.
    expect(notes.requests.some(request => request.kind === 'borrow')).toBe(false);
    expect(notes.requests.some(request => request.kind === 'borrow_check')).toBe(true);
    await core!.command('answerDesktopApproval', { taskId, requestId: first.id, answer: 'allow' });
    await until(() => notes.canvas === 'Buy milk\n');
    expect(notes.canvasClicks).toBe(1);

    const second = await nextApproval(taskId, first.id);
    expect(second).toMatchObject({ kind: 'borrow', element: 'Logo', borrow: { steps: [borrowStep('click')] } });
    await core!.command('answerDesktopApproval', { taskId, requestId: second.id, answer: 'decline' });
    await until(() => finished(taskId));
    expect(store.detail(taskId).task.status).toBe('completed');

    const results = toolResults(seen.messages);
    expect(results[1]).toMatchObject({ refused: true, error: DESKTOP_BORROW_NOT_NEEDED, next: 'Do it in the background with desktop_set_value.' });
    expect(results[2]).toMatchObject({ refused: true, error: REFUSED_PASSWORD_FIELD });
    expect(results[3]).toMatchObject({ refused: true, problem: 'not_granted' });
    expect(results[4]).toMatchObject({ kind: 'desktop_borrow_input', done: true, completedSteps: 2, totalSteps: 2, seconds: 2, restored: { foreground: true, cursor: true } });
    expect(results[4].snapshot).toContain('Canvas: Buy milk');
    expect(results[5]).toMatchObject({ refused: true, problem: 'not_possible' });
    expect(results[6]).toMatchObject({ declined: true, error: DESKTOP_PERSON_DECLINED });
    expect(results[7]).toMatchObject({ refused: true, error: DESKTOP_BORROW_NOT_AGAIN });

    // Exactly one borrow reached the helper, with the approved steps, the time limit and the notice in the app's language.
    const borrows = notes.requests.filter((request): request is BorrowRequest => request.kind === 'borrow');
    expect(borrows).toHaveLength(1);
    expect(borrows[0]).toMatchObject({ handle: NOTES, ref: 'e8', allow: ['notes.exe'], expect: { name: 'Canvas', controlType: 'pane' }, limitMs: 10_000, indicator: 'Orglet is using your mouse and keyboard · press Esc to stop' });
    expect(borrows[0].steps).toEqual(first.borrow!.steps);

    expect(steps(taskId)).toEqual([
      'snapshot:read:done', 'borrow:consequential:refused', 'borrow:consequential:refused', 'borrow:consequential:refused', 'borrow:consequential:done',
      'invoke:input:refused', 'borrow:consequential:declined', 'borrow:consequential:refused',
    ]);
    const borrowed = core!.desktop.actions(taskId)[4];
    expect(borrowed).toMatchObject({ program: 'notes.exe', window: 'Notes', target: 'Canvas', durationMs: 1_800, screenshotId: first.screenshotId });
    expect(core!.desktop.actions(taskId)[0].durationMs).toBeNull();
    const events = store.detail(taskId).events.map(event => event.message);
    expect(events).toContain('Đã mượn chuột 2 giây trong “Notes” · bạn cho phép');
    expect(events).toContain('Đã hỏi để mượn chuột trong “Notes” · bị từ chối');
  });

  it('journals a borrow the person stopped, and does not ask again in that run', async () => {
    const seen = { messages: [] as RunMessage[] };
    notes.borrowAnswer = () => ({ completedSteps: 1, stoppedBy: 'person_mouse', durationMs: 700, stopLatencyMs: 4, restored: { foreground: false, cursor: false }, title: 'Notes' });
    const script: Script = [
      () => borrowCall(`w${NOTES}`, 'e8', [borrowStep('click'), borrowStep('type', { text: 'hello' })]),
      () => borrowCall(`w${NOTES}`, 'e8', [borrowStep('type', { text: 'hello' })]),
      () => reply('You stopped it.'),
    ];
    const { taskId } = await soloChat(script, seen);
    const approval = await nextApproval(taskId);
    await core!.command('answerDesktopApproval', { taskId, requestId: approval.id, answer: 'allow' });
    await until(() => finished(taskId));
    const results = toolResults(seen.messages);
    expect(results[0]).toMatchObject({ done: false, completedSteps: 1, totalSteps: 2, stoppedBy: borrowStopReasons.person_mouse, restored: { foreground: false, cursor: false } });
    expect(results[0].next).toMatch(/Do not borrow again/);
    expect(results[1]).toMatchObject({ refused: true, error: DESKTOP_BORROW_NOT_AGAIN });
    expect(steps(taskId)).toEqual(['borrow:consequential:stopped', 'borrow:consequential:refused']);
    expect(store.detail(taskId).events.map(event => event.message)).toContain('Đã mượn chuột 1 giây trong “Notes” · bạn đã dừng');
  });

  it('journals a borrow the time limit cut as failed, with the reason', async () => {
    const seen = { messages: [] as RunMessage[] };
    notes.borrowAnswer = () => ({ completedSteps: 0, stoppedBy: 'time_limit', durationMs: 10_050, stopLatencyMs: null, restored: { foreground: true, cursor: true }, title: 'Notes' });
    const { taskId } = await soloChat([() => borrowCall(`w${NOTES}`, 'e8', [borrowStep('type', { text: 'slow app' })]), () => reply('The app was too slow.')], seen);
    const approval = await nextApproval(taskId);
    await core!.command('answerDesktopApproval', { taskId, requestId: approval.id, answer: 'allow' });
    await until(() => finished(taskId));
    expect(toolResults(seen.messages)[0]).toMatchObject({ done: false, stoppedBy: borrowStopReasons.time_limit, seconds: 10 });
    expect(steps(taskId)).toEqual(['borrow:consequential:failed']);
    expect(store.detail(taskId).events.map(event => event.message)).toContain('Đã mượn chuột 10 giây trong “Notes” · dừng giữa chừng: hết giới hạn thời gian');
  });

  it('frames the window on the glow while a step acts and the display while it borrows, and needs no notice of the helper then', async () => {
    const states: DesktopOverlayState[] = [];
    const script: Script = [
      () => call('desktop_set_value', { windowId: `w${NOTES}`, ref: 'e2', text: 'Buy milk' }),
      () => borrowCall(`w${NOTES}`, 'e8', [borrowStep('type', { text: 'on the canvas' })]),
      () => reply('Done.'),
    ];
    newCore(script, { messages: [] });
    // Main answers once the glow is on screen.
    core!.desktop.showOverlayWith(state => {
      states.push(state);
      return Promise.resolve(true);
    });
    const worker = await core!.command('saveWorker', { ...store.all<Worker>('workers')[0], provider: 'openai' }) as Worker;
    const taskId = await core!.command('createTask', {
      workerId: worker.id, brief: 'Fill in Notes', sourceIds: [], consent: true, providerScopes: ['openai'], budgetMicros: 100_000,
      toolCapabilities: ['source.read', 'skill.read', 'desktop.read', 'desktop.act'], desktop: notesGrant(),
    }) as string;
    const approval = await nextApproval(taskId);
    // The step in the background showed the glow around the window, with the orglet's cursor typing in the middle of the field.
    const typing = states.find(state => state.visible && state.mode === 'window');
    expect(typing).toMatchObject({ visible: true, mode: 'window', taskId, app: 'Notes', frame: { x: 100, y: 80, width: 640, height: 480 }, worker: { id: worker.id, name: worker.name }, cursor: { x: 220, y: 152, action: 'type' }, theme: 'system' });
    await core!.command('answerDesktopApproval', { taskId, requestId: approval.id, answer: 'allow' });
    await until(() => finished(taskId));
    expect(states.some(state => state.visible && state.mode === 'borrow' && state.cursor === undefined)).toBe(true);
    // Orglet's own pill says it on screen, so the helper shows no notice of its own.
    const borrow = notes.requests.find((request): request is BorrowRequest => request.kind === 'borrow');
    expect(borrow?.indicator).toBe('');
    // The run ended, so the glow is gone.
    expect(states.at(-1)).toEqual({ visible: false });
  });

  it('tells the helper to stop at once when the run is stopped in the middle of a borrow', async () => {
    notes.borrowAnswer = () => new Promise(resolve => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (!notes.requests.some(request => request.kind === 'borrow_stop') && Date.now() - started < 5_000) return;
        clearInterval(timer);
        resolve({ completedSteps: 0, stoppedBy: 'run_stopped', durationMs: 300, stopLatencyMs: null, restored: { foreground: true, cursor: true }, title: 'Notes' });
      }, 10);
    });
    const { taskId } = await soloChat([() => borrowCall(`w${NOTES}`, 'e8', [borrowStep('type', { text: 'never finished' })])], { messages: [] });
    const approval = await nextApproval(taskId);
    await core!.command('answerDesktopApproval', { taskId, requestId: approval.id, answer: 'allow' });
    await until(() => notes.requests.some(request => request.kind === 'borrow'));
    await core!.command('cancel', { id: taskId });
    await until(() => notes.requests.some(request => request.kind === 'borrow_stop'));
    await until(() => finished(taskId));
    expect(store.detail(taskId).task.status).toBe('cancelled');
  });
});
