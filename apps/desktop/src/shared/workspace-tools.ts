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
/** Folder, move and delete operations on the private copy (COD-254); hand-in carries them into the person's folder. */
export const WorkspaceCreateFolder = z.object({ path: WorkspacePath.refine(Boolean) }).strict();
export const WorkspaceMove = z.object({ from: WorkspacePath.refine(Boolean), to: WorkspacePath.refine(Boolean) }).strict();
export const WorkspaceDelete = z.object({ path: WorkspacePath.refine(Boolean) }).strict();
export const WorkspaceFile = z.object({ path: WorkspacePath.refine(Boolean), hash: WorkspaceHash, bytes: z.number().int().nonnegative() }).strict();
export const WorkspaceManifest = z.object({
  files: z.array(WorkspaceFile).max(10000),
  omitted: z.array(z.string()).max(10000),
  /** Every folder the walk entered. Absent in manifests saved before COD-254, which then integrate no folder steps. */
  folders: z.array(WorkspacePath.refine(Boolean)).max(10000).optional(),
}).strict();
export type WorkspaceManifest = z.infer<typeof WorkspaceManifest>;
/** What one hand-in step does to the person's folder (COD-254); a change saved before then is a write. */
export const WorkspaceChangeKind = z.enum(['write', 'folder', 'move', 'delete', 'remove_folder']);
export type WorkspaceChangeKind = z.infer<typeof WorkspaceChangeKind>;
export const WorkspaceBlob = z.object({
  hash: WorkspaceHash, base64: z.string().max(65536), nextOffset: z.number().int().nonnegative().nullable(),
}).strict();

/** Internal helper requests are not model tools: only core may select the original snapshot directory. */
export const WorkspaceOperation = z.discriminatedUnion('operation', [
  WorkspaceList.extend({ operation: z.literal('list') }),
  WorkspaceRead.extend({ operation: z.literal('read') }),
  WorkspaceSearch.extend({ operation: z.literal('search') }),
  WorkspaceWrite.extend({ operation: z.literal('write') }),
  WorkspaceCreateFolder.extend({ operation: z.literal('create_folder') }),
  WorkspaceMove.extend({ operation: z.literal('move') }),
  WorkspaceDelete.extend({ operation: z.literal('delete') }),
  WorkspaceRead.extend({ operation: z.literal('blob') }),
  z.object({ operation: z.literal('manifest') }).strict(),
  z.object({ operation: z.literal('snapshot'), source: z.string().min(1).max(32768) }).strict(),
]);
export type WorkspaceOperation = z.infer<typeof WorkspaceOperation>;
