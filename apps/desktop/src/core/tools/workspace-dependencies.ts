import { lstat, readlink, realpath, rmdir, stat, symlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { WorkspaceManifest } from '../../shared/workspace-tools';

/**
 * Installed dependencies for commands (COD-271). The private copy never has `node_modules`: the snapshot skips it and
 * a Git worktree does not carry it, so a script that needs vitest, tsc or a library failed. Before a command runs,
 * each `node_modules` of the granted folder that sits next to a package.json the copy started with is linked into the
 * copy at the same place, and the sandbox gets its real path as read-only. The links exist only while the command
 * runs. `node_modules` is never snapshotted, diffed or integrated, and the file tools never follow a link, so nothing
 * inside it can be changed or handed in.
 */

export type DependencyLink = { link: string; target: string };

/** Enough for a monorepo's packages; more would only slow every command down. */
const MAX_DEPENDENCY_FOLDERS = 16;

function isInside(root: string, path: string): boolean {
  const offset = relative(root, path);
  return offset === '' || (!offset.startsWith('..') && !isAbsolute(offset));
}

/** The folders of the copy's original package.json files, the root first. */
function packageFolders(baseline: WorkspaceManifest): string[] {
  const folders = new Set<string>();
  for (const file of baseline.files) {
    const parts = file.path.split('/');
    if (parts.at(-1) !== 'package.json') continue;
    folders.add(parts.slice(0, -1).join('/'));
  }
  return [...folders].sort((first, second) => first.split('/').length - second.split('/').length || first.localeCompare(second));
}

/**
 * The `node_modules` folders a command in this copy may read: real folders (never a link) inside the granted folder,
 * next to a package.json the copy started with.
 */
export async function dependencyFolders(source: string, copyDirectory: string, baseline: WorkspaceManifest): Promise<DependencyLink[]> {
  const root = await realpath(source);
  const links: DependencyLink[] = [];
  for (const folder of packageFolders(baseline)) {
    if (links.length >= MAX_DEPENDENCY_FOLDERS) break;
    const candidate = join(root, ...folder.split('/').filter(Boolean), 'node_modules');
    const entry = await lstat(candidate).catch(() => null);
    if (!entry || !entry.isDirectory() || entry.isSymbolicLink()) continue;
    const target = await realpath(candidate).catch(() => null);
    if (!target || !isInside(root, target)) continue;
    links.push({ link: join(copyDirectory, ...folder.split('/').filter(Boolean), 'node_modules'), target });
  }
  return links;
}

/**
 * Creates the links that are missing and returns the ones in place. Something else already at a link's path (a
 * folder a command made) is left alone and that link is skipped; a link left by an interrupted command is reused.
 */
export async function linkDependencies(links: readonly DependencyLink[]): Promise<DependencyLink[]> {
  const linked: DependencyLink[] = [];
  for (const dependency of links) {
    const existing = await lstat(dependency.link).catch(() => null);
    if (existing) {
      if (existing.isSymbolicLink() && resolve(await readlink(dependency.link)) === resolve(dependency.target)) linked.push(dependency);
      continue;
    }
    const parent = await stat(dirname(dependency.link)).catch(() => null);
    if (!parent?.isDirectory()) continue;
    await symlink(dependency.target, dependency.link, 'junction');
    linked.push(dependency);
  }
  return linked;
}

/** Removes only the links themselves; `rmdir` on a junction never touches what it points to. */
export async function unlinkDependencies(links: readonly DependencyLink[]): Promise<void> {
  for (const dependency of links) {
    const existing = await lstat(dependency.link).catch(() => null);
    if (existing?.isSymbolicLink()) await rmdir(dependency.link);
  }
}
