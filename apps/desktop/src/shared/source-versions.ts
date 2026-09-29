/**
 * Names for a file the person edited in the viewer (COD-280). An edit never replaces the file it came from: it is
 * saved as a new source in the same chat, named after the original with a word in brackets, `invoice (edited).png`,
 * then `invoice (edited 2).png`. The word is the interface's own ("edited", "đã sửa"), passed in by the window.
 */

/** Characters Windows refuses in a file name, and control characters. */
const UNSAFE_CHARACTERS = /[<>:"|?*\u0000-\u001f]/;
const MAXIMUM_NAME_LENGTH = 255;
const MAXIMUM_FILE_NAME_LENGTH = 200;

/** A name split into the folder it was listed under (a folder import keeps it), its stem and its extension. */
type NameParts = { folder: string; stem: string; extension: string };

function partsOf(name: string): NameParts {
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  const folder = slash >= 0 ? name.slice(0, slash + 1) : '';
  const fileName = name.slice(slash + 1);
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) return { folder, stem: fileName, extension: '' };
  return { folder, stem: fileName.slice(0, dot), extension: fileName.slice(dot + 1) };
}

function escapeForPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The stem without an edit mark it already carries, so editing an edited copy counts on instead of nesting. */
function baseStem(stem: string, editedWord: string): string {
  const mark = new RegExp(`\\s\\(${escapeForPattern(editedWord)}(?:\\s\\d+)?\\)$`);
  return stem.replace(mark, '');
}

/**
 * The name of a new edited version of `originalName`, not yet used by any of `takenNames` (compared without case, as
 * Windows does). `extension` replaces the original's, for an image saved as PNG.
 */
export function versionName(originalName: string, takenNames: readonly string[], editedWord: string, extension?: string): string {
  const parts = partsOf(originalName);
  const stem = baseStem(parts.stem, editedWord) || parts.stem;
  const finalExtension = extension ?? parts.extension;
  const suffix = finalExtension ? `.${finalExtension}` : '';
  const taken = new Set(takenNames.map(name => name.toLowerCase()));
  for (let counter = 1; ; counter += 1) {
    const mark = counter === 1 ? editedWord : `${editedWord} ${counter}`;
    const candidate = `${parts.folder}${stem} (${mark})${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * Whether `name` can stand for an edited version of `originalName`: listed under the same folder, with the expected
 * extension, and every part of it a plain file or folder name (no `..`, no characters Windows refuses).
 */
export function isVersionNameFor(originalName: string, name: string, extension?: string): boolean {
  if (!name || name.length > MAXIMUM_NAME_LENGTH || name !== name.trim()) return false;
  if (UNSAFE_CHARACTERS.test(name)) return false;
  const segments = name.split(/[\\/]/);
  if (segments.some(segment => !segment || segment === '.' || segment === '..' || segment.endsWith('.') || segment.endsWith(' '))) return false;
  const original = partsOf(originalName);
  const candidate = partsOf(name);
  if (candidate.folder !== original.folder) return false;
  if (!candidate.stem || candidate.stem.length + candidate.extension.length + 1 > MAXIMUM_FILE_NAME_LENGTH) return false;
  const expected = (extension ?? original.extension).toLowerCase();
  return candidate.extension.toLowerCase() === expected;
}

/** The file name part of a source name, for the copy kept on disk. */
export function fileNameOf(name: string): string {
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  return name.slice(slash + 1);
}
