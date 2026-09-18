import { afterEach, beforeEach, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hasLinkInPath } from '../../apps/desktop/src/core/tools/sources';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orglet-links-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

/** The Windows 8.3 short form of a path, or null when the volume does not create short names. */
function shortPathOf(path: string): string | null {
  if (process.platform !== 'win32') return null;
  const command = `/c for %I in ("${path}") do @echo %~sI`;
  const output = spawnSync('cmd', [command], { encoding: 'utf8', windowsVerbatimArguments: true }).stdout.trim();
  return output.toLowerCase() === path.toLowerCase() ? null : output;
}

it('accepts a plain file and a Windows short path to it', async () => {
  // On macOS tmpdir is under /var/folders; /var is a system alias to /private/var, not a user link.
  const folder = join(directory, 'A folder with a long name');
  await mkdir(folder);
  const file = join(folder, 'note.txt');
  await writeFile(file, 'hello');

  expect(await hasLinkInPath(file)).toBe(false);

  const shortFolder = shortPathOf(folder);
  if (shortFolder) expect(await hasLinkInPath(join(shortFolder, 'note.txt'))).toBe(false);
});

it('rejects a file reached through a linked folder', async () => {
  const realFolder = join(directory, 'real');
  await mkdir(realFolder);
  await writeFile(join(realFolder, 'note.txt'), 'hello');
  const linkedFolder = join(directory, 'linked');
  await symlink(realFolder, linkedFolder, 'junction');

  expect(await hasLinkInPath(join(linkedFolder, 'note.txt'))).toBe(true);
  expect(await hasLinkInPath(linkedFolder)).toBe(true);
});
