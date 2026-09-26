import type { Routine, Task, Team } from './contracts';
import { runBy } from './schedule-runs';

/**
 * What stops an orglet or crew from being archived or deleted (COD-286). The core refuses with a sentence built from
 * this, and the renderer reads the same answer to offer the way out beside that sentence (open the crew, open the
 * schedule), so the two never disagree about which crew or schedule is in the way. Pure: no store, no bridge.
 */
type CrewRow = Pick<Team, 'id' | 'name' | 'memberIds' | 'synthesizerId'>;
type ChatRow = Pick<Task, 'workerId' | 'teamId' | 'assignees'>;
type ScheduleRow = Pick<Routine, 'id' | 'name' | 'enabled'> & { task: ChatRow };

export type RemovalBlocker<C extends CrewRow, S extends ScheduleRow> =
  | { kind: 'crews'; crews: C[] }
  | { kind: 'schedule'; schedule: S };

/** The crews an orglet is in, as a member or as the lead who writes the crew's answer, in the crews' own order. */
export function crewsWithMember<C extends CrewRow>(crews: readonly C[], workerId: string): C[] {
  return crews.filter(crew => crew.memberIds.includes(workerId) || crew.synthesizerId === workerId);
}

/** The first thing to change before this orglet or crew can go: the crews it is in, then a schedule that still runs it. */
export function removalBlocker<C extends CrewRow, S extends ScheduleRow>(
  workspace: { teams: readonly C[]; routines: readonly S[] },
  kind: 'worker' | 'team',
  entityId: string,
): RemovalBlocker<C, S> | undefined {
  if (kind === 'worker') {
    const crews = crewsWithMember(workspace.teams, entityId);
    if (crews.length) return { kind: 'crews', crews };
  }
  const schedule = workspace.routines.find(item => item.enabled && runBy(item.task, kind, entityId));
  if (schedule) return { kind: 'schedule', schedule };
  return undefined;
}

/**
 * The refusal for an orglet that is still in crews, naming every one of them: before this only the first crew was
 * named, so removing it there and trying again met a second refusal (dogfood, 2026-09-26). Two crews read as a pair,
 * three or more are counted and listed, so the sentence stays short.
 */
export function leaveCrewsMessage(workerName: string, crewNames: readonly string[]): string {
  if (crewNames.length === 1) return `Bỏ ${workerName} khỏi hội ${crewNames[0]} trước.`;
  if (crewNames.length === 2) return `Bỏ ${workerName} khỏi hội ${crewNames[0]} và ${crewNames[1]} trước.`;
  return `Bỏ ${workerName} khỏi ${crewNames.length} hội trước: ${crewNames.join(', ')}.`;
}

/** The refusal for an orglet or crew that an enabled schedule still runs. */
export function stopScheduleMessage(scheduleName: string): string {
  return `Tắt hoặc xóa lịch ${scheduleName} trước.`;
}
