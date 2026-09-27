import { describe, expect, it, vi } from 'vitest';
import { launchApp } from '../../apps/desktop/src/cli/client';
import { CliOperations } from '../../apps/desktop/src/main/cli-operations';

const childProcess = vi.hoisted(() => ({ spawn: vi.fn(() => ({ unref: vi.fn() })) }));
vi.mock('node:child_process', () => childProcess);

describe('terminal backend startup', () => {
  it('starts without a window on the selected data folder, outside Node mode', () => {
    const environment = { ELECTRON_RUN_AS_NODE: '1', ORGLET_USER_DATA: 'C:\\chat data' };
    launchApp('C:\\Orglet\\Orglet.exe', environment.ORGLET_USER_DATA, environment);
    expect(childProcess.spawn).toHaveBeenLastCalledWith('C:\\Orglet\\Orglet.exe', ['--orglet-cli-background', '--user-data-dir=C:\\chat data'], {
      detached: true, stdio: 'ignore', windowsHide: true, env: { ORGLET_USER_DATA: 'C:\\chat data' },
    });
    expect(environment.ELECTRON_RUN_AS_NODE).toBe('1');
    expect(childProcess.spawn.mock.results.at(-1)?.value.unref).toHaveBeenCalledOnce();
  });

  it('waits for the desktop to load before confirming open, and reports a failed load', async () => {
    let finish: () => void = () => undefined;
    const opening = new Promise<void>(resolve => { finish = resolve; });
    const operations = new CliOperations({ request: async () => undefined, version: () => '0.7.2', open: () => opening, translate: message => message });
    let confirmed = false;
    const response = operations.open(undefined).then(() => { confirmed = true; });
    await Promise.resolve();
    expect(confirmed).toBe(false);
    finish();
    await response;
    expect(confirmed).toBe(true);
    const failing = new CliOperations({ request: async () => undefined, version: () => '0.7.2', open: async () => { throw new Error('Renderer failed'); }, translate: message => message });
    await expect(failing.open(undefined)).rejects.toThrow('Renderer failed');
  });
});
