import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { DesktopHelperProcess, powershellPath } from '../../apps/desktop/src/core/tools/desktop-helper';
import { DesktopActResult, DesktopInspectResult, DesktopScreenshotResult, DesktopSnapshotResult, DesktopWindowsResult, type HostWindow } from '../../apps/desktop/src/shared/desktop-host';

/**
 * The real desktop helper against a real window (COD-261, phase 2a): a small WinForms window this test starts
 * (`tests/fixtures/desktop/test-window.ps1`, which opens without taking the foreground and closes itself), read and used
 * through UI Automation. It needs a Windows desktop session, so it runs only with ORGLET_DESKTOP_TEST=1; CI's runners
 * have no interactive desktop.
 *
 *   $env:ORGLET_DESKTOP_TEST='1'; node node_modules/vitest/vitest.mjs run tests/integration/desktop-helper.test.ts
 */
const enabled = process.platform === 'win32' && process.env.ORGLET_DESKTOP_TEST === '1';
const TITLE = `Orglet desktop test ${process.pid}`;
const signal = () => AbortSignal.timeout(40_000);

let fixture: ChildProcess | undefined;
let helper: DesktopHelperProcess;
let window: HostWindow;
let allow: string[];

function refOf(snapshot: string, pattern: RegExp): string {
  const line = snapshot.split('\n').find(candidate => pattern.test(candidate));
  const ref = line?.match(/\[ref=(e\d+)\]/)?.[1];
  if (!ref) throw new Error(`No ref for ${pattern} in:\n${snapshot}`);
  return ref;
}

async function act(runId: string, ref: string, step: { kind: 'invoke' | 'set_value' | 'toggle' | 'select'; text?: string }) {
  const inspected = DesktopInspectResult.parse(await helper.request({ kind: 'inspect', runId, handle: window.handle, allow, ref }, signal()));
  if ('problem' in inspected || !inspected.target) throw new Error(`Cannot inspect ${ref}`);
  return DesktopActResult.parse(await helper.request({
    kind: 'act', runId, handle: window.handle, allow, ref, step, expect: { name: inspected.target.name, controlType: inspected.target.controlType },
  }, signal()));
}

describe.runIf(enabled)('the desktop helper on a real window', { timeout: 90_000 }, () => {
  beforeAll(async () => {
    fixture = spawn(powershellPath(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(__dirname, '../fixtures/desktop/test-window.ps1'), '-Seconds', '80', '-Title', TITLE], { stdio: 'ignore', windowsHide: false });
    helper = new DesktopHelperProcess(5_000);
    for (let attempt = 0; attempt < 60; attempt++) {
      const listed = DesktopWindowsResult.parse(await helper.request({ kind: 'windows' }, signal()));
      const found = listed.windows.find(candidate => candidate.title === TITLE);
      if (found) {
        window = found;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    expect(window).toBeDefined();
    allow = [window.executable];
  }, 60_000);

  afterAll(() => {
    helper?.stop();
    fixture?.kill();
  });

  it('reads the window as a tree with refs, and acts through patterns without moving the cursor or the foreground', async () => {
    expect(window).toMatchObject({ executable: 'powershell.exe', elevated: false, minimized: false });
    const snapshot = DesktopSnapshotResult.parse(await helper.request({ kind: 'snapshot', runId: 'run-a', handle: window.handle, allow }, signal()));
    if ('problem' in snapshot) throw new Error(snapshot.problem);
    expect(snapshot.snapshot).toMatch(/^- window "Orglet desktop test/);
    expect(snapshot.snapshot).toMatch(/edit "Note" \[ref=e\d+\] actions=set_value/);
    expect(snapshot.snapshot).toMatch(/edit "Password" \[ref=e\d+\] \[password\]/);
    expect(snapshot.snapshot).toMatch(/button "Save" \[ref=e\d+\] actions=invoke/);

    const typed = await act('run-a', refOf(snapshot.snapshot, /edit "Note"/), { kind: 'set_value', text: 'hello from orglet' });
    expect(typed).toMatchObject({ done: true, pending: false, state: { value: 'hello from orglet' }, cursorMoved: false, foregroundChanged: false });
    const toggled = await act('run-a', refOf(snapshot.snapshot, /check box "Wrap lines"/), { kind: 'toggle' });
    expect(toggled).toMatchObject({ done: true, state: { toggle: 'on' }, cursorMoved: false, foregroundChanged: false });
    const picked = await act('run-a', refOf(snapshot.snapshot, /list item "High"/), { kind: 'select' });
    expect(picked).toMatchObject({ done: true, state: { selected: true }, cursorMoved: false, foregroundChanged: false });
    const saved = await act('run-a', refOf(snapshot.snapshot, /button "Save"/), { kind: 'invoke' });
    expect(saved).toMatchObject({ done: true, pending: false, cursorMoved: false, foregroundChanged: false });

    const after = DesktopSnapshotResult.parse(await helper.request({ kind: 'snapshot', runId: 'run-a', handle: window.handle, allow }, signal()));
    if ('problem' in after) throw new Error(after.problem);
    expect(after.snapshot).toContain('text "Status: saved hello from orglet"');
    expect(after.snapshot).toMatch(/check box "Wrap lines" \[ref=e\d+\] \[checked\]/);
  });

  it('refuses a password field, a program the chat did not grant, a ref from another run, and an element that changed', async () => {
    const snapshot = DesktopSnapshotResult.parse(await helper.request({ kind: 'snapshot', runId: 'run-b', handle: window.handle, allow }, signal()));
    if ('problem' in snapshot) throw new Error(snapshot.problem);
    const password = refOf(snapshot.snapshot, /edit "Password"/);
    const inspected = DesktopInspectResult.parse(await helper.request({ kind: 'inspect', runId: 'run-b', handle: window.handle, allow, ref: password }, signal()));
    expect(inspected).toMatchObject({ target: { name: 'Password', password: true } });
    expect(await act('run-b', password, { kind: 'set_value', text: 'secret' })).toEqual({ problem: 'password' });

    expect(await helper.request({ kind: 'snapshot', runId: 'run-b', handle: window.handle, allow: ['notepad.exe'] }, signal())).toEqual({ problem: 'not_granted' });
    const save = refOf(snapshot.snapshot, /button "Save"/);
    expect(DesktopInspectResult.parse(await helper.request({ kind: 'inspect', runId: 'run-never-read', handle: window.handle, allow, ref: save }, signal()))).toMatchObject({ target: null });
    expect(await helper.request({ kind: 'act', runId: 'run-b', handle: window.handle, allow, ref: save, step: { kind: 'invoke' }, expect: { name: 'Delete', controlType: 'button' } }, signal()))
      .toEqual({ problem: 'stale' });
    // A label has no pattern for pressing: not possible in the background, never a click with the real mouse.
    const label = refOf(snapshot.snapshot, /text "Status/);
    expect(await act('run-b', label, { kind: 'invoke' })).toEqual({ problem: 'not_possible' });
    expect(await helper.request({ kind: 'snapshot', runId: 'run-b', handle: 1, allow }, signal())).toEqual({ problem: 'window_gone' });
  });

  it('pictures the window without bringing it forward, with the asked element outlined', async () => {
    const snapshot = DesktopSnapshotResult.parse(await helper.request({ kind: 'snapshot', runId: 'run-c', handle: window.handle, allow }, signal()));
    if ('problem' in snapshot) throw new Error(snapshot.problem);
    const shot = DesktopScreenshotResult.parse(await helper.request({ kind: 'screenshot', runId: 'run-c', handle: window.handle, allow, highlight: refOf(snapshot.snapshot, /button "Delete"/) }, signal()));
    if ('problem' in shot) throw new Error(shot.problem);
    expect(shot.width).toBeGreaterThan(200);
    expect(Buffer.from(shot.png, 'base64').subarray(1, 4).toString('ascii')).toBe('PNG');
  });
});
