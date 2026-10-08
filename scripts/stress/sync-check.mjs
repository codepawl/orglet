import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleEntry, runBundle, stressRoot } from './bundle.mjs';

/**
 * `node scripts/stress/sync-check.mjs <tier> [max batches]`: pushes a seeded profile to a local copy of services/sync (the
 * real Worker in Miniflare, with the test identity whose free entitlement is 5 MB) and prints what the service accepts,
 * when it refuses and what a retry costs on this side. It needs the service's own packages (`services/sync/node_modules`);
 * when this checkout has none, the main checkout's are linked in for the run and unlinked after.
 * The profile must already be seeded in the stress folder (`node scripts/stress/seed.mjs <tier> <folder>/<tier>/data`).
 */
const tier = process.argv[2] ?? 'x10';
const maxBatches = process.argv[3] ?? '400';
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const serviceDirectory = join(repositoryRoot, 'services', 'sync');
const linked = join(serviceDirectory, 'node_modules');
let createdLink = false;
if (!existsSync(linked)) {
  const common = spawnSync('git', ['rev-parse', '--git-common-dir'], { cwd: repositoryRoot, encoding: 'utf8' }).stdout.trim();
  const mainCheckout = resolve(repositoryRoot, common, '..');
  const target = join(mainCheckout, 'services', 'sync', 'node_modules');
  if (!existsSync(target)) throw new Error('services/sync has no node_modules here or in the main checkout; install its packages first.');
  symlinkSync(target, linked, 'junction');
  createdLink = true;
}

const output = mkdtempSync(join(tmpdir(), 'orglet-sync-stress-'));
let runtime;
try {
  const built = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'deploy', 'test/runtime-worker.ts', '--dry-run', '--outdir', output],
    { cwd: serviceDirectory, encoding: 'utf8', env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' } });
  if (built.status !== 0) throw new Error(built.stderr || built.stdout);
  const bundle = join(output, readdirSync(output).find(file => file.endsWith('.js')));
  const { Miniflare, convertV4MiniflareOptions } = createRequire(join(serviceDirectory, 'package.json'))('miniflare');
  const masters = JSON.stringify({ active: 1, keys: { 1: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64') } });
  const options = convertV4MiniflareOptions({ workers: [{ name: 'orglet-sync-stress', modules: true, script: readFileSync(bundle, 'utf8'), compatibilityDate: '2026-10-03',
    durableObjects: { SYNC_ACCOUNTS: { className: 'AccountSync', useSQLite: true } }, r2Buckets: ['SYNC_FILES'],
    bindings: { SYNC_ENABLED: 'true', SYNC_ISSUER: 'https://issuer.test/api/auth', SYNC_AUDIENCE: 'https://sync.test', SYNC_MASTER_KEYS: masters,
      // The deployment's own limits (services/sync/wrangler.jsonc); the 5 MB entitlement comes from the test identity.
      SYNC_MAX_ACCOUNT_BYTES: '33554432', SYNC_MAX_RECORDS: '10000', SYNC_MAX_FILE_BYTES: '26214400', SYNC_MAX_FILE_STORAGE_BYTES: '268435456',
      SYNC_RATE_REQUESTS: '1000000', SYNC_RATE_FILES: '60', SYNC_RATE_DEVICES: '10' } }] });
  options.resourcePersistencePath = join(output, 'state');
  options.telemetry = { enabled: false };
  options.port = 0;
  runtime = new Miniflare(options);
  const url = (await runtime.ready).toString().replace(/\/$/, '');
  const pushBundle = await bundleEntry('sync-push');
  const summaryPath = join(stressRoot, `seed-${tier}.json`);
  const { status, output: printed } = await runBundle(pushBundle, [summaryPath, join(stressRoot, tier, 'sync-copy'), url, maxBatches], { inherit: false });
  const line = printed.split('\n').find(candidate => candidate.startsWith('SYNC_RESULT '));
  if (status !== 0 || !line) throw new Error('The push run failed.');
  console.log(line.slice('SYNC_RESULT '.length));
  rmSync(join(stressRoot, tier, 'sync-copy'), { recursive: true, force: true });
} finally {
  await runtime?.dispose();
  rmSync(output, { recursive: true, force: true });
  if (createdLink) unlinkSync(linked);
}
