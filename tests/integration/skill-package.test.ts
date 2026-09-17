import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { inspectPackage, assertSkillReady, packageForExport, skillResource } from '../../apps/desktop/src/core/skill-package';
import { readSkillDirectory, writeSkillDirectory } from '../../apps/desktop/src/main/skill-files';
import type { Skill, Worker, Run, Task, Team } from '../../apps/desktop/src/shared/contracts';

let store: Store; let core: CoreService;
const file = (path: string, text: string | Buffer) => ({ path, base64: Buffer.from(text).toString('base64') });
const sample = (extra = '') => ({ directoryName: 'review-kit', files: [file('SKILL.md', `---\nname: review-kit\ndescription: |\n  Review selected evidence.\n${extra}---\nRead references/checks.md when needed.`), file('references/checks.md', 'Verify every claim against selected sources.'), file('assets/icon.bin', Buffer.from([0, 255, 1])), file('scripts/helper.py', 'raise Exception("MUST NOT EXECUTE")')] });
beforeEach(() => { store = new Store(':memory:'); core = new CoreService(store, () => {}, async () => { throw new Error('No real provider'); }); });
afterEach(() => store.close());

it('parses YAML, preserves every file and exports a verifiable separate Orglet manifest', () => {
  const input = sample(); const skill = core.importSkill(input);
  expect(skill.content).toContain('references/checks.md'); expect(skill.package?.files).toEqual(input.files);
  const output = core.exportSkill(skill.id);
  expect(output.files.filter(item => item.path !== 'orglet.json')).toEqual(input.files);
  expect(inspectPackage(output).blockers).toEqual([]);
  const reordered = { ...output, files: [...output.files].reverse() };
  expect(inspectPackage(reordered).hash).toBe(inspectPackage(output).hash);
  const plain = packageForExport(store.all<Skill>('skills')[0]); expect(inspectPackage(plain).metadata.name).toBe(plain.directoryName);
});

it('rejects malformed metadata, aliases, duplicate keys, unsupported tags and mismatched directory names', () => {
  for (const extra of ['name: duplicate\n', 'license: &a test\ncompatibility: *a\n', 'license: !!js/function x\n', 'unknown: true\n', 'metadata: {version: 1}\n']) expect(() => inspectPackage(sample(extra))).toThrow();
  expect(() => inspectPackage({ ...sample(), directoryName: 'other' })).toThrow('trùng');
  expect(() => inspectPackage({ ...sample(), files: [file('SKILL.md', 'No frontmatter')] })).toThrow('frontmatter');
});

it('rejects traversal, Windows device paths, collisions, invalid base64 and oversized packages', () => {
  for (const path of ['../escape', '/absolute', 'C:/key', 'references\\escape', 'assets/CON.txt', 'assets/file.', 'assets/x:stream', 'assets//x']) expect(() => inspectPackage({ ...sample(), files: [...sample().files, file(path, 'x')] })).toThrow();
  for (const addition of [file('skill.MD', 'x'), file('references', 'x'), file('huge', Buffer.alloc(262145))]) expect(() => inspectPackage({ ...sample(), files: [...sample().files, addition] })).toThrow();
  expect(() => inspectPackage({ ...sample(), files: [{ path: 'SKILL.md', base64: '!invalid' }] })).toThrow();
  expect(() => inspectPackage({ ...sample(), files: [...sample().files, ...Array.from({ length: 5 }, (_, i) => file(`assets/${i}`, Buffer.alloc(250000)))] })).toThrow('1 MB');
});

it('enforces explicit local review at assignment and runtime; metadata cannot grant tool access', async () => {
  const skill = core.importSkill(sample()); const worker = store.all<Worker>('workers')[0];
  await expect(core.command('saveWorker', { ...worker, skillId: skill.id })).rejects.toThrow('review');
  await expect(core.command('reviewSkill', { id: skill.id, hash: '0'.repeat(64) })).rejects.toThrow('thay đổi');
  await core.command('reviewSkill', { id: skill.id, hash: skill.package!.hash });
  expect(() => assertSkillReady(skill, store)).not.toThrow();
  await expect(core.command('saveWorker', { ...worker, skillId: skill.id })).resolves.toMatchObject({ skillId: skill.id });
  expect(skillResource(skill, 'references/checks.md', store).content).toContain('Verify');
  for (const path of ['../SKILL.md', 'scripts/helper.py', 'assets/icon.bin']) expect(() => skillResource(skill, path, store)).toThrow();
  await expect(core.command('saveSkill', { ...skill, content: 'Changed' })).rejects.toThrow('giữ nguyên');
  const blocked = core.importSkill(sample('allowed-tools: Bash network\n'));
  await expect(core.command('reviewSkill', { id: blocked.id, hash: blocked.package!.hash })).rejects.toThrow('Bash');
  expect(() => assertSkillReady({ ...skill, content: 'Changed' }, store)).toThrow('khớp');
});

it('does not transfer approval via backup or team template', async () => {
  const skill = core.importSkill(sample()); await core.command('reviewSkill', { id: skill.id, hash: skill.package!.hash });
  const worker = await core.command('saveWorker', { ...store.all<Worker>('workers')[0], skillId: skill.id }) as Worker;
  const team = await core.command('saveTeam', { name: 'Skill team', instructions: 'Review', memberIds: [worker.id], synthesizerId: worker.id, workflow: 'sequential', monthlyBudgetMicros: 10000 }) as Team;
  const imported = core.templates.import(core.templates.export(team.id));
  const importedWorker = store.get<Worker>('workers', imported.synthesizerId);
  expect(() => assertSkillReady(store.get<Skill>('skills', importedWorker.skillId), store)).toThrow('review');
  const target = new Store(':memory:');
  try {
    const receiver = new CoreService(target, () => {}, async () => { throw new Error(); });
    const preview = receiver.backups.preview(core.backups.export()); receiver.backups.restore(preview.token);
    expect(() => assertSkillReady(target.get<Skill>('skills', skill.id), target)).toThrow('review');
    expect(target.get<Skill>('skills', skill.id).package?.files).toEqual(skill.package?.files);
  } finally { target.close(); }
});

it('reads resource through the model loop without granting evidence citations or executing packaged code', async () => {
  const skill = core.importSkill(sample()); await core.command('reviewSkill', { id: skill.id, hash: skill.package!.hash });
  const worker = { ...store.all<Worker>('workers')[0], provider: 'openai' as const, skillId: skill.id };
  const task: Task = { id: id(), workerId: worker.id, brief: 'Review', status: 'queued', budgetMicros: 100000, sourceIds: [], consent: true, accepted: false, createdAt: now() };
  const run: Run = { id: id(), taskId: task.id, snapshot: { worker, skill }, status: 'queued', error: null, startedAt: now() };
  store.put('tasks', task); store.put('runs', run, { column: 'task_id', value: task.id });
  let step = 0;
  const receiver = new CoreService(store, () => {}, async () => ({ async request(messages) {
    step++;
    if (step === 2) expect(JSON.stringify(messages)).toContain('Verify every claim');
    return { usage: { input: 100, output: 100 }, calls: [{ id: id(), name: step === 1 ? 'read_skill_resource' : 'submit_report', arguments: JSON.stringify(step === 1 ? { path: 'references/checks.md' } : { title: 'Done', summary: 'No source evidence', findings: [], limitations: ['Only skill reference read'] }) }] };
  } }));
  await receiver.runner.run(task, run);
  expect(step).toBe(2); expect(store.detail(task.id).task.status).toBe('completed');
});

it('uses bounded real directory IO and refuses overwrite and hard links', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'orglet-skill-test-'));
  const destination = await writeSkillDirectory(parent, sample());
  expect(await readSkillDirectory(destination)).toEqual(expect.objectContaining({ directoryName: 'review-kit' }));
  expect(await readFile(join(destination, 'assets/icon.bin'))).toEqual(Buffer.from([0, 255, 1]));
  await expect(writeSkillDirectory(parent, sample())).rejects.toThrow();
  await mkdir(join(parent, 'linked'));
  await writeFile(join(parent, 'original'), 'x'); await link(join(parent, 'original'), join(parent, 'linked', 'file'));
  await expect(readSkillDirectory(join(parent, 'linked'))).rejects.toThrow('hard link');
});

it('rejects invalid manifest hashes and blocks unsupported schema, evaluator and permissions', () => {
  const skill = core.importSkill(sample()); const output = core.exportSkill(skill.id);
  const extension = output.files.find(item => item.path === 'orglet.json')!;
  const manifest = JSON.parse(Buffer.from(extension.base64, 'base64').toString('utf8'));
  const withManifest = (value: unknown) => ({ ...output, files: output.files.map(item => item.path === 'orglet.json' ? file(item.path, JSON.stringify(value)) : item) });
  expect(() => inspectPackage(withManifest({ ...manifest, version_hash: '0'.repeat(64) }))).toThrow('version_hash');
  for (const changes of [{ input_schema: { type: 'string' } }, { output_schema: { type: 'array' } }, { evaluator: 'shell' }, { required_permissions: ['network:*'] }]) expect(inspectPackage(withManifest({ ...manifest, ...changes })).blockers.length).toBeGreaterThan(0);
  const reordered = Object.fromEntries(Object.entries(manifest.input_schema).reverse());
  expect(inspectPackage(withManifest({ ...manifest, input_schema: reordered })).blockers).toEqual([]);
});

it('blocks direct execution of an unreviewed snapshot before creating provider requests or reports', async () => {
  const skill = core.importSkill(sample()); const worker = { ...store.all<Worker>('workers')[0], skillId: skill.id, provider: 'openai' as const };
  const task: Task = { id: id(), workerId: worker.id, brief: 'Review', status: 'queued', budgetMicros: 100000, sourceIds: [], consent: true, accepted: false, createdAt: now() };
  const run: Run = { id: id(), taskId: task.id, snapshot: { worker, skill }, status: 'queued', error: null, startedAt: now() };
  store.put('tasks', task); store.put('runs', run, { column: 'task_id', value: task.id });
  await core.runner.run(task, run);
  expect(store.detail(task.id).runs[0].error).toContain('review');
  expect(store.detail(task.id).artifacts).toEqual([]); expect(store.detail(task.id).usage.reservedMicros).toBe(0);
});

it('retains compatibility with the report schema exported before finding provenance was added', async () => {
  const skill = core.importSkill(sample()); const output = core.exportSkill(skill.id);
  const extension = output.files.find(item => item.path === 'orglet.json')!;
  const manifest = JSON.parse(Buffer.from(extension.base64, 'base64').toString('utf8'));
  manifest.output_schema = JSON.parse(await readFile('tests/fixtures/legacy-report-schema.json', 'utf8'));
  const legacy = { ...output, files: output.files.map(item => item.path === 'orglet.json' ? file(item.path, JSON.stringify(manifest)) : item) };
  expect(inspectPackage(legacy).blockers).toEqual([]);
});
