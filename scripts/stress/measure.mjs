import { bundleEntry, runBundle } from './bundle.mjs';

/** `node scripts/stress/measure.mjs <seed summary.json> <copy folder> [only]` measures the core of a seeded profile. */
const bundle = await bundleEntry('measure-core');
const { status } = await runBundle(bundle, process.argv.slice(2));
process.exitCode = status;
