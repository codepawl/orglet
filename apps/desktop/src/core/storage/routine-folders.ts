import { realpath, stat } from 'node:fs/promises';
import { z } from 'zod';
import { WatchFolderView } from '../../shared/routine-triggers';
import { Store, id, now } from './database';
import type { ResolvedDirectory } from './workspace-grants';

/**
 * Folders routines watch (COD-245). A folder gets here only from main's native picker, resolved the same way a chat's
 * workspace folder is; the renderer holds its id and name, never its path. The level is always read-only.
 */
const StoredFolder = z.object({
  id: z.uuid(), directory: z.string().min(1), device: z.string(), inode: z.string(), name: z.string().min(1),
  permissions: z.tuple([z.literal('read')]), createdAt: z.iso.datetime(),
}).strict();
type StoredFolder = z.infer<typeof StoredFolder>;

/** A file a folder trigger already handed to a run: the same name, size and time is never handed over again. */
export type Arrival = { name: string; size: number; modifiedMs: number };

const NOT_GRANTED = 'Thư mục theo dõi chưa được cấp quyền. Chọn lại thư mục trong lịch.';
export const FOLDER_UNAVAILABLE = 'Thư mục theo dõi không còn hoặc đã bị thay thế. Chọn lại thư mục trong lịch.';
/** Handled files kept per routine; older ones are forgotten, since a file older than these is in no one's baseline. */
const ARRIVALS_KEPT = 2000;

export class RoutineFolders {
  constructor(private store: Store) {}

  private find(folderId: string): StoredFolder | undefined {
    const row = this.store.db.prepare('SELECT data FROM routine_folders WHERE id=?').get(folderId);
    if (!row) return undefined;
    return StoredFolder.parse(JSON.parse(String(row.data)));
  }

  /** Keeps a folder the picker resolved and returns what the renderer may know about it. */
  add(resolved: ResolvedDirectory): WatchFolderView {
    const folder: StoredFolder = { id: id(), ...resolved, permissions: ['read'], createdAt: now() };
    this.store.db.prepare('INSERT INTO routine_folders(id,data) VALUES(?,?)').run(folder.id, JSON.stringify(StoredFolder.parse(folder)));
    return WatchFolderView.parse({ folderId: folder.id, name: folder.name });
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
    try {
      const canonical = await realpath(folder.directory);
      const identity = await stat(folder.directory, { bigint: true });
      const same = canonical === folder.directory && identity.isDirectory()
        && identity.dev.toString() === folder.device && identity.ino.toString() === folder.inode;
      if (!same) throw new Error(FOLDER_UNAVAILABLE);
    } catch {
      throw new Error(FOLDER_UNAVAILABLE);
    }
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
