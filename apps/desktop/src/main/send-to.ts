import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join, win32 } from 'node:path';
import type { FolderIntake, Source } from '../shared/contracts';
import { ATTACHMENT_LIMIT, type IncomingFiles } from '../shared/incoming';
import { MEDIA_SOURCE_EXTENSIONS, TEXT_SOURCE_EXTENSIONS } from '../shared/source-kinds';
import { writeAtomicText } from './files';
import { SEND_TO_FLAG } from './launch-requests';

/**
 * Explorer's Send to menu (COD-246). A shortcut named Orglet in the person's own SendTo folder points at the Squirrel
 * stub (`%LOCALAPPDATA%\Orglet\Orglet.exe`), which never moves between updates and starts the current version with
 * the same arguments. Explorer adds the selected paths after the shortcut's own arguments, all in one start, and the
 * single-instance lock hands them to the running app. No registry key is written for it.
 */

export const SEND_TO_SHORTCUT_NAME = 'Orglet.lnk';

/** `--` ends Chromium's switches, so a path can never be read as one. */
export const SEND_TO_ARGUMENTS = `${SEND_TO_FLAG} --`;

/**
 * Left in the data folder when the person turns Send to off in Settings, so installs and updates leave it off, the
 * same way `cli-path-off` keeps the command off PATH.
 */
export const KEPT_OFF_SEND_TO_FILE = 'send-to-off';

export function isKeptOffSendTo(userData: string): boolean {
  return existsSync(join(userData, KEPT_OFF_SEND_TO_FILE));
}

export async function keepOffSendTo(userData: string, keep: boolean): Promise<void> {
  const file = join(userData, KEPT_OFF_SEND_TO_FILE);
  if (!keep) {
    await rm(file, { force: true });
    return;
  }
  await writeAtomicText(file, 'Send to Orglet was turned off in Orglet Settings. Delete this file or turn it back on to undo.\n');
}

export type ShortcutSpec = { target: string; args: string; description: string; icon: string };

/** How the shortcut file is read and written: Electron's shell on Windows, a fake in the tests. */
export type ShortcutFiles = {
  read: (path: string) => ShortcutSpec | undefined;
  write: (path: string, shortcut: ShortcutSpec) => Promise<void>;
  remove: (path: string) => Promise<void>;
};

export function sendToShortcut(target: string): ShortcutSpec {
  return { target, args: SEND_TO_ARGUMENTS, description: 'Send the selected files to an orglet', icon: target };
}

function sameShortcut(first: ShortcutSpec, second: ShortcutSpec): boolean {
  const sameTarget = first.target.toLowerCase() === second.target.toLowerCase();
  return sameTarget && first.args === second.args;
}

export class SendToInstaller {
  constructor(private readonly sendToFolder: string, private readonly target: string, private readonly files: ShortcutFiles) {}

  get shortcutPath(): string {
    return join(this.sendToFolder, SEND_TO_SHORTCUT_NAME);
  }

  isInstalled(): boolean {
    return this.files.read(this.shortcutPath) !== undefined;
  }

  async install(): Promise<void> {
    await this.files.write(this.shortcutPath, sendToShortcut(this.target));
  }

  async remove(): Promise<void> {
    await this.files.remove(this.shortcutPath);
  }

  /** Called on every start: a shortcut that is there is pointed at this build's launcher, and an absent one stays absent. */
  async refresh(): Promise<void> {
    const current = this.files.read(this.shortcutPath);
    if (!current) return;
    if (sameShortcut(current, sendToShortcut(this.target))) return;
    await this.install();
  }
}

export type PathKind = 'file' | 'folder' | 'missing';

/** What the intake needs from the machine: what a path is, and the app's own import of one file. */
export type SentFileChecks = {
  kindOf: (path: string) => Promise<PathKind>;
  importFile: (path: string) => Promise<Source>;
};

export const SKIP_NOT_A_PATH = 'Không phải đường dẫn tệp trên máy.';
export const SKIP_FOLDER = 'Là thư mục. Đính kèm thư mục bằng nút + trong ô soạn tin.';
export const SKIP_MISSING = 'Không tìm thấy tệp.';
export const SKIP_UNSUPPORTED = 'Định dạng chưa được hỗ trợ.';
export const SKIP_FULL = 'Đã chọn đủ 20 tệp.';
export const SKIP_UNREADABLE = 'Không đọc được tệp.';

const SUPPORTED_EXTENSIONS = new Set([...TEXT_SOURCE_EXTENSIONS, ...MEDIA_SOURCE_EXTENSIONS].map(extension => `.${extension}`));

/** A plain absolute path on this machine. Device paths (`\\?\`, `\\.\`) and relative ones are not what Explorer sends. */
export function isPlainAbsolutePath(path: string): boolean {
  if (path.includes('\0') || path.length > 32_767) return false;
  if (path.startsWith('\\\\?\\') || path.startsWith('\\\\.\\')) return false;
  return win32.isAbsolute(path);
}

function displayName(path: string): string {
  return win32.basename(path) || path;
}

/** The same file named twice, in any case, is one file. */
function withoutRepeats(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  return paths.filter(path => {
    const key = win32.normalize(path).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Why a path cannot be imported before the file is even opened, or undefined when it may be. */
async function reasonToSkip(path: string, checks: SentFileChecks): Promise<string | undefined> {
  if (!isPlainAbsolutePath(path)) return SKIP_NOT_A_PATH;
  const kind = await checks.kindOf(path);
  if (kind === 'folder') return SKIP_FOLDER;
  if (kind === 'missing') return SKIP_MISSING;
  if (!SUPPORTED_EXTENSIONS.has(win32.extname(path).toLowerCase())) return SKIP_UNSUPPORTED;
  return undefined;
}

/**
 * Imports files sent from Explorer the way the file picker's files are imported, one at a time so one bad file does
 * not cost the rest. Folders, unsupported kinds, files past the limit and files the import refuses are listed as
 * skipped with the reason, as the folder picker lists them.
 */
export async function importSentFiles(paths: readonly string[], checks: SentFileChecks, limit = ATTACHMENT_LIMIT): Promise<FolderIntake> {
  const intake: FolderIntake = { sources: [], skipped: [] };
  for (const path of withoutRepeats(paths)) {
    const name = displayName(path);
    const reason = await reasonToSkip(path, checks);
    if (reason) {
      intake.skipped.push({ name, reason });
      continue;
    }
    if (intake.sources.length >= limit) {
      intake.skipped.push({ name, reason: SKIP_FULL });
      continue;
    }
    try {
      intake.sources.push(await checks.importFile(path));
    } catch (error) {
      intake.skipped.push({ name, reason: error instanceof Error && error.message ? error.message : SKIP_UNREADABLE });
    }
  }
  return intake;
}

/** At most this many names travel to the window for the picker to show. */
const SHOWN_NAMES = 50;

/**
 * Files waiting for the person to pick a chat. Only the newest hand-off is kept: a second Send to replaces the
 * first. The window gets an id and the names; the paths stay here until the id is traded in.
 */
export class SentFilesHandOff {
  private pending: { id: string; paths: string[] } | undefined;

  offer(paths: readonly string[]): IncomingFiles {
    const unique = withoutRepeats(paths);
    const id = randomUUID();
    this.pending = { id, paths: unique };
    return { kind: 'files', id, count: unique.length, names: unique.slice(0, SHOWN_NAMES).map(displayName) };
  }

  /** The paths of that hand-off, once. A replaced or already taken id gives nothing. */
  take(id: string): string[] | undefined {
    if (this.pending?.id !== id) return undefined;
    const paths = this.pending.paths;
    this.pending = undefined;
    return paths;
  }

  drop(id: string): void {
    if (this.pending?.id === id) this.pending = undefined;
  }
}
