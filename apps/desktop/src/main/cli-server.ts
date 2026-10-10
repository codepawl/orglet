import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer, type Server, type Socket } from 'node:net';
import { CLI_TOKEN_FILE, CliRequest, MAX_CONNECTIONS, MAX_LINE_BYTES, type CliErrorCode, type CliResponse } from '../cli/protocol';
import { CliFailure } from './cli-operations';
import { CliProgressFrame } from '../cli/protocol';
import { heldActionScope } from '../cli/parity';
import { operationHash, type CliElevation, type ElevationGrant } from './cli-elevation';

/**
 * The app's end of the `orglet` command (COD-234): a named pipe on Windows, a Unix socket elsewhere, answering one
 * JSON line with one JSON line. Every request carries the token main wrote to the data folder on this start, so only
 * someone who can read that folder can talk to the app. No Electron here, so tests run the real server.
 */

export type CliHandler = (request: CliRequest, signal: AbortSignal, progress?: (frame: CliProgressFrame) => void, grant?: ElevationGrant) => Promise<unknown>;

export type CliServerOptions = {
  endpoint: string;
  token: string;
  handle: CliHandler;
  /** Turns a Vietnamese source message into the app's language. */
  translate: (message: string) => string;
  /** Checks the elevation key of an operation in the elevated set; without it every such operation answers `locked`. */
  elevation?: CliElevation;
  maxConnections?: number;
  maxLineBytes?: number;
};

/** A fresh random token for this start. */
export function createCliToken(): string {
  return randomBytes(32).toString('hex');
}

/** Writes the token readable by its owner only, where the OS has such permissions. */
export async function writeCliToken(userData: string, token: string): Promise<void> {
  const file = join(userData, CLI_TOKEN_FILE);
  await writeFile(file, token, { encoding: 'utf8', mode: 0o600 });
  // `mode` only applies when the file is created; an older token file keeps its permissions otherwise.
  await chmod(file, 0o600).catch(() => undefined);
}

/**
 * Constant-time comparison. Both sides are hashed first so the comparison never depends on the given length and
 * `timingSafeEqual` always gets two buffers of the same size.
 */
export function tokensMatch(expected: string, given: unknown): boolean {
  if (typeof given !== 'string') return false;
  const expectedDigest = createHash('sha256').update(expected).digest();
  const givenDigest = createHash('sha256').update(given).digest();
  return timingSafeEqual(expectedDigest, givenDigest);
}

function failure(code: CliErrorCode, error: string): CliResponse {
  return { ok: false, code, error };
}

/** Reads one request line and answers it; exported so the tests can call it without a socket. */
export async function answerLine(line: string, options: Pick<CliServerOptions, 'token' | 'handle' | 'translate' | 'elevation'>, signal: AbortSignal, progress?: (frame: CliProgressFrame) => void): Promise<CliResponse> {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return failure('invalid', options.translate('Yêu cầu CLI không hợp lệ.'));
  }
  // The token is checked before anything else is looked at, so a caller without it learns nothing about the shape.
  const token = raw && typeof raw === 'object' ? (raw as { token?: unknown }).token : undefined;
  if (!tokensMatch(options.token, token)) {
    return failure('unauthorized', options.translate('Mã truy cập CLI không khớp. Chạy lại lệnh sau khi Orglet khởi động xong.'));
  }
  // `elevation` rides beside the token and belongs to no operation's schema.
  const { elevation: elevationKey, ...fields } = raw as Record<string, unknown>;
  const parsed = CliRequest.safeParse(fields);
  if (!parsed.success) return failure('invalid', options.translate('Yêu cầu CLI không hợp lệ.'));
  try {
    // The operations that need an elevation come from the parity table, never from a second list here.
    const grant = parsed.data.op === 'held' ? await authorizeHeld(parsed.data, elevationKey, options.elevation) : undefined;
    const emit = parsed.data.op === 'send' && parsed.data.progress && parsed.data.wait ? progress : undefined;
    return { ok: true, value: await options.handle(parsed.data, signal, emit, grant) };
  } catch (error) {
    const code = error instanceof CliFailure ? error.code : 'failed';
    const message = error instanceof Error ? error.message : 'Không thể thực hiện thao tác.';
    return failure(code, options.translate(message));
  }
}

/** Checks the elevation of a held operation: the token is already checked, then the key, its life and its scope. */
async function authorizeHeld(request: Extract<CliRequest, { op: 'held' }>, key: unknown, elevation: CliElevation | undefined): Promise<ElevationGrant> {
  if (!elevation) throw new CliFailure('locked', 'Lệnh này cần bạn mở khóa từ cửa sổ Orglet.');
  return elevation.authorize(heldActionScope(request.request.action), key, operationHash(request.request));
}

export class CliServer {
  private server?: Server;
  private readonly sockets = new Set<Socket>();

  constructor(private readonly options: CliServerOptions) {}

  async start(): Promise<void> {
    const { endpoint } = this.options;
    // A socket file left by a crash would make listen fail. The single-instance lock means no other copy of the app
    // uses this data folder, so the file is stale. Named pipes vanish with their process.
    if (!endpoint.startsWith('\\\\.\\pipe\\')) await rm(endpoint, { force: true });
    const server = createServer(socket => this.accept(socket));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(endpoint, () => {
        server.off('error', reject);
        resolve();
      });
    });
    if (!endpoint.startsWith('\\\\.\\pipe\\')) await chmod(endpoint, 0o600).catch(() => undefined);
    this.server = server;
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }

  private accept(socket: Socket): void {
    const busy = this.sockets.size >= (this.options.maxConnections ?? MAX_CONNECTIONS);
    this.sockets.add(socket);
    const controller = new AbortController();
    socket.on('error', () => socket.destroy());
    socket.on('close', () => {
      this.sockets.delete(socket);
      // A CLI that went away (Ctrl+C) stops the wait it started.
      controller.abort();
    });
    if (busy) {
      this.reply(socket, failure('busy', this.options.translate('Đang có quá nhiều lệnh CLI chạy cùng lúc. Thử lại sau.')));
      return;
    }
    const limit = this.options.maxLineBytes ?? MAX_LINE_BYTES;
    let buffered = Buffer.alloc(0);
    let answering = false;
    const refuseLargeLine = () => {
      answering = true;
      this.reply(socket, failure('too_large', this.options.translate('Yêu cầu CLI quá lớn.')));
    };
    socket.on('data', (chunk: Buffer) => {
      if (answering) return;
      buffered = Buffer.concat([buffered, chunk]);
      const newline = buffered.indexOf(0x0a);
      if (newline === -1) {
        if (buffered.length > limit) refuseLargeLine();
        return;
      }
      if (newline > limit) {
        refuseLargeLine();
        return;
      }
      answering = true;
      const line = buffered.subarray(0, newline).toString('utf8');
      const progress = (frame: CliProgressFrame) => {
        if (socket.destroyed || controller.signal.aborted) return;
        const parsed = CliProgressFrame.safeParse(frame);
        if (!parsed.success) return;
        // A slow reader cannot retain an unbounded stream in main's socket buffer.
        if (socket.writableLength > MAX_LINE_BYTES * 4) {
          socket.destroy();
          return;
        }
        socket.write(`${JSON.stringify(parsed.data)}\n`);
      };
      void answerLine(line, this.options, controller.signal, progress).then(response => this.reply(socket, response));
    });
  }

  /** One response per connection: the CLI sends one request and reads one line back. */
  private reply(socket: Socket, response: CliResponse): void {
    if (socket.destroyed) return;
    socket.end(`${JSON.stringify(response)}\n`);
    // Whatever else the CLI sent has to be read, or the connection never sees the CLI's end and stays open.
    socket.resume();
  }
}
