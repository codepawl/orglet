import { describe, expect, it } from 'vitest';
import { appChangeMessage, unannouncedChanges } from '../../apps/desktop/src/renderer/appChangeNotices';
import type { AppChangeNotice } from '../../apps/desktop/src/shared/app-proposals';

const change = (id: string, extra: Partial<AppChangeNotice> = {}): AppChangeNotice => ({
  id, taskId: 'task', kind: 'settings', action: 'edit', title: 'Theme', automatic: true, appliedAt: '2026-09-23T08:00:00.000Z', workerName: 'Researcher', ...extra,
});

/** A change a worker made to the app is announced once, and says who made it and whether it applied on its own. */
describe('app change notices', () => {
  it('announces only the changes not seen before', () => {
    expect(unannouncedChanges([change('b'), change('a')], ['a']).map(item => item.id)).toEqual(['b']);
    expect(unannouncedChanges([change('a')], ['a'])).toEqual([]);
  });

  it('names the worker and says whether the change applied on its own', () => {
    expect(appChangeMessage(change('a'))).toContain('Researcher');
    expect(appChangeMessage(change('a', { automatic: true }))).not.toBe(appChangeMessage(change('a', { automatic: false })));
    expect(appChangeMessage(change('a', { kind: 'orglet', action: 'create', workerName: '' }))).not.toContain('undefined');
  });
});
