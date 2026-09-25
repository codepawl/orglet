import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CLI_TOKEN_FILE, cliEndpoint, MAX_LINE_BYTES, type CliRequestBody, type CliResponse } from './protocol';

/** Finding the app's data folder, reaching its pipe, and starting the app when nothing answers (COD-234). */

/** The app is not running for this data folder, or its token file is missing. */
export class UnreachableError extends Error {}

/** The folder Electron uses as `userData` for a product named "Orglet" on each platform. */
export function defaultUserData(platform: NodeJS.Platform, environment: NodeJS.ProcessEnv, home: string): string {
  if (platform === 'win32') return join(environment.APPDATA ?? join(home, 'AppData', 'Roaming'), 'Orglet');
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'Orglet');
  return join(environment.XDG_CONFIG_HOME ?? join(home, '.config'), 'Orglet');
}

/**
 * `ORGLET_USER_DATA` (set by the PATH shim and the smoke) wins; `ORGLET_DATA_DIR` is what a dev run of the app
 * honours; otherwise the platform default.
 */
export function resolveUserData(environment: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home: string = homedir()): string {
  if (environment.ORGLET_USER_DATA) return environment.ORGLET_USER_DATA;
  if (environment.ORGLET_DATA_DIR) return environment.ORGLET_DATA_DIR;
  return defaultUserData(platform, environment, home);
}

async function readToken(userData: string): Promise<string> {
  try {
    return (await readFile(join(userData, CLI_TOKEN_FILE), 'utf8')).trim();
  } catch {
    throw new UnreachableError('No token file: Orglet has not started with this data folder.');
  }
}

const UNREACHABLE_CODES = new Set(['ENOENT', 'ECONNREFUSED', 'EPIPE', 'ECONNRESET', 'ENOTSOCK']);

/** Sends one request line and reads one response line. */
export function exchange(endpoint: string, request: object): Promise<CliResponse> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(endpoint);
    let received = Buffer.alloc(0);
    let connected = false;
    socket.on('connect', () => {
      connected = true;
      socket.write(`${JSON.stringify(request)}\n`);
    });
    socket.on('data', (chunk: Buffer) => {
      received = Buffer.concat([received, chunk]);
      if (received.length > MAX_LINE_BYTES * 16) socket.destroy(new Error('The app sent too much data.'));
    });
    socket.on('error', error => {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (!connected && UNREACHABLE_CODES.has(code)) reject(new UnreachableError('Orglet is not running.'));
      else reject(error);
    });
    socket.on('close', () => {
      const newline = received.indexOf(0x0a);
      if (newline === -1) {
        reject(connected ? new Error('The app closed the connection without an answer.') : new UnreachableError('Orglet is not running.'));
        return;
      }
      try {
        resolve(JSON.parse(received.subarray(0, newline).toString('utf8')) as CliResponse);
      } catch {
        reject(new Error('The app sent an answer this command cannot read.'));
      }
    });
  });
}

/** One request with this start's token. */
export async function call(userData: string, request: CliRequestBody): Promise<CliResponse> {
  const token = await readToken(userData);
  return exchange(cliEndpoint(userData), { ...request, token });
}

/**
 * The executable to start when the app is not running: the shim runs this script with Orglet's own executable as
 * Node, so `process.execPath` is the app. A plain Node run (`pnpm orglet` in a checkout) has nothing to start.
 */
export function appExecutable(environment: NodeJS.ProcessEnv = process.env): string | undefined {
  if (environment.ORGLET_APP_EXECUTABLE) return environment.ORGLET_APP_EXECUTABLE;
  if (process.versions.electron) return process.execPath;
  return undefined;
}

/** Starts the app detached, as a normal app and not as Node, on the same data folder. */
export function launchApp(executable: string, userData: string, environment: NodeJS.ProcessEnv = process.env): void {
  const appEnvironment = { ...environment };
  delete appEnvironment.ELECTRON_RUN_AS_NODE;
  const argumentList = environment.ORGLET_USER_DATA ? [`--user-data-dir=${userData}`] : [];
  const child = spawn(executable, argumentList, { detached: true, stdio: 'ignore', env: appEnvironment, windowsHide: false });
  child.unref();
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export const START_TIMEOUT_MILLISECONDS = 30_000;
const RETRY_MILLISECONDS = 500;

/**
 * Tries the request; when the app does not answer, starts it and keeps trying for up to 30 seconds. While it starts,
 * the token on disk may still be the previous run's, so a refused token is retried too.
 */
export async function callStartingApp(userData: string, request: CliRequestBody, executable: string | undefined): Promise<CliResponse> {
  try {
    return await call(userData, request);
  } catch (error) {
    if (!(error instanceof UnreachableError) || !executable) throw error;
  }
  launchApp(executable, userData);
  const deadline = Date.now() + START_TIMEOUT_MILLISECONDS;
  while (Date.now() < deadline) {
    await delay(RETRY_MILLISECONDS);
    try {
      const response = await call(userData, request);
      const staleToken = !response.ok && response.code === 'unauthorized';
      if (!staleToken) return response;
    } catch (error) {
      if (!(error instanceof UnreachableError)) throw error;
    }
  }
  throw new UnreachableError('Orglet did not start within 30 seconds.');
}
