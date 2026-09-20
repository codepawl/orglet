import { open, realpath, lstat, opendir } from 'node:fs/promises';
import { basename, dirname, resolve, extname, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { Store, id, now } from '../storage/database';
import type { Source, FolderIntake } from '../../shared/contracts';
import { DataFormat, type ExactMatchRequest, type ProfileExecutor, type DatasetProfile, type ProfileInput } from '../../shared/profiles';

const MAX_BYTES = 256 * 1024;
export const fingerprint = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');

/**
 * True when the path, or any folder above it, is a symlink or junction. This checks each part of the path instead of
 * comparing it with realpath(), because realpath() also expands Windows short names such as C:UsersRUNNER~1, which
 * made ordinary files look like links.
 *
 * macOS maps /var, /tmp and /etc to /private/* with system symlinks. Those aliases are not user links; skipping them
 * is required so files under os.tmpdir() (/var/folders/...) can be imported on a Mac.
 */
const DARWIN_SYSTEM_ALIASES = new Set(['/var', '/tmp', '/etc']);

export async function hasLinkInPath(path: string): Promise<boolean> {
  let current = resolve(path);
  while (true) {
    const status = await lstat(current);
    if (status.isSymbolicLink() && !(process.platform === 'darwin' && DARWIN_SYSTEM_ALIASES.has(current))) return true;
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}
export class Sources {
  private checks = new Map<string, Set<AbortController>>();
  constructor(private store: Store, private executor?: ProfileExecutor) {}
  private async bytes(path: string, dataset = false): Promise<Buffer> {
    const limit = dataset ? 32 * 1024 * 1024 : MAX_BYTES;
    if (await hasLinkInPath(path)) throw new Error('Không hỗ trợ symlink hoặc junction. Chọn tệp gốc.');
    const canonical = await realpath(path);
    const before = await lstat(path);
    const file = await open(path, 'r');
    try {
      const stat = await file.stat();
      if (stat.dev !== before.dev || stat.ino !== before.ino) throw new Error('Tệp bị thay thế trong lúc mở. Chọn lại nguồn.');
      if (!stat.isFile() || stat.size > limit) throw new Error(dataset ? 'Dataset vượt 32 MB.' : 'Chỉ đọc tệp văn bản tối đa 256 KB.');
      const buffer = Buffer.alloc(Math.min(stat.size + 1, limit + 1));
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead > limit || bytesRead !== stat.size) throw new Error('Tệp vượt giới hạn hoặc thay đổi trong lúc đọc.');
      if ((await realpath(path)).toLowerCase() !== canonical.toLowerCase()) throw new Error('Đường dẫn thay đổi trong lúc đọc.');
      const after = await lstat(path);
      if (after.dev !== stat.dev || after.ino !== stat.ino || after.isSymbolicLink()) throw new Error('Tệp bị thay thế trong lúc đọc.');
      const data = buffer.subarray(0, bytesRead);
      if (extname(path).toLowerCase() !== '.parquet') {
        if (data.includes(0)) throw new Error('Định dạng nhị phân chưa được hỗ trợ.');
        new TextDecoder('utf-8', { fatal: true }).decode(data);
      }
      return data;
    } finally { await file.close(); }
  }
  async import(paths: string[]): Promise<Source[]> {
    if (paths.length > 20) throw new Error('Chọn tối đa 20 tệp.');
    const imported: { source: Source; path: string }[] = [];
    for (const path of paths) {
      const format = DataFormat.safeParse(extname(path).slice(1).toLowerCase());
      const data = await this.bytes(path, format.success);
      imported.push({ path: resolve(path), source: { id: id(), name: basename(path), bytes: data.length, hash: fingerprint(data), revoked: false, ...(format.success ? { format: format.data } : {}) } });
    }
    this.store.transaction(() => { for (const { path, source } of imported) this.store.put('sources', source, { column: 'path', value: path }); });
    return imported.map(row => row.source);
  }
  async importFolder(root: string): Promise<FolderIntake> {
    if (await hasLinkInPath(root)) throw new Error('Không hỗ trợ thư mục symlink hoặc junction.');
    const result: FolderIntake = { sources: [], skipped: [] };
    const supported = new Set(['.md', '.txt', '.json', '.jsonl', '.csv', '.parquet', '.ts', '.js', '.py', '.yaml', '.yml', '.log']);
    let entriesSeen = 0; let totalBytes = 0;
    const scan = async (directory: string, depth: number) => {
      if (depth > 8 || entriesSeen >= 1000) { result.skipped.push({ name: relative(root, directory) || '.', reason: 'Vượt giới hạn duyệt 8 cấp / 1.000 mục.' }); return; }
      // The folder above was already checked; this catches a folder swapped for a link after it was listed.
      const directoryStatus = await lstat(directory);
      if (directoryStatus.isSymbolicLink()) { result.skipped.push({ name: relative(root, directory), reason: 'Symlink/junction không được đọc.' }); return; }
      const entries = [];
      for await (const entry of await opendir(directory)) { entries.push(entry); if (entries.length > 1000 - entriesSeen) break; }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (++entriesSeen > 1000) { result.skipped.push({ name: relative(root, directory) || '.', reason: 'Các mục còn lại chưa được duyệt: giới hạn 1.000 mục.' }); return; }
        const path = join(directory, entry.name); const name = relative(root, path);
        if (entry.isSymbolicLink() || entry.name.startsWith('.') || ['node_modules', 'out', 'dist', '__pycache__'].includes(entry.name)) { result.skipped.push({ name, reason: 'Bỏ qua liên kết, mục ẩn hoặc thư mục sinh tự động.' }); continue; }
        if (entry.isDirectory()) { await scan(path, depth + 1); continue; }
        if (!entry.isFile() || !supported.has(extname(path).toLowerCase())) { result.skipped.push({ name, reason: 'Định dạng chưa được hỗ trợ.' }); continue; }
        if (result.sources.length >= 20) { result.skipped.push({ name, reason: 'Đã chọn đủ 20 tệp.' }); continue; }
        try {
          const size = (await lstat(path)).size;
          if (size + totalBytes > 64 * 1024 * 1024) { result.skipped.push({ name, reason: 'Tổng dữ liệu vượt 64 MB.' }); continue; }
          const [source] = await this.import([path]);
          source.name = name; this.store.update('sources', source);
          totalBytes += source.bytes; result.sources.push(source);
        } catch { result.skipped.push({ name, reason: 'Không đọc được, không đúng UTF-8 hoặc vượt giới hạn kích thước.' }); }
      }
    };
    await scan(root, 0); return result;
  }
  async read(sourceId: string, allowedIds: string[]): Promise<string> {
    if (!allowedIds.includes(sourceId)) throw new Error('Không có quyền đọc nguồn ngoài task này.');
    const source = this.store.get<Source>('sources', sourceId);
    if (source.format === 'parquet') throw new Error('Dùng profile_dataset để đọc Parquet.');
    return (await this.readBytes(sourceId, allowedIds, false)).toString('utf8');
  }
  async verify(sourceId: string, allowedIds: string[]) { await this.readBytes(sourceId, allowedIds, true); }
  /** Exact permitted, hash-checked bytes, for handing a snapshot copy to a local harness. */
  async readVerified(sourceId: string, allowedIds: string[]): Promise<Buffer> {
    return this.readBytes(sourceId, allowedIds, Boolean(this.store.get<Source>('sources', sourceId).format));
  }
  private async readBytes(sourceId: string, allowedIds: string[], dataset: boolean): Promise<Buffer> {
    if (!allowedIds.includes(sourceId)) throw new Error('Không có quyền đọc nguồn ngoài task này.');
    const source = this.store.get<Source>('sources', sourceId);
    if (source.revoked) throw new Error('Quyền đọc nguồn đã bị thu hồi.');
    const row = this.store.db.prepare('SELECT path FROM sources WHERE id=?').get(sourceId)!;
    const bytes = await this.bytes(String(row.path), dataset).catch((error: unknown) => {
      // The file lived on disk when it was attached; saying which one is gone is more use than the system error.
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') throw new Error(`Không còn tệp nguồn ${source.name} ở chỗ cũ. Tệp có thể đã bị đổi tên, di chuyển hoặc xóa. Đính kèm lại tệp, hoặc mở Nguồn của cuộc trò chuyện và Thu hồi quyền đọc để tiếp tục mà không có tệp này.`);
      throw error;
    });
    // Recheck after IO: revocation can arrive while the file is being read.
    if (this.store.get<Source>('sources', sourceId).revoked) throw new Error('Quyền đọc nguồn đã bị thu hồi.');
    if (fingerprint(bytes) !== source.hash) throw new Error('Nguồn đã thay đổi. Chọn lại tệp để tạo manifest mới.');
    return bytes;
  }
  async profile(sourceIds: string[], allowedIds: string[], idColumn: string | null, signal?: AbortSignal, owner?: { id?: string; taskId: string; runId?: string }, runAudit?: ProfileInput['runAudit'], exactMatch?: ExactMatchRequest): Promise<DatasetProfile> {
    const controller = new AbortController();
    if (owner) {
      const checks = this.checks.get(owner.taskId) ?? new Set<AbortController>();
      checks.add(controller); this.checks.set(owner.taskId, checks);
    }
    try { return await this.profileOnce(sourceIds, allowedIds, idColumn, signal ? AbortSignal.any([signal, controller.signal]) : controller.signal, owner, runAudit, exactMatch); }
    finally { if (owner) { this.checks.get(owner.taskId)?.delete(controller); if (!this.checks.get(owner.taskId)?.size) this.checks.delete(owner.taskId); } }
  }
  isChecking() { return this.checks.size > 0; }
  cancelChecks(taskId: string) { for (const controller of this.checks.get(taskId) ?? []) controller.abort(); }
  private async profileOnce(sourceIds: string[], allowedIds: string[], idColumn: string | null, signal?: AbortSignal, owner?: { id?: string; taskId: string; runId?: string }, runAudit?: ProfileInput['runAudit'], exactMatch?: ExactMatchRequest): Promise<DatasetProfile> {
    if (!this.executor) throw new Error('Checker chưa sẵn sàng.');
    const files = [];
    for (const sourceId of sourceIds) {
      signal?.throwIfAborted();
      if (!allowedIds.includes(sourceId)) throw new Error('Không có quyền đọc nguồn ngoài task này.');
      const source = this.store.get<Source>('sources', sourceId);
      const format = DataFormat.parse(source.format ?? extname(source.name).slice(1).toLowerCase());
      files.push({ sourceId, format, base64: (await this.readBytes(sourceId, allowedIds, true)).toString('base64') });
    }
    signal?.throwIfAborted();
    const result = await this.executor({ files, idColumn, ...(runAudit ? { runAudit } : {}), ...(exactMatch ? { exactMatch } : {}) }, signal);
    signal?.throwIfAborted();
    for (const sourceId of sourceIds) if (this.store.get<Source>('sources', sourceId).revoked) throw new Error('Quyền đọc nguồn đã bị thu hồi.');
    if (owner) this.store.put('profiles', { id: id(), ...owner, createdAt: now(), sourceHashes: Object.fromEntries(sourceIds.map(sourceId => [sourceId, this.store.get<Source>('sources', sourceId).hash])), result }, { column: 'task_id', value: owner.taskId });
    return result;
  }
}
