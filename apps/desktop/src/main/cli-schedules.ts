import type { Args, Routine, TaskInput, Workspace } from '../shared/contracts';
import type { CliRequest, CliScheduleRow, SchedulesValue, ScheduleValue } from '../cli/protocol';
import { chatsOf, CliFailure, crewRoster, matchChat, matchSchedule } from './cli-chats';
import type { CliDependencies } from './cli-turns';

/**
 * Schedules from the terminal (COD-354): list them, switch them on and off, delete them, and create or edit one with
 * its name, orglet or crew, brief, timing and limits. A schedule made or changed here never carries tool permissions,
 * a browser or desktop level, a folder, or provider consent the desktop has not already given: its providers must
 * already be allowed in Settings, or the app refuses and points to the desktop. Running one is `run`.
 */

type Request<Op extends CliRequest['op']> = Extract<CliRequest, { op: Op }>;
type SaveRequest = Request<'schedule-save'>;
type Owner = Pick<TaskInput, 'workerId' | 'teamId'>;
/** What `saveRoutine` takes. */
type RoutineSave = Args<'saveRoutine'>;

export class CliSchedules {
  constructor(private readonly dependencies: CliDependencies) {}

  private workspace(): Promise<Workspace> {
    return this.dependencies.request('workspace', {}) as Promise<Workspace>;
  }

  async list(): Promise<SchedulesValue> {
    const workspace = await this.workspace();
    return { schedules: workspace.routines.map(routine => scheduleRow(workspace, routine)) };
  }

  /** On or off, the way the switch on the schedule's card saves it: everything else as it is. */
  async enable(request: Request<'schedule-enable'>): Promise<ScheduleValue> {
    const workspace = await this.workspace();
    const routine = findRoutine(workspace, request.schedule);
    const input: RoutineSave = { id: routine.id, name: routine.name, enabled: request.enabled, schedule: routine.schedule, ...(routine.trigger ? { trigger: routine.trigger } : {}), task: routine.task };
    const saved = await this.dependencies.request('saveRoutine', input) as Routine;
    return { schedule: scheduleRow(workspace, saved) };
  }

  /** Deletes a schedule after its exact name; its past runs stay as chats. */
  async remove(request: Request<'schedule-delete'>): Promise<ScheduleValue> {
    const workspace = await this.workspace();
    const routine = findRoutine(workspace, request.schedule);
    if (request.confirmName !== routine.name) throw new CliFailure('failed', `Gõ đúng tên lịch để xác nhận xóa: ${routine.name}`);
    await this.dependencies.request('deleteRoutine', { id: routine.id });
    return { schedule: scheduleRow(workspace, routine) };
  }

  /**
   * Creates a schedule, or with `schedule` edits that one. Fields left out keep their value; a new schedule needs its
   * name, orglet or crew, brief, timing and limit. A folder trigger, a working folder, permissions and a browser can
   * only be set in the desktop; an edit keeps whatever the desktop set, and moving such a schedule to another orglet or
   * crew is refused, because those were chosen for the one it had.
   */
  async save(request: SaveRequest): Promise<ScheduleValue> {
    const workspace = await this.workspace();
    const existing = request.schedule ? findRoutine(workspace, request.schedule) : undefined;
    const input = existing ? editedRoutine(workspace, existing, request) : newRoutine(workspace, request);
    const saved = await this.dependencies.request('saveRoutine', input) as Routine;
    return { schedule: scheduleRow(workspace, saved) };
  }
}

function findRoutine(workspace: Workspace, name: string): Routine {
  const found = matchSchedule(name, workspace.routines);
  return workspace.routines.find(routine => routine.id === found.id)!;
}

function ownerOf(workspace: Workspace, name: string): Owner {
  const chat = matchChat(name, chatsOf(workspace));
  if (chat.kind === 'worker') return { workerId: chat.id };
  const team = workspace.teams.find(item => item.id === chat.id)!;
  return { workerId: team.synthesizerId, teamId: team.id };
}

/** The providers the schedule's runs send its brief to, which must already be allowed in the desktop's Settings. */
function allowedProviders(workspace: Workspace, owner: Owner): NonNullable<TaskInput['providerScopes']> {
  const team = owner.teamId ? workspace.teams.find(item => item.id === owner.teamId) : undefined;
  const runners = team ? crewRoster(team, workspace.workers) : workspace.workers.filter(worker => worker.id === owner.workerId);
  const providers = [...new Set(runners.map(runner => runner.provider).filter(provider => provider !== 'demo'))] as NonNullable<TaskInput['providerScopes']>;
  const missing = providers.filter(provider => !workspace.providerConsent.includes(provider));
  if (missing.length) throw new CliFailure('failed', `Lịch gửi brief tới ${missing.join(', ')} khi bạn không ở đó. Cho phép các provider này trong Cài đặt của app, hoặc tạo lịch trong app.`);
  return providers;
}

function requireField<Value>(value: Value | undefined, field: string): Value {
  if (value === undefined) throw new CliFailure('invalid', `Lịch mới cần ${field}.`);
  return value;
}

function newRoutine(workspace: Workspace, request: SaveRequest): RoutineSave {
  const owner = ownerOf(workspace, requireField(request.target, '--to'));
  const providerScopes = allowedProviders(workspace, owner);
  const task: TaskInput = {
    ...owner,
    brief: requireField(request.brief, '--brief'),
    sourceIds: [],
    excludedSources: [],
    consent: providerScopes.length > 0,
    providerScopes,
    budgetMicros: requireField(request.budgetMicros, '--budget'),
  };
  const timing = {
    timeZone: request.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    time: requireField(request.time, '--at'),
    frequency: requireField(request.frequency, '--every'),
    weekday: request.weekday ?? 1,
  };
  return {
    name: requireField(request.name, 'name'),
    enabled: request.enabled ?? true,
    schedule: { ...timing, ...hourly(request), ...dailyCap(request) },
    trigger: { kind: request.trigger ?? 'schedule' },
    task,
  };
}

function editedRoutine(workspace: Workspace, existing: Routine, request: SaveRequest): RoutineSave {
  const owner = request.target ? ownerOf(workspace, request.target) : undefined;
  const moves = owner !== undefined && (owner.workerId !== existing.task.workerId || owner.teamId !== existing.task.teamId);
  const task = moves ? movedTask(workspace, existing, owner) : existing.task;
  const schedule = {
    ...existing.schedule,
    ...(request.timeZone ? { timeZone: request.timeZone } : {}),
    ...(request.time ? { time: request.time } : {}),
    ...(request.frequency ? { frequency: request.frequency } : {}),
    ...(request.weekday !== undefined ? { weekday: request.weekday } : {}),
    ...hourly(request),
    ...dailyCap(request),
  };
  const trigger = request.trigger ? { kind: request.trigger } : existing.trigger;
  return {
    id: existing.id,
    name: request.name ?? existing.name,
    enabled: request.enabled ?? existing.enabled,
    schedule,
    ...(trigger ? { trigger } : {}),
    task: { ...task, ...(request.brief ? { brief: request.brief } : {}), ...(request.budgetMicros ? { budgetMicros: request.budgetMicros } : {}) },
  };
}

/** The task of a schedule moved to another orglet or crew; one with desktop-only settings stays where it is. */
function movedTask(workspace: Workspace, existing: Routine, owner: Owner): TaskInput {
  const desktopOnly = existing.task.toolCapabilities?.length || existing.task.browser || existing.task.desktop || existing.workspace || existing.trigger?.kind === 'folder';
  if (desktopOnly) throw new CliFailure('failed', 'Lịch này có quyền, thư mục hoặc trình duyệt được chọn trong app cho Tí hay kênh hiện tại. Đổi người làm trong app.');
  const providerScopes = allowedProviders(workspace, owner);
  const { teamId: _teamId, ...rest } = existing.task;
  return { ...rest, ...owner, consent: providerScopes.length > 0, providerScopes };
}

function hourly(request: SaveRequest): Partial<Routine['schedule']> {
  return request.everyHours ? { everyHours: request.everyHours } : {};
}

function dailyCap(request: SaveRequest): Partial<Routine['schedule']> {
  return request.dailyCapMicros ? { dailyCapMicros: request.dailyCapMicros } : {};
}

function ownerName(workspace: Workspace, routine: Routine): string {
  if (routine.task.teamId) return workspace.teams.find(team => team.id === routine.task.teamId)?.name ?? routine.task.teamId;
  return workspace.workers.find(worker => worker.id === routine.task.workerId)?.name ?? routine.task.workerId;
}

function scheduleRow(workspace: Workspace, routine: Routine): CliScheduleRow {
  const today = workspace.routineToday?.[routine.id];
  return {
    id: routine.id,
    name: routine.name,
    enabled: routine.enabled,
    target: ownerName(workspace, routine),
    trigger: routine.trigger?.kind ?? 'schedule',
    frequency: routine.schedule.frequency,
    time: routine.schedule.time,
    weekday: routine.schedule.weekday,
    ...(routine.schedule.everyHours ? { everyHours: routine.schedule.everyHours } : {}),
    timeZone: routine.schedule.timeZone,
    nextDueAt: routine.nextDueAt,
    budgetMicros: routine.task.budgetMicros,
    ...(routine.schedule.dailyCapMicros ? { dailyCapMicros: routine.schedule.dailyCapMicros } : {}),
    ...(today ? { runsToday: today.runs, spentTodayMicros: today.spentMicros } : {}),
  };
}
