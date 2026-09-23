import { randomUUID } from 'node:crypto';
import { readFile, realpath, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import type { WorkspaceManifest } from '../../shared/workspace-tools';
import {
  DIFF_FILE_LINE_LIMIT, DIFF_LINE_CHARACTER_LIMIT, DIFF_OUTPUT_BYTE_LIMIT, DIFF_TOTAL_LINE_LIMIT,
  type DiffFile, type DiffHunk, type DiffLine, type WorkspaceDiff,
} from '../../shared/workspace-diff';
import { SNAPSHOT_REF, isolatedGit } from './workspace-git';

const ObjectId = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const FAILURE = 'Không đọc được thay đổi của bản làm việc';

export type WorkspaceDiffOptions = {
  executable: string;
  /** The copy's `worktree` folder, next to its `repository.git`. */
  worktree: string;
  /** The files the copy started with, as the snapshot recorded them. */
  baseline: WorkspaceManifest;
  /** The files in the copy now, from the same sandboxed inventory the snapshot used: it never follows links. */
  current: WorkspaceManifest;
  /** False for the counts only, which is what a finished run keeps. */
  includeHunks: boolean;
  signal: AbortSignal;
  /** Bytes of patch output read before the rest is dropped; tests lower it. */
  outputByteLimit?: number;
};

/**
 * Compares a Git working copy with the snapshot it started from and returns every changed file with its hunks
 * (COD-163). It is read-only for the person's files: only the copy's own bare repository gains objects and a
 * temporary index. Git never walks the copy; the paths come from the two inventories, so a link a worker planted
 * cannot lead the diff outside the copy, and a hidden repository config the worker wrote cannot redirect it:
 * the Git directory is derived from the session folder, not read from the copy's `.git` file.
 */
export async function diffWorkspaceCopy(options: WorkspaceDiffOptions): Promise<Omit<WorkspaceDiff, 'runId'>> {
  options.signal.throwIfAborted();
  if (!isAbsolute(options.worktree) || !isAbsolute(options.executable)) throw new Error('Đường dẫn Git runtime không hợp lệ.');
  const session = dirname(options.worktree);
  const repository = join(session, 'repository.git');
  const gitDirectory = await linkedWorktreeDirectory(repository, options.worktree);
  const changed = changedPaths(options.baseline, options.current);
  if (changed.length === 0) return { files: [], additions: 0, deletions: 0, truncated: false };
  const run = isolatedGit({ executable: options.executable, directory: session, cwd: repository, signal: options.signal, failure: FAILURE });
  const indexFile = join(session, `diff-index-${randomUUID()}`);
  const repositoryArgs = [`--git-dir=${gitDirectory}`, `--work-tree=${options.worktree}`];
  const git = async (args: string[], input?: string) => (await run([...repositoryArgs, ...args], { input, environment: { GIT_INDEX_FILE: indexFile } })).output;
  try {
    await git(['read-tree', SNAPSHOT_REF]);
    // Only the paths whose bytes differ are re-read; an unchanged file keeps its snapshot entry.
    await git(['update-index', '-z', '--add', '--remove', '--stdin'], changed.map(path => `${path}\0`).join(''));
    const tree = ObjectId.parse((await git(['write-tree'])).trim());
    const numstat = await git(['diff-tree', '-r', '-M', '--numstat', '-z', SNAPSHOT_REF, tree]);
    const files = parseNumstat(numstat, options.baseline, options.current);
    let truncated = false;
    if (options.includeHunks && files.length > 0) {
      const patch = await run([...repositoryArgs, 'diff-tree', '-r', '-M', '-p', '-U3', '--no-ext-diff', '--no-textconv', '--no-color', SNAPSHOT_REF, tree],
        { environment: { GIT_INDEX_FILE: indexFile }, outputLimit: options.outputByteLimit ?? DIFF_OUTPUT_BYTE_LIMIT, keepPartialOutput: true });
      truncated = attachHunks(files, patch.output, patch.limited);
    }
    return {
      files,
      additions: files.reduce((total, file) => total + file.additions, 0),
      deletions: files.reduce((total, file) => total + file.deletions, 0),
      truncated,
    };
  } finally {
    await rm(indexFile, { force: true });
  }
}

/** The path with symlinks followed, so macOS's /var and /private/var name the same place; as given when it is missing. */
async function canonicalPath(path: string): Promise<string> {
  return realpath(path).catch(() => resolve(path));
}

/**
 * The linked worktree's Git directory inside the bare repository, checked against Git's own back-reference so a
 * `.git` file rewritten inside the copy can never point the diff at another repository.
 */
async function linkedWorktreeDirectory(repository: string, worktree: string): Promise<string> {
  const gitDirectory = join(repository, 'worktrees', basename(worktree));
  const backReference = await readFile(join(gitDirectory, 'gitdir'), 'utf8').catch(() => '');
  const expected = await canonicalPath(join(worktree, '.git'));
  if (!backReference.trim() || await canonicalPath(backReference.trim()) !== expected) throw new Error('Bản làm việc này không có bản gốc để so sánh.');
  return gitDirectory;
}

/**
 * Paths whose bytes differ between the two inventories, including files that only one of them has. The worktree's
 * own `.git` pointer file is not a change the worker made.
 */
export function changedPaths(baseline: WorkspaceManifest, current: WorkspaceManifest): string[] {
  const before = new Map(baseline.files.map(file => [file.path, file.hash]));
  const after = new Map(current.files.map(file => [file.path, file.hash]));
  const paths = new Set<string>();
  for (const [path, hash] of after) if (path !== WORKTREE_POINTER && before.get(path) !== hash) paths.add(path);
  for (const path of before.keys()) if (!after.has(path)) paths.add(path);
  return [...paths].sort();
}

/** The file Git leaves at the root of a linked worktree; it belongs to the copy, never to the person's folder. */
export const WORKTREE_POINTER = '.git';

/**
 * `diff-tree --numstat -z`: `added TAB deleted TAB path NUL`, or for a rename `added TAB deleted TAB NUL old NUL new
 * NUL`. Binary files count as `-`.
 */
function parseNumstat(text: string, baseline: WorkspaceManifest, current: WorkspaceManifest): DiffFile[] {
  const before = new Set(baseline.files.map(file => file.path));
  const after = new Set(current.files.map(file => file.path));
  const fields = text.split('\0');
  const files: DiffFile[] = [];
  let position = 0;
  while (position < fields.length) {
    const entry = fields[position];
    position += 1;
    if (!entry) continue;
    const [added, deleted, inlinePath] = entry.split('\t');
    if (added === undefined || deleted === undefined) throw new Error(`${FAILURE}: numstat`);
    const binary = added === '-' || deleted === '-';
    let path = inlinePath ?? '';
    let previousPath: string | undefined;
    if (path === '') {
      previousPath = fields[position];
      path = fields[position + 1] ?? '';
      position += 2;
    }
    if (!path) throw new Error(`${FAILURE}: numstat`);
    const status = previousPath !== undefined ? 'renamed' : !before.has(path) ? 'added' : !after.has(path) ? 'deleted' : 'modified';
    files.push({
      path, ...(previousPath !== undefined ? { previousPath } : {}), status, binary,
      additions: binary ? 0 : Number(added), deletions: binary ? 0 : Number(deleted), truncated: false, hunks: [],
    });
  }
  return files;
}

/**
 * Splits a `diff-tree -p` patch into its files and parses each one's hunks onto the matching entry. Returns whether
 * anything was left out: Git's output stopped at the byte cap, a file passed the per-file line cap, or the whole
 * diff passed its total cap.
 */
function attachHunks(files: DiffFile[], patch: string, outputLimited: boolean): boolean {
  const blocks = patch.split(/^(?=diff --git )/m).filter(block => block.startsWith('diff --git '));
  // A stopped read leaves the last file cut somewhere in its hunks, so that file is shown without them.
  if (outputLimited) blocks.pop();
  let truncated = outputLimited;
  let totalLines = 0;
  const byPath = new Map(files.map(file => [file.path, file]));
  for (const block of blocks) {
    const file = fileOfBlock(block, byPath);
    if (!file || file.binary) continue;
    if (totalLines >= DIFF_TOTAL_LINE_LIMIT) {
      file.truncated = true;
      truncated = true;
      continue;
    }
    const parsed = parseHunks(block, Math.min(DIFF_FILE_LINE_LIMIT, DIFF_TOTAL_LINE_LIMIT - totalLines));
    file.hunks = parsed.hunks;
    file.truncated = parsed.truncated;
    totalLines += parsed.lineCount;
    if (parsed.truncated) truncated = true;
  }
  if (outputLimited) for (const file of files) if (!file.binary && file.hunks.length === 0 && (file.additions || file.deletions)) file.truncated = true;
  return truncated;
}

/** The entry a `diff --git a/old b/new` header belongs to; `core.quotePath=false` keeps the paths unquoted. */
function fileOfBlock(block: string, byPath: Map<string, DiffFile>): DiffFile | undefined {
  const header = block.slice(0, block.indexOf('\n'));
  for (const [path, file] of byPath) if (header.endsWith(` b/${path}`)) return file;
  return undefined;
}

const hunkHeader = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

function parseHunks(block: string, lineLimit: number): { hunks: DiffHunk[]; lineCount: number; truncated: boolean } {
  const hunks: DiffHunk[] = [];
  let hunk: DiffHunk | undefined;
  let oldLine = 0;
  let newLine = 0;
  let lineCount = 0;
  for (const rawLine of block.split('\n')) {
    const header = hunkHeader.exec(rawLine);
    if (header) {
      hunk = { oldStart: Number(header[1]), oldLines: Number(header[2] ?? '1'), newStart: Number(header[3]), newLines: Number(header[4] ?? '1'), heading: header[5], lines: [] };
      hunks.push(hunk);
      oldLine = hunk.oldStart;
      newLine = hunk.newStart;
      continue;
    }
    if (!hunk) continue;
    // Git's note that the last line has no newline is not a line of either file, and every real hunk line carries a
    // prefix, so an empty string is only the split's tail after the patch's final newline.
    if (rawLine.startsWith('\\') || rawLine === '') continue;
    if (lineCount >= lineLimit) return { hunks, lineCount, truncated: true };
    const line = diffLine(rawLine, oldLine, newLine);
    if (line.kind !== 'added') oldLine += 1;
    if (line.kind !== 'removed') newLine += 1;
    hunk.lines.push(line);
    lineCount += 1;
  }
  return { hunks, lineCount, truncated: false };
}

function diffLine(rawLine: string, oldLine: number, newLine: number): DiffLine {
  const prefix = rawLine[0];
  const text = clipLine(rawLine.slice(1));
  if (prefix === '+') return { kind: 'added', text, oldLine: null, newLine };
  if (prefix === '-') return { kind: 'removed', text, oldLine, newLine: null };
  return { kind: 'context', text: prefix === ' ' ? text : clipLine(rawLine), oldLine, newLine };
}

function clipLine(text: string): string {
  return text.length > DIFF_LINE_CHARACTER_LIMIT ? `${text.slice(0, DIFF_LINE_CHARACTER_LIMIT)}…` : text;
}
