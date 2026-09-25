import { createHash } from 'node:crypto';
import { join, win32 } from 'node:path';
import { z } from 'zod';

/**
 * The line protocol between the `orglet` command and the running app (COD-234). One JSON request per line, one JSON
 * response per line. Main and the CLI both import this file, so the endpoint, the token file and the request shape
 * cannot drift apart. Node only: no Electron, no renderer.
 */

/** Written by main on every start, read by the CLI before each request. */
export const CLI_TOKEN_FILE = 'cli-token';
/** The Unix socket inside the data folder on macOS and Linux. */
export const CLI_SOCKET_FILE = 'cli.sock';
/** A request line longer than this is refused and the connection closed. */
export const MAX_LINE_BYTES = 1024 * 1024;
/** Commands running at once; a waiting `send` holds its connection until the turn ends. */
export const MAX_CONNECTIONS = 8;
/** The same cap the file picker has. */
export const MAX_FILES = 20;
/** How long `send` waits for the answer unless `--timeout` says otherwise. */
export const DEFAULT_WAIT_SECONDS = 600;
export const MAX_WAIT_SECONDS = 24 * 60 * 60;

export const EXIT_CODES = { ok: 0, failure: 1, usage: 2, unreachable: 3 } as const;

/**
 * Where the app listens for this data folder. Windows gets a named pipe whose name is a hash of the folder, so two
 * copies of the app with different data folders never share one; macOS and Linux get a socket file inside it.
 */
export function cliEndpoint(userData: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') {
    // Windows paths ignore case, and main and the CLI may spell the same folder differently.
    const normalized = win32.resolve(userData).toLowerCase();
    const digest = createHash('sha256').update(normalized).digest('hex').slice(0, 16);
    return `\\\\.\\pipe\\orglet-cli-${digest}`;
  }
  return join(userData, CLI_SOCKET_FILE);
}

export const CliToken = z.string().regex(/^[a-f0-9]{64}$/);
const ChatName = z.string().trim().min(1).max(80);

/**
 * Everything the CLI may ask. Anything else, such as granting a folder, touching keys, connections, settings,
 * permissions or backups, or deleting and archiving, has no operation here and is refused.
 */
export const CliRequest = z.discriminatedUnion('op', [
  z.object({ op: z.literal('status'), token: CliToken }).strict(),
  z.object({ op: z.literal('list'), token: CliToken }).strict(),
  z.object({
    op: z.literal('send'),
    token: CliToken,
    to: ChatName,
    message: z.string().trim().min(1).max(16000),
    files: z.array(z.string().min(1).max(32768)).max(MAX_FILES),
    wait: z.boolean(),
    timeoutSeconds: z.number().int().min(1).max(MAX_WAIT_SECONDS),
  }).strict(),
  z.object({ op: z.literal('read'), token: CliToken, to: ChatName }).strict(),
  z.object({ op: z.literal('open'), token: CliToken, to: ChatName.optional() }).strict(),
]);
export type CliRequest = z.infer<typeof CliRequest>;
export type CliOperation = CliRequest['op'];
/** A request before the CLI adds the token; the conditional keeps each operation's own fields. */
export type CliRequestBody = CliRequest extends infer Request ? Request extends CliRequest ? Omit<Request, 'token'> : never : never;

export type CliErrorCode = 'unauthorized' | 'invalid' | 'too_large' | 'busy' | 'not_found' | 'ambiguous' | 'failed';
export type CliResponse<T = unknown> = { ok: true; value: T } | { ok: false; code: CliErrorCode; error: string };

export type ChatKind = 'worker' | 'team';
export type CliChat = { kind: ChatKind; id: string; name: string };
export type CliAnswer = { name: string; stage?: string; text: string; createdAt: string };

export type StatusValue = { version: string; orglets: number; crews: number; running: number };
export type ListValue = {
  orglets: { name: string; provider: string; model?: string }[];
  crews: { name: string; lead: string; members: string[] }[];
};
export type SendValue = {
  chat: CliChat;
  taskId: string;
  waited: boolean;
  /** False when `send` stopped waiting at its timeout while the turn was still running. */
  finished: boolean;
  status: string;
  answers: CliAnswer[];
  /** Why runs of this turn stopped, already in the app's language. */
  errors: string[];
};
export type ReadValue = { chat: CliChat; taskId: string; status: string; answers: CliAnswer[] };
export type OpenValue = { chat?: CliChat };
