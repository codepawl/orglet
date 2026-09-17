import { createHash } from 'node:crypto';
import { parseDocument } from 'yaml';
import { z } from 'zod';
import { PackageInput, SkillMetadata, SkillPackage, SKILL_PACKAGE_LIMIT, SKILL_FILE_LIMIT } from '../shared/skill-package';
import { Report, Finding, type Skill } from '../shared/contracts';
import type { Store } from './storage/database';

const supportedTools = new Set(['read_source', 'profile_dataset', 'audit_run_log', 'submit_report', 'reply', 'read_skill_resource']);
const Manifest = z.object({
  input_schema: z.record(z.string(), z.unknown()), output_schema: z.record(z.string(), z.unknown()),
  required_permissions: z.array(z.string().max(100)).max(20), evaluator: z.string().max(100),
  version_hash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
// This release has one task input and one report output. Other schemas are preserved but cannot run.
export const inputSchema = { type: 'object', properties: { brief: { type: 'string' } }, required: ['brief'], additionalProperties: false };
export const outputSchema = z.toJSONSchema(Report, { target: 'draft-7' });
// Schemas written by earlier exports stay importable. Each step removes the fields a later build added.
const beforeFormat = Report.omit({ format: true });
const beforeFormatOutputSchema = z.toJSONSchema(beforeFormat, { target: 'draft-7' });
const beforeLocations = beforeFormat.extend({ findings: z.array(Finding.omit({ locations: true })).max(50) });
const beforeLocationsOutputSchema = z.toJSONSchema(beforeLocations, { target: 'draft-7' });
const previousOutputSchema = z.toJSONSchema(beforeLocations.omit({ review: true }), { target: 'draft-7' });
const legacyOutputSchema = z.toJSONSchema(beforeFormat.omit({ review: true }).extend({ findings: z.array(Finding.omit({ category: true, recommendation: true, checkerIds: true, locations: true, provenance: true })).max(50) }), { target: 'draft-7' });

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

export function decodeText(bytes: Uint8Array): string | null {
  try { const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); return text.includes('\0') ? null : text; } catch { return null; }
}
export function inspectPackage(raw: unknown) {
  const parsed = z.union([PackageInput, SkillPackage]).parse(raw);
  const input = { directoryName: parsed.directoryName, files: parsed.files };
  const paths = new Set<string>(); let total = 0;
  const files = input.files.map(file => {
    const key = file.path.toLowerCase();
    if (paths.has(key)) throw new Error('Skill có đường dẫn trùng (không phân biệt hoa thường).');
    paths.add(key);
    const bytes = Buffer.from(file.base64, 'base64');
    if (bytes.toString('base64') !== file.base64) throw new Error('Nội dung tệp skill không hợp lệ.');
    total += bytes.length;
    if (bytes.length > SKILL_FILE_LIMIT || total > SKILL_PACKAGE_LIMIT) throw new Error('Skill vượt giới hạn 256 KB mỗi tệp hoặc 1 MB mỗi gói.');
    return { path: file.path, bytes: bytes.length, text: decodeText(bytes) };
  });
  for (const path of paths) {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) if (paths.has(parts.slice(0, i).join('/'))) throw new Error('Đường dẫn skill vừa là tệp vừa là thư mục.');
  }
  const document = files.find(file => file.path === 'SKILL.md')?.text;
  if (!document) throw new Error('Thiếu SKILL.md UTF-8 ở thư mục gốc.');
  const lines = document.replace(/\r\n/g, '\n').split('\n');
  const end = lines.findIndex((line, index) => index > 0 && line === '---');
  if (lines[0] !== '---' || end < 0) throw new Error('SKILL.md cần YAML frontmatter giữa hai dòng ---.');
  let metadata: SkillMetadata;
  try {
    const yaml = parseDocument(lines.slice(1, end).join('\n'), { schema: 'core', uniqueKeys: true, strict: true, prettyErrors: false });
    if (yaml.errors.length || yaml.warnings.length) throw new Error();
    metadata = SkillMetadata.parse(yaml.toJS({ maxAliasCount: 0 }));
  } catch { throw new Error('Frontmatter không hợp lệ: kiểm tra name, description, kiểu dữ liệu, key trùng và YAML alias/tag.'); }
  if (metadata.name !== input.directoryName) throw new Error('name trong SKILL.md phải trùng tên thư mục.');
  const content = lines.slice(end + 1).join('\n').trim();
  if (!content || content.length > 16000) throw new Error('Nội dung hướng dẫn cần từ 1 đến 16.000 ký tự.');
  const hash = createHash('sha256').update(JSON.stringify([...input.files].filter(file => file.path !== 'orglet.json').sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0))).digest('hex');
  const blockers: string[] = [];
  for (const tool of metadata['allowed-tools']?.split(/\s+/).filter(Boolean) ?? []) if (!supportedTools.has(tool)) blockers.push(`Tool chưa hỗ trợ: ${tool}`);
  const own = files.find(file => file.path === 'orglet.json');
  if (own) {
    let manifest: z.infer<typeof Manifest>;
    try { manifest = Manifest.parse(JSON.parse(own.text ?? '')); } catch { throw new Error('orglet.json không đúng manifest của Orglet.'); }
    if (manifest.version_hash !== hash) throw new Error('version_hash trong orglet.json không khớp nội dung gói.');
    if (canonical(manifest.input_schema) !== canonical(inputSchema)) blockers.push('input_schema chưa hỗ trợ.');
    if (![outputSchema, beforeFormatOutputSchema, beforeLocationsOutputSchema, previousOutputSchema, legacyOutputSchema].some(schema => canonical(manifest.output_schema) === canonical(schema))) blockers.push('output_schema chưa hỗ trợ.');
    if (manifest.evaluator !== 'orglet-report-v1') blockers.push(`Evaluator chưa hỗ trợ: ${manifest.evaluator}`);
    for (const permission of manifest.required_permissions) if (!['selected-sources:read', 'skill-resources:read'].includes(permission)) blockers.push(`Quyền chưa hỗ trợ: ${permission}`);
  }
  // Include the extension itself in review identity; it is excluded only from its own version_hash.
  const reviewHash = createHash('sha256').update(JSON.stringify([...input.files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0))).digest('hex');
  return { input, metadata, content, hash: reviewHash, versionHash: hash, blockers, files };
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
  const initial = skill.package ? inspectPackage(skill.package).input : {
    directoryName: name,
    files: [{ path: 'SKILL.md', base64: Buffer.from(`---\nname: ${name}\ndescription: ${JSON.stringify(skill.name)}\n---\n\n${skill.content}\n`).toString('base64') }],
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
