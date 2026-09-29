import { z } from 'zod';
import type { ToolCapability } from './tool-policy';

/**
 * Desktop apps (COD-261, phase 2a): an orglet reads and uses the windows of programs the person granted to the chat,
 * through Windows UI Automation. Every step is simulated input on an element (invoke, set a value, toggle, expand,
 * select, scroll into view): the real mouse and keyboard are not used and no window is brought to the front. A step
 * UI Automation cannot do in the background is reported as not possible, never done another way on its own. Phase 2b
 * adds one way, only after that and only when the person allows it on a card: borrowing the real mouse and keyboard
 * for a few planned steps on one element (`DesktopBorrowStep`). The core decides which window and which step, sets
 * each step's risk and journals every call; a helper process only carries it out. docs/desktop.md is the user-facing page.
 */

/** Programs one chat may grant. */
export const MAX_DESKTOP_APPS = 20;
/** Characters of a window snapshot one call returns; the worker asks for the next part with `offset`. */
export const DESKTOP_SNAPSHOT_CHARACTERS = 20_000;
/** Screenshots one run may keep, card pictures included. */
export const MAX_DESKTOP_SCREENSHOTS = 10;
/** Longest text one desktop_set_value may enter. */
export const MAX_DESKTOP_TEXT_CHARACTERS = 4_000;

/**
 * Programs no chat may ever see, whatever the person picks: password managers and the Windows sign-in, credential
 * and elevation prompts, the lock screen, and the frame every Store app shares (granting it would grant them all).
 * Orglet itself is added by the core at run time, since its file name differs between a build and development.
 */
export const NEVER_DESKTOP_PROGRAMS: readonly string[] = [
  '1password.exe', 'bitwarden.exe', 'keepass.exe', 'keepassxc.exe', 'lastpass.exe', 'dashlane.exe', 'nordpass.exe', 'enpass.exe',
  'roboform.exe', 'keeperpasswordmanager.exe', 'proton pass.exe', 'passwordsafe.exe', 'keeper.exe', 'bitwardendesktop.exe',
  'consent.exe', 'credentialuibroker.exe', 'credwiz.exe', 'logonui.exe', 'lockapp.exe', 'securityhealthhost.exe', 'useraccountbroker.exe',
  'applicationframehost.exe', 'orglet.exe',
];

/** A program as the list keeps it: its file name in lowercase, such as notepad.exe. */
export const DesktopProgram = z.string().min(5).max(120)
  .refine(text => text === text.toLowerCase() && text.endsWith('.exe') && !/[\\/:*?"<>|\u0000-\u001f]/.test(text), 'Tên chương trình không hợp lệ.');

/** One program a chat may see and use: every window it opens, dialogs included. `name` is how the picker showed it. */
export const DesktopAppGrant = z.object({ program: DesktopProgram, name: z.string().trim().min(1).max(120), addedAt: z.iso.datetime() }).strict();
export type DesktopAppGrant = z.infer<typeof DesktopAppGrant>;
export const DesktopAppGrants = z.array(DesktopAppGrant).max(MAX_DESKTOP_APPS)
  .refine(apps => new Set(apps.map(app => app.program)).size === apps.length, 'Ứng dụng bị trùng trong danh sách.')
  .refine(apps => apps.every(app => !NEVER_DESKTOP_PROGRAMS.includes(app.program)), 'Orglet không bao giờ dùng ứng dụng này.');

/** What one chat's orglets may see on the desktop. Absent on a chat means no program at all. */
export const DesktopChoice = z.object({ apps: DesktopAppGrants }).strict();
export type DesktopChoice = z.infer<typeof DesktopChoice>;
export const defaultDesktopChoice = (): DesktopChoice => ({ apps: [] });

/**
 * What a side thread may use (COD-247): never wider than its main chat. A program is granted only when both chats
 * grant it. Read again before every step, so a narrowing in the main chat reaches the side thread at once.
 */
export function narrowDesktopChoice(side: DesktopChoice, main: DesktopChoice): DesktopChoice {
  const mainPrograms = new Set(main.apps.map(app => app.program));
  return { apps: side.apps.filter(app => mainPrograms.has(app.program)) };
}

/** Whether a program can never be granted: the fixed list, or one of Orglet's own programs. */
export function neverDesktopProgram(program: string, ownPrograms: readonly string[] = []): boolean {
  const lower = program.toLowerCase();
  return !lower || NEVER_DESKTOP_PROGRAMS.includes(lower) || ownPrograms.includes(lower);
}

/**
 * How far a chat reaches on the desktop. Cumulative like the browser's levels: "read and act" (`desktop.act`)
 * includes reading. `none` is no desktop at all.
 */
export type DesktopLevel = 'none' | 'read' | 'act';
export const desktopLevels: readonly DesktopLevel[] = ['none', 'read', 'act'];

export function desktopLevelOf(capabilities: readonly ToolCapability[]): DesktopLevel {
  if (capabilities.includes('desktop.act') && capabilities.includes('desktop.read')) return 'act';
  return capabilities.includes('desktop.read') ? 'read' : 'none';
}

/** The chat's capabilities with the desktop at `level`, every other capability kept as it was. */
export function capabilitiesWithDesktopLevel(capabilities: readonly ToolCapability[], level: DesktopLevel): ToolCapability[] {
  const others = capabilities.filter(capability => capability !== 'desktop.read' && capability !== 'desktop.act');
  if (level === 'act') return [...others, 'desktop.read', 'desktop.act'];
  if (level === 'read') return [...others, 'desktop.read'];
  return others;
}

/** A window as the worker names it: "w" and its handle, such as w66476. The core checks its program before every step. */
export const DesktopWindowId = z.string().regex(/^w\d{1,12}$/, 'Mã cửa sổ không hợp lệ.');
/** An element of a window, as the run's latest snapshot of that window marks it: e12. */
export const DesktopRef = z.string().regex(/^e\d{1,5}$/, 'Mã phần tử không hợp lệ.');

export const DesktopWindowsArgs = z.object({}).strict();
export const DesktopSnapshotArgs = z.object({ windowId: DesktopWindowId, offset: z.number().int().min(0).max(10_000_000) }).strict();
export const DesktopFindArgs = z.object({ windowId: DesktopWindowId, query: z.string().trim().min(1).max(200) }).strict();
export const DesktopWindowArgs = z.object({ windowId: DesktopWindowId }).strict();
export const DesktopElementArgs = z.object({ windowId: DesktopWindowId, ref: DesktopRef }).strict();
export const DesktopSetValueArgs = z.object({ windowId: DesktopWindowId, ref: DesktopRef, text: z.string().max(MAX_DESKTOP_TEXT_CHARACTERS) }).strict();
export const DesktopExpandArgs = z.object({ windowId: DesktopWindowId, ref: DesktopRef, expand: z.boolean() }).strict();

/**
 * Borrowing the person's real mouse and keyboard for one step (COD-261, phase 2b), only where UI Automation cannot do
 * it in the background and only after the person allows it on a card. The whole borrow is capped in time, every step
 * acts on the one element the person saw marked, and any input of the person's own stops it.
 */
export const DESKTOP_BORROW_LIMIT_MS = 10_000;
/** Steps one borrow may plan. */
export const MAX_BORROW_STEPS = 5;
/** Characters one borrow may type, all steps together; typing one takes up to a timer tick. */
export const MAX_BORROW_TEXT_CHARACTERS = 400;
/** Wheel notches one scroll step may turn, either way. */
export const MAX_BORROW_SCROLL_NOTCHES = 10;
/**
 * The keys a borrow may press, one at a time. No Escape, which is how the person stops a borrow, and no shortcut that
 * could save, close or undo on its own: only the two that move to the start or the end of a document.
 */
export const BORROW_KEYS = ['Enter', 'Tab', 'Backspace', 'Delete', 'Space', 'Home', 'End', 'PageUp', 'PageDown', 'Up', 'Down', 'Left', 'Right', 'Ctrl+Home', 'Ctrl+End'] as const;
export type BorrowKey = typeof BORROW_KEYS[number];

/**
 * One step of a borrow, always on the element the person approved: click it at its clickable point, type text into it,
 * press keys in it, or turn the mouse wheel over it. Flat, with the fields another kind does not use set to null, so the
 * model's strict schema stays one object.
 */
export const DesktopBorrowStep = z.object({
  kind: z.enum(['click', 'type', 'keys', 'scroll']),
  text: z.string().min(1).max(MAX_BORROW_TEXT_CHARACTERS).nullable(),
  keys: z.array(z.enum(BORROW_KEYS)).min(1).max(10).nullable(),
  notches: z.number().int().min(-MAX_BORROW_SCROLL_NOTCHES).max(MAX_BORROW_SCROLL_NOTCHES).nullable(),
}).strict().superRefine((step, context) => {
  const fieldsByKind: Record<typeof step.kind, readonly string[]> = { click: [], type: ['text'], keys: ['keys'], scroll: ['notches'] };
  const needs = fieldsByKind[step.kind];
  for (const field of ['text', 'keys', 'notches'] as const) {
    const given = step[field] !== null;
    if (given !== needs.includes(field)) context.addIssue({ code: 'custom', path: [field], message: given ? `${field} must be null for ${step.kind}` : `${step.kind} needs ${field}` });
  }
  if (step.kind === 'scroll' && step.notches === 0) context.addIssue({ code: 'custom', path: ['notches'], message: 'notches must not be 0' });
});
export type DesktopBorrowStep = z.infer<typeof DesktopBorrowStep>;
export const DesktopBorrowArgs = z.object({ windowId: DesktopWindowId, ref: DesktopRef, steps: z.array(DesktopBorrowStep).min(1).max(MAX_BORROW_STEPS) }).strict()
  .refine(input => input.steps.reduce((total, step) => total + Array.from(step.text ?? '').length, 0) <= MAX_BORROW_TEXT_CHARACTERS, `At most ${MAX_BORROW_TEXT_CHARACTERS} characters in one borrow`);

/** Time the helper needs around the steps: bringing the window forward, showing the notice, giving everything back. */
const BORROW_SETUP_MS = 1_200;
/** One input and the re-check before it; Windows' default timer makes a short wait last up to about 16 ms. */
const BORROW_INPUT_MS = 16;
const BORROW_STEP_MS = 150;

/**
 * How long a borrow of these steps should take at most. The core refuses a plan that would not fit well inside the
 * limit rather than let the limit cut it in the middle of the text.
 */
export function estimateBorrowMs(steps: readonly DesktopBorrowStep[]): number {
  let inputs = 0;
  for (const step of steps) {
    if (step.kind === 'type') inputs += Array.from(step.text ?? '').length;
    else if (step.kind === 'keys') inputs += step.keys?.length ?? 0;
    else inputs += 2;
  }
  return BORROW_SETUP_MS + steps.length * BORROW_STEP_MS + inputs * BORROW_INPUT_MS;
}

/** Every step a desktop tool can take: the reading ones, acting on an element (`desktop.act`), and borrowing the real mouse. */
export const DesktopActionKind = z.enum(['windows', 'snapshot', 'find', 'screenshot', 'invoke', 'set_value', 'toggle', 'expand', 'collapse', 'select', 'scroll_into_view', 'borrow']);
export type DesktopActionKind = z.infer<typeof DesktopActionKind>;
/** The steps that act on an element, each one UI Automation pattern. */
export type DesktopActKind = 'invoke' | 'set_value' | 'toggle' | 'expand' | 'collapse' | 'select' | 'scroll_into_view';
export const DESKTOP_ACT_KINDS: readonly DesktopActKind[] = ['invoke', 'set_value', 'toggle', 'expand', 'collapse', 'select', 'scroll_into_view'];
/** How much a step could change, set by the core and never by the model; the same tiers as the browser's. */
export const DesktopRisk = z.enum(['read', 'input', 'consequential']);
export type DesktopRisk = z.infer<typeof DesktopRisk>;
/**
 * `unknown` is a step the app closed in the middle of; `declined` is one the person did not allow; `stopped` is a borrow
 * the person ended with their own mouse or keyboard.
 */
export const DesktopOutcome = z.enum(['done', 'refused', 'failed', 'unknown', 'declined', 'stopped']);
export type DesktopOutcome = z.infer<typeof DesktopOutcome>;

/**
 * One journaled desktop step as the chat's Details lists it: the program and window it touched, the element's name for
 * an acting step, the risk the core set and what came of it.
 */
export const DesktopAction = z.object({
  id: z.uuid(),
  runId: z.uuid(),
  callId: z.string().min(1).max(200),
  kind: DesktopActionKind,
  program: z.string().max(120).nullable(),
  window: z.string().max(300).nullable(),
  target: z.string().max(300).nullable(),
  risk: DesktopRisk,
  outcome: DesktopOutcome,
  screenshotId: z.uuid().nullable(),
  /** How long a borrow held the real mouse and keyboard; null for every other step. */
  durationMs: z.number().int().nonnegative().nullable(),
  at: z.iso.datetime(),
}).strict();
export type DesktopAction = z.infer<typeof DesktopAction>;

/** A running window as the picker shows it; `never` programs are left out, `elevated` ones are shown as unreachable. */
export type DesktopWindowView = { title: string; program: string; elevated: boolean; minimized: boolean };
/** What the picker gets: whether desktop apps work on this computer at all, and the windows open now. */
export type DesktopWindowsView = { available: boolean; windows: DesktopWindowView[] };

/**
 * A consequential step waiting for the person in a solo chat: who wants to do what to which element in which window,
 * why the core asks, and a picture of the window with the element outlined when one could be kept. Every such step asks
 * again; there is no "always".
 */
export type DesktopApprovalView = {
  id: string;
  runId: string;
  /** The journal row of the step being asked about, so Details can show it as waiting. */
  actionId: string;
  workerName: string;
  kind: DesktopActKind | 'borrow';
  element: string;
  /** For a borrow: the steps it would take with the real mouse and keyboard, and the most time it may hold them. */
  borrow?: { steps: DesktopBorrowStep[]; limitSeconds: number };
  program: string;
  window: string;
  /** What would be entered, for a step that sets a value. */
  text?: string;
  /** Why the core asks, as short Vietnamese phrases the window translates. */
  reasons: string[];
  screenshotId?: string;
  requestedAt: string;
};

/** What the chat's window shows about the desktop right now: a step waiting for the person's answer. */
export type DesktopLive = { approval?: DesktopApprovalView };
