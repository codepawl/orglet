import { z } from 'zod';
import type { DesktopActKind } from './desktop';

/**
 * What the core asks the desktop helper (COD-261, phase 2a) and what comes back. The helper is a Windows PowerShell 5.1
 * process running `core/tools/desktop-host.ps1`; every request names the run, the window by its handle, and the
 * programs the chat may reach, which the helper checks again against the window's process before it reads or acts.
 */
export type DesktopHostRequest =
  | { kind: 'windows' }
  | { kind: 'snapshot'; runId: string; handle: number; allow: string[] }
  | { kind: 'inspect'; runId: string; handle: number; allow: string[]; ref: string }
  | { kind: 'act'; runId: string; handle: number; allow: string[]; ref: string; step: { kind: DesktopActKind; text?: string }; expect: { name: string; controlType: string } }
  | { kind: 'screenshot'; runId: string; handle: number; allow: string[]; highlight?: string }
  | { kind: 'forget'; runId: string };

/** The helper, as the core sees it. `available` is false where there is no helper (macOS, Linux, tests without one). */
export type DesktopHost = { request(request: DesktopHostRequest, signal: AbortSignal): Promise<unknown> };

/**
 * Why the helper did not read or act: the window closed, its program is not granted, it runs as administrator (UI
 * Automation cannot reach it from a normal process), it is minimized (for a picture), the step cannot be done in the
 * background, the ref is out of date, it is a password field, or the element is disabled.
 */
export const DesktopProblem = z.enum(['window_gone', 'not_granted', 'elevated', 'minimized', 'not_possible', 'stale', 'password', 'disabled']);
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
