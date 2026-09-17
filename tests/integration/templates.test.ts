import { afterEach, beforeEach, expect, it } from 'vitest';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import type { Team, Worker, Skill } from '../../apps/desktop/src/shared/contracts';

let store: Store; let core: CoreService; let team: Team;
beforeEach(async () => {
  store = new Store(':memory:'); core = new CoreService(store, () => {}, async () => { throw new Error('Import must not call a provider'); });
  team = await core.command('createTemplate', { templateId: 'eris-review', provider: 'openai' }) as Team;
});
afterEach(() => store.close());
it('roundtrips saved configuration with fresh IDs and shared skill references without transferring workspace data', () => {
  const before = store.workspace(); const text = core.templates.export(team.id); const template = JSON.parse(text);
  expect(template.skills).toHaveLength(1); expect(template.workers).toHaveLength(4);
  for (const entity of [...before.workers, ...before.skills, ...before.teams]) expect(text).not.toContain(entity.id);
  expect(Object.keys(template).sort()).toEqual(['format', 'skills', 'team', 'version', 'workers']);
  const imported = core.templates.import(text); expect(imported.id).not.toBe(team.id); expect(imported.revision).toBe(1);
  expect(imported.preflight).toEqual(team.preflight); expect(imported.workflow).toBe(team.workflow);
  expect(core.templates.export(imported.id)).toBe(text);
  const workers = imported.memberIds.map(id => store.get<Worker>('workers', id));
  expect(workers.every(worker => worker.provider === 'openai' && worker.revision === 1)).toBe(true);
  expect(new Set(workers.map(worker => worker.skillId)).size).toBe(1);
  expect(store.get<Skill>('skills', workers[0].skillId).revision).toBe(1);
  expect(store.workspace().tasks).toHaveLength(0); expect(store.workspace().usage).toEqual(before.usage);
  expect(store.get<Team>('teams', team.id)).toEqual(team);
});
it('preserves one worker used as both member and synthesizer', async () => {
  team = await core.command('saveTeam', { ...team, memberIds: [team.synthesizerId], workflow: 'sequential' }) as Team;
  const text = core.templates.export(team.id); expect(JSON.parse(text).workers).toHaveLength(1);
  const imported = core.templates.import(text); expect(imported.memberIds).toEqual([imported.synthesizerId]);
  expect(imported.workflow).toBe('sequential');
});
it('rejects invalid references and unknown fields atomically', () => {
  const original = core.templates.export(team.id); const before = store.workspace();
  const mutations = [
    (value: any) => { value.workers[1].key = value.workers[0].key; },
    (value: any) => { value.team.memberKeys[1] = value.team.memberKeys[0]; },
    (value: any) => { value.workers[0].skillKey = 'missing'; },
    (value: any) => { value.team.synthesizerKey = 'missing'; },
    (value: any) => { value.skills.push({ ...value.skills[0], key: 'unused' }); },
    (value: any) => { value.skills.push({ ...value.skills[0] }); },
    (value: any) => { value.workers.push({ ...value.workers[0], key: 'unused' }); },
    (value: any) => { value.skills[0].script = 'execute.py'; },
    (value: any) => { value.consent = true; },
    (value: any) => { value.version = 2; },
  ];
  for (const mutate of mutations) { const value = JSON.parse(original); mutate(value); expect(() => core.templates.import(JSON.stringify(value))).toThrow(); expect(store.workspace()).toEqual(before); }
  expect(() => core.templates.import('invalid')).toThrow(/JSON/);
  expect(() => core.templates.import(' '.repeat(2 * 1024 * 1024 + 1))).toThrow(/2 MB/);
});
