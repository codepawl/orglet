import { z } from 'zod';
import { MAX_CREW_TEMPLATE_WORKERS } from './crew-limits';
import { BuiltInProviderId, MAX_CREW_MEMBERS, WorkerInput, SkillInput, TeamInput } from './contracts';
import { KnowledgeInput } from './knowledge';
import { MARKET_BODY_LIMIT, MARKET_METADATA_LIMIT, MARKET_REQUEST_LIMIT } from './market';
import { PackageInput, SKILL_FILE_LIMIT, SKILL_PACKAGE_LIMIT } from './skill-package';
import { inspectPackageContent, packageBlockers, packageIdentityText } from './skill-package-content';
import { validateTemplateReferences } from './templates';
import { credentialLocations, MAX_CREDENTIAL_DIAGNOSTICS } from './secrets';

const TemplateKey = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
// Pick is intentional: adding a local WorkerInput field cannot add a public field.
export const PublicWorker = WorkerInput.pick({
  name: true, instructions: true, provider: true, modelId: true, effort: true,
  avatar: true, description: true,
}).extend({ provider: BuiltInProviderId }).strict();
export const PublicSkill = SkillInput.pick({ name: true, content: true }).extend({
  package: PackageInput.extend({ hash: Digest }).strict().optional(),
}).strict();
export const PublicWorkerTemplate = z.object({
  format: z.literal('orglet-worker-template'), version: z.literal(1),
  worker: PublicWorker, skill: PublicSkill,
}).strict();
export const PublicTeamTemplate = z.object({
  format: z.literal('orglet-team-template'), version: z.literal(1),
  team: TeamInput.pick({
    name: true, instructions: true, workflow: true, monthlyBudgetMicros: true,
    preflight: true, reviewPolicy: true, workHours: true, maxConcurrentTasks: true, taskBudgetMicros: true,
  }).extend({ memberKeys: z.array(TemplateKey).min(1).max(MAX_CREW_MEMBERS), synthesizerKey: TemplateKey }).strict(),
  workers: z.array(PublicWorker.extend({ key: TemplateKey, skillKey: TemplateKey }).strict()).min(1).max(MAX_CREW_TEMPLATE_WORKERS),
  skills: z.array(PublicSkill.extend({ key: TemplateKey }).strict()).min(1).max(MAX_CREW_TEMPLATE_WORKERS),
  knowledge: z.array(KnowledgeInput.pick({ title: true, content: true, tags: true, pinned: true }).strict()).max(50).optional(),
}).strict();
const SubmissionMetadata = {
  name: z.string().trim().min(1).max(80), summary: z.string().trim().min(1).max(240),
  tags: z.array(z.string().min(1).max(32)).max(10), language: z.enum(['en', 'vi']),
  license: z.literal('CC-BY-4.0'), changelog: z.string().max(2000),
};
export const MarketSubmission = z.discriminatedUnion('kind', [
  z.object({ ...SubmissionMetadata, kind: z.literal('orglet'), template: PublicWorkerTemplate }).strict(),
  z.object({ ...SubmissionMetadata, kind: z.literal('crew'), template: PublicTeamTemplate }).strict(),
]);
export type MarketSubmission = z.infer<typeof MarketSubmission>;
export type MarketDiagnostic = { path: string; line: number; rule: string; message: string };
export type MarketSubmissionResult =
  | { ok: true; submission: MarketSubmission; templateText: string; sha256: string; reviewDigest: string }
  | { ok: false; diagnostics: MarketDiagnostic[] };
export type MarketSubmissionLimits = { bodyBytes?: number; requestBytes?: number; fileBytes?: number; packageBytes?: number };

/** Stable serialization for the complete authored version, separate from its template-body SHA. */
export function canonicalMarketContent(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalMarketContent).join(',')}]`;
  if (value && typeof value === 'object') {
    const fields = Object.entries(value).sort(([first], [second]) => first < second ? -1 : first > second ? 1 : 0);
    return `{${fields.map(([key, item]) => `${JSON.stringify(key)}:${canonicalMarketContent(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function diagnostic(path: string, rule: string, line = 1): MarketDiagnostic {
  return { path, rule, line, message: 'Nội dung xuất bản không hợp lệ. Kiểm tra trường và quy tắc được chỉ ra.' };
}

function addDiagnostic(diagnostics: MarketDiagnostic[], value: MarketDiagnostic): void {
  if (diagnostics.length < MAX_CREDENTIAL_DIAGNOSTICS) diagnostics.push(value);
}

const DIAGNOSTIC_FIELDS = new Set([
  'kind', 'name', 'summary', 'tags', 'language', 'license', 'changelog', 'template',
  'format', 'version', 'worker', 'skill', 'team', 'workers', 'skills', 'knowledge',
  'instructions', 'provider', 'modelId', 'effort', 'avatar', 'description', 'emoji',
  'mascot', 'letter', 'color', 'key', 'skillKey', 'memberKeys', 'synthesizerKey',
  'content', 'package', 'directoryName', 'files', 'path', 'title', 'pinned',
]);

function scanAuthoredStrings(value: unknown, path: string, diagnostics: MarketDiagnostic[]): void {
  if (diagnostics.length >= MAX_CREDENTIAL_DIAGNOSTICS) return;
  if (typeof value === 'string') {
    for (const location of credentialLocations(value, MAX_CREDENTIAL_DIAGNOSTICS - diagnostics.length)) {
      addDiagnostic(diagnostics, diagnostic(path, location.rule, location.line));
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanAuthoredStrings(item, `${path}[${index}]`, diagnostics));
    return;
  }
  if (!value || typeof value !== 'object') return;
  Object.entries(value).forEach(([key, item], index) => {
    // Structural digests and encoded envelopes are not authored text; decoded files are checked separately.
    if (key === 'base64' || key === 'hash') return;
    const field = DIAGNOSTIC_FIELDS.has(key) ? key : `field[${index}]`;
    for (const location of credentialLocations(key)) addDiagnostic(diagnostics, diagnostic(`${path}.field[${index}]`, location.rule, location.line));
    scanAuthoredStrings(item, `${path}.${field}`, diagnostics);
  });
}

/** Pure content boundary. Ownership, version IDs and review decisions are supplied by a later authenticated caller. */
export async function validateMarketSubmission(requestText: string, limits: MarketSubmissionLimits = {}): Promise<MarketSubmissionResult> {
  const diagnostics: MarketDiagnostic[] = [];
  const requestLimit = Math.min(limits.requestBytes ?? MARKET_REQUEST_LIMIT, limits.bodyBytes ?? MARKET_REQUEST_LIMIT, MARKET_REQUEST_LIMIT);
  if (new TextEncoder().encode(requestText).length > requestLimit) {
    return { ok: false, diagnostics: [diagnostic('request', 'body-size')] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(requestText);
  } catch {
    return { ok: false, diagnostics: [diagnostic('request', 'json')] };
  }
  const parsed = MarketSubmission.safeParse(raw);
  if (!parsed.success) {
    // Zod messages and unknown field names can contain hostile content. Never return either.
    const issue = parsed.error.issues[0];
    const path = issue.path.reduce<string>((logicalPath, field) => {
      if (typeof field === 'number') return `${logicalPath}[${field}]`;
      return `${logicalPath}.${typeof field === 'string' && DIAGNOSTIC_FIELDS.has(field) ? field : 'field'}`;
    }, 'request');
    return { ok: false, diagnostics: [diagnostic(path, 'schema')] };
  }
  const submission = parsed.data;
  const templateText = JSON.stringify(submission.template);
  const bodyLimit = Math.min(limits.bodyBytes ?? MARKET_BODY_LIMIT, MARKET_BODY_LIMIT);
  if (new TextEncoder().encode(templateText).length > bodyLimit) {
    return { ok: false, diagnostics: [diagnostic('template', 'body-size')] };
  }
  const { template: _template, ...metadata } = submission;
  if (new TextEncoder().encode(JSON.stringify(metadata)).length > MARKET_METADATA_LIMIT) {
    return { ok: false, diagnostics: [diagnostic('request', 'metadata-size')] };
  }
  if (submission.kind === 'crew') {
    try {
      validateTemplateReferences(submission.template);
    } catch {
      addDiagnostic(diagnostics, diagnostic('template', 'references'));
    }
  }
  scanAuthoredStrings(submission, 'request', diagnostics);
  const skills = submission.kind === 'crew' ? submission.template.skills : [submission.template.skill];
  for (const [skillIndex, skill] of skills.entries()) {
    if (!skill.package) continue;
    const path = submission.kind === 'orglet' ? 'template.skill.package' : `template.skills[${skillIndex}].package`;
    try {
      const inspected = inspectPackageContent(skill.package);
      if (inspected.yamlExtensions) addDiagnostic(diagnostics, diagnostic(path, 'yaml-extension'));
      const fileLimit = Math.min(limits.fileBytes ?? SKILL_FILE_LIMIT, SKILL_FILE_LIMIT);
      const packageLimit = Math.min(limits.packageBytes ?? SKILL_PACKAGE_LIMIT, SKILL_PACKAGE_LIMIT);
      if (inspected.files.some(file => file.bytes > fileLimit) || inspected.files.reduce((total, file) => total + file.bytes, 0) > packageLimit) {
        addDiagnostic(diagnostics, diagnostic(path, 'package-size'));
      }
      for (const [fileIndex, file] of inspected.files.entries()) {
        if (file.text === null) {
          addDiagnostic(diagnostics, diagnostic(`${path}.files[${fileIndex}]`, 'utf8-text'));
        } else {
          scanAuthoredStrings(file.text, `${path}.files[${fileIndex}]`, diagnostics);
        }
      }
      const versionHash = await sha256(packageIdentityText(inspected.input, false));
      const reviewHash = await sha256(packageIdentityText(inspected.input, true));
      if (skill.name !== inspected.metadata.name || skill.content !== inspected.content || skill.package.hash !== reviewHash) {
        addDiagnostic(diagnostics, diagnostic(path, 'package-agreement'));
      }
      if (packageBlockers(inspected, versionHash).length) addDiagnostic(diagnostics, diagnostic(path, 'unsupported-package'));
    } catch {
      addDiagnostic(diagnostics, diagnostic(path, 'package'));
    }
  }
  if (diagnostics.length) return { ok: false, diagnostics };
  const [bodyHash, reviewDigest] = await Promise.all([
    sha256(templateText), sha256(canonicalMarketContent(submission)),
  ]);
  return { ok: true, submission, templateText, sha256: bodyHash, reviewDigest };
}
