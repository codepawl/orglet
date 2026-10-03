import { z } from 'zod';
import { SyncDeviceId } from './sync';
import { SyncRecord } from './sync-records';

const Integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const SyncServerCursor = z.object({ generation: z.uuid(), sequence: Integer, privacy: Integer }).strict();
export type SyncServerCursor = z.infer<typeof SyncServerCursor>;
export const SyncPushRequest = z.object({ deviceId: SyncDeviceId, records: z.array(SyncRecord).min(1).max(100) }).strict();
export type SyncPushRequest = z.infer<typeof SyncPushRequest>;
export const SyncPullRequest = z.object({ deviceId: SyncDeviceId, after: SyncServerCursor,
  limit: z.number().int().min(1).max(100).default(100) }).strict();
export const SyncSnapshotRequest = z.object({ deviceId: SyncDeviceId, cursor: z.string().min(1).max(4096).optional(),
  limit: z.number().int().min(1).max(100).default(100) }).strict();
export const SyncReleaseDeviceRequest = z.object({ deviceId: SyncDeviceId, targetDeviceId: SyncDeviceId }).strict();
export const SyncPushResult = z.object({ cursor: SyncServerCursor, outcomes: z.array(z.object({ id: z.uuid(),
  status: z.enum(['kept', 'superseded', 'blocked']) }).strict()).max(100) }).strict();
export const SyncPullResult = z.object({ cursor: SyncServerCursor, records: z.array(SyncRecord).max(100), more: z.boolean() }).strict();
// A client stages every snapshot page and applies only the completed snapshot. Restart discards staged pages.
export const SyncSnapshotResult = z.object({ cursor: SyncServerCursor, records: z.array(SyncRecord).max(100),
  next: z.string().max(4096).nullable() }).strict();
export const SyncHint = z.object({ kind: z.literal('changes'), cursor: SyncServerCursor }).strict();
export const SYNC_BATCH_BYTES = 8_388_608;
export const SYNC_RECORD_BYTES = 2_097_152;
// Attached file bytes travel apart from records: PUT or GET /v1/files/<source id>, raw bytes, one file per request.
export const SyncFileRequest = z.object({ deviceId: SyncDeviceId, sourceId: z.uuid() }).strict();
export const SyncFileStored = z.object({ status: z.enum(['stored', 'present']) }).strict();
/** The largest file that syncs: 25 MiB. A deployment can set a lower limit, never a higher one. */
export const SYNC_FILE_BYTES = 26_214_400;
