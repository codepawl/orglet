import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { seedProfile, STRESS_TIERS, type StressConfig } from './seed-profile';

/** `node seed-cli.cjs <tier> <data folder> [--key=value ...]`; a key is any number field of the tier. */
async function main() {
  const [tierName, dataDirectory, ...overrides] = process.argv.slice(2);
  const tier = STRESS_TIERS[tierName];
  if (!tier || !dataDirectory) throw new Error(`Usage: seed-cli <${Object.keys(STRESS_TIERS).join('|')}> <data folder> [--orglets=N ...]`);
  const config: StressConfig = { ...tier };
  for (const override of overrides) {
    const [key, value] = override.replace(/^--/, '').split('=');
    if (!(key in config) || key === 'name') throw new Error(`Unknown setting ${key}`);
    (config as Record<string, unknown>)[key] = Number(value);
  }
  // A profile is always written from nothing, so a second run never meets the first one's rows.
  rmSync(dataDirectory, { recursive: true, force: true });
  const summary = await seedProfile(config, dataDirectory, join(dataDirectory, '..', `${config.name}-source-files`), message => console.error(`[seed] ${message}`));
  console.log(JSON.stringify(summary));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
