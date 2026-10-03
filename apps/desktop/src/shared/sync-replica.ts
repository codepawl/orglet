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
  /** How many orglets and chats this computer would send, and how many stay local-only. */
  z.object({ action: z.literal('counts') }).strict(),
  /** Starts a download of the whole account: joins this computer to it and forgets the old cursor. */
  z.object({ action: z.literal('begin'), context: SyncRecordingContext, discardSeed: z.boolean() }).strict(),
  /** One page from the server. A pull page carries its cursor; a snapshot page does not. */
  z.object({ action: z.literal('receive'), context: SyncRecordingContext, records: z.array(z.unknown()).max(100),
    cursor: SyncServerCursor.optional() }).strict(),
  /** Ends a download: the cursor is saved and whatever the server lacks is queued. */
  z.object({ action: z.literal('settle'), context: SyncRecordingContext, cursor: SyncServerCursor }).strict(),
  z.object({ action: z.literal('outbox'), context: SyncRecordingContext }).strict(),
  z.object({ action: z.literal('acknowledge'), context: SyncRecordingContext, outcomes: z.array(Outcome).max(100) }).strict(),
  /** Saved file versions whose record the server holds and whose bytes it has not been sent. */
  z.object({ action: z.literal('files'), context: SyncRecordingContext }).strict(),
  /** One file was settled: stored, or refused in a way sending again cannot change. */
  z.object({ action: z.literal('fileSent'), context: SyncRecordingContext, sourceId: z.uuid(), stored: z.boolean() }).strict(),
  /** The person opened a file that is on another computer; the chat must own it. */
  z.object({ action: z.literal('fileWanted'), context: SyncRecordingContext, taskId: z.uuid(), sourceId: z.uuid() }).strict(),
  z.object({ action: z.literal('fileReceived'), context: SyncRecordingContext, taskId: z.uuid(), sourceId: z.uuid(),
    base64: z.string().max(34_952_536) }).strict(),
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

export const SyncReplicaFiles = z.object({
  uploads: z.array(z.object({ sourceId: z.uuid(), path: z.string().min(1).max(32768), hash: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().nonnegative() }).strict()).max(8),
}).strict();
export type SyncReplicaFiles = z.infer<typeof SyncReplicaFiles>;

export const SyncReplicaCounts = z.object({ orglets: z.number().int().nonnegative(), chats: z.number().int().nonnegative(),
  localOnly: z.number().int().nonnegative() }).strict();
export type SyncReplicaCounts = z.infer<typeof SyncReplicaCounts>;
