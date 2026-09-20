import { z } from 'zod';

export const WorkspacePath = z.string().max(240).refine(value => value === '' || (
  !/[\\:<>|?*\u0000-\u001f]/.test(value)
  && value.split('/').every(part => part !== '' && part !== '.' && part !== '..' && !/[ .]$/.test(part)
    && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
    && part.toLowerCase() !== '.git' && !part.toLowerCase().startsWith('.orglet-'))
), 'Đường dẫn phải nằm trong workspace và không trỏ tới dữ liệu nội bộ.');
export const WorkspaceHash = z.string().regex(/^[a-f0-9]{64}$/);
export const WorkspaceList = z.object({ path: WorkspacePath }).strict();
export const WorkspaceRead = z.object({ path: WorkspacePath.refine(Boolean), offset: z.number().int().min(0).max(1_048_576) }).strict();
export const WorkspaceSearch = z.object({ path: WorkspacePath, text: z.string().min(1).max(200) }).strict();
export const WorkspaceWrite = z.object({ path: WorkspacePath.refine(Boolean), content: z.string().max(128 * 1024), expectedHash: WorkspaceHash.nullable() }).strict();
export const WorkspaceFile = z.object({ path: WorkspacePath.refine(Boolean), hash: WorkspaceHash, bytes: z.number().int().nonnegative() }).strict();
export const WorkspaceManifest = z.object({ files: z.array(WorkspaceFile).max(10000), omitted: z.array(z.string()).max(10000) }).strict();
export type WorkspaceManifest = z.infer<typeof WorkspaceManifest>;
export const WorkspaceBlob = z.object({
  hash: WorkspaceHash, base64: z.string().max(65536), nextOffset: z.number().int().nonnegative().nullable(),
}).strict();

/** Internal helper requests are not model tools: only core may select the original snapshot directory. */
export const WorkspaceOperation = z.discriminatedUnion('operation', [
  WorkspaceList.extend({ operation: z.literal('list') }),
  WorkspaceRead.extend({ operation: z.literal('read') }),
  WorkspaceSearch.extend({ operation: z.literal('search') }),
  WorkspaceWrite.extend({ operation: z.literal('write') }),
  WorkspaceRead.extend({ operation: z.literal('blob') }),
  z.object({ operation: z.literal('manifest') }).strict(),
  z.object({ operation: z.literal('snapshot'), source: z.string().min(1).max(32768) }).strict(),
]);
export type WorkspaceOperation = z.infer<typeof WorkspaceOperation>;
