import { z } from 'zod';

/** Agent CLIs installed on the user's machine that Orglet can drive as a read-only review worker. */
export const HarnessId = z.enum(['claude-code', 'codex', 'cursor']);
export type HarnessId = z.infer<typeof HarnessId>;
/** Harnesses listed in Settings (same set as runnable ids while Cursor Agent is supported). */
export const HarnessCatalogId = z.enum(['claude-code', 'codex', 'cursor']);
export type HarnessCatalogId = z.infer<typeof HarnessCatalogId>;
export const harnessCatalog = HarnessCatalogId.options;
export const harnessNames: Record<HarnessCatalogId, string> = { 'claude-code': 'Claude Code', codex: 'Codex', cursor: 'Cursor Agent' };
export const isHarness = (provider: string): provider is HarnessId => HarnessId.safeParse(provider).success;
export const harnessRunnable = (id: HarnessCatalogId): id is HarnessId => HarnessId.safeParse(id).success;

/** PATH / default binary names used in copy-paste commands when no install was found. */
export const harnessBinaries: Record<HarnessCatalogId, string> = { 'claude-code': 'claude', codex: 'codex', cursor: 'agent' };
/** Login subcommands from each CLI's own help / docs. Not deep links — those CLIs open a browser themselves. */
export const harnessLoginArgs: Record<HarnessCatalogId, readonly string[]> = {
  'claude-code': ['auth', 'login'],
  codex: ['login'],
  cursor: ['login'],
};

export type HarnessAuth = 'logged_in' | 'logged_out' | 'unknown' | 'missing';
/**
 * Settings matrix: not installed, found on disk but not signed in (detected), signed in,
 * or the login-status probe failed. Ready-to-run is signed in *and* Orglet can execute it.
 */
export type HarnessStatus = 'not_installed' | 'detected' | 'signed_in' | 'auth_error';

export type HarnessInfo = {
  id: HarnessCatalogId;
  name: string;
  executable: string;
  version: string;
  auth: HarnessAuth;
  status: HarnessStatus;
  authDetail: string;
  /** Copy-paste login command using the detected path, or the PATH name when missing. */
  loginCommand: string;
  /** Official install command when one is documented; omitted rather than invented. */
  installCommand?: string;
  /** False for catalog rows Orglet cannot start (none today — Cursor Agent is runnable). */
  runnable: boolean;
};

export function harnessStatus(auth: HarnessAuth): HarnessStatus {
  if (auth === 'missing') return 'not_installed';
  if (auth === 'logged_out') return 'detected';
  if (auth === 'unknown') return 'auth_error';
  return 'signed_in';
}

/** A worker can actually start only when the CLI is signed in and Orglet knows how to run it. */
export const harnessReady = (item: Pick<HarnessInfo, 'auth' | 'runnable'>) => item.runnable && item.auth === 'logged_in';

export function quoteLoginCommand(executable: string, args: readonly string[], platform: NodeJS.Platform): string {
  if (platform === 'win32') return `& "${executable}" ${args.join(' ')}`;
  const quote = (value: string) => /[\s"$\\]/.test(value) ? `"${value.replace(/(["\\$])/g, '\\$1')}"` : value;
  return [executable, ...args].map(quote).join(' ');
}

export function loginCommand(id: HarnessCatalogId, executable: string | undefined, platform: NodeJS.Platform): string {
  const args = harnessLoginArgs[id];
  if (!executable) return `${harnessBinaries[id]} ${args.join(' ')}`;
  return quoteLoginCommand(executable, args, platform);
}

/** Documented Cursor CLI install one-liners. Claude Code and Codex have no single official one-liner we reuse. */
export function installCommand(id: HarnessCatalogId, platform: NodeJS.Platform): string | undefined {
  if (id !== 'cursor') return undefined;
  return platform === 'win32' ? "irm 'https://cursor.com/install?win32=true' | iex" : 'curl https://cursor.com/install -fsS | bash';
}

export function missingHarness(id: HarnessCatalogId, platform: NodeJS.Platform): HarnessInfo {
  return {
    id,
    name: harnessNames[id],
    executable: '',
    version: '',
    auth: 'missing',
    status: 'not_installed',
    authDetail: `Chưa cài ${harnessNames[id]} trên máy này. Cài xong bấm Dò lại.`,
    loginCommand: loginCommand(id, undefined, platform),
    installCommand: installCommand(id, platform),
    runnable: harnessRunnable(id),
  };
}
