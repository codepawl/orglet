import { parseDocument, visit, isAlias } from 'yaml';
import { z } from 'zod';
import { PackageInput, SkillMetadata, SkillPackage, SKILL_PACKAGE_LIMIT, SKILL_FILE_LIMIT } from './skill-package';
import { StructuredReport, Finding } from './contracts';

const supportedTools = new Set(['read_source', 'profile_dataset', 'audit_run_log', 'submit_report', 'reply', 'read_skill_resource']);
const Manifest = z.object({
  input_schema: z.record(z.string(), z.unknown()), output_schema: z.record(z.string(), z.unknown()),
  required_permissions: z.array(z.string().max(100)).max(20), evaluator: z.string().max(100),
  version_hash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
// This release has one task input and one report output. Other schemas are preserved but cannot run.
export const inputSchema = { type: 'object', properties: { brief: { type: 'string' } }, required: ['brief'], additionalProperties: false };
export const outputSchema = z.toJSONSchema(StructuredReport, { target: 'draft-7' });
// Schemas written by earlier exports stay importable. Each step removes the fields a later build added.
const beforeWorkspaceEvidence = StructuredReport.extend({ findings: z.array(Finding.omit({ workspaceEvidenceIds: true })).max(50) });
const beforeWorkspaceEvidenceOutputSchema = z.toJSONSchema(beforeWorkspaceEvidence, { target: 'draft-7' });
const beforeFormat = beforeWorkspaceEvidence.omit({ format: true });
const beforeFormatOutputSchema = z.toJSONSchema(beforeFormat, { target: 'draft-7' });
const beforeLocations = beforeFormat.extend({ findings: z.array(Finding.omit({ locations: true, workspaceEvidenceIds: true })).max(50) });
const beforeLocationsOutputSchema = z.toJSONSchema(beforeLocations, { target: 'draft-7' });
const previousOutputSchema = z.toJSONSchema(beforeLocations.omit({ review: true }), { target: 'draft-7' });
const legacyOutputSchema = z.toJSONSchema(beforeFormat.omit({ review: true }).extend({ findings: z.array(Finding.omit({ category: true, recommendation: true, checkerIds: true, locations: true, provenance: true, workspaceEvidenceIds: true })).max(50) }), { target: 'draft-7' });

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const fields = Object.entries(value).sort(([first], [second]) => first < second ? -1 : first > second ? 1 : 0);
    return `{${fields.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function decodeText(bytes: Uint8Array): string | null {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return text.includes('\0') ? null : text;
  } catch {
    return null;
  }
}

export function packageIdentityText(input: PackageInput, includeManifest: boolean): string {
  const files = input.files.filter(file => includeManifest || file.path !== 'orglet.json');
  return JSON.stringify([...files].sort((first, second) => first.path < second.path ? -1 : first.path > second.path ? 1 : 0));
}

function decodeBase64(value: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('Nội dung tệp skill không hợp lệ.');
  }
  const decoded = atob(value);
  if (btoa(decoded) !== value) throw new Error('Nội dung tệp skill không hợp lệ.');
  return Uint8Array.from(decoded, character => character.charCodeAt(0));
}
export function inspectPackageContent(raw: unknown) {
  const parsed = z.union([PackageInput, SkillPackage]).parse(raw);
  const input = { directoryName: parsed.directoryName, files: parsed.files };
  const paths = new Set<string>();
  let total = 0;
  const files = input.files.map(file => {
    const key = file.path.toLowerCase();
    if (paths.has(key)) throw new Error('Skill có đường dẫn trùng (không phân biệt hoa thường).');
    paths.add(key);
    const bytes = decodeBase64(file.base64);
    total += bytes.length;
    if (bytes.length > SKILL_FILE_LIMIT || total > SKILL_PACKAGE_LIMIT) throw new Error('Skill vượt giới hạn 256 KB mỗi tệp hoặc 1 MB mỗi gói.');
    return { path: file.path, bytes: bytes.length, text: decodeText(bytes) };
  });
  for (const path of paths) {
    const parts = path.split('/');
    for (let index = 1; index < parts.length; index++) {
      if (paths.has(parts.slice(0, index).join('/'))) throw new Error('Đường dẫn skill vừa là tệp vừa là thư mục.');
    }
  }
  const document = files.find(file => file.path === 'SKILL.md')?.text;
  if (!document) throw new Error('Thiếu SKILL.md UTF-8 ở thư mục gốc.');
  const lines = document.replace(/\r\n/g, '\n').split('\n');
  const end = lines.findIndex((line, index) => index > 0 && line === '---');
  if (lines[0] !== '---' || end < 0) throw new Error('SKILL.md cần YAML frontmatter giữa hai dòng ---.');
  let metadata: SkillMetadata;
  let yamlExtensions = false;
  try {
    const yaml = parseDocument(lines.slice(1, end).join('\n'), { schema: 'core', uniqueKeys: true, strict: true, prettyErrors: false });
    if (yaml.errors.length || yaml.warnings.length) throw new Error();
    visit(yaml, (_key, node) => {
      if (isAlias(node) || (node && typeof node === 'object' && 'tag' in node && node.tag)) yamlExtensions = true;
    });
    metadata = SkillMetadata.parse(yaml.toJS({ maxAliasCount: 0 }));
  } catch {
    throw new Error('Frontmatter không hợp lệ: kiểm tra name, description, kiểu dữ liệu, key trùng và YAML alias/tag.');
  }
  if (metadata.name !== input.directoryName) throw new Error('name trong SKILL.md phải trùng tên thư mục.');
  const content = lines.slice(end + 1).join('\n').trim();
  if (!content || content.length > 16000) throw new Error('Nội dung hướng dẫn cần từ 1 đến 16.000 ký tự.');
  const extension = files.find(file => file.path === 'orglet.json');
  let manifest: z.infer<typeof Manifest> | undefined;
  if (extension) {
    try {
      manifest = Manifest.parse(JSON.parse(extension.text ?? ''));
    } catch {
      throw new Error('orglet.json không đúng manifest của Orglet.');
    }
  }
  return { input, metadata, content, files, manifest, yamlExtensions };
}

export function packageBlockers(inspected: ReturnType<typeof inspectPackageContent>, hash: string): string[] {
  const { metadata, manifest } = inspected;
  const blockers: string[] = [];
  for (const tool of metadata['allowed-tools']?.split(/\s+/).filter(Boolean) ?? []) {
    if (!supportedTools.has(tool)) blockers.push(`Tool chưa hỗ trợ: ${tool}`);
  }
  if (manifest) {
    if (manifest.version_hash !== hash) throw new Error('version_hash trong orglet.json không khớp nội dung gói.');
    if (canonical(manifest.input_schema) !== canonical(inputSchema)) blockers.push('input_schema chưa hỗ trợ.');
    if (![outputSchema, beforeWorkspaceEvidenceOutputSchema, beforeFormatOutputSchema, beforeLocationsOutputSchema, previousOutputSchema, legacyOutputSchema].some(schema => canonical(manifest.output_schema) === canonical(schema))) blockers.push('output_schema chưa hỗ trợ.');
    if (manifest.evaluator !== 'orglet-report-v1') blockers.push(`Evaluator chưa hỗ trợ: ${manifest.evaluator}`);
    for (const permission of manifest.required_permissions) {
      if (!['selected-sources:read', 'skill-resources:read'].includes(permission)) blockers.push(`Quyền chưa hỗ trợ: ${permission}`);
    }
  }
  return blockers;
}
