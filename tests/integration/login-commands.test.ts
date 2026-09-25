import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loginCommand, loginCommandFor, loginCommands, type LoginShell } from '../../apps/desktop/src/shared/harness';

// COD-230: the login line for each terminal. The shapes are checked as text everywhere; on Windows every form is also
// run in its real shell against a fake CLI whose path and account folder have spaces in them, and the test reads
// back what reached the CLI: the config folder and the arguments.

describe('login lines as text', () => {
  const executable = 'C:\\Users\\An Nguyen\\AppData\\Roaming\\npm\\claude.cmd';
  const folder = 'C:\\Users\\An Nguyen\\AppData\\Roaming\\Orglet\\harness-accounts\\claude-code\\work';

  it('writes one line per Windows terminal, PowerShell first', () => {
    expect(loginCommands('claude-code', executable, 'win32', folder)).toEqual([
      { shell: 'powershell', command: `$env:CLAUDE_CONFIG_DIR = "${folder}"; & "${executable}" auth login` },
      { shell: 'cmd', command: `set "CLAUDE_CONFIG_DIR=${folder}" && "${executable}" auth login` },
      { shell: 'bash', command: `CLAUDE_CONFIG_DIR='${folder}' '/c/Users/An Nguyen/AppData/Roaming/npm/claude.cmd' auth login` },
    ]);
    expect(loginCommand('claude-code', executable, 'win32', folder)).toBe(loginCommands('claude-code', executable, 'win32', folder)[0].command);
  });

  it('keeps the default account free of a variable, and names the bare command when nothing is installed', () => {
    expect(loginCommandFor('cmd', 'codex', 'D:\\Tools\\codex.exe')).toBe('"D:\\Tools\\codex.exe" login');
    expect(loginCommandFor('bash', 'codex', 'D:\\Tools\\codex.exe')).toBe(`'/d/Tools/codex.exe' login`);
    expect(loginCommands('cursor', undefined, 'win32').map(item => item.command)).toEqual(['agent login', 'agent login', 'agent login']);
  });

  it('gives macOS and Linux one POSIX line', () => {
    expect(loginCommands('claude-code', '/Users/an/.local/bin/claude', 'darwin', '/Users/an/Library/Orglet/a b')).toEqual([
      { shell: 'sh', command: 'CLAUDE_CONFIG_DIR="/Users/an/Library/Orglet/a b" /Users/an/.local/bin/claude auth login' },
    ]);
  });

  it('starts Gemini CLI bare, since it signs in from its own menu, with no trailing space', () => {
    const gemini = 'C:\\Users\\An Nguyen\\AppData\\Roaming\\npm\\gemini.cmd';
    const account = 'C:\\Users\\An Nguyen\\AppData\\Roaming\\Orglet\\harness-accounts\\gemini\\work';
    expect(loginCommands('gemini', gemini, 'win32', account)).toEqual([
      { shell: 'powershell', command: `$env:GEMINI_CLI_HOME = "${account}"; & "${gemini}"` },
      { shell: 'cmd', command: `set "GEMINI_CLI_HOME=${account}" && "${gemini}"` },
      { shell: 'bash', command: `GEMINI_CLI_HOME='${account}' '/c/Users/An Nguyen/AppData/Roaming/npm/gemini.cmd'` },
    ]);
    expect(loginCommands('gemini', undefined, 'darwin')).toEqual([{ shell: 'sh', command: 'gemini' }]);
  });

  it('quotes a single quote inside a Git Bash path', () => {
    expect(loginCommandFor('bash', 'claude-code', "C:\\Users\\O'Brien\\claude.exe")).toBe(`'/c/Users/O'\\''Brien/claude.exe' auth login`);
  });
});

const windows = process.platform === 'win32';
const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe';
/** A shell only counts as present when it can actually be started; runners differ. */
function available(file: string, args: string[]): boolean {
  try { execFileSync(file, args, { stdio: 'ignore', windowsHide: true, timeout: 20_000 }); return true; } catch { return false; }
}

describe.runIf(windows)('login lines run in their real shells', () => {
  let directory: string;
  let executable: string;
  let folder: string;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'orglet login shells '));
    executable = join(directory, 'npm bin', 'claude.cmd');
    folder = join(directory, 'harness accounts', 'work one');
    await mkdir(join(directory, 'npm bin'), { recursive: true });
    await mkdir(folder, { recursive: true });
    // What the real npm shim would receive: the variable the line set and the arguments after the program.
    await writeFile(executable, '@echo off\r\necho CONFIG=[%CLAUDE_CONFIG_DIR%] ARGS=[%*]\r\n');
  });
  afterAll(async () => { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

  const expected = () => `CONFIG=[${folder}] ARGS=[auth login]`;
  const line = (shell: LoginShell) => loginCommandFor(shell, 'claude-code', executable, folder);

  it.runIf(windows && available('pwsh', ['-NoProfile', '-Command', 'exit 0']))('PowerShell 7', () => {
    expect(execFileSync('pwsh', ['-NoProfile', '-Command', line('powershell')], { encoding: 'utf8', windowsHide: true }).trim()).toBe(expected());
  });

  it.runIf(windows && available('powershell.exe', ['-NoProfile', '-Command', 'exit 0']))('Windows PowerShell 5.1', () => {
    expect(execFileSync('powershell.exe', ['-NoProfile', '-Command', line('powershell')], { encoding: 'utf8', windowsHide: true }).trim()).toBe(expected());
  });

  it.runIf(windows)('Command Prompt', async () => {
    // A batch file holds the line exactly as it is pasted, without a second layer of command-line quoting.
    const batch = join(directory, 'paste.bat');
    await writeFile(batch, `@echo off\r\n${line('cmd')}\r\n`);
    expect(execFileSync('cmd.exe', ['/d', '/c', batch], { encoding: 'utf8', windowsHide: true }).trim()).toBe(expected());
  });

  it.runIf(windows && existsSync(gitBash))('Git Bash', () => {
    expect(execFileSync(gitBash, ['-c', line('bash')], { encoding: 'utf8', windowsHide: true }).trim()).toBe(expected());
  });
});
