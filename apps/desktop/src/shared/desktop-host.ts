import { z } from 'zod';
import type { DesktopActKind, DesktopBorrowStep } from './desktop';

/**
 * What the core asks the desktop helper (COD-261, phase 2a) and what comes back. The helper is a Windows PowerShell 5.1
 * process running `core/tools/desktop-host.ps1`; every request names the run, the window by its handle, and the
 * programs the chat may reach, which the helper checks again against the window's process before it reads or acts.
 *
 * Phase 2b adds borrowing the real mouse and keyboard: `borrow_check` looks at everything a borrow needs without
 * sending any input, `borrow` carries out the steps the person allowed within `limitMs`, and `borrow_stop` ends the one
 * running now, for a run that is stopped. `indicator` is the notice shown on screen while it runs, in the app's language.
 */
export type DesktopHostRequest =
  | { kind: 'windows' }
  | { kind: 'snapshot'; runId: string; handle: number; allow: string[] }
  | { kind: 'inspect'; runId: string; handle: number; allow: string[]; ref: string }
  | { kind: 'act'; runId: string; handle: number; allow: string[]; ref: string; step: { kind: DesktopActKind; text?: string }; expect: { name: string; controlType: string } }
  | { kind: 'screenshot'; runId: string; handle: number; allow: string[]; highlight?: string }
  | { kind: 'bounds'; handle: number; allow: string[] }
  | { kind: 'borrow_check'; runId: string; handle: number; allow: string[]; ref: string; expect: { name: string; controlType: string } }
  | { kind: 'borrow'; runId: string; handle: number; allow: string[]; ref: string; expect: { name: string; controlType: string }; steps: DesktopBorrowStep[]; limitMs: number; indicator: string }
  | { kind: 'borrow_stop' }
  | { kind: 'forget'; runId: string };

/** The helper, as the core sees it. `available` is false where there is no helper (macOS, Linux, tests without one). */
export type DesktopHost = { request(request: DesktopHostRequest, signal: AbortSignal): Promise<unknown> };

/**
 * Why the helper did not read or act: the window closed, its program is not granted, it runs as administrator (UI
 * Automation cannot reach it from a normal process), it is minimized (for a picture), the step cannot be done in the
 * background, the ref is out of date, it is a password field, or the element is disabled. For a borrow also: Windows
 * shows its secure desktop (an administrator prompt, the lock or sign-in screen), the element is not on screen where
 * the mouse could reach it, or another borrow is running.
 */
export const DesktopProblem = z.enum(['window_gone', 'not_granted', 'elevated', 'minimized', 'not_possible', 'stale', 'password', 'disabled', 'secure_desktop', 'off_screen', 'busy']);
export type DesktopProblem = z.infer<typeof DesktopProblem>;
const ProblemResult = z.object({ problem: DesktopProblem }).strict();

export const HostWindow = z.object({
  handle: z.number().int().nonnegative(),
  title: z.string().max(2000),
  className: z.string().max(400),
  processId: z.number().int().nonnegative(),
  executable: z.string().max(400),
  minimized: z.boolean(),
  elevated: z.boolean(),
}).strict();
export type HostWindow = z.infer<typeof HostWindow>;

export const DesktopWindowsResult = z.object({ windows: z.array(HostWindow).max(2000) }).strict();
export const DesktopSnapshotResult = z.union([ProblemResult, HostWindow.extend({ snapshot: z.string(), elements: z.number().int(), truncated: z.boolean() }).strict()]);

/** What the helper reads about one element, live, for the core to judge a step on it. */
export const DesktopTargetFacts = z.object({
  ref: z.string().max(20),
  name: z.string().max(4000),
  controlType: z.string().max(80),
  automationId: z.string().max(400),
  className: z.string().max(400),
  enabled: z.boolean(),
  password: z.boolean(),
  actions: z.array(z.string().max(40)).max(10),
  inDialog: z.boolean(),
  defaultButton: z.boolean(),
  windowName: z.string().max(2000),
  /** Where the element is on screen, in physical pixels: the orglet's cursor on the glow goes to its middle. */
  box: z.object({ x: z.number().int(), y: z.number().int(), width: z.number().int(), height: z.number().int() }).strict().nullable().optional(),
}).strict();
export type DesktopTargetFacts = z.infer<typeof DesktopTargetFacts>;
export const DesktopInspectResult = z.union([ProblemResult, HostWindow.extend({ target: DesktopTargetFacts.nullable() }).strict()]);

export const DesktopActResult = z.union([ProblemResult, z.object({
  done: z.literal(true),
  /** The call was still running after five seconds: a button that opened a modal dialog, or an app that is busy. */
  pending: z.boolean(),
  state: z.record(z.string(), z.union([z.string(), z.boolean()])),
  /** Measured around the call: whether the real cursor moved and whether the foreground window changed. */
  cursorMoved: z.boolean(),
  foregroundChanged: z.boolean(),
  title: z.string().max(2000),
}).strict()]);
export type DesktopActResult = z.infer<typeof DesktopActResult>;

export const DesktopScreenshotResult = z.union([ProblemResult, HostWindow.extend({ png: z.string(), width: z.number().int(), height: z.number().int() }).strict()]);

/** Where a granted window's visible frame is now, for the glow around it (COD-261). */
export const DesktopBoundsResult = z.union([ProblemResult, z.object({ bounds: z.object({ x: z.number().int(), y: z.number().int(), width: z.number().int().positive(), height: z.number().int().positive() }).strict() }).strict()]);

/** A borrow could be done now: the element's point on screen, which the mouse would use. */
export const DesktopBorrowCheckResult = z.union([ProblemResult, HostWindow.extend({ point: z.object({ x: z.number().int(), y: z.number().int() }).strict() }).strict()]);

/**
 * Why a borrow ended before its last step: the person moved the mouse or pressed a key of their own (`person_mouse`,
 * `person_key`) or pressed Escape, the time limit ran out, another window came to the front or the keyboard focus left
 * the element, the window could not be brought to the front, or the run was stopped.
 */
export const BorrowStop = z.enum(['person_mouse', 'person_key', 'escape', 'time_limit', 'foreground_changed', 'focus_changed', 'no_foreground', 'run_stopped']);
export type BorrowStop = z.infer<typeof BorrowStop>;

export const DesktopBorrowResult = z.union([ProblemResult, z.object({
  completedSteps: z.number().int().nonnegative(),
  stoppedBy: BorrowStop.nullable(),
  /** From bringing the window forward to giving everything back. */
  durationMs: z.number().int().nonnegative(),
  /** From the person's own input to the last input Orglet sent, measured by the helper; null when nobody interrupted. */
  stopLatencyMs: z.number().int().nonnegative().nullable(),
  /** Whether the window the person had in front and the cursor were put back as they were. */
  restored: z.object({ foreground: z.boolean(), cursor: z.boolean() }).strict(),
  title: z.string().max(2000),
}).strict()]);
export type DesktopBorrowResult = z.infer<typeof DesktopBorrowResult>;
