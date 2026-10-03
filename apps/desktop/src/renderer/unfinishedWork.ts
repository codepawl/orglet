import type { Artifact, TaskDetail } from '../shared/contracts';

/**
 * The latest answer's unfinished parts, while the chat still waits on them: the answer came with limitations and
 * the turn can be retried. It is a state of the chat, not something the orglet said, so it ends the thread as a
 * card of its own beside its Retry and not as part of the answer. An earlier turn's limitations, and those of a
 * finished chat, stay with their answer as a record.
 */
export function unfinishedWork(detail: TaskDetail): { artifact: Artifact; limitations: readonly string[] } | undefined {
  if (['running', 'queued', 'pausing', 'completed', 'waiting_input'].includes(detail.task.status)) return undefined;
  const revision = detail.task.inputRevision ?? 0;
  const runs = detail.runs.filter(run => (run.snapshot.inputRevision ?? 0) === revision);
  // A group message is answered by each orglet's own reply, which keeps its own notes.
  if (runs.some(run => run.stage === 'group')) return undefined;
  const artifact = detail.artifacts.findLast(item => runs.some(run => run.id === item.runId && (!detail.task.teamSnapshot || run.stage === 'synthesis')));
  if (!artifact || artifact.report.format !== 'chat' || artifact.report.limitations.length === 0) return undefined;
  return { artifact, limitations: artifact.report.limitations };
}
