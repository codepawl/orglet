import { z } from 'zod';
import { RunAudit, type ScoreDirection } from '../shared/run-audit';

export class RunAuditInputError extends Error {}

const Label = z.string().trim().min(1).max(128);
const Row = z.object({ solution: Label, run: Label, split: Label, metric: Label, status: z.enum(['completed', 'failed', 'cancelled']), score: z.unknown(), error_code: z.string().max(128).nullable().optional() });
function score(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim()))) throw new RunAuditInputError('Score phải là số thập phân hữu hạn hoặc null.');
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > 1e100) throw new RunAuditInputError('Score không hữu hạn hoặc vượt giới hạn 1e100.');
  return number;
}

export function auditRuns(raw: unknown[], sourceId: string, direction: z.infer<typeof ScoreDirection>): RunAudit {
  if (!raw.length || raw.length > 10000) throw new RunAuditInputError('Run-log cần từ 1 đến 10.000 dòng.');
  const rows = raw.map((value, index) => {
    const parsed = Row.safeParse(value);
    if (!parsed.success) throw new RunAuditInputError(`Run-log dòng ${index + 1}: cần solution, run, split, metric dạng text và status completed/failed/cancelled.`);
    const result = { ...parsed.data, score: score(parsed.data.score) };
    if (result.status === 'completed' && result.score === null) throw new RunAuditInputError(`Run-log dòng ${index + 1}: completed cần score hợp lệ.`);
    return result;
  });
  const metric = rows[0].metric;
  if (rows.some(row => row.metric !== metric)) throw new RunAuditInputError('Run-log có nhiều metric. Tách mỗi metric thành một tệp.');
  const identities = new Set<string>();
  const groups = new Map<string, typeof rows>();
  const failureCodes = new Map<string, number>();
  for (const row of rows) {
    const identity = JSON.stringify([row.solution, row.run, row.split]);
    if (identities.has(identity)) throw new RunAuditInputError('Trùng solution/run/split: không thể xác định số lần chạy độc lập.');
    identities.add(identity);
    const key = JSON.stringify([row.solution, row.split]);
    const group = groups.get(key) ?? []; group.push(row); groups.set(key, group);
    if (row.status !== 'completed') {
      const code = row.error_code?.trim() || row.status;
      failureCodes.set(code, (failureCodes.get(code) ?? 0) + 1);
    }
  }
  if (groups.size > 200 || new Set(rows.map(row => row.solution)).size > 100 || failureCodes.size > 200) throw new RunAuditInputError('Run-log vượt 100 solutions, 200 nhóm solution/split hoặc 200 mã lỗi.');
  const result: RunAudit = {
    version: 'orglet-run-audit-v1', sourceId, metric, direction, status: 'observations', rows: rows.length,
    completed: rows.filter(row => row.status === 'completed').length,
    failed: rows.filter(row => row.status === 'failed').length,
    cancelled: rows.filter(row => row.status === 'cancelled').length,
    ignoredFailureScores: rows.filter(row => row.status !== 'completed' && row.score !== null).length,
    groups: [], failures: [...failureCodes].map(([code, count]) => ({ code, count })), ranks: null,
    notices: ['Chỉ phân tích run-log đã cung cấp; không chạy lại solution hoặc metric và không xác minh tính độc lập của các lần chạy.', 'Độ lệch chuẩn mẫu tính trong cùng solution/split. Khác biệt giữa các solutions không phải nhiễu rerun.', 'Thay đổi thứ hạng không tự chứng minh challenge hỏng, leakage hoặc cheating. Không có ngưỡng PASS tự động.'],
  };
  for (const group of groups.values()) {
    const values = group.filter(row => row.status === 'completed').map(row => row.score!);
    // Welford avoids cancellation when repeat scores are close to their common mean.
    let mean = 0; let m2 = 0;
    values.forEach((value, index) => { const delta = value - mean; mean += delta / (index + 1); m2 += delta * (value - mean); });
    result.groups.push({ solution: group[0].solution, split: group[0].split, total: group.length, completed: values.length, failed: group.filter(row => row.status === 'failed').length, cancelled: group.filter(row => row.status === 'cancelled').length,
      mean: values.length ? mean : null, minimum: values.length ? Math.min(...values) : null, maximum: values.length ? Math.max(...values) : null, sampleStdDev: values.length >= 2 ? Math.sqrt(Math.max(0, m2 / (values.length - 1))) : null });
  }
  if (result.groups.some(group => group.completed < 2)) {
    result.status = 'insufficient_evidence'; result.notices.push('Ít nhất một nhóm có dưới hai lần completed; chưa đủ để ước lượng biến thiên rerun cho nhóm đó.');
  }
  if (result.failed || result.cancelled) {
    if (result.status !== 'insufficient_evidence') result.status = 'needs_review';
    result.notices.push('Có lần failed/cancelled cần xem lại logs. Score của các lần này bị loại khỏi thống kê điểm, không quy đổi thành 0.');
  }
  const publicGroups = result.groups.filter(group => group.split === 'public');
  const privateGroups = result.groups.filter(group => group.split === 'private');
  const comparable = publicGroups.length >= 2 && publicGroups.length === privateGroups.length && publicGroups.every(group => group.mean !== null && privateGroups.some(other => other.solution === group.solution && other.mean !== null));
  if (comparable) {
    const rank = (groups: RunAudit['groups'], group: RunAudit['groups'][number]) => 1 + groups.filter(other => direction === 'higher' ? other.mean! > group.mean! : other.mean! < group.mean!).length;
    result.ranks = publicGroups.map(group => { const publicRank = rank(publicGroups, group); const privateRank = rank(privateGroups, privateGroups.find(other => other.solution === group.solution)!); return { solution: group.solution, publicRank, privateRank, improvement: publicRank - privateRank }; });
    result.notices.push('Thứ hạng dùng trung bình các lần completed, cùng tập solution ở public/private; điểm bằng nhau cùng hạng và bỏ bậc kế tiếp. Số lần chạy và failure có thể khác giữa các nhóm.');
  } else result.notices.push('Chưa so sánh rank: cần ít nhất hai solutions, cùng tập ở public/private và mỗi nhóm có điểm completed.');
  return RunAudit.parse(result);
}
