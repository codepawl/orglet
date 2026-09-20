import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const packaged = process.argv.includes('--packaged');
const executable = resolve(packaged ? 'out/Orglet-win32-x64/resources/wxc-exec.exe' : 'node_modules/@microsoft/mxc-sdk/bin/x64/wxc-exec.exe');
if (!existsSync(executable)) throw new Error('Sandbox executable missing; install dependencies or package the app first.');
const suites = ['tests/integration/sandbox.test.ts'];
if (packaged) {
  const compile = spawnSync(process.execPath, ['scripts/build-workspace-native.mjs', '--test'], { stdio: 'inherit', windowsHide: true });
  if (compile.error) throw compile.error;
  if (compile.status !== 0) process.exit(compile.status ?? 1);
  suites.push('tests/integration/workspace-files.test.ts', 'tests/integration/workspace-integration.test.ts', 'tests/integration/workspace-runtime.test.ts', 'tests/integration/workspace-processes.test.ts', 'tests/integration/workspace-git.test.ts');
}
const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...suites], {
  stdio: 'inherit', windowsHide: true,
  env: { ...process.env, ORGLET_TEST_SANDBOX: '1', ORGLET_TEST_SANDBOX_EXECUTABLE: executable,
    ...(packaged ? { ORGLET_TEST_INTEGRATION_EXECUTABLE: resolve('out/Orglet-win32-x64/resources/WorkspaceIntegrate.exe') } : {}),
  },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
