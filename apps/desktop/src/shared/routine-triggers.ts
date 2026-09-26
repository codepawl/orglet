import { z } from 'zod';
import { WorkspacePermissions } from './workspace-access';

/**
 * What starts a routine (COD-245). A clock (`schedule`, the only kind before this and the default for a routine
 * saved without one), a new file in a folder the person granted (`folder`), or a call from `orglet run`
 * (`called`). Event triggers fire only while the app is open and never replay what happened while it was closed.
 * See docs/routines.md.
 */
export const RoutineTriggerKind = z.enum(['schedule', 'folder', 'called']);
export type RoutineTriggerKind = z.infer<typeof RoutineTriggerKind>;

/**
 * The folder part names a folder main's picker granted, never a path: the path stays in the core. `folderName` is
 * the folder's own name for the list and the editor; the core writes it from the grant on every save.
 */
export const RoutineTrigger = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('schedule') }).strict(),
  z.object({ kind: z.literal('folder'), folderId: z.uuid(), folderName: z.string().max(260) }).strict(),
  z.object({ kind: z.literal('called') }).strict(),
]);
export type RoutineTrigger = z.infer<typeof RoutineTrigger>;

/** A watched folder as the renderer sees it after the picker: an id and a name, no path. */
export const WatchFolderView = z.object({ folderId: z.uuid(), name: z.string() }).strict();
export type WatchFolderView = z.infer<typeof WatchFolderView>;

/**
 * A routine's own working folder (COD-294): a folder the picker granted, the level the schedule form chose and whether
 * its runs' changes wait for review. Every run gets this folder at exactly this level as its chat's grant; the level is
 * never wider than the one the picker was opened at. Like the watched folder, it names the grant, never a path, and
 * `folderName` is written by the core from the grant on every save.
 */
export const RoutineWorkspace = z.object({
  folderId: z.uuid(),
  folderName: z.string().max(260),
  permissions: WorkspacePermissions,
  review: z.boolean(),
}).strict();
export type RoutineWorkspace = z.infer<typeof RoutineWorkspace>;

const SCHEDULE_TRIGGER: RoutineTrigger = { kind: 'schedule' };

/** A routine saved before triggers existed runs on its clock. */
export function triggerOf(routine: { trigger?: RoutineTrigger }): RoutineTrigger {
  return routine.trigger ?? SCHEDULE_TRIGGER;
}

/** Office lock files, partial downloads and temporary copies (`~$report.docx`, `x.tmp`, `x.crdownload`, `x.part`). */
const TEMPORARY_PREFIXES = ['~$', '.'];
const TEMPORARY_SUFFIXES = ['.tmp', '.crdownload', '.part', '.partial', '.download'];

/** Whether a new file is one a program is still writing or keeps for itself, so a folder trigger never picks it up. */
export function isTemporaryArrival(name: string): boolean {
  const lower = name.toLowerCase();
  if (TEMPORARY_PREFIXES.some(prefix => lower.startsWith(prefix))) return true;
  return TEMPORARY_SUFFIXES.some(suffix => lower.endsWith(suffix));
}
