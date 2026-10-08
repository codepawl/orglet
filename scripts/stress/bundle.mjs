import { mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { constants, setPriority, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// esbuild is not a dependency of this package on its own: it comes with vite and the Forge plugin, and the repository's
// hoisted node_modules (pnpm-workspace.yaml: nodeLinker) put it where this script finds it.
import { build } from 'esbuild';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Folder for the bundles, the seeded profiles and their source files. */
export const stressRoot = process.env.ORGLET_STRESS_DIR ?? join(tmpdir(), 'orglet-stress');

/**
 * Bundles one TypeScript entry of this folder into a single CommonJS file that plain Node runs, so the stress tools use
 * the core's real classes without a test runner. Returns the file's path.
 */
export async function bundleEntry(name) {
  const outputFolder = join(stressRoot, 'build');
  mkdirSync(outputFolder, { recursive: true });
  const outfile = join(outputFolder, `${name}.cjs`);
  await build({
    entryPoints: [join(repositoryRoot, 'scripts', 'stress', `${name}.ts`)],
    outfile, bundle: true, platform: 'node', format: 'cjs', target: 'node24', logLevel: 'error',
    // Optional native or lazily loaded packages the stress tools never reach.
    external: ['electron', 'playwright-core', '@duckdb/node-api', 'bufferutil', 'utf-8-validate'],
  });
  return outfile;
}

/**
 * Runs a bundle in a child Node at below-normal priority, so a long measurement never starves the person's own
 * windows. `heapMegabytes` caps the child's heap, so a bad case fails instead of filling the machine's memory.
 */
export function runBundle(bundle, args, { heapMegabytes = 3072, inherit = true, extraNodeArguments = [] } = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [`--max-old-space-size=${heapMegabytes}`, ...extraNodeArguments, bundle, ...args],
      { stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'inherit'] });
    try { setPriority(child.pid, constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* the child already ended */ }
    let output = '';
    child.stdout?.on('data', chunk => { output += chunk; });
    child.on('error', rejectRun);
    child.on('close', status => resolveRun({ status: status ?? 1, output }));
  });
}
