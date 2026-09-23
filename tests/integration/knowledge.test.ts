import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store, SCHEMA_VERSION } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { compileContext, KNOWLEDGE_ITEM_LIMIT } from '../../apps/desktop/src/core/context/compiler';
import type { Knowledge } from '../../apps/desktop/src/shared/knowledge';
import type { Team, Worker, Skill, Task } from '../../apps/desktop/src/shared/contracts';
import { isPlanRequest, planReply } from './team-plan';

let directory: string; let store: Store; let core: CoreService;
let systems: string[]; let knowledgeMessages: (string | null)[]; let proposals: unknown[];
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orglet-knowledge-')); store = new Store(join(directory, 'state.sqlite'));
  systems = []; knowledgeMessages = []; proposals = [];
  core = new CoreService(store, () => {}, async () => ({ async request(messages, tools) {
    if (isPlanRequest(tools)) return planReply(messages);
    systems.push(String(messages[0].content));
    knowledgeMessages.push(messages.map(message => String(message.content ?? '')).find(content => content.includes('approvedKnowledge')) ?? null);
    return { calls: [{ id: 'report', name: 'submit_report', arguments: JSON.stringify({ title: 'Report', summary: 'No sources.', findings: [], limitations: [], review: { checks: [], recommendation: 'insufficient_evidence', draftFeedback: 'None.', upstreamFindingIds: [], conflicts: [] }, knowledgeProposals: proposals }) }], usage: { input: 10, output: 10 } };
  } }));
});
afterEach(async () => { await core.runner.shutdown(); store.close(); await rm(directory, { recursive: true, force: true }); });

async function idle() {
  for (let i = 0; i < 300 && store.all<Task>('tasks').some(task => core.runner.isActive(task.id) || core.teams.isActive(task.id)); i++) await new Promise(resolve => setTimeout(resolve, 10));
}
async function standalone(brief = 'Check scoring metric alignment') {
  const worker = await core.command('saveWorker', { ...store.workspace().workers[0], provider: 'openai' }) as Worker;
  const taskId = await core.command('createTask', { workerId: worker.id, brief, sourceIds: [], consent: true, providerScopes: ['openai'], budgetMicros: 1_000_000 }) as string;
  await idle(); return { worker, taskId };
}

it('stores model proposals for review and only loads them into context after approval', async () => {
  proposals = [{ title: 'Metric direction', content: 'Confirm scoring metric direction before comparing ranks.', tags: ['Scoring', 'scoring'] }];
  const { worker, taskId } = await standalone();
  const [proposed] = store.workspace().knowledge;
  expect(proposed).toMatchObject({ status: 'proposed', revision: 1, tags: ['scoring'], scope: { type: 'worker', id: worker.id }, provenance: { kind: 'run', taskId, workerId: worker.id } });
  expect(store.detail(taskId).artifacts[0].report).not.toHaveProperty('knowledgeProposals');

  proposals = [];
  await core.command('createTask', { workerId: worker.id, brief: 'Check scoring metric again', sourceIds: [], consent: true, providerScopes: ['openai'], budgetMicros: 1_000_000 }); await idle();
  expect(knowledgeMessages.at(-1)).toBeNull();

  await expect(core.command('reviewKnowledge', { id: proposed.id, revision: 99, decision: 'approve' })).rejects.toThrow('revision mới');
  await core.command('reviewKnowledge', { id: proposed.id, revision: 1, decision: 'approve' });
  const approved = store.get<Knowledge>('knowledge', proposed.id);
  expect(approved).toMatchObject({ status: 'approved', revision: 2, hash: proposed.hash });
  const followUp = await core.command('createTask', { workerId: worker.id, brief: 'Scoring metric follow-up', sourceIds: [], consent: true, providerScopes: ['openai'], budgetMicros: 1_000_000 }) as string; await idle();
  expect(knowledgeMessages.at(-1)).toContain('Confirm scoring metric direction');
  const run = store.detail(followUp).runs[0];
  expect(run.snapshot.context?.manifest.loaded).toContainEqual(expect.objectContaining({ kind: 'knowledge', id: proposed.id, revision: 2, hash: proposed.hash }));

  // A later edit creates a new revision; the finished run keeps the content it actually used.
  await core.command('saveKnowledge', { id: proposed.id, title: 'Metric direction', content: 'Edited guidance about scoring metric.', tags: ['scoring'], pinned: false, scope: approved.scope });
  expect(store.get<Knowledge>('knowledge', proposed.id).revision).toBe(3);
  expect(store.detail(followUp).runs[0].snapshot.context?.knowledge[0].content).toBe('Confirm scoring metric direction before comparing ranks.');
  expect(store.db.prepare('SELECT COUNT(*) AS n FROM knowledge_revisions WHERE id=?').get(proposed.id)!.n).toBe(3);
});

it('keeps team knowledge inside its team even when the same worker serves another team', async () => {
  const teamA = await core.command('createTemplate', { templateId: 'research-review', provider: 'openai' }) as Team;
  const shared = store.get<Worker>('workers', teamA.memberIds[0]);
  const teamB = await core.command('saveTeam', { ...teamA, id: undefined, name: 'Other team', memberIds: [shared.id], synthesizerId: shared.id }) as Team;
  await core.command('saveKnowledge', { title: 'Team A secret', content: 'Alpha pinned team note.', tags: [], pinned: true, scope: { type: 'team', id: teamA.id } });
  await core.command('saveKnowledge', { title: 'Worker habit', content: 'Beta pinned worker note.', tags: [], pinned: true, scope: { type: 'worker', id: shared.id } });
  await core.command('saveKnowledge', { title: 'Workspace rule', content: 'Gamma pinned workspace note.', tags: [], pinned: true, scope: { type: 'workspace' } });
  await core.command('saveKnowledge', { title: 'Archived', content: 'Delta archived note.', tags: [], pinned: true, scope: { type: 'workspace' } }).then(item => core.command('reviewKnowledge', { id: (item as Knowledge).id, revision: 1, decision: 'archive' }));

  knowledgeMessages = [];
  await core.command('createTask', { workerId: teamB.synthesizerId, teamId: teamB.id, brief: 'Team B review', sourceIds: [], consent: true, budgetMicros: 1_000_000 }); await idle();
  expect(knowledgeMessages.join(' ')).not.toContain('Alpha'); expect(knowledgeMessages.join(' ')).toContain('Beta'); expect(knowledgeMessages.join(' ')).toContain('Gamma');
  expect(knowledgeMessages.join(' ')).not.toContain('Delta');

  knowledgeMessages = [];
  await core.command('createTask', { workerId: teamA.synthesizerId, teamId: teamA.id, brief: 'Team A review', sourceIds: [], consent: true, budgetMicros: 1_000_000 }); await idle();
  expect(knowledgeMessages.every(message => message?.includes('Alpha'))).toBe(true);
});

it('deduplicates repeated instructions and knowledge, and records omissions against the context limit', () => {
  const [worker] = store.workspace().workers; const skill = store.get<Skill>('skills', worker.skillId);
  const team = { id: crypto.randomUUID(), revision: 1, instructions: `  ${skill.content.toUpperCase()} ` } as Team;
  const item = (index: number, overrides: Partial<Knowledge> = {}) => ({ id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, revision: 1, title: `Note ${index}`, content: `Pinned note number ${index}`, tags: [], hash: 'a'.repeat(64), scope: { type: 'workspace' as const }, pinned: true, ...overrides });
  const candidates = [
    ...Array.from({ length: KNOWLEDGE_ITEM_LIMIT + 2 }, (_, index) => item(index)),
    item(90, { content: 'pinned   NOTE number 0' }),
    item(91, { pinned: false, content: 'Unrelated gardening tip' }),
    item(92, { pinned: false, content: 'Scoring leakage guidance' }),
  ];
  const { system, context } = compileContext({ worker, skill, team, brief: 'Review scoring leakage', candidates });
  expect(system.match(/Help with whatever the user asks/gi)).toHaveLength(1);
  expect(context.manifest.omitted).toContainEqual({ kind: 'skill', id: skill.id, revision: skill.revision, reason: 'duplicate' });
  expect(context.manifest.omitted).toContainEqual(expect.objectContaining({ id: item(90).id, reason: 'duplicate' }));
  expect(context.manifest.omitted).toContainEqual(expect.objectContaining({ id: item(91).id, reason: 'not_relevant' }));
  expect(context.manifest.omitted.filter(entry => entry.reason === 'context_limit')).toHaveLength(3);
  expect(context.knowledge).toHaveLength(KNOWLEDGE_ITEM_LIMIT);
  expect(context.knowledge.map(entry => entry.id)).not.toContain(item(92).id);
});

it('searches approved and proposed notes by keyword and tag, ignoring archived notes and FTS syntax', async () => {
  const a = await core.command('saveKnowledge', { title: 'Leakage checks', content: 'Compare train and test identifiers.', tags: ['dataset'], pinned: false, scope: { type: 'workspace' } }) as Knowledge;
  const b = await core.command('saveKnowledge', { title: 'Run logs', content: 'Rerun variance needs repeated runs.', tags: ['stability'], pinned: false, scope: { type: 'workspace' } }) as Knowledge;
  expect((await core.command('searchKnowledge', { query: 'identif' }) as Knowledge[]).map(item => item.id)).toEqual([a.id]);
  expect((await core.command('searchKnowledge', { query: 'stability' }) as Knowledge[]).map(item => item.id)).toEqual([b.id]);
  expect(await core.command('searchKnowledge', { query: 'NEAR( " OR *' })).toEqual(expect.any(Array));
  await core.command('reviewKnowledge', { id: b.id, revision: 1, decision: 'archive' });
  expect(await core.command('searchKnowledge', { query: 'stability' })).toEqual([]);
  await expect(core.command('saveKnowledge', { title: 'Bad scope', content: 'x', tags: [], pinned: false, scope: { type: 'team', id: crypto.randomUUID() } })).rejects.toThrow();
});

it('backs up knowledge with frozen run context, rejects dangling scope and carries only team notes in templates as proposals', async () => {
  proposals = [{ title: 'Proposal', content: 'Suggested reusable lesson about metric.', tags: [] }];
  const { worker } = await standalone();
  await core.command('saveKnowledge', { title: 'Workspace note', content: 'Workspace scoring metric note.', tags: [], pinned: true, scope: { type: 'workspace' } });
  const team = await core.command('createTemplate', { templateId: 'research-review', provider: 'demo' }) as Team;
  await core.command('saveKnowledge', { title: 'Team note', content: 'Team specific review note.', tags: ['team'], pinned: true, scope: { type: 'team', id: team.id } });
  const pending = await core.command('saveKnowledge', { title: 'Team archived', content: 'Archived team note.', tags: [], pinned: false, scope: { type: 'team', id: team.id } }) as Knowledge;
  await core.command('reviewKnowledge', { id: pending.id, revision: 1, decision: 'archive' });

  const text = core.backups.export();
  const other = new Store(':memory:');
  try {
    const receiver = new CoreService(other, () => {}, async () => { throw new Error('No provider'); });
    receiver.backups.restore(receiver.backups.preview(text).token);
    expect(other.workspace().knowledge).toEqual(store.workspace().knowledge);
    expect(await receiver.command('searchKnowledge', { query: 'workspace' })).toHaveLength(1);
    const runs = store.all<{ id: string; snapshot: { context?: unknown } }>('runs');
    for (const run of runs) expect(other.get<typeof run>('runs', run.id).snapshot.context).toEqual(run.snapshot.context);
  } finally { other.close(); }

  const envelope = JSON.parse(text);
  const item = envelope.payload.knowledge.find((entry: Knowledge) => entry.scope.type === 'worker');
  item.scope.id = crypto.randomUUID();
  envelope.payload.knowledgeRevisions.filter((row: { id: string }) => row.id === item.id).forEach((row: { data: { scope: { id: string } } }) => { row.data.scope.id = item.scope.id; });
  envelope.checksum = (await import('node:crypto')).createHash('sha256').update(JSON.stringify(envelope.payload)).digest('hex');
  expect(() => core.backups.preview(JSON.stringify(envelope))).toThrow('hội/Tí');

  const template = JSON.parse(core.templates.export(team.id));
  expect(template.knowledge).toEqual([{ title: 'Team note', content: 'Team specific review note.', tags: ['team'], pinned: true }]);
  const imported = core.templates.import(JSON.stringify(template));
  const copies = store.workspace().knowledge.filter(entry => entry.scope.type === 'team' && (entry.scope as { id: string }).id === imported.id);
  expect(copies).toEqual([expect.objectContaining({ title: 'Team note', status: 'proposed', provenance: { kind: 'template' } })]);
  expect(worker.id).toBeTruthy();
});

it('migrates a v5 workspace to the current schema and keeps a pre-upgrade copy for rollback', async () => {
  const [worker] = store.workspace().workers;
  store.db.exec('DROP TABLE tool_calls; DROP TABLE knowledge; DROP TABLE knowledge_revisions; DROP TABLE knowledge_search; DELETE FROM migrations WHERE version>5;');
  store.close();
  store = new Store(join(directory, 'state.sqlite'));
  expect(store.db.prepare('SELECT MAX(version) AS version FROM migrations').get()!.version).toBe(SCHEMA_VERSION);
  expect(store.workspace()).toMatchObject({ knowledge: [], workers: [expect.objectContaining({ id: worker.id })] });
  const copies = (await readdir(directory)).filter(name => /^state\.sqlite\.v5-\d+\.bak$/.test(name));
  expect(copies).toHaveLength(1);
  const copy = new DatabaseSync(join(directory, copies[0]));
  try {
    expect(copy.prepare('SELECT MAX(version) AS version FROM migrations').get()!.version).toBe(5);
    expect(copy.prepare("SELECT name FROM sqlite_master WHERE name='knowledge'").get()).toBeUndefined();
    expect(copy.prepare('SELECT COUNT(*) AS n FROM workers').get()!.n).toBe(1);
  } finally { copy.close(); }
});
