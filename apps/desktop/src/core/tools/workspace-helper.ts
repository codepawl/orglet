import { readFile } from 'node:fs/promises';
import { executeWorkspaceOperation } from './workspace-files';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { StartWorkspaceProcess } from '../../shared/workspace-processes';

async function command(raw: unknown) {
  const input = StartWorkspaceProcess.parse(raw);
  const child = input.program === 'node'
    ? spawn(process.execPath, input.arguments, { windowsHide: true, stdio: 'inherit' })
    : spawn(input.arguments[0], { shell: join(process.env.SystemRoot!, 'System32', 'cmd.exe'), windowsHide: true, stdio: 'inherit' });
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => { process.exitCode = code ?? 1; resolve(); });
  });
}

async function main() {
  try {
    const input = await readFile(process.argv[2], 'utf8');
    if (Buffer.byteLength(input) > 1024 * 1024) throw new Error('Workspace request too large');
    const request = JSON.parse(input);
    if (request.operation === 'command') {
      await command(request.command);
      return;
    }
    const value = await executeWorkspaceOperation(process.cwd(), request);
    process.stdout.write(JSON.stringify({ ok: true, value }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Workspace operation failed' }));
    process.exitCode = 1;
  }
}
void main();
