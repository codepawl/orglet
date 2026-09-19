import { RoutineInput, type Routine, type TaskInput, type Team, type Worker, type Skill, type Task } from '../../shared/contracts';
import { nextOccurrence } from '../../shared/schedule';
import { Store, id } from '../storage/database';
import { Sources, fingerprint } from '../tools/sources';
import { resolveWorkerModel } from '../models/resolve';

/** First tick after startup, a gap, or overdue delay above this is a miss — never auto-replayed. See docs/routines.md. */
export const ROUTINE_MISS_MS = 30_000;
export const SKIPPED_WHILE_INACTIVE = 'Đã bỏ qua lịch khi app không hoạt động hoặc còn lần chờ xử lý. Có thể chạy bù một lần.';

/** Catch-up is at most one pending prompt per routine. Startup, sleep, and late ticks defer instead of running a backlog. */
export function shouldDeferRoutine(now: number, nextDueAt: number, lastTick: number | null, pending: boolean) {
  const resumed = lastTick === null || now - lastTick > ROUTINE_MISS_MS;
  return resumed || now - nextDueAt > ROUTINE_MISS_MS || pending;
}

export class Routines {
  private lastTick: number | null = null;
  private ticking = false;
  private dispatching = new Set<string>();
  constructor(private store: Store, private sources: Sources, private notify: () => void, private dispatch: (input: TaskInput, next: Routine) => string, private clock: () => Date) {}
  isBusy() { return this.dispatching.size > 0; }
  configuration(input: TaskInput) {
    const team = input.teamId ? this.store.get<Team>('teams', input.teamId) : undefined;
    const workers = [...new Set(team ? [...team.memberIds, team.synthesizerId] : [input.workerId])].map(workerId => this.store.get<Worker>('workers', workerId));
    const skills = [...new Set(workers.map(worker => worker.skillId))].map(skillId => this.store.get<Skill>('skills', skillId));
    // ponytail: harness version is not part of the approval fingerprint (detection is async); a CLI update does not reset approval.
    const models = workers.map(worker => {
      if (worker.provider === 'demo') return { provider: worker.provider };
      const resolved = resolveWorkerModel(worker);
      return { provider: worker.provider, modelId: worker.modelId ?? null, model: resolved.id ?? null, pricingVersion: resolved.pricingVersion };
    });
    return fingerprint(JSON.stringify({ team, workers, skills, models }));
  }
  save(raw: unknown) {
    const input = RoutineInput.parse(raw);
    const previous = input.id ? this.store.get<Routine>('routines', input.id) : undefined;
    if (!previous && this.store.all('routines').length >= 100) throw new Error('Workspace đã có đủ 100 lịch. Sửa một lịch hiện có.');
    const routine: Routine = { ...input, id: input.id ?? id(), revision: (previous?.revision ?? 0) + 1, approvedConfig: this.configuration(input.task), nextDueAt: nextOccurrence(input.schedule, this.clock()), pending: null, ...(previous?.lastTaskId ? { lastTaskId: previous.lastTaskId } : {}) };
    this.store.put('routines', routine); this.notify(); return routine;
  }
  dismiss(routineId: string) {
    const routine = this.store.get<Routine>('routines', routineId);
    this.store.update('routines', { ...routine, revision: routine.revision + 1, pending: null }); this.notify();
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
    if (this.dispatching.has(routine.id)) throw new Error('Lịch đang được xử lý.');
    this.dispatching.add(routine.id);
    try {
      if (routine.approvedConfig !== this.configuration(routine.task)) throw new Error('Tí, skill, hội hoặc model đã đổi. Mở lịch, kiểm tra và lưu lại quyền chạy.');
      if (routine.lastTaskId && ['queued', 'running', 'pausing', 'paused', 'interrupted', 'waiting_budget', 'waiting_input'].includes(this.store.get<Task>('tasks', routine.lastTaskId).status)) throw new Error('Lần trước chưa kết thúc. Xử lý công việc đó trước khi chạy bù.');
      for (const sourceId of routine.task.sourceIds) await this.sources.verify(sourceId, routine.task.sourceIds);
      const current = this.store.get<Routine>('routines', routine.id);
      if (!current.enabled || current.revision !== routine.revision || current.approvedConfig !== this.configuration(current.task)) throw new Error('Lịch hoặc cấu hình đã thay đổi trong lúc kiểm tra.');
      const next = { ...current, pending: null, nextDueAt: new Date(current.nextDueAt) > at ? current.nextDueAt : nextOccurrence(current.schedule, at) };
      // Core commits this updated occurrence and the new task in one transaction.
      return this.dispatch(current.task, next);
    } finally { this.dispatching.delete(routine.id); }
  }
}

