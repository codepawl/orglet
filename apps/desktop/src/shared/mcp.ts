import { z } from 'zod';

/**
 * MCP servers the person added by hand (COD-241). The core keeps each server's shape without its secret values;
 * main keeps the values (environment variables, headers, a bearer token) encrypted with safeStorage, the way it
 * keeps API keys, and hands them to the core only when the core starts that server. The renderer sees names only.
 */
export const MCP_SERVER_LIMIT = 20;
/** Tools one server may offer to a run; more are left out and the Settings row says how many. */
export const MCP_TOOLS_PER_SERVER = 64;
/** Characters of one tool result a worker receives; the rest is cut and the result says so. */
export const MCP_RESULT_CHARACTERS = 24_000;
/** How long one tool call may take before it is cancelled. */
export const MCP_CALL_TIMEOUT_MS = 60_000;
/** How long a server may take to start and answer its first two requests. */
export const MCP_CONNECT_TIMEOUT_MS = 20_000;
/** The prefix every MCP tool carries in the tool loop, so a name can never collide with Orglet's own tools. */
export const MCP_TOOL_PREFIX = 'mcp__';

const TOOL_NAME_LIMIT = 64;
const SERVER_SLUG_LIMIT = 16;

export const McpServerName = z.string().trim().min(1).max(40);
/** An environment variable name as Windows and POSIX shells both accept it. */
export const McpVariableName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/, 'Tên biến môi trường không hợp lệ.');
/** An HTTP header name (RFC 9110 token), minus the headers the transport sets itself. */
export const McpHeaderName = z.string().regex(/^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,128}$/, 'Tên header không hợp lệ.')
  .refine(name => !['host', 'content-length', 'content-type', 'connection', 'transfer-encoding', 'accept', 'mcp-session-id', 'mcp-protocol-version'].includes(name.toLowerCase()), 'Header này do Orglet tự đặt.');
const SecretValue = z.string().min(1).max(8192);

/**
 * A remote server's address. HTTPS anywhere; plain HTTP only on this computer, since a bearer token or a header
 * sent over plain HTTP to another machine travels in the clear.
 */
export const McpUrl = z.string().trim().max(2048).refine(text => {
  try {
    const url = new URL(text);
    if (url.username || url.password) return false;
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}, 'Địa chỉ cần là https://, hoặc http:// trên chính máy này.');

const Command = z.string().trim().min(1).max(1024);
const Arguments = z.array(z.string().max(4096)).max(64);

/** How the core reaches a server, as the core stores it: secret values are absent, only their names are kept. */
export const McpStoredTransport = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('stdio'), command: Command, args: Arguments, envNames: z.array(McpVariableName).max(32) }).strict(),
  z.object({ kind: z.literal('http'), url: McpUrl, headerNames: z.array(McpHeaderName).max(16), bearer: z.boolean() }).strict(),
]);
export type McpStoredTransport = z.infer<typeof McpStoredTransport>;

/** A tool as Settings lists it: the server's name for it and the first line of what it does. */
export const McpToolSummary = z.object({ name: z.string().min(1).max(128), description: z.string().max(300) }).strict();
export type McpToolSummary = z.infer<typeof McpToolSummary>;

export const McpServer = z.object({
  id: z.uuid(),
  name: McpServerName,
  enabled: z.boolean(),
  transport: McpStoredTransport,
  revision: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  /** The tools the last successful listing returned; the Settings row shows them while the server is not running. */
  tools: z.array(McpToolSummary).max(MCP_TOOLS_PER_SERVER).optional(),
  /** How many tools the server offered beyond the cap, so the row can say some were left out. */
  omittedTools: z.number().int().nonnegative().optional(),
  checkedAt: z.iso.datetime().optional(),
}).strict();
export type McpServer = z.infer<typeof McpServer>;

/** What the core accepts from main when a server is saved: the stored shape without its bookkeeping. */
export const McpServerConfig = McpServer.pick({ id: true, name: true, enabled: true, transport: true }).strict();
export type McpServerConfig = z.infer<typeof McpServerConfig>;

/** The secret values of one server. Only main and the core ever hold these. */
export const McpSecrets = z.object({
  env: z.record(McpVariableName, SecretValue),
  headers: z.record(z.string(), SecretValue),
  bearer: SecretValue.optional(),
}).strict();
export type McpSecrets = z.infer<typeof McpSecrets>;
export const emptyMcpSecrets = (): McpSecrets => ({ env: {}, headers: {} });

/**
 * A named value as the renderer sends it. No `value` keeps the value already saved under that name, which is how an
 * edit leaves a secret alone without the window ever reading it back.
 */
const DraftEntry = <Name extends z.ZodType<string>>(name: Name) => z.object({ name, value: SecretValue.optional() }).strict();

/** A server as the Settings form sends it to main; main splits the values off before the core sees it. */
export const McpServerDraft = z.object({
  id: z.uuid().optional(),
  name: McpServerName,
  enabled: z.boolean(),
  transport: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('stdio'), command: Command, args: Arguments, env: z.array(DraftEntry(McpVariableName)).max(32) }).strict(),
    // bearer: a string sets the token, null removes it, absent keeps the saved one.
    z.object({ kind: z.literal('http'), url: McpUrl, headers: z.array(DraftEntry(McpHeaderName)).max(16), bearer: SecretValue.nullable().optional() }).strict(),
  ]),
}).strict().superRefine((draft, context) => {
  const names = draft.transport.kind === 'stdio' ? draft.transport.env.map(entry => entry.name) : draft.transport.headers.map(entry => entry.name.toLowerCase());
  if (new Set(names).size !== names.length) context.addIssue({ code: 'custom', message: 'Tên bị trùng.' });
});
export type McpServerDraft = z.infer<typeof McpServerDraft>;

/**
 * Splits a draft into what the core stores and the secret values main keeps. A name with no new value takes the
 * value saved before; a name that has neither is refused, so a server never starts with an empty secret.
 */
export function splitMcpDraft(draft: McpServerDraft, id: string, saved: McpSecrets): { config: McpServerConfig; secrets: McpSecrets } {
  const base = { id, name: draft.name, enabled: draft.enabled };
  if (draft.transport.kind === 'stdio') {
    const env: Record<string, string> = {};
    for (const entry of draft.transport.env) {
      const value = entry.value ?? saved.env[entry.name];
      if (!value) throw new Error(`Nhập giá trị cho biến ${entry.name}.`);
      env[entry.name] = value;
    }
    const transport = { kind: 'stdio' as const, command: draft.transport.command, args: draft.transport.args, envNames: draft.transport.env.map(entry => entry.name) };
    return { config: McpServerConfig.parse({ ...base, transport }), secrets: { env, headers: {} } };
  }
  const headers: Record<string, string> = {};
  for (const entry of draft.transport.headers) {
    const value = entry.value ?? saved.headers[entry.name];
    if (!value) throw new Error(`Nhập giá trị cho header ${entry.name}.`);
    headers[entry.name] = value;
  }
  const bearer = draft.transport.bearer === undefined ? saved.bearer : draft.transport.bearer ?? undefined;
  if (bearer && Object.keys(headers).some(name => name.toLowerCase() === 'authorization')) throw new Error('Dùng bearer token hoặc header Authorization, không dùng cả hai.');
  const transport = { kind: 'http' as const, url: draft.transport.url, headerNames: draft.transport.headers.map(entry => entry.name), bearer: Boolean(bearer) };
  return { config: McpServerConfig.parse({ ...base, transport }), secrets: { env: {}, headers, ...(bearer ? { bearer } : {}) } };
}

/** Whether a server is running for the core right now; `idle` has not been started since the app opened. */
export const McpServerStatus = z.enum(['disabled', 'idle', 'connecting', 'connected', 'error']);
export type McpServerStatus = z.infer<typeof McpServerStatus>;

/** A server as the window sees it: its shape with names but no values, and its current state. */
export type McpServerView = Omit<McpServer, 'revision'> & { status: McpServerStatus; error?: string };

/** A chat's standing permission: every tool of a server (`tool` null) or one tool, without asking again. */
export const McpGrant = z.object({ serverId: z.uuid(), tool: z.string().min(1).max(128).nullable() }).strict();
export type McpGrant = z.infer<typeof McpGrant>;

/** The four answers to an approval card; the first three let the call run, `refuse` sends the refusal back to the worker. */
export const McpApprovalChoice = z.enum(['once', 'tool', 'server', 'refuse']);
export type McpApprovalChoice = z.infer<typeof McpApprovalChoice>;

/** What the approval card shows: which tool of which server, and the arguments the worker chose (cut to fit). */
export const McpApproval = z.object({
  serverId: z.uuid(),
  serverName: McpServerName,
  tool: z.string().min(1).max(128),
  arguments: z.string().max(2000),
}).strict();
export type McpApproval = z.infer<typeof McpApproval>;

/**
 * One MCP tool as a run froze it when it started: the name the model calls, which server and tool that is, and the
 * schema it was offered. A resumed run offers the same list, even if the server changed its tools since.
 */
export const McpRunTool = z.object({
  name: z.string().regex(/^mcp__[A-Za-z0-9_-]{1,59}$/),
  serverId: z.uuid(),
  serverName: McpServerName,
  tool: z.string().min(1).max(128),
  description: z.string().max(1200),
  inputSchema: z.record(z.string(), z.unknown()),
  readOnly: z.boolean(),
}).strict();
export type McpRunTool = z.infer<typeof McpRunTool>;

export function isMcpToolName(name: string) {
  return name.startsWith(MCP_TOOL_PREFIX);
}

/** Lowercase letters, digits and single underscores, never empty. */
function slug(text: string, limit: number) {
  const cleaned = text.normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase().slice(0, limit).replace(/_+$/, '');
  return cleaned || 'server';
}

/** A short, stable suffix that keeps two names apart once both were cut to fit. */
function shortHash(text: string) {
  let hash = 2166136261;
  for (const character of text) {
    hash ^= character.codePointAt(0)!;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(36).slice(0, 5);
}

/**
 * Model-facing names for every tool of the servers a run may use: `mcp__<server>__<tool>`, at most 64 characters of
 * `[A-Za-z0-9_-]`, the limit every provider accepts. Two servers with the same slug, or two tools that clean up to
 * the same name, get a suffix so every name is unique within the run.
 */
export function mcpToolNames(entries: readonly { serverId: string; serverName: string; tool: string }[]): string[] {
  const serverSlugs = new Map<string, string>();
  const takenSlugs = new Set<string>();
  for (const entry of entries) {
    if (serverSlugs.has(entry.serverId)) continue;
    const base = slug(entry.serverName, SERVER_SLUG_LIMIT);
    let candidate = base;
    for (let counter = 2; takenSlugs.has(candidate); counter++) candidate = `${base}_${counter}`;
    takenSlugs.add(candidate);
    serverSlugs.set(entry.serverId, candidate);
  }
  const takenNames = new Set<string>();
  return entries.map(entry => {
    const prefix = `${MCP_TOOL_PREFIX}${serverSlugs.get(entry.serverId)}__`;
    const room = TOOL_NAME_LIMIT - prefix.length;
    const cleaned = entry.tool.replace(/[^A-Za-z0-9_-]+/g, '_') || 'tool';
    let name = `${prefix}${cleaned.slice(0, room)}`;
    if (cleaned.length > room || takenNames.has(name)) name = `${prefix}${cleaned.slice(0, room - 6)}_${shortHash(entry.tool)}`;
    takenNames.add(name);
    return name;
  });
}

/** The arguments of a call as the approval card shows them: compact JSON, cut to what the card has room for. */
export function approvalArguments(argumentsText: string) {
  let compact = argumentsText;
  try {
    compact = JSON.stringify(JSON.parse(argumentsText), null, 2);
  } catch {
    // The call was validated as JSON before it reached here; keep the text as it came if it somehow is not.
  }
  const characters = Array.from(compact);
  return characters.length > 2000 ? `${characters.slice(0, 1999).join('')}…` : compact;
}

/** Whether the chat already allows this call without asking: the whole server, or this one tool of it. */
export function mcpCallGranted(grants: readonly McpGrant[] | undefined, serverId: string, tool: string) {
  return (grants ?? []).some(grant => grant.serverId === serverId && (grant.tool === null || grant.tool === tool));
}

/** The chat's grants after one approval answer; `once` and `refuse` leave them as they were. */
export function grantsAfterApproval(grants: readonly McpGrant[] | undefined, approval: Pick<McpApproval, 'serverId' | 'tool'>, choice: McpApprovalChoice): McpGrant[] {
  const current = [...(grants ?? [])];
  if (choice === 'tool' && !mcpCallGranted(current, approval.serverId, approval.tool)) current.push({ serverId: approval.serverId, tool: approval.tool });
  if (choice === 'server') return [...current.filter(grant => grant.serverId !== approval.serverId), { serverId: approval.serverId, tool: null }];
  return current;
}

const ImportedServer = z.object({
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  type: z.string().optional(),
  disabled: z.boolean().optional(),
}).passthrough();
const ImportFile = z.object({ mcpServers: z.record(z.string(), ImportedServer).optional(), servers: z.record(z.string(), ImportedServer).optional() }).passthrough();

/**
 * Reads a file the person picked: the `mcpServers` shape most apps write (`servers` in VS Code's). Each entry becomes
 * a draft with its values, which main stores encrypted. An `Authorization: Bearer …` header becomes the bearer token.
 * Entries Orglet cannot use are listed as skipped with the reason. Nothing here looks for a file on its own.
 */
export function parseMcpImport(text: string): { drafts: McpServerDraft[]; skipped: { name: string; reason: string }[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Tệp không phải JSON hợp lệ.');
  }
  const parsed = ImportFile.safeParse(raw);
  if (!parsed.success) throw new Error('Tệp không có danh sách máy chủ MCP.');
  const entries = Object.entries(parsed.data.mcpServers ?? parsed.data.servers ?? {});
  if (!entries.length) throw new Error('Tệp không có danh sách máy chủ MCP.');
  const drafts: McpServerDraft[] = [];
  const skipped: { name: string; reason: string }[] = [];
  for (const [name, entry] of entries.slice(0, MCP_SERVER_LIMIT)) {
    const draft = importedDraft(name, entry);
    if ('reason' in draft) skipped.push({ name, reason: draft.reason });
    else drafts.push(draft.draft);
  }
  for (const [name] of entries.slice(MCP_SERVER_LIMIT)) skipped.push({ name, reason: `Chỉ nhập tối đa ${MCP_SERVER_LIMIT} máy chủ.` });
  return { drafts, skipped };
}

function importedDraft(name: string, entry: z.infer<typeof ImportedServer>): { draft: McpServerDraft } | { reason: string } {
  const enabled = entry.disabled !== true;
  if (entry.command) {
    const env = Object.entries(entry.env ?? {}).filter(([, value]) => value !== '').map(([variable, value]) => ({ name: variable, value }));
    const result = McpServerDraft.safeParse({ name: name.slice(0, 40), enabled, transport: { kind: 'stdio', command: entry.command, args: entry.args ?? [], env } });
    return result.success ? { draft: result.data } : { reason: result.error.issues[0]?.message ?? 'Không hợp lệ.' };
  }
  if (entry.url) {
    let bearer: string | undefined;
    const headers: { name: string; value: string }[] = [];
    for (const [header, value] of Object.entries(entry.headers ?? {})) {
      const token = /^Bearer\s+(.+)$/i.exec(value);
      if (header.toLowerCase() === 'authorization' && token) bearer = token[1].trim();
      else if (value !== '') headers.push({ name: header, value });
    }
    const result = McpServerDraft.safeParse({ name: name.slice(0, 40), enabled, transport: { kind: 'http', url: entry.url, headers, ...(bearer ? { bearer } : {}) } });
    return result.success ? { draft: result.data } : { reason: result.error.issues[0]?.message ?? 'Không hợp lệ.' };
  }
  return { reason: 'Thiếu command hoặc url.' };
}
