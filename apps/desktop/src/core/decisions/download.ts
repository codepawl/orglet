import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, type WriteStream } from 'node:fs';
import { rename, rm, stat } from 'node:fs/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { pipeline } from 'node:stream/promises';

/** One file of the model: where it comes from and what it must be, pinned in the app. */
export type PinnedFile = { name: string; url: string; sha256: string; bytes: number };

/**
 * Starts a GET and resolves with the final response once its headers arrive, after following redirects. `signal`
 * aborts it at any point, the body included.
 */
export type Getter = (url: string, headers: Record<string, string>, signal: AbortSignal) => Promise<IncomingMessage>;

/** A download that stalls this long without a byte is given up, so a dead connection does not hang forever. */
export const STALL_MS = 30_000;
/** Hugging Face answers with one redirect to its CDN; more than this is a loop. */
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
/**
 * How much of the download may wait in memory for the disk. Bytes are taken off the socket as they arrive and never
 * wait on a write, because bytes still inside the HTTP client when a connection is cut are thrown away with it (COD-303:
 * `fetch` lost everything it held, all of it on macOS, where the data and the cut arrive together). Only past this much
 * backlog does reading pause.
 */
const WRITE_BUFFER_BYTES = 8 * 1024 * 1024;

export class DownloadMismatch extends Error {}
class ConnectionCut extends Error {}

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

/** GET over node:http or node:https, following redirects; a redirect may never go from https down to http. */
export const httpGet: Getter = (url, headers, signal) => new Promise((resolve, reject) => {
  const follow = (address: URL, redirectsLeft: number) => {
    const send = address.protocol === 'https:' ? httpsRequest : address.protocol === 'http:' ? httpRequest : undefined;
    if (!send) {
      reject(new Error(`Không tải được từ ${address.protocol}`));
      return;
    }
    const request = send(address, { method: 'GET', headers, signal }, response => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (!REDIRECT_STATUSES.has(status) || !location) {
        resolve(response);
        return;
      }
      response.resume();
      const next = new URL(location, address);
      if (redirectsLeft <= 0) reject(new Error('Máy chủ chuyển hướng quá nhiều lần.'));
      else if (address.protocol === 'https:' && next.protocol !== 'https:') reject(new Error('Máy chủ chuyển sang kết nối không mã hóa.'));
      else follow(next, redirectsLeft - 1);
    });
    request.on('error', reject);
    request.end();
  };
  follow(new URL(url), MAX_REDIRECTS);
});

/** Ends the write stream and waits until the file is closed, so its size on disk is final. */
function closeWriter(writer: WriteStream): Promise<void> {
  return new Promise(resolve => {
    if (writer.closed) {
      resolve();
      return;
    }
    writer.once('close', () => resolve());
    writer.end();
  });
}

/**
 * Streams the body onto the end of the part file. Resolves once the whole body arrived and is on disk; rejects with
 * ConnectionCut when the connection ends early, and in every case only after the file is closed.
 */
function receiveBody(response: IncomingMessage, part: string, append: boolean, options: { expected: number; onBytes: (bytes: number) => void; touch: () => void }, alreadyOnDisk: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const writer = createWriteStream(part, { flags: append ? 'a' : 'w', highWaterMark: WRITE_BUFFER_BYTES });
    let received = alreadyOnDisk;
    let failure: Error | undefined;
    let settled = false;
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      failure = failure ?? error;
      if (failure) response.destroy();
      void closeWriter(writer).then(() => failure ? reject(failure) : resolve());
    };
    writer.on('error', error => settle(error));
    writer.on('drain', () => response.resume());
    response.on('data', (chunk: Buffer) => {
      if (settled) return;
      received += chunk.length;
      if (received > options.expected) {
        settle(new DownloadMismatch('Tệp tải về lớn hơn tệp đã ghim.'));
        return;
      }
      options.touch();
      options.onBytes(received);
      if (!writer.write(chunk)) response.pause();
    });
    response.on('end', () => settle(received === options.expected ? undefined : new ConnectionCut('Kết nối bị ngắt giữa chừng.')));
    response.on('aborted', () => settle(new ConnectionCut('Kết nối bị ngắt giữa chừng.')));
    response.on('error', error => settle(error));
    response.on('close', () => settle(response.complete ? undefined : new ConnectionCut('Kết nối bị ngắt giữa chừng.')));
  });
}

/**
 * Downloads one pinned file to `target`. Bytes go to `target.part` first; a part left by a cut connection is resumed
 * with an HTTP range request, or started again when the server sends the whole file instead. The finished part is
 * checked against the pinned size and SHA-256 and only then renamed into place, so `target` never holds anything else.
 * A mismatch deletes the part, since resuming it would only reproduce the mismatch.
 */
export async function downloadFile(file: PinnedFile, target: string, options: { get?: Getter; signal: AbortSignal; onBytes: (bytesOnDisk: number) => void; stallMs?: number }): Promise<void> {
  const part = `${target}.part`;
  let offset = await sizeOf(part);
  if (offset > file.bytes) {
    await rm(part, { force: true });
    offset = 0;
  }
  if (offset < file.bytes) {
    const stallMs = options.stallMs ?? STALL_MS;
    const stall = new AbortController();
    const abort = () => stall.abort(options.signal.reason);
    options.signal.addEventListener('abort', abort, { once: true });
    let stallTimer = setTimeout(() => stall.abort(new ConnectionCut('Kết nối bị ngắt giữa chừng.')), stallMs);
    const touch = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => stall.abort(new ConnectionCut('Kết nối bị ngắt giữa chừng.')), stallMs);
    };
    try {
      if (options.signal.aborted) throw options.signal.reason;
      const headers: Record<string, string> = offset > 0 ? { Range: `bytes=${offset}-` } : {};
      const response = await (options.get ?? httpGet)(file.url, headers, stall.signal);
      const status = response.statusCode ?? 0;
      let append = false;
      if (status === 206) {
        // A server that answers a range from somewhere else would splice two parts of the file together.
        const start = /^bytes (\d+)-/.exec(response.headers['content-range'] ?? '')?.[1];
        if (Number(start) !== offset) {
          response.destroy();
          throw new DownloadMismatch('Máy chủ gửi sai đoạn của tệp.');
        }
        append = true;
      } else if (status === 200) {
        offset = 0;
      } else {
        response.destroy();
        throw new Error(`Máy chủ trả về ${status}.`);
      }
      options.onBytes(offset);
      await receiveBody(response, part, append, { expected: file.bytes, onBytes: options.onBytes, touch }, offset);
    } catch (error) {
      if (error instanceof DownloadMismatch) await rm(part, { force: true });
      if (options.signal.aborted) throw options.signal.reason instanceof Error ? options.signal.reason : new Error('Đã hủy tải.');
      if (stall.signal.aborted || error instanceof ConnectionCut) throw new Error('Kết nối bị ngắt giữa chừng.');
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
