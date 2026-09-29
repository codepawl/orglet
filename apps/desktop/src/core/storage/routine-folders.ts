import { realpath, stat } from 'node:fs/promises';
import { z } from 'zod';
import { WatchFolderView } from '../../shared/routine-triggers';
import { WorkspacePermissions, type WorkspacePermission } from '../../shared/workspace-access';
import { Store, id, now } from './database';
import { birthOf, sameFolder, type ResolvedDirectory } from './workspace-grants';

/**
 * Folders routines watch (COD-245) or work in (COD-294). A folder gets here only from main's native picker, resolved
 * the same way a chat's workspace folder is; the renderer holds its id and name, never its path. `permissions` is the
 * level the picker was opened at: always read-only for a watched folder, the schedule form's level for a working one.
 * A routine may use a folder at that level or below, never above it.
 */
const StoredFolder = z.object({
  id: z.uuid(), directory: z.string().min(1), device: z.string(), inode: z.string(), name: z.string().min(1),
  permissions: WorkspacePermissions, createdAt: z.iso.datetime(),
  /** The folder's birth time in nanoseconds, where the file system reports one (COD-294); absent on older rows. */
  birth: z.string().regex(/^[1-9][0-9]*$/).optional(),
}).strict();
type StoredFolder = z.infer<typeof StoredFolder>;

/** A file a folder trigger already handed to a run: the same name, size and time is never handed over again. */
export type Arrival = { name: string; size: number; modifiedMs: number };

const NOT_GRANTED = 'Thư mục theo dõi chưa được cấp quyền. Chọn lại thư mục trong lịch.';
export const FOLDER_UNAVAILABLE = 'Thư mục theo dõi không còn hoặc đã bị thay thế. Chọn lại thư mục trong lịch.';
const WORK_FOLDER_NOT_GRANTED = 'Thư mục làm việc của lịch chưa được cấp quyền. Chọn lại thư mục trong lịch.';
const WORK_FOLDER_TOO_WIDE = 'Mức quyền của thư mục làm việc rộng hơn lúc chọn thư mục. Chọn lại thư mục ở mức này.';
/** Shown on the schedule's card when a run could not start because its working folder is gone or was replaced. */
export const workFolderUnavailable = (name: string) => `Thư mục làm việc ${name} của lịch không còn hoặc đã bị thay thế, nên lịch chưa chạy. Chọn lại thư mục trong lịch rồi lưu.`;

/**
 * Whether a folder on disk is still the one the picker granted: the same canonical path, a directory, the same volume
 * and file id, and the same birth time where the file system reports one (COD-294 for working folders, COD-300 for
 * watched ones), so a folder made again at the same path on Linux is not taken for it.
 */
async function stillTheSame(folder: StoredFolder): Promise<boolean> {
  try {
    const canonical = await realpath(folder.directory);
    const identity = await stat(folder.directory, { bigint: true });
    const onDisk = { directory: canonical, device: identity.dev.toString(), inode: identity.ino.toString(), birth: birthOf(identity) };
    return identity.isDirectory() && sameFolder(folder, onDisk);
  } catch {
    return false;
  }
}
/** Handled files kept per routine; older ones are forgotten, since a file older than these is in no one's baseline. */
const ARRIVALS_KEPT = 2000;

export class RoutineFolders {
  constructor(private store: Store) {}

  private find(folderId: string): StoredFolder | undefined {
    const row = this.store.db.prepare('SELECT data FROM routine_folders WHERE id=?').get(folderId);
    if (!row) return undefined;
    return StoredFolder.parse(JSON.parse(String(row.data)));
  }

  /**
   * Keeps a folder the picker resolved, at the level it was opened at, and returns what the renderer may know about it.
   * The birth time comes from the same read as the path and file id, so a folder swapped in between cannot slip in.
   */
  add(resolved: ResolvedDirectory, permissions: WorkspacePermission[] = ['read']): WatchFolderView {
    const folder: StoredFolder = { id: id(), ...resolved, permissions: WorkspacePermissions.parse(permissions), createdAt: now() };
    this.store.db.prepare('INSERT INTO routine_folders(id,data) VALUES(?,?)').run(folder.id, JSON.stringify(StoredFolder.parse(folder)));
    return WatchFolderView.parse({ folderId: folder.id, name: folder.name });
  }

  /**
   * The name of a routine's working folder being saved (COD-294). Refuses an id the picker never granted, and a level
   * wider than the one the picker was opened at: the window cannot widen a folder by itself.
   */
  workFolderName(folderId: string, permissions: readonly WorkspacePermission[]): string {
    const folder = this.find(folderId);
    if (!folder) throw new Error(WORK_FOLDER_NOT_GRANTED);
    if (permissions.some(permission => !folder.permissions.includes(permission))) throw new Error(WORK_FOLDER_TOO_WIDE);
    return folder.name;
  }

  /**
   * A routine's working folder resolved for one run (COD-294): still the directory that was picked, not moved away,
   * deleted or replaced at the same path (path, volume, file id and, where known, birth time). Throws the sentence the
   * schedule's card shows.
   */
  async workFolder(folderId: string): Promise<ResolvedDirectory> {
    const folder = this.find(folderId);
    if (!folder) throw new Error(WORK_FOLDER_NOT_GRANTED);
    if (!await stillTheSame(folder)) throw new Error(workFolderUnavailable(folder.name));
    return { directory: folder.directory, device: folder.device, inode: folder.inode, ...(folder.birth ? { birth: folder.birth } : {}), name: folder.name };
  }

  /** The folder's name for a routine being saved; refuses an id the picker never granted. */
  nameOf(folderId: string): string {
    const folder = this.find(folderId);
    if (!folder) throw new Error(NOT_GRANTED);
    return folder.name;
  }

  /** What the approval covers: the granted folder's identity, so a different folder at the same path is not approved. */
  identity(folderId: string): string {
    const folder = this.find(folderId);
    if (!folder) return 'missing';
    return `${folder.directory}\n${folder.device}\n${folder.inode}`;
  }

  /** The granted path, after checking it is still the directory that was picked and not a link or a swapped folder. */
  async directory(folderId: string): Promise<string> {
    const folder = this.find(folderId);
    if (!folder) throw new Error(NOT_GRANTED);
    if (!await stillTheSame(folder)) throw new Error(FOLDER_UNAVAILABLE);
    return folder.directory;
  }

  wasHandled(routineId: string, arrival: Arrival): boolean {
    const row = this.store.db.prepare('SELECT 1 AS found FROM routine_arrivals WHERE routine_id=? AND name=? AND size=? AND modified_ms=?')
      .get(routineId, arrival.name, arrival.size, Math.trunc(arrival.modifiedMs));
    return Boolean(row);
  }

  /** Drops what a deleted routine had handled (COD-283); the folder grant stays, like a chat's folder grant. */
  forgetArrivals(routineId: string) {
    this.store.db.prepare('DELETE FROM routine_arrivals WHERE routine_id=?').run(routineId);
  }

  markHandled(routineId: string, arrivals: readonly Arrival[]) {
    const insert = this.store.db.prepare(`INSERT OR IGNORE INTO routine_arrivals(routine_id,name,size,modified_ms,handled_at)
      VALUES(?,?,?,?,?)`);
    const handledAt = now();
    this.store.transaction(() => {
      for (const arrival of arrivals) insert.run(routineId, arrival.name, arrival.size, Math.trunc(arrival.modifiedMs), handledAt);
      this.store.db.prepare(`DELETE FROM routine_arrivals WHERE routine_id=? AND rowid NOT IN (
        SELECT rowid FROM routine_arrivals WHERE routine_id=? ORDER BY handled_at DESC, rowid DESC LIMIT ?)`)
        .run(routineId, routineId, ARRIVALS_KEPT);
    });
  }
}
