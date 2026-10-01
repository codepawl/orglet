import { createHash } from 'node:crypto';
import { join, win32 } from 'node:path';
import { z } from 'zod';
import { RunActivity } from '../shared/run-activity';
import { FORWARD_NOTE_CHARS, MAX_FORWARD_TARGETS } from '../shared/forward';
import { Reaction } from '../shared/message-interactions';
import { CrewPatch, ManagementTarget, OrgletPatch } from './management';

/**
 * The line protocol between the `orglet` command and the running app (COD-234). One JSON request per line, one JSON
 * response per line. Main and the CLI both import this file, so the endpoint, the token file and the request shape
 * cannot drift apart. Node only: no Electron, no renderer.
 */

/** Written by main on every start, read by the CLI before each request. */
export const CLI_TOKEN_FILE = 'cli-token';
/** A terminal command starts only the local backend; `open` explicitly creates the desktop window. */
export const CLI_BACKGROUND_FLAG = '--orglet-cli-background';
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
/** A schedule (routine) is named the way the app names it: up to 80 characters. */
const ScheduleName = z.string().trim().min(1).max(80);
/** How many past turns one `read` returns at most (COD-354). */
export const MAX_READ_TURNS = 50;
/**
 * One message of a chat as `read --turns` numbers it (COD-354): `3` is the person's third message, `3.2` the second
 * answer to it, `last` the newest answer. A leading `#` is allowed, as the terminal prints it.
 */
export const MessageRef = z.string().trim().regex(/^#?(last|\d{1,6}(\.\d{1,3})?)$/i);
const Answer = z.string().trim().min(1).max(2000);
const WaitFields = { wait: z.boolean(), timeoutSeconds: z.number().int().min(1).max(MAX_WAIT_SECONDS) };
/** Controls on a chat's latest turn, the buttons under it in the desktop (COD-354). */
export const ChatControl = z.enum(['stop', 'pause', 'resume', 'retry', 'continue']);
export type ChatControl = z.infer<typeof ChatControl>;

/**
 * Everything the CLI may ask. Anything else has no operation here and is refused. Trust decisions stay in the
 * desktop (COD-354): browser, desktop and MCP approvals, folder grants, tool permissions, keys and connections, harness
 * sign-in, knowledge and app-change proposals, backups, erase and the account. The pipe token sits in the data folder,
 * which an orglet running through a harness CLI can read as the same user, so anything the pipe could approve an
 * orglet could approve for itself. Person-driven configuration changes use a whitelist and revision checks; deletion
 * also requires the displayed full name. `run` starts a schedule that already exists, is switched on and was approved
 * as it is (COD-245).
 */
export const CliRequest = z.discriminatedUnion('op', [
  z.object({ op: z.literal('status'), token: CliToken }).strict(),
  z.object({ op: z.literal('list'), token: CliToken }).strict(),
  z.object({ op: z.literal('config'), token: CliToken }).strict(),
  z.object({ op: z.literal('save-orglet'), token: CliToken, config: OrgletPatch, target: ManagementTarget.optional() }).strict(),
  z.object({ op: z.literal('save-crew'), token: CliToken, config: CrewPatch, target: ManagementTarget.optional() }).strict(),
  z.object({ op: z.literal('delete-entity'), token: CliToken, kind: z.enum(['worker', 'team']), target: ManagementTarget, confirmName: ChatName }).strict(),
  z.object({
    op: z.literal('send'),
    token: CliToken,
    to: ChatName,
    message: z.string().trim().min(1).max(16000),
    files: z.array(z.string().min(1).max(32768)).max(MAX_FILES),
    wait: z.boolean(),
    progress: z.boolean().optional(),
    timeoutSeconds: z.number().int().min(1).max(MAX_WAIT_SECONDS),
    replyTo: MessageRef.optional(),
  }).strict(),
  z.object({
    op: z.literal('read'),
    token: CliToken,
    to: ChatName,
    turns: z.number().int().min(1).max(MAX_READ_TURNS).optional(),
    /** With `turns`, the turns before this turn number: the next page back. */
    before: z.number().int().min(1).optional(),
  }).strict(),
  z.object({ op: z.literal('react'), token: CliToken, to: ChatName, message: MessageRef.optional(), emoji: Reaction, active: z.boolean() }).strict(),
  z.object({
    op: z.literal('forward'),
    token: CliToken,
    to: ChatName,
    message: MessageRef.optional(),
    targets: z.array(ChatName).min(1).max(MAX_FORWARD_TARGETS),
    note: z.string().trim().min(1).max(FORWARD_NOTE_CHARS).optional(),
  }).strict(),
  z.object({ op: z.literal('control'), token: CliToken, to: ChatName, action: ChatControl, ...WaitFields }).strict(),
  z.object({ op: z.literal('answer'), token: CliToken, to: ChatName, answer: Answer, ...WaitFields }).strict(),
  z.object({ op: z.literal('open'), token: CliToken, to: ChatName.optional() }).strict(),
  z.object({
    op: z.literal('run'),
    token: CliToken,
    schedule: ScheduleName,
    files: z.array(z.string().min(1).max(32768)).max(MAX_FILES),
  }).strict(),
]);
export type CliRequest = z.infer<typeof CliRequest>;
export type CliOperation = CliRequest['op'];
/** A request before the CLI adds the token; the conditional keeps each operation's own fields. */
export type CliRequestBody = CliRequest extends infer Request ? Request extends CliRequest ? Omit<Request, 'token'> : never : never;

export type CliErrorCode = 'unauthorized' | 'invalid' | 'too_large' | 'busy' | 'not_found' | 'ambiguous' | 'failed';
export type CliResponse<T = unknown> = { ok: true; value: T } | { ok: false; code: CliErrorCode; error: string };
export const CliResponseFrame = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: z.unknown() }).strict(),
  z.object({ ok: z.literal(false), code: z.enum(['unauthorized', 'invalid', 'too_large', 'busy', 'not_found', 'ambiguous', 'failed']), error: z.string() }).strict(),
]);

export const CliActivity = RunActivity.extend({ name: z.string().max(80), color: z.string().regex(/^#[a-f0-9]{6}$/i).optional() });
export type CliActivity = z.infer<typeof CliActivity>;
export const CliProgressFrame = z.object({
  type: z.literal('progress'),
  taskId: z.string().min(1).max(100),
  steps: z.array(CliActivity).max(500),
  omitted: z.number().int().nonnegative(),
}).strict();
export type CliProgressFrame = z.infer<typeof CliProgressFrame>;

export type ChatKind = 'worker' | 'team';
/**
 * The colour fields (COD-236) are `#rrggbb` avatar colours for the terminal faces. They are optional because an app
 * older than the command does not send them; the command then draws a neutral face.
 */
export type CliChat = {
  kind: ChatKind;
  id: string;
  name: string;
  /** The orglet's colour; for a crew, its lead's. */
  color?: string;
  /** A crew's orglets in crew order (members, then the lead), each in its colour. */
  colors?: string[];
};
export type CliAnswer = {
  name: string;
  stage?: string;
  text: string;
  createdAt: string;
  color?: string;
  /** Where `read --turns` numbers this answer, such as `3.1` (COD-354). */
  ref?: string;
  /** The person's reaction on it: one per message, as in the desktop. */
  reaction?: Reaction;
};
/** A question an orglet asked and is waiting on, with its choices (COD-354). */
export type CliQuestion = { question: string; options: string[] };
/** One message the person sent and what answered it, numbered from 1 the way the terminal prints it (COD-354). */
export type CliTurn = {
  number: number;
  text: string;
  sentAt: string;
  /** The message this one replied to, shortened. */
  replyTo?: string;
  /** Where a forwarded message came from. */
  forwardedFrom?: string;
  reaction?: Reaction;
  answers: CliAnswer[];
};

export type StatusValue = { version: string; orglets: number; crews: number; running: number; colors?: string[] };
export type ListValue = {
  orglets: { name: string; provider: string; providerId?: string; model?: string; color?: string; description?: string; billing?: string }[];
  crews: { name: string; lead: string; members: string[]; colors?: string[] }[];
};
export type SendValue = {
  chat: CliChat;
  taskId: string;
  /** The turn's number as `read --turns` prints it; absent from an app older than COD-354. */
  turn?: number;
  waited: boolean;
  /** False when `send` stopped waiting at its timeout while the turn was still running. */
  finished: boolean;
  status: string;
  answers: CliAnswer[];
  /** Why runs of this turn stopped, already in the app's language. */
  errors: string[];
  /** The question the turn stopped on, when an orglet asks one the terminal can answer (COD-354). */
  question?: CliQuestion;
  /** The turn stopped for something only the desktop decides: an MCP, browser or desktop approval (COD-354). */
  needsDesktop?: boolean;
};
export type ReadValue = {
  chat: CliChat;
  taskId: string;
  status: string;
  answers: CliAnswer[];
  /** With `turns`: the turns asked for, oldest first, and how many come before them (COD-354). */
  turns?: CliTurn[];
  earlier?: number;
  question?: CliQuestion;
  needsDesktop?: boolean;
};
/** What a reaction, a forward or a control changed (COD-354). */
export type ReactValue = { chat: CliChat; taskId: string; ref: string; emoji: Reaction; active: boolean };
export type ForwardValue = { sent: { name: string; taskId: string }[]; failed: { name: string; error: string }[] };
export type ControlValue = SendValue & { action: ChatControl | 'answer' };
export type OpenValue = { chat?: CliChat };
/** The schedule `run` started and the chat its run opened. */
export type RunValue = { schedule: { id: string; name: string }; taskId: string };
