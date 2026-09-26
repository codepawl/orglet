import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import type { Worker } from '../../apps/desktop/src/shared/contracts';
import { crewsWithMember, leaveCrewsMessage, removalBlocker } from '../../apps/desktop/src/shared/removal';
import { translateMessage } from '../../apps/desktop/src/shared/i18n';
import { en } from '../../apps/desktop/src/shared/locales/en';

const crew = (id: string, name: string, memberIds: string[], synthesizerId = memberIds[0]) => ({ id, name, memberIds, synthesizerId });
const schedule = (id: string, name: string, enabled: boolean, task: { workerId: string; teamId?: string; assignees?: 'all' | string[] }) => ({ id, name, enabled, task });

describe('what stops an orglet or crew from going (COD-286)', () => {
  it('finds every crew an orglet is in, as a member or as the lead', () => {
    const crews = [crew('launch', 'Launch crew', ['scout', 'writer']), crew('quick', 'Quick crew', ['editor'], 'scout'), crew('other', 'Other', ['editor'])];
    expect(crewsWithMember(crews, 'scout').map(item => item.name)).toEqual(['Launch crew', 'Quick crew']);
    expect(crewsWithMember(crews, 'nobody')).toEqual([]);
  });

  it('names the crews first, then an enabled schedule, and nothing once both are cleared', () => {
    const crews = [crew('launch', 'Launch crew', ['scout'])];
    const routines = [schedule('off', 'Paused', false, { workerId: 'scout' }), schedule('daily', 'Daily digest', true, { workerId: 'scout' })];
    expect(removalBlocker({ teams: crews, routines }, 'worker', 'scout')).toMatchObject({ kind: 'crews', crews: [{ id: 'launch' }] });
    expect(removalBlocker({ teams: [], routines }, 'worker', 'scout')).toMatchObject({ kind: 'schedule', schedule: { id: 'daily' } });
    expect(removalBlocker({ teams: [], routines: [routines[0]] }, 'worker', 'scout')).toBeUndefined();
    // A crew is never blocked by its members' crews, only by its own schedules.
    expect(removalBlocker({ teams: crews, routines: [schedule('crew', 'Crew run', true, { workerId: 'scout', teamId: 'launch' })] }, 'team', 'launch')).toMatchObject({ kind: 'schedule' });
  });

  it('names one crew, a pair of crews, or counts and lists three or more, in both languages', () => {
    const one = leaveCrewsMessage('Scout', ['Launch crew']);
    const two = leaveCrewsMessage('Scout', ['Launch crew', 'Quick crew']);
    const three = leaveCrewsMessage('Scout', ['Launch crew', 'Quick crew', 'Review']);
    expect(one).toBe('Bỏ Scout khỏi hội Launch crew trước.');
    expect(two).toBe('Bỏ Scout khỏi hội Launch crew và Quick crew trước.');
    expect(three).toBe('Bỏ Scout khỏi 3 hội trước: Launch crew, Quick crew, Review.');
    expect(translateMessage(en, one)).toBe('Remove Scout from the crew Launch crew first.');
    expect(translateMessage(en, two)).toBe('Remove Scout from the crews Launch crew and Quick crew first.');
    expect(translateMessage(en, three)).toBe('Remove Scout from 3 crews first: Launch crew, Quick crew, Review.');
  });
});

describe('the core refusal', () => {
  let directory: string; let store: Store; let core: CoreService;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'orglet-removal-'));
    store = new Store(join(directory, 'test.sqlite'));
    core = new CoreService(store, () => {}, async () => ({ async request() { throw new Error('No model in this test'); } }));
  });
  afterEach(async () => { await core.runner.shutdown(); store.close(); await rm(directory, { recursive: true, force: true }); });

  it('names every crew an orglet is in when archiving or deleting it, and lets it go once they are all left', async () => {
    const [researcher] = store.all<Worker>('workers');
    const scout = await core.command('saveWorker', { name: 'Scout', instructions: 'Help.', provider: 'demo', skillId: researcher.skillId, taskBudgetMicros: 100_000 }) as Worker;
    const crewOf = (name: string) => ({ name, instructions: 'Work together.', memberIds: [scout.id, researcher.id], synthesizerId: researcher.id, workflow: 'sequential', monthlyBudgetMicros: 1_000_000 });
    const launch = await core.command('saveTeam', crewOf('Launch crew')) as { id: string };
    const quick = await core.command('saveTeam', crewOf('Quick crew')) as { id: string };
    await expect(core.command('archiveEntity', { kind: 'worker', id: scout.id, archived: true })).rejects.toThrow('Bỏ Scout khỏi hội Launch crew và Quick crew trước.');
    await expect(core.command('deleteEntity', { kind: 'worker', id: scout.id })).rejects.toThrow('Bỏ Scout khỏi hội Launch crew và Quick crew trước.');
    await core.command('deleteEntity', { kind: 'team', id: launch.id });
    await expect(core.command('archiveEntity', { kind: 'worker', id: scout.id, archived: true })).rejects.toThrow('Bỏ Scout khỏi hội Quick crew trước.');
    await core.command('deleteEntity', { kind: 'team', id: quick.id });
    await core.command('archiveEntity', { kind: 'worker', id: scout.id, archived: true });
  });
});
