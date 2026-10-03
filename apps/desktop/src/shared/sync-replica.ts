import { z } from 'zod';
import { SyncDeviceId, SyncRecordingContext } from './sync';
import { SyncRecord } from './sync-records';
import { SyncServerCursor } from './sync-protocol';

/**
 * What main asks of the core's replica while it talks to the sync server (COD-329 phase 3). Main owns the token and
 * the network; the core owns SQLite. Every action after `attach` carries the account context, and the core refuses
 * one that no longer matches, so a reply that arrives after a sign-out changes nothing.
 */
const Outcome = z.object({ id: z.uuid(), status: z.enum(['kept', 'superseded', 'blocked']) }).strict();

export const SyncReplicaAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('attach'), context: SyncRecordingContext }).strict(),
  z.object({ action: z.literal('detach') }).strict(),
  /** Starts a download of the whole account: joins this computer to it and forgets the old cursor. */
  z.object({ action: z.literal('begin'), context: SyncRecordingContext, discardSeed: z.boolean() }).strict(),
  /** One page from the server. A pull page carries its cursor; a snapshot page does not. */
  z.object({ action: z.literal('receive'), context: SyncRecordingContext, records: z.array(z.unknown()).max(100),
    cursor: SyncServerCursor.optional() }).strict(),
  /** Ends a download: the cursor is saved and whatever the server lacks is queued. */
  z.object({ action: z.literal('settle'), context: SyncRecordingContext, cursor: SyncServerCursor }).strict(),
  z.object({ action: z.literal('outbox'), context: SyncRecordingContext }).strict(),
  z.object({ action: z.literal('acknowledge'), context: SyncRecordingContext, outcomes: z.array(Outcome).max(100) }).strict(),
]);
export type SyncReplicaAction = z.infer<typeof SyncReplicaAction>;

export const SyncReplicaState = z.object({
  deviceId: SyncDeviceId,
  /** Whether this computer has joined the account. */
  linked: z.boolean(),
  cursor: SyncServerCursor.nullable(),
  /** Whether this computer holds anything beyond the Researcher a new install starts with. */
  ownData: z.boolean(),
}).strict();
export type SyncReplicaState = z.infer<typeof SyncReplicaState>;

export const SyncReplicaBatch = z.object({
  records: z.array(SyncRecord).max(100),
  /** Queued changes over the server's size limit; they are never sent. */
  skipped: z.number().int().nonnegative(),
  /** Set when a newer Orglet wrote data this build cannot read: sending stops until the app is updated. */
  updateRequired: z.boolean(),
}).strict();
export type SyncReplicaBatch = z.infer<typeof SyncReplicaBatch>;
