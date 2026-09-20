import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { WindowsSandbox, sandboxConfiguration, sandboxEnvironment } from '../../apps/desktop/src/core/tools/sandbox';

const native = describe.runIf(process.env.ORGLET_TEST_SANDBOX === '1');
const executable = process.env.ORGLET_TEST_SANDBOX_EXECUTABLE ?? resolve('node_modules/@microsoft/mxc-sdk/bin/x64/wxc-exec.exe');

it('builds a default-deny policy without copying the host environment', () => {
  const prior = process.env.SystemRoot;
  process.env.SystemRoot = 'C:\\Windows';
  try {
    const environment = sandboxEnvironment('C:\\sandbox', ['C:\\runtime']);
    expect(environment).not.toHaveProperty('OPENAI_API_KEY');
    expect(environment).not.toHaveProperty('MXC_FORCE_TIER');
    expect(environment.PATH).toBe('C:\\runtime;C:\\Windows\\System32');
    const configuration = sandboxConfiguration({ directory: 'C:\\sandbox', runtimeDirectories: ['C:\\runtime'],
      commandLine: 'node check.js', timeoutMs: 1000, signal: new AbortController().signal }, environment);
    expect(configuration).not.toHaveProperty('network');
    expect(configuration.fallback.allowDaclMutation).toBe(false);
    expect(configuration.filesystem.readwritePaths).toEqual(['C:\\sandbox']);
  } finally {
    if (prior === undefined) delete process.env.SystemRoot;
    else process.env.SystemRoot = prior;
  }
});

native('real Windows BaseContainer', () => {
  let directory: string;
  let workspace: string;
  let sandbox: WindowsSandbox;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'orglet-isolation-'));
    workspace = join(directory, 'workspace');
    await mkdir(workspace);
    sandbox = new WindowsSandbox(executable);
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  async function execute(source: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}) {
    const script = join(workspace, 'operation.cjs');
    await writeFile(script, source);
    return sandbox.run({ directory: workspace, runtimeDirectories: [dirname(process.execPath)],
      commandLine: `"${process.execPath}" "${script}"`, timeoutMs: options.timeoutMs ?? 5000,
      signal: options.signal ?? new AbortController().signal });
  }

  it('allows workspace edits while denying external files and junction escape', async () => {
    const outside = join(directory, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'canary'), 'unchanged');
    await symlink(outside, join(workspace, 'escape'), 'junction');
    const paths = [join(outside, 'canary'), join(workspace, 'escape', 'canary')];
    const result = await execute(`const fs=require('fs');const paths=${JSON.stringify(paths)};
      const denied=paths.map(path=>{let read=false,write=false;try{fs.readFileSync(path)}catch{read=true}
      try{fs.writeFileSync(path,'bad')}catch{write=true}return read&&write});
      fs.writeFileSync('allowed.txt','ok');console.log(JSON.stringify(denied));`);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([true, true]);
    expect(await readFile(join(workspace, 'allowed.txt'), 'utf8')).toBe('ok');
    expect(await readFile(join(outside, 'canary'), 'utf8')).toBe('unchanged');
  });

  it('does not pass host environment secrets to executor or child', async () => {
    process.env.ORGLET_TEST_PRIVATE_CANARY = 'synthetic-private-value';
    try {
      const result = await execute(`console.log(JSON.stringify({leaked:'ORGLET_TEST_PRIVATE_CANARY' in process.env}));`);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ leaked: false });
    } finally {
      delete process.env.ORGLET_TEST_PRIVATE_CANARY;
    }
  });

  it('blocks host loopback even when a real server is listening', async () => {
    let connections = 0;
    const server = createServer(socket => { connections++; socket.end(); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing test port');
      const result = await execute(`const socket=require('net').connect(${address.port},'127.0.0.1');
        socket.on('connect',()=>{console.log('allowed');socket.destroy()});
        socket.on('error',()=>console.log('denied'));socket.setTimeout(1000,()=>socket.destroy());`);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe('denied');
      expect(connections).toBe(0);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('caps output and terminates a noisy process', async () => {
    const result = await execute(`for(;;)process.stdout.write('x'.repeat(8192));`);
    expect(result.termination).toBe('output_limit');
    expect(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr)).toBeLessThanOrEqual(256 * 1024);
  });

  it.each(['cancel', 'timeout'])('stops descendants after %s', async mode => {
    const heartbeat = join(workspace, 'heartbeat');
    const descendant = join(workspace, 'descendant.cjs');
    await writeFile(descendant, `setInterval(()=>require('fs').appendFileSync(${JSON.stringify(heartbeat)},'.'),40);`);
    const controller = new AbortController();
    const running = execute(`require('child_process').spawn(process.execPath,[${JSON.stringify(descendant)}],{stdio:'ignore'});setInterval(()=>{},1000);`,
      { signal: controller.signal, timeoutMs: mode === 'timeout' ? 1800 : 5000 });
    for (let attempt = 0; attempt < 40; attempt++) {
      if ((await readFile(heartbeat, 'utf8').catch(() => '')).length >= 3) break;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    expect((await readFile(heartbeat, 'utf8')).length).toBeGreaterThanOrEqual(3);
    if (mode === 'cancel') controller.abort();
    const result = await running;
    expect(result.termination).toBe(mode === 'cancel' ? 'cancelled' : 'timeout');
    const stopped = await readFile(heartbeat, 'utf8');
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(await readFile(heartbeat, 'utf8')).toBe(stopped);
  });
});
