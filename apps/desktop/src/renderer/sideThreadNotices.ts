import { useEffect, useRef } from 'react';
import type { Task, TaskStatus } from '../shared/contracts';
import { t } from './i18n';
import { toast } from './components/toast';

const BUSY: readonly TaskStatus[] = ['queued', 'running', 'pausing'];
const NEEDS_LOOK: readonly TaskStatus[] = ['failed', 'partial', 'interrupted', 'waiting_budget', 'waiting_input'];

export type FinishedSideThread = { id: string; workerId: string; name: string; failed: boolean };

/**
 * The side threads that stopped working since `previous` was taken (COD-247): busy then, done or stuck now. Only a
 * thread seen busy counts, so opening the app on finished threads announces nothing.
 */
export function finishedSideThreads(previous: ReadonlyMap<string, TaskStatus>, tasks: readonly Task[]): FinishedSideThread[] {
  const finished: FinishedSideThread[] = [];
  for (const task of tasks) {
    if (!task.sideOf || task.deletedAt) continue;
    const before = previous.get(task.id);
    if (!before || !BUSY.includes(before) || BUSY.includes(task.status) || task.status === 'paused' || task.status === 'cancelled') continue;
    finished.push({ id: task.id, workerId: task.workerId, name: task.title || task.brief.split('\n')[0].trim(), failed: NEEDS_LOOK.includes(task.status) });
  }
  return finished;
}

/** Each side thread's status now, to compare against on the next workspace. */
export function sideThreadStatuses(tasks: readonly Task[]): Map<string, TaskStatus> {
  return new Map(tasks.filter(task => task.sideOf).map(task => [task.id, task.status]));
}

/**
 * Announces a side thread that finished while the person was somewhere else, with Open (COD-247). The person stays
 * in the main chat when they start one, so without this the answer would land unseen; the thread's row in the
 * sidebar keeps its unread mark either way. Nothing is said about the thread already open.
 */
export function useSideThreadNotices(tasks: readonly Task[] | undefined, openChat: string | null, workerName: (workerId: string) => string | undefined, open: (taskId: string) => void) {
  const previous = useRef<Map<string, TaskStatus>>(undefined);
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    if (!tasks) return;
    const known = previous.current;
    previous.current = sideThreadStatuses(tasks);
    if (!known) return;
    for (const thread of finishedSideThreads(known, tasks)) {
      if (thread.id === openChat) continue;
      const author = workerName(thread.workerId) ?? 'Orglet';
      const text = thread.failed ? t('Chat phụ của {0} cần xem lại', [author]) : t('{0} đã trả lời trong chat phụ', [author]);
      // An answer that landed while the person was elsewhere is news, so it waits in Notifications (COD-255).
      toast(text, thread.failed ? 'error' : 'success', thread.name, { action: { label: t('Mở'), onSelect: () => openRef.current(thread.id) }, unread: true });
    }
  }, [tasks]);
}
