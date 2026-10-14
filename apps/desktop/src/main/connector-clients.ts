import { readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ConnectorClient, type McpSharedClientProvider } from '../shared/mcp';
import type { SecretEncryption } from './mcp-secrets';

/**
 * The OAuth client a person made once for a provider (Google Cloud, for the Google connectors), kept encrypted next to
 * the MCP secret files. Every server of that provider signs in with it. Only main reads the file: the window can ask
 * whether a client is saved and what its client ID is, never for the secret.
 */
export class ConnectorClientStore {
  constructor(private directory: string, private encryption: SecretEncryption, private platform: NodeJS.Platform = process.platform) {}

  private path(provider: McpSharedClientProvider) {
    return join(this.directory, `connector-client-${provider}.secrets`);
  }

  async read(provider: McpSharedClientProvider): Promise<ConnectorClient | undefined> {
    try {
      const text = this.encryption.decryptString(await readFile(this.path(provider)));
      return ConnectorClient.parse(JSON.parse(text));
    } catch {
      return undefined;
    }
  }

  /** An empty secret on the same client ID keeps the secret already saved, so editing the ID never asks for it again. */
  async save(provider: McpSharedClientProvider, client: ConnectorClient) {
    const values = ConnectorClient.parse(client);
    const saved = await this.read(provider);
    const clientSecret = values.clientSecret ?? (saved?.clientId === values.clientId ? saved.clientSecret : undefined);
    const basicText = this.platform === 'linux' && this.encryption.getSelectedStorageBackend?.() === 'basic_text';
    if (!this.encryption.isEncryptionAvailable() || basicText) throw new Error('OS credential storage không khả dụng.');
    const stored: ConnectorClient = { clientId: values.clientId, ...(clientSecret ? { clientSecret } : {}) };
    await writeFile(this.path(provider), this.encryption.encryptString(JSON.stringify(stored)), { mode: 0o600 });
  }

  async remove(provider: McpSharedClientProvider) {
    await unlink(this.path(provider)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}
