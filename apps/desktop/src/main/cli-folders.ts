import { realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, parse, relative, resolve } from 'node:path';
import { CliFailure } from './cli-chats';

/**
 * The folder a terminal names in place of the native picker. The picker lets a person click any folder, and the core
 * only checks that the path is an absolute directory, so a path typed in a terminal gets the refusals here: it has to
 * exist, and it may not be a drive root, the home folder itself, or the data folder (or anything that contains it).
 */

const SAME_ON_WINDOWS = process.platform === 'win32';

function comparable(path: string): string {
  const normal = resolve(path);
  return SAME_ON_WINDOWS ? normal.toLowerCase() : normal;
}

/** Whether `inner` is `outer` or sits below it. */
function isInside(outer: string, inner: string): boolean {
  const path = relative(comparable(outer), comparable(inner));
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

async function realOrSelf(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

export type FolderPlaces = { dataFolder: string; homeFolder: string };

/** The canonical path of a folder a terminal may grant, or the reason it may not. */
export async function checkedFolder(typed: string, places: FolderPlaces): Promise<string> {
  if (!isAbsolute(typed)) throw new CliFailure('invalid', 'Đường dẫn thư mục phải là đường dẫn đầy đủ, bắt đầu từ ổ đĩa hoặc gốc.');
  let real: string;
  try {
    real = await realpath(typed);
  } catch {
    throw new CliFailure('not_found', 'Thư mục này không tồn tại.');
  }
  if (!(await stat(real)).isDirectory()) throw new CliFailure('invalid', 'Đường dẫn này không phải thư mục.');
  if (comparable(parse(real).root) === comparable(real)) throw new CliFailure('failed', 'Không cấp cả một ổ đĩa. Chọn một thư mục bên trong.');
  if (comparable(real) === comparable(await realOrSelf(places.homeFolder))) throw new CliFailure('failed', 'Không cấp cả thư mục cá nhân. Chọn một thư mục bên trong.');
  const data = await realOrSelf(places.dataFolder);
  if (isInside(data, real) || isInside(real, data)) throw new CliFailure('failed', 'Không cấp thư mục dữ liệu của Orglet hay thư mục chứa nó.');
  return real;
}

/** Where a backup may be written: a new file name in a folder that exists, outside the data folder. */
export async function checkedBackupPath(typed: string, places: FolderPlaces): Promise<string> {
  if (!isAbsolute(typed)) throw new CliFailure('invalid', 'Đường dẫn tệp sao lưu phải là đường dẫn đầy đủ.');
  const folder = await checkedExistingFolder(dirname(typed));
  const data = await realOrSelf(places.dataFolder);
  if (isInside(data, folder)) throw new CliFailure('failed', 'Không ghi bản sao lưu vào thư mục dữ liệu của Orglet.');
  const existing = await stat(typed).catch(() => undefined);
  if (existing?.isDirectory()) throw new CliFailure('invalid', 'Đường dẫn này là một thư mục, không phải tên tệp.');
  return join(folder, basename(typed));
}

async function checkedExistingFolder(path: string): Promise<string> {
  try {
    const real = await realpath(path);
    if ((await stat(real)).isDirectory()) return real;
  } catch {
    // Falls through to the same sentence.
  }
  throw new CliFailure('not_found', 'Thư mục chứa tệp sao lưu không tồn tại.');
}
