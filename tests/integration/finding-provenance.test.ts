import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { analyze } from '../../apps/desktop/src/profiler/analyze';
import type { Task, Run, Skill, Worker, Source } from '../../apps/desktop/src/shared/contracts';
import type { ProfileRecord } from '../../apps/desktop/src/shared/profiles';

let store: Store; let core: CoreService; let task: Task; let run: Run; let sources: Source[];
let mode = 'valid'; let profileId = ''; let step = 0; let sentBrief = ''; let sentSources: string[] = [];
const forged = { findingId: id(), writerId: id(), runId: id() };
beforeEach(async () => {
  store = new Store(':memory:'); mode = 'valid'; profileId = ''; step = 0;
  core = new CoreService(store, () => {}, async () => ({ async request(messages, tools) {
    const schema = JSON.parse(JSON.stringify(tools.find(tool => tool.type === 'function' && tool.function.name === 'submit_report'))).function.parameters;
    expect(schema.required).toContain('review');
    expect(schema.properties.findings.items.properties.provenance).toBeUndefined();
    expect(schema.properties.findings.items.required).toEqual(expect.arrayContaining(['category', 'recommendation', 'checkerIds']));
    expect(schema.properties.findings.items.properties.category.default).toBeUndefined();
    const input = JSON.parse(String(messages[1].content)); sentBrief = input.brief; sentSources = input.sources.map((source: Source) => source.id);
    step++;
    let name: string; let args: unknown;
    if (step === 1) { name = 'read_source'; args = { sourceId: sources[0].id }; }
    else if (step === 2) { name = 'profile_dataset'; args = { sourceIds: [sources[mode === 'unrelated' ? 1 : 0].id], idColumn: null }; }
    else {
      const reply = JSON.parse(String(messages.at(-1)?.content)); profileId = reply.profileId;
      let reference = profileId;
      if (mode === 'unknown') reference = id();
      if (mode === 'foreign') {
        const foreignRun = { ...run, id: id(), status: 'completed' as const }; store.put('runs', foreignRun, { column: 'task_id', value: task.id });
        reference = id(); store.put('profiles', { ...store.get<ProfileRecord>('profiles', profileId), id: reference, runId: foreignRun.id }, { column: 'task_id', value: task.id });
      }
      name = 'submit_report'; args = { title: 'Evidence report', summary: 'Fixture observation.', findings: [{ title: 'One selected row', detail: 'The supplied CSV has one data row.', severity: 'info', sourceIds: [sources[0].id], coverage: 'Full selected CSV row count', ...(mode === 'legacy' ? {} : { category: 'data', recommendation: 'Check the metric separately.', checkerIds: [reference], locations: [{ sourceId: sources[mode === 'foreign-line' ? 1 : 0].id, startLine: 2, endLine: mode === 'past-end' ? 9 : 2 }] }), provenance: forged }], limitations: ['No scoring code executed.'], ...(mode === 'legacy' ? {} : { review: { checks: [{ name: 'CSV rows', status: 'pass', coverage: 'Full selected CSV', sourceIds: [sources[0].id], checkerIds: [reference] }], recommendation: 'insufficient_evidence', draftFeedback: 'Scoring still needs review.', upstreamFindingIds: [], conflicts: [] } }) };
    }
    if (mode === 'missing' && name === 'submit_report') (args as { review: { checks: unknown[] } }).review.checks.push({ name: 'Scoring correctness', status: 'not_assessed', coverage: 'Scoring implementation was not supplied.', sourceIds: [], checkerIds: [] });
    return { calls: [{ id: id(), name, arguments: JSON.stringify(args) }], usage: { input: 100, output: 100 } };
  } }), input => analyze(input));
  const directory = await mkdtemp(join(tmpdir(), 'orglet-findings-'));
  const paths = [join(directory, 'evidence.csv'), join(directory, 'other.csv')];
  await Promise.all(paths.map(path => writeFile(path, 'id,value\n1,2\n'))); sources = await core.sources.import(paths);
  const worker = { ...store.all<Worker>('workers')[0], provider: 'openai' as const }; const skill = store.get<Skill>('skills', worker.skillId);
  task = { id: id(), workerId: worker.id, brief: 'Inspect source evidence', status: 'queued', sourceIds: sources.map(source => source.id), consent: true, accepted: false, createdAt: now(), budgetMicros: 100000 };
  run = { id: id(), taskId: task.id, snapshot: { worker, skill }, status: 'queued', startedAt: now(), error: null };
  store.put('tasks', task); store.put('runs', run, { column: 'task_id', value: task.id });
});
afterEach(() => store.close());

it('keeps a standalone task waiting for missing evidence after its run completes', async () => {
  mode = 'missing'; await core.runner.run(task, run);
  const detail = store.detail(task.id);
  expect(detail.task.status).toBe('waiting_input'); expect(detail.runs[0].status).toBe('completed');
  expect(detail.task.evidenceRequests?.[0].checks).toEqual(['Scoring correctness']);
  await core.command('acknowledgeEvidence', { taskId: task.id, requestId: detail.task.evidenceRequests![0].id });
  expect(store.detail(task.id).task.status).toBe('waiting_input');
  await core.command('accept', { id: task.id });
  expect(store.detail(task.id).task).toMatchObject({ status: 'completed', accepted: true });
  expect(store.detail(task.id).artifacts).toEqual(detail.artifacts);
});

it('assigns real writer/run identity, exposes a usable checker ID and preserves them in export/backup', async () => {
  await core.runner.run(task, run);
  const detail = store.detail(task.id); expect(detail.task.status).toBe('completed');
  const artifact = detail.artifacts[0]; const finding = artifact.report.findings[0];
  expect(finding.provenance).toMatchObject({ writerId: run.snapshot.worker.id, runId: run.id });
  expect(finding.provenance?.findingId).not.toBe(forged.findingId); expect(finding.checkerIds).toEqual([profileId]);
  expect(finding.locations).toEqual([{ sourceId: sources[0].id, startLine: 2, endLine: 2 }]);
  expect(core.exportMarkdown(artifact.id)).toContain(`Lines: ${sources[0].id}:2-2`);
  expect(core.feedbackText(artifact.id)).toBe('Scoring still needs review.');
  expect(() => core.feedbackText(id())).toThrow();
  const markdown = core.exportMarkdown(artifact.id);
  expect(markdown).toContain('Scoring still needs review.'); expect(markdown).toContain('CSV rows: pass');
  expect(markdown).toContain(`Finding: ${finding.provenance!.findingId}`); expect(markdown).toContain(`#checker-${profileId}`); expect(markdown).toContain('Recommendation: Check the metric separately.');
  const restored = new Store(':memory:');
  try { const receiver = new CoreService(restored, () => {}, async () => { throw new Error(); }); const preview = receiver.backups.preview(core.backups.export()); receiver.backups.restore(preview.token); expect(restored.detail(task.id).artifacts[0].report).toEqual(artifact.report); }
  finally { restored.close(); }
});

it.each(['unknown', 'foreign', 'unrelated', 'past-end', 'foreign-line'])('rejects %s checker or line references without committing a report', async value => {
  mode = value; await core.runner.run(task, run);
  expect(store.detail(task.id).task.status).toBe('failed'); expect(store.detail(task.id).artifacts).toEqual([]);
});

it('accepts older reply fields without inventing checker evidence or a recommendation', async () => {
  mode = 'legacy'; await core.runner.run(task, run);
  expect(() => core.feedbackText(store.detail(task.id).artifacts[0].id)).toThrow('chưa có feedback');
  expect(store.detail(task.id).artifacts[0].report.findings[0]).toMatchObject({ category: 'other', recommendation: null, checkerIds: [], locations: [] });
});

it('rejects forged backup authorship and duplicate finding IDs even with recomputed checksums', async () => {
  await core.runner.run(task, run); const original = core.backups.export();
  for (const mutation of ['writer', 'duplicate']) {
    const envelope = JSON.parse(original); const artifact = envelope.payload.artifacts[0];
    if (mutation === 'writer') artifact.report.findings[0].provenance.writerId = id();
    else artifact.report.findings.push(structuredClone(artifact.report.findings[0]));
    artifact.hash = createHash('sha256').update(JSON.stringify(artifact.report)).digest('hex');
    envelope.checksum = createHash('sha256').update(JSON.stringify(envelope.payload)).digest('hex');
    expect(() => core.backups.preview(JSON.stringify(envelope))).toThrow('finding');
  }
});

it('uses the frozen run input for dispatch, export and backup validation', async () => {
  run.snapshot.input = { brief: 'Frozen review instruction', sourceIds: [sources[0].id] };
  store.update('runs', run);
  await core.runner.run(task, run);
  const detail = store.detail(task.id); expect(detail.task.status).toBe('completed');
  expect(sentBrief).toBe('Frozen review instruction'); expect(sentSources).toEqual([sources[0].id]);
  const artifact = detail.artifacts[0];
  expect(core.exportMarkdown(artifact.id)).not.toContain(sources[1].id);
  const envelope = JSON.parse(core.backups.export());
  const changed = envelope.payload.artifacts[0]; changed.report.findings[0].sourceIds.push(sources[1].id);
  changed.hash = createHash('sha256').update(JSON.stringify(changed.report)).digest('hex');
  envelope.checksum = createHash('sha256').update(JSON.stringify(envelope.payload)).digest('hex');
  expect(() => core.backups.preview(JSON.stringify(envelope))).toThrow('ngoài task');
});
it('rejects a run snapshot that claims a source outside its task', async () => {
  run.snapshot.input = { brief: 'Invalid scope', sourceIds: [id()] };
  await core.runner.run(task, run);
  expect(step).toBe(0); expect(store.detail(task.id).task.status).toBe('failed');
});
