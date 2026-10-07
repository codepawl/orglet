import { RoutineInput, type FolderIntake, type Routine, type RoutineToday, type TaskInput, type Team, type Worker, type Skill, type Task } from '../../shared/contracts';
import { DAILY_CAP_REACHED, SKIPPED_PREVIOUS_RUNNING, SKIPPED_WHILE_INACTIVE, nextOccurrence, normalizedSchedule, scheduleDay, type Schedule } from '../../shared/schedule';
import { triggerOf, type RoutineTrigger, type RoutineWorkspace } from '../../shared/routine-triggers';
import { Store, id } from '../storage/database';
import type { RoutineFolders } from '../storage/routine-folders';
import type { ResolvedDirectory } from '../storage/workspace-grants';
import { WorkspacePermissions, type WorkspacePermission } from '../../shared/workspace-access';
import { permissionsForLevel, workspaceLevelOf } from '../../shared/capability-status';
import { snapshotCapabilities, type ToolCapability } from '../../shared/tool-policy';
import { Sources, fingerprint } from '../tools/sources';
import { resolveWorkerModel } from '../models/resolve';
import { readCustomConnections } from '../storage/custom-connections';
import { defaultBrowserChoice } from '../../shared/browser';
import { DailyCapReached } from '../budgets/ledger';
import { UNFINISHED_TASK_STATUSES, daysSoFar, fitsDailyCap } from '../budgets/daily-cap';

/** First tick after startup, a gap, or overdue delay above this is a miss — never auto-replayed. See docs/routines.md. */
export const ROUTINE_MISS_MS = 30_000;
export { SKIPPED_WHILE_INACTIVE };
const PREVIOUS_RUN_BEFORE_CATCH_UP = 'Lần trước chưa kết thúc. Xử lý công việc đó trước khi chạy bù.';
const PREVIOUS_RUN_BEFORE_EVENT = 'Lần trước của lịch này chưa kết thúc. Xử lý công việc đó rồi chạy lại.';
const ROUTINE_DISABLED = 'Lịch đang tắt. Bật lịch trong app rồi chạy lại.';
const TOO_MANY_SOURCES = 'Lịch có tối đa 20 nguồn. Bỏ bớt nguồn rồi chọn lại.';
/** A run's changes still wait in its chat, so the next run would work from a folder without them (COD-294). */
export const PREVIOUS_CHANGES_WAIT = 'Thay đổi của lần chạy trước vẫn chờ bạn xem. Mở lần chạy đó, áp dụng hoặc bỏ thay đổi rồi chạy lại.';

/** The folder one run of a routine gets as its chat's grant: resolved just now, at the routine's level (COD-294). */
export type RoutineRunFolder = { resolved: ResolvedDirectory; permissions: WorkspacePermission[] };

/** A routine's working folder is gone or replaced: the run does not start and the card says why until the next save. */
class WorkFolderUnavailable extends Error {}

/** The routine's previous run is still going or its changes still wait for the person, so this run did not start. */
class PreviousRunBusy extends Error {}

/** A daily cap below one run's limit would never let a run start. */
const CAP_BELOW_RUN_LIMIT = 'Giới hạn mỗi ngày cần ít nhất bằng giới hạn mỗi lần chạy.';

/**
 * An hourly schedule runs again within the hour, so a run it could not start is skipped with a note on its card, and
 * its next on-time run replaces a waiting catch-up; waiting for the person first would stop it for the day.
 */
function runsHourly(routine: Routine): boolean {
  return routine.schedule.frequency === 'hours' && triggerOf(routine).kind === 'schedule';
}

/**
 * What saving approves about how often and how much a clock runs a routine (COD-288): an hourly or weekday cadence and
 * the daily cap. Undefined for a daily or weekly routine without a cap, so their fingerprint stays what it was.
 */
export function scheduleApproval(schedule: Schedule | undefined) {
  if (!schedule) return undefined;
  const cadence = schedule.frequency === 'hours'
    ? { frequency: schedule.frequency, everyHours: schedule.everyHours, window: schedule.window ?? null, weekdaysOnly: schedule.weekdaysOnly === true }
    : schedule.frequency === 'weekdays' ? { frequency: schedule.frequency } : undefined;
  const cap = schedule.dailyCapMicros;
  if (!cadence && cap === undefined) return undefined;
  return { ...(cadence ? { cadence } : {}), ...(cap !== undefined ? { dailyCapMicros: cap } : {}) };
}

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
  constructor(private store: Store, private sources: Sources, private notify: () => void, private dispatch: (input: TaskInput, next: Routine, folder?: RoutineRunFolder) => string, private clock: () => Date, private folders: RoutineFolders) {}
  isBusy() { return this.dispatching.size > 0; }
  /**
   * The fingerprint saving approves. A clock routine keeps the exact shape it had before triggers existed, so an
   * update does not take away every routine's approval; any other trigger adds itself, and a folder its identity.
   */
  configuration(input: TaskInput, trigger?: RoutineTrigger, workspace?: RoutineWorkspace, schedule?: Schedule) {
    const team = input.teamId ? this.store.get<Team>('teams', input.teamId) : undefined;
    const workers = [...new Set(team ? [...team.memberIds, team.synthesizerId] : [input.workerId])].map(workerId => this.store.get<Worker>('workers', workerId));
    const skills = [...new Set(workers.map(worker => worker.skillId))].map(skillId => this.store.get<Skill>('skills', skillId));
    // ponytail: harness version is not part of the approval fingerprint (detection is async); a CLI update does not reset approval.
    const models = workers.map(worker => {
      if (worker.provider === 'demo') return { provider: worker.provider };
      const resolved = resolveWorkerModel(worker, undefined, readCustomConnections(this.store));
      return { provider: worker.provider, modelId: worker.modelId ?? null, model: resolved.id ?? null, pricingVersion: resolved.pricingVersion };
    });
    // A schedule that reads pages approves its profile and site list too (COD-261), and one with a working folder
    // approves the folder's identity, its level and whether changes wait for review (COD-294). One with neither keeps
    // the exact shape it always had, so these changes take no approval away.
    const browser = routineBrowserApproval(input);
    const folder = workspace ? this.workspaceApproval(workspace) : undefined;
    // An hourly or weekday cadence and a daily cap are approved the same way (COD-288): a row hand-edited from daily to
    // hourly, or stripped of its cap, does not run until it is saved again.
    const cadence = scheduleApproval(schedule);
    const approved = triggerOf({ trigger });
    const base = approved.kind === 'schedule'
      ? { team, workers, skills, models }
      : { team, workers, skills, models, trigger: { kind: approved.kind, folder: approved.kind === 'folder' ? this.folders.identity(approved.folderId) : null, ...(approved.kind === 'app' ? { app: { serverId: approved.serverId, tool: approved.tool, arguments: approved.arguments } } : {}) } };
    return fingerprint(JSON.stringify({ ...base, ...(browser ? { browser } : {}), ...(folder ? { workspace: folder } : {}), ...(cadence ? { schedule: cadence } : {}) }));
  }
  /** What saving approves about a working folder: which folder on disk (path, volume, file id), how far, and review. */
  private workspaceApproval(workspace: RoutineWorkspace) {
    return { folder: this.folders.identity(workspace.folderId), level: workspaceLevelOf(workspace.permissions), review: workspace.review };
  }
  /** A folder trigger names a folder the picker granted; its name comes from the grant, not from the renderer. */
  private normalizedTrigger(trigger: RoutineTrigger | undefined): RoutineTrigger | undefined {
    if (trigger?.kind !== 'folder') return trigger;
    return { kind: 'folder', folderId: trigger.folderId, folderName: this.folders.nameOf(trigger.folderId) };
  }
  /**
   * A working folder names a folder the picker granted at this level or wider (COD-294); its name comes from the grant.
   * A crew hands each member's changes in as it finishes, since the next member works from them, so a crew's schedule
   * never holds them for review.
   */
  private normalizedWorkspace(workspace: RoutineWorkspace | undefined, task: TaskInput): RoutineWorkspace | undefined {
    if (!workspace) return undefined;
    const permissions = WorkspacePermissions.parse(permissionsForLevel(workspaceLevelOf(workspace.permissions)));
    const folderName = this.folders.workFolderName(workspace.folderId, permissions);
    const review = task.teamId ? false : workspace.review;
    return { folderId: workspace.folderId, folderName, permissions, review };
  }
  save(raw: unknown) {
    const input = RoutineInput.parse(raw);
    if (input.task.toolCapabilities?.includes('browser.act')) throw new Error(SCHEDULE_NEVER_ACTS);
    if (input.task.toolCapabilities?.includes('desktop.read') || input.task.desktop?.apps.length) throw new Error(SCHEDULE_NO_DESKTOP);
    const previous = input.id ? this.store.get<Routine>('routines', input.id) : undefined;
    if (!previous && this.store.all('routines').length >= 100) throw new Error('Workspace đã có đủ 100 lịch. Xóa hoặc sửa một lịch hiện có.');
    // A save that names no trigger keeps the one the routine has; switching back to the clock names `schedule`.
    const trigger = this.normalizedTrigger(input.trigger ?? previous?.trigger);
    // The same for the working folder (COD-294): left out keeps it, `null` takes it away.
    const workspace = this.normalizedWorkspace(input.workspace === undefined ? previous?.workspace : input.workspace ?? undefined, input.task);
    const schedule = normalizedSchedule(input.schedule);
    if (schedule.dailyCapMicros !== undefined && schedule.dailyCapMicros < input.task.budgetMicros) throw new Error(CAP_BELOW_RUN_LIMIT);
    const { workspace: _workspace, ...rest } = input;
    const routine: Routine = { ...rest, schedule, ...(trigger ? { trigger } : {}), ...(workspace ? { workspace } : {}), id: input.id ?? id(), revision: (previous?.revision ?? 0) + 1, approvedConfig: this.configuration(input.task, trigger, workspace, schedule), nextDueAt: nextOccurrence(schedule, this.clock()), pending: null, ...(previous?.lastTaskId ? { lastTaskId: previous.lastTaskId } : {}) };
    this.store.put('routines', routine); this.notify(); return routine;
  }
  /**
   * Deletes a routine (COD-283). Its past runs are chats and stay: each keeps `routineId`, so it is still a schedule's
   * run with a schedule's limits, and takes the routine's name as `routineName`, so it still says where it came from.
   * The files a folder trigger already handled go with the routine.
   */
  remove(routineId: string) {
    if (this.dispatching.has(routineId)) throw new Error('Lịch đang được xử lý.');
    const routine = this.store.get<Routine>('routines', routineId);
    this.store.transaction(() => {
      for (const task of this.store.all<Task>('tasks')) {
        if (task.routineId === routineId) this.store.patchTask(task.id, { routineName: routine.name });
      }
      this.folders.forgetArrivals(routineId);
      this.store.sync.deleteEntity('routine', routineId);
      this.store.db.prepare('DELETE FROM routines WHERE id=?').run(routineId);
    });
    this.notify();
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
    this.store.update('routines', { ...routine, notice: { at: this.clock().toISOString(), reason } });
    this.notify();
  }
  /**
   * Each routine's runs and spend so far today, in its own time zone, for its card (COD-288). The spend is what the
   * ledger holds for the day's runs: settled charges plus what is still held or unknown.
   */
  today(): Record<string, RoutineToday> {
    const at = this.clock();
    const days: Record<string, string> = {};
    for (const routine of this.store.all<Routine>('routines')) days[routine.id] = scheduleDay(at, routine.schedule.timeZone);
    const totals = daysSoFar(this.store, days);
    const today: Record<string, RoutineToday> = {};
    for (const [routineId, day] of Object.entries(days)) today[routineId] = { day, ...totals[routineId] };
    return today;
  }
  /**
   * The day a run of this routine starting now counts against, checked against the daily cap. Core calls it inside the
   * transaction that writes the run's task, so two starts can never both take the last of the day's cap.
   */
  admitRun(routine: Routine, budgetMicros: number): string {
    const day = scheduleDay(this.clock(), routine.schedule.timeZone);
    if (!fitsDailyCap(this.store, routine, day, budgetMicros)) throw new DailyCapReached(DAILY_CAP_REACHED);
    return day;
  }
  /** Whether the task this routine started last is still going or waiting for the person. */
  previousRunActive(routineId: string): boolean {
    const routine = this.store.get<Routine>('routines', routineId);
    if (!routine.lastTaskId) return false;
    return UNFINISHED_TASK_STATUSES.includes(this.store.get<Task>('tasks', routine.lastTaskId).status);
  }
  /** Whether the run this routine started last still holds changes for the person to apply or discard (COD-294). */
  previousChangesWait(routineId: string): boolean {
    const routine = this.store.get<Routine>('routines', routineId);
    if (!routine.lastTaskId) return false;
    return this.store.heldForReview().includes(routine.lastTaskId);
  }
  /**
   * The routine's working folder for this run, checked on disk now. A folder that is gone or was replaced at the same
   * path stops the run, and the card says so until the schedule is saved again.
   */
  private async runFolder(routine: Routine): Promise<RoutineRunFolder> {
    const workspace = routine.workspace!;
    try {
      const resolved = await this.folders.workFolder(workspace.folderId);
      return { resolved, permissions: [...workspace.permissions] };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.note(routine.id, reason);
      throw new WorkFolderUnavailable(reason);
    }
  }
  /**
   * The permissions a run with a working folder starts with: the routine's own, or its lead's defaults, with
   * `workspace.apply` exactly when the schedule turned review off, so the run's hand-in follows the schedule (COD-294).
   */
  private runCapabilities(routine: Routine, workspace: RoutineWorkspace): ToolCapability[] {
    const lead = this.store.get<Worker>('workers', routine.task.workerId);
    const base = routine.task.toolCapabilities ?? snapshotCapabilities(lead.provider);
    const withoutApply = base.filter(capability => capability !== 'workspace.apply');
    if (workspace.review) return withoutApply;
    return [...withoutApply, 'workspace.apply'];
  }
  /** New files in a watched folder (COD-245), or new items from an app (stage 4), start one run with them attached. */
  async runArrivals(routineId: string, additions: RunAdditions): Promise<string> {
    const routine = this.store.get<Routine>('routines', routineId);
    const kind = triggerOf(routine).kind;
    if (kind !== 'folder' && kind !== 'app') throw new Error('Lịch này không theo dõi thư mục hay ứng dụng.');
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
      for (const listed of this.store.all<Routine>('routines')) {
        // A run awaited above may have given the person time to delete a later routine in the list.
        const found = this.store.all<Routine>('routines').find(item => item.id === listed.id);
        if (!found) continue;
        const routine = this.forgetYesterdaysCap(found, at);
        if (triggerOf(routine).kind !== 'schedule') continue;
        if (!routine.enabled || new Date(routine.nextDueAt).getTime() > timestamp || this.dispatching.has(routine.id)) continue;
        const pendingBlocks = Boolean(routine.pending) && !runsHourly(routine);
        if (shouldDeferRoutine(timestamp, new Date(routine.nextDueAt).getTime(), previousTick, pendingBlocks)) {
          this.defer(routine, at, SKIPPED_WHILE_INACTIVE);
        } else {
          try { await this.runOccurrence(routine, at); }
          catch (error) {
            const current = this.store.get<Routine>('routines', routine.id);
            // A missing folder is not a miss to catch up: running it again fails the same way until the schedule is
            // saved with a folder that is there. The card already carries the reason; the calendar moves on. A day
            // whose cap is reached skips its remaining runs the same way (COD-288).
            if (error instanceof WorkFolderUnavailable || error instanceof DailyCapReached) this.advance(current, at);
            else if (error instanceof PreviousRunBusy && runsHourly(current)) this.skip(current, at, error.message === PREVIOUS_CHANGES_WAIT ? PREVIOUS_CHANGES_WAIT : SKIPPED_PREVIOUS_RUNNING);
            else if (current.revision === routine.revision) this.defer(routine, at, error instanceof Error ? error.message : 'Không thể bắt đầu lịch.');
          }
        }
      }
    } finally { this.ticking = false; }
  }
  private advance(routine: Routine, at: Date) {
    this.store.update('routines', { ...routine, nextDueAt: nextOccurrence(routine.schedule, at) });
    this.notify();
  }
  /** An hourly run that could not start moves on to the next time and says why on the card, once (COD-288). */
  private skip(routine: Routine, at: Date, reason: string) {
    const notice = routine.notice?.reason === reason ? routine.notice : { at: at.toISOString(), reason };
    this.store.update('routines', { ...routine, notice, nextDueAt: nextOccurrence(routine.schedule, at) });
    this.notify();
  }
  /** The note that the daily cap was reached is about that day; the next day starts without it (COD-288). */
  private forgetYesterdaysCap(routine: Routine, at: Date): Routine {
    if (routine.notice?.reason !== DAILY_CAP_REACHED) return routine;
    const timeZone = routine.schedule.timeZone;
    if (scheduleDay(new Date(routine.notice.at), timeZone) === scheduleDay(at, timeZone)) return routine;
    const forgotten = withoutNotice(routine);
    this.store.update('routines', forgotten);
    this.notify();
    return forgotten;
  }
  private defer(routine: Routine, at: Date, reason: string) {
    this.store.update('routines', { ...routine, nextDueAt: nextOccurrence(routine.schedule, at), pending: { dueAt: routine.pending?.dueAt ?? routine.nextDueAt, reason } });
    this.notify();
  }
  private async runOccurrence(routine: Routine, at: Date): Promise<string> {
    // A run that starts also clears a note left by one that could not, such as a working folder that is back (COD-294).
    const advanced = (current: Routine): Routine => ({ ...withoutNotice(current), pending: null, nextDueAt: new Date(current.nextDueAt) > at ? current.nextDueAt : nextOccurrence(current.schedule, at) });
    return this.startRun(routine, advanced, NO_ADDITIONS, PREVIOUS_RUN_BEFORE_CATCH_UP);
  }
  /** The guards every run of a routine passes, on a clock or on an event, before core creates its task. */
  private async startRun(routine: Routine, next: (current: Routine) => Routine, additions: RunAdditions, previousRunMessage: string): Promise<string> {
    if (this.dispatching.has(routine.id)) throw new Error('Lịch đang được xử lý.');
    this.dispatching.add(routine.id);
    try {
      if (routine.approvedConfig !== this.configuration(routine.task, routine.trigger, routine.workspace, routine.schedule)) throw new Error('Tí, skill, kênh hoặc model đã đổi. Mở lịch, kiểm tra và lưu lại quyền chạy.');
      if (this.previousRunActive(routine.id)) throw new PreviousRunBusy(previousRunMessage);
      if (this.previousChangesWait(routine.id)) throw new PreviousRunBusy(PREVIOUS_CHANGES_WAIT);
      // Checked here so the card says so before anything else runs; core checks it again as it writes the task.
      this.assertRoomToday(routine);
      for (const sourceId of routine.task.sourceIds) await this.sources.verify(sourceId, routine.task.sourceIds);
      const folder = routine.workspace ? await this.runFolder(routine) : undefined;
      const current = this.store.get<Routine>('routines', routine.id);
      if (!current.enabled || current.revision !== routine.revision || current.approvedConfig !== this.configuration(current.task, current.trigger, current.workspace, current.schedule)) throw new Error('Lịch hoặc cấu hình đã thay đổi trong lúc kiểm tra.');
      const task: TaskInput = {
        ...current.task,
        ...(current.workspace ? { toolCapabilities: this.runCapabilities(current, current.workspace) } : {}),
        sourceIds: [...current.task.sourceIds, ...additions.sourceIds],
        excludedSources: [...(current.task.excludedSources ?? []), ...additions.excluded],
      };
      // Core commits this updated occurrence, the new task and its folder grant in one transaction, and checks the
      // daily cap inside it (`admitRun`).
      try {
        return this.dispatch(task, next(current), folder);
      } catch (error) {
        if (error instanceof DailyCapReached) this.note(routine.id, error.message);
        throw error;
      }
    } finally { this.dispatching.delete(routine.id); }
  }
  /** Refuses a run whose whole limit no longer fits under today's cap, and says so on the card once (COD-288). */
  private assertRoomToday(routine: Routine) {
    const day = scheduleDay(this.clock(), routine.schedule.timeZone);
    if (fitsDailyCap(this.store, routine, day, routine.task.budgetMicros)) return;
    this.note(routine.id, DAILY_CAP_REACHED);
    throw new DailyCapReached(DAILY_CAP_REACHED);
  }
}

/**
 * A schedule runs with nobody there to answer, so it may read pages but never act on them (COD-261): saving one that
 * would is refused, and its runs are never offered the acting tools.
 */
export const SCHEDULE_NEVER_ACTS = 'Lịch chỉ được đọc trang, không được thao tác trên trang. Chọn "Đọc trang" cho trình duyệt.';
/** A schedule runs while the person may be using the very apps it would touch, so it never uses desktop apps (COD-261, phase 2a). */
export const SCHEDULE_NO_DESKTOP = 'Lịch không dùng ứng dụng trên máy. Tắt "Ứng dụng trên máy" cho lịch này.';

/**
 * What a scheduled run's browser is approved for: reading only, with one profile and the site list as saved. Undefined
 * when the routine does not use the browser.
 */
export function routineBrowserApproval(input: TaskInput) {
  if (!input.toolCapabilities?.includes('browser.read')) return undefined;
  const choice = input.browser ?? defaultBrowserChoice();
  const sites = choice.sites.map(entry => `${entry.decision}:${entry.site}`).sort();
  return { level: 'read' as const, profileId: choice.profileId, sites };
}

/** A run that starts clears the note left by an earlier one that could not. */
function withoutNotice(routine: Routine): Routine {
  const { notice: _notice, ...rest } = routine;
  return rest;
}
