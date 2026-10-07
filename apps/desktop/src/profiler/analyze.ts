import { DuckDBInstance, version } from '@duckdb/node-api';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatasetProfile, type ColumnFacts, type DataFormat, type ExactMatchAccuracy, type ProfileInput } from '../shared/profiles';
import { auditRuns, RunAuditInputError } from './run-audit';
import { columnFacts, firstColumnLooksLikeRowName, identifier, repeatedRows, wholeRowKey, type Query } from './column-checks';

const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

type CheckedDataset = Omit<DatasetProfile['datasets'][number], 'sourceId'>;

/**
 * One file's facts: its rows, each column, the chosen ID column, identical rows and, when no ID column was chosen, a
 * first column that looks like it names each row.
 */
async function checkDataset(query: Query, table: string, format: DataFormat, idColumn: string | null): Promise<CheckedDataset> {
  const rows = Number((await query(`SELECT count(*) AS n FROM ${table}`))[0].n);
  const schema = await query(`DESCRIBE ${table}`);
  const columns: ColumnFacts[] = [];
  for (const column of schema) columns.push(await columnFacts(query, table, String(column.column_name), String(column.column_type)));
  // Row numbers count the way a spreadsheet shows them: in a CSV the column names are row 1.
  const rowOffset = format === 'csv' ? 1 : 0;
  const id = idColumn ? columns.find(column => column.name === idColumn) : undefined;
  const idDuplicates = id ? rows - id.nulls - id.distinctNonNull : 0;
  const idRepeats = id && idDuplicates > 0 ? await repeatedRows(query, table, identifier(id.name), rowOffset) : undefined;
  const rowKey = wholeRowKey(columns.map(column => column.name));
  const duplicateRows = await repeatedRows(query, table, rowKey, rowOffset);
  const first = columns[0];
  const checkFirstColumn = !idColumn && columns.length > 1 && firstColumnLooksLikeRowName(first, rows);
  const firstRepeats = checkFirstColumn ? await repeatedRows(query, table, identifier(first.name), rowOffset, rowKey) : undefined;
  return {
    rows,
    columns,
    id: id ? { column: id.name, nulls: id.nulls, duplicateNonNull: idDuplicates, repeats: idRepeats } : null,
    duplicateRows,
    firstColumn: firstRepeats ? { column: first.name, ...firstRepeats } : null,
  };
}

// Only this bundled code creates SQL. Neither source contents nor model replies supply SQL.
/** A cell as text: empty for a null, JSON for a list or a struct, and the value's own text otherwise. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return text.length > 4000 ? text.slice(0, 4000) : text;
}

/** The first rows of a table in file order, every cell as text. */
async function sampleOf(query: Query, table: string, columns: string[], limit: number) {
  const records = await query(`SELECT * FROM ${table} LIMIT ${Math.trunc(limit)}`);
  return { columns, rows: records.map(record => columns.map(column => cellText(record[column]))) };
}

export async function analyze(input: ProfileInput, scratchDirectory?: string): Promise<DatasetProfile> {
  if (input.runAudit && input.files.length !== 1) throw new RunAuditInputError('Chọn đúng một run-log cho mỗi lần audit.');
  if (input.exactMatch && (input.files.length !== 2 || input.runAudit || input.idColumn !== input.exactMatch.idColumn
    || input.files[0].sourceId !== input.exactMatch.predictionSourceId || input.files[1].sourceId !== input.exactMatch.answerSourceId)) {
    throw new Error('Cần đúng cặp predictions/answers và cột ID đã chọn để tính accuracy.');
  }
  const directory = scratchDirectory ?? await mkdtemp(join(tmpdir(), 'orglet-profile-'));
  let instance: DuckDBInstance | undefined;
  let connection: Awaited<ReturnType<DuckDBInstance['connect']>> | undefined;
  let timeout: NodeJS.Timeout | undefined;
  try {
    const paths: string[] = [];
    for (const [index, file] of input.files.entries()) {
      const bytes = Buffer.from(file.base64, 'base64');
      if (bytes.length > 32 * 1024 * 1024) throw new Error('Dataset vượt 32 MB.');
      const path = join(directory, `source-${index}.${file.format}`);
      await writeFile(path, bytes, { flag: 'wx' }); paths.push(path);
    }
    instance = await DuckDBInstance.create(':memory:', { threads: '1', memory_limit: '128MB', max_temp_directory_size: '0B', autoinstall_known_extensions: 'false', autoload_known_extensions: 'false', allow_unsigned_extensions: 'false', allow_community_extensions: 'false' });
    connection = await instance.connect();
    await connection.run(`SET allowed_paths = [${paths.map(literal).join(',')}]; SET enable_external_access = false; SET lock_configuration = true;`);
    timeout = setTimeout(() => connection?.interrupt(), 18_000);
    const query = async (sql: string) => (await connection!.runAndReadAll(sql)).getRowObjectsJson();
    const result: DatasetProfile = { engine: `DuckDB ${version()}`, coverage: 'full', checks: ['schema', 'row_count', 'null_count', 'distinct_non_null'], limitations: ['Orglet chỉ đọc tệp, không chạy gì trong đó.', 'Các phép đếm này cho biết hình dạng của dữ liệu, không cho biết dữ liệu đúng hay đủ.', 'Dòng đầu của CSV là tên cột và là dòng 1. Ô được đọc như chữ rồi mới xét là số hay ngày; ô rỗng tính là ô trống.', 'Không trả về dòng dữ liệu nào: chỉ có số đếm, số thứ tự dòng, và số nhỏ nhất, lớn nhất của cột số.'], datasets: [], comparison: null };
    for (const [index, file] of input.files.entries()) {
      const reader = file.format === 'csv' ? `read_csv(${literal(paths[index])}, header=true, all_varchar=true, strict_mode=true, sample_size=-1)` : file.format === 'parquet' ? `read_parquet(${literal(paths[index])})` : `read_json(${literal(paths[index])}, format='newline_delimited', sample_size=-1, maximum_object_size=1048576)`;
      await connection.run(`CREATE VIEW source${index} AS SELECT * FROM ${reader}`);
      if ((await query(`DESCRIBE source${index}`)).length > 128) throw new Error('Dataset vượt 128 cột.');
      // The file is parsed once into memory, so each column query scans that table instead of parsing the file again.
      await connection.run(`CREATE TABLE data${index} AS SELECT * FROM source${index}`);
      const dataset = await checkDataset(query, `data${index}`, file.format, input.idColumn);
      if (input.idColumn && !dataset.id && !input.exactMatch) throw new Error('Không tìm thấy cột ID đã chọn.');
      const sample = input.sampleRows ? await sampleOf(query, `data${index}`, dataset.columns.map(column => column.name), input.sampleRows) : undefined;
      result.datasets.push({ sourceId: file.sourceId, ...dataset, ...(sample ? { sample } : {}) });
    }
    result.checks.push('column_kinds', 'number_ranges', 'invalid_dates', 'duplicate_rows', 'first_column_repeats');
    if (input.idColumn) result.checks.push('id_nulls', 'id_duplicates');
    if (input.runAudit) {
      const dataset = result.datasets[0];
      if (!dataset.rows || dataset.rows > 10000) throw new RunAuditInputError('Run-log cần từ 1 đến 10.000 dòng.');
      const names = dataset.columns.map(column => column.name);
      const required = ['solution', 'run', 'split', 'metric', 'status', 'score'];
      if (required.some(name => !names.includes(name))) throw new RunAuditInputError('Run-log cần các cột solution, run, split, metric, status, score; tùy chọn error_code.');
      const selected = [...required, ...(names.includes('error_code') ? ['error_code'] : [])];
      result.runAudit = auditRuns(await query(`SELECT ${selected.map(identifier).join(',')} FROM data0`), dataset.sourceId, input.runAudit.direction);
      result.checks.push('run_failures', 'within_solution_repeat_summary', 'public_private_rank_change');
      result.limitations.push('Run audit dùng score do tệp log khai báo, không tính lại metric từ predictions/answers.');
    }
    if (result.datasets.length === 2) {
      const signature = (index: number) => JSON.stringify(result.datasets[index].columns.map(({ name, type }) => ({ name, type })));
      const names = (index: number) => JSON.stringify(result.datasets[index].columns.map(column => column.name).sort());
      result.comparison = { schemaMatches: signature(0) === signature(1), columnsMatch: names(0) === names(1), rowCountsMatch: result.datasets[0].rows === result.datasets[1].rows, overlappingDistinctIds: null, sameIdOrder: null, onlyInFirst: null, onlyInSecond: null };
      result.checks.push('schema_alignment', 'column_names', 'row_count_alignment');
      if (input.idColumn && result.datasets.every(dataset => dataset.id)) {
        const key = identifier(input.idColumn);
        const distinctIds = (from: string, except: string) => `SELECT count(*) AS n FROM (SELECT CAST(${key} AS VARCHAR) FROM ${from} WHERE ${key} IS NOT NULL EXCEPT SELECT CAST(${key} AS VARCHAR) FROM ${except} WHERE ${key} IS NOT NULL)`;
        result.comparison.onlyInFirst = Number((await query(distinctIds('data0', 'data1')))[0].n);
        result.comparison.onlyInSecond = Number((await query(distinctIds('data1', 'data0')))[0].n);
        result.checks.push('id_set_difference');
        result.comparison.overlappingDistinctIds = Number((await query(`SELECT count(*) AS n FROM (SELECT CAST(${key} AS VARCHAR) FROM data0 WHERE ${key} IS NOT NULL INTERSECT SELECT CAST(${key} AS VARCHAR) FROM data1 WHERE ${key} IS NOT NULL)`))[0].n);
        const mismatch = Number((await query(`WITH a AS (SELECT row_number() OVER () AS position, CAST(${key} AS VARCHAR) AS id FROM data0), b AS (SELECT row_number() OVER () AS position, CAST(${key} AS VARCHAR) AS id FROM data1) SELECT count(*) AS n FROM a FULL JOIN b USING(position) WHERE a.position IS NULL OR b.position IS NULL OR a.id IS DISTINCT FROM b.id`))[0].n);
        result.comparison.sameIdOrder = mismatch === 0;
        result.checks.push('id_overlap', 'id_order_alignment');
        result.limitations.push('Mã được so như chữ, theo thứ tự dòng trong tệp. Mã trùng hoặc trống cần xem riêng; hai tệp có chung mã chưa chắc là có vấn đề.');
      }
    }
    if (input.exactMatch) {
      const request = input.exactMatch;
      const predictions = result.datasets[0];
      const answers = result.datasets[1];
      const predictionValue = predictions.columns.find(column => column.name === request.predictionColumn);
      const answerValue = answers.columns.find(column => column.name === request.answerColumn);
      const predictionId = predictions.columns.find(column => column.name === request.idColumn);
      const answerId = answers.columns.find(column => column.name === request.idColumn);
      const total = predictions.rows;
      const incomplete = (reason: NonNullable<ExactMatchAccuracy['reason']>, status: 'incomplete' | 'unsupported'): ExactMatchAccuracy => ({ ...request, version: 'orglet-exact-match-v1', status, reason, matched: null, total, accuracy: null });
      const idType = /^(VARCHAR|U?TINYINT|U?SMALLINT|U?INTEGER|U?BIGINT|U?HUGEINT)$/;
      const scalarType = /^(VARCHAR|BOOLEAN|U?TINYINT|U?SMALLINT|U?INTEGER|U?BIGINT|U?HUGEINT|FLOAT|DOUBLE|DECIMAL\(\d+,\d+\))$/;
      if (!predictionValue || !answerValue || !predictionId || !answerId) result.exactMatch = incomplete('missing_column', 'unsupported');
      else if (total === 0 || answers.rows === 0) result.exactMatch = incomplete('empty', 'incomplete');
      else if (predictions.id!.nulls || answers.id!.nulls) result.exactMatch = incomplete('null_id', 'incomplete');
      else if (predictions.id!.duplicateNonNull || answers.id!.duplicateNonNull) result.exactMatch = incomplete('duplicate_id', 'incomplete');
      else if (predictionId.type !== answerId.type || predictionValue.type !== answerValue.type) result.exactMatch = incomplete('type_mismatch', 'unsupported');
      else if (!idType.test(predictionId.type) || !scalarType.test(predictionValue.type)) result.exactMatch = incomplete('unsupported_type', 'unsupported');
      else if (result.comparison?.onlyInFirst !== 0 || result.comparison.onlyInSecond !== 0 || predictions.rows !== answers.rows) result.exactMatch = incomplete('id_mismatch', 'incomplete');
      else if (predictionValue.nulls || answerValue.nulls) result.exactMatch = incomplete('null_value', 'incomplete');
      else {
        const matches = await query(`SELECT count(*) AS n FROM data0 AS predictions INNER JOIN data1 AS answers ON predictions.${identifier(request.idColumn)} = answers.${identifier(request.idColumn)} WHERE predictions.${identifier(request.predictionColumn)} = answers.${identifier(request.answerColumn)}`);
        const matched = Number(matches[0].n);
        result.exactMatch = { ...request, version: 'orglet-exact-match-v1', status: 'complete', reason: null, matched, total, accuracy: matched / total };
      }
      result.checks.push('exact_match_accuracy');
      result.limitations.push('Chỉ tính exact-match accuracy trên cặp và cột đã chọn; không xác nhận đây là metric chính thức, không chạy code challenge và không chứng minh khả năng giải.');
    }
    return DatasetProfile.parse(result);
  } finally {
    clearTimeout(timeout); connection?.closeSync(); instance?.closeSync();
    // Only remove the exact temporary directory created by this invocation.
    await rm(directory, { recursive: true, force: true });
  }
}
