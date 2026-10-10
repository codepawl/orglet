import { createHash } from 'node:crypto';
import { join, win32 } from 'node:path';
import { z } from 'zod';
import { RunActivity } from '../shared/run-activity';
import { FORWARD_NOTE_CHARS, MAX_FORWARD_TARGETS } from '../shared/forward';
import { Reaction } from '../shared/message-interactions';
import { ClockTime, EveryHours, MAX_DAILY_CAP_MICROS, ScheduleFrequency } from '../shared/schedule';
import { FormatPreference, ProviderId } from '../shared/contracts';
import { FontFamily } from '../shared/fonts';
import { Language } from '../shared/i18n';
import { MEMORY_TEXT_LIMIT } from '../shared/knowledge';
import { CHANNEL_TOPIC_LIMIT, ChannelName } from '../shared/channels';
import { ElevationScope } from '../shared/terminal-access';
import { HeldBody, PairingId } from './held-protocol';
import { ChannelPatch, ChannelTarget, ManagementTarget, OrgletPatch } from './management';

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
/** A chat by the start of its id, as `orglet chats` prints it (COD-354): side threads and channels are found this way. */
export const ChatId = z.string().trim().regex(/^#?[0-9a-f-]{4,36}$/i);
/** A chat named by its orglet or crew (`to`) or by its id (`chat`); the app refuses both or neither. */
const ChatTarget = { to: ChatName.optional(), chat: ChatId.optional() };
/** The orglets and crews of a channel, by name (COD-361). */
const MemberNames = z.array(ChatName).min(1).max(50);
/** The crew templates the core can create, as `createTemplate` names them. */
export const TEMPLATE_IDS = ['research-review', 'writing-desk', 'data-check'] as const;
/** What a chat can be renamed, archived, restored or deleted as. */
export const ChatChange = z.enum(['rename', 'archive', 'restore', 'delete']);
export type ChatChange = z.infer<typeof ChatChange>;
/** A schedule (routine) is named the way the app names it: up to 80 characters. */
const ScheduleName = z.string().trim().min(1).max(80);
/** What `orglet show` can look at. All read-only; none of them carries a key, a token or a file's content. */
export const SHOW_TOPICS = ['connections', 'spend', 'changelog', 'update', 'browser', 'desktop', 'sources', 'changes', 'terminal'] as const;
export type ShowTopic = typeof SHOW_TOPICS[number];
/** How many past turns one `read` returns at most (COD-354). */
export const MAX_READ_TURNS = 50;
/**
 * One message of a chat as `read --turns` numbers it (COD-354): `3` is the person's third message, `3.2` the second
 * answer to it, `last` the newest answer. A leading `#` is allowed, as the terminal prints it.
 */
export const MessageRef = z.string().trim().regex(/^#?(last|\d{1,6}(\.\d{1,3})?)$/i);
export const UserMessageRef = z.string().trim().regex(/^#?[1-9]\d{0,5}$/);
const Answer = z.string().trim().min(1).max(2000);
const Message = z.string().trim().min(1).max(16000);
const WaitFields = { wait: z.boolean(), timeoutSeconds: z.number().int().min(1).max(MAX_WAIT_SECONDS) };
/** Files for a message, as absolute paths the app imports the way the file picker does; `send` and `run` carry theirs as a required list. */
const FileFields = { files: z.array(z.string().min(1).max(32768)).max(MAX_FILES).optional() };
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
  z.object({ op: z.literal('save-crew'), token: CliToken, config: ChannelPatch, target: ChannelTarget.optional() }).strict(),
  z.object({ op: z.literal('delete-entity'), token: CliToken, kind: z.enum(['worker', 'team']), target: ChannelTarget, confirmName: ChatName }).strict(),
  z.object({
    op: z.literal('send'),
    token: CliToken,
    ...ChatTarget,
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
    ...ChatTarget,
    turns: z.number().int().min(1).max(MAX_READ_TURNS).optional(),
    /** With `turns`, the turns before this turn number: the next page back. */
    before: z.number().int().min(1).optional(),
  }).strict(),
  z.object({ op: z.literal('react'), token: CliToken, ...ChatTarget, message: MessageRef.optional(), emoji: Reaction, active: z.boolean() }).strict(),
  z.object({
    op: z.literal('forward'),
    token: CliToken,
    ...ChatTarget,
    message: MessageRef.optional(),
    targets: z.array(ChatName).min(1).max(MAX_FORWARD_TARGETS),
    note: z.string().trim().min(1).max(FORWARD_NOTE_CHARS).optional(),
  }).strict(),
  z.object({ op: z.literal('control'), token: CliToken, ...ChatTarget, action: ChatControl, ...WaitFields }).strict(),
  z.object({ op: z.literal('answer'), token: CliToken, ...ChatTarget, answer: Answer, ...WaitFields }).strict(),
  z.object({ op: z.literal('revise'), token: CliToken, ...ChatTarget, message: UserMessageRef, text: Message, ...FileFields, ...WaitFields }).strict(),
  z.object({ op: z.literal('chats'), token: CliToken, archived: z.boolean(), space: ChatName.optional() }).strict(),
  z.object({ op: z.literal('side-thread'), token: CliToken, ...ChatTarget, message: Message, ...FileFields, ...WaitFields }).strict(),
  z.object({ op: z.literal('bring'), token: CliToken, chat: ChatId, message: MessageRef.optional() }).strict(),
  // With `space` the names may be empty: the channel then takes every orglet of its place.
  z.object({ op: z.literal('channel'), token: CliToken, names: z.array(ChatName).max(50), message: Message.optional(), name: ChannelName.optional(), topic: z.string().trim().max(CHANNEL_TOPIC_LIMIT).optional(), space: ChatName.optional(), category: ChatName.optional(), ...FileFields, ...WaitFields }).strict(),
  z.object({ op: z.literal('members'), token: CliToken, chat: ChatId, names: MemberNames }).strict(),
  z.object({
    op: z.literal('chat-change'),
    token: CliToken,
    ...ChatTarget,
    change: ChatChange,
    title: z.string().trim().min(1).max(120).optional(),
    confirmName: z.string().trim().min(1).max(200).optional(),
  }).strict(),
  z.object({ op: z.literal('archive-entity'), token: CliToken, kind: z.enum(['worker', 'team']), name: ChatName, archived: z.boolean() }).strict(),
  z.object({ op: z.literal('template'), token: CliToken, templateId: z.enum(TEMPLATE_IDS), provider: z.enum(['demo', 'openai']) }).strict(),
  z.object({ op: z.literal('schedules'), token: CliToken }).strict(),
  z.object({ op: z.literal('spaces'), token: CliToken }).strict(),
  // `update` shows what an installed listing's update changes and a code for it; with that code in `confirmCode` it applies exactly that update.
  z.object({
    op: z.literal('market'), token: CliToken, verb: z.enum(['list', 'installed', 'add', 'update']),
    listingId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/).optional(), installed: ChatName.optional(), confirmCode: z.string().regex(/^[a-f0-9]{8}$/).optional(), refresh: z.boolean(),
  }).strict(),
  z.object({
    op: z.literal('space-change'), token: CliToken, verb: z.enum(['add', 'edit', 'category', 'uncategory', 'move', 'out', 'delete', 'folder', 'color', 'order']),
    space: ChatName.optional(), names: z.array(ChatName).max(50), rename: ChatName.optional(), category: ChatName.optional(),
    chat: ChatId.optional(), channelName: ChannelName.optional(), confirmName: ChatName.optional(),
    /** `folder` and `color`: the new value; left out takes the space out of its folder, or back to the default colour. */
    value: z.string().trim().min(1).max(40).optional(),
    /** `order`: the 1-based place the channel or category moves to. */
    position: z.number().int().min(1).max(1000).optional(),
  }).strict(),
  z.object({ op: z.literal('schedule-notice'), token: CliToken, schedule: ScheduleName, action: z.enum(['dismiss', 'catch-up']) }).strict(),
  // Who answers a chat and its cost limit. The limit may only go down here: raising what a chat may spend is a money limit the person sets in the window.
  z.object({ op: z.literal('chat-settings'), token: CliToken, ...ChatTarget, names: z.array(ChatName).max(50).optional(), budgetMicros: z.number().int().min(1000).max(100_000_000).optional() }).strict(),
  z.object({ op: z.literal('show'), token: CliToken, what: z.enum(SHOW_TOPICS), ...ChatTarget, refresh: z.boolean() }).strict(),
  z.object({ op: z.literal('update-check'), token: CliToken }).strict(),
  // A note waits for the person's review in the window before any orglet reads it.
  z.object({ op: z.literal('note'), token: CliToken, title: z.string().trim().min(1).max(200), content: z.string().trim().min(1).max(8000), tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(), pinned: z.boolean().optional() }).strict(),
  z.object({ op: z.literal('schedule-enable'), token: CliToken, schedule: ScheduleName, enabled: z.boolean() }).strict(),
  z.object({ op: z.literal('schedule-delete'), token: CliToken, schedule: ScheduleName, confirmName: ScheduleName }).strict(),
  /**
   * Creates a schedule, or with `schedule` edits that one; only these fields. No permission, browser, desktop, folder,
   * folder trigger, source or provider field exists here: the app takes the providers from the orglet or crew and
   * refuses ones not already allowed in Settings.
   */
  z.object({
    op: z.literal('schedule-save'),
    token: CliToken,
    schedule: ScheduleName.optional(),
    name: ScheduleName.optional(),
    target: ChatName.optional(),
    brief: Message.optional(),
    frequency: ScheduleFrequency.optional(),
    time: ClockTime.optional(),
    weekday: z.number().int().min(0).max(6).optional(),
    everyHours: EveryHours.optional(),
    timeZone: z.string().trim().min(1).max(100).optional(),
    budgetMicros: z.number().int().min(1000).max(100_000_000).optional(),
    dailyCapMicros: z.number().int().min(1000).max(MAX_DAILY_CAP_MICROS).optional(),
    trigger: z.enum(['schedule', 'called']).optional(),
    enabled: z.boolean().optional(),
  }).strict(),
  z.object({ op: z.literal('search'), token: CliToken, query: z.string().trim().min(1).max(2000), space: ChatName.optional() }).strict(),
  z.object({ op: z.literal('running'), token: CliToken, space: ChatName.optional() }).strict(),
  z.object({ op: z.literal('library'), token: CliToken, kind: z.enum(['memory', 'note']), query: z.string().trim().min(1).max(200).optional(), owner: ChatName.optional() }).strict(),
  z.object({ op: z.literal('memory-edit'), token: CliToken, id: ChatId, text: z.string().trim().min(1).max(MEMORY_TEXT_LIMIT).optional(), pinned: z.boolean().optional() }).strict(),
  // Deleting needs one of two things: `confirmed` from `--yes`, or `confirm` typed with `--confirm`, which the app compares with the memory's id or text.
  z.object({ op: z.literal('memory-delete'), token: CliToken, id: ChatId, confirmed: z.literal(true).optional(), confirm: z.string().trim().min(1).max(MEMORY_TEXT_LIMIT).optional() }).strict()
    .refine(request => request.confirmed === true || request.confirm !== undefined, 'A delete must be confirmed.'),
  z.object({ op: z.literal('usage'), token: CliToken, refresh: z.boolean() }).strict(),
  z.object({ op: z.literal('models'), token: CliToken, provider: ProviderId.optional(), to: ChatName.optional(), refresh: z.boolean() }).strict(),
  /** Looks and behaviour only; keys, consent, money limits and provider choices stay in the desktop. */
  z.object({
    op: z.literal('preferences'), token: CliToken, language: Language.optional(), theme: z.enum(['system', 'light', 'dark']).optional(),
    autoTitles: z.boolean().optional(), confirmOpenTask: z.boolean().optional(),
    copyFormat: FormatPreference.optional(), downloadFormat: FormatPreference.optional(),
    archiveRetentionDays: z.union([z.literal(0), z.literal(7), z.literal(30)]).optional(),
    autoUpdate: z.boolean().optional(), backgroundNotifications: z.boolean().optional(),
    accentColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
    /** A font family, or `null` for the font the app ships with. */
    interfaceFont: FontFamily.nullable().optional(), codeFont: FontFamily.nullable().optional(),
  }).strict(),
  z.object({ op: z.literal('open'), token: CliToken, to: ChatName.optional() }).strict(),
  // Pairing and the held operations (docs/cli-held-actions-design.md). `elevation` rides beside the token on a request
  // line and is read by the server before this schema runs, so it is not a field of any operation.
  z.object({ op: z.literal('pair-start'), token: CliToken, scope: ElevationScope, operation: HeldBody.optional() }).strict()
    .refine(request => (request.scope === 'one') === (request.operation !== undefined), 'A one-operation pairing names the operation, and no other scope does.'),
  z.object({ op: z.literal('pair-finish'), token: CliToken, pairingId: PairingId, code: z.string().min(1).max(32) }).strict(),
  z.object({ op: z.literal('pair-cancel'), token: CliToken, pairingId: PairingId }).strict(),
  z.object({ op: z.literal('elevation-end'), token: CliToken }).strict(),
  z.object({ op: z.literal('waiting'), token: CliToken, to: ChatName.optional(), chat: ChatId.optional() }).strict(),
  z.object({ op: z.literal('held'), token: CliToken, request: HeldBody }).strict(),
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

/** `locked`: the operation needs an elevation the request does not carry, or the one it carries has ended. */
export type CliErrorCode = 'unauthorized' | 'invalid' | 'too_large' | 'busy' | 'not_found' | 'ambiguous' | 'failed' | 'locked';
/** A request body with the elevation key a held operation carries beside the token. */
export type CliElevatedBody = CliRequestBody & { elevation?: string };
export type CliResponse<T = unknown> = { ok: true; value: T } | { ok: false; code: CliErrorCode; error: string };
export const CliResponseFrame = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: z.unknown() }).strict(),
  z.object({ ok: z.literal(false), code: z.enum(['unauthorized', 'invalid', 'too_large', 'busy', 'not_found', 'ambiguous', 'failed', 'locked']), error: z.string() }).strict(),
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
  /** Set when the chat is not an orglet's or crew's main chat: a side thread or a channel, by its id (COD-354). */
  taskId?: string;
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

/** `channels` counts every channel, those that take turns too; `crews` is the older count of channels with a lead, kept for one release. */
export type StatusValue = { version: string; orglets: number; channels?: number; crews: number; running: number; colors?: string[] };
/**
 * A channel as `orglet list` names it. `mode` is how it answers: `turns` has each orglet answer in turn, `lead` has the
 * lead split the work. `chat` is the start of the id of its chat, which a channel nobody has written in yet lacks.
 */
export type CliListedChannel = { name: string; mode: 'turns' | 'lead'; lead?: string; members: string[]; space?: string; category?: string; colors?: string[]; chat?: string };
export type ListValue = {
  orglets: { name: string; provider: string; providerId?: string; model?: string; color?: string; description?: string; billing?: string }[];
  /** Every channel, grouped by space in the order the app keeps them. An app older than this field sends only `crews`. */
  channels?: CliListedChannel[];
  /** The channels where a lead splits the work, as before channels took turns; kept for one release, `channels` covers them. */
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
  /** The space a channel `orglet channel` made is in. */
  space?: string;
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
export type ControlValue = SendValue & { action: ChatControl | 'answer' | 'revise' };
/** Which kind of chat a row is: an orglet's or crew's main chat, a side thread, a channel or a schedule's run. */
export type CliChatKind = 'orglet' | 'crew' | 'side' | 'channel' | 'schedule';
/** One chat as `orglet chats` lists it (COD-354); `short` is the start of its id that `--chat` takes. */
export type CliChatRow = { id: string; short: string; kind: CliChatKind; name: string; with: string[]; status: string; archived: boolean; createdAt: string; color?: string; space?: string };
export type ChatsValue = { chats: CliChatRow[] };
export type BringValue = { mainTaskId: string; chat: CliChat; ref: string };
export type MembersValue = { taskId: string; names: string[] };
export type ChatChangeValue = { taskId: string; name: string; change: ChatChange; title?: string };
export type ArchiveEntityValue = { kind: ChatKind; id: string; name: string; archived: boolean };
export type TemplateValue = { id: string; name: string; members: string[]; space?: string };
/** One schedule as `orglet schedules` lists it (COD-354); money is integer micros, as the app keeps it. */
export type CliScheduleRow = {
  id: string;
  name: string;
  enabled: boolean;
  target: string;
  trigger: 'schedule' | 'folder' | 'called' | 'app';
  frequency: 'daily' | 'weekdays' | 'weekly' | 'hours';
  time: string;
  weekday: number;
  everyHours?: number;
  timeZone: string;
  nextDueAt: string;
  budgetMicros: number;
  dailyCapMicros?: number;
  runsToday?: number;
  spentTodayMicros?: number;
};
export type SchedulesValue = { schedules: CliScheduleRow[] };
/** One space as `orglet spaces` lists it (docs/spaces-design.md): its orglets, then each channel with who is in it. */
export type CliSpaceRow = {
  name: string;
  orglets: string[];
  categories: string[];
  channels: { name: string; mode?: 'turns' | 'lead'; lead?: string; category?: string; access: 'inherit' | 'listed'; orglets: string[] }[];
};
export type SpacesValue = { spaces: CliSpaceRow[] };
/** The marketplace as `orglet market` lists it; `source` says whether the catalog came from the service, a saved copy or the app itself. */
export type MarketListValue = {
  source: 'online' | 'cache' | 'bundled'; more: boolean; error?: string;
  listings: { id: string; version: number; kind: 'orglet' | 'crew' | 'space'; name: string; summary: string; author: string; language: string }[];
};
export type MarketInstalledValue = { installed: { id: string; version: number; kind: 'orglet' | 'crew' | 'space'; name: string; updateAvailable: boolean }[] };
/** What `orglet market add` made; `withoutModel` names the orglets whose suggested connection this computer lacks. */
export type MarketAddValue = { id: string; version: number; kind: 'orglet' | 'crew' | 'space'; name: string; orglets: string[]; withoutModel: string[] };
/** What `orglet space` changed: the space by its name now, and the channel or category the step was about. */
export type SpaceChangeValue = { verb: 'add' | 'edit' | 'category' | 'uncategory' | 'move' | 'out' | 'delete' | 'folder' | 'color' | 'order'; space?: string; channel?: string; category?: string; orglets?: string[]; existing?: boolean; value?: string; position?: number };
/** A channel `orglet channel` made with no first message. */
export type ChannelCreatedValue = { channel: string; space?: string };
/** What `orglet search` found (COD-354): names that match, and one message per chat with the words around the match. */
export type SearchValue = {
  orglets: string[];
  crews: string[];
  chats: { chat: string; name: string; sender?: string; snippet: string; at: string }[];
  /** Chats from before search covered every message are still being added. */
  indexing: boolean;
};
/** One run of the Running view: the chat it is in, who runs it, and what it waits for. */
export type CliRunningRow = { chat: string; name: string; orglet: string; state: string; provider: string; waitsFor?: string; since?: string };
export type RunningValue = { items: CliRunningRow[] };
/** A note or memory of the Library; `short` is the start of its id that `memory edit` takes. */
export type CliLibraryRow = { id: string; short: string; kind: 'note' | 'memory'; title: string; content: string; status: string; pinned: boolean; owner?: string; createdAt: string };
export type LibraryValue = { items: CliLibraryRow[] };
/** Plan usage of one harness account; the email is shown only in part. */
export type CliUsageAccount = {
  harness: string;
  email?: string;
  plan?: string;
  windows: { kind: string; usedPercent: number; model?: string; resetsAt?: string }[];
  unavailable?: string;
  asOf?: string;
};
export type UsageValue = { accounts: CliUsageAccount[] };
export type ModelsValue = { provider: string; models: { id: string; name?: string; deprecated?: boolean }[]; fetchedAt: string; stale: boolean; error?: string };
export type PreferencesValue = {
  language: string; theme: string;
  /** The rest are absent from an app older than the preferences listing. */
  autoTitles?: boolean; confirmOpenTask?: boolean; copyFormat?: string; downloadFormat?: string; archiveRetentionDays?: number;
  autoUpdate?: boolean; backgroundNotifications?: boolean; accentColor?: string; interfaceFont?: string | null; codeFont?: string | null;
};
/** What `market update` found, and whether this call applied it: `code` is what `--confirm` takes to apply exactly this update. */
export type MarketUpdateValue = { name: string; installedVersion: number; version: number; changes: { name: string; before: string; after: string }[]; code: string; applied: boolean };
/** A row of `orglet show`: flat values the terminal prints as columns and `--json` keeps as they are. */
export type ShowRow = Record<string, string | number | boolean | null>;
export type ShowValue = { what: ShowTopic; rows: ShowRow[]; note?: string };
export type ChatSettingsValue = { taskId: string; name: string; with: string[]; budgetMicros: number };
export type NoteValue = { id: string; short: string; title: string };
export type ScheduleNoticeValue = { schedule: { id: string; name: string }; action: 'dismiss' | 'catch-up'; taskId?: string };
export type UpdateCheckValue = { status: string; version?: string; message?: string; checkedAt?: string };
export type ScheduleValue = { schedule: CliScheduleRow };
export type OpenValue = { chat?: CliChat };
/** The schedule `run` started and the chat its run opened. */
export type RunValue = { schedule: { id: string; name: string }; taskId: string };
