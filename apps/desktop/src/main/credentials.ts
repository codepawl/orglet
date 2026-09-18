import { safeStorage } from 'electron';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { ApiProvider, emptyConnections, type Connections } from '../shared/contracts';

/** Marker stored when the user turns on local Ollama (no billed key). */
export const OLLAMA_LOCAL_TOKEN = 'ollama-local';

const keyPattern: Record<ApiProvider, RegExp> = {
  openai: /^sk-[A-Za-z0-9_\-]{12,500}$/,
  anthropic: /^sk-[A-Za-z0-9_\-]{12,500}$/,
  xai: /^(?:xai-|sk-)[A-Za-z0-9_\-]{12,500}$/,
  openrouter: /^sk-or-[A-Za-z0-9_\-]{12,500}$/,
  ollama: /^(?:ollama-local|[A-Za-z0-9_\-]{8,500})$/,
};

export class Credentials {
  constructor(private directory: string) {}
  private path(provider: ApiProvider) { return join(this.directory, `${provider}.credential`); }
  async read(provider: ApiProvider): Promise<string | null> {
    try { return safeStorage.decryptString(await readFile(this.path(provider))); }
    catch { return null; }
  }
  async save(provider: ApiProvider, key: string) {
    if (!safeStorage.isEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) throw new Error('OS credential storage không khả dụng.');
    if (!keyPattern[provider].test(key)) throw new Error('API key không hợp lệ.');
    await writeFile(this.path(provider), safeStorage.encryptString(key), { mode: 0o600 });
  }
  async remove(provider: ApiProvider) { await unlink(this.path(provider)).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; }); }
  async status(): Promise<Connections> {
    const connections = emptyConnections();
    for (const provider of ApiProvider.options) connections[provider] = Boolean(await this.read(provider));
    return connections;
  }
}
