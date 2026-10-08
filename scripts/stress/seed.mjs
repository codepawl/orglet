import { bundleEntry, runBundle } from './bundle.mjs';

/** `node scripts/stress/seed.mjs <x1|x10|x100|tiny> <data folder> [--key=value ...]` writes a synthetic profile. */
const bundle = await bundleEntry('seed-cli');
const { status } = await runBundle(bundle, process.argv.slice(2));
process.exitCode = status;
