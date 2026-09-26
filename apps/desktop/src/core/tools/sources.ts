import { open, realpath, lstat, opendir, type FileHandle } from 'node:fs/promises';
import { basename, dirname, resolve, extname, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { Store, id, now } from '../storage/database';
import type { Source, FolderIntake, SourceBytes, SourceOrigin } from '../../shared/contracts';
import { DATASET_SOURCE_LIMIT, INLINE_PREVIEW_LIMIT, MEDIA_SOURCE_EXTENSIONS, MEDIA_SOURCE_LIMITS, TEXT_SOURCE_EXTENSIONS, TEXT_SOURCE_LIMIT, imageSendable, mediaKindOf, mediaMimeType, type ImageWithheld, type MediaKind } from '../../shared/source-kinds';
import { DataFormat, type ExactMatchRequest, type ProfileExecutor, type DatasetProfile, type ProfileInput } from '../../shared/profiles';
import { ViewableImageMime, type ImageRef } from '../../shared/images';
import { pdfTextForWorker, type PdfPages, type PdfText, type PdfTextExtractor } from './pdf-text';
import { extractPdfPagesHere } from './pdf-extract';

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

/** The limit a file is held to, the reason given when it is over, and what the file is. */
export type SourceLimit = { kind: 'text' | 'dataset' | 'media'; limit: number; overLimit: string; format?: DataFormat; media?: MediaKind };

const MEDIA_OVER_LIMIT: Record<MediaKind, string> = {
  image: 'Ảnh vượt 20 MB.',
  audio: 'Tệp âm thanh vượt 50 MB.',
  video: 'Video vượt 200 MB.',
  pdf: 'PDF vượt 200 MB.',
};
const MEDIA_LABEL: Record<MediaKind, string> = { image: 'ảnh', video: 'tệp video', audio: 'tệp âm thanh', pdf: 'tệp PDF' };

export function limitFor(name: string): SourceLimit {
  const format = DataFormat.safeParse(extname(name).slice(1).toLowerCase());
  if (format.success) return { kind: 'dataset', limit: DATASET_SOURCE_LIMIT, overLimit: 'Dataset vượt 32 MB.', format: format.data };
  const media = mediaKindOf(name);
  if (media) return { kind: 'media', limit: MEDIA_SOURCE_LIMITS[media], overLimit: MEDIA_OVER_LIMIT[media], media };
  return { kind: 'text', limit: TEXT_SOURCE_LIMIT, overLimit: 'Chỉ đọc tệp văn bản tối đa 256 KB.' };
}

/** What a worker is told when it asks for a media source as text: the file exists, and it has no text to give. */
export function unreadableSourceMessage(source: Source): string {
  if (source.media === 'image') return `Nguồn ${source.name} là ảnh nên không có văn bản để đọc.`;
  return `Nguồn ${source.name} là ${MEDIA_LABEL[source.media ?? 'image']}. Tí chưa đọc được loại tệp này; chỉ xem được trong Nguồn của cuộc trò chuyện.`;
}

/** The activity line when an image is not shown to the worker, and why. */
export function imageWithheldMessage(name: string, reason: ImageWithheld): string {
  if (reason === 'connection') return `Tí không xem được ảnh ${name}: kết nối này không nhận ảnh.`;
  if (reason === 'format') return `Tí không xem được ảnh ${name}: model không nhận loại ảnh này (SVG, BMP).`;
  return `Tí không xem được ảnh ${name}: ảnh vượt 5 MB, mức lớn nhất gửi cho model.`;
}

type ReadMode = 'buffer' | 'hash';
type FileRead = { bytes?: Buffer; hash: string; size: number };

/** Parsed PDFs kept by hash, so a second read of the same file skips pdf.js; the file is still read and checked each time. */
const PDF_PAGES_KEPT = 16;

export class Sources {
  private checks = new Map<string, Set<AbortController>>();
  private pdfPages = new Map<string, PdfPages>();
  constructor(private store: Store, private executor?: ProfileExecutor, private pdfText: PdfTextExtractor = extractPdfPagesHere) {}
  /**
   * Reads a file within `rule.limit` while making sure it is a plain file that nobody swaps under us. `hash` mode
   * streams the digest without keeping the bytes, so a 200 MB video is fingerprinted without 200 MB of memory.
   */
  private async readFile(path: string, rule: SourceLimit, mode: ReadMode): Promise<FileRead> {
    if (await hasLinkInPath(path)) throw new Error('Không hỗ trợ symlink hoặc junction. Chọn tệp gốc.');
    const canonical = await realpath(path);
    const before = await lstat(path);
    const file = await open(path, 'r');
    try {
      const stat = await file.stat();
      if (stat.dev !== before.dev || stat.ino !== before.ino) throw new Error('Tệp bị thay thế trong lúc mở. Chọn lại nguồn.');
      if (!stat.isFile() || stat.size > rule.limit) throw new Error(rule.overLimit);
      const result = mode === 'buffer' ? await this.readWhole(file, stat.size, rule.limit) : await this.hashWhole(file, stat.size, rule.limit);
      if ((await realpath(path)).toLowerCase() !== canonical.toLowerCase()) throw new Error('Đường dẫn thay đổi trong lúc đọc.');
      const after = await lstat(path);
      if (after.dev !== stat.dev || after.ino !== stat.ino || after.isSymbolicLink()) throw new Error('Tệp bị thay thế trong lúc đọc.');
      if (result.bytes && rule.kind !== 'media' && rule.format !== 'parquet') {
        if (result.bytes.includes(0)) throw new Error('Định dạng nhị phân chưa được hỗ trợ.');
        new TextDecoder('utf-8', { fatal: true }).decode(result.bytes);
      }
      return result;
    } finally { await file.close(); }
  }
  private async readWhole(file: FileHandle, size: number, limit: number): Promise<FileRead> {
    const buffer = Buffer.alloc(Math.min(size + 1, limit + 1));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > limit || bytesRead !== size) throw new Error('Tệp vượt giới hạn hoặc thay đổi trong lúc đọc.');
    const bytes = buffer.subarray(0, bytesRead);
    return { bytes, hash: fingerprint(bytes), size: bytesRead };
  }
  private async hashWhole(file: FileHandle, size: number, limit: number): Promise<FileRead> {
    const digest = createHash('sha256');
    const chunk = Buffer.alloc(1024 * 1024);
    let total = 0;
    while (true) {
      const { bytesRead } = await file.read(chunk, 0, chunk.length, total);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > limit || total > size) throw new Error('Tệp vượt giới hạn hoặc thay đổi trong lúc đọc.');
      digest.update(chunk.subarray(0, bytesRead));
    }
    if (total !== size) throw new Error('Tệp vượt giới hạn hoặc thay đổi trong lúc đọc.');
    return { hash: digest.digest('hex'), size: total };
  }
  async import(paths: string[]): Promise<Source[]> {
    if (paths.length > 20) throw new Error('Chọn tối đa 20 tệp.');
    const imported: { source: Source; path: string }[] = [];
    for (const path of paths) {
      const rule = limitFor(path);
      // Media is only fingerprinted here; its bytes are read again, and checked again, when previewed.
      const read = await this.readFile(path, rule, rule.kind === 'media' ? 'hash' : 'buffer');
      const source: Source = { id: id(), name: basename(path), bytes: read.size, hash: read.hash, revoked: false };
      if (rule.format) source.format = rule.format;
      if (rule.media) source.media = rule.media;
      imported.push({ path: resolve(path), source });
    }
    this.store.transaction(() => { for (const { path, source } of imported) this.store.put('sources', source, { column: 'path', value: path }); });
    return imported.map(row => row.source);
  }
  async importFolder(root: string): Promise<FolderIntake> {
    if (await hasLinkInPath(root)) throw new Error('Không hỗ trợ thư mục symlink hoặc junction.');
    const result: FolderIntake = { sources: [], skipped: [] };
    const supported = new Set([...TEXT_SOURCE_EXTENSIONS, ...MEDIA_SOURCE_EXTENSIONS].map(extension => `.${extension}`));
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
  /**
   * Text of a source for a worker or a preview. A PDF gives its text layer with page markers (COD-260); images, video
   * and audio are refused by name, never read as text.
   */
  async read(sourceId: string, allowedIds: string[]): Promise<string> {
    if (!allowedIds.includes(sourceId)) throw new Error('Không có quyền đọc nguồn ngoài task này.');
    const source = this.store.get<Source>('sources', sourceId);
    if (source.format === 'parquet') throw new Error('Dùng profile_dataset để đọc Parquet.');
    if (source.media === 'pdf') return (await this.readPdf(sourceId, allowedIds)).text;
    if (source.media) throw new Error(unreadableSourceMessage(source));
    const read = await this.readChecked(sourceId, allowedIds, 'buffer');
    return read.bytes!.toString('utf8');
  }
  /**
   * A PDF's text layer, read locally with pdf.js from bytes that passed the permission, revoke and hash checks, and cut
   * to the text source limit. A PDF read before is not parsed again, but its file is still read and checked.
   */
  async readPdf(sourceId: string, allowedIds: string[], signal?: AbortSignal): Promise<PdfText> {
    const source = this.store.get<Source>('sources', sourceId);
    if (source.media !== 'pdf') throw new Error(`Nguồn ${source.name} không phải PDF.`);
    const read = await this.readChecked(sourceId, allowedIds, 'buffer');
    let pages = this.pdfPages.get(read.hash);
    if (!pages) {
      pages = await this.pdfText(new Uint8Array(read.bytes!.buffer, read.bytes!.byteOffset, read.bytes!.length), signal);
      this.keepPdfPages(read.hash, pages);
    }
    // Revocation can arrive while the text is being read.
    if (this.store.get<Source>('sources', sourceId).revoked) throw new Error('Quyền đọc nguồn đã bị thu hồi.');
    return pdfTextForWorker(pages);
  }
  private keepPdfPages(hash: string, pages: PdfPages) {
    this.pdfPages.set(hash, pages);
    if (this.pdfPages.size <= PDF_PAGES_KEPT) return;
    const oldest = this.pdfPages.keys().next().value;
    if (oldest !== undefined) this.pdfPages.delete(oldest);
  }
  /**
   * A permitted image that may go to a model, with its bytes checked against the attached hash: a type models take and
   * no larger than the send limit. The caller decides whether the connection can see images at all.
   */
  async readImage(sourceId: string, allowedIds: string[]): Promise<{ bytes: Buffer; image: ImageRef }> {
    if (!allowedIds.includes(sourceId)) throw new Error('Không có quyền đọc nguồn ngoài task này.');
    const source = this.store.get<Source>('sources', sourceId);
    if (source.media !== 'image') throw new Error(`Nguồn ${source.name} không phải ảnh.`);
    const withheld = imageSendable(source);
    if (withheld) throw new Error(imageWithheldMessage(source.name, withheld));
    const read = await this.readChecked(sourceId, allowedIds, 'buffer');
    return { bytes: read.bytes!, image: { hash: read.hash, mime: ViewableImageMime.parse(mediaMimeType(source.name)) } };
  }
  /**
   * The base64 bytes of an image a message refers to by hash, for the request about to be sent. Only an unrevoked image
   * attached to this chat can answer, and its file is read and checked again every time.
   */
  async imageData(reference: ImageRef, allowedIds: string[]): Promise<string> {
    const source = allowedIds
      .map(sourceId => this.store.get<Source>('sources', sourceId))
      .find(candidate => candidate.media === 'image' && candidate.hash === reference.hash && !candidate.revoked);
    if (!source) throw new Error('Ảnh đã gửi cho Tí không còn trong nguồn được phép của chat này.');
    const { bytes } = await this.readImage(source.id, allowedIds);
    return bytes.toString('base64');
  }
  /** Confirms the file is still there, unchanged and permitted, without keeping its bytes. */
  async verify(sourceId: string, allowedIds: string[]) { await this.readChecked(sourceId, allowedIds, 'hash'); }
  /**
   * A forwarded file the person chose to send along (COD-257): the same file on disk attached again as a new source,
   * the way picking it would attach it, after checking it is still there, unchanged and readable by the chat it came
   * from. The copy has its own id, so the target chat can revoke it without touching the original chat, and the
   * reverse.
   */
  async copyFor(sourceId: string, allowedIds: string[]): Promise<Source> {
    await this.readChecked(sourceId, allowedIds, 'hash');
    const original = this.store.get<Source>('sources', sourceId);
    const path = this.storedPath(sourceId);
    if (!path) throw new Error(`Không còn tệp nguồn ${original.name} ở chỗ cũ.`);
    const copy: Source = { ...original, id: id(), revoked: false };
    this.store.put('sources', copy, { column: 'path', value: path });
    return copy;
  }
  /** Exact permitted, hash-checked bytes, for handing a snapshot copy to a local harness. Never media. */
  async readVerified(sourceId: string, allowedIds: string[]): Promise<Buffer> {
    const source = this.store.get<Source>('sources', sourceId);
    if (source.media) throw new Error(unreadableSourceMessage(source));
    const read = await this.readChecked(sourceId, allowedIds, 'buffer');
    return read.bytes!;
  }
  /** Bytes of a media source for the person to look at, behind the same permission, revoke and hash gate. */
  async readPreview(sourceId: string, allowedIds: string[]): Promise<SourceBytes> {
    if (!allowedIds.includes(sourceId)) throw new Error('Không có quyền đọc nguồn ngoài task này.');
    const source = this.store.get<Source>('sources', sourceId);
    if (!source.media) throw new Error('Nguồn này là văn bản; dùng previewSource.');
    if (source.bytes > INLINE_PREVIEW_LIMIT) throw new Error('Tệp vượt 64 MB nên không xem trực tiếp trong Orglet được. Mở bằng ứng dụng mặc định.');
    const read = await this.readChecked(sourceId, allowedIds, 'buffer');
    const bytes = read.bytes!;
    return { name: source.name, mimeType: mediaMimeType(source.name), bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length) };
  }
  /** The stored path of a permitted, unrevoked source, for the main process to hand to the default app. */
  pathOf(sourceId: string, allowedIds: string[]): string {
    if (!allowedIds.includes(sourceId)) throw new Error('Không có quyền đọc nguồn ngoài task này.');
    const source = this.store.get<Source>('sources', sourceId);
    if (source.revoked) throw new Error('Quyền đọc nguồn đã bị thu hồi.');
    const path = this.storedPath(sourceId);
    if (!path) throw new Error(`Không còn tệp nguồn ${source.name} ở chỗ cũ.`);
    return path;
  }
  /** Where each source was picked from; null for one restored from a backup. Shown to the person, never to a model. */
  origins(sourceIds: string[]): SourceOrigin[] {
    return sourceIds.map(sourceId => ({ id: sourceId, path: this.storedPath(sourceId) }));
  }
  private storedPath(sourceId: string): string | null {
    const row = this.store.db.prepare('SELECT path FROM sources WHERE id=?').get(sourceId);
    if (!row || !row.path) return null;
    return String(row.path);
  }
  private async readChecked(sourceId: string, allowedIds: string[], mode: ReadMode): Promise<FileRead> {
    if (!allowedIds.includes(sourceId)) throw new Error('Không có quyền đọc nguồn ngoài task này.');
    const source = this.store.get<Source>('sources', sourceId);
    if (source.revoked) throw new Error('Quyền đọc nguồn đã bị thu hồi.');
    const row = this.store.db.prepare('SELECT path FROM sources WHERE id=?').get(sourceId)!;
    const read = await this.readFile(String(row.path), limitFor(source.name), mode).catch((error: unknown) => {
      // The file lived on disk when it was attached; saying which one is gone is more use than the system error.
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') throw new Error(`Không còn tệp nguồn ${source.name} ở chỗ cũ. Tệp có thể đã bị đổi tên, di chuyển hoặc xóa. Đính kèm lại tệp, hoặc mở Nguồn của cuộc trò chuyện và Thu hồi quyền đọc để tiếp tục mà không có tệp này.`);
      throw error;
    });
    // Recheck after IO: revocation can arrive while the file is being read.
    if (this.store.get<Source>('sources', sourceId).revoked) throw new Error('Quyền đọc nguồn đã bị thu hồi.');
    if (read.hash !== source.hash) throw new Error('Nguồn đã thay đổi. Chọn lại tệp để tạo manifest mới.');
    return read;
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
      const read = await this.readChecked(sourceId, allowedIds, 'buffer');
      files.push({ sourceId, format, base64: read.bytes!.toString('base64') });
    }
    signal?.throwIfAborted();
    const result = await this.executor({ files, idColumn, ...(runAudit ? { runAudit } : {}), ...(exactMatch ? { exactMatch } : {}) }, signal);
    signal?.throwIfAborted();
    for (const sourceId of sourceIds) if (this.store.get<Source>('sources', sourceId).revoked) throw new Error('Quyền đọc nguồn đã bị thu hồi.');
    if (owner) this.store.put('profiles', { id: id(), ...owner, createdAt: now(), sourceHashes: Object.fromEntries(sourceIds.map(sourceId => [sourceId, this.store.get<Source>('sources', sourceId).hash])), result }, { column: 'task_id', value: owner.taskId });
    return result;
  }
}
