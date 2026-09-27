import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, rename, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

/** One file of the model: where it comes from and what it must be, pinned in the app. */
export type PinnedFile = { name: string; url: string; sha256: string; bytes: number };

export type Fetcher = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>;

/** A download that stalls this long without a byte is given up, so a dead connection does not hang forever. */
export const STALL_MS = 30_000;

export class DownloadMismatch extends Error {}

async function sizeOf(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

export async function sha256OfFile(path: string): Promise<string> {
  const digest = createHash('sha256');
  await pipeline(createReadStream(path), digest);
  return digest.digest('hex');
}

/** Whether a finished file on disk is exactly the pinned one. */
export async function isVerified(path: string, file: PinnedFile): Promise<boolean> {
  if (await sizeOf(path) !== file.bytes) return false;
  return (await sha256OfFile(path)) === file.sha256;
}

/**
 * Downloads one pinned file to `target`. Bytes go to `target.part` first; a part left by a cut connection is resumed
 * with an HTTP range request, or started again when the server sends the whole file instead. The finished part is
 * checked against the pinned size and SHA-256 and only then renamed into place, so `target` never holds anything else.
 * A mismatch deletes the part, since resuming it would only reproduce the mismatch.
 */
export async function downloadFile(file: PinnedFile, target: string, options: { fetch: Fetcher; signal: AbortSignal; onBytes: (bytesOnDisk: number) => void; stallMs?: number }): Promise<void> {
  const part = `${target}.part`;
  let offset = await sizeOf(part);
  if (offset > file.bytes) {
    await rm(part, { force: true });
    offset = 0;
  }
  if (offset < file.bytes) {
    const stall = new AbortController();
    const abort = () => stall.abort(options.signal.reason);
    options.signal.addEventListener('abort', abort, { once: true });
    let stallTimer = setTimeout(() => stall.abort(new Error('stalled')), options.stallMs ?? STALL_MS);
    const touch = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => stall.abort(new Error('stalled')), options.stallMs ?? STALL_MS);
    };
    try {
      const headers: Record<string, string> = offset > 0 ? { Range: `bytes=${offset}-` } : {};
      const response = await options.fetch(file.url, { headers, signal: stall.signal });
      if (response.status === 200) offset = 0;
      else if (response.status !== 206) throw new Error(`Máy chủ trả về ${response.status}.`);
      if (!response.body) throw new Error('Máy chủ không gửi dữ liệu.');
      let written = offset;
      options.onBytes(written);
      // Each chunk is on disk before the next is read, so a cut connection keeps every byte that arrived.
      const handle = await open(part, offset > 0 ? 'a' : 'w');
      try {
        for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
          if (written + chunk.length > file.bytes) throw new DownloadMismatch('Tệp tải về lớn hơn tệp đã ghim.');
          await handle.write(chunk);
          written += chunk.length;
          touch();
          options.onBytes(written);
        }
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (error instanceof DownloadMismatch) await rm(part, { force: true });
      if (options.signal.aborted) throw options.signal.reason instanceof Error ? options.signal.reason : new Error('Đã hủy tải.');
      if (stall.signal.aborted && !options.signal.aborted) throw new Error('Kết nối bị ngắt giữa chừng.');
      throw error;
    } finally {
      clearTimeout(stallTimer);
      options.signal.removeEventListener('abort', abort);
    }
  }
  if (await sizeOf(part) !== file.bytes) throw new Error('Kết nối bị ngắt giữa chừng.');
  if ((await sha256OfFile(part)) !== file.sha256) {
    await rm(part, { force: true });
    throw new DownloadMismatch('Tệp tải về không khớp với bản đã ghim, nên đã bị xóa.');
  }
  await rename(part, target);
}
