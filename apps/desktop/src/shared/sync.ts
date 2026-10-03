import { z } from 'zod';

const Integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const SyncDeviceId = z.uuid().refine(value => value === value.toLowerCase()).brand<'SyncDeviceId'>();
export const SyncRevisionId = z.uuid().refine(value => value === value.toLowerCase()).brand<'SyncRevisionId'>();
export const SyncClock = z.object({ wallMs: Integer, counter: Integer, deviceId: SyncDeviceId }).strict();
export type SyncClock = z.infer<typeof SyncClock>;

export function compareSyncClock(first: SyncClock, second: SyncClock): number {
  return first.wallMs - second.wallMs || first.counter - second.counter ||
    (first.deviceId < second.deviceId ? -1 : first.deviceId > second.deviceId ? 1 : 0);
}

/** An observed clock advances the next local write, including after a wall-clock rollback. */
export function nextSyncClock(local: SyncClock, nowMs: number, remote?: SyncClock): SyncClock {
  Integer.parse(nowMs);
  const wallMs = Math.max(nowMs, local.wallMs, remote?.wallMs ?? 0);
  const counter = wallMs === local.wallMs && wallMs === remote?.wallMs ? Math.max(local.counter, remote.counter) + 1
    : wallMs === local.wallMs ? local.counter + 1 : wallMs === remote?.wallMs ? remote.counter + 1 : 0;
  return SyncClock.parse({ wallMs, counter, deviceId: local.deviceId });
}

/** Internal main/core context only; absent context means local edits do not enter an account outbox. */
export const SyncRecordingContext = z.object({ accountKey: z.string().regex(/^[a-f0-9]{64}$/),
  generation: Integer }).strict();
export type SyncRecordingContext = z.infer<typeof SyncRecordingContext>;
export const SetSyncLocalOnly = z.object({ kind: z.enum(['worker', 'task']), id: z.uuid(), localOnly: z.boolean() }).strict();
