import { RoutineInput, type FolderIntake, type Routine, type TaskInput, type Team, type Worker, type Skill, type Task } from '../../shared/contracts';
import { nextOccurrence } from '../../shared/schedule';
import { triggerOf, type RoutineTrigger } from '../../shared/routine-triggers';
import { Store, id, now } from '../storage/database';
import type { RoutineFolders } from '../storage/routine-folders';
import { Sources, fingerprint } from '../tools/sources';
import { resolveWorkerModel } from '../models/resolve';
import { readCustomConnections } from '../storage/custom-connections';

/** First tick after startup, a gap, or overdue delay above this is a miss — never auto-replayed. See docs/routines.md. */
export const ROUTINE_MISS_MS = 30_000;
export const SKIPPED_WHILE_INACTIVE = 'Đã bỏ qua lịch khi app không hoạt động hoặc còn lần chờ xử lý. Có thể chạy bù một lần.';
const UNFINISHED_TASK_STATUSES: readonly Task['status'][] = ['queued', 'running', 'pausing', 'paused', 'interrupted', 'waiting_budget', 'waiting_input'];
const PREVIOUS_RUN_BEFORE_CATCH_UP = 'Lần trước chưa kết thúc. Xử lý công việc đó trước khi chạy bù.';
const PREVIOUS_RUN_BEFORE_EVENT = 'Lần trước của lịch này chưa kết thúc. Xử lý công việc đó rồi chạy lại.';
const ROUTINE_DISABLED = 'Lịch đang tắt. Bật lịch trong app rồi chạy lại.';
const TOO_MANY_SOURCES = 'Lịch có tối đa 20 nguồn. Bỏ bớt nguồn rồi chọn lại.';

/** Files an event brings to one run, on top of the routine's own sources, and the ones it had to leave out. */
export type RunAdditions = { sourceIds: string[]; excluded: FolderIntake['skipped'] };
const NO_ADDITIONS: RunAdditions = { sourceIds: [], excluded: [] };

/** Catch-up is at most one pending prompt per routine. Startup, sleep, and late ticks defer instead of running a backlog. */
export function shouldDeferRoutine(now: number, nextDueAt: number, lastTick: number | null, pending: boolean) {
  const resumed = lastTick === null || now - lastTick > ROUTINE_MISS_MS;
  return resumed || now - nextDueAt > ROUTINE_MISS_MS || pending;
}

export class Routines {
  private lastTick: number | null = null;
  private ticking = false;
  private dispatching = new Set<string>();
  constructor(private store: Store, private sources: Sources, private notify: () => void, private dispatch: (input: TaskInput, next: Routine) => string, private clock: () => Date, private folders: RoutineFolders) {}
  isBusy() { return this.dispatching.size > 0; }
  /**
   * The fingerprint saving approves. A clock routine keeps the exact shape it had before triggers existed, so an
   * update does not take away every routine's approval; any other trigger adds itself, and a folder its identity.
   */
  configuration(input: TaskInput, trigger?: RoutineTrigger) {
    const team = input.teamId ? this.store.get<Team>('teams', input.teamId) : undefined;
    const workers = [...new Set(team ? [...team.memberIds, team.synthesizerId] : [input.workerId])].map(workerId => this.store.get<Worker>('workers', workerId));
    const skills = [...new Set(workers.map(worker => worker.skillId))].map(skillId => this.store.get<Skill>('skills', skillId));
    // ponytail: harness version is not part of the approval fingerprint (detection is async); a CLI update does not reset approval.
    const models = workers.map(worker => {
      if (worker.provider === 'demo') return { provider: worker.provider };
      const resolved = resolveWorkerModel(worker, undefined, readCustomConnections(this.store));
      return { provider: worker.provider, modelId: worker.modelId ?? null, model: resolved.id ?? null, pricingVersion: resolved.pricingVersion };
    });
    const approved = triggerOf({ trigger });
    if (approved.kind === 'schedule') return fingerprint(JSON.stringify({ team, workers, skills, models }));
    const folder = approved.kind === 'folder' ? this.folders.identity(approved.folderId) : null;
    return fingerprint(JSON.stringify({ team, workers, skills, models, trigger: { kind: approved.kind, folder } }));
  }
  /** A folder trigger names a folder the picker granted; its name comes from the grant, not from the renderer. */
  private normalizedTrigger(trigger: RoutineTrigger | undefined): RoutineTrigger | undefined {
    if (trigger?.kind !== 'folder') return trigger;
    return { kind: 'folder', folderId: trigger.folderId, folderName: this.folders.nameOf(trigger.folderId) };
  }
  save(raw: unknown) {
    const input = RoutineInput.parse(raw);
    const previous = input.id ? this.store.get<Routine>('routines', input.id) : undefined;
    if (!previous && this.store.all('routines').length >= 100) throw new Error('Workspace đã có đủ 100 lịch. Sửa một lịch hiện có.');
    // A save that names no trigger keeps the one the routine has; switching back to the clock names `schedule`.
    const trigger = this.normalizedTrigger(input.trigger ?? previous?.trigger);
    const routine: Routine = { ...input, ...(trigger ? { trigger } : {}), id: input.id ?? id(), revision: (previous?.revision ?? 0) + 1, approvedConfig: this.configuration(input.task, trigger), nextDueAt: nextOccurrence(input.schedule, this.clock()), pending: null, ...(previous?.lastTaskId ? { lastTaskId: previous.lastTaskId } : {}) };
    this.store.put('routines', routine); this.notify(); return routine;
  }
  dismiss(routineId: string) {
    const routine = this.store.get<Routine>('routines', routineId);
    const { notice: _notice, ...rest } = routine;
    this.store.update('routines', { ...rest, revision: routine.revision + 1, pending: null }); this.notify();
  }
  /** Shows why an event did not start a run; the same reason again is not written twice. */
  note(routineId: string, reason: string) {
    const routine = this.store.get<Routine>('routines', routineId);
    if (routine.notice?.reason === reason) return;
    this.store.update('routines', { ...routine, notice: { at: now(), reason } });
    this.notify();
  }
  /** Whether the task this routine started last is still going or waiting for the person. */
  previousRunActive(routineId: string): boolean {
    const routine = this.store.get<Routine>('routines', routineId);
    if (!routine.lastTaskId) return false;
    return UNFINISHED_TASK_STATUSES.includes(this.store.get<Task>('tasks', routine.lastTaskId).status);
  }
  /** New files in a watched folder start one run with them attached (COD-245). */
  async runArrivals(routineId: string, additions: RunAdditions): Promise<string> {
    const routine = this.store.get<Routine>('routines', routineId);
    if (triggerOf(routine).kind !== 'folder') throw new Error('Lịch này không theo dõi thư mục.');
    return this.runEvent(routine, additions);
  }
  /** `orglet run`: an existing, enabled, approved routine starts now, whatever its trigger. It never creates or edits one. */
  async runCalled(routineId: string, sourceIds: string[]): Promise<string> {
    const routine = this.store.get<Routine>('routines', routineId);
    return this.runEvent(routine, { sourceIds, excluded: [] });
  }
  private async runEvent(routine: Routine, additions: RunAdditions): Promise<string> {
    if (!routine.enabled) throw new Error(ROUTINE_DISABLED);
    if (routine.task.sourceIds.length + additions.sourceIds.length > 20) throw new Error(TOO_MANY_SOURCES);
    return this.startRun(routine, withoutNotice, additions, PREVIOUS_RUN_BEFORE_EVENT);
  }
  async catchUp(routineId: string) {
    const routine = this.store.get<Routine>('routines', routineId);
    if (!routine.enabled || !routine.pending) throw new Error('Không có lần chạy bù đang chờ.');
    return this.runOccurrence(routine, this.clock());
  }
  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    const at = this.clock(); const timestamp = at.getTime();
    const previousTick = this.lastTick;
    this.lastTick = timestamp;
    try {
      for (const routine of this.store.all<Routine>('routines')) {
        if (triggerOf(routine).kind !== 'schedule') continue;
        if (!routine.enabled || new Date(routine.nextDueAt).getTime() > timestamp || this.dispatching.has(routine.id)) continue;
        if (shouldDeferRoutine(timestamp, new Date(routine.nextDueAt).getTime(), previousTick, Boolean(routine.pending))) {
          this.defer(routine, at, SKIPPED_WHILE_INACTIVE);
        } else {
          try { await this.runOccurrence(routine, at); }
          catch (error) {
            if (this.store.get<Routine>('routines', routine.id).revision === routine.revision) this.defer(routine, at, error instanceof Error ? error.message : 'Không thể bắt đầu lịch.');
          }
        }
      }
    } finally { this.ticking = false; }
  }
  private defer(routine: Routine, at: Date, reason: string) {
    this.store.update('routines', { ...routine, nextDueAt: nextOccurrence(routine.schedule, at), pending: { dueAt: routine.pending?.dueAt ?? routine.nextDueAt, reason } });
    this.notify();
  }
  private async runOccurrence(routine: Routine, at: Date): Promise<string> {
    const advanced = (current: Routine): Routine => ({ ...current, pending: null, nextDueAt: new Date(current.nextDueAt) > at ? current.nextDueAt : nextOccurrence(current.schedule, at) });
    return this.startRun(routine, advanced, NO_ADDITIONS, PREVIOUS_RUN_BEFORE_CATCH_UP);
  }
  /** The guards every run of a routine passes, on a clock or on an event, before core creates its task. */
  private async startRun(routine: Routine, next: (current: Routine) => Routine, additions: RunAdditions, previousRunMessage: string): Promise<string> {
    if (this.dispatching.has(routine.id)) throw new Error('Lịch đang được xử lý.');
    this.dispatching.add(routine.id);
    try {
      if (routine.approvedConfig !== this.configuration(routine.task, routine.trigger)) throw new Error('Tí, skill, hội hoặc model đã đổi. Mở lịch, kiểm tra và lưu lại quyền chạy.');
      if (this.previousRunActive(routine.id)) throw new Error(previousRunMessage);
      for (const sourceId of routine.task.sourceIds) await this.sources.verify(sourceId, routine.task.sourceIds);
      const current = this.store.get<Routine>('routines', routine.id);
      if (!current.enabled || current.revision !== routine.revision || current.approvedConfig !== this.configuration(current.task, current.trigger)) throw new Error('Lịch hoặc cấu hình đã thay đổi trong lúc kiểm tra.');
      const task: TaskInput = {
        ...current.task,
        sourceIds: [...current.task.sourceIds, ...additions.sourceIds],
        excludedSources: [...(current.task.excludedSources ?? []), ...additions.excluded],
      };
      // Core commits this updated occurrence and the new task in one transaction.
      return this.dispatch(task, next(current));
    } finally { this.dispatching.delete(routine.id); }
  }
}

/** An event run clears the note left by an earlier event that could not start. */
function withoutNotice(routine: Routine): Routine {
  const { notice: _notice, ...rest } = routine;
  return rest;
}
