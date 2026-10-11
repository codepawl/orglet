import { parseDocument } from 'yaml';
import { z } from 'zod';
import { McpServerDraft, MCP_SERVER_LIMIT, mcpDraftFromEntry } from './mcp';
import { PackageInput, SkillMetadata, SkillName } from './skill-package';
import { inspectPackageContent, supportedTools } from './skill-package-content';

/*
 * Reading another app's files without running or keeping any of it (docs/import-from-claude-code.md). Everything here
 * works on strings, so tests need no file system; main reads the files and hands them to these functions.
 */

export type ClaudeCodeItemKind = 'skill' | 'agent' | 'mcp';

/** What the subagent file said, kept for the window to turn into an orglet with the model and skill it can see. */
export type ClaudeCodeAgent = {
  name: string;
  description: string;
  instructions: string;
  model?: string;
  effort?: string;
  skills: string[];
};

/** One thing that could be imported. It never carries a secret: only names, transports and hosts. */
export type ClaudeCodeItem = {
  id: string;
  kind: ClaudeCodeItemKind;
  name: string;
  description: string;
  /** Where it was found, relative to the folder that was read. */
  source: string;
  /** What will not carry over, one plain sentence each. */
  notes: string[];
  alreadyHere: boolean;
  /** Why it cannot be imported at all; absent when it can. */
  blocked?: string;
  agent?: ClaudeCodeAgent;
};

export type ClaudeCodeListing = {
  /** The folder that was read, as the dialog shows it. */
  folder: string;
  project: boolean;
  items: ClaudeCodeItem[];
  /** Things that stopped part of the reading, such as a file that could not be parsed. Never file content. */
  warnings: string[];
};

export type ClaudeCodeImportResult = {
  id: string;
  kind: ClaudeCodeItemKind;
  name: string;
  status: 'imported' | 'skipped' | 'failed';
  reason?: string;
  /** The skill row a skill import created, so an orglet can be linked to it. */
  skillId?: string;
};

/** What a scan keeps beside the listing: the parts main needs to import, which never reach the window. */
export type ClaudeCodeEntry = { item: ClaudeCodeItem; skillPackage?: PackageInput; mcpDraft?: McpServerDraft; secrets?: string[] };

export const CLAUDE_CODE_RESERVED_SKILL_FOLDERS = ['synced', 'anthropic-skills'];
export const CLAUDE_CODE_FILE_LIMIT = 100;

// --- Frontmatter ------------------------------------------------------------------------------------------------

export type Frontmatter = { fields: Record<string, unknown>; body: string; present: boolean; lenient: boolean };

/**
 * Splits a markdown file into its frontmatter and body the way Claude Code does: a BOM and CRLF are tolerated, no
 * frontmatter is fine, and a block that is not valid YAML is read line by line instead of refused.
 */
export function parseFrontmatter(raw: string): Frontmatter {
  const text = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const end = lines[0]?.trimEnd() === '---' ? lines.findIndex((line, index) => index > 0 && line.trimEnd() === '---') : -1;
  if (end < 0) return { fields: {}, body: text.trim(), present: false, lenient: false };
  const block = lines.slice(1, end).join('\n');
  const body = lines.slice(end + 1).join('\n').trim();
  const strict = strictFields(block);
  if (strict) return { fields: strict, body, present: true, lenient: false };
  return { fields: lineFields(block), body, present: true, lenient: true };
}

function strictFields(block: string): Record<string, unknown> | undefined {
  try {
    const document = parseDocument(block, { schema: 'core', uniqueKeys: false, prettyErrors: false });
    if (document.errors.length) return undefined;
    const value = document.toJS({ maxAliasCount: 0 }) as unknown;
    if (value === null || value === undefined) return {};
    return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : undefined;
  } catch {
    return undefined;
  }
}

function lineFields(block: string): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const line of block.split('\n')) {
    const match = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!match) continue;
    fields[match[1]] = match[2].trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return fields;
}

const scalar = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
};

/** A list written as YAML items or as one comma-separated string; empty entries are dropped. */
export function nameList(value: unknown): string[] {
  const parts = Array.isArray(value) ? value.map(scalar) : typeof value === 'string' ? value.split(',').map(part => part.trim()) : [];
  return parts.filter((part): part is string => Boolean(part));
}

const hasField = (fields: Record<string, unknown>, key: string) => Object.hasOwn(fields, key) && fields[key] !== undefined && fields[key] !== null && fields[key] !== '';

// --- Names ------------------------------------------------------------------------------------------------------

/** A Claude Code name made to fit `SkillName`; undefined when nothing usable is left. */
export function fitSkillName(text: string): string | undefined {
  const fitted = text.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/, '');
  return SkillName.safeParse(fitted).success ? fitted : undefined;
}

// --- Skills and commands ----------------------------------------------------------------------------------------

const SKILL_KEPT_FIELDS = ['name', 'description', 'when_to_use', 'license', 'compatibility', 'metadata', 'allowed-tools'];
const INJECTION = /!`[^`\n]+`|^```!/m;
const ARGUMENTS = /\$ARGUMENTS\b|\$\{ARGUMENTS\b/;

export type SkillCandidate = {
  /** The Orglet skill name, when one could be made. */
  name?: string;
  description: string;
  notes: string[];
  blocked?: string;
  skillPackage?: PackageInput;
};

/**
 * Turns the text of one Claude Code skill (or command) into an Orglet package. `SkillMetadata` stays strict: the
 * frontmatter is rewritten with only what Orglet stores, and every field left out is named in the notes. The body is
 * kept as written; command injection and `$ARGUMENTS` stay text, and the notes say so.
 */
export function skillCandidate(options: { folderName: string; text: string; extraFiles?: PackageInput['files']; isCommand?: boolean }): SkillCandidate {
  const { fields, body, lenient } = parseFrontmatter(options.text);
  const notes: string[] = [];
  if (lenient) notes.push('Phần đầu tệp không phải YAML hợp lệ nên được đọc từng dòng.');
  const wanted = scalar(fields.name) ?? options.folderName;
  const name = fitSkillName(wanted);
  if (!name) return { description: '', notes, blocked: 'Tên không đổi được thành tên skill hợp lệ (chữ thường, số và dấu gạch ngang).' };
  if (name !== wanted) notes.push(`Tên "${wanted}" được đổi thành "${name}".`);
  const firstLine = body.split('\n').map(line => line.trim()).find(line => line.length > 0);
  const described = scalar(fields.description) ?? firstLine;
  if (!described) return { name, description: '', notes, blocked: 'Không có mô tả và không có nội dung.' };
  const whenToUse = scalar(fields.when_to_use);
  const joined = whenToUse ? `${described} ${whenToUse}` : described;
  const description = joined.length > 1024 ? `${joined.slice(0, 1023).trimEnd()}…` : joined;
  if (joined.length > 1024) notes.push('Mô tả bị cắt cho vừa 1.024 ký tự.');
  for (const key of Object.keys(fields)) {
    if (!SKILL_KEPT_FIELDS.includes(key) && hasField(fields, key)) notes.push(`${key}: Orglet không dùng`);
  }
  if (INJECTION.test(body)) notes.push('Nội dung có lệnh chạy bằng dấu ! và backtick; Orglet không chạy, giữ nguyên là chữ.');
  if (ARGUMENTS.test(body)) notes.push('Nội dung có $ARGUMENTS; Orglet không điền, giữ nguyên là chữ.');
  const metadata = keptMetadata(fields, notes);
  const parsed = SkillMetadata.safeParse({ name, description, ...metadata });
  if (!parsed.success) return { name, description, notes, blocked: 'Phần đầu SKILL.md không đổi được sang dạng Orglet lưu.' };
  const skillText = skillDocument(parsed.data, body);
  const skillPackage: PackageInput = {
    directoryName: name,
    files: [{ path: 'SKILL.md', base64: Buffer.from(skillText).toString('base64') }, ...(options.extraFiles ?? []).filter(file => file.path !== 'SKILL.md')],
  };
  try {
    inspectPackageContent(skillPackage);
  } catch (error) {
    return { name, description, notes, blocked: error instanceof Error ? error.message : 'Gói skill không hợp lệ.' };
  }
  return { name, description, notes, skillPackage };
}

function keptMetadata(fields: Record<string, unknown>, notes: string[]): Partial<SkillMetadata> {
  const kept: Partial<SkillMetadata> = {};
  const license = scalar(fields.license);
  if (license) kept.license = license.slice(0, 2000);
  const compatibility = scalar(fields.compatibility);
  if (compatibility) {
    if (compatibility.length <= 500) kept.compatibility = compatibility;
    else notes.push('compatibility: dài hơn 500 ký tự nên bị bỏ');
  }
  const tools = fields['allowed-tools'];
  const toolText = Array.isArray(tools) ? nameList(tools).join(' ') : scalar(tools);
  if (toolText) {
    // Claude Code's tool names (Read, Bash(git log:*)) are not Orglet's, and the review blocks a package that names a
    // tool Orglet lacks. Leaving them out never widens what the skill may do.
    const named = toolText.split(/[\s,]+/).filter(Boolean);
    const known = named.filter(tool => supportedTools.has(tool));
    if (known.length < named.length) notes.push('allowed-tools: bỏ các công cụ Orglet chưa có');
    if (known.length) kept['allowed-tools'] = known.join(' ');
  }
  const extra = fields.metadata;
  if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
    const entries: Record<string, string> = {};
    for (const [key, value] of Object.entries(extra)) {
      const text = scalar(value);
      if (text && key.length <= 100 && text.length <= 2000) entries[key] = text;
      else notes.push(`metadata.${key.slice(0, 40)}: không phải chữ ngắn nên bị bỏ`);
    }
    if (Object.keys(entries).length) kept.metadata = entries;
  }
  return kept;
}

function skillDocument(metadata: SkillMetadata, body: string): string {
  const lines = ['---', `name: ${metadata.name}`, `description: ${JSON.stringify(metadata.description)}`];
  if (metadata.license) lines.push(`license: ${JSON.stringify(metadata.license)}`);
  if (metadata.compatibility) lines.push(`compatibility: ${JSON.stringify(metadata.compatibility)}`);
  if (metadata['allowed-tools']) lines.push(`allowed-tools: ${JSON.stringify(metadata['allowed-tools'])}`);
  if (metadata.metadata) {
    lines.push('metadata:');
    for (const [key, value] of Object.entries(metadata.metadata)) lines.push(`  ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  }
  lines.push('---', '', body, '');
  return lines.join('\n');
}

/** The name a command file takes: `folder/file.md` is `folder:file` in Claude Code and `folder-file` here. */
export function commandName(relativePath: string): string {
  return relativePath.replace(/\.md$/i, '').split('/').join('-');
}

// --- Subagents --------------------------------------------------------------------------------------------------

const AGENT_KEPT_FIELDS = ['name', 'description', 'model', 'effort', 'skills'];

export type AgentCandidate = { agent?: ClaudeCodeAgent; name: string; description: string; notes: string[]; blocked?: string };

/** One subagent file as an orglet's ingredients. The fields Orglet does not carry are named in the notes. */
export function agentCandidate(relativePath: string, text: string): AgentCandidate {
  const { fields, body, lenient } = parseFrontmatter(text);
  const notes: string[] = [];
  if (lenient) notes.push('Phần đầu tệp không phải YAML hợp lệ nên được đọc từng dòng.');
  const fallbackName = relativePath.replace(/\.md$/i, '').split('/').pop() ?? relativePath;
  const name = scalar(fields.name);
  const description = scalar(fields.description) ?? '';
  const shown = name ?? fallbackName;
  if (!name) return { name: shown, description, notes, blocked: 'Thiếu name trong phần đầu tệp.' };
  if (name.length > 256 || name.includes(':')) return { name: shown.slice(0, 80), description, notes, blocked: 'name dài quá 256 ký tự hoặc có dấu hai chấm.' };
  if (!description) return { name: shown, description, notes, blocked: 'Thiếu description trong phần đầu tệp.' };
  if (!body) return { name: shown, description, notes, blocked: 'Không có nội dung hướng dẫn.' };
  if (body.length > 16000) return { name: shown, description, notes, blocked: 'Nội dung hướng dẫn dài hơn 16.000 ký tự.' };
  const orgletName = name.slice(0, 80);
  if (name.length > 80) notes.push('Tên bị cắt cho vừa 80 ký tự.');
  const firstLine = description.split('\n')[0].trim();
  if (firstLine.length > 160 || description.includes('\n')) notes.push('Mô tả chỉ giữ dòng đầu, tối đa 160 ký tự.');
  for (const key of Object.keys(fields)) {
    if (!AGENT_KEPT_FIELDS.includes(key) && hasField(fields, key)) notes.push(`${key}: Orglet không dùng`);
  }
  const agent: ClaudeCodeAgent = {
    name: orgletName,
    description: firstLine.length > 160 ? `${firstLine.slice(0, 159).trimEnd()}…` : firstLine,
    instructions: body,
    skills: nameList(fields.skills),
    ...(scalar(fields.model) ? { model: scalar(fields.model) } : {}),
    ...(scalar(fields.effort) ? { effort: scalar(fields.effort) } : {}),
  };
  return { agent, name: orgletName, description: agent.description, notes };
}

// --- MCP servers ------------------------------------------------------------------------------------------------

export type McpScope = 'user' | 'local' | 'project';
const SCOPE_RANK: Record<McpScope, number> = { local: 0, project: 1, user: 2 };
const VARIABLE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

const McpEntry = z.object({
  type: z.string().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
}).passthrough();

/**
 * `${VAR:-default}` becomes its default. A `${VAR}` with no default is never read from this app's environment: it
 * stays as written, and `missing` names the variable so the person can set it by hand.
 */
function expandDefaults(text: string, missing: Set<string>): string {
  return text.replace(VARIABLE, (whole, variable: string, fallback: string | undefined) => {
    if (fallback !== undefined) return fallback;
    missing.add(variable);
    return whole;
  });
}

function hostOrCommand(entry: z.infer<typeof McpEntry>): string {
  if (entry.command) return `stdio (${entry.command.replace(/\\/g, '/').split('/').pop()?.slice(0, 60) ?? ''})`;
  try {
    return `${(entry.type ?? 'http').toLowerCase()} (${new URL(entry.url ?? '').hostname})`;
  } catch {
    return (entry.type ?? 'http').toLowerCase();
  }
}

/**
 * The servers one `mcpServers` object holds, as listing entries. The drafts keep their values and stay in main;
 * the listing item carries the name, the transport and the host or command name, nothing else.
 */
export function claudeMcpEntries(servers: unknown, scope: McpScope, source: string, existingNames: ReadonlySet<string>): ClaudeCodeEntry[] {
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return [];
  const entries: ClaudeCodeEntry[] = [];
  for (const [rawName, rawEntry] of Object.entries(servers).slice(0, MCP_SERVER_LIMIT * 2)) {
    const name = rawName.trim().slice(0, 40);
    const parsed = McpEntry.safeParse(rawEntry);
    const id = `mcp:${scope}:${rawName}`;
    const base = { id, kind: 'mcp' as const, name: name || rawName.slice(0, 40), source, alreadyHere: existingNames.has(name.toLowerCase()) };
    if (!name || !parsed.success) {
      entries.push({ item: { ...base, description: '', notes: [], blocked: 'Mục này không đúng dạng máy chủ MCP.' } });
      continue;
    }
    entries.push(mcpEntry(base, parsed.data));
  }
  return entries;
}

function mcpEntry(base: Omit<ClaudeCodeItem, 'description' | 'notes' | 'blocked'>, entry: z.infer<typeof McpEntry>): ClaudeCodeEntry {
  const notes: string[] = [];
  const description = hostOrCommand(entry);
  const type = (entry.type ?? (entry.command ? 'stdio' : 'http')).toLowerCase();
  if (type === 'ws' || type === 'websocket') return { item: { ...base, description, notes, blocked: 'Orglet chưa hỗ trợ máy chủ WebSocket.' } };
  if (type === 'sse') notes.push('Máy chủ SSE được nhập như máy chủ HTTP; nếu máy chủ chỉ nói SSE thì bước thử sẽ báo lỗi.');
  const missing = new Set<string>();
  const dropped = new Set<string>();
  const expanded = {
    ...(entry.command ? { command: expandDefaults(entry.command, missing) } : {}),
    ...(entry.args ? { args: entry.args.map(argument => expandDefaults(argument, missing)) } : {}),
    ...(entry.url ? { url: expandDefaults(entry.url, missing) } : {}),
    ...(entry.env ? { env: valuesWithoutMissing(entry.env, dropped) } : {}),
    ...(entry.headers ? { headers: valuesWithoutMissing(entry.headers, dropped) } : {}),
  };
  if (missing.size) notes.push(`Biến ${[...missing].join(', ')} chưa có giá trị; giữ nguyên như viết, cần đặt tay trong Cài đặt.`);
  if (dropped.size) notes.push(`Biến ${[...dropped].join(', ')} không có giá trị mặc định nên bị bỏ; nhập tay trong Cài đặt MCP.`);
  const result = mcpDraftFromEntry(base.name, expanded);
  const secrets = secretValues(expanded);
  if ('reason' in result) return { item: { ...base, description, notes, blocked: result.reason } };
  return { item: { ...base, description, notes }, mcpDraft: result.draft, secrets };
}

/** Entries whose value is a `${VAR}` with no default are dropped, because a literal "${VAR}" would be sent as the secret. */
function valuesWithoutMissing(values: Record<string, string>, dropped: Set<string>): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    const missing = new Set<string>();
    const expanded = expandDefaults(value, missing);
    if (missing.size) for (const variable of missing) dropped.add(variable);
    else kept[key] = expanded;
  }
  return kept;
}

function secretValues(expanded: { env?: Record<string, string>; headers?: Record<string, string> }): string[] {
  const values = [...Object.values(expanded.env ?? {}), ...Object.values(expanded.headers ?? {})];
  return [...values, ...values.map(value => value.replace(/^Bearer\s+/i, ''))].filter(value => value.length >= 4);
}

/** Servers from several scopes: the same name in more than one keeps the most local one, as Claude Code does. */
export function dedupeMcp(entries: { scope: McpScope; entry: ClaudeCodeEntry }[]): ClaudeCodeEntry[] {
  const winners = new Map<string, { scope: McpScope; entry: ClaudeCodeEntry }>();
  for (const candidate of entries) {
    const key = candidate.entry.item.name.toLowerCase();
    const current = winners.get(key);
    if (!current || SCOPE_RANK[candidate.scope] < SCOPE_RANK[current.scope]) winners.set(key, candidate);
  }
  return [...winners.values()].map(winner => winner.entry);
}

/** Reads only the `mcpServers` objects out of the parsed `~/.claude.json`; the rest of that file is never touched. */
export function claudeJsonServers(parsed: unknown, projectFolder: string | undefined): { user?: unknown; local?: unknown } {
  if (!parsed || typeof parsed !== 'object') return {};
  const record = parsed as Record<string, unknown>;
  if (!projectFolder) return { user: record.mcpServers };
  const projects = record.projects;
  if (!projects || typeof projects !== 'object') return {};
  const wanted = normalisePath(projectFolder);
  for (const [path, value] of Object.entries(projects)) {
    if (normalisePath(path) === wanted && value && typeof value === 'object') return { local: (value as Record<string, unknown>).mcpServers };
  }
  return {};
}

function normalisePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}
