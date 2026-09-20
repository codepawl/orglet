import type { ModelReply } from '../adapters/openai';
import type { Run } from '../../shared/contracts';
import { ModelReport } from './catalog';

/** Keep only field paths and schema codes; invalid model content never enters a checkpoint or activity event. */
export function sanitizeReportReply(run: Run, reply: ModelReply): ModelReply {
  if (reply.calls.length !== 1 || reply.calls[0].name !== 'submit_report') return reply;
  const call = reply.calls[0];
  let argumentsValue: unknown;
  try {
    argumentsValue = JSON.parse(call.arguments);
  } catch {
    return { calls: [], usage: reply.usage, validationFailure: { toolName: 'submit_report', issues: [{ path: 'arguments', code: 'invalid_json' }] } };
  }
  const parsed = ModelReport.safeParse(argumentsValue);
  if (parsed.success) {
    if (run.stage !== 'member' || !run.snapshot.assignment?.writeResources?.length || parsed.data.assignmentOutcome) return reply;
    return { calls: [], usage: reply.usage, validationFailure: { toolName: 'submit_report', issues: [
      { path: 'assignmentOutcome', code: 'invalid_type', expected: 'completed hoặc blocked' },
    ] } };
  }
  const issues = parsed.error.issues.slice(0, 8).map(issue => ({
    path: issue.path.map(part => String(part)).join('.') || 'report',
    code: issue.code,
    ...('expected' in issue && typeof issue.expected === 'string' ? { expected: issue.expected } : {}),
  }));
  return { calls: [], usage: reply.usage, validationFailure: { toolName: 'submit_report', issues } };
}

export function reportValidationMessage(failure: NonNullable<ModelReply['validationFailure']>): string {
  return `Báo cáo sai schema: ${failure.issues.map(issue => `${issue.path} (${issue.code}${issue.expected ? `, cần ${issue.expected}` : ''})`).join('; ')}.`;
}
