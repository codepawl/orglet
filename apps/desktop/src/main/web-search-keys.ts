import { readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WebSearchKeyProvider } from '../shared/web-tools';
import type { SecretEncryption } from './mcp-secrets';

/** Exa's keys are UUIDs; any plain token of that order of length is accepted, so a changed format still saves. */
const keyPattern = /^[A-Za-z0-9_\-]{16,200}$/;

/**
 * Web search keys (COD-266): one encrypted file per provider next to the API key files, written and read only here in
 * main. The core asks for the key when it runs a search; the window only learns whether one is saved. Nothing here is
 * in the SQLite database, so backups, templates and Erase never see it.
 */
export class WebSearchKeys {
  constructor(private directory: string, private encryption: SecretEncryption, private platform: NodeJS.Platform = process.platform) {}

  private path(provider: WebSearchKeyProvider) {
    return join(this.directory, `search-${provider}.credential`);
  }

  async read(provider: WebSearchKeyProvider): Promise<string | null> {
    try {
      return this.encryption.decryptString(await readFile(this.path(provider)));
    } catch {
      return null;
    }
  }

  async save(provider: WebSearchKeyProvider, key: string) {
    const basicText = this.platform === 'linux' && this.encryption.getSelectedStorageBackend?.() === 'basic_text';
    if (!this.encryption.isEncryptionAvailable() || basicText) throw new Error('OS credential storage không khả dụng.');
    if (!keyPattern.test(key)) throw new Error('API key không hợp lệ.');
    await writeFile(this.path(provider), this.encryption.encryptString(key), { mode: 0o600 });
  }

  async remove(provider: WebSearchKeyProvider) {
    await unlink(this.path(provider)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }

  /** Which providers have a key that can still be read back; never the keys. */
  async status(): Promise<Record<WebSearchKeyProvider, boolean>> {
    const status = { exa: false };
    for (const provider of WebSearchKeyProvider.options) status[provider] = Boolean(await this.read(provider));
    return status;
  }
}
