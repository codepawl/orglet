import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';

/**
 * What Setup asks of the app while it installs, updates or removes it (COD-235). Squirrel.Windows starts Orglet.exe
 * with one of these flags, waits a few seconds for it to exit, and shows no window in between. This replaces
 * `electron-squirrel-startup`, which quit as soon as Update.exe had made the shortcuts, so anything else the app had
 * to do at install time could be cut off halfway.
 */

export type SquirrelEvent = 'install' | 'updated' | 'uninstall' | 'obsolete';

const FLAGS: Record<string, SquirrelEvent> = {
  '--squirrel-install': 'install',
  '--squirrel-updated': 'updated',
  '--squirrel-uninstall': 'uninstall',
  '--squirrel-obsolete': 'obsolete',
};

/** Squirrel waits about fifteen seconds for a hook; finishing well inside that keeps Setup from killing the app. */
export const SQUIRREL_HOOK_MILLISECONDS = 10_000;

/** The event this start is for, or undefined for an ordinary start. Squirrel always passes it as the first argument. */
export function squirrelEventOf(argv: readonly string[], platform: NodeJS.Platform): SquirrelEvent | undefined {
  if (platform !== 'win32') return undefined;
  const flag = argv[1];
  if (!flag) return undefined;
  return FLAGS[flag];
}

export type SquirrelSteps = {
  createShortcuts: () => Promise<void>;
  removeShortcuts: () => Promise<void>;
  /** Puts the `orglet` command on the user PATH. */
  putOnPath: () => Promise<void>;
  /** Takes the `orglet` command off the user PATH again. */
  takeOffPath: () => Promise<void>;
  /** The person chose Remove from PATH, so an update must not put it back. */
  keptOffPath: () => boolean;
};

function stepsFor(event: SquirrelEvent, steps: SquirrelSteps): Promise<void>[] {
  if (event === 'install' || event === 'updated') {
    const onPath = steps.keptOffPath() ? [] : [steps.putOnPath()];
    return [steps.createShortcuts(), ...onPath];
  }
  if (event === 'uninstall') return [steps.removeShortcuts(), steps.takeOffPath()];
  return [];
}

function waitAtMost(milliseconds: number): Promise<void> {
  return new Promise(resolveWait => setTimeout(resolveWait, milliseconds).unref());
}

/**
 * Runs what the event needs, side by side, and returns once all of it has settled or the time is up. A step that
 * fails does not stop the others: a missing PATH entry must never cost someone their Start menu shortcut.
 */
export async function runSquirrelEvent(event: SquirrelEvent, steps: SquirrelSteps, timeoutMilliseconds = SQUIRREL_HOOK_MILLISECONDS): Promise<void> {
  const work = Promise.allSettled(stepsFor(event, steps));
  await Promise.race([work, waitAtMost(timeoutMilliseconds)]);
}

/** Update.exe sits one folder above the `app-x.y.z` folder the running Orglet.exe is in. */
export function runUpdateExecutable(executable: string, argumentList: readonly string[]): Promise<void> {
  const updateExecutable = resolve(dirname(executable), '..', 'Update.exe');
  return new Promise(resolveRun => {
    const child = spawn(updateExecutable, [...argumentList], { detached: true, windowsHide: true });
    child.on('close', () => resolveRun());
    child.on('error', () => resolveRun());
  });
}
