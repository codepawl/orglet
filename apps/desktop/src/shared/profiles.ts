import { z } from 'zod';
import { RunAudit, ScoreDirection } from './run-audit';

export const DataFormat = z.enum(['csv', 'jsonl', 'parquet']);
export type DataFormat = z.infer<typeof DataFormat>;
export const ProfileArgs = z.object({ sourceIds: z.array(z.string().uuid()).min(1).max(2), idColumn: z.string().min(1).max(256).nullable() }).strict();
export const ExactMatchRequest = z.object({
  predictionSourceId: z.string().uuid(), answerSourceId: z.string().uuid(),
  idColumn: z.string().trim().min(1).max(256),
  predictionColumn: z.string().trim().min(1).max(256), answerColumn: z.string().trim().min(1).max(256),
}).strict().refine(value => value.predictionSourceId !== value.answerSourceId, 'Cần hai nguồn khác nhau để tính accuracy.');
export type ExactMatchRequest = z.infer<typeof ExactMatchRequest>;
export const ProfileInput = z.object({ files: z.array(z.object({ sourceId: z.string().uuid(), format: DataFormat, base64: z.string().max(45_000_000) })).min(1).max(2), idColumn: z.string().min(1).max(256).nullable(), runAudit: z.object({ direction: ScoreDirection }).strict().optional(), exactMatch: ExactMatchRequest.optional(),
  // The first rows as text, for the file viewer of a format the window cannot read itself (Parquet).
  sampleRows: z.number().int().min(1).max(500).optional() });
export type ProfileInput = z.infer<typeof ProfileInput>;
const Count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const ExactMatchAccuracy = ExactMatchRequest.safeExtend({
  version: z.literal('orglet-exact-match-v1'),
  status: z.enum(['complete', 'incomplete', 'unsupported']),
  reason: z.enum(['empty', 'missing_column', 'null_id', 'duplicate_id', 'id_mismatch', 'null_value', 'type_mismatch', 'unsupported_type']).nullable(),
  matched: Count.nullable(), total: Count.nullable(), accuracy: z.number().min(0).max(1).nullable(),
}).refine(result => result.status === 'complete'
  ? result.reason === null && result.total !== null && result.total > 0 && result.matched !== null && result.matched <= result.total && result.accuracy === result.matched / result.total
  : result.reason !== null && result.matched === null && result.accuracy === null, 'Kết quả exact-match không nhất quán.');
export type ExactMatchAccuracy = z.infer<typeof ExactMatchAccuracy>;
/** What a column mostly holds. A CSV is read as text, so this comes from the values, not from the file. */
export const ColumnKind = z.enum(['number', 'date', 'text', 'empty', 'other']);
export type ColumnKind = z.infer<typeof ColumnKind>;
// Fields after distinctNonNull were added with COD-297; profiles saved before it stay valid without them.
const ColumnFacts = z.object({
  name: z.string(), type: z.string(), nulls: Count, distinctNonNull: Count,
  kind: ColumnKind.optional(),
  /** Values that do not fit the kind: text in a number column, or anything but a real date in a date column. */
  misfits: Count.optional(),
  /** Values written like a date that name a day that does not exist, such as 2024-02-30. */
  invalidDates: Count.optional(),
  range: z.object({ minimum: z.number(), maximum: z.number(), negatives: Count }).nullable().optional(),
});
export type ColumnFacts = z.infer<typeof ColumnFacts>;
/** Rows that share a key (every cell, or one column's value), counted in full; the first groups listed by row number. */
const RowRepeats = z.object({
  repeatedRows: Count,
  groupCount: Count,
  groups: z.array(z.object({ rows: z.array(Count).min(2).max(10), size: Count })).max(10),
});
export type RowRepeats = z.infer<typeof RowRepeats>;
export const DatasetProfile = z.object({
  engine: z.string(), coverage: z.literal('full'), checks: z.array(z.string()), limitations: z.array(z.string()),
  datasets: z.array(z.object({
    sourceId: z.string().uuid(), rows: Count,
    columns: z.array(ColumnFacts).max(128),
    id: z.object({ column: z.string(), nulls: Count, duplicateNonNull: Count, repeats: RowRepeats.optional() }).nullable(),
    duplicateRows: RowRepeats.optional(),
    firstColumn: RowRepeats.extend({ column: z.string() }).nullable().optional(),
    sample: z.object({ columns: z.array(z.string()).max(128), rows: z.array(z.array(z.string().max(4000))).max(500) }).optional(),
  })).min(1).max(2),
  // Fields after sameIdOrder were added later; stored profiles without them stay valid and never satisfy alignment gates.
  comparison: z.object({ schemaMatches: z.boolean(), overlappingDistinctIds: Count.nullable(), sameIdOrder: z.boolean().nullable(), columnsMatch: z.boolean().optional(), rowCountsMatch: z.boolean().optional(), onlyInFirst: Count.nullable().optional(), onlyInSecond: Count.nullable().optional() }).nullable(),
  runAudit: RunAudit.optional(),
  exactMatch: ExactMatchAccuracy.optional(),
}).refine(result => !result.runAudit || (result.datasets.length === 1 && result.runAudit.sourceId === result.datasets[0].sourceId && result.runAudit.rows === result.datasets[0].rows && result.runAudit.completed + result.runAudit.failed + result.runAudit.cancelled === result.runAudit.rows), 'Run audit phải khớp dataset và số dòng đã kiểm tra.')
  .refine(result => !result.exactMatch || (result.datasets.length === 2 && result.exactMatch.predictionSourceId === result.datasets[0].sourceId && result.exactMatch.answerSourceId === result.datasets[1].sourceId && result.datasets.every(dataset => dataset.id?.column === result.exactMatch!.idColumn || result.exactMatch!.reason === 'missing_column') && (result.exactMatch.status !== 'complete' || result.exactMatch.total === result.datasets[0].rows)), 'Kết quả exact-match phải khớp hai nguồn đã kiểm tra.');
export type DatasetProfile = z.infer<typeof DatasetProfile>;
export type ProfileRecord = { id: string; taskId: string; runId?: string; createdAt: string; sourceHashes: Record<string, string>; result: DatasetProfile };
export type ProfileExecutor = (input: ProfileInput, signal?: AbortSignal) => Promise<DatasetProfile>;
/** A table file's first rows, as the viewer shows them, with how many rows the file has in all. */
export type TableSample = { columns: string[]; rows: string[][]; total: number };
