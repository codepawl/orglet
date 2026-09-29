import { win32 } from 'node:path';

/**
 * Which copy of Orglet is running (COD-296). The `orglet` command and the Send to entry are shared by every copy on
 * the machine, so a copy rewrites them on start or on update only while they already point at it. Anything else, a
 * ZIP copy, a test build or another Setup install, leaves them alone until the person chooses it in Settings.
 */
export type InstallCopy = {
  /** The running Orglet.exe. */
  executable: string;
  /** For a Setup install, the folder above `app-x.y.z`, which stays the same across updates. A ZIP copy has none. */
  setupFolder?: string;
};

/**
 * Whose a shared entry is: nobody's, this copy's, or another copy's, named by the folder Settings shows for it. An
 * entry that does not read as Orglet's counts as nobody's.
 */
export type EntryOwner = { kind: 'none' } | { kind: 'this' } | { kind: 'other'; copy: string };

const VERSION_FOLDER = /^app-/i;

function samePath(first: string, second: string): boolean {
  const normalize = (path: string) => win32.normalize(path).replace(/[\\/]+$/, '').toLowerCase();
  return normalize(first) === normalize(second);
}

/**
 * Whether `executable` is this copy: its own Orglet.exe, or for a Setup install its launcher or the Orglet.exe of any
 * of its versions, so the entries still follow an update that moved the app to a new `app-x.y.z` folder.
 */
export function belongsToCopy(executable: string, copy: InstallCopy): boolean {
  if (samePath(executable, copy.executable)) return true;
  if (!copy.setupFolder) return false;
  const folder = win32.dirname(executable);
  if (samePath(folder, copy.setupFolder)) return true;
  const isVersionFolder = VERSION_FOLDER.test(win32.basename(folder));
  return isVersionFolder && samePath(win32.dirname(folder), copy.setupFolder);
}

/** The folder a copy is known by in Settings: a Setup install's own folder, or the folder a ZIP copy was unpacked to. */
export function copyFolder(executable: string): string {
  const folder = win32.dirname(executable);
  if (VERSION_FOLDER.test(win32.basename(folder))) return win32.dirname(folder);
  return folder;
}

export function sameFolder(first: string, second: string): boolean {
  return samePath(first, second);
}
