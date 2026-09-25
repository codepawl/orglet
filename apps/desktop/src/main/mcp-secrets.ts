import { readFile, unlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { readStartTimesNow, stillOurs, type ProcessIdentity } from '../core/tools/process-identity';
import { join } from 'node:path';
import { emptyMcpSecrets, McpSecrets } from '../shared/mcp';

/** The parts of Electron's safeStorage this store uses, so a test can hand in its own. */
export type SecretEncryption = {
  isEncryptionAvailable(): boolean;
  encryptString(text: string): Buffer;
  decryptString(data: Buffer): string;
  /** Linux only: `basic_text` means no real keyring, so nothing is stored. */
  getSelectedStorageBackend?(): string;
};

/**
 * The secret values of MCP servers (COD-241): one encrypted file per server next to the API key files, written and
 * read only here in main. The core asks for a server's values when it starts that server; the window never does.
 */
export class McpSecretStore {
  constructor(private directory: string, private encryption: SecretEncryption, private platform: NodeJS.Platform = process.platform) {}

  private path(serverId: string) {
    return join(this.directory, `mcp-${serverId}.secrets`);
  }

  async read(serverId: string): Promise<McpSecrets> {
    try {
      const text = this.encryption.decryptString(await readFile(this.path(serverId)));
      return McpSecrets.parse(JSON.parse(text));
    } catch {
      return emptyMcpSecrets();
    }
  }

  async save(serverId: string, secrets: McpSecrets) {
    const values = McpSecrets.parse(secrets);
    const empty = !Object.keys(values.env).length && !Object.keys(values.headers).length && !values.bearer;
    if (empty) {
      await this.remove(serverId);
      return;
    }
    const basicText = this.platform === 'linux' && this.encryption.getSelectedStorageBackend?.() === 'basic_text';
    if (!this.encryption.isEncryptionAvailable() || basicText) throw new Error('OS credential storage không khả dụng.');
    await writeFile(this.path(serverId), this.encryption.encryptString(JSON.stringify(values)), { mode: 0o600 });
  }

  async remove(serverId: string) {
    await unlink(this.path(serverId)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

/**
 * Stops MCP server processes and everything they started, synchronously, for app quit and for a core that died:
 * the core normally closes them itself, and this is what still runs when it cannot. Only a process whose id and
 * creation time both still match what the core reported is stopped; one that exited, had its id reused by another
 * program, or could not be checked in time is left alone.
 */
export function stopProcessTrees(processes: readonly ProcessIdentity[], platform: NodeJS.Platform = process.platform) {
  if (!processes.length) return;
  const live = readStartTimesNow(processes.map(entry => entry.pid), platform);
  for (const pid of stillOurs(processes, live)) {
    try {
      if (platform === 'win32') execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, timeout: 5000, stdio: 'ignore' });
      else process.kill(pid, 'SIGTERM');
    } catch {
      // Already exited.
    }
  }
}
