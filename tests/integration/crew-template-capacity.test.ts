import { afterEach, beforeEach, expect, it } from 'vitest';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { assertSkillReady } from '../../apps/desktop/src/core/skill-package';
import type { Team, Worker, Skill } from '../../apps/desktop/src/shared/contracts';
import { validateMarketSubmission } from '../../apps/desktop/src/shared/market-publishing';
import { TeamTemplate } from '../../apps/desktop/src/shared/templates';
import { Marketplace } from '../../apps/desktop/src/core/market/service';
import { Backups } from '../../apps/desktop/src/core/storage/backup';
import { createHash } from 'node:crypto';
import { MarketOrigin, type MarketListingV2 } from '../../apps/desktop/src/shared/market';

let store: Store;
let core: CoreService;
beforeEach(() => {
  store = new Store(':memory:');
  core = new CoreService(store, () => {}, async () => {
    throw Error('Template operations must not call a provider');
  });
});

function submission(template: unknown) {
  return JSON.stringify({
    kind: 'crew', name: 'Capacity crew', summary: 'Review evidence as a crew.', tags: ['review'],
    language: 'en', license: 'CC-BY-4.0', changelog: 'Initial version', template,
  });
}

function sha256(text: string) {
  return createHash('sha256').update(text).digest('hex');
}

// Synthetic transport fixture only: this does not change or publish a curated v1 listing.
async function capacityMarket(template: ReturnType<typeof TeamTemplate.parse>) {
  let body = JSON.stringify(template);
  let listing: MarketListingV2 = {
    listingId: 'capacity-crew', version: 1, kind: 'crew', name: 'Capacity crew',
    summary: 'Review evidence as a crew.', tags: ['review'], language: 'en',
    author: { displayName: 'Fixture publisher' }, license: 'CC-BY-4.0', changelog: 'Initial version', sha256: sha256(body), reviewDigest: 'a'.repeat(64),
  };
  const market = new Marketplace(store, () => {}, {
    fetch: async input => {
      const path = new URL(String(input)).pathname;
      return new Response(path === '/v2/catalog' ? JSON.stringify({ listings: [listing], nextCursor: null })
        : path === '/v2/listings/capacity-crew' ? JSON.stringify(listing) : body);
    },
    connected: async () => true,
  });
  await market.catalog(true);
  return {
    market,
    publish: async (nextTemplate: ReturnType<typeof TeamTemplate.parse>) => {
      body = JSON.stringify(nextTemplate);
      listing = { ...listing, version: listing.version + 1, sha256: sha256(body) };
      await market.catalog(true);
    },
  };
}

it('adds and updates nine distinct packaged skills with local choices, revisions and backup origins intact', async () => {
  const original = await savedCrew(true, true);
  const template = TeamTemplate.parse(JSON.parse(core.templates.export(original.team.id)));
  const server = await capacityMarket(template);
  const added = await server.market.add('capacity-crew', 1);
  expect(added.workerIds).toHaveLength(9);
  const team = store.get<Team>('teams', added.entityId);
  expect(team.memberIds).toHaveLength(8);
  expect(team.memberIds).not.toContain(team.synthesizerId);
  const firstWorker = store.get<Worker>('workers', added.workerIds[0]);
  const firstSkill = store.get<Skill>('skills', firstWorker.skillId);
  expect(() => assertSkillReady(firstSkill, store)).toThrow('review');
  await core.command('reviewSkill', { id: firstSkill.id, hash: firstSkill.package!.hash });
  const localServer = await core.saveMcpServer({
    id: crypto.randomUUID(), name: 'Local capacity fixture', enabled: false,
    transport: { kind: 'http', url: 'https://example.invalid/mcp', headerNames: [], bearer: false },
  });
  const customized = await core.command('saveWorker', {
    ...firstWorker, provider: 'ollama', modelId: 'local-capacity', effort: 'high',
    autoApplyProposals: true, mcpServerIds: [localServer.id],
  }) as Worker;
  const next = structuredClone(template);
  next.team.instructions = 'Updated evidence policy.';
  next.workers[0].instructions = 'Updated reviewer instructions.';
  next.workers[0].provider = 'openai';
  next.workers[0].modelId = 'gpt-5.4';
  next.workers[0].effort = 'max';
  await server.publish(next);
  const preview = await server.market.previewUpdate(added.entityId);
  expect(preview.customized).toBe(true);
  await server.market.applyUpdate(added.entityId, preview.token);
  expect(store.get<Worker>('workers', firstWorker.id)).toMatchObject({
    revision: customized.revision + 1, instructions: next.workers[0].instructions,
    provider: 'ollama', modelId: 'local-capacity', effort: 'high', autoApplyProposals: true, mcpServerIds: [localServer.id],
  });
  const historical = store.db.prepare('SELECT data FROM revisions WHERE entity_id=? AND revision=1').get(firstWorker.id)!;
  expect(JSON.parse(String(historical.data))).toEqual(firstWorker);
  expect(store.get<Team>('teams', team.id)).toMatchObject({ revision: 2, memberIds: team.memberIds, synthesizerId: team.synthesizerId });
  expect(store.get<Skill>('skills', firstSkill.id)).toEqual(firstSkill);
  const origins = store.setting<MarketOrigin[]>('marketOrigins', []);
  expect(Object.keys(origins[0].workerIds)).toHaveLength(9);
  expect(Object.keys(origins[0].skillIds)).toHaveLength(9);
  expect(origins[0].version).toBe(2);
  const backups = new Backups(store, () => false, () => {});
  const text = backups.export();
  const restored = new Store(':memory:');
  try {
    const target = new Backups(restored, () => false, () => {});
    target.restore(target.preview(text).token);
    expect(restored.setting('marketOrigins', [])).toEqual(origins);
    expect(restored.get<Team>('teams', team.id)).toEqual(store.get<Team>('teams', team.id));
    expect(restored.get<Worker>('workers', firstWorker.id)).toEqual(store.get<Worker>('workers', firstWorker.id));
    expect(new Marketplace(restored, () => {}).installations()[0]).toMatchObject({ entityId: team.id, version: 2 });
  } finally {
    restored.close();
  }
  expect(store.all('tasks')).toEqual([]);
  expect(store.all('workspace_grants')).toEqual([]);
});

type CrewTemplate = ReturnType<typeof TeamTemplate.parse>;
const invalidTemplates: { name: string; change: (template: CrewTemplate) => void }[] = [
  { name: 'nine roster members', change: template => { template.team.memberKeys = template.workers.map(worker => worker.key); } },
  { name: 'ten workers', change: template => { template.workers.push({ ...template.workers[0], key: 'extra-worker' }); } },
  { name: 'ten skills', change: template => { template.skills.push({ ...template.skills[0], key: 'extra-skill' }); } },
  { name: 'duplicate worker key', change: template => { template.workers[1].key = template.workers[0].key; } },
  { name: 'duplicate skill key', change: template => { template.skills[1].key = template.skills[0].key; } },
  { name: 'duplicate roster member', change: template => { template.team.memberKeys[1] = template.team.memberKeys[0]; } },
  { name: 'missing worker', change: template => { template.team.synthesizerKey = 'missing'; } },
  { name: 'missing skill', change: template => { template.workers[0].skillKey = 'missing'; } },
  { name: 'unused worker', change: template => { template.team.memberKeys.pop(); } },
  { name: 'unused skill', change: template => { template.workers[0].skillKey = template.workers[1].skillKey; } },
];

it.each(invalidTemplates)('refuses $name locally and publicly without partial import or marketplace writes', async ({ change }) => {
  const original = await savedCrew(true, true);
  const template = TeamTemplate.parse(JSON.parse(core.templates.export(original.team.id)));
  change(template);
  const before = store.workspace();
  expect(() => core.templates.import(JSON.stringify(template))).toThrow();
  expect(store.workspace()).toEqual(before);
  expect((await validateMarketSubmission(submission(template))).ok).toBe(false);
  const server = await capacityMarket(template);
  await expect(server.market.add('capacity-crew', 1)).rejects.toThrow();
  expect(store.workspace()).toEqual(before);
  expect(store.setting('marketOrigins', [])).toEqual([]);
});

it('refuses ten-entry origin maps and invalid backups before restoring any rows', async () => {
  const original = await savedCrew(true, true);
  const template = TeamTemplate.parse(JSON.parse(core.templates.export(original.team.id)));
  const server = await capacityMarket(template);
  await server.market.add('capacity-crew', 1);
  const backups = new Backups(store, () => false, () => {});
  const envelope = JSON.parse(backups.export());
  const target = new Store(':memory:');
  try {
    const targetBackups = new Backups(target, () => false, () => {});
    for (const field of ['workerIds', 'skillIds'] as const) {
      const invalid = structuredClone(envelope);
      invalid.payload.marketOrigins[0][field].extra = crypto.randomUUID();
      invalid.checksum = sha256(JSON.stringify(invalid.payload));
      expect(MarketOrigin.safeParse(invalid.payload.marketOrigins[0]).success).toBe(false);
      const before = target.workspace();
      expect(() => targetBackups.preview(JSON.stringify(invalid))).toThrow();
      expect(target.workspace()).toEqual(before);
      expect(target.setting('marketOrigins', [])).toEqual([]);
    }
  } finally {
    target.close();
  }
});
afterEach(() => store.close());

async function savedCrew(leadOutside: boolean, distinctSkills: boolean) {
  const workers: Worker[] = [];
  let sharedSkill: Skill | undefined;
  for (let index = 0; index < (leadOutside ? 9 : 8); index++) {
    let skill = sharedSkill;
    if (!skill || distinctSkills) {
      const name = `capacity-skill-${index}`;
      skill = core.importSkill({
        directoryName: name,
        files: [{ path: 'SKILL.md', base64: Buffer.from(`---\nname: ${name}\ndescription: Use for capacity review.\n---\nReview evidence carefully.`).toString('base64') }],
      });
      await core.command('reviewSkill', { id: skill.id, hash: skill.package!.hash });
      sharedSkill = skill;
    }
    workers.push(await core.command('saveWorker', {
      name: `Capacity orglet ${index}`, instructions: 'Review evidence.', skillId: skill.id,
      provider: 'openai', modelId: 'gpt-5.4', effort: 'low', autoApplyProposals: true,
    }) as Worker);
  }
  const team = await core.command('saveTeam', {
    name: 'Capacity crew', instructions: 'Review as a crew.', memberIds: workers.slice(0, 8).map(worker => worker.id),
    synthesizerId: workers.at(-1)!.id, workflow: 'sequential', monthlyBudgetMicros: 5_000_000,
  }) as Team;
  return { team, workers };
}

it.each([
  { leadOutside: false, distinctSkills: false }, { leadOutside: false, distinctSkills: true },
  { leadOutside: true, distinctSkills: false }, { leadOutside: true, distinctSkills: true },
])('roundtrips eight saved members with leadOutside=$leadOutside distinctSkills=$distinctSkills', async ({ leadOutside, distinctSkills }) => {
  const original = await savedCrew(leadOutside, distinctSkills);
  const before = store.workspace();
  const text = core.templates.export(original.team.id);
  const template = JSON.parse(text);
  expect(template.workers).toHaveLength(leadOutside ? 9 : 8);
  expect(template.skills).toHaveLength(distinctSkills ? original.workers.length : 1);
  for (const worker of template.workers) {
    expect(worker).not.toHaveProperty('autoApplyProposals');
    expect(worker).not.toHaveProperty('mcpServerIds');
    expect(worker).not.toHaveProperty('id');
  }
  expect(text).not.toContain('reviewedSkills');
  const publicResult = await validateMarketSubmission(JSON.stringify({
    kind: 'crew', name: 'Capacity crew', summary: 'Review evidence as a crew.', tags: ['review'],
    language: 'en', license: 'CC-BY-4.0', changelog: 'Initial version', template,
  }));
  expect(publicResult.ok).toBe(true);
  const imported = core.templates.import(text);
  expect(imported.memberIds).toHaveLength(8);
  expect(imported.memberIds.includes(imported.synthesizerId)).toBe(!leadOutside);
  expect(imported.id).not.toBe(original.team.id);
  expect(core.templates.export(imported.id)).toBe(text);
  const importedWorkers = [...new Set([...imported.memberIds, imported.synthesizerId])].map(workerId => store.get<Worker>('workers', workerId));
  expect(new Set(importedWorkers.map(worker => worker.skillId)).size).toBe(template.skills.length);
  for (const worker of importedWorkers) {
    expect(original.workers.some(originalWorker => originalWorker.id === worker.id)).toBe(false);
    expect(worker.revision).toBe(1);
    expect(worker.autoApplyProposals).toBeUndefined();
    expect(worker.mcpServerIds).toBeUndefined();
    expect(() => assertSkillReady(store.get<Skill>('skills', worker.skillId), store)).toThrow('review');
  }
  expect(store.workspace().tasks).toEqual(before.tasks);
  expect(store.workspace().usage).toEqual(before.usage);
  expect(store.all('workspace_grants')).toEqual([]);
});
