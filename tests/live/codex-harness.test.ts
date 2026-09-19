import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeHarness } from '../../apps/desktop/src/core/harness/exec';
import { candidates } from '../../apps/desktop/src/core/harness/detect';
import type { HarnessProgress } from '../../apps/desktop/src/shared/progress';

/**
 * Live Codex streaming acceptance. Runs the real CLI on this machine and spends the user's Codex plan, so it is
 * gated and never runs in CI:
 *
 *   $env:ORGLET_LIVE_CODEX = '1'
 *   pnpm test:live
 *
 * What it holds: `codex exec --json` reports whole items, so the window fills in steps. It must reach the window
 * with the model's reasoning before the answer, and with no activity steps, because Codex has no file tool here.
 */
const authorized = process.env.ORGLET_LIVE_CODEX === '1';

describe.runIf(authorized)('live Codex streaming', () => {
  it('streams its reasoning, then the answer, and claims no file steps', async () => {
    const executable = (await candidates('codex'))[0];
    expect(executable, 'Codex CLI is not installed on this machine').toBeTruthy();

    const directory = await mkdtemp(join(tmpdir(), 'orglet-live-codex-'));
    const updates: HarnessProgress[] = [];
    try {
      const result = await executeHarness({
        harness: 'codex',
        executable,
        cwd: directory,
        // Long enough that the model reasons before it answers; short enough to stay well inside the budget.
        prompt: 'Ba người góp 300 nghìn mua một món đồ, mỗi người 100 nghìn. Người bán giảm còn 250 nghìn và đưa lại 50 nghìn cho nhân viên. Nhân viên giữ 20 nghìn và trả lại mỗi người 10 nghìn. Vậy mỗi người trả 90 nghìn, ba người là 270 nghìn, cộng 20 nghìn nhân viên giữ là 290 nghìn. Mười nghìn còn lại đi đâu? Phân tích chỗ sai rồi lập bảng dòng tiền.',
        schema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'], additionalProperties: false },
        signal: AbortSignal.timeout(300_000),
        maxBudgetUsd: 0.3,
        onProgress: progress => updates.push(progress),
      });

      expect(updates.some(update => update.thinking.trim())).toBe(true);
      expect(updates.every(update => update.activity.length === 0)).toBe(true);
      const thinkingFirst = updates.findIndex(update => update.thinking.trim());
      const answerFirst = updates.findIndex(update => update.answer.trim());
      expect(thinkingFirst).toBeLessThan(answerFirst === -1 ? Number.MAX_SAFE_INTEGER : answerFirst);
      expect((result.output as { message?: string }).message).toBeTruthy();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 300_000);
});
