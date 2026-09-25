import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isKeptOffPath, keepOffPath } from '../../apps/desktop/src/main/cli-path';
import { runSquirrelEvent, squirrelEventOf, type SquirrelSteps } from '../../apps/desktop/src/main/squirrel-events';

// COD-235: Setup puts `orglet` on the user PATH at install and update, takes it off at uninstall, and leaves it off
// once the person chose Remove from PATH.

function recordingSteps(options: { keptOff?: boolean; failPath?: boolean; slowPath?: boolean } = {}) {
  const calls: string[] = [];
  const step = (name: string) => async () => {
    calls.push(name);
  };
  const steps: SquirrelSteps = {
    createShortcuts: step('createShortcuts'),
    removeShortcuts: step('removeShortcuts'),
    putOnPath: async () => {
      calls.push('putOnPath');
      if (options.slowPath) await new Promise(() => undefined);
      if (options.failPath) throw new Error('registry refused');
    },
    takeOffPath: step('takeOffPath'),
    keptOffPath: () => Boolean(options.keptOff),
  };
  return { calls, steps };
}

describe('Squirrel events', () => {
  it('reads the flag Setup passes first, on Windows only', () => {
    expect(squirrelEventOf(['Orglet.exe', '--squirrel-install', '0.3.1'], 'win32')).toBe('install');
    expect(squirrelEventOf(['Orglet.exe', '--squirrel-updated', '0.3.1'], 'win32')).toBe('updated');
    expect(squirrelEventOf(['Orglet.exe', '--squirrel-uninstall', '0.3.1'], 'win32')).toBe('uninstall');
    expect(squirrelEventOf(['Orglet.exe', '--squirrel-obsolete', '0.3.0'], 'win32')).toBe('obsolete');
    expect(squirrelEventOf(['Orglet.exe', '--squirrel-firstrun'], 'win32')).toBeUndefined();
    expect(squirrelEventOf(['Orglet.exe'], 'win32')).toBeUndefined();
    expect(squirrelEventOf(['Orglet', '--squirrel-install'], 'darwin')).toBeUndefined();
  });

  it('makes the shortcuts and puts the command on PATH at install and update', async () => {
    for (const event of ['install', 'updated'] as const) {
      const { calls, steps } = recordingSteps();
      await runSquirrelEvent(event, steps);
      expect(calls.sort()).toEqual(['createShortcuts', 'putOnPath']);
    }
  });

  it('leaves PATH alone at install and update once the person took the command off it', async () => {
    const { calls, steps } = recordingSteps({ keptOff: true });
    await runSquirrelEvent('updated', steps);
    expect(calls).toEqual(['createShortcuts']);
  });

  it('removes the shortcuts and the PATH entry at uninstall, whatever the choice was', async () => {
    const { calls, steps } = recordingSteps({ keptOff: true });
    await runSquirrelEvent('uninstall', steps);
    expect(calls.sort()).toEqual(['removeShortcuts', 'takeOffPath']);
  });

  it('does nothing for an obsolete copy', async () => {
    const { calls, steps } = recordingSteps();
    await runSquirrelEvent('obsolete', steps);
    expect(calls).toEqual([]);
  });

  it('still finishes when the PATH step fails or hangs', async () => {
    const failing = recordingSteps({ failPath: true });
    await expect(runSquirrelEvent('install', failing.steps)).resolves.toBeUndefined();
    expect(failing.calls).toContain('createShortcuts');
    const hanging = recordingSteps({ slowPath: true });
    const started = Date.now();
    await runSquirrelEvent('install', hanging.steps, 50);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(hanging.calls).toContain('createShortcuts');
  });
});

describe('the Remove from PATH choice', () => {
  let folder: string | undefined;
  afterEach(() => {
    if (folder) rmSync(folder, { recursive: true, force: true });
    folder = undefined;
  });

  it('is kept in the data folder and undone by Add to PATH', async () => {
    folder = mkdtempSync(join(tmpdir(), 'orglet-path-choice-'));
    expect(isKeptOffPath(folder)).toBe(false);
    await keepOffPath(folder, true);
    expect(isKeptOffPath(folder)).toBe(true);
    await keepOffPath(folder, true);
    expect(isKeptOffPath(folder)).toBe(true);
    await keepOffPath(folder, false);
    expect(isKeptOffPath(folder)).toBe(false);
    await keepOffPath(folder, false);
    expect(isKeptOffPath(folder)).toBe(false);
  });
});
