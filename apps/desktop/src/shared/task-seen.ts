import type { Task, TaskStatus } from './contracts';

/** Identity of the current finished result; changes when a new answer lands. */
export function taskResultStamp(task: Pick<Task, 'inputRevision' | 'lastArtifactId'>): string {
  return `${task.inputRevision ?? 0}:${task.lastArtifactId ?? ''}`;
}

/** Finished work is "seen" when the stored stamp matches the current result. */
export function taskResultSeen(task: Pick<Task, 'status' | 'inputRevision' | 'lastArtifactId' | 'seenStamp'>): boolean {
  if (task.status !== 'completed' && task.status !== 'partial') return true;
  return Boolean(task.seenStamp) && task.seenStamp === taskResultStamp(task);
}

export function isFinishedStatus(status: TaskStatus) {
  return status === 'completed' || status === 'partial';
}
