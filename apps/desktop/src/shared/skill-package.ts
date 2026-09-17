import { z } from 'zod';

export const SKILL_FILE_LIMIT = 256 * 1024;
export const SKILL_PACKAGE_LIMIT = 1024 * 1024;
export const SkillName = z.string().min(1).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const SkillPath = z.string().min(1).max(240).refine(path => {
  const parts = path.split('/');
  return parts.length <= 8 && parts.every(part => part.length > 0 && !/[<>:"\\|?*\x00-\x1f]/.test(part) && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part));
}, 'Đường dẫn trong skill không hợp lệ.');
export const PackageFile = z.object({ path: SkillPath, base64: z.string().max(Math.ceil(SKILL_FILE_LIMIT / 3) * 4) }).strict();
export const PackageInput = z.object({ directoryName: SkillName, files: z.array(PackageFile).min(1).max(100) }).strict();
export type PackageInput = z.infer<typeof PackageInput>;
export const SkillPackage = PackageInput.extend({ hash: z.string().regex(/^[a-f0-9]{64}$/), reviewedHash: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();
export type SkillPackage = z.infer<typeof SkillPackage>;
export const SkillMetadata = z.object({
  name: SkillName, description: z.string().trim().min(1).max(1024),
  license: z.string().max(2000).optional(), compatibility: z.string().min(1).max(500).optional(),
  metadata: z.record(z.string().max(100), z.string().max(2000)).optional(),
  'allowed-tools': z.string().max(2000).optional(),
}).strict();
export type SkillMetadata = z.infer<typeof SkillMetadata>;
export type PackageReview = { metadata: SkillMetadata; hash: string; blockers: string[]; files: { path: string; bytes: number; text: string | null }[] };
