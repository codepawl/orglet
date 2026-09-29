import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DesktopOverlayDirector, type OverlayTarget } from '../../apps/desktop/src/core/tools/desktop-overlay';
import {
  appName, DesktopOverlayState, OVERLAY_FOLLOW_MS, OVERLAY_LINGER_MS, overlayLayout, peekInset, pointInFrame, type OverlayRect,
} from '../../apps/desktop/src/shared/desktop-overlay';

/**
 * When the desktop glow shows and where (COD-261): the core's decisions, with fake timers and a fake window, and the
 * layout main applies. The window itself is drawn by main and checked on screen.
 */

const frame: OverlayRect = { x: 100, y: 80, width: 640, height: 480 };
const worker = { id: 'worker-1', name: 'Researcher', avatar: { mascot: 'classic', color: '#8a7bd8' } };
const target = (runId = 'run-1', taskId = 'task-1'): OverlayTarget => ({ runId, taskId, worker, handle: 101, program: 'notepad.exe', allow: () => ['notepad.exe'] });

let states: DesktopOverlayState[];
let where: OverlayRect | undefined;
let director: DesktopOverlayDirector;

beforeEach(() => {
  vi.useFakeTimers();
  states = [];
  where = { ...frame };
  director = new DesktopOverlayDirector(state => { states.push(state); }, async () => where && { ...where }, () => ({ accent: '#e0567a', theme: 'dark', language: 'en' }));
});

afterEach(() => {
  vi.useRealTimers();
});

/** Lets the frame read that `begin` and the follow timer wait on settle. */
const settle = () => vi.advanceTimersByTimeAsync(0);

describe('the desktop glow', () => {
  it('frames the window while a step acts, with the cursor on the element, and lingers a moment after the last step', async () => {
    await director.begin(target(), 'window', { x: 300, y: 200, action: 'press' });
    expect(director.current).toEqual({
      visible: true, mode: 'window', taskId: 'task-1', runId: 'run-1', worker, app: 'Notepad', frame, cursor: { x: 300, y: 200, action: 'press', sequence: 1 },
      accent: '#e0567a', theme: 'dark', language: 'en',
    });
    expect(DesktopOverlayState.safeParse(director.current).success).toBe(true);
    director.end('run-1');
    await vi.advanceTimersByTimeAsync(OVERLAY_LINGER_MS - 1);
    expect(director.current.visible).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(director.current).toEqual({ visible: false });
    expect(states.at(-1)).toEqual({ visible: false });
  });

  it('stays on through quick steps instead of flickering, and a second press plays again', async () => {
    await director.begin(target(), 'window', { x: 300, y: 200, action: 'press' });
    director.end('run-1');
    await vi.advanceTimersByTimeAsync(OVERLAY_LINGER_MS / 2);
    await director.begin(target(), 'window', { x: 300, y: 200, action: 'press' });
    await vi.advanceTimersByTimeAsync(OVERLAY_LINGER_MS);
    expect(director.current).toMatchObject({ visible: true, cursor: { sequence: 2 } });
    expect(states.every(state => state.visible)).toBe(true);
    director.end('run-1');
    await vi.advanceTimersByTimeAsync(OVERLAY_LINGER_MS);
    expect(director.current.visible).toBe(false);
  });

  it('frames the display while it borrows, with no cursor of its own, then goes back to the window', async () => {
    await director.begin(target(), 'window', { x: 300, y: 200, action: 'type' });
    director.end('run-1');
    await director.begin(target(), 'borrow');
    expect(director.current).toMatchObject({ visible: true, mode: 'borrow' });
    expect('cursor' in director.current && director.current.cursor).toBeFalsy();
    director.end('run-1');
    expect(director.current).toMatchObject({ visible: true, mode: 'window' });
    await vi.advanceTimersByTimeAsync(OVERLAY_LINGER_MS);
    expect(director.current.visible).toBe(false);
  });

  it('goes at once when its run stops, and a stop for another run leaves it', async () => {
    await director.begin(target(), 'window');
    director.stop('run-2');
    expect(director.current.visible).toBe(true);
    director.stop('run-1');
    expect(director.current).toEqual({ visible: false });
    // No linger timer is left to fire later.
    await vi.advanceTimersByTimeAsync(OVERLAY_LINGER_MS * 2);
    expect(states.filter(state => !state.visible)).toHaveLength(1);
  });

  it('follows a window being moved, and goes when the window closes or is minimized', async () => {
    await director.begin(target(), 'window');
    const shown = states.length;
    await vi.advanceTimersByTimeAsync(OVERLAY_FOLLOW_MS);
    // Nothing moved, so nothing new was sent.
    expect(states).toHaveLength(shown);
    where = { ...frame, x: 400 };
    await vi.advanceTimersByTimeAsync(OVERLAY_FOLLOW_MS);
    expect(director.current).toMatchObject({ visible: true, frame: { x: 400 } });
    where = undefined;
    await vi.advanceTimersByTimeAsync(OVERLAY_FOLLOW_MS);
    expect(director.current).toEqual({ visible: false });
  });

  it('says the glow is on screen only when whatever draws it confirms', async () => {
    expect(await director.begin(target(), 'borrow')).toBe(false);
    const confirming = new DesktopOverlayDirector(async () => true, async () => ({ ...frame }), () => ({ theme: 'light', language: 'vi' }));
    expect(await confirming.begin(target(), 'borrow')).toBe(true);
    const unframed = new DesktopOverlayDirector(async () => true, async () => undefined, () => ({ theme: 'light', language: 'vi' }));
    expect(await unframed.begin(target(), 'borrow')).toBe(false);
  });

  it('shows nothing for a window it cannot frame, and moves to another run that starts acting', async () => {
    where = undefined;
    await director.begin(target(), 'window');
    expect(states).toEqual([]);
    where = { ...frame };
    await director.begin(target('run-2', 'task-2'), 'window');
    await settle();
    expect(director.current).toMatchObject({ visible: true, runId: 'run-2', taskId: 'task-2' });
    // The first run ending no longer touches the glow of the second.
    director.stop('run-1');
    director.end('run-1');
    await vi.advanceTimersByTimeAsync(OVERLAY_LINGER_MS);
    expect(director.current.visible).toBe(true);
  });
});

describe('where the glow window goes', () => {
  const display = { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };

  it('covers the window, or the whole display while borrowing, on whole pixels', () => {
    expect(overlayLayout('window', { x: 100.4, y: 80.6, width: 640.2, height: 480 }, display)).toEqual({ bounds: { x: 100, y: 81, width: 641, height: 480 }, peekTop: 0 });
    expect(overlayLayout('borrow', frame, display)).toEqual({ bounds: display.bounds, peekTop: 0 });
    // A second display to the left, at 150 %: the display's own units come from main, the layout only rounds them.
    const left = { bounds: { x: -1280, y: 0, width: 1280, height: 720 }, workArea: { x: -1280, y: 0, width: 1280, height: 680 } };
    expect(overlayLayout('borrow', { x: -900, y: 100, width: 400, height: 300 }, left).bounds).toEqual(left.bounds);
  });

  it('keeps the peek on screen when the window reaches above the top of the display', () => {
    expect(peekInset({ x: 0, y: -30, width: 800, height: 600 }, display.workArea)).toBe(30);
    expect(overlayLayout('window', { x: 0, y: -30, width: 800, height: 600 }, display).peekTop).toBe(30);
    // Never past the window's own bottom.
    expect(peekInset({ x: 0, y: -900, width: 800, height: 600 }, display.workArea)).toBe(599);
    // A taskbar at the top pushes the work area down.
    expect(peekInset({ x: 0, y: 10, width: 800, height: 600 }, { x: 0, y: 48, width: 1920, height: 1032 })).toBe(38);
  });

  it('names the app and moves points into the frame', () => {
    expect(appName('notepad.exe')).toBe('Notepad');
    expect(appName('WINWORD.EXE')).toBe('WINWORD');
    expect(appName('.exe')).toBe('.exe');
    expect(pointInFrame({ x: 300.6, y: 200.2 }, { x: 100, y: 80 })).toEqual({ x: 201, y: 120 });
  });
});
