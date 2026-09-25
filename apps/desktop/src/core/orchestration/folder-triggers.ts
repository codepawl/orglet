import { watch, type FSWatcher } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { FolderIntake, Routine } from '../../shared/contracts';
import { isTemporaryArrival, triggerOf } from '../../shared/routine-triggers';
import { MEDIA_SOURCE_EXTENSIONS, TEXT_SOURCE_EXTENSIONS } from '../../shared/source-kinds';
import type { Store } from '../storage/database';
import { FOLDER_UNAVAILABLE, type Arrival, type RoutineFolders } from '../storage/routine-folders';
import type { Sources } from '../tools/sources';
import type { Routines } from './routines';

/**
 * "When a file arrives" routines (COD-245). Each enabled folder routine watches the top level of the folder its
 * person granted, while the app is open. A file counts once it has settled (same size and time on two looks at least
 * `settleMs` apart, and it opens), files that settle close together share one run, and the run gets them through the
 * same import the file picker uses, with the same limits. Files that were already there when watching began, and
 * files a run already took, never start a run.
 *
 * `fs.watch` only says "look again soon"; the listing is what counts, so a missed or doubled event changes nothing.
 * The core's five-second tick also looks, which covers a watcher that failed or a drive that sends no events.
 */
export type FolderTriggerTiming = {
  /** How long a new file must keep the same size and time before it counts. */
  settleMs: number;
  /** How long the folder must be quiet after the last new file before the batch runs. */
  batchMs: number;
  /** A batch runs after this long even if files keep arriving, so a busy folder cannot hold it forever. */
  maxBatchWaitMs: number;
  /** Use `fs.watch` and its follow-up timers; off in tests that drive `poll` with their own clock. */
  live: boolean;
};

export const FOLDER_TRIGGER_TIMING: FolderTriggerTiming = { settleMs: 1500, batchMs: 3000, maxBatchWaitMs: 30_000, live: true };

/** The source limits the file picker has: 20 files, 64 MB together. */
const SOURCE_LIMIT = 20;
const TOTAL_BYTES_LIMIT = 64 * 1024 * 1024;
/** A folder event is followed by one look this long after it, so a burst of events costs one listing. */
const EVENT_DEBOUNCE_MS = 250;

const SUPPORTED_EXTENSIONS = new Set([...TEXT_SOURCE_EXTENSIONS, ...MEDIA_SOURCE_EXTENSIONS].map(extension => `.${extension}`));
const UNSUPPORTED = 'Định dạng chưa được hỗ trợ.';
const UNREADABLE = 'Không đọc được, không đúng UTF-8 hoặc vượt giới hạn kích thước.';
const LIMIT_REACHED = 'Đã chọn đủ 20 tệp.';
const TOTAL_TOO_LARGE = 'Tổng dữ liệu vượt 64 MB.';
const NOTHING_READABLE = 'Tệp mới trong thư mục không đọc được hoặc chưa được hỗ trợ.';
const WAITING_FOR_PREVIOUS = 'Có tệp mới đang chờ lần chạy trước kết thúc.';

type Candidate = { size: number; modifiedMs: number; changedAt: number };
type Ready = Arrival & { path: string };

/** One folder routine's watch: what was there, what is settling, and what is ready to run. */
class FolderWatch {
  /** Files present that must not start a run: there when watching began, or already taken by a batch. */
  readonly known = new Set<string>();
  readonly candidates = new Map<string, Candidate>();
  ready: Ready[] = [];
  firstReadyAt: number | null = null;
  lastActivityAt = 0;
  watcher?: FSWatcher;
  timer?: NodeJS.Timeout;
  constructor(readonly routineId: string, readonly folderId: string, readonly directory: string) {}
}

export class FolderTriggers {
  readonly timing: FolderTriggerTiming = { ...FOLDER_TRIGGER_TIMING };
  private watches = new Map<string, FolderWatch>();
  /** Syncs and looks run one at a time: a folder event, the tick and a save may all ask at once. */
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private store: Store,
    private folders: RoutineFolders,
    private routines: Routines,
    private sources: Sources,
    private clock: () => Date,
  ) {}

  /** Starts and stops watches to match the enabled folder routines, then looks at every watched folder. */
  poll(): Promise<void> {
    return this.enqueue(async () => {
      await this.syncNow();
      for (const folderWatch of [...this.watches.values()]) await this.look(folderWatch);
    });
  }

  /** Matches the watches to the saved routines without looking; a save calls this so a new watch starts at once. */
  sync(): Promise<void> {
    return this.enqueue(() => this.syncNow());
  }

  /** Closes every watcher; nothing is watched again until the next poll or sync. */
  stop() {
    for (const folderWatch of this.watches.values()) this.close(folderWatch);
    this.watches.clear();
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => {});
    return next;
  }

  private wanted(): Map<string, string> {
    const wanted = new Map<string, string>();
    for (const routine of this.store.all<Routine>('routines')) {
      const trigger = triggerOf(routine);
      if (routine.enabled && trigger.kind === 'folder') wanted.set(routine.id, trigger.folderId);
    }
    return wanted;
  }

  private async syncNow() {
    const wanted = this.wanted();
    for (const [routineId, folderWatch] of this.watches) {
      if (wanted.get(routineId) === folderWatch.folderId) continue;
      // Turned off, deleted or pointed at another folder: what it saw so far no longer applies.
      this.close(folderWatch);
      this.watches.delete(routineId);
    }
    for (const [routineId, folderId] of wanted) {
      if (this.watches.has(routineId)) continue;
      await this.begin(routineId, folderId);
    }
  }

  /** Starts watching: everything already in the folder is the baseline and never runs. */
  private async begin(routineId: string, folderId: string) {
    let directory: string;
    let names: string[];
    try {
      directory = await this.folders.directory(folderId);
    } catch (error) {
      this.routines.note(routineId, messageOf(error));
      return;
    }
    try {
      names = await this.fileNames(directory);
    } catch {
      // The system error names the path; the renderer never sees a watched folder's path.
      this.routines.note(routineId, FOLDER_UNAVAILABLE);
      return;
    }
    const folderWatch = new FolderWatch(routineId, folderId, directory);
    for (const name of names) folderWatch.known.add(name);
    this.watches.set(routineId, folderWatch);
    if (this.timing.live) this.listen(folderWatch);
  }

  private listen(folderWatch: FolderWatch) {
    try {
      // Not persistent: a watch never keeps the core process alive on its own.
      folderWatch.watcher = watch(folderWatch.directory, { persistent: false }, () => this.wake(folderWatch, EVENT_DEBOUNCE_MS));
      // A watcher that fails leaves the folder to the tick's looks, which find the same files a little later.
      folderWatch.watcher.on('error', () => this.closeWatcher(folderWatch));
    } catch {
      folderWatch.watcher = undefined;
    }
  }

  /** One look at this folder after `delay`, replacing any look already waiting. */
  private wake(folderWatch: FolderWatch, delay: number) {
    if (!this.timing.live || this.watches.get(folderWatch.routineId) !== folderWatch) return;
    if (folderWatch.timer) clearTimeout(folderWatch.timer);
    folderWatch.timer = setTimeout(() => {
      folderWatch.timer = undefined;
      void this.enqueue(() => this.look(folderWatch)).catch(() => {});
    }, delay);
    folderWatch.timer.unref();
  }

  private closeWatcher(folderWatch: FolderWatch) {
    folderWatch.watcher?.close();
    folderWatch.watcher = undefined;
  }

  private close(folderWatch: FolderWatch) {
    this.closeWatcher(folderWatch);
    if (folderWatch.timer) clearTimeout(folderWatch.timer);
    folderWatch.timer = undefined;
  }

  /** Plain files at the top of the folder, leaving out temporary and partial ones. Subfolders are not watched. */
  private async fileNames(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries.filter(entry => entry.isFile() && !isTemporaryArrival(entry.name)).map(entry => entry.name);
  }

  private async look(folderWatch: FolderWatch) {
    if (this.watches.get(folderWatch.routineId) !== folderWatch) return;
    let names: string[];
    try {
      names = await this.fileNames(folderWatch.directory);
    } catch {
      this.routines.note(folderWatch.routineId, FOLDER_UNAVAILABLE);
      this.close(folderWatch);
      this.watches.delete(folderWatch.routineId);
      return;
    }
    const at = this.clock().getTime();
    const present = new Set(names);
    // A file that left can come back as a new one.
    for (const name of [...folderWatch.known]) if (!present.has(name)) folderWatch.known.delete(name);
    for (const name of [...folderWatch.candidates.keys()]) if (!present.has(name)) folderWatch.candidates.delete(name);
    for (const name of names) {
      if (folderWatch.known.has(name)) continue;
      await this.observe(folderWatch, name, at);
    }
    await this.maybeRun(folderWatch, at);
    this.followUp(folderWatch, at);
  }

  /** Records one new file; once it has kept its size and time for `settleMs` and opens, it is ready. */
  private async observe(folderWatch: FolderWatch, name: string, at: number) {
    const path = join(folderWatch.directory, name);
    let size: number;
    let modifiedMs: number;
    try {
      const status = await lstat(path);
      if (!status.isFile()) return;
      size = status.size;
      modifiedMs = Math.trunc(status.mtimeMs);
    } catch {
      return;
    }
    const candidate = folderWatch.candidates.get(name);
    const changed = !candidate || candidate.size !== size || candidate.modifiedMs !== modifiedMs;
    if (changed) {
      folderWatch.candidates.set(name, { size, modifiedMs, changedAt: at });
      folderWatch.lastActivityAt = at;
      return;
    }
    if (at - candidate.changedAt < this.timing.settleMs) return;
    // A program still writing may hold the file shut; it counts once it opens.
    if (!(await opens(path))) {
      folderWatch.candidates.set(name, { ...candidate, changedAt: at });
      return;
    }
    folderWatch.candidates.delete(name);
    folderWatch.known.add(name);
    const arrival: Arrival = { name, size, modifiedMs };
    if (this.folders.wasHandled(folderWatch.routineId, arrival)) return;
    folderWatch.ready.push({ ...arrival, path });
    folderWatch.firstReadyAt ??= at;
    folderWatch.lastActivityAt = at;
  }

  /** Keeps looking while something is settling or waiting to run; a quiet folder waits for the next event or tick. */
  private followUp(folderWatch: FolderWatch, at: number) {
    if (folderWatch.candidates.size > 0) {
      this.wake(folderWatch, this.timing.settleMs);
      return;
    }
    if (folderWatch.ready.length === 0) return;
    const untilQuiet = folderWatch.lastActivityAt + this.timing.batchMs - at;
    // Past the quiet time the batch is only waiting for the run before it, and the tick looks every few seconds.
    if (untilQuiet <= 0) return;
    this.wake(folderWatch, untilQuiet);
  }

  private async maybeRun(folderWatch: FolderWatch, at: number) {
    if (folderWatch.ready.length === 0) return;
    const quiet = folderWatch.candidates.size === 0 && at - folderWatch.lastActivityAt >= this.timing.batchMs;
    const overdue = folderWatch.firstReadyAt !== null && at - folderWatch.firstReadyAt >= this.timing.maxBatchWaitMs;
    if (!quiet && !overdue) return;
    const routine = this.store.all<Routine>('routines').find(item => item.id === folderWatch.routineId);
    if (!routine?.enabled) return;
    if (this.routines.previousRunActive(routine.id)) {
      // The files wait for the run before them; more that arrive meanwhile join this batch.
      this.routines.note(routine.id, WAITING_FOR_PREVIOUS);
      return;
    }
    const batch = folderWatch.ready;
    folderWatch.ready = [];
    folderWatch.firstReadyAt = null;
    await this.run(routine, folderWatch, batch);
  }

  private async run(routine: Routine, folderWatch: FolderWatch, batch: Ready[]) {
    try {
      // The folder must still be the one that was granted before anything in it is read.
      await this.folders.directory(folderWatch.folderId);
    } catch (error) {
      this.routines.note(routine.id, messageOf(error));
      return;
    }
    const capacity = SOURCE_LIMIT - routine.task.sourceIds.length;
    const intake = await this.importBatch(batch, capacity);
    this.folders.markHandled(routine.id, batch);
    if (intake.sources.length === 0) {
      this.routines.note(routine.id, NOTHING_READABLE);
      return;
    }
    try {
      await this.routines.runArrivals(routine.id, { sourceIds: intake.sources.map(source => source.id), excluded: intake.skipped });
    } catch (error) {
      this.routines.note(routine.id, messageOf(error));
    }
  }

  /** The folder import's rules for a batch: supported kinds, per-file limits, 20 files and 64 MB together. */
  private async importBatch(batch: readonly Ready[], capacity: number): Promise<FolderIntake> {
    const intake: FolderIntake = { sources: [], skipped: [] };
    let totalBytes = 0;
    const ordered = [...batch].sort((first, second) => first.name.localeCompare(second.name));
    for (const file of ordered) {
      if (!SUPPORTED_EXTENSIONS.has(extname(file.name).toLowerCase())) {
        intake.skipped.push({ name: file.name, reason: UNSUPPORTED });
        continue;
      }
      if (intake.sources.length >= capacity) {
        intake.skipped.push({ name: file.name, reason: LIMIT_REACHED });
        continue;
      }
      if (totalBytes + file.size > TOTAL_BYTES_LIMIT) {
        intake.skipped.push({ name: file.name, reason: TOTAL_TOO_LARGE });
        continue;
      }
      try {
        const [source] = await this.sources.import([file.path]);
        totalBytes += source.bytes;
        intake.sources.push(source);
      } catch {
        intake.skipped.push({ name: file.name, reason: UNREADABLE });
      }
    }
    return intake;
  }
}

async function opens(path: string): Promise<boolean> {
  try {
    const file = await open(path, 'r');
    await file.close();
    return true;
  } catch {
    return false;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Không theo dõi được thư mục.';
}
