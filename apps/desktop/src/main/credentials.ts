import { safeStorage } from 'electron';
import { readdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { ApiProvider, emptyConnections, type Connections, type CredentialProvider } from '../shared/contracts';
import { connectionIdOf, CUSTOM_PROVIDER_PREFIX, CustomProviderId } from '../shared/custom-connections';

/** Marker stored when the user turns on local Ollama (no billed key). */
export const OLLAMA_LOCAL_TOKEN = 'ollama-local';

const keyPattern: Record<ApiProvider, RegExp> = {
  openai: /^sk-[A-Za-z0-9_\-]{12,500}$/,
  anthropic: /^sk-[A-Za-z0-9_\-]{12,500}$/,
  xai: /^(?:xai-|sk-)[A-Za-z0-9_\-]{12,500}$/,
  openrouter: /^sk-or-[A-Za-z0-9_\-]{12,500}$/,
  // The OpenCode docs do not publish a key format, so accept any plain token of a plausible length.
  'opencode-zen': /^[A-Za-z0-9_\-]{16,500}$/,
  'opencode-go': /^[A-Za-z0-9_\-]{16,500}$/,
  ollama: /^(?:ollama-local|[A-Za-z0-9_\-]{8,500})$/,
};
/** A custom connection may be any server, so any visible token without spaces goes: Groq, Mistral, a proxy's own. */
const customKeyPattern = /^[\x21-\x7E]{1,500}$/;
const customKeyFile = /^custom-([0-9a-f-]{36})\.credential$/;

export class Credentials {
  constructor(private directory: string) {}
  /** A custom connection's key sits beside the built-in ones under its id; a colon cannot be in a Windows file name. */
  private path(provider: CredentialProvider) {
    const connectionId = connectionIdOf(provider);
    const name = connectionId ? `custom-${connectionId}` : provider;
    return join(this.directory, `${name}.credential`);
  }
  async read(provider: CredentialProvider): Promise<string | null> {
    try { return safeStorage.decryptString(await readFile(this.path(provider))); }
    catch { return null; }
  }
  async save(provider: CredentialProvider, key: string) {
    if (!safeStorage.isEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) throw new Error('OS credential storage không khả dụng.');
    const pattern = connectionIdOf(provider) ? customKeyPattern : keyPattern[provider as ApiProvider];
    if (!pattern.test(key)) throw new Error('API key không hợp lệ.');
    await writeFile(this.path(provider), safeStorage.encryptString(key), { mode: 0o600 });
  }
  async remove(provider: CredentialProvider) { await unlink(this.path(provider)).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; }); }
  /** Which keys exist and can be read back; never the keys. */
  async status(): Promise<Connections> {
    const connections = emptyConnections();
    for (const provider of ApiProvider.options) connections[provider] = Boolean(await this.read(provider));
    for (const connectionId of await this.customConnectionIds()) {
      const provider = CustomProviderId.safeParse(`${CUSTOM_PROVIDER_PREFIX}${connectionId}`);
      if (provider.success && await this.read(provider.data)) connections.custom[connectionId] = true;
    }
    return connections;
  }
  private async customConnectionIds(): Promise<string[]> {
    const names = await readdir(this.directory).catch(() => [] as string[]);
    return names.flatMap(name => {
      const match = customKeyFile.exec(name);
      return match ? [match[1]] : [];
    });
  }
}
