import { posix } from 'node:path';
import type { WorkspaceManifest } from '../../shared/workspace-tools';
import type { DiffFile, DiffFolder, WorkspaceDiff } from '../../shared/workspace-diff';

type ManifestFile = WorkspaceManifest['files'][number];

/** The file Git leaves at the root of a linked worktree; it belongs to the copy, never to the person's folder. */
export const WORKTREE_POINTER = '.git';

/**
 * One step of handing a working copy in (COD-254). Core derives the steps from the snapshot's inventory and the
 * copy's current one, never from what the worker says it did, so a rename done by a command counts the same as one
 * done with `workspace_move`. Every step carries the hash the person's file must still have, so a file the person
 * changed, removed or created meanwhile stops the hand-in instead of being overwritten.
 */
export type IntegrationStep =
  | { kind: 'folder'; path: string }
  | { kind: 'move'; from: string; path: string; hash: string; bytes: number }
  | { kind: 'write'; path: string; hash: string; bytes: number; expectedHash: string | null }
  | { kind: 'delete'; path: string; expectedHash: string; bytes: number }
  | { kind: 'remove_folder'; path: string };

/** Windows compares names without regard to letter case, so the plan does too. */
const keyOf = (path: string) => path.toLowerCase();
const depthOf = (path: string) => path.split('/').length;
const nameOf = (path: string) => posix.basename(path);
const folderOf = (path: string) => posix.dirname(path);
const byPath = (first: { path: string }, second: { path: string }) => first.path.localeCompare(second.path);

export const TYPE_CHANGE_REFUSAL = 'Bản làm việc thay một tệp bằng thư mục cùng tên (hoặc ngược lại); chưa tích hợp thay đổi này.';

/**
 * The steps that turn the person's folder, as the snapshot saw it, into the copy, in the order they run: new folders
 * (outermost first), moves, file writes, file deletions, then folder removals (innermost first). What adds comes
 * before what takes away, so a hand-in stopped halfway leaves an extra file rather than a missing one.
 *
 * A file that vanished from one path and appeared at another with the same bytes is a move, which integrates as a
 * rename: the person's file keeps its identity and nothing is copied. A moved file whose bytes also changed is a new
 * file plus a deletion. When several vanished files share the bytes (a duplicate), the one with the same name, then
 * the one in the same folder, becomes the move; the others are deletions.
 *
 * A path that is a file on one side and a folder on the other cannot be ordered safely, so the hand-in is refused
 * before anything changes; `describeOnly` lists such a plan anyway, for the diff viewer.
 */
export function planIntegration(baseline: WorkspaceManifest, current: WorkspaceManifest, options: { describeOnly?: boolean } = {}): IntegrationStep[] {
  const currentFiles = current.files.filter(file => file.path !== WORKTREE_POINTER);
  const before = new Map(baseline.files.map(file => [keyOf(file.path), file]));
  const after = new Map(currentFiles.map(file => [keyOf(file.path), file]));
  const moves: IntegrationStep[] = [];
  const writes: IntegrationStep[] = [];
  const deletes: IntegrationStep[] = [];
  const appeared: ManifestFile[] = [];
  for (const file of currentFiles) {
    const original = before.get(keyOf(file.path));
    if (!original) {
      appeared.push(file);
      continue;
    }
    // Only the letter case of the name changed: the same file, renamed in place.
    if (nameOf(original.path) !== nameOf(file.path)) {
      moves.push({ kind: 'move', from: original.path, path: file.path, hash: original.hash, bytes: original.bytes });
    }
    if (original.hash !== file.hash) {
      writes.push({ kind: 'write', path: file.path, hash: file.hash, bytes: file.bytes, expectedHash: original.hash });
    }
  }
  const vanished = baseline.files.filter(file => !after.has(keyOf(file.path)));
  for (const file of appeared.sort(byPath)) {
    const source = moveSource(file, vanished);
    if (source) {
      vanished.splice(vanished.indexOf(source), 1);
      moves.push({ kind: 'move', from: source.path, path: file.path, hash: file.hash, bytes: file.bytes });
    } else {
      writes.push({ kind: 'write', path: file.path, hash: file.hash, bytes: file.bytes, expectedHash: null });
    }
  }
  for (const file of vanished.sort(byPath)) deletes.push({ kind: 'delete', path: file.path, expectedHash: file.hash, bytes: file.bytes });
  const folders = folderChanges(baseline, current);
  if (!options.describeOnly) {
    const typeChanged = folders.some(folder => folder.status === 'added' ? before.has(keyOf(folder.path)) : after.has(keyOf(folder.path)));
    if (typeChanged) throw new Error(TYPE_CHANGE_REFUSAL);
  }
  const created = folders.filter(folder => folder.status === 'added').map(folder => ({ kind: 'folder' as const, path: folder.path }));
  const removed = folders.filter(folder => folder.status === 'deleted').map(folder => ({ kind: 'remove_folder' as const, path: folder.path }));
  return [...created, ...moves, ...writes, ...deletes, ...removed];
}

const isInside = (path: string, folder: string) => keyOf(path).startsWith(`${keyOf(folder)}/`);

/** Where a step takes something from: a deletion's file, a move's old path. */
function originOf(step: IntegrationStep): string | undefined {
  if (step.kind === 'delete') return step.path;
  if (step.kind === 'move') return step.from;
  return undefined;
}

/**
 * The steps for the files and folders the person left ticked in the diff viewer (COD-279), in plan order. A file step
 * goes when any path it touches is ticked, so a move goes with either end: Git may show one renamed file where the
 * plan has a move, or a new file plus a deletion. A new folder also goes when a kept step writes inside it, since the
 * broker creates a new file's parents anyway. A folder removal goes only when it is ticked and nothing inside it stays
 * behind, or the folder would not be empty; it is then skipped like any unticked row.
 */
export function selectSteps(steps: readonly IntegrationStep[], paths: readonly string[]): { kept: IntegrationStep[]; skipped: IntegrationStep[] } {
  const ticked = new Set(paths.map(keyOf));
  const keptFiles = new Set<IntegrationStep>();
  for (const step of steps) {
    if (step.kind === 'folder' || step.kind === 'remove_folder') continue;
    const origin = originOf(step);
    if (ticked.has(keyOf(step.path)) || (origin !== undefined && ticked.has(keyOf(origin)))) keptFiles.add(step);
  }
  const skippedOrigins = steps.filter(step => !keptFiles.has(step)).flatMap(step => originOf(step) ?? []);
  const kept = new Set(keptFiles);
  const skippedRemovals: string[] = [];
  for (const step of steps) {
    if (step.kind === 'folder') {
      const needed = [...keptFiles].some(file => isInside(file.path, step.path)) || paths.some(path => isInside(path, step.path));
      if (ticked.has(keyOf(step.path)) || needed) kept.add(step);
    }
    // Removals come innermost first, so an inner folder left in place is known before its parent is decided.
    if (step.kind === 'remove_folder') {
      const leftBehind = [...skippedOrigins, ...skippedRemovals].some(path => isInside(path, step.path));
      if (ticked.has(keyOf(step.path)) && !leftBehind) kept.add(step);
      else skippedRemovals.push(step.path);
    }
  }
  return { kept: steps.filter(step => kept.has(step)), skipped: steps.filter(step => !kept.has(step)) };
}

function moveSource(file: ManifestFile, vanished: ManifestFile[]): ManifestFile | undefined {
  const candidates = vanished.filter(candidate => candidate.hash === file.hash).sort(byPath);
  const sameName = candidates.find(candidate => keyOf(nameOf(candidate.path)) === keyOf(nameOf(file.path)));
  const sameFolder = candidates.find(candidate => keyOf(folderOf(candidate.path)) === keyOf(folderOf(file.path)));
  return sameName ?? sameFolder ?? candidates[0];
}

/**
 * Folders the copy created (outermost first) and removed (innermost first). Both inventories must list folders; a
 * copy saved before COD-254 has none, and then there are no folder steps: the broker still creates the parents a new
 * file needs, as it always did.
 */
export function folderChanges(baseline: WorkspaceManifest, current: WorkspaceManifest): DiffFolder[] {
  if (!baseline.folders || !current.folders) return [];
  const beforeFolders = new Set(baseline.folders.map(keyOf));
  const afterFolders = new Set(current.folders.map(keyOf));
  const created = current.folders.filter(path => !beforeFolders.has(keyOf(path)));
  const removed = baseline.folders.filter(path => !afterFolders.has(keyOf(path)));
  created.sort((first, second) => depthOf(first) - depthOf(second) || first.localeCompare(second));
  removed.sort((first, second) => depthOf(second) - depthOf(first) || first.localeCompare(second));
  return [
    ...created.map(path => ({ path, status: 'added' as const })),
    ...removed.map(path => ({ path, status: 'deleted' as const })),
  ];
}

/**
 * What a copy with no Git snapshot changed, in the diff viewer's terms (COD-254). A plain folder copy keeps only the
 * snapshot's hashes, so it can say which files were added, changed, moved or deleted, but not which lines. A moved
 * file that was also edited shows once, as the move.
 */
export function plainCopyDiff(baseline: WorkspaceManifest, current: WorkspaceManifest): Omit<WorkspaceDiff, 'runId'> {
  const steps = planIntegration(baseline, current, { describeOnly: true });
  const files = new Map<string, DiffFile>();
  const folders: DiffFolder[] = [];
  const entry = (path: string, status: DiffFile['status'], previousPath?: string): DiffFile => ({
    path, ...(previousPath ? { previousPath } : {}), status, binary: false, additions: 0, deletions: 0, truncated: false, hunks: [],
  });
  for (const step of steps) {
    if (step.kind === 'folder') folders.push({ path: step.path, status: 'added' });
    else if (step.kind === 'remove_folder') folders.push({ path: step.path, status: 'deleted' });
    else if (step.kind === 'move') files.set(keyOf(step.path), entry(step.path, 'renamed', step.from));
    else if (step.kind === 'delete') files.set(keyOf(step.path), entry(step.path, 'deleted'));
    else if (!files.has(keyOf(step.path))) files.set(keyOf(step.path), entry(step.path, step.expectedHash === null ? 'added' : 'modified'));
  }
  return {
    files: [...files.values()].sort(byPath), additions: 0, deletions: 0, truncated: false, lines: false,
    ...(folders.length ? { folders: folders.sort(byPath) } : {}),
  };
}
