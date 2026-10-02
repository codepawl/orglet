import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const serviceDirectory = resolve(import.meta.dirname, '..');
const generatedPath = resolve(serviceDirectory, 'worker-configuration.d.ts');
const result = spawnSync(process.execPath, [
  resolve(serviceDirectory, 'node_modules/wrangler/bin/wrangler.js'), 'types', '--env', 'local_test',
], {
  cwd: serviceDirectory, stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
});
if (result.status !== 0) process.exit(result.status ?? 1);
const generated = await readFile(generatedPath, 'utf8');
if (!generated.includes('interface Env') || !generated.includes('class D1Database')) {
  throw new Error('Generated Worker type declarations are missing required types.');
}
// A module boundary keeps Worker DOM and ProcessEnv declarations out of Electron's ambient scope.
const normalized = generated.replace(/[\t ]+$/gm, '');
const moduleTypes = normalized.includes('export type { D1Database, Env };')
  ? normalized : `${normalized}\nexport type { D1Database, Env };\n`;
await writeFile(generatedPath, moduleTypes);
