import { open, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export async function readBoundedText(path: string, maximum: number): Promise<string> {
  const file = await open(path, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maximum) throw new Error(`Chọn tệp văn bản tối đa ${maximum / 1024 / 1024} MB.`);
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of file.createReadStream({ autoClose: false })) {
      const buffer = Buffer.from(chunk); size += buffer.length;
      if (size > maximum) throw new Error('Tệp vượt giới hạn kích thước.');
      chunks.push(buffer);
    }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); }
    catch { throw new Error('Tệp phải dùng mã hóa UTF-8.'); }
  } finally { await file.close(); }
}

export async function writeAtomicText(path: string, text: string) {
  const temporary = `${path}.${randomUUID()}.tmp`; const file = await open(temporary, 'wx');
  try {
    try { await file.writeFile(text, 'utf8'); await file.sync(); } finally { await file.close(); }
    await rename(temporary, path);
  } catch (error) { await unlink(temporary).catch(() => {}); throw error; }
}
