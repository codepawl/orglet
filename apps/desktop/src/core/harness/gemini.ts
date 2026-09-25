import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/*
 * Gemini CLI as an Orglet harness. What this file relies on was read from @google/gemini-cli 0.61.0: its bundled docs
 * (docs/cli/headless.md, docs/reference/configuration.md, docs/cli/trusted-folders.md) and its source.
 *
 * - The user's `~/.gemini/settings.json` cannot be switched off for one run, and a system settings file named through
 *   GEMINI_CLI_SYSTEM_SETTINGS_PATH is skipped unless an administrator owns it and every folder above it. What the CLI
 *   does load per run is the workspace file `<working folder>/.gemini/settings.json`, which overrides the user file.
 *   The working folder is Orglet's private copy, so the lockdown lives there.
 * - Workspace settings only load in a trusted folder, and trust is decided while the settings load, before
 *   `--skip-trust` is parsed. GEMINI_CLI_TRUST_WORKSPACE therefore has to be in the environment.
 * - `tools.core: []` registers none of the CLI's own tools (files, shell, web, subagents); MCP servers and skills add
 *   tools of their own, so those are shut separately.
 */

/** A server name no configuration uses: allowing only it blocks every MCP server the person or an extension set up. */
export const GEMINI_NO_MCP_SERVER = 'orglet-no-mcp-server';

/** A context file name nobody writes, so no GEMINI.md from the home folder or any parent folder reaches the model. */
const NO_CONTEXT_FILE = 'orglet-no-context-file';

/**
 * The run's workspace settings. They override the person's own settings for every key named here; keys that merge
 * instead of override (MCP servers, hooks, include folders) are made harmless by the switch next to them.
 */
export const geminiLockdownSettings = {
  tools: {
    // An empty allowlist registers no built-in tool at all: no file reads or writes, no shell, no web, no subagents.
    core: [],
    // A sandbox restarts the CLI in Docker or Podman with the whole prompt on the command line; with no tools there is
    // nothing for it to contain.
    sandbox: false,
    // Both are shell commands the CLI would run to find and call tools of its own.
    discoveryCommand: '',
    callCommand: '',
  },
  mcp: { serverCommand: '' },
  // Skills bring back an activate_skill tool even with no core tools, and hooks run shell commands.
  skills: { enabled: false },
  hooksConfig: { enabled: false },
  context: {
    fileName: NO_CONTEXT_FILE,
    memoryBoundaryMarkers: [],
    discoveryMaxDirs: 0,
    includeDirectoryTree: false,
    loadMemoryFromIncludeDirectories: false,
  },
  experimental: {
    enableAgents: false,
    autoMemory: false,
    // The Gemma router can start a local model server.
    gemmaModelRouter: { enabled: false },
  },
  ide: { enabled: false },
  general: { checkpointing: { enabled: false } },
};

/** Writes the lockdown into a fresh private folder; an existing file there means the folder is not Orglet's own. */
export async function writeGeminiLockdown(directory: string): Promise<void> {
  const settingsFolder = join(directory, '.gemini');
  await mkdir(settingsFolder, { recursive: true });
  await writeFile(join(settingsFolder, 'settings.json'), JSON.stringify(geminiLockdownSettings), { flag: 'wx' });
}

/**
 * Headless flags. The prompt arrives on stdin, which a pipe makes non-interactive; streamed JSON carries the answer
 * and the token counts. Approval stays at its default and `--yolo` is never passed: with no tools there is nothing to
 * approve, and a stray tool request stops the run (see GeminiStreamParser).
 */
export function geminiArgs(model?: string): string[] {
  const modelFlag = model ? ['-m', model] : [];
  return [
    '--output-format', 'stream-json',
    '--approval-mode', 'default',
    '--skip-trust',
    '--extensions', 'none',
    '--allowed-mcp-server-names', GEMINI_NO_MCP_SERVER,
    ...modelFlag,
  ];
}

/**
 * Variables that would reach past the lockdown: a sandbox choice, a replacement system prompt (or a request to write
 * one to disk), and an IDE connection that adds its open folders and files to the context.
 */
const LEAKING_VARIABLES = /^(GEMINI_SANDBOX|GEMINI_SYSTEM_MD|GEMINI_WRITE_SYSTEM_MD|GEMINI_CLI_IDE_.+)$/i;

/**
 * The environment of one run. Trust is set here rather than only by `--skip-trust` (see the top of the file).
 * GEMINI_CLI_NO_RELAUNCH keeps the CLI in one process: its relaunching parent ignores SIGTERM, so a cancel on macOS
 * would miss the process doing the work. NO_BROWSER makes a missing Google sign-in fail instead of opening a browser.
 */
export function geminiRunEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const kept = Object.entries(environment).filter(([name]) => !LEAKING_VARIABLES.test(name));
  return { ...Object.fromEntries(kept), GEMINI_CLI_TRUST_WORKSPACE: 'true', GEMINI_CLI_NO_RELAUNCH: 'true', NO_BROWSER: 'true' };
}

const AT_SIGN_NOTE = 'Orglet writes every at sign in this prompt with a backslash in front of it, so the CLI reads it as text and not as a file to attach. Write plain at signs, without the backslash, in your answer.';

/**
 * The CLI reads `@path` anywhere in a headless prompt as a file to attach, bypassing its tool list, and a backslash in
 * front is the only thing that stops it. Chat text, sources and tool output all carry at signs, so every one is escaped.
 */
export function escapeAtSigns(text: string): string {
  return text.replaceAll('@', '\\@');
}

/** Undoes an escaped at sign the model copied into its JSON answer, where `\@` is not a valid JSON escape. */
export function unescapeAtSigns(json: string): string {
  return json.replace(/(^|[^\\])((?:\\\\)*)\\@/g, '$1$2@');
}

/** The run's prompt: Gemini CLI has no schema flag, so the schema goes in the text, and every at sign is escaped. */
export function geminiPrompt(prompt: string, schema: object): string {
  const withSchema = `${prompt}\n\nReturn only one JSON object that matches this schema (no markdown fences):\n${JSON.stringify(schema)}`;
  return `${AT_SIGN_NOTE}\n\n${escapeAtSigns(withSchema)}`;
}

/** The value the CLI stores for "Sign in with Google". */
const GOOGLE_SIGN_IN = 'oauth-personal';

export type GeminiSignIn = {
  state: 'signed_in' | 'signed_out' | 'unreadable';
  /** The CLI's own name for the sign-in method, such as oauth-personal or gemini-api-key. */
  method?: string;
  email?: string;
};

export type ReadText = (path: string) => Promise<string>;

/** The folder that holds the CLI's `.gemini` folder: the account's own, else GEMINI_CLI_HOME, else the home folder. */
export function geminiHome(configDir: string | undefined, environment: NodeJS.ProcessEnv, homeFolder: string): string {
  return configDir ?? environment.GEMINI_CLI_HOME ?? homeFolder;
}

/**
 * Whether Gemini CLI is signed in, read from its own files because it has no status command: the method chosen in its
 * settings (or the environment variables it falls back to), the cached Google credentials, and the signed-in address.
 */
export async function readGeminiSignIn(home: string, environment: NodeJS.ProcessEnv, readText: ReadText): Promise<GeminiSignIn> {
  const folder = join(home, '.gemini');
  try {
    const settings = await readIfPresent(join(folder, 'settings.json'), readText);
    const method = selectedAuthType(settings ?? '') ?? authTypeFromEnvironment(environment);
    if (!method) return { state: 'signed_out' };
    const email = await activeGoogleAccount(folder, readText);
    const account = email ? { email } : {};
    if (method !== GOOGLE_SIGN_IN) return { state: 'signed_in', method, ...account };
    if (await hasGoogleCredentials(folder, environment, readText)) return { state: 'signed_in', method, ...account };
    return { state: 'signed_out', method };
  } catch {
    return { state: 'unreadable' };
  }
}

/** The settings file allows comments, so the method is found by its key rather than by parsing the file. */
function selectedAuthType(settings: string): string | undefined {
  const match = /"(?:selectedType|selectedAuthType)"\s*:\s*"([^"]+)"/.exec(settings);
  return match?.[1];
}

/** The same order the CLI itself checks when its settings name no method. */
function authTypeFromEnvironment(environment: NodeJS.ProcessEnv): string | undefined {
  if (environment.GOOGLE_GENAI_USE_GCA === 'true') return GOOGLE_SIGN_IN;
  if (environment.GOOGLE_GENAI_USE_VERTEXAI === 'true') return 'vertex-ai';
  if (environment.GOOGLE_GEMINI_BASE_URL) return 'gateway';
  if (environment.GEMINI_API_KEY) return 'gemini-api-key';
  if (environment.CLOUD_SHELL === 'true' || environment.GEMINI_CLI_USE_COMPUTE_ADC === 'true') return 'compute-default-credentials';
  return undefined;
}

/**
 * A Google sign-in is cached in oauth_creds.json. With GEMINI_FORCE_ENCRYPTED_FILE_STORAGE it sits in the system
 * keychain instead, which Orglet does not read; a run then finds out, and a missing sign-in fails it with exit code 41.
 */
async function hasGoogleCredentials(folder: string, environment: NodeJS.ProcessEnv, readText: ReadText): Promise<boolean> {
  if (environment.GEMINI_FORCE_ENCRYPTED_FILE_STORAGE === 'true') return true;
  if (environment.GOOGLE_APPLICATION_CREDENTIALS) return true;
  const credentials = await readIfPresent(join(folder, 'oauth_creds.json'), readText);
  if (!credentials) return false;
  const parsed = parseJson(credentials);
  if (!isRecord(parsed)) return false;
  return typeof parsed.refresh_token === 'string' || typeof parsed.access_token === 'string';
}

async function activeGoogleAccount(folder: string, readText: ReadText): Promise<string | undefined> {
  const accounts = parseJson(await readIfPresent(join(folder, 'google_accounts.json'), readText) ?? '');
  if (!isRecord(accounts) || typeof accounts.active !== 'string') return undefined;
  const email = accounts.active.trim();
  return email || undefined;
}

/** The file's text, or null when it does not exist. Any other failure is thrown so the state reads as unreadable. */
async function readIfPresent(path: string, readText: ReadText): Promise<string | null> {
  try {
    return await readText(path);
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ENOENT') return null;
    throw error;
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
