import { z } from 'zod';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { Finding, FindingCategory, Id, Report, SourceLocation, TeamPlan, PlanAssignment, type Run, type Task } from '../../shared/contracts';
import { ProfileArgs } from '../../shared/profiles';
import { RunAuditArgs } from '../../shared/run-audit';
import { Review } from '../../shared/review';
import { KnowledgeProposal } from '../../shared/knowledge';
import type { ToolCapability } from '../../shared/tool-policy';
import { hasCapability } from './policy';
const ModelTeamPlan = TeamPlan.extend({ assignments: z.array(PlanAssignment.required({ expectedOutput: true, dependsOn: true, writeResources: true })).min(1).max(4) });

export const needsReport = (run: Run) => run.stage === 'synthesis' && !!run.snapshot.team?.reviewPolicy?.requiredChecks.length;
const Recommendation = z.string().min(1).max(2000).nullable();
const CheckerIds = z.array(Id).max(20);
export const Proposals = z.array(KnowledgeProposal).max(3);
const Locations = z.array(SourceLocation).max(20);
const ModelFindingSchema = Finding.omit({ provenance: true }).extend({ category: FindingCategory, recommendation: Recommendation, checkerIds: CheckerIds, locations: Locations });
export const ModelReportSchema = Report.omit({ format: true }).extend({ review: Review, findings: z.array(ModelFindingSchema).max(50), limitations: z.array(z.string().min(1).max(2000)).max(30), knowledgeProposals: Proposals });
// Old persisted replies predate these fields. Defaults do not fabricate a recommendation or evidence.
const ModelFinding = ModelFindingSchema.extend({ category: FindingCategory.default('other'), recommendation: Recommendation.default(null), checkerIds: CheckerIds.default([]), locations: Locations.default([]) });
export const ModelReport = ModelReportSchema.extend({ review: Review.nullable().optional(), findings: z.array(ModelFinding).max(50), knowledgeProposals: Proposals.default([]) });

/**
 * A finding has to cite a source that was read, which `finalize` enforces. With nothing attached, every finding
 * the model writes fails that gate and the whole turn is lost, answer included: a user who simply wrote the word
 * "báo cáo" in a chat with no files got a partial failure and no reply (user, 2026-09-20). The model cannot see
 * the gate, so the run says the precondition out loud instead.
 */
export const NO_SOURCES_INSTRUCTION = 'No sources are attached to this chat. A finding must cite a source you read, so no finding can be supported here. Answer as a normal chat message; produce a report only if the user clearly wants a written document, and then with an empty findings array.';
export const SUBMIT_REPORT_DESCRIPTION = 'Finish with an evidence-backed report. Classify findings, provide a supported recommendation or null, and cite profile IDs returned by your checker calls or the provided preflight. Use no checker IDs for text-only findings. locations give 1-based inclusive line ranges inside text sources you read with read_source and cite; use an empty array when a finding has no specific lines. Never claim unperformed checks. Use recommendation ready_for_human_review only when review.checks is non-empty, every check passes, there are no conflicts and no critical findings; otherwise choose revision_required, rerun_required or insufficient_evidence. Finding identities and authorship are assigned by the app. knowledgeProposals may suggest at most three reusable, general lessons (no task-specific facts or secrets); they are stored for user review and never apply automatically. Use an empty array when nothing qualifies.';
const SUBMIT_PLAN_DESCRIPTION = 'Assign this user message to one or more listed team members. Use only those member ids. You may assign a subset. Each assignment brief is that worker\'s job for this turn. Each assignment should state expectedOutput, dependsOn (assigned worker ids whose committed results are required), and writeResources (relative workspace files or directories, empty for read-only work). Use empty dependencies for independent work. Ownership never grants file permissions. Do not invent workers or missing results.';
const REPLY_DESCRIPTION = 'Send your answer to the user as a normal chat message (Markdown allowed). Use this for questions, discussion and ordinary requests. Mention the sources you relied on by name. title: when the latest message has nameChat true, a short name for this chat (2 to 6 words, in the user\'s language, no quotes or trailing period); otherwise null. knowledgeProposals may suggest at most three reusable, general lessons for user review; use an empty array when nothing qualifies.';
const ChatTitle = z.string().trim().min(1).max(80).nullable();
const ChatReplySchema = z.object({ message: z.string().min(1).max(16000), title: ChatTitle, knowledgeProposals: Proposals }).strict();
export const ChatReply = ChatReplySchema.extend({ title: ChatTitle.default(null), knowledgeProposals: Proposals.default([]) });
// Local harnesses return one JSON answer: the message, plus a report only when one was asked for.
export const HarnessAnswerSchema = z.object({ message: z.string().min(1).max(16000), title: ChatTitle, report: ModelReportSchema.nullable() }).strict();
export const HarnessAnswer = z.object({ message: z.string().min(1).max(16000), title: ChatTitle.default(null), report: z.unknown().nullable() });
export const ReadArgs = z.object({ sourceId: z.string().uuid() }).strict();
export const SkillResourceArgs = z.object({ path: z.string().min(1).max(240) }).strict();
type ToolDefinition = {
  schema: z.ZodType;
  capability?: ToolCapability;
  timeoutMs: number;
  cancellation: 'cooperative' | 'synchronous';
  model: ChatCompletionTool;
};

function defineTool(name: string, description: string, schema: z.ZodType, modelSchema: z.ZodType,
  capability: ToolCapability | undefined, timeoutMs: number, cancellation: ToolDefinition['cancellation']): ToolDefinition {
  return { schema, capability, timeoutMs, cancellation,
    model: { type: 'function', function: { name, description, strict: true,
      parameters: z.toJSONSchema(modelSchema, { target: 'draft-7' }) } },
  };
}

export const toolDefinitions: Record<string, ToolDefinition> = {
  audit_run_log: defineTool('audit_run_log', 'Audit one selected structured run-log dataset with solution/run/split/metric/status/score columns. Direction must follow the declared metric. Summarizes repeat scores and failures, compares public/private ranks when comparable. Never executes code, recomputes the metric or automatically passes stability.', RunAuditArgs, RunAuditArgs, 'dataset.check', 25000, 'cooperative'),
  read_skill_resource: defineTool('read_skill_resource', 'Read a UTF-8 text resource from references/ or assets/ in the reviewed skill package. Never executes scripts or grants source permissions.', SkillResourceArgs, SkillResourceArgs, 'skill.read', 20000, 'synchronous'),
  profile_dataset: defineTool('profile_dataset', 'Run trusted full-coverage schema/row/null/distinct checks on 1–2 selected CSV, JSONL or Parquet sources. Optional idColumn checks duplicates and ID alignment/overlap. No arbitrary SQL, scripts or external access.', ProfileArgs, ProfileArgs, 'dataset.check', 25000, 'cooperative'),
  read_source: defineTool('read_source', 'Read an explicitly allowed UTF-8 text source by ID. No path or code execution.', ReadArgs, ReadArgs, 'source.read', 20000, 'cooperative'),
  submit_report: defineTool('submit_report', SUBMIT_REPORT_DESCRIPTION, ModelReport, ModelReportSchema, undefined, 20000, 'synchronous'),
  reply: defineTool('reply', REPLY_DESCRIPTION, ChatReply, ChatReplySchema, undefined, 20000, 'synchronous'),
  submit_plan: defineTool('submit_plan', SUBMIT_PLAN_DESCRIPTION, TeamPlan, ModelTeamPlan, undefined, 20000, 'synchronous'),
};

export function toolsFor(run: Run, task: Task): ChatCompletionTool[] {
  return Object.entries(toolDefinitions).filter(([name, definition]) => {
    if (run.stage === 'plan') return name === 'submit_plan';
    if (name === 'submit_plan' || (name === 'reply' && needsReport(run))) return false;
    return !definition.capability || hasCapability(run, task, definition.capability);
  }).map(([, definition]) => definition.model);
}

export function assertToolCall(run: Run, task: Task, name: string, argumentsText: string): void {
  if (!Object.hasOwn(toolDefinitions, name) || !toolsFor(run, task).some(tool => tool.type === 'function' && tool.function.name === name)) {
    throw new Error('Tool không được policy cho phép.');
  }
  toolDefinitions[name].schema.parse(JSON.parse(argumentsText));
}
