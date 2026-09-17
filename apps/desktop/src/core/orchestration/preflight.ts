import type { Task, Source } from '../../shared/contracts';
import type { ProfileRecord } from '../../shared/profiles';
import type { PreflightRecord, PreflightPolicy } from '../../shared/preflight';
import { Store, id, now } from '../storage/database';
import { Sources } from '../tools/sources';

export class PreflightError extends Error {}
export function preflightScope(record: Pick<PreflightRecord, 'policy' | 'sourceHashes' | 'excludedSourceCount'>): string {
  return JSON.stringify([record.policy.idColumn, record.policy.compareTwo, Object.entries(record.sourceHashes).sort(([a], [b]) => a.localeCompare(b)), record.excludedSourceCount ?? 0]);
}

export class Preflight {
  constructor(private store: Store, private sources: Sources, private notify: () => void) {}
  async run(task: Task, policy: PreflightPolicy, signal: AbortSignal, paused: () => boolean): Promise<PreflightRecord> {
    const manifest = task.sourceIds.map(sourceId => this.store.get<Source>('sources', sourceId));
    const sourceHashes = Object.fromEntries(manifest.map(source => [source.id, source.hash]));
    const excludedSourceCount = task.excludedSources?.length ?? 0;
    const scope = preflightScope({ policy, sourceHashes, excludedSourceCount });
    let record = this.store.all<PreflightRecord>('preflights').find(item => item.taskId === task.id && preflightScope(item) === scope);
    if (!record) {
      record = { id: id(), taskId: task.id, createdAt: now(), policy, excludedSourceCount, status: 'running', sourceHashes, profileIds: [], notices: [] };
    }
    const finalized = ['complete', 'partial', 'insufficient_evidence'].includes(record.status);
    const save = () => { record!.notices = [...new Map(record!.notices.map(notice => [JSON.stringify(notice), notice])).values()]; this.store.put('preflights', record!, { column: 'task_id', value: task.id }); this.notify(); };
    try {
      // Cached checker results never bypass a fresh permission/hash check.
      for (const source of manifest) { signal.throwIfAborted(); await this.sources.verify(source.id, task.sourceIds); }
      if (['complete', 'partial', 'insufficient_evidence'].includes(record.status)) return record;
      record.status = 'running'; record.notices = []; save();
      const profiles = () => record!.profileIds.map(profileId => this.store.get<ProfileRecord>('profiles', profileId));
      const datasets = manifest.filter(source => source.format);
      const check = async (sourceIds: string[], idColumn: string | null) => {
        const profileId = id();
        try {
          await this.sources.profile(sourceIds, task.sourceIds, idColumn, signal, { id: profileId, taskId: task.id });
          record!.profileIds.push(profileId); save();
        } catch (error) {
          if (signal.aborted) throw error;
          record!.notices.push({ ...(sourceIds.length === 1 ? { sourceId: sourceIds[0] } : {}), message: sourceIds.length === 1 ? 'Không hoàn tất checker cho nguồn này. Kiểm tra định dạng, tên cột ID và giới hạn tài nguyên.' : 'Chưa đối chiếu được hai dataset. Không suy ra ID/schema khớp.' }); save();
        }
      };
      for (const source of datasets) {
        signal.throwIfAborted();
        if (paused()) { record.status = 'paused'; save(); return record; }
        if (profiles().some(profile => profile.result.datasets.some(dataset => dataset.sourceId === source.id))) continue;
        await check([source.id], policy.idColumn);
      }
      signal.throwIfAborted();
      if (paused()) { record.status = 'paused'; save(); return record; }
      if (policy.compareTwo && datasets.length === 2 && !profiles().some(profile => profile.result.datasets.length === 2)) await check(datasets.map(source => source.id), policy.idColumn);
      else if (policy.compareTwo && datasets.length !== 2) record.notices.push({ message: 'Chỉ đối chiếu cặp khi task có đúng hai dataset. Chưa xác định cặp submission/answers hoặc train/test.' });
      for (const source of manifest.filter(source => !source.format)) record.notices.push({ sourceId: source.id, message: 'Nguồn này chưa có checker dữ liệu tương ứng; role chỉ có thể đọc như văn bản. Không chạy code hoặc xác nhận scoring từ việc đọc tệp.' });
      record.notices.push({ message: 'Các phép đếm/schema/ID không chứng minh metric đúng, không có leakage, GPU relevance hoặc độ ổn định khi rerun. Những phần này cần bằng chứng riêng.' });
      if (task.excludedSources?.length) record.notices.push({ message: `${task.excludedSources.length} mục đã bị loại khi nhập nguồn. Không xem đây là review toàn bộ thư mục; xem danh sách loại trừ trên máy.` });
      if (!policy.idColumn) record.notices.push({ message: 'Chưa cấu hình cột ID: không đánh giá trùng ID, giao ID hoặc thứ tự ID.' });
      for (const source of manifest) { signal.throwIfAborted(); await this.sources.verify(source.id, task.sourceIds); }
      record.status = !datasets.length ? 'insufficient_evidence' : profiles().filter(profile => profile.result.datasets.length === 1).length < datasets.length || (policy.compareTwo && !profiles().some(profile => profile.result.datasets.length === 2)) ? 'partial' : 'complete';
      save(); return record;
    } catch (error) {
      if (!finalized) {
        record.status = signal.aborted ? 'cancelled' : 'failed';
        record.notices.push({ message: signal.aborted ? 'Đã hủy preflight. Chưa bắt đầu các role.' : 'Không xác minh được quyền đọc hoặc checksum nguồn. Chọn lại nguồn trong task mới.' }); save();
      }
      throw new PreflightError(signal.aborted ? 'Đã hủy preflight.' : 'Không xác minh được nguồn cho preflight. Chọn lại nguồn trong task mới.', { cause: error });
    }
  }
}
