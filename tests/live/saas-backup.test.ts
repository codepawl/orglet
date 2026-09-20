import { describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { Backups } from '../../apps/desktop/src/core/storage/backup';
import type { Task } from '../../apps/desktop/src/shared/contracts';

const directory = process.env.ORGLET_LIVE_SAAS_BACKUP_DIR;

describe.runIf(!!directory)('live Tallyloom backup verification', () => {
  it('restores reports and scoped process evidence without local tool journals', async () => {
    const root = resolve(directory!);
    const original = new Store(join(root, 'orglet.sqlite'));
    const restored = new Store(':memory:');
    try {
      const task = original.all<Task>('tasks')[0];
      expect(['completed', 'partial', 'failed']).toContain(task.status);
      const backup = new Backups(original, () => false, () => {}).export();
      const manager = new Backups(restored, () => false, () => {});
      manager.restore(manager.preview(backup).token);
      const originalArtifacts = original.detail(task.id).artifacts.length;
      const restoredArtifacts = restored.detail(task.id).artifacts.length;
      const processEvidence = Number(restored.db.prepare('SELECT COUNT(*) AS count FROM process_evidence').get()!.count);
      const result = { taskStatus: task.status, originalArtifacts, restoredArtifacts,
        processEvidence, backupBytes: Buffer.byteLength(backup) };
      await writeFile(join(root, 'reports', 'backup-verification.json'), JSON.stringify(result, null, 2));
      expect(restoredArtifacts).toBe(originalArtifacts);
      expect(processEvidence).toBeGreaterThan(0);
    } finally {
      restored.close();
      original.close();
    }
  });
});
