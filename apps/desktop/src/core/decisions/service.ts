import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { DecisionModelState, DecisionQuestions, DecisionResponse, DecisionState } from '../../shared/decisions';
import { DecisionQuestions as QuestionsSchema, DecisionState as StateSchema } from '../../shared/decisions';
import { downloadFile, type Getter, type PinnedFile } from './download';
import { TACET_FILES, totalBytes, type DecisionFiles } from './manifest';
import { DEFAULT_MAX_LENGTH } from './packing';

/** A loaded model the service can ask; the real one is a worker thread (worker-runtime.ts), tests pass a stub. */
export type DecisionRuntime = {
  decide(state: DecisionState, questions: DecisionQuestions, maxLength: number): Promise<DecisionResponse>;
  close(): Promise<void>;
};
export type DecisionRuntimeFactory = (files: { model: { path: string; file: PinnedFile }; tokenizer: { path: string; file: PinnedFile } }) => Promise<DecisionRuntime>;

export type DecisionsOptions = {
  /** Where the model's files live; absent (an in-memory store) means Tacet cannot be installed here. */
  directory?: string;
  files?: DecisionFiles;
  /** How a file is fetched; the default is node:http(s) with redirects (download.ts). */
  get?: Getter;
  runtime?: DecisionRuntimeFactory;
  /** How long a loaded model stays in memory after its last answer. */
  idleMs?: number;
  /** How often progress reaches the window while bytes arrive. */
  progressMs?: number;
};

/** A schedule runs at most hourly, so keeping 300 MB loaded between runs would cost memory for nothing. */
export const IDLE_UNLOAD_MS = 2 * 60_000;
const PROGRESS_MS = 250;

export const NOT_INSTALLED = 'Tacet chưa được tải về máy này.';

/** The file beside the model that names which Tacet was downloaded, so a later Orglet pinning another one can tell. */
export const INSTALLED_RECORD = 'installed.json';
const RecordedFile = z.object({ name: z.string(), sha256: z.string(), bytes: z.number() });
const RecordSchema = z.object({ model: RecordedFile, tokenizer: RecordedFile });
type InstalledRecord = z.infer<typeof RecordSchema>;

/**
 * Tacet on this computer (COD-303): the one-time download the person asks for, what is on disk, and answers from the
 * model once it is there. The model loads on first use, in a worker thread, and unloads again after a quiet spell.
 * Nothing here runs unless the files are on disk and verified, and a caller that gets `undefined` from `decide` keeps
 * doing what it did before Tacet existed.
 */
export class Decisions {
  onState?: (state: DecisionModelState) => void;
  private readonly files: DecisionFiles;
  private download?: { controller: AbortController; done: Promise<void> };
  private failure?: string;
  private verifying = false;
  private received = 0;
  private lastProgressAt = 0;
  private runtime?: Promise<DecisionRuntime>;
  private idleTimer?: NodeJS.Timeout;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private options: DecisionsOptions = {}) {
    this.files = options.files ?? TACET_FILES;
  }

  private pathOf(file: PinnedFile): string {
    return join(this.options.directory!, file.name);
  }

  /** Bytes a download would not fetch again: pinned files already in place, and what a cut left in a `.part`. */
  private partialBytes(): number {
    return [this.files.model, this.files.tokenizer].reduce((sum, file) => {
      if (this.hasPinnedSize(file) && this.recordMatches()) return sum + file.bytes;
      try {
        return sum + statSync(`${this.pathOf(file)}.part`).size;
      } catch {
        return sum;
      }
    }, 0);
  }

  private recordPath(): string {
    return join(this.options.directory!, INSTALLED_RECORD);
  }

  /** Which Tacet the folder holds, as written after a verified download; undefined for one from before the record. */
  private readRecord(): InstalledRecord | undefined {
    try {
      return RecordSchema.parse(JSON.parse(readFileSync(this.recordPath(), 'utf8')));
    } catch {
      return undefined;
    }
  }

  private async writeRecord() {
    const record: InstalledRecord = {
      model: { name: this.files.model.name, sha256: this.files.model.sha256, bytes: this.files.model.bytes },
      tokenizer: { name: this.files.tokenizer.name, sha256: this.files.tokenizer.sha256, bytes: this.files.tokenizer.bytes },
    };
    await writeFile(this.recordPath(), JSON.stringify(record));
  }

  /** Whether the record names the files this Orglet pins; a folder without one is taken at its word until it loads. */
  private recordMatches(record = this.readRecord()): boolean {
    if (!record) return true;
    return record.model.sha256 === this.files.model.sha256 && record.tokenizer.sha256 === this.files.tokenizer.sha256;
  }

  private hasPinnedSize(file: PinnedFile): boolean {
    return existsSync(this.pathOf(file)) && statSync(this.pathOf(file)).size === file.bytes;
  }

  /** Both files in place at their pinned size, and no record saying they are another Tacet. Hashes are checked on load. */
  isInstalled(): boolean {
    if (!this.options.directory) return false;
    return this.hasPinnedSize(this.files.model) && this.hasPinnedSize(this.files.tokenizer) && this.recordMatches();
  }

  /**
   * A Tacet from an earlier Orglet is on disk: its record names other files, or, from before the record, a finished
   * file has another size than this Orglet pins. Pinning a new Tacet in a release is how it is updated (user,
   * 2026-10-07); the person is told and updates with one click, and Tacet rests until then rather than pairing a model
   * with code written for another.
   */
  isOutdated(): boolean {
    if (!this.options.directory || this.isInstalled()) return false;
    const record = this.readRecord();
    if (record) return !this.recordMatches(record);
    return [this.files.model, this.files.tokenizer].some(file => existsSync(this.pathOf(file)) && statSync(this.pathOf(file)).size !== file.bytes);
  }

  state(): DecisionModelState {
    const total = totalBytes(this.files);
    if (!this.options.directory) return { status: 'absent', receivedBytes: 0, totalBytes: total };
    if (this.verifying) return { status: 'verifying', receivedBytes: this.received, totalBytes: total };
    if (this.download) return { status: 'downloading', receivedBytes: this.received, totalBytes: total };
    if (this.isInstalled()) return { status: 'ready', receivedBytes: total, totalBytes: total };
    if (this.isOutdated() && !this.failure) return { status: 'outdated', receivedBytes: 0, totalBytes: total };
    const received = this.partialBytes();
    // A failed update still has the earlier Tacet on disk, so the window keeps offering it (user, 2026-10-07).
    if (this.failure) return { status: 'failed', receivedBytes: received, totalBytes: total, error: this.failure, ...(this.isOutdated() ? { update: true as const } : {}) };
    return { status: 'absent', receivedBytes: received, totalBytes: total };
  }

  private announce(force = true) {
    const now = Date.now();
    if (!force && now - this.lastProgressAt < (this.options.progressMs ?? PROGRESS_MS)) return;
    this.lastProgressAt = now;
    this.onState?.(this.state());
  }

  /** Starts the download in the background, or resumes one a cut connection left; returns at once. */
  install(): DecisionModelState {
    if (!this.options.directory) throw new Error('Không có thư mục dữ liệu để lưu Tacet.');
    if (this.download || this.isInstalled()) return this.state();
    this.failure = undefined;
    const controller = new AbortController();
    const done = this.fetchAll(controller.signal)
      .catch(error => {
        if (!controller.signal.aborted) this.failure = error instanceof Error ? error.message : 'Không tải được Tacet.';
      })
      .finally(() => {
        this.download = undefined;
        this.verifying = false;
        this.announce();
      });
    this.download = { controller, done };
    this.announce();
    return this.state();
  }

  private async fetchAll(signal: AbortSignal) {
    const directory = this.options.directory!;
    await mkdir(directory, { recursive: true });
    const record = this.readRecord();
    // The tokenizer is small, so it goes first; the model's bytes then count on top of it.
    const order = [this.files.tokenizer, this.files.model];
    for (const [index, file] of order.entries()) {
      const before = order.slice(0, index).reduce((sum, earlier) => sum + earlier.bytes, 0);
      // A file of the pinned size is kept, unless the record says it is an earlier Tacet's file of the same size.
      const recorded = record && [record.model, record.tokenizer].find(entry => entry.name === file.name);
      if (this.hasPinnedSize(file) && (!record || recorded?.sha256 === file.sha256)) {
        this.received = before + file.bytes;
        continue;
      }
      await downloadFile(file, this.pathOf(file), {
        get: this.options.get,
        signal,
        onBytes: bytes => {
          this.received = before + bytes;
          this.verifying = bytes === file.bytes;
          this.announce(this.verifying);
        },
      });
      this.verifying = false;
    }
    await this.writeRecord();
    await this.deleteEarlierFiles();
  }

  /** After an update, whatever an earlier Tacet left in the folder under another name (about 300 MB) is deleted. */
  private async deleteEarlierFiles() {
    const kept = new Set([this.files.model.name, this.files.tokenizer.name, INSTALLED_RECORD]);
    for (const entry of await readdir(this.options.directory!)) {
      if (!kept.has(entry)) await rm(join(this.options.directory!, entry), { recursive: true, force: true });
    }
  }

  /** Stops a download and deletes what it had fetched so far; the person asked for it to stop. */
  async cancel(): Promise<DecisionModelState> {
    const download = this.download;
    if (!download) return this.state();
    download.controller.abort(new Error('Đã hủy tải.'));
    await download.done;
    await this.deletePartials();
    this.failure = undefined;
    this.announce();
    return this.state();
  }

  private async deletePartials() {
    if (!this.options.directory) return;
    for (const file of [this.files.model, this.files.tokenizer]) await rm(`${this.pathOf(file)}.part`, { force: true });
  }

  /** Unloads the model and deletes its folder: Remove in Settings, and Erase everything. */
  async remove(): Promise<DecisionModelState> {
    if (this.download) {
      this.download.controller.abort(new Error('Đã hủy tải.'));
      await this.download.done;
    }
    await this.unload();
    if (this.options.directory) await rm(this.options.directory, { recursive: true, force: true });
    this.failure = undefined;
    this.received = 0;
    this.announce();
    return this.state();
  }

  private async unload() {
    clearTimeout(this.idleTimer);
    const runtime = this.runtime;
    this.runtime = undefined;
    if (runtime) await runtime.then(loaded => loaded.close(), () => undefined);
  }

  private loadRuntime(): Promise<DecisionRuntime> {
    if (!this.runtime) {
      if (!this.options.runtime) throw new Error(NOT_INSTALLED);
      const files = {
        model: { path: this.pathOf(this.files.model), file: this.files.model },
        tokenizer: { path: this.pathOf(this.files.tokenizer), file: this.files.tokenizer },
      };
      this.runtime = this.options.runtime(files);
      // A model that failed to load is not kept, so the next question tries again. One that loaded passed the worker's
      // hash check, so a folder from before the record gets one: a later Orglet pinning another Tacet then sees it.
      this.runtime.then(() => this.readRecord() ? undefined : this.writeRecord(), () => { this.runtime = undefined; }).catch(() => undefined);
    }
    return this.runtime;
  }

  private keepLoadedForAWhile() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => void this.unload(), this.options.idleMs ?? IDLE_UNLOAD_MS);
    this.idleTimer.unref?.();
  }

  /**
   * Answers `questions` about `state`, or `undefined` when Tacet is not on this computer. One request runs at a time;
   * a forward pass takes tens of milliseconds for a short state and a few seconds for a long one.
   */
  async decide(state: DecisionState, questions: DecisionQuestions, maxLength = DEFAULT_MAX_LENGTH): Promise<DecisionResponse | undefined> {
    if (!this.isInstalled() || this.download) return undefined;
    const request = { state: StateSchema.parse(state), questions: QuestionsSchema.parse(questions) };
    const answer = this.queue.then(async () => {
      const runtime = await this.loadRuntime();
      try {
        return await runtime.decide(request.state, request.questions, maxLength);
      } finally {
        this.keepLoadedForAWhile();
      }
    });
    this.queue = answer.catch(() => undefined);
    return answer;
  }

  /**
   * Starts loading the model without a question, when a question is likely soon (COD-306: a run that has begun using
   * the browser or a desktop app). Does nothing when Tacet is not installed or is already loaded.
   */
  warm(): void {
    if (!this.isInstalled() || this.download || !this.options.runtime) return;
    this.loadRuntime().then(() => this.keepLoadedForAWhile(), () => undefined);
  }

  /** Quitting: the worker thread goes with the process anyway, but a clean close releases the session first. */
  async shutdown() {
    this.download?.controller.abort(new Error('Đã hủy tải.'));
    await this.unload();
  }
}
