import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { writeAtomicText } from './files';
import { belongsToCopy, copyFolder, sameFolder, type EntryOwner, type InstallCopy } from './install-copy';

/**
 * Putting `orglet` on the Windows PATH (COD-234). A shim in a folder that does not change between updates points at
 * the current Orglet.exe and the CLI script inside the current `app-x.y.z` folder. The copy it points at rewrites it
 * on every start, so it follows Squirrel updates, and no other copy touches it unless the person chooses that copy
 * (COD-296). Only the user's own Path (HKCU) is edited, never the system one.
 */

const run = promisify(execFile);

export type ShimTarget = {
  /** `process.execPath` of the running app. */
  executable: string;
  /** The CLI script in the app's resources. */
  cliScript: string;
  /** The app's data folder, so the command talks to this copy of the app. */
  userData: string;
};

export const SHIM_NAME = 'orglet.cmd';

/**
 * Left in the data folder when the person chooses Remove from PATH (COD-235). Setup puts the command on PATH at every
 * install and update unless this file is there, so the choice holds across updates. Add to PATH deletes it.
 */
export const KEPT_OFF_PATH_FILE = 'cli-path-off';

export function isKeptOffPath(userData: string): boolean {
  return existsSync(join(userData, KEPT_OFF_PATH_FILE));
}

export async function keepOffPath(userData: string, keep: boolean): Promise<void> {
  const file = join(userData, KEPT_OFF_PATH_FILE);
  if (!keep) {
    await rm(file, { force: true });
    return;
  }
  await writeAtomicText(file, 'Remove from PATH was chosen in Orglet Settings. Delete this file or choose Add to PATH to undo.\n');
}

/** `%` starts a variable in a batch file, so a literal one in a path is doubled. */
function batchLiteral(value: string): string {
  return value.replaceAll('%', '%%');
}

/** Folders a path is written relative to, longest first so `%LOCALAPPDATA%` wins over `%USERPROFILE%`. */
const FOLDER_VARIABLES = ['LOCALAPPDATA', 'APPDATA', 'USERPROFILE'] as const;

/**
 * A path as a batch file should spell it. cmd reads a batch file in the console's code page, so a user name with
 * letters outside it would come out garbled; writing the start of the path as `%LOCALAPPDATA%` and friends keeps
 * the file plain ASCII in the usual case.
 */
export function batchPath(path: string, environment: NodeJS.ProcessEnv): string {
  for (const name of FOLDER_VARIABLES) {
    const folder = environment[name]?.replace(/[\\/]+$/, '');
    if (!folder) continue;
    const startsInside = path.toLowerCase().startsWith(`${folder.toLowerCase()}\\`);
    if (startsInside) return `%${name}%${batchLiteral(path.slice(folder.length))}`;
  }
  return batchLiteral(path);
}

export function shimContent(target: ShimTarget, environment: NodeJS.ProcessEnv = process.env): string {
  return [
    '@echo off',
    'rem Written by Orglet. The copy of Orglet it points at rewrites this file on every start, so it follows updates.',
    'setlocal',
    `set "ORGLET_USER_DATA=${batchPath(target.userData, environment)}"`,
    'set "ELECTRON_RUN_AS_NODE=1"',
    `"${batchPath(target.executable, environment)}" "${batchPath(target.cliScript, environment)}" %*`,
    'endlocal & exit /b %ERRORLEVEL%',
    '',
  ].join('\r\n');
}

/** A path from a batch file with `%LOCALAPPDATA%` and friends filled in and `%%` read as one `%`. */
function expandBatchPath(value: string, environment: NodeJS.ProcessEnv): string {
  return value.replace(/%%|%([A-Za-z_]+)%/g, (match, name: string | undefined) => {
    if (!name) return '%';
    const folder = environment[name]?.replace(/[\\/]+$/, '');
    return folder ?? match;
  });
}

/** Which Orglet.exe and data folder a shim starts, or undefined for a file Orglet did not write this way. */
export function shimTargetOf(content: string, environment: NodeJS.ProcessEnv = process.env): { executable: string; userData: string } | undefined {
  const userData = /^set "ORGLET_USER_DATA=(.*)"\r?$/m.exec(content)?.[1];
  const executable = /^"([^"]+)" "[^"]+" %\*\r?$/m.exec(content)?.[1];
  if (userData === undefined || executable === undefined) return undefined;
  return { executable: expandBatchPath(executable, environment), userData: expandBatchPath(userData, environment) };
}

/**
 * Whose shim it is. It is this copy's only when it starts this copy on this data folder; the same install started on
 * other data, as a test run does, is another copy, named by that data folder.
 */
export function shimOwner(content: string | undefined, copy: InstallCopy, userData: string, environment: NodeJS.ProcessEnv = process.env): EntryOwner {
  if (content === undefined) return { kind: 'none' };
  const target = shimTargetOf(content, environment);
  if (!target) return { kind: 'none' };
  if (!belongsToCopy(target.executable, copy)) return { kind: 'other', copy: copyFolder(target.executable) };
  if (!sameFolder(target.userData, userData)) return { kind: 'other', copy: target.userData };
  return { kind: 'this' };
}

/** The same folder written two ways (case, a trailing backslash) is one entry. */
function samePathEntry(first: string, second: string): boolean {
  const normalize = (entry: string) => entry.trim().replace(/[\\/]+$/, '').toLowerCase();
  return normalize(first) === normalize(second);
}

/** The Path value with `entry` appended, unless it is already there. Empty entries are dropped. */
export function pathWithEntry(current: string, entry: string): string {
  const entries = current.split(';').filter(item => item.trim() !== '');
  if (entries.some(item => samePathEntry(item, entry))) return entries.join(';');
  return [...entries, entry].join(';');
}

/** The Path value without `entry`, however it was spelled. */
export function pathWithoutEntry(current: string, entry: string): string {
  const entries = current.split(';').filter(item => item.trim() !== '');
  return entries.filter(item => !samePathEntry(item, entry)).join(';');
}

export function pathHasEntry(current: string, entry: string): boolean {
  return current.split(';').some(item => samePathEntry(item, entry));
}

/**
 * The raw user Path, with `%USERPROFILE%`-style references left unexpanded, so writing it back keeps them.
 * PowerShell is started with the value passed through the environment, never pasted into the script.
 */
async function readUserPath(): Promise<string> {
  const script = "$value = (Get-Item -LiteralPath 'HKCU:\\Environment').GetValue('Path', '', 'DoNotExpandEnvironmentNames'); [Console]::Out.Write($value)";
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
  return stdout;
}

/**
 * Writes the user Path with the registry type it already had (an expandable string when there was none). Setting
 * Path through `[Environment]::SetEnvironmentVariable` would store it as a plain string and break any `%VAR%` inside
 * an expandable one, so the registry is written directly and Explorer is told separately.
 */
async function writeUserPath(value: string): Promise<void> {
  const script = [
    "$key = Get-Item -LiteralPath 'HKCU:\\Environment'",
    "$kind = if ($key.GetValueNames() -contains 'Path') { $key.GetValueKind('Path') } else { 'ExpandString' }",
    "Set-ItemProperty -LiteralPath 'HKCU:\\Environment' -Name 'Path' -Value $env:ORGLET_USER_PATH -Type $kind",
  ].join('; ');
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, env: { ...process.env, ORGLET_USER_PATH: value } });
  announceEnvironmentChange();
}

/**
 * Tells Explorer the environment changed, so a terminal opened afterwards sees the new Path. Clearing a variable that
 * does not exist is enough to send the broadcast. Windows waits on every window that is slow to answer, which took
 * three to four seconds here (COD-235), so it runs in a process of its own and nobody waits: Setup gives an install
 * step only about fifteen seconds, and the Settings button should not hang either.
 */
function announceEnvironmentChange(): void {
  const script = "[Environment]::SetEnvironmentVariable('ORGLET_PATH_CHANGED', $null, 'User')";
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => undefined);
  child.unref();
}

export class CliPathInstaller {
  constructor(private readonly binDirectory: string, private readonly target: ShimTarget, private readonly copy: InstallCopy) {}

  get shimPath(): string {
    return join(this.binDirectory, SHIM_NAME);
  }

  isInstalled(): boolean {
    return existsSync(this.shimPath);
  }

  async owner(): Promise<EntryOwner> {
    const content = await this.readShim();
    return shimOwner(content, this.copy, this.target.userData);
  }

  async isOnPath(): Promise<boolean> {
    return pathHasEntry(await readUserPath(), this.binDirectory);
  }

  /** The person chose this copy, in Settings or by running its Setup: the command points here from now on. */
  async install(): Promise<void> {
    await this.writeShim();
    const current = await readUserPath();
    const next = pathWithEntry(current, this.binDirectory);
    if (next !== current) await writeUserPath(next);
  }

  /** An update's step: puts the command back, unless the person chose another copy for it. */
  async installUnlessTaken(): Promise<void> {
    const owner = await this.owner();
    if (owner.kind === 'other') return;
    await this.install();
  }

  async remove(): Promise<void> {
    await rm(this.shimPath, { force: true });
    const current = await readUserPath();
    const next = pathWithoutEntry(current, this.binDirectory);
    if (next !== current) await writeUserPath(next);
  }

  /** Uninstall's step: takes the command away, unless it points at another copy, which keeps it. */
  async removeUnlessTaken(): Promise<void> {
    const owner = await this.owner();
    if (owner.kind === 'other') return;
    await this.remove();
  }

  /** Called on every start: a shim that points at this copy is brought up to date, and anyone else's is left alone. */
  async refresh(): Promise<void> {
    const content = await this.readShim();
    const owner = shimOwner(content, this.copy, this.target.userData);
    if (owner.kind !== 'this') return;
    if (content !== shimContent(this.target)) await this.writeShim();
  }

  private async readShim(): Promise<string | undefined> {
    return readFile(this.shimPath, 'utf8').catch(() => undefined);
  }

  private async writeShim(): Promise<void> {
    await mkdir(this.binDirectory, { recursive: true });
    await writeAtomicText(this.shimPath, shimContent(this.target));
  }
}
