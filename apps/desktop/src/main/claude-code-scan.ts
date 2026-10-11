import { readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { z } from 'zod';
import {
  CLAUDE_CODE_RESERVED_SKILL_FOLDERS, agentCandidate, claudeJsonServers, claudeMcpEntries, commandName, dedupeMcp, skillCandidate,
  type ClaudeCodeEntry, type ClaudeCodeImportResult, type ClaudeCodeItem, type ClaudeCodeListing, type McpScope,
} from '../shared/claude-code-import';
import type { McpServerDraft } from '../shared/mcp';
import { SKILL_FILE_LIMIT, type PackageInput } from '../shared/skill-package';
import { readBoundedText } from './files';
import { readSkillDirectory } from './skill-files';

/*
 * Lists what a Claude Code folder holds without importing or running anything (docs/import-from-claude-code.md). It
 * reads markdown and JSON as text. `~/.claude.json` is read for its `mcpServers` objects only, and nothing else in it
 * is kept, shown or logged.
 */

export type ExistingNames = { skills: ReadonlySet<string>; workers: ReadonlySet<string>; mcp: ReadonlySet<string> };
export type ScanOptions = { home: string; projectFolder?: string; existing: ExistingNames };

const MAX_FILES_PER_FOLDER = 500;
const MAX_DEPTH = 8;
const CLAUDE_JSON_LIMIT = 64 * 1024 * 1024;
const MCP_JSON_LIMIT = 1024 * 1024;

const isInside = (parent: string, child: string) => {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
};

async function realOrUndefined(path: string): Promise<string | undefined> {
  try {
    return await realpath(path);
  } catch {
    return undefined;
  }
}

async function names(folder: string): Promise<import('node:fs').Dirent[]> {
  try {
    return (await readdir(folder, { withFileTypes: true })).sort((first, second) => first.name.localeCompare(second.name));
  } catch {
    return [];
  }
}

export async function scanClaudeCode(options: ScanOptions): Promise<{ listing: ClaudeCodeListing; entries: ClaudeCodeEntry[] }> {
  const base = options.projectFolder ?? options.home;
  const root = join(base, '.claude');
  const warnings: string[] = [];
  const allowed = [await realOrUndefined(root), await realOrUndefined(options.home)].filter((path): path is string => Boolean(path));
  /** A link is followed only when it ends up inside the folder being read or the person's home. */
  const allowedPath = async (path: string) => {
    const real = await realOrUndefined(path);
    return real !== undefined && allowed.some(parent => isInside(parent, real));
  };
  const entries: ClaudeCodeEntry[] = [
    ...await scanSkills(join(root, 'skills'), options.existing, allowedPath, warnings),
    ...await scanCommands(join(root, 'commands'), options.existing, allowedPath, warnings),
    ...await scanAgents(join(root, 'agents'), options.existing, allowedPath, warnings),
    ...await scanMcp(options, warnings),
  ];
  markDuplicates(entries);
  const label = options.projectFolder ? options.projectFolder : '~/.claude';
  return { listing: { folder: label, project: Boolean(options.projectFolder), items: entries.map(entry => entry.item), warnings }, entries };
}

/** The first skill, command or orglet of a name wins; a later one with the same name cannot be imported. */
function markDuplicates(entries: ClaudeCodeEntry[]) {
  const seen = new Set<string>();
  for (const { item } of entries) {
    if (item.kind === 'mcp') continue;
    const key = `${item.kind}:${item.name.toLowerCase()}`;
    if (seen.has(key)) item.blocked ??= 'Trùng tên với một mục khác trong danh sách.';
    seen.add(key);
  }
}

function readableFailure(error: unknown): string {
  if (error instanceof z.ZodError) return 'Đường dẫn trong skill không hợp lệ.';
  if (error instanceof Error && !('code' in error)) return error.message;
  return 'Không đọc được tệp này.';
}

async function scanSkills(folder: string, existing: ExistingNames, allowedPath: (path: string) => Promise<boolean>, warnings: string[]): Promise<ClaudeCodeEntry[]> {
  const entries: ClaudeCodeEntry[] = [];
  for (const entry of await names(folder)) {
    if (CLAUDE_CODE_RESERVED_SKILL_FOLDERS.includes(entry.name)) continue;
    const path = join(folder, entry.name);
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (!await allowedPath(path)) {
      warnings.push(`Bỏ qua liên kết trỏ ra ngoài thư mục đã đọc: skills/${entry.name}`);
      continue;
    }
    const real = (await realOrUndefined(path))!;
    if (!(await stat(real).catch(() => undefined))?.isDirectory()) continue;
    if (!(await stat(join(real, 'SKILL.md')).catch(() => undefined))?.isFile()) continue;
    entries.push(await skillEntry(entry.name, real, `skills/${entry.name}`, existing));
  }
  return entries;
}

async function skillEntry(folderName: string, directory: string, source: string, existing: ExistingNames): Promise<ClaudeCodeEntry> {
  const base = { id: `skill:${source}`, kind: 'skill' as const, source };
  let packageFiles: PackageInput;
  try {
    packageFiles = await readSkillDirectory(directory);
  } catch (error) {
    return { item: { ...base, name: folderName, description: '', notes: [], alreadyHere: false, blocked: readableFailure(error) } };
  }
  const document = packageFiles.files.find(file => file.path === 'SKILL.md');
  const text = document ? Buffer.from(document.base64, 'base64').toString('utf8') : '';
  const extraFiles = packageFiles.files.filter(file => file.path !== 'SKILL.md');
  return candidateEntry(base, folderName, skillCandidate({ folderName, text, extraFiles }), existing.skills);
}

function candidateEntry(base: Pick<ClaudeCodeItem, 'id' | 'kind' | 'source'>, fallbackName: string, candidate: ReturnType<typeof skillCandidate>, existingNames: ReadonlySet<string>): ClaudeCodeEntry {
  const name = candidate.name ?? fallbackName;
  const item: ClaudeCodeItem = {
    ...base, name, description: candidate.description, notes: candidate.notes, alreadyHere: existingNames.has(name.toLowerCase()),
    ...(candidate.blocked ? { blocked: candidate.blocked } : {}),
  };
  return { item, ...(candidate.skillPackage && !candidate.blocked ? { skillPackage: candidate.skillPackage } : {}) };
}

type MarkdownFile = { relative: string; absolute: string };

async function markdownFiles(folder: string, allowedPath: (path: string) => Promise<boolean>, warnings: string[]): Promise<MarkdownFile[]> {
  const found: MarkdownFile[] = [];
  const walk = async (directory: string, prefix: string, depth: number) => {
    if (depth > MAX_DEPTH) return;
    for (const entry of await names(directory)) {
      if (found.length >= MAX_FILES_PER_FOLDER) return;
      const path = join(directory, entry.name);
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink() && !await allowedPath(path)) {
        warnings.push(`Bỏ qua liên kết trỏ ra ngoài thư mục đã đọc: ${name}`);
        continue;
      }
      const info = await stat(path).catch(() => undefined);
      if (info?.isDirectory()) await walk(path, name, depth + 1);
      else if (info?.isFile() && /\.md$/i.test(entry.name)) found.push({ relative: name, absolute: path });
    }
  };
  await walk(folder, '', 0);
  return found;
}

async function readMarkdown(path: string): Promise<{ text: string } | { reason: string }> {
  try {
    return { text: await readBoundedText(path, SKILL_FILE_LIMIT) };
  } catch {
    return { reason: 'Tệp lớn hơn 256 KB hoặc không phải văn bản UTF-8.' };
  }
}

async function scanCommands(folder: string, existing: ExistingNames, allowedPath: (path: string) => Promise<boolean>, warnings: string[]): Promise<ClaudeCodeEntry[]> {
  const entries: ClaudeCodeEntry[] = [];
  for (const file of await markdownFiles(folder, allowedPath, warnings)) {
    const base = { id: `command:${file.relative}`, kind: 'skill' as const, source: `commands/${file.relative}` };
    const name = commandName(file.relative);
    const read = await readMarkdown(file.absolute);
    if ('reason' in read) {
      entries.push({ item: { ...base, name, description: '', notes: [], alreadyHere: false, blocked: read.reason } });
      continue;
    }
    entries.push(candidateEntry(base, name, skillCandidate({ folderName: name, text: read.text }), existing.skills));
  }
  return entries;
}

async function scanAgents(folder: string, existing: ExistingNames, allowedPath: (path: string) => Promise<boolean>, warnings: string[]): Promise<ClaudeCodeEntry[]> {
  const entries: ClaudeCodeEntry[] = [];
  for (const file of await markdownFiles(folder, allowedPath, warnings)) {
    const base = { id: `agent:${file.relative}`, kind: 'agent' as const, source: `agents/${file.relative}` };
    const read = await readMarkdown(file.absolute);
    if ('reason' in read) {
      entries.push({ item: { ...base, name: file.relative.replace(/\.md$/i, ''), description: '', notes: [], alreadyHere: false, blocked: read.reason } });
      continue;
    }
    const candidate = agentCandidate(file.relative, read.text);
    entries.push({
      item: {
        ...base, name: candidate.name, description: candidate.description, notes: candidate.notes, alreadyHere: existing.workers.has(candidate.name.toLowerCase()),
        ...(candidate.blocked ? { blocked: candidate.blocked } : {}), ...(candidate.agent && !candidate.blocked ? { agent: candidate.agent } : {}),
      },
    });
  }
  return entries;
}

async function readJson(path: string, limit: number): Promise<{ value: unknown } | { missing: true } | { unreadable: true }> {
  if (!(await stat(path).catch(() => undefined))?.isFile()) return { missing: true };
  try {
    return { value: JSON.parse(await readBoundedText(path, limit)) as unknown };
  } catch {
    return { unreadable: true };
  }
}

async function scanMcp(options: ScanOptions, warnings: string[]): Promise<ClaudeCodeEntry[]> {
  const found: { scope: McpScope; entry: ClaudeCodeEntry }[] = [];
  const add = (scope: McpScope, servers: unknown, source: string) => {
    for (const entry of claudeMcpEntries(servers, scope, source, options.existing.mcp)) found.push({ scope, entry });
  };
  if (options.projectFolder) {
    const project = await readJson(join(options.projectFolder, '.mcp.json'), MCP_JSON_LIMIT);
    if ('value' in project && project.value && typeof project.value === 'object') add('project', (project.value as Record<string, unknown>).mcpServers, '.mcp.json');
    if ('unreadable' in project) warnings.push('Không đọc được .mcp.json.');
  }
  const account = await readJson(join(options.home, '.claude.json'), CLAUDE_JSON_LIMIT);
  if ('value' in account) {
    // Only the two `mcpServers` objects are picked out; the account and everything else in the file stay unread.
    const servers = claudeJsonServers(account.value, options.projectFolder);
    add('user', servers.user, '.claude.json');
    add('local', servers.local, '.claude.json');
  } else if ('unreadable' in account) {
    warnings.push('Không đọc được .claude.json.');
  }
  return dedupeMcp(found);
}

/** Replaces any secret value a message happens to repeat, so an error shown in the window never carries one. */
export function redactSecrets(message: string, secrets: readonly string[]): string {
  return secrets.reduce((text, secret) => (secret ? text.split(secret).join('•••') : text), message);
}

export type ImportHooks = {
  importSkill(skillPackage: PackageInput): Promise<{ id: string }>;
  saveMcpServer(draft: McpServerDraft): Promise<unknown>;
};

/**
 * Imports the checked skills and MCP servers. Subagents are not here: the window turns them into orglets, because
 * only it knows the default model and which skills can be used. A skill goes through the same path as a folder the
 * person picked, so it waits for review; a server goes through the Settings import, so main keeps its secrets.
 */
export async function importClaudeCodeEntries(entries: readonly ClaudeCodeEntry[], ids: readonly string[], hooks: ImportHooks): Promise<ClaudeCodeImportResult[]> {
  const byId = new Map(entries.map(entry => [entry.item.id, entry]));
  const results: ClaudeCodeImportResult[] = [];
  for (const id of new Set(ids)) {
    const entry = byId.get(id);
    if (!entry) {
      results.push({ id, kind: id.startsWith('mcp:') ? 'mcp' : 'skill', name: id.split(':').slice(1).join(':'), status: 'skipped', reason: 'Không còn thấy mục này trong thư mục.' });
      continue;
    }
    const { item } = entry;
    if (item.kind === 'agent') continue;
    const result = { id, kind: item.kind, name: item.name };
    if (item.blocked) results.push({ ...result, status: 'skipped', reason: item.blocked });
    else if (item.alreadyHere) results.push({ ...result, status: 'skipped', reason: 'Đã có trong Orglet.' });
    else results.push(await importOne(entry, result, hooks));
  }
  return results;
}

async function importOne(entry: ClaudeCodeEntry, result: Pick<ClaudeCodeImportResult, 'id' | 'kind' | 'name'>, hooks: ImportHooks): Promise<ClaudeCodeImportResult> {
  try {
    if (entry.skillPackage) {
      const skill = await hooks.importSkill(entry.skillPackage);
      return { ...result, status: 'imported', skillId: skill.id };
    }
    if (entry.mcpDraft) {
      await hooks.saveMcpServer(entry.mcpDraft);
      return { ...result, status: 'imported' };
    }
    return { ...result, status: 'skipped', reason: 'Không có gì để nhập.' };
  } catch (error) {
    const reason = error instanceof z.ZodError ? 'Dữ liệu không hợp lệ.' : error instanceof Error ? error.message : 'Không nhập được.';
    return { ...result, status: 'failed', reason: redactSecrets(reason, entry.secrets ?? []) };
  }
}
