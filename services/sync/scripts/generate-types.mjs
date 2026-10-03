import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const directory = resolve(import.meta.dirname, '..');
const result = spawnSync(process.execPath, [resolve(directory, 'node_modules/wrangler/bin/wrangler.js'), 'types',
  '--include-runtime', '--include-env', '--strict-vars=false'], {
  cwd: directory, stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
});
if (result.status !== 0) process.exit(result.status ?? 1);
const path = resolve(directory, 'worker-configuration.d.ts');
const generated = (await readFile(path, 'utf8')).replace(/[\t ]+$/gm, '').replaceAll('interface Env extends __BaseEnv_Env {}', 'interface Env extends __BaseEnv_Env { SYNC_MASTER_KEYS: string; }');
if (!generated.includes('interface Env') || !generated.includes('DurableObjectState')) throw new Error('Missing generated sync runtime types');
// Worker runtime globals belong to this service module, never Electron's ambient scope.
await writeFile(path, `${generated}\nexport type { Env, DurableObjectState, DurableObjectStub, WebSocket, WebSocketRequestResponsePair };\nexport { CloudflareWorkersModule };\n`);

