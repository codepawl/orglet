import { z } from 'zod';

/** Agent CLIs installed on the user's machine that Orglet can drive as a read-only review worker. */
export const HarnessId = z.enum(['claude-code', 'codex', 'cursor', 'gemini']);
export type HarnessId = z.infer<typeof HarnessId>;
/** Harnesses listed in Settings (the same set as the runnable ids). */
export const HarnessCatalogId = z.enum(['claude-code', 'codex', 'cursor', 'gemini']);
export type HarnessCatalogId = z.infer<typeof HarnessCatalogId>;
export const harnessCatalog = HarnessCatalogId.options;
export const harnessNames: Record<HarnessCatalogId, string> = { 'claude-code': 'Claude Code', codex: 'Codex', cursor: 'Cursor Agent', gemini: 'Gemini CLI' };
export const isHarness = (provider: string): provider is HarnessId => HarnessId.safeParse(provider).success;
export const harnessRunnable = (id: HarnessCatalogId): id is HarnessId => HarnessId.safeParse(id).success;

/** PATH / default binary names used in copy-paste commands when no install was found. */
export const harnessBinaries: Record<HarnessCatalogId, string> = { 'claude-code': 'claude', codex: 'codex', cursor: 'agent', gemini: 'gemini' };
/**
 * Login subcommands from each CLI's own help / docs. Not deep links — those CLIs open a browser themselves. Gemini CLI
 * has no login subcommand: started bare it asks how to sign in, and "Sign in with Google" opens the browser.
 */
export const harnessLoginArgs: Record<HarnessCatalogId, readonly string[]> = {
  'claude-code': ['auth', 'login'],
  codex: ['login'],
  cursor: ['login'],
  gemini: [],
};

/**
 * Harnesses Settings can sign in without a terminal (COD-327). Codex answers through its app server, which hands back
 * the page to open; Claude Code and Cursor Agent run their own login, which opens the browser and finishes there
 * without a pasted code. Gemini CLI signs in from its own menu, so it keeps the copied command.
 */
export const harnessSignsInApp: Record<HarnessCatalogId, boolean> = { 'claude-code': true, codex: true, cursor: true, gemini: false };

/** Sign-out subcommands from each CLI's own help. Gemini CLI signs out only with `/logout` inside its own window. */
export const harnessLogoutArgs: Record<HarnessCatalogId, readonly string[] | undefined> = {
  'claude-code': ['auth', 'logout'],
  codex: ['logout'],
  cursor: ['logout'],
  gemini: undefined,
};

/**
 * Whether an added account of this CLI keeps a sign-in of its own on this platform. Cursor Agent on macOS keeps its
 * sign-in in one Keychain item per computer (`cursor-access-token`), which no variable moves, so there it cannot.
 */
export const harnessAccountsSignInApart = (id: HarnessCatalogId, platform: NodeJS.Platform) => !(id === 'cursor' && platform === 'darwin');

/** Why Settings offers no added Cursor Agent account on macOS; also the core's answer to an attempt to add one. */
export const CURSOR_ONE_SIGN_IN_ON_MAC = 'Trên macOS, Cursor Agent giữ một lần đăng nhập cho cả máy trong Keychain, nên chỉ dùng được tài khoản mặc định.';

/**
 * Whether signing in or out reaches every account of this CLI on the computer: the default account, which is the
 * CLI's own home folder, and any account of a CLI whose added accounts share one sign-in on this platform.
 */
export const harnessSignInIsMachineWide = (item: Pick<HarnessInfo, 'accountId' | 'accountsSignInApart'>) =>
  item.accountId === SYSTEM_ACCOUNT_ID || !item.accountsSignInApart;

/** A sign-in Settings started for one account: still waiting for the browser, or ended with the CLI's reason. */
export type HarnessSignIn = { accountId: string; state: 'waiting' } | { accountId: string; state: 'failed'; message: string };

/**
 * The only pages main opens for a sign-in: Codex's app server names an OpenAI address. Claude Code and Cursor Agent
 * open their own pages, so nothing else ever needs to pass here.
 */
export function signInPageAllowed(address: string): boolean {
  try {
    const url = new URL(address);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && (host === 'auth.openai.com' || host === 'chatgpt.com' || host.endsWith('.openai.com'));
  } catch {
    return false;
  }
}

/**
 * Folder each CLI keeps its own config and credentials in. Setting it per probe and per run is what lets one
 * machine hold several accounts of the same CLI: an account is a folder, nothing more.
 */
export const harnessConfigDirVariable: Record<HarnessCatalogId, string> = {
  'claude-code': 'CLAUDE_CONFIG_DIR',
  codex: 'CODEX_HOME',
  cursor: 'CURSOR_CONFIG_DIR',
  // Gemini CLI keeps its `.gemini` folder inside this one, so an account folder holds `<folder>/.gemini`.
  gemini: 'GEMINI_CLI_HOME',
};

/**
 * The variables a CLI reads for where its sign-in lives, when that is not its config folder, pointed at the account's
 * folder. Cursor Agent 2026.09.18 keeps `auth.json` outside CURSOR_CONFIG_DIR: `getAuthFilePath` in its bundled
 * cli-credentials module joins `%APPDATA%\Cursor` on Windows and `$XDG_CONFIG_HOME/cursor` on Linux. So an added
 * account sets that folder too and signs in to `<account>\Cursor\auth.json`. macOS has no such variable (the Keychain).
 */
function signInFolderVariables(id: HarnessCatalogId, configDir: string, platform: NodeJS.Platform): Record<string, string> {
  if (id !== 'cursor') return {};
  if (platform === 'win32') return { APPDATA: configDir };
  if (platform === 'darwin') return {};
  return { XDG_CONFIG_HOME: configDir };
}

/** Every variable that points a CLI at one account's folder: its config folder, and its sign-in when that lives apart. */
export function harnessAccountVariables(id: HarnessCatalogId, configDir: string, platform: NodeJS.Platform): Record<string, string> {
  return { [harnessConfigDirVariable[id]]: configDir, ...signInFolderVariables(id, configDir, platform) };
}

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
  /** False where this CLI's added accounts would share one sign-in, so Settings offers no new one (`harnessAccountsSignInApart`). */
  accountsSignInApart: boolean;
  /** A sign-in Settings started for the account shown, while it waits or after it failed (COD-327). */
  signIn?: HarnessSignIn;
};

/** One rolling allowance of a subscription plan, as the CLI's vendor reports it for the signed-in account. */
export type HarnessUsageWindow = {
  kind: 'session' | 'daily' | 'weekly' | 'monthly';
  /**
   * The model or pool this allowance is limited to, when it is not the whole plan: Claude's weekly allowance for one
   * model, Cursor's Auto and API pools, Gemini CLI's daily allowance for one model.
   */
  model?: string;
  /** 0 to 100. */
  usedPercent: number;
  resetsAt?: string;
};

/**
 * Why an account shows no allowance: its sign-in has none to report (an API key, a plan without one), the account is
 * signed out, its saved sign-in has expired until the CLI runs again, or the read failed this time.
 */
export type HarnessUsageGap = 'unsupported' | 'signed_out' | 'expired' | 'failed';

/**
 * Resets of the session allowance a Claude plan holds in the bank (COD-328): how many can be spent now, and when the
 * one spent next runs out, when Claude says. Present only when there is at least one.
 */
export type HarnessBankedResets = { count: number; expiresAt?: string };

/**
 * What became of a request to spend one banked reset. The first four are Claude's answer to a claim; the rest mean
 * nothing was spent (`expired`, `unreadable`, `rate_limited`, `cooling_down`, `failed`) or Claude could not say
 * whether it was (`unconfirmed`, `no_answer`), in which case a retry sends the same claim again.
 */
export type HarnessResetOutcome = 'reset' | 'not_limited' | 'already_used' | 'none_left'
  | 'expired' | 'unreadable' | 'rate_limited' | 'cooling_down' | 'failed' | 'unconfirmed' | 'no_answer';

/** The answers to a claim that Claude gave, which the window words; every other outcome is an error. */
export type HarnessResetAnswer = Extract<HarnessResetOutcome, 'reset' | 'not_limited' | 'already_used' | 'none_left'>;

/** A claim Claude answered, with the plan usage read again after it. */
export type HarnessResetClaim = { outcome: HarnessResetAnswer; usage: HarnessUsage };

/** What the vendor says about one account: who is signed in, on which plan, and how much of it is used. */
export type HarnessAccountUsage = {
  accountId: string;
  email?: string;
  plan?: string;
  windows: HarnessUsageWindow[];
  bankedResets?: HarnessBankedResets;
  unavailable?: HarnessUsageGap;
  checkedAt: string;
  /**
   * When this read could not get fresh numbers (an expired saved sign-in, a failed request), the windows are the last
   * good reading of the same account and this is when it was taken (COD-301). Absent when the windows are fresh.
   */
  asOf?: string;
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
  const args = harnessLoginArgs[id];
  if (!executable) return withArguments(harnessBinaries[id], args);
  if (shell === 'powershell') return withArguments(`& "${executable}"`, args);
  if (shell === 'cmd') return withArguments(`"${executable}"`, args);
  if (shell === 'bash') return withArguments(posixQuote(gitBashPath(executable)), args);
  const quote = (value: string) => /[\s"$\\]/.test(value) ? `"${value.replace(/(["\\$])/g, '\\$1')}"` : value;
  return [executable, ...args].map(quote).join(' ');
}

/** A program and its arguments; a CLI that signs in when started bare gets no trailing space. */
function withArguments(program: string, args: readonly string[]): string {
  return [program, ...args].join(' ');
}

/**
 * The line one terminal needs to sign in. With an account folder it sets that CLI's variables first, so the sign-in
 * lands in the selected account instead of the CLI's own home folder. In PowerShell and Command Prompt an assignment
 * outlives the line, so APPDATA, which every other program in that terminal reads too, is put back after the CLI
 * exits; Git Bash and POSIX shells set the variables for the one program only. Every Windows form is run in its real
 * shell by tests/integration/login-commands.test.ts.
 */
export function loginCommandFor(shell: LoginShell, id: HarnessCatalogId, executable: string | undefined, configDir?: string, platform: NodeJS.Platform = shell === 'sh' ? 'linux' : 'win32'): string {
  const program = loginProgram(shell, id, executable);
  if (!configDir) return program;
  const variables = Object.entries(harnessAccountVariables(id, configDir, platform));
  const movesAppData = variables.some(([name]) => name === 'APPDATA');
  if (shell === 'powershell') {
    const assignments = variables.map(([name, value]) => `$env:${name} = "${value.replaceAll('"', '`"')}"`);
    // The folder Windows itself names for APPDATA, which is where the variable pointed before the line.
    const restore = movesAppData ? [`$env:APPDATA = [Environment]::GetFolderPath('ApplicationData')`] : [];
    return [...assignments, program, ...restore].join('; ');
  }
  if (shell === 'cmd') {
    // The quotes round the whole assignment keep a trailing space out of the value.
    const assignments = variables.map(([name, value]) => `set "${name}=${value}" && `).join('');
    // Command Prompt expands %APPDATA% when it reads the line, before the first `set` runs, so this is the old value.
    const restore = movesAppData ? ' & set "APPDATA=%APPDATA%"' : '';
    return `${assignments}${program}${restore}`;
  }
  // The folder stays a Windows path: the CLI is a Windows program, and Git Bash hands it the value as written.
  if (shell === 'bash') return [...variables.map(([name, value]) => `${name}=${posixQuote(value)}`), program].join(' ');
  return [...variables.map(([name, value]) => `${name}="${value.replace(/(["\\$`])/g, '\\$1')}"`), program].join(' ');
}

/** The login line for every terminal of this platform, the default one first. */
export function loginCommands(id: HarnessCatalogId, executable: string | undefined, platform: NodeJS.Platform, configDir?: string): LoginCommand[] {
  return loginShells(platform).map(shell => ({ shell, command: loginCommandFor(shell, id, executable, configDir, platform) }));
}

/** The default terminal's login line: PowerShell on Windows, the POSIX line elsewhere. */
export function loginCommand(id: HarnessCatalogId, executable: string | undefined, platform: NodeJS.Platform, configDir?: string): string {
  return loginCommands(id, executable, platform, configDir)[0].command;
}

/**
 * The install line each vendor documents. Claude Code, Codex and Gemini CLI publish first-party npm packages whose
 * binaries are the very names `candidates()` looks for, and a global npm install lands in %APPDATA%\npm, one of the
 * folders it already searches — so the command shown here is one the detector will find afterwards.
 */
export function installCommand(id: HarnessCatalogId, platform: NodeJS.Platform): string | undefined {
  if (id === 'claude-code') return 'npm install -g @anthropic-ai/claude-code';
  if (id === 'codex') return 'npm install -g @openai/codex';
  if (id === 'gemini') return 'npm install -g @google/gemini-cli';
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
    accountsSignInApart: harnessAccountsSignInApart(id, platform),
  };
}
