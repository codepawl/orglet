import { beforeEach, describe, expect, it, vi } from 'vitest';

const installUpdate = vi.fn(async () => undefined);
const confirmAction = vi.fn(async (_question: { title: string; description?: string }) => true);
vi.mock('../../apps/desktop/src/renderer/api', () => ({ orglet: { installUpdate } }));
vi.mock('../../apps/desktop/src/renderer/components/confirm', () => ({ confirmAction }));

const { restartIntoUpdate } = await import('../../apps/desktop/src/renderer/updateRestart');

/** Every restart into an update, from the sidebar, a notice or About, goes through one question (COD-304). */
describe('restarting into a downloaded update', () => {
  beforeEach(() => {
    installUpdate.mockClear();
    confirmAction.mockClear();
  });

  it('restarts at once when nothing is running', async () => {
    expect(await restartIntoUpdate(0)).toBe(true);
    expect(confirmAction).not.toHaveBeenCalled();
    expect(installUpdate).toHaveBeenCalledTimes(1);
  });

  it('asks first while runs are working, naming how many will be interrupted', async () => {
    expect(await restartIntoUpdate(2)).toBe(true);
    expect(confirmAction).toHaveBeenCalledTimes(1);
    expect(confirmAction.mock.calls[0][0].description).toContain('2 runs that are working will be interrupted');
    expect(installUpdate).toHaveBeenCalledTimes(1);
  });

  it('keeps the app open when the person says later', async () => {
    confirmAction.mockResolvedValueOnce(false);
    expect(await restartIntoUpdate(1)).toBe(false);
    expect(confirmAction.mock.calls[0][0].description).toContain('1 run that is working will be interrupted');
    expect(installUpdate).not.toHaveBeenCalled();
  });
});
