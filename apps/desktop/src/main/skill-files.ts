import { lstat, realpath, opendir, open, mkdir } from 'node:fs/promises';
import { basename, join, relative, isAbsolute, dirname } from 'node:path';
import { PackageInput, SkillPath, SKILL_FILE_LIMIT, SKILL_PACKAGE_LIMIT } from '../shared/skill-package';

export async function readSkillDirectory(directory: string): Promise<PackageInput> {
  if ((await lstat(directory)).isSymbolicLink()) throw new Error('Không nhập skill qua symbolic link hoặc junction.');
  const root = await realpath(directory);
  const files: PackageInput['files'] = [];
  let total = 0; let entries = 0;
  async function walk(path: string, prefix: string, depth: number) {
    if (depth > 8) throw new Error('Skill có quá 8 cấp thư mục.');
    for await (const entry of await opendir(path)) {
      if (++entries > 200) throw new Error('Skill có quá 200 mục hoặc 100 tệp.');
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      SkillPath.parse(name);
      const source = join(path, entry.name); const before = await lstat(source);
      const resolved = await realpath(source); const within = relative(root, resolved);
      if (before.isSymbolicLink() || within.startsWith('..') || isAbsolute(within)) throw new Error('Skill chứa link hoặc đường dẫn ngoài thư mục đã chọn.');
      if (before.isDirectory()) { await walk(source, name, depth + 1); continue; }
      if (!before.isFile() || before.nlink !== 1 || before.size > SKILL_FILE_LIMIT || files.length >= 100) throw new Error('Skill chứa tệp đặc biệt, hard link hoặc vượt giới hạn kích thước.');
      const handle = await open(source, 'r');
      try {
        const stat = await handle.stat();
        if (stat.ino !== before.ino || stat.dev !== before.dev || !stat.isFile()) throw new Error('Tệp skill đã thay đổi khi đọc.');
        const buffer = Buffer.alloc(SKILL_FILE_LIMIT + 1);
        let length = 0;
        while (length < buffer.length) {
          const result = await handle.read(buffer, length, buffer.length - length, length);
          if (!result.bytesRead) break;
          length += result.bytesRead;
        }
        total += length;
        if (length > SKILL_FILE_LIMIT || total > SKILL_PACKAGE_LIMIT) throw new Error('Skill vượt giới hạn 256 KB mỗi tệp hoặc 1 MB mỗi gói.');
        const after = await handle.stat();
        if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs || await realpath(source) !== resolved) throw new Error('Tệp skill đã thay đổi khi đọc.');
        files.push({ path: name, base64: buffer.subarray(0, length).toString('base64') });
      } finally { await handle.close(); }
    }
  }
  await walk(root, '', 0);
  return PackageInput.parse({ directoryName: basename(root), files });
}

export async function writeSkillDirectory(parent: string, raw: unknown): Promise<string> {
  const input = PackageInput.parse(raw);
  const root = await realpath(parent);
  const destination = join(root, input.directoryName);
  // mkdir without recursive refuses an existing directory; exported packages never overwrite it.
  await mkdir(destination);
  try {
    for (const file of input.files) {
      const target = join(destination, ...file.path.split('/'));
      const folder = dirname(target);
      await mkdir(folder, { recursive: true });
      const resolved = await realpath(folder);
      const within = relative(destination, resolved);
      if (within.startsWith('..') || isAbsolute(within)) throw new Error('Thư mục xuất đã bị thay đổi.');
      const handle = await open(target, 'wx');
      try { await handle.writeFile(Buffer.from(file.base64, 'base64')); await handle.sync(); }
      finally { await handle.close(); }
    }
    return destination;
  } catch { throw new Error(`Xuất skill chưa hoàn tất. Kiểm tra thư mục mới: ${destination}. Gói trong Orglet vẫn được giữ nguyên.`); }
}
