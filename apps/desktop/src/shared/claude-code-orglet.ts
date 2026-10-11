import type { ClaudeCodeAgent } from './claude-code-import';
import type { WorkerInput } from './contracts';
import type { Effort } from './effort';

/** What the window knows when it turns a subagent into an orglet. */
export type OrgletImportContext = {
  /** The provider a new orglet starts on in this app (`defaultWorkerProvider`). */
  defaultProvider: WorkerInput['provider'];
  /** Whether the Claude Code harness is signed in and can run. */
  claudeCodeConnected: boolean;
  /** The skill a new orglet starts with. */
  defaultSkillId: string;
  /** Skills that already exist and can be used now (a package must have been reviewed), by lower-cased name. */
  usableSkills: ReadonlyMap<string, string>;
  /** Names of skills that exist, or are imported in this run, but wait for review. */
  waitingSkills: ReadonlySet<string>;
};

export type OrgletFromSubagent = { input: Pick<WorkerInput, 'name' | 'description' | 'instructions' | 'provider' | 'skillId' | 'modelId' | 'effort'>; notes: string[] };

const EFFORTS: Record<string, Effort> = { low: 'low', medium: 'medium', high: 'high', max: 'max', xhigh: 'max' };

/**
 * The orglet a subagent becomes. It gets no permission, folder or MCP grant: those are the person's to give. The
 * model is carried over only when Claude Code is connected here, and a skill only when it can be used now, because an
 * orglet cannot name a skill that still waits for review.
 */
export function orgletFromSubagent(agent: ClaudeCodeAgent, context: OrgletImportContext): OrgletFromSubagent {
  const notes: string[] = [];
  let provider = context.defaultProvider;
  let modelId: string | undefined;
  const model = agent.model?.trim();
  if (model && model.toLowerCase() !== 'inherit') {
    if (context.claudeCodeConnected) {
      provider = 'claude-code';
      modelId = model;
    } else {
      notes.push(`model: ${model} chưa được mang sang vì Claude Code chưa kết nối ở đây`);
    }
  }
  let effort: Effort | undefined;
  if (agent.effort) {
    effort = EFFORTS[agent.effort.toLowerCase()];
    if (agent.effort.toLowerCase() === 'xhigh') notes.push('effort: xhigh được đổi thành max');
    else if (!effort) notes.push(`effort: ${agent.effort.slice(0, 20)} không hợp lệ nên bị bỏ`);
  }
  let skillId = context.defaultSkillId;
  const named = agent.skills.map(skill => skill.toLowerCase());
  const usable = named.find(skill => context.usableSkills.has(skill));
  if (usable) skillId = context.usableSkills.get(usable)!;
  const unlinked = named.filter(skill => skill !== usable);
  if (unlinked.length) {
    const waiting = unlinked.filter(skill => context.waitingSkills.has(skill));
    if (waiting.length) notes.push(`skills: ${waiting.join(', ')} đang chờ review; chọn lại trong cài đặt của Tí sau khi review`);
    const others = unlinked.filter(skill => !context.waitingSkills.has(skill));
    if (others.length) notes.push(`skills: ${others.join(', ')} chưa được nối: mỗi Tí chỉ có một skill, hoặc skill chưa có trong Orglet`);
  }
  return {
    input: { name: agent.name, description: agent.description, instructions: agent.instructions, provider, skillId, ...(modelId ? { modelId } : {}), ...(effort ? { effort } : {}) },
    notes,
  };
}
