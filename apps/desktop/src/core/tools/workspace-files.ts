import { createHash } from 'node:crypto';
import { lstat, mkdir, open, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { WorkspaceOperation, WorkspacePath, type WorkspaceManifest } from '../../shared/workspace-tools';

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 100 * 1024 * 1024;
const EXCLUDED_DIRECTORIES = new Set(['.git', 'node_modules', '.orglet-tmp']);
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

async function within(root: string, path: string): Promise<string> {
  WorkspacePath.parse(path);
  const candidate = join(root, path);
  const remainder = relative(root, candidate);
  if (remainder.startsWith('..') || isAbsolute(remainder)) throw new Error('Đường dẫn vượt phạm vi workspace.');
  let current = root;
  for (const part of path.split('/').filter(Boolean)) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new Error('Đường dẫn vượt phạm vi workspace.');
  }
  return candidate;
}

async function boundedFile(path: string): Promise<Buffer> {
  const handle = await open(path, 'r');
  try {
    if (!(await handle.stat()).isFile()) throw new Error('Không phải tệp thường.');
    const bytes = Buffer.alloc(MAX_FILE_BYTES + 1);
    let size = 0;
    while (size < bytes.length) {
      const result = await handle.read(bytes, size, bytes.length - size, null);
      if (!result.bytesRead) break;
      size += result.bytesRead;
    }
    if (size > MAX_FILE_BYTES) throw new Error('Tệp vượt giới hạn 1 MiB của workspace tools.');
    return bytes.subarray(0, size);
  } finally {
    await handle.close();
  }
}

async function inventory(root: string, destination?: string): Promise<WorkspaceManifest> {
  const files: WorkspaceManifest['files'] = [];
  const omitted: string[] = [];
  let totalBytes = 0;
  let visited = 0;
  async function visit(folder: string, prefix: string) {
    const entries = await readdir(folder, { withFileTypes: true });
    entries.sort((first, second) => first.name.localeCompare(second.name));
    for (const entry of entries) {
      if (++visited > 10000) throw new Error('Workspace vượt giới hạn 10.000 mục.');
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!WorkspacePath.safeParse(path).success || entry.isSymbolicLink()
        || (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name.toLowerCase()))) {
        omitted.push(path);
        continue;
      }
      const actual = await within(root, path);
      if (entry.isDirectory()) {
        if (destination) await mkdir(join(destination, path), { recursive: true });
        await visit(actual, path);
      } else if (entry.isFile()) {
        const bytes = await boundedFile(actual);
        totalBytes += bytes.length;
        if (totalBytes > MAX_SNAPSHOT_BYTES) throw new Error('Workspace vượt giới hạn bản sao 100 MiB.');
        files.push({ path, hash: digest(bytes), bytes: bytes.length });
        if (destination) await writeFile(join(destination, path), bytes, { flag: 'wx' });
      } else {
        omitted.push(path);
      }
    }
  }
  await visit(root, '');
  return { files, omitted };
}

/** Always called inside the OS sandbox in production. Path checks complement that boundary. */
export async function executeWorkspaceOperation(directory: string, raw: unknown): Promise<unknown> {
  const request = WorkspaceOperation.parse(raw);
  // Core already canonicalized these roots. Node realpath traverses denied ancestors in BaseContainer.
  // Component checks reject links; the OS sandbox remains the boundary against check/use races.
  if (!isAbsolute(directory)) throw new Error('Workspace không hợp lệ.');
  const root = directory;
  if (request.operation === 'snapshot') {
    if (!isAbsolute(request.source)) throw new Error('Workspace không hợp lệ.');
    return inventory(request.source, root);
  }
  if (request.operation === 'manifest') return inventory(root);
  if (request.operation === 'write') {
    const path = join(root, request.path);
    // Core serializes this private worktree. The user directory is integrated separately under an OS file lock.
    const parent = relative(root, dirname(path)).replaceAll('\\', '/');
    await within(root, parent);
    const bytes = Buffer.from(request.content, 'utf8');
    if (bytes.length > MAX_FILE_BYTES) throw new Error('Tệp vượt giới hạn 1 MiB của workspace tools.');
    if (request.expectedHash === null) {
      await writeFile(path, bytes, { flag: 'wx' });
    } else {
      const actual = await within(root, request.path);
      if (digest(await boundedFile(actual)) !== request.expectedHash) throw new Error('Tệp đã thay đổi; đọc lại trước khi sửa.');
      await writeFile(actual, bytes);
    }
    return { path: request.path, hash: digest(bytes), bytes: bytes.length };
  }
  const target = await within(root, request.path);
  if (request.operation === 'blob') {
    const bytes = await boundedFile(target);
    const end = Math.min(bytes.length, request.offset + 49152);
    return { hash: digest(bytes), base64: bytes.subarray(request.offset, end).toString('base64'),
      nextOffset: end < bytes.length ? end : null };
  }
  if (request.operation === 'read') {
    const bytes = await boundedFile(target);
    let characters: string[];
    try {
      characters = Array.from(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes));
    } catch {
      throw new Error('Tệp không phải văn bản UTF-8 hợp lệ.');
    }
    const end = Math.min(characters.length, request.offset + 16000);
    return { path: request.path, hash: digest(bytes), bytes: bytes.length, offset: request.offset,
      content: characters.slice(request.offset, end).join(''), nextOffset: end < characters.length ? end : null };
  }
  if (request.operation === 'list') {
    const entries = await readdir(target, { withFileTypes: true });
    return { entries: entries.slice(0, 500).map(entry => ({ name: entry.name,
      type: entry.isSymbolicLink() ? 'link' : entry.isDirectory() ? 'directory' : 'file' })), truncated: entries.length > 500 };
  }
  const manifest = await inventory(target);
  const matches: { path: string; line: number; text: string }[] = [];
  for (const file of manifest.files) {
    const bytes = await boundedFile(await within(target, file.path));
    if (bytes.includes(0)) continue;
    const lines = bytes.toString('utf8').split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      if (!line.includes(request.text)) continue;
      matches.push({ path: request.path ? `${request.path}/${file.path}` : file.path, line: index + 1, text: line.slice(0, 1000) });
      if (matches.length === 100) return { matches, truncated: true };
    }
  }
  return { matches, truncated: false };
}
