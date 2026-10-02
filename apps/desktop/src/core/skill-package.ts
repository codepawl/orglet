import { createHash } from 'node:crypto';
import type { PackageInput } from '../shared/skill-package';
import type { Skill } from '../shared/contracts';
import type { Store } from './storage/database';
import { skillSummary } from '../shared/skill-summary';
import { inspectPackageContent, packageIdentityText, packageBlockers, inputSchema, outputSchema } from '../shared/skill-package-content';
export { decodeText, inputSchema, outputSchema } from '../shared/skill-package-content';

export function inspectPackage(raw: unknown) {
  const inspected = inspectPackageContent(raw);
  const versionHash = createHash('sha256').update(packageIdentityText(inspected.input, false)).digest('hex');
  const hash = createHash('sha256').update(packageIdentityText(inspected.input, true)).digest('hex');
  const blockers = packageBlockers(inspected, versionHash);
  return { ...inspected, hash, versionHash, blockers };
}

export function assertSkillReady(skill: Skill, store: Store) {
  if (!skill.package) return;
  const result = inspectPackage(skill.package);
  if (result.metadata.name !== skill.name || result.content !== skill.content || result.hash !== skill.package.hash) throw new Error('Nội dung skill không khớp gói đã nhập.');
  if (result.blockers.length) throw new Error(result.blockers.join(' '));
  if (!store.setting<string[]>('reviewedSkills', []).includes(`${skill.id}:${result.hash}`)) throw new Error('Skill cần được review trong Thư viện trước khi sử dụng.');
}

export function packageForImport(raw: unknown): Pick<Skill, 'name' | 'content' | 'package'> {
  const result = inspectPackage(raw);
  return { name: result.metadata.name, content: result.content, package: { ...result.input, hash: result.hash } };
}

export function packageForExport(skill: Skill): PackageInput {
  const name = skill.name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64).replace(/-$/, '') || 'orglet-skill';
  const description = (skillSummary(skill.content) || `Use ${skill.name} when the task calls for this skill's instructions.`).slice(0, 1024);
  const initial = skill.package ? inspectPackage(skill.package).input : {
    directoryName: name,
    files: [{ path: 'SKILL.md', base64: Buffer.from(`---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${skill.content}\n`).toString('base64') }],
  };
  if (initial.files.some(file => file.path === 'orglet.json')) return initial;
  const inspected = inspectPackage(initial);
  const manifest = { input_schema: inputSchema, output_schema: outputSchema, required_permissions: [], evaluator: 'orglet-report-v1', version_hash: inspected.versionHash };
  const result = { ...initial, files: [...initial.files, { path: 'orglet.json', base64: Buffer.from(JSON.stringify(manifest, null, 2)).toString('base64') }] };
  return inspectPackage(result).input;
}

export function skillResource(skill: Skill, path: string, store: Store) {
  assertSkillReady(skill, store);
  if (!skill.package) throw new Error('Skill không có gói tài nguyên.');
  const file = inspectPackage(skill.package).files.find(file => file.path === path);
  if (!file || !/^(references|assets)\//.test(path) || file.text === null) throw new Error('Chỉ đọc tài nguyên text UTF-8 trong references/ hoặc assets/ của skill này.');
  return { path, content: file.text, packageHash: skill.package.hash };
}
