import { safeStorage } from 'electron';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export class Credentials {
  constructor(private directory: string) {}
  private path(provider: 'openai' | 'anthropic') { return join(this.directory, `${provider}.credential`); }
  async read(provider: 'openai' | 'anthropic'): Promise<string | null> {
    try { return safeStorage.decryptString(await readFile(this.path(provider))); }
    catch { return null; }
  }
  async save(provider: 'openai' | 'anthropic', key: string) {
    if (!safeStorage.isEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) throw new Error('OS credential storage không khả dụng.');
    if (!/^sk-[A-Za-z0-9_\-]{12,500}$/.test(key)) throw new Error('Tệp cần chứa một API key hợp lệ, không có nội dung khác.');
    await writeFile(this.path(provider), safeStorage.encryptString(key), { mode: 0o600 });
  }
  async remove(provider: 'openai' | 'anthropic') { await unlink(this.path(provider)).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; }); }
  async status() { return { openai: Boolean(await this.read('openai')), anthropic: Boolean(await this.read('anthropic')) }; }
}
