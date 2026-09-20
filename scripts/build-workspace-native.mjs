import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

if (process.platform === 'win32' && process.arch === 'x64') {
  const outputDirectory = resolve('out/native-tools');
  mkdirSync(outputDirectory, { recursive: true });
  const compiler = join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  const testing = process.argv.includes('--test');
  execFileSync(compiler, ['/nologo', '/target:exe', '/optimize+', '/reference:System.Web.Extensions.dll',
    ...(testing ? ['/define:WORKSPACE_TESTING'] : []),
    `/out:${join(outputDirectory, testing ? 'WorkspaceIntegrateTest.exe' : 'WorkspaceIntegrate.exe')}`, resolve('apps/desktop/native/WorkspaceIntegrate.cs')],
  { windowsHide: true, stdio: 'inherit' });
}
