import { lstatSync, readlinkSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * Following pnpm's links inside the installed dependencies a command may read (COD-271). The sandbox runs Node with
 * `--preserve-symlinks`, because resolving a real path lstat's every folder up to the drive root and the sandbox
 * denies `C:\`. pnpm reaches each package through a link (`node_modules/eslint` → `.pnpm/eslint@9/node_modules/eslint`)
 * and puts its dependencies beside the real folder, so with the link path kept, a package cannot find them. This
 * resolves only the links inside a granted `node_modules`, reading nothing above it, which gives the same answer the
 * real path would.
 */

export type DependencyLinkPair = { link: string; target: string };

/** Environment variable that carries the command's links to the preload in each Node process it starts. */
export const DEPENDENCY_LINKS_VARIABLE = 'ORGLET_DEPENDENCY_LINKS';
/** The preload file, built next to the workspace helper. */
export const DEPENDENCY_HOOKS_FILE = 'workspace-dependency-hooks.cjs';

/** Enough for pnpm's link inside a link; a cycle stops here instead of looping. */
const MAX_LINKS_FOLLOWED = 32;

function isInside(root: string, path: string): boolean {
  const offset = relative(root, path);
  return offset === '' || (!offset.startsWith('..') && !isAbsolute(offset));
}

type FileSystem = { lstatSync: typeof lstatSync; readlinkSync: typeof readlinkSync };

/**
 * The path a file has once the links inside its granted `node_modules` are followed. A path outside every linked
 * folder, a missing part, or a link that leads out of the granted folder leaves the path as it was.
 */
export function followDependencyLinks(file: string, pairs: readonly DependencyLinkPair[], fileSystem: FileSystem = { lstatSync, readlinkSync }): string {
  let current = file;
  for (let followed = 0; followed < MAX_LINKS_FOLLOWED; followed++) {
    const next = followOneLink(current, pairs, fileSystem);
    if (next === current) return current;
    current = next;
  }
  return current;
}

function followOneLink(file: string, pairs: readonly DependencyLinkPair[], fileSystem: FileSystem): string {
  for (const pair of pairs) {
    const base = isInside(pair.link, file) ? pair.link : isInside(pair.target, file) ? pair.target : null;
    if (!base) continue;
    const segments = relative(base, file).split(sep).filter(Boolean);
    let current = pair.target;
    for (const [index, segment] of segments.entries()) {
      current = join(current, segment);
      let isLink: boolean;
      try { isLink = fileSystem.lstatSync(current).isSymbolicLink(); }
      catch { return join(pair.target, ...segments); }
      if (!isLink) continue;
      const destination = resolve(dirname(current), fileSystem.readlinkSync(current));
      if (!isInside(pair.target, destination)) return file;
      return join(destination, ...segments.slice(index + 1));
    }
    return current;
  }
  return file;
}

/** Reads the links a command was given; anything malformed means none. */
export function parseDependencyLinks(raw: string | undefined): DependencyLinkPair[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((pair): pair is DependencyLinkPair => typeof pair?.link === 'string' && typeof pair?.target === 'string'
      && isAbsolute(pair.link) && isAbsolute(pair.target)).slice(0, 16);
  } catch {
    return [];
  }
}
