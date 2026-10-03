import { z } from 'zod';

/**
 * An orglet, skill, crew or note that two computers changed while apart (GH-484). Sync keeps both versions and uses
 * the later one; the person can look at both and choose. Choosing writes a new revision, so neither version is lost
 * and every computer ends up on the choice.
 */
export const SyncConflictEntity = z.enum(['worker', 'skill', 'team', 'knowledge']);
export type SyncConflictEntity = z.infer<typeof SyncConflictEntity>;

export type SyncConflictVersion = {
  revisionId: string;
  /** The version in use now. */
  current: boolean;
  /** Whether this computer made it. */
  thisComputer: boolean;
  /** What the person compares: the name, then the instructions or content. */
  text: string;
};
export type SyncConflict = { entity: SyncConflictEntity; id: string; name: string; generation: number; versions: SyncConflictVersion[] };

/** `generation` is the one the person looked at; a change since then refuses the choice. */
export const ResolveSyncConflict = z.object({ entity: SyncConflictEntity, id: z.uuid(), revisionId: z.uuid(),
  generation: z.number().int().positive() }).strict();
export type ResolveSyncConflict = z.infer<typeof ResolveSyncConflict>;
