import { z } from 'zod';

/** Agent CLIs installed on the user's machine that Orglet can drive as a read-only review worker. */
export const HarnessId = z.enum(['claude-code', 'codex', 'cursor']);
export type HarnessId = z.infer<typeof HarnessId>;
export const harnessNames: Record<HarnessId, string> = { 'claude-code': 'Claude Code', codex: 'Codex', cursor: 'Cursor Agent' };
export const isHarness = (provider: string): provider is HarnessId => HarnessId.safeParse(provider).success;

export type HarnessInfo = {
  id: HarnessId;
  name: string;
  executable: string;
  version: string;
  /** From the CLI's own status command. `unknown` when that command is missing or unreadable. */
  auth: 'logged_in' | 'logged_out' | 'unknown';
  authDetail: string;
};
