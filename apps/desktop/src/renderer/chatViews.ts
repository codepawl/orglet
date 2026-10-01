import type { Routine, Task } from '../shared/contracts';
import { isMemory, type Knowledge } from '../shared/knowledge';

/**
 * The views of the chat on screen (COD-355), like a Slack channel's Messages, Files and Canvas tabs: the chat itself,
 * the files it was given, what its runs changed in a working copy, the schedules that run as its orglet or crew, and
 * what that orglet or crew remembers. The chat is always first; another view is listed only while it has something
 * to show.
 */
export type ChatViewName = 'chat' | 'files' | 'changes' | 'schedules' | 'memory';

export const CHAT_VIEW_ORDER: readonly ChatViewName[] = ['chat', 'files', 'changes', 'schedules', 'memory'];

/** How many things each view would list. The chat has no count. */
export type ChatViewCounts = Record<Exclude<ChatViewName, 'chat'>, number>;

export type ChatViewEntry = { name: ChatViewName; count?: number };

export function availableChatViews(counts: ChatViewCounts): ChatViewEntry[] {
  return CHAT_VIEW_ORDER.flatMap((name): ChatViewEntry[] => {
    if (name === 'chat') return [{ name }];
    const count = counts[name];
    return count > 0 ? [{ name, count }] : [];
  });
}

/** The view to show: the one asked for while it is still listed, otherwise the chat. */
export function chatViewToShow(wanted: ChatViewName | undefined, available: readonly ChatViewEntry[]): ChatViewName {
  if (wanted && available.some(entry => entry.name === wanted)) return wanted;
  return 'chat';
}

/** Whose chat this is: one orglet or one crew. A group chat belongs to nobody in particular. */
export type ViewOwner = { kind: 'worker' | 'team'; id: string };

type OwnerTask = Pick<Task, 'workerId' | 'teamId' | 'assignees' | 'routineId'>;

/**
 * The orglet or crew a chat row belongs to: its main chat, a side thread under it, or a run of one of its schedules,
 * which runs as the schedule's orglet or crew.
 */
export function viewOwnerOfTask(task: OwnerTask, routines: readonly Pick<Routine, 'id' | 'task'>[]): ViewOwner | undefined {
  if (task.assignees) return undefined;
  if (task.routineId) {
    const routine = routines.find(item => item.id === task.routineId);
    if (routine) return routineOwner(routine);
  }
  if (task.teamId) return { kind: 'team', id: task.teamId };
  return { kind: 'worker', id: task.workerId };
}

function routineOwner(routine: Pick<Routine, 'task'>): ViewOwner {
  if (routine.task.teamId) return { kind: 'team', id: routine.task.teamId };
  return { kind: 'worker', id: routine.task.workerId };
}

/** The schedules that run as this orglet or crew. A crew's schedule is not also an orglet's. */
export function schedulesOf<Item extends Pick<Routine, 'task'>>(routines: readonly Item[], owner: ViewOwner | undefined): Item[] {
  if (!owner) return [];
  return routines.filter(routine => {
    const routineAs = routineOwner(routine);
    return routineAs.kind === owner.kind && routineAs.id === owner.id;
  });
}

/** What this orglet or crew remembered for itself, newest first; workspace memories stay in the Library. */
export function memoriesOf(knowledge: readonly Knowledge[], owner: ViewOwner | undefined): Knowledge[] {
  if (!owner) return [];
  return knowledge
    .filter(item => isMemory(item) && item.status !== 'archived' && item.scope.type === owner.kind && item.scope.id === owner.id)
    .sort((first, second) => second.createdAt.localeCompare(first.createdAt));
}
