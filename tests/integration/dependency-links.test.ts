import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { build } from 'rolldown';
import { DEPENDENCY_LINKS_VARIABLE, followDependencyLinks, parseDependencyLinks } from '../../apps/desktop/src/core/tools/dependency-links';
import { toolchainEnvironment } from '../../apps/desktop/src/core/tools/package-scripts';

const run = promisify(execFile);
let directory: string;
let source: string;
let copy: string;

/** A pnpm layout: `a` is reached through a link and finds `b` beside its real folder, the way pnpm installs. */
async function pnpmLayout() {
  const store = join(source, 'node_modules', '.pnpm');
  const realA = join(store, 'a@1.0.0', 'node_modules', 'a');
  const realB = join(store, 'b@1.0.0', 'node_modules', 'b');
  await mkdir(realA, { recursive: true });
  await mkdir(realB, { recursive: true });
  await writeFile(join(realA, 'package.json'), JSON.stringify({ name: 'a', exports: { import: './index.mjs', require: './index.cjs' } }));
  await writeFile(join(realA, 'index.cjs'), "module.exports = `a sees ${require('b')}`;");
  await writeFile(join(realA, 'index.mjs'), "import b from 'b'; export default `a sees ${b}`;");
  await writeFile(join(realB, 'package.json'), JSON.stringify({ name: 'b', main: 'index.cjs' }));
  await writeFile(join(realB, 'index.cjs'), "module.exports = 'b';");
  await symlink(realB, join(store, 'a@1.0.0', 'node_modules', 'b'), 'junction');
  await symlink(realA, join(source, 'node_modules', 'a'), 'junction');
  await mkdir(copy, { recursive: true });
  await symlink(join(source, 'node_modules'), join(copy, 'node_modules'), 'junction');
}

beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'orglet-dependency-links-')));
  source = join(directory, 'source');
  copy = join(directory, 'copy');
  await pnpmLayout();
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe('following pnpm links inside granted dependencies (COD-271)', () => {
  it('takes a path through the copy link and pnpm link to the real folder', () => {
    const pairs = [{ link: join(copy, 'node_modules'), target: join(source, 'node_modules') }];
    const followed = followDependencyLinks(join(copy, 'node_modules', 'a', 'index.cjs'), pairs);
    expect(followed).toBe(join(source, 'node_modules', '.pnpm', 'a@1.0.0', 'node_modules', 'a', 'index.cjs'));
    expect(followDependencyLinks(join(copy, 'src', 'main.js'), pairs)).toBe(join(copy, 'src', 'main.js'));
  });

  it('never follows a link out of the granted node_modules', async () => {
    const outside = join(directory, 'outside');
    await mkdir(outside);
    await symlink(outside, join(source, 'node_modules', 'escape'), 'junction');
    const pairs = [{ link: join(copy, 'node_modules'), target: join(source, 'node_modules') }];
    const escaping = join(copy, 'node_modules', 'escape', 'index.js');
    expect(followDependencyLinks(escaping, pairs)).toBe(escaping);
  });

  it('reads only well-formed absolute pairs', () => {
    expect(parseDependencyLinks(undefined)).toEqual([]);
    expect(parseDependencyLinks('not json')).toEqual([]);
    expect(parseDependencyLinks(JSON.stringify([{ link: 'relative', target: '/x' }, { link: resolve('/a'), target: resolve('/b') }])))
      .toEqual([{ link: resolve('/a'), target: resolve('/b') }]);
  });

  it('lets require and import find a pnpm package\'s dependencies under --preserve-symlinks', async () => {
    const hooks = join(directory, 'hooks.cjs');
    await build({ input: resolve('apps/desktop/src/core/tools/dependency-hooks.ts'), platform: 'node', external: [/^node:/],
      output: { file: hooks, format: 'cjs' }, logLevel: 'silent' });
    await writeFile(join(copy, 'main.cjs'), "console.log(require('a'));");
    await writeFile(join(copy, 'main.mjs'), "import a from 'a'; console.log(a);");
    const base = { ...process.env, NODE_OPTIONS: '--preserve-symlinks --preserve-symlinks-main' };
    await expect(run(process.execPath, ['main.cjs'], { cwd: copy, env: base })).rejects.toThrow(/Cannot find module 'b'/);
    const environment = toolchainEnvironment(base, { runtime: process.execPath, helper: 'unused', root: copy, shims: join(directory, 'shims'),
      dependencies: { hooks, links: [{ link: join(copy, 'node_modules'), target: join(source, 'node_modules') }] } });
    expect(environment[DEPENDENCY_LINKS_VARIABLE]).toContain('node_modules');
    expect(environment.NODE_OPTIONS).toContain(`--require "${hooks.replaceAll('\\', '/')}"`);
    const required = await run(process.execPath, ['main.cjs'], { cwd: copy, env: environment });
    expect(required.stdout.trim()).toBe('a sees b');
    const imported = await run(process.execPath, ['main.mjs'], { cwd: copy, env: environment });
    expect(imported.stdout.trim()).toBe('a sees b');
  });
});
