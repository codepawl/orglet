import { execFile } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { harnessNames, type HarnessId, type HarnessInfo } from '../../shared/harness';

export type Probe = (executable: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

const isFile = async (path: string) => { try { return (await stat(path)).isFile(); } catch { return false; } };
const children = async (path: string) => { try { return await readdir(path); } catch { return []; } };
// Version folders such as 2.1.270; newest first. Non-numeric parts sort as zero.
const byVersionDesc = (a: string, b: string) => {
  const parts = (value: string) => value.split(/[^0-9]+/).filter(Boolean).map(Number);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
  return 0;
};

const commandName = (id: HarnessId) => id === 'claude-code' ? 'claude' : id === 'codex' ? 'codex' : 'agent';

/** Ordered, de-duplicated install locations for one harness on this OS. Only existing files are returned. */
export async function candidates(id: HarnessId, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): Promise<string[]> {
  const windows = platform === 'win32';
  const home = env.USERPROFILE ?? env.HOME ?? '';
  const local = env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
  const roaming = env.APPDATA ?? join(home, 'AppData', 'Roaming');
  const command = commandName(id);
  const names = windows ? [`${command}.exe`, `${command}.cmd`] : [command];
  const paths: string[] = [];
  for (const directory of (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)) for (const name of names) paths.push(join(directory, name));
  for (const name of names) paths.push(join(home, '.local', 'bin', name), join(roaming, 'npm', name), join(home, '.bun', 'bin', name), join(home, '.volta', 'bin', name));
  if (id === 'claude-code') {
    paths.push(join(home, '.claude', 'local', windows ? 'claude.exe' : 'claude'));
    // Claude desktop downloads its own Claude Code build; the MSIX install keeps AppData under its package folder.
    const bundles = [join(roaming, 'Claude', 'claude-code')];
    for (const entry of await children(join(local, 'Packages'))) if (entry.startsWith('Claude_')) bundles.push(join(local, 'Packages', entry, 'LocalCache', 'Roaming', 'Claude', 'claude-code'));
    if (platform === 'darwin') bundles.push(join(home, 'Library', 'Application Support', 'Claude', 'claude-code'));
    for (const bundle of bundles) for (const version of (await children(bundle)).sort(byVersionDesc)) paths.push(join(bundle, version, windows ? 'claude.exe' : 'claude'));
  } else if (id === 'codex') {
    // The Codex desktop app installs its CLI under a content-hashed folder.
    const bin = join(local, 'OpenAI', 'Codex', 'bin');
    for (const entry of await children(bin)) paths.push(join(bin, entry, 'codex.exe'));
    if (platform === 'darwin') paths.push('/Applications/Codex.app/Contents/Resources/codex');
  } else {
    // Cursor Agent CLI install script puts `agent` under ~/.cursor/bin.
    paths.push(join(home, '.cursor', 'bin', windows ? 'agent.exe' : 'agent'));
    if (platform === 'darwin') paths.push('/usr/local/bin/agent', join(home, '.local', 'bin', 'agent'));
  }
  const found: string[] = [];
  for (const path of [...new Set(paths)]) if (await isFile(path)) found.push(path);
  return found;
}

const CMD_META = /([()\][%!^"`<>&|;, *?])/g;
/**
 * npm installs `.cmd` shims, which Windows starts through cmd.exe. Arguments are escaped the way cross-spawn does:
 * MSVCRT quoting for the final program, then caret-escaping of cmd metacharacters twice, because the shim's `%*`
 * is expanded into a second command line. Other executables are spawned directly without a shell.
 */
export function commandLine(executable: string, args: string[]): { file: string; args: string[]; verbatim: boolean } {
  if (!executable.toLowerCase().endsWith('.cmd')) return { file: executable, args, verbatim: false };
  const escapeArgument = (value: string) => `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')}"`.replace(CMD_META, '^$1').replace(CMD_META, '^$1');
  const line = [executable.replace(CMD_META, '^$1'), ...args.map(escapeArgument)].join(' ');
  return { file: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], verbatim: true };
}

export const probe: Probe = (executable, args) => new Promise(resolve => {
  const command = commandLine(executable, args);
  execFile(command.file, command.args, { timeout: 10_000, windowsHide: true, windowsVerbatimArguments: command.verbatim, maxBuffer: 256 * 1024, env: cleanEnv(process.env) }, (error, stdout, stderr) => {
    resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) });
  });
});

/** Drops variables that make a child CLI think it runs inside Electron or inside another Claude Code session. */
export function cleanEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !/^ELECTRON_|^CLAUDECODE$|^CLAUDE_CODE_(ENTRYPOINT|SSE_PORT)$/.test(key)));
}

async function inspect(id: HarnessId, executable: string, run: Probe): Promise<HarnessInfo | null> {
  const versionResult = await run(executable, ['--version']);
  const version = `${versionResult.stdout}${versionResult.stderr}`.trim().split(/\r?\n/)[0]?.slice(0, 120) ?? '';
  if (versionResult.code !== 0 || !/\d+\.\d+/.test(version)) return null;
  let auth: HarnessInfo['auth'] = 'unknown'; let authDetail = '';
  if (id === 'claude-code') {
    const status = await run(executable, ['auth', 'status']);
    try {
      const parsed = JSON.parse(status.stdout) as { loggedIn?: boolean; authMethod?: string };
      auth = parsed.loggedIn ? 'logged_in' : 'logged_out';
      authDetail = parsed.loggedIn ? `Đăng nhập qua ${parsed.authMethod ?? 'Claude Code'}` : `Chưa đăng nhập. Chạy trong PowerShell: & "${executable}" auth login`;
    } catch { authDetail = 'Không đọc được trạng thái đăng nhập.'; }
  } else if (id === 'codex') {
    const status = await run(executable, ['login', 'status']);
    const text = `${status.stdout}${status.stderr}`.trim();
    if (/logged in/i.test(text) && status.code === 0) { auth = 'logged_in'; authDetail = text.split(/\r?\n/)[0].slice(0, 200); }
    else if (/not logged in/i.test(text)) { auth = 'logged_out'; authDetail = `Chưa đăng nhập. Chạy trong PowerShell: & "${executable}" login`; }
    else authDetail = 'Không đọc được trạng thái đăng nhập.';
  } else {
    const status = await run(executable, ['status', '--format', 'json']);
    const text = `${status.stdout}${status.stderr}`.trim();
    try {
      const parsed = JSON.parse(status.stdout || '{}') as { loggedIn?: boolean; authenticated?: boolean; email?: string; user?: string };
      const loggedIn = parsed.loggedIn === true || parsed.authenticated === true || Boolean(parsed.email ?? parsed.user);
      const loggedOut = parsed.loggedIn === false || parsed.authenticated === false;
      if (loggedIn) { auth = 'logged_in'; authDetail = `Đăng nhập Cursor${parsed.email || parsed.user ? ` · ${parsed.email ?? parsed.user}` : ''}`; }
      else if (loggedOut) { auth = 'logged_out'; authDetail = `Chưa đăng nhập. Chạy trong PowerShell: & "${executable}" login`; }
      else authDetail = 'Không đọc được trạng thái đăng nhập.';
    } catch {
      if (/logged in|authenticated|email/i.test(text) && status.code === 0) { auth = 'logged_in'; authDetail = text.split(/\r?\n/)[0].slice(0, 200); }
      else if (/not logged|log in|unauthenticated/i.test(text)) { auth = 'logged_out'; authDetail = `Chưa đăng nhập. Chạy trong PowerShell: & "${executable}" login`; }
      else authDetail = 'Không đọc được trạng thái đăng nhập.';
    }
  }
  return { id, name: harnessNames[id], executable, version, auth, authDetail };
}

/** First working install of each harness. Probing runs only `--version` and the CLI's own login status command. */
export async function detectHarnesses(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, run: Probe = probe): Promise<HarnessInfo[]> {
  const result: HarnessInfo[] = [];
  for (const id of ['claude-code', 'codex', 'cursor'] as const) {
    for (const executable of await candidates(id, env, platform)) {
      const info = await inspect(id, executable, run);
      if (info) { result.push(info); break; }
    }
  }
  return result;
}
