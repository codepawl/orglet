import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import type { Knowledge } from '../../apps/desktop/src/shared/knowledge';
import type { Skill, Worker } from '../../apps/desktop/src/shared/contracts';
import { SyncRecordingContext } from '../../apps/desktop/src/shared/sync';

/*
 * Deleting a Library skill or knowledge note removes it for good on this computer. The deletion travels as the
 * `delete` record the released app already reads (kinds `skill` and `knowledge`), and a deleted item is fenced from
 * every later pull.
 */

const context = SyncRecordingContext.parse({ accountKey: 'b'.repeat(64), generation: 1 });
const unusedModel = async () => ({ async request(): Promise<never> { throw new Error('No model call expected'); } });

const stores: Store[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

function device(syncNow = 1000) {
  const store = new Store(':memory:', { syncNow: () => syncNow });
  stores.push(store);
  store.sync.setRecordingContext(context);
  return { store, core: new CoreService(store, () => {}, unusedModel) };
}

function deliver(from: Store, to: Store) {
  const records = from.sync.snapshot(context);
  for (let offset = records.length; offset > 0; offset -= 100) to.sync.receive(context, records.slice(Math.max(0, offset - 100), offset).reverse());
}

const note = (core: CoreService) => core.command('saveKnowledge', { title: 'Pricing rules', content: 'Quote in dollars.', tags: ['price'], pinned: false, scope: { type: 'workspace' } }) as Promise<Knowledge>;
const skill = (core: CoreService, name: string) => core.command('saveSkill', { name, content: `# ${name}\nDo the ${name} thing.` }) as Promise<Skill>;
const skillRows = (store: Store) => store.all<Skill>('skills').map(row => row.name);

describe('delete a knowledge note', () => {
  it('removes the note, its revisions and its search entry', async () => {
    const { store, core } = device();
    const saved = await note(core);
    await core.command('saveKnowledge', { id: saved.id, title: 'Pricing rules', content: 'Quote in euros.', tags: ['price'], pinned: false, scope: { type: 'workspace' } });
    expect(store.db.prepare('SELECT COUNT(*) AS count FROM knowledge_revisions WHERE id=?').get(saved.id)!.count).toBe(2);
    expect(await core.command('searchKnowledge', { query: 'euros' })).toHaveLength(1);

    await core.command('deleteKnowledge', { id: saved.id });

    expect(() => store.get('knowledge', saved.id)).toThrow();
    expect(store.db.prepare('SELECT COUNT(*) AS count FROM knowledge_revisions WHERE id=?').get(saved.id)!.count).toBe(0);
    expect(await core.command('searchKnowledge', { query: 'euros' })).toHaveLength(0);
    expect(store.workspace().knowledge.some(item => item.id === saved.id)).toBe(false);
    await expect(core.command('deleteKnowledge', { id: saved.id })).rejects.toThrow();
  });

  it('does not come back when another computer still sends it', async () => {
    const other = device(1000);
    const mine = device(2000);
    const saved = await note(other.core);
    deliver(other.store, mine.store);
    expect(mine.store.workspace().knowledge.some(item => item.id === saved.id)).toBe(true);

    await mine.core.command('deleteKnowledge', { id: saved.id });
    deliver(other.store, mine.store);
    await other.core.command('saveKnowledge', { id: saved.id, title: 'Pricing rules', content: 'Quote in yen.', tags: [], pinned: false, scope: { type: 'workspace' } });
    deliver(other.store, mine.store);

    expect(mine.store.workspace().knowledge.some(item => item.id === saved.id)).toBe(false);
    expect(JSON.stringify(mine.store.sync.outbox(context))).not.toContain('yen');
  });

  it('is removed on another computer that receives the deletion', async () => {
    const mine = device(1000);
    const other = device(2000);
    const saved = await note(mine.core);
    deliver(mine.store, other.store);
    expect(other.store.workspace().knowledge.some(item => item.id === saved.id)).toBe(true);

    await mine.core.command('deleteKnowledge', { id: saved.id });
    deliver(mine.store, other.store);

    expect(other.store.workspace().knowledge.some(item => item.id === saved.id)).toBe(false);
  });
});

describe('delete a skill', () => {
  it('removes an unused skill and keeps the others', async () => {
    const { store, core } = device();
    const extra = await skill(core, 'Extra');
    const before = skillRows(store).length;

    await core.command('deleteSkill', { id: extra.id });

    expect(skillRows(store)).toHaveLength(before - 1);
    expect(store.workspace().skills.some(item => item.id === extra.id)).toBe(false);
    expect(store.db.prepare("SELECT COUNT(*) AS count FROM sync_deletions WHERE kind='skill' AND entity_id=?").get(extra.id)!.count).toBe(1);
  });

  it('refuses while an orglet uses it, and names the orglet', async () => {
    const { store, core } = device();
    const extra = await skill(core, 'Extra');
    const worker = store.all<Worker>('workers')[0];
    await core.command('saveWorker', { ...worker, name: 'Quinn', skillId: extra.id });

    await expect(core.command('deleteSkill', { id: extra.id })).rejects.toThrow(/Quinn/);
    expect(skillRows(store)).toContain('Extra');
  });

  it('refuses while an archived orglet uses it', async () => {
    const { store, core } = device();
    const extra = await skill(core, 'Extra');
    const worker = store.all<Worker>('workers')[0];
    await core.command('saveWorker', { ...worker, name: 'Quinn', skillId: extra.id });
    store.setSetting('entityState', { workers: { [worker.id]: { archivedAt: '2026-10-01T00:00:00.000Z' } }, teams: {} });

    await expect(core.command('deleteSkill', { id: extra.id })).rejects.toThrow(/Quinn/);
  });

  it('keeps the last skill, so a new orglet always has one to pick', async () => {
    const { store, core } = device();
    const [only] = store.all<Skill>('skills');
    expect(store.all<Skill>('skills')).toHaveLength(1);

    await expect(core.command('deleteSkill', { id: only.id })).rejects.toThrow();
    expect(store.all<Skill>('skills')).toHaveLength(1);
  });

  it('can delete the starter skill once another one is left and no orglet uses it', async () => {
    const { store, core } = device();
    const [starter] = store.all<Skill>('skills');
    const replacement = await skill(core, 'Replacement');
    const worker = store.all<Worker>('workers')[0];
    await core.command('saveWorker', { ...worker, skillId: replacement.id });

    await core.command('deleteSkill', { id: starter.id });

    expect(skillRows(store)).toEqual(['Replacement']);
  });

  it('does not come back after a pull from a computer that still has it', async () => {
    const other = device(1000);
    const mine = device(2000);
    const extra = await skill(other.core, 'Extra');
    deliver(other.store, mine.store);
    expect(skillRows(mine.store)).toContain('Extra');

    await mine.core.command('deleteSkill', { id: extra.id });
    deliver(other.store, mine.store);
    await other.core.command('saveSkill', { id: extra.id, name: 'Extra', content: '# Extra\nEdited on the other computer.' });
    deliver(other.store, mine.store);

    expect(skillRows(mine.store)).not.toContain('Extra');
  });

  it('is removed on another computer that receives the deletion and does not use it', async () => {
    const mine = device(1000);
    const other = device(2000);
    const extra = await skill(mine.core, 'Extra');
    deliver(mine.store, other.store);
    expect(skillRows(other.store)).toContain('Extra');

    await mine.core.command('deleteSkill', { id: extra.id });
    deliver(mine.store, other.store);

    expect(skillRows(other.store)).not.toContain('Extra');
  });
});

describe('after a restart', () => {
  it('neither a deleted note nor a deleted skill returns, and no starter skill is seeded again', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'orglet-delete-library-'));
    directories.push(directory);
    const file = join(directory, 'test.sqlite');
    const first = new Store(file);
    const core = new CoreService(first, () => {}, unusedModel);
    const saved = await note(core);
    const extra = await skill(core, 'Extra');
    await core.command('deleteKnowledge', { id: saved.id });
    await core.command('deleteSkill', { id: extra.id });
    const skillCount = first.all<Skill>('skills').length;
    first.close();

    const second = new Store(file);
    stores.push(second);
    expect(second.workspace().knowledge.some(item => item.id === saved.id)).toBe(false);
    expect(second.all<Skill>('skills').some(item => item.id === extra.id)).toBe(false);
    expect(second.all<Skill>('skills')).toHaveLength(skillCount);
  });
});
