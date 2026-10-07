import { z } from 'zod';
import { Id, RunInput, Routine, TaskInput, Report } from './contracts';
import { SyncClock, SyncDeviceId, SyncRevisionId } from './sync';
import { SyncRevision } from './sync-revisions';
import { MessageReaction } from './message-interactions';
import { ChatQuote, SideOf } from './side-threads';
import { Channel, EmptyChannel } from './channels';
import { Space } from './spaces';
import { MarketOrigin } from './market';
import { DataFormat } from './profiles';
import { TeamMessage } from './team-messages';

export const SyncRoot = z.object({ kind: z.enum(['worker', 'task']), id: Id }).strict();
export type SyncRoot = z.infer<typeof SyncRoot>;
export const SyncScope = SyncRoot.extend({ epoch: Id }).strict();
export type SyncScope = z.infer<typeof SyncScope>;
export const SyncTurn = z.object({ id: Id, taskId: Id, createdAt: z.iso.datetime(),
  input: RunInput.pick({ brief: true, sourceIds: true, replyTo: true, forwarded: true }).strict() }).strict();
export type SyncTurn = z.infer<typeof SyncTurn>;
// Exact frozen rosters/scopes may exceed picker limits; receive bounds wire records by bytes.
export const SyncChat = z.object({ id: Id, workerId: Id, teamId: Id.optional(), createdAt: z.iso.datetime(),
  sideOf: SideOf.omit({ throughRevision: true }).extend({ throughTurnId: Id }).strict().optional(),
  assignees: z.union([z.literal('all'), z.array(Id)]).optional(), participants: z.array(Id).optional() }).strict();
export const SyncChatField = z.discriminatedUnion('field', [
  z.object({ field: z.literal('title'), value: z.string().max(200).nullable() }).strict(),
  z.object({ field: z.literal('archivedAt'), value: z.iso.datetime().nullable() }).strict(),
  z.object({ field: z.literal('channel'), value: Channel.nullable() }).strict(),
]);
export const SyncSetting = z.discriminatedUnion('key', [
  z.object({ key: z.literal('theme'), value: z.enum(['light', 'dark', 'system']).nullable() }).strict(),
  z.object({ key: z.literal('language'), value: z.enum(['vi', 'en', 'en-GB']).nullable() }).strict(),
  z.object({ key: z.literal('sidebarOrder'), value: z.object({ workers: z.array(Id).max(10000).optional(), teams: z.array(Id).max(10000).optional(), channels: z.array(Id).max(10000).optional(), categories: z.array(Id).max(10000).optional() }).strict().nullable() }).strict(),
]);
export const SyncSource = z.object({ id: Id, name: z.string().max(2000), bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  hash: z.string().regex(/^[a-f0-9]{64}$/), format: DataFormat.optional(), media: z.enum(['image', 'video', 'audio', 'pdf']).optional(), editedFrom: Id.optional() }).strict();
export const SyncRoutine = Routine.pick({ id: true, name: true, schedule: true, enabled: true }).extend({
  trigger: z.enum(['schedule', 'folder', 'called', 'app']),
  task: TaskInput.pick({ workerId: true, teamId: true, brief: true, sourceIds: true, budgetMicros: true }).strict(),
}).strict();
export const SyncRun = z.object({ id: Id, taskId: Id, turnId: Id, stage: z.enum(['plan', 'member', 'synthesis', 'group']).optional(),
  status: z.enum(['completed', 'partial', 'failed', 'cancelled', 'interrupted']), startedAt: z.iso.datetime(),
  worker: SyncRevision.options[0], skill: SyncRevision.options[1], team: SyncRevision.options[2].optional(),
  errorCode: z.enum(['unresolved_attempt', 'report_rejected', 'plan_limit', 'hand_in_blocked']).optional(), outOfSteps: z.literal(true).optional() }).strict();
export const SyncArtifact = z.object({ id: Id, runId: Id, report: Report, hash: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.iso.datetime(),
  replyTo: Id.optional(), usedMemories: z.array(z.object({ id: Id, revisionId: SyncRevisionId.optional(),
    legacyRevision: z.number().int().positive(), text: z.string().min(1).max(500) }).strict()).max(60).optional() }).strict();

// Mutations are projected explicitly. No generic JSON escape hatch for settings, credentials or run journals.
export const SyncData = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('revision'), revision: SyncRevision }).strict(),
  z.object({ kind: z.literal('entityState'), entity: z.enum(['worker', 'team']), id: Id,
    value: z.object({ archivedAt: z.iso.datetime().optional(), deletedAt: z.iso.datetime().optional() }).strict().nullable() }).strict(),
  z.object({ kind: z.literal('chat'), value: SyncChat }).strict(),
  z.object({ kind: z.literal('chatField'), taskId: Id, change: SyncChatField }).strict(),
  z.object({ kind: z.literal('turn'), value: SyncTurn }).strict(),
  z.object({ kind: z.literal('reaction'), taskId: Id, value: MessageReaction.omit({ callId: true }).strict(), deleted: z.boolean() }).strict(),
  z.object({ kind: z.literal('quote'), taskId: Id,
    value: ChatQuote.omit({ afterRevision: true }).extend({ afterTurnId: Id }).strict(), deleted: z.boolean() }).strict(),
  z.object({ kind: z.literal('setting'), change: SyncSetting }).strict(),
  z.object({ kind: z.literal('origin'), value: MarketOrigin, deleted: z.boolean() }).strict(),
  z.object({ kind: z.literal('channel'), value: EmptyChannel, deleted: z.boolean() }).strict(),
  // A space (docs/spaces-design.md): its name, orglets, categories and defaults. The newest save wins as a whole.
  z.object({ kind: z.literal('space'), value: Space, deleted: z.boolean() }).strict(),
  z.object({ kind: z.literal('source'), value: SyncSource }).strict(),
  z.object({ kind: z.literal('routine'), value: SyncRoutine }).strict(),
  z.object({ kind: z.literal('connectionName'), id: Id, name: z.string().trim().min(1).max(60) }).strict(),
  z.object({ kind: z.literal('run'), value: SyncRun }).strict(),
  z.object({ kind: z.literal('artifact'), value: SyncArtifact }).strict(),
  z.object({ kind: z.literal('event'), versionId: Id, value: z.object({ id: Id, runId: Id, sequence: z.number().int().positive().optional(), createdAt: z.iso.datetime(),
    teamMessage: TeamMessage.omit({ callId: true, requestHash: true }).strict() }).strict() }).strict(),
  z.object({ kind: z.literal('delete'), entity: z.enum(['knowledge', 'team', 'skill', 'source', 'routine']), id: Id }).strict(),
  z.object({ kind: z.literal('withdraw'), root: SyncRoot, epoch: Id, localOnly: z.boolean(), deleted: z.boolean() }).strict(),
]);
export type SyncData = z.infer<typeof SyncData>;
export const SYNC_SCHEMA_VERSION = 1;
export const SyncRecord = z.object({ schemaVersion: z.literal(SYNC_SCHEMA_VERSION), id: Id,
  origin: SyncDeviceId, clock: SyncClock, scopes: z.array(SyncScope), data: SyncData }).strict()
  .refine(record => record.origin === record.clock.deviceId, 'Thiết bị và clock không khớp.');
export type SyncRecord = z.infer<typeof SyncRecord>;

export function syncRecordKey(data: SyncData): string {
  switch (data.kind) {
    case 'revision': return `revision:${data.revision.revisionId}`;
    case 'entityState': return `state:${data.entity}:${data.id}`;
    case 'chat': return `chat:${data.value.id}`;
    case 'chatField': return `chat:${data.taskId}:${data.change.field}`;
    case 'turn': return `turn:${data.value.id}`;
    case 'reaction': return `reaction:${data.taskId}:${data.value.messageId}:${data.value.actor}:${data.value.workerId ?? ''}:${data.value.emoji}`;
    case 'quote': return `quote:${data.taskId}:${data.value.id}`;
    case 'setting': return `setting:${data.change.key}`;
    case 'origin': return `origin:${data.value.entityId}`;
    case 'channel': return `channel:${data.value.id}`;
    case 'space': return `space:${data.value.id}`;
    case 'source': return `source:${data.value.id}`;
    case 'routine': return `routine:${data.value.id}`;
    case 'connectionName': return `connection:${data.id}`;
    case 'run': return `run:${data.value.id}`;
    case 'artifact': return `artifact:${data.value.id}`;
    case 'event': return `event:${data.versionId}`;
    case 'delete': return `delete:${data.entity}:${data.id}`;
    case 'withdraw': return `withdraw:${data.root.kind}:${data.root.id}`;
  }
}
