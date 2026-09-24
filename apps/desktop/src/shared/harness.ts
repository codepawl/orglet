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

/**
 * Folder each CLI keeps its own config and credentials in. Setting it per probe and per run is what lets one
 * machine hold several accounts of the same CLI: an account is a folder, nothing more.
 */
export const harnessConfigDirVariable: Record<HarnessCatalogId, string> = {
  'claude-code': 'CLAUDE_CONFIG_DIR',
  codex: 'CODEX_HOME',
  cursor: 'CURSOR_CONFIG_DIR',
};

/** The account that is the CLI's own home folder: what every install starts with, and what Orglet used before accounts existed. */
export const SYSTEM_ACCOUNT_ID = 'system';

/** An account the user added. The label is theirs; the id names the folder, so it is never shown. */
export const HarnessAccount = z.object({ id: z.string().min(1).max(64), label: z.string().min(1).max(60) }).strict();
export type HarnessAccount = z.infer<typeof HarnessAccount>;

/** Stored per harness: the added accounts and which one runs. */
export const HarnessAccountState = z.object({ accounts: z.array(HarnessAccount).max(20), activeId: z.string().min(1).max(64) }).strict();
export type HarnessAccountState = z.infer<typeof HarnessAccountState>;

export type HarnessAccountSelection = {
  /** Account in use, `SYSTEM_ACCOUNT_ID` for the CLI's own home folder. */
  accountId: string;
  /** Added accounts, oldest first. Never includes the system account. */
  accounts: HarnessAccount[];
  /** Credential folder of the account in use; undefined for the system account, which sets no variable. */
  configDir?: string;
};
export const systemAccountSelection = (): HarnessAccountSelection => ({ accountId: SYSTEM_ACCOUNT_ID, accounts: [] });

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
  /** Copy-paste login command using the detected path, or the PATH name when missing: the default terminal's. */
  loginCommand: string;
  /** The same login for every terminal of this platform, the default one first (COD-230). */
  loginCommands: LoginCommand[];
  /** Official install command when one is documented; omitted rather than invented. */
  installCommand?: string;
  /** False for catalog rows Orglet cannot start (none today — Cursor Agent is runnable). */
  runnable: boolean;
  /** Version, auth and login command above all describe this account. */
  accountId: string;
  accounts: HarnessAccount[];
  configDir?: string;
};

/** One rolling allowance of a subscription plan, as the CLI's vendor reports it for the signed-in account. */
export type HarnessUsageWindow = {
  kind: 'session' | 'weekly' | 'monthly';
  /** The model this allowance is limited to, when it is not the whole plan (Claude's weekly allowance for one model). */
  model?: string;
  /** 0 to 100. */
  usedPercent: number;
  resetsAt?: string;
};

/**
 * Why an account shows no allowance: the CLI reports none (Cursor Agent, an API-key sign-in), the account is
 * signed out, its saved sign-in has expired until the CLI runs again, or the read failed this time.
 */
export type HarnessUsageGap = 'unsupported' | 'signed_out' | 'expired' | 'failed';

/** What the vendor says about one account: who is signed in, on which plan, and how much of it is used. */
export type HarnessAccountUsage = {
  accountId: string;
  email?: string;
  plan?: string;
  windows: HarnessUsageWindow[];
  unavailable?: HarnessUsageGap;
  checkedAt: string;
};

/** Every account of every installed harness, the system account first. */
export type HarnessUsage = Partial<Record<HarnessCatalogId, HarnessAccountUsage[]>>;

/** The allowance closest to running out: the one that stops the account first. */
export const tightestWindow = (usage: Pick<HarnessAccountUsage, 'windows'>): HarnessUsageWindow | undefined =>
  usage.windows.reduce<HarnessUsageWindow | undefined>((tightest, window) => !tightest || window.usedPercent > tightest.usedPercent ? window : tightest, undefined);

export function harnessStatus(auth: HarnessAuth): HarnessStatus {
  if (auth === 'missing') return 'not_installed';
  if (auth === 'logged_out') return 'detected';
  if (auth === 'unknown') return 'auth_error';
  return 'signed_in';
}

/** A worker can actually start only when the CLI is signed in and Orglet knows how to run it. */
export const harnessReady = (item: Pick<HarnessInfo, 'auth' | 'runnable'>) => item.runnable && item.auth === 'logged_in';

/**
 * The terminals a login command is written for (COD-230). Windows people sign in from PowerShell, Command Prompt or
 * Git Bash, and each needs its own line; macOS and Linux share one POSIX line for bash and zsh.
 */
export type LoginShell = 'powershell' | 'cmd' | 'bash' | 'sh';
export type LoginCommand = { shell: LoginShell; command: string };
export const loginShells = (platform: NodeJS.Platform): LoginShell[] => (platform === 'win32' ? ['powershell', 'cmd', 'bash'] : ['sh']);
/** Names shown in the terminal picker; they are product names, so they are not translated. */
export const loginShellNames: Record<LoginShell, string> = { powershell: 'PowerShell', cmd: 'Command Prompt', bash: 'Git Bash', sh: 'Terminal' };

const posixQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
/** `C:\Users\an\claude.exe` as Git Bash writes it, `/c/Users/an/claude.exe`. */
const gitBashPath = (path: string) => path.replace(/^([A-Za-z]):[\\/]/, (_match, drive: string) => `/${drive.toLowerCase()}/`).replaceAll('\\', '/');

/** The program and its login arguments as one shell would write them, or the bare command name when nothing is installed. */
function loginProgram(shell: LoginShell, id: HarnessCatalogId, executable: string | undefined): string {
  const args = harnessLoginArgs[id].join(' ');
  if (!executable) return `${harnessBinaries[id]} ${args}`;
  if (shell === 'powershell') return `& "${executable}" ${args}`;
  if (shell === 'cmd') return `"${executable}" ${args}`;
  if (shell === 'bash') return `${posixQuote(gitBashPath(executable))} ${args}`;
  const quote = (value: string) => /[\s"$\\]/.test(value) ? `"${value.replace(/(["\\$])/g, '\\$1')}"` : value;
  return [executable, ...harnessLoginArgs[id]].map(quote).join(' ');
}

/**
 * The line one terminal needs to sign in. With an account folder it sets that CLI's config-dir variable first, so
 * the sign-in lands in the selected account instead of the CLI's own home folder. Every form is run in its real
 * shell by tests/integration/login-commands.test.ts.
 */
export function loginCommandFor(shell: LoginShell, id: HarnessCatalogId, executable: string | undefined, configDir?: string): string {
  const program = loginProgram(shell, id, executable);
  if (!configDir) return program;
  const variable = harnessConfigDirVariable[id];
  if (shell === 'powershell') return `$env:${variable} = "${configDir.replaceAll('"', '`"')}"; ${program}`;
  // The quotes round the whole assignment keep a trailing space out of the value.
  if (shell === 'cmd') return `set "${variable}=${configDir}" && ${program}`;
  // The folder stays a Windows path: the CLI is a Windows program, and Git Bash hands it the value as written.
  if (shell === 'bash') return `${variable}=${posixQuote(configDir)} ${program}`;
  return `${variable}="${configDir.replace(/(["\\$`])/g, '\\$1')}" ${program}`;
}

/** The login line for every terminal of this platform, the default one first. */
export function loginCommands(id: HarnessCatalogId, executable: string | undefined, platform: NodeJS.Platform, configDir?: string): LoginCommand[] {
  return loginShells(platform).map(shell => ({ shell, command: loginCommandFor(shell, id, executable, configDir) }));
}

/** The default terminal's login line: PowerShell on Windows, the POSIX line elsewhere. */
export function loginCommand(id: HarnessCatalogId, executable: string | undefined, platform: NodeJS.Platform, configDir?: string): string {
  return loginCommands(id, executable, platform, configDir)[0].command;
}

/**
 * The install line each vendor documents. Claude Code and Codex publish first-party npm packages whose binaries
 * are the very names `candidates()` looks for, and a global npm install lands in %APPDATA%\npm, one of the
 * folders it already searches — so the command shown here is one the detector will find afterwards.
 */
export function installCommand(id: HarnessCatalogId, platform: NodeJS.Platform): string | undefined {
  if (id === 'claude-code') return 'npm install -g @anthropic-ai/claude-code';
  if (id === 'codex') return 'npm install -g @openai/codex';
  return platform === 'win32' ? "irm 'https://cursor.com/install?win32=true' | iex" : 'curl https://cursor.com/install -fsS | bash';
}

export function missingHarness(id: HarnessCatalogId, platform: NodeJS.Platform, selection: HarnessAccountSelection = systemAccountSelection()): HarnessInfo {
  return {
    id,
    name: harnessNames[id],
    executable: '',
    version: '',
    auth: 'missing',
    status: 'not_installed',
    authDetail: `Chưa cài ${harnessNames[id]} trên máy này. Cài xong bấm Dò lại.`,
    loginCommand: loginCommand(id, undefined, platform, selection.configDir),
    loginCommands: loginCommands(id, undefined, platform, selection.configDir),
    installCommand: installCommand(id, platform),
    runnable: harnessRunnable(id),
    accountId: selection.accountId,
    accounts: selection.accounts,
    ...(selection.configDir ? { configDir: selection.configDir } : {}),
  };
}
