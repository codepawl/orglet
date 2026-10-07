import { demoReplies } from '../demoReplies';
import { useEffect, useRef, useState } from 'react';
import type { Routine, Task, TaskInput, Worker, Workspace } from '../../shared/contracts';
import { Button, Drawer, FieldLabel, MoneyInput, PanelHeading } from './ui';
import { Attachment } from './Attachment';
import { AppWindow, Webhook, BellRing, Briefcase, ShieldCheck, CalendarRange, Sun, Users, CalendarX2, FileDiff, FolderX, CalendarClock, CalendarDays, Clock, Copy, FilePlus, FileText, Folder, FolderInput, FolderOpen, Gauge, Globe, History, MessageSquare, MessageSquareText, Pencil, Play, Repeat, SquareTerminal, Timer, UserRound, Wallet, Zap } from 'lucide-react';
import { channelLabel } from '../../shared/channels';
import { providerLabel } from './providers';
import { formatMoney, toAmount, toMicros } from './money';
import { DAILY_CAP_REACHED, EVERY_HOURS_CHOICES, SKIPPED_WHILE_INACTIVE, TimeZone, nextOccurrence, runsPerDay, scheduleDay, type Schedule, type ScheduleFrequency } from '../../shared/schedule';
import { cadenceInWords, everyHoursInWords, formatClockTime, keepTimeTogether } from '../scheduleWords';
import { timeZoneChoices } from '../timeZones';
import { RowMenu } from './RowMenu';
import { EllipsisVertical, Trash } from './icons';
import { Select } from './Select';
import { t } from '../i18n';
import { currentLocale, translated, tMessage } from '../i18n';
import { orglet } from '../api';
import { Switch, SwitchField } from './Switch';
import { StatusMark, taskStatusMark, type StatusMarkState } from './StatusMark';
import { CommandBlock, Input, Textarea } from '@codepawlhq/orglet-ui';
import { APP_TRIGGER_KEYWORD_LIMIT, APP_TRIGGER_MINUTES, triggerOf, type RoutineTrigger, type RoutineTriggerKind, type RoutineWorkspace } from '../../shared/routine-triggers';
import { permissionsForLevel, workspaceLevelOf, workspaceLevels, type WorkspaceLevel } from '../../shared/capability-status';
import { workspaceLevelNames } from './PermissionControls';
import { toast } from './toast';
import { Avatar, RosterAvatars } from './Avatar';
import { teamRoster } from '../assignees';
import { BrowserSitesEditor, profileOptions, useBrowserState } from './BrowserSettings';
import { browserLevelOf, capabilitiesWithBrowserLevel, defaultBrowserChoice, routineBrowserLevels, type BrowserLevel, type BrowserProfileId, type BrowserSite } from '../../shared/browser';
import { snapshotCapabilities, withCapability, type ToolCapability } from '../../shared/tool-policy';
import { WEB_SEARCH_PROVIDER_NAMES } from '../../shared/web-tools';

/** Read when shown, so it follows the interface language like every other message. */
const INVALID_ZONE = () => t('Múi giờ không hợp lệ. Chọn một múi giờ trong danh sách.');
const weekdays = translated(['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy']);
export const formatRoutineTime = (iso: string, timeZone: string) => keepTimeTogether(new Date(iso).toLocaleString(currentLocale(), { timeZone, dateStyle: 'short', timeStyle: 'short' }));
export { formatClockTime };
/** When the decision model flagged a run (COD-303): the time alone when that was today in the schedule's zone, so the card's line fits. */
export function flaggedWhen(iso: string, timeZone: string, now = new Date()): string {
  const at = new Date(iso);
  if (scheduleDay(at, timeZone) !== scheduleDay(now, timeZone)) return formatRoutineTime(iso, timeZone);
  return keepTimeTogether(at.toLocaleTimeString(currentLocale(), { timeZone, timeStyle: 'short' }));
}
/** The command that starts a routine from a terminal (COD-245); the name is quoted so spaces survive the shell. */
export const runCommandOf = (name: string) => `orglet run "${name.replace(/"/g, '\\"')}"`;
const TRIGGER_ICONS: Record<RoutineTriggerKind, typeof CalendarClock> = { schedule: CalendarClock, folder: FolderInput, called: SquareTerminal, app: Webhook };
type AppTriggerFields = { server: { id: string; name: string } | undefined; tool: string; argumentsText: string; everyText: string; keywordsText?: string };

/** The app trigger the fields describe, or undefined when one of them is missing or not valid. */
function appTriggerDraft(fields: AppTriggerFields): RoutineTrigger | undefined {
  if (appTriggerProblem(fields)) return undefined;
  const keywords = (fields.keywordsText ?? '').split(',').map(word => word.trim()).filter(Boolean).slice(0, APP_TRIGGER_KEYWORD_LIMIT);
  return { kind: 'app', serverId: fields.server!.id, serverName: fields.server!.name, tool: fields.tool, arguments: JSON.parse(fields.argumentsText.trim() || '{}') as Record<string, unknown>, everyMinutes: Number(fields.everyText), keywords };
}

/** Why the app trigger's fields cannot be saved yet, in words for the person; empty when they can. */
function appTriggerProblem(fields: AppTriggerFields): string {
  if (!fields.server) return t('Chọn ứng dụng để lịch theo dõi.');
  if (!fields.tool) return t('Chọn công cụ chỉ đọc để lịch gọi.');
  try {
    const parsed: unknown = JSON.parse(fields.argumentsText.trim() || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return t('Tham số cần là một đối tượng JSON, ví dụ {}.');
  } catch {
    return t('Tham số cần là một đối tượng JSON, ví dụ {}.');
  }
  const every = Number(fields.everyText);
  if (!Number.isInteger(every) || every < APP_TRIGGER_MINUTES.least || every > APP_TRIGGER_MINUTES.most) return t('Khoảng xem lại từ {0} đến {1} phút.', [APP_TRIGGER_MINUTES.least, APP_TRIGGER_MINUTES.most]);
  return '';
}

/** The routine's trigger in a few words, for the one line under its name. */
function triggerSummary(routine: Routine): string {
  const trigger = triggerOf(routine);
  if (trigger.kind === 'folder') return t('Khi có tệp mới trong {0}', [trigger.folderName]);
  if (trigger.kind === 'called') return t('Chỉ khi được gọi');
  if (trigger.kind === 'app') return t('Khi có mục mới trong {0}', [trigger.serverName]);
  return cadenceInWords(routine.schedule);
}
/**
 * What a schedule may cost at most, said before saving (COD-288): "Up to 9 runs a day · up to $4.50 a day at $0.50 per
 * run", or the daily cap when it is lower. Only a clock schedule knows how many runs a day it starts.
 */
export function costCeiling(schedule: Schedule, triggerKind: RoutineTriggerKind, budgetMicros: number, capMicros: number | undefined): string {
  if (triggerKind !== 'schedule') {
    if (capMicros === undefined) return t('Không giới hạn theo ngày; mỗi lần chạy tối đa {0}.', [formatMoney(budgetMicros)]);
    return t('Tối đa {0} một ngày, dù chạy bao nhiêu lần.', [formatMoney(capMicros)]);
  }
  // A cap is never below one run's limit, so it cannot lower a weekly schedule's single run.
  if (schedule.frequency === 'weekly') return t('Tối đa 1 lần một tuần · tối đa {0} một tuần.', [formatMoney(budgetMicros)]);
  const runs = runsPerDay(schedule);
  const ceilingMicros = runs * budgetMicros;
  const runsText = runs === 1 ? t('Tối đa 1 lần một ngày') : t('Tối đa {0} lần một ngày', [runs]);
  if (capMicros !== undefined && capMicros < ceilingMicros) return t('{0} · tối đa {1} một ngày theo giới hạn.', [runsText, formatMoney(capMicros)]);
  if (runs === 1) return t('{0} · tối đa {1} một ngày.', [runsText, formatMoney(ceilingMicros)]);
  return t('{0} · tối đa {1} một ngày, với {2} mỗi lần.', [runsText, formatMoney(ceilingMicros), formatMoney(budgetMicros)]);
}
/**
 * The next time a run can start, for the card: once today's cap is reached the rest of today's times are skipped, so it
 * is the first time on a later day (COD-288).
 */
export function nextRunAt(routine: Pick<Routine, 'nextDueAt' | 'notice' | 'schedule'>, today: string | undefined): string {
  if (routine.notice?.reason !== DAILY_CAP_REACHED || !today) return routine.nextDueAt;
  let next = routine.nextDueAt;
  for (let step = 0; step < 48 && scheduleDay(new Date(next), routine.schedule.timeZone) === today; step++) next = nextOccurrence(routine.schedule, new Date(next));
  return next;
}
/** Why a run was missed, in plain words when it is the usual reason (the app was closed or asleep). */
function missedReason(reason: string): string {
  if (reason === SKIPPED_WHILE_INACTIVE) return t('Lúc đó Orglet không mở hoặc máy đang ngủ, nên lịch chưa chạy.');
  return tMessage(reason);
}
async function copyCommand(command: string) {
  try {
    await orglet.copyText(command);
    toast(t('Đã sao chép lệnh'), 'success', command);
  } catch {
    toast(t('Không sao chép được lệnh'), 'error', command);
  }
}
/** An orglet's face at list size, the way the chat's recipient list shows it, instead of a generic person icon. */
function WorkerFace({ worker, size }: { worker: Worker; size: 'xxs' | 'xs' }) {
  return <Avatar name={worker.name} seed={worker.id} mascot={worker.avatar?.mascot} defaultMascot hint={worker.description} color={worker.avatar?.color} size={size} />;
}
/** What a schedule's card says about its newest run: its mark and a few words, the words in the mark's colour. */
export type LastRunOutcome = { label: string; mark: StatusMarkState };

/**
 * What became of a schedule's newest run, for its card (COD-294). Before this the card only offered "Open latest run",
 * so a run that failed at night looked the same as one that went well. Changes held for review count as waiting for
 * the person, since the next run waits for them too.
 */
export function lastRunOutcome(task: Pick<Task, 'id' | 'status'>, heldForReview: readonly string[]): LastRunOutcome {
  const mark = taskStatusMark(task.status, false);
  if (task.status === 'queued' || task.status === 'running' || task.status === 'pausing') return { label: t('Đang chạy'), mark };
  if (task.status === 'waiting_input' || task.status === 'waiting_budget') return { label: t('Đang chờ bạn'), mark };
  if (task.status === 'failed' || task.status === 'interrupted') return { label: t('Cần xem lại'), mark };
  if (task.status === 'paused') return { label: t('Đã tạm dừng'), mark };
  if (task.status === 'cancelled') return { label: t('Đã dừng'), mark };
  if (heldForReview.includes(task.id)) return { label: t('Thay đổi đang chờ bạn xem'), mark: { variant: 'dashed', tone: 'error' } };
  if (task.status === 'partial') return { label: t('Xong một phần'), mark };
  return { label: t('Đã xong'), mark };
}
/** Which screen of the Routines dialog is showing; the dialog title renders it as a breadcrumb. */
export type RoutineView = { editing: false } | { editing: true; routine?: Routine };
/**
 * Requests a person can start from when they would rather ask an orglet than fill the form (user, 2026-10-06). Each
 * opens that orglet's chat with the request typed; the orglet answers with a schedule to apply (`propose_schedule`).
 */
const SCHEDULE_ASKS = () => [
  t('Mỗi sáng thứ Hai, tóm tắt việc tuần trước và việc cần làm tuần này.'),
  t('Mỗi ngày lúc 9 giờ, đọc tin mới về chủ đề tôi theo dõi và báo lại ba điều đáng chú ý.'),
  t('Mỗi chiều thứ Sáu, rà lại việc còn dở trong tuần và nhắc tôi.'),
];

export function RoutinesPanel({ workspace, routines = workspace.routines, draft, openTask, view, onView, onBack, onDirty, asker, onAsk }: { workspace: Workspace; /** The schedules to list; a chat's Schedules view passes only its orglet's or crew's (COD-355). */ routines?: readonly Routine[]; draft?: TaskInput; openTask: (id: string) => void; view: RoutineView; onView: (view: RoutineView) => void; onBack: () => void; onDirty: (dirty: boolean) => void;
  /** The orglet a request goes to, and what opens its chat with the request typed. Left out, the page offers no requests. */
  asker?: string; onAsk?: (request: string) => void }) {
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const action = async (fn: () => Promise<unknown>) => { setBusy(true); setError(''); try { await fn(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); } };
  // A schedule is made and edited in a dialog over the list (user, 2026-10-05), not in the list's place: the page
  // behind it stays where it was. Closing it asks about unsaved changes the way leaving the editor always did.
  const editor = view.editing ? <Drawer open onClose={onBack} title={view.routine ? view.routine.name : t('Lịch mới')}>
    <RoutineEditor key={view.routine?.id ?? 'new'} routine={view.routine} draft={view.routine ? undefined : draft} workspace={workspace} saved={() => { onDirty(false); onView({ editing: false }); }} back={onBack} onDirty={onDirty} />
  </Drawer> : null;
  const assignee = (item: Routine) => item.task.teamId ? workspace.teams.find(team => team.id === item.task.teamId)?.name ?? t('Kênh đã xóa') : workspace.workers.find(worker => worker.id === item.task.workerId)?.name ?? t('Tí đã xóa');
  /** The face of whoever runs the schedule: the orglet's own, a crew's first members, or the plain icon once it is gone. */
  const assigneeFace = (item: Routine) => {
    if (item.task.teamId) {
      const team = workspace.teams.find(entry => entry.id === item.task.teamId);
      return team ? <RosterAvatars workers={teamRoster(team, workspace.workers)} max={2} /> : <Users size={14} aria-hidden="true" />;
    }
    const worker = workspace.workers.find(entry => entry.id === item.task.workerId);
    return worker ? <WorkerFace worker={worker} size="xxs" /> : <UserRound size={14} aria-hidden="true" />;
  };
  /** The newest run's outcome, when that run is still a chat here. */
  const lastRun = (item: Routine) => {
    const task = item.lastTaskId ? workspace.tasks.find(entry => entry.id === item.lastTaskId) : undefined;
    return task ? lastRunOutcome(task, workspace.heldForReview) : undefined;
  };
  /** An hourly schedule's runs so far today, in its own time zone (COD-288); other cadences run at most once a day. */
  const runsToday = (item: Routine) => {
    if (item.schedule.frequency !== 'hours' || triggerOf(item).kind !== 'schedule') return 0;
    return workspace.routineToday?.[item.id]?.runs ?? 0;
  };
  const spentToday = (item: Routine) => workspace.routineToday?.[item.id]?.spentMicros ?? 0;
  /** The newest quiet run the decision model announced (COD-303), so the card says why an hourly schedule spoke up. */
  const lastAnnounced = (item: Routine) => {
    let newest: Task | undefined;
    for (const task of workspace.tasks) {
      if (task.routineId !== item.id || !task.attention?.notified) continue;
      if (!newest || task.attention.decidedAt > newest.attention!.decidedAt) newest = task;
    }
    return newest;
  };
  const shownOnCard = routines.some(item => item.notice && tMessage(item.notice.reason) === error);
  const deleteSchedule = async (item: Routine) => {
    await orglet.call('deleteRoutine', { id: item.id });
    toast(t('Đã xóa lịch'), 'success', item.name);
  };
  return <>{editor}<div className="form">
          {!routines.length && <div className="routine-empty"><CalendarClock size={28} aria-hidden="true" /><p>{t('Chưa có lịch.')}</p><p className="muted">{t('Tạo một lịch, hoặc viết brief rồi chọn “Lên lịch cho tin này”.')}</p>
            {asker && onAsk && <>
              <p className="muted routine-ask-lead">{t('Hoặc nhờ {0} lên lịch giúp:', [asker])}</p>
              <ul className="suggestions routine-asks">{SCHEDULE_ASKS().map(request => <li key={request}><Button type="button" onClick={() => onAsk(request)}><CalendarClock size={16} aria-hidden="true" />{request}</Button></li>)}</ul>
            </>}
          </div>}
    <div className="routine-list">
      {routines.map(item => {
        const trigger = triggerOf(item);
        const TriggerIcon = TRIGGER_ICONS[trigger.kind];
        const summary = triggerSummary(item);
        const announced = lastAnnounced(item)?.attention;
        return <section key={item.id} className="routine-card" aria-label={t('Lịch {0}', [item.name])}>
        <div className="routine-head">
          <span className="routine-icon" aria-hidden="true"><TriggerIcon size={18} /></span>
          <div className="routine-title"><h3>{item.name}</h3>
            {/* One line under the name: on or off, then what starts it. It never wraps; a long folder name ends in … */}
            <p className="routine-subline"><span className={`status-pill ${item.enabled ? 'logged_in' : ''}`}><StatusMark variant={item.enabled ? 'filled' : 'empty'} tone={item.enabled ? 'success' : 'muted'} label={item.enabled ? t('Đang bật') : t('Đã tắt')} decorative />{item.enabled ? t('Đang bật') : t('Đã tắt')}</span><span className="routine-trigger" title={summary}>{summary}</span></p>
          </div>
          <div className="routine-actions">
            {/* Run now goes through the guards a trigger passes (switched on, approved as it is, previous run done)
                and opens the run like any scheduled one; the next scheduled time stays as it was. */}
            <Button size="icon" aria-label={t('Chạy ngay lịch {0}', [item.name])} title={item.enabled ? t('Chạy ngay') : t('Bật lịch để chạy ngay')} disabled={busy || !item.enabled}
              onClick={() => void action(async () => openTask(await orglet.call('runRoutineNow', { id: item.id })))}><Play size={16} /></Button>
            <Button size="icon" aria-label={t('Sửa lịch {0}', [item.name])} title={t('Sửa lịch')} disabled={busy} onClick={() => onView({ editing: true, routine: item })}><Pencil size={16} /></Button>
            {/* On or off is two states, so it wears a switch (user, 2026-09-19). Its name stays "Bật lịch"
                whichever way it is set, because the state is what aria-checked says. */}
            <Switch checked={item.enabled} disabled={busy} label={t('Bật lịch')}
              onChange={enabled => void action(() => orglet.call('saveRoutine', { id: item.id, name: item.name, enabled, schedule: item.schedule, ...(item.trigger ? { trigger: item.trigger } : {}), task: item.task }))} />
            {/* Deleting asks inside the menu, beside the card, not in a centred dialog (COD-283). The past runs are
                chats and stay, named after the schedule. */}
            <RowMenu className="routine-menu" label={t('Tùy chọn lịch {0}', [item.name])} icon={EllipsisVertical} disabled={busy}
              items={[{ label: t('Xóa lịch'), icon: Trash, danger: true, onSelect: () => void action(() => deleteSchedule(item)),
                confirm: { question: t('Xóa lịch {0}? Các lần chạy trước vẫn là chat, tìm lại được trong Tìm kiếm.', [item.name]), label: t('Xóa') } }]} />
          </div>
        </div>
        <ul className="routine-meta">
          {trigger.kind === 'schedule' && <li><Globe size={14} aria-hidden="true" />{item.schedule.timeZone}</li>}
          {trigger.kind === 'schedule' && item.enabled && <li><CalendarDays size={14} aria-hidden="true" />{t('Lần tới {0}', [formatRoutineTime(nextRunAt(item, workspace.routineToday?.[item.id]?.day), item.schedule.timeZone)])}</li>}
          <li>{assigneeFace(item)}{assignee(item)}</li>
          <li><Wallet size={14} aria-hidden="true" />{t('{0} mỗi lần', [formatMoney(item.task.budgetMicros)])}</li>
          {/* The day so far (COD-288): an hourly schedule's quiet runs collect here instead of a toast each, and a
              cap shows what today's runs used of it. */}
          {runsToday(item) > 0 && <li><History size={14} aria-hidden="true" />{runsToday(item) === 1 ? t('1 lần chạy hôm nay') : t('{0} lần chạy hôm nay', [runsToday(item)])}</li>}
          {/* Why an hourly schedule spoke up (COD-303): when the decision model flagged a run, and its rating behind the line. */}
          {announced && <li title={t('Lịch hằng giờ thường im lặng khi xong. Model quyết định chấm câu trả lời này {0}% đáng chú ý nên đã báo bạn.', [Math.round(announced.score * 100)])}><BellRing size={14} aria-hidden="true" />{t('Model quyết định đã báo {0}', [flaggedWhen(announced.decidedAt, item.schedule.timeZone)])}</li>}
          {item.schedule.dailyCapMicros !== undefined && <li><Gauge size={14} aria-hidden="true" />{t('Hôm nay {0} / {1}', [formatMoney(spentToday(item)), formatMoney(item.schedule.dailyCapMicros)])}</li>}
          {/* A schedule with no sources says nothing about them, rather than "0 sources" (COD-258). */}
          {item.task.sourceIds.length > 0 && <li><FileText size={14} aria-hidden="true" />{item.task.sourceIds.length === 1 ? t('1 nguồn') : t('{0} nguồn', [item.task.sourceIds.length])}</li>}
          {item.workspace && <li title={workspaceLevelNames[workspaceLevelOf(item.workspace.permissions)]}><FolderOpen size={14} aria-hidden="true" /><span className="routine-meta-folder">{item.workspace.folderName}</span></li>}
        </ul>
        <p className="routine-brief"><MessageSquareText size={14} aria-hidden="true" /><span>{item.task.brief}</span></p>
        {/* A miss is news, not an error (COD-283): which run, when, why in plain words, and what catching up does. */}
        {item.pending && <div className="routine-alert" role="status"><CalendarX2 size={16} aria-hidden="true" /><div>
          <h4>{t('Lỡ lần chạy lúc {0}', [formatRoutineTime(item.pending.dueAt, item.schedule.timeZone)])}</h4>
          <p>{missedReason(item.pending.reason)}</p>
          <p className="muted">{item.enabled
            ? t('Chạy bù chạy lịch một lần, dù lỡ bao nhiêu lần. Lần tới vẫn lúc {0}.', [formatRoutineTime(item.nextDueAt, item.schedule.timeZone)])
            : t('Bật lịch để chạy bù một lần.')}</p>
          <div className="actions">
          <Button disabled={busy || !item.enabled} variant="primary" onClick={() => void action(async () => openTask(await orglet.call('catchUpRoutine', { id: item.id })))}>{t('Chạy bù một lần')}</Button>
          <Button disabled={busy} onClick={() => void action(() => orglet.call('dismissRoutine', { id: item.id }))}>{t('Bỏ qua lần lỡ')}</Button>
        </div></div></div>}
        {/* The day's cap reached is not a failure: it says what today used, and when runs start again (COD-288). */}
        {item.notice?.reason === DAILY_CAP_REACHED && item.schedule.dailyCapMicros !== undefined && <div className="routine-alert" role="status"><Gauge size={16} aria-hidden="true" /><div>
          <h4>{t('Đã chạm giới hạn chi phí hôm nay')}</h4>
          <p>{t('Các lần chạy hôm nay đã dùng {0} trong giới hạn {1}, nên lịch bỏ qua các lần còn lại trong ngày.', [formatMoney(spentToday(item)), formatMoney(item.schedule.dailyCapMicros)])}</p>
          <p className="muted">{t('Lịch chạy lại sau nửa đêm theo giờ {0}.', [item.schedule.timeZone])}</p>
          <div className="actions"><Button disabled={busy} onClick={() => void action(() => orglet.call('dismissRoutine', { id: item.id }))}>{t('Ẩn thông báo')}</Button></div>
        </div></div>}
        {item.notice && item.notice.reason !== DAILY_CAP_REACHED && <div className="routine-alert" role="status"><FolderX size={16} aria-hidden="true" /><div>
          <h4>{t('Lịch chưa chạy')}</h4>
          <p>{tMessage(item.notice.reason)}</p>
          {/* The note keeps the time it first appeared; the same reason again is not written twice (COD-288). */}
          <p className="muted">{trigger.kind === 'folder'
            ? t('Lúc {0}. Tệp đến khi app tắt không được chạy lại.', [formatRoutineTime(item.notice.at, item.schedule.timeZone)])
            : t('Từ {0}.', [formatRoutineTime(item.notice.at, item.schedule.timeZone)])}</p>
          <div className="actions"><Button disabled={busy} onClick={() => void action(() => orglet.call('dismissRoutine', { id: item.id }))}>{t('Ẩn thông báo')}</Button></div>
        </div></div>}
        {lastRun(item) && <LastRunButton outcome={lastRun(item)!} disabled={busy} onOpen={() => openTask(item.lastTaskId!)} />}
      </section>;
      })}
    </div>
    {/* A run that could not start because its folder is gone says so on its card (COD-294); not twice. */}
    {error && !shownOnCard && <p role="alert" className="error">{error}</p>}
  </div></>;
}
/** Opens a schedule's newest run and says what became of it, in the colour of its mark (COD-294). */
function LastRunButton({ outcome, disabled, onOpen }: { outcome: LastRunOutcome; disabled: boolean; onOpen: () => void }) {
  return <Button className="routine-last" disabled={disabled} onClick={onOpen}>
    <StatusMark variant={outcome.mark.variant} tone={outcome.mark.tone} label={outcome.label} decorative />
    <span>{t('Mở lần chạy gần nhất')}</span>
    <span className="routine-last-outcome" data-tone={outcome.mark.tone}>{outcome.label}</span>
  </Button>;
}
/**
 * The permissions a schedule's task carries: what it had (or the lead's defaults), with the browser reading or not and
 * web search on or off as the editor says. A schedule that never had either keeps carrying none.
 */
export function scheduleCapabilities(saved: ToolCapability[] | undefined, leadProvider: Worker['provider'], readsPages: boolean, searchesWeb: boolean): ToolCapability[] | undefined {
  const base = saved ?? (readsPages || searchesWeb ? snapshotCapabilities(leadProvider) : undefined);
  if (!base) return undefined;
  const withBrowser = capabilitiesWithBrowserLevel(base, readsPages ? 'read' : 'none');
  return withCapability(withBrowser, 'network.web', searchesWeb);
}

function RoutineEditor({ routine, draft, workspace, saved, back, onDirty }: { routine?: Routine; draft?: TaskInput; workspace: Workspace; saved: () => void; back: () => void; onDirty: (dirty: boolean) => void }) {
  const initial = routine?.task ?? draft;
  const [name, setName] = useState(routine?.name ?? '');
  const [brief, setBrief] = useState(initial?.brief ?? '');
  const [target, setTarget] = useState(initial?.teamId ? `team:${initial.teamId}` : initial?.workerId ?? workspace.workers[0]?.id ?? '');
  const [sources, setSources] = useState<{ id: string; name: string; bytes?: number }[]>((initial?.sourceIds ?? []).map(id => ({ id, name: t('Nguồn {0}', [id.slice(0, 8)]) })));
  const [budget, setBudget] = useState(toAmount(initial?.budgetMicros ?? 500_000));
  const [frequency, setFrequency] = useState<ScheduleFrequency>(routine?.schedule.frequency ?? 'daily');
  const [weekday, setWeekday] = useState(routine?.schedule.weekday ?? 1);
  const [time, setTime] = useState(routine?.schedule.time ?? '09:00');
  // An hourly schedule (COD-288): how many hours apart, an optional part of the day, and weekdays only.
  const [everyHours, setEveryHours] = useState<number>(routine?.schedule.everyHours ?? 1);
  const [windowOn, setWindowOn] = useState(routine?.schedule.window !== undefined);
  const [windowFrom, setWindowFrom] = useState(routine?.schedule.window?.from ?? '09:00');
  const [windowTo, setWindowTo] = useState(routine?.schedule.window?.to ?? '18:00');
  const [weekdaysOnly, setWeekdaysOnly] = useState(routine?.schedule.weekdaysOnly === true);
  // The most the schedule's runs may cost in one day, whatever starts them; empty is no cap (COD-288).
  const [dailyCap, setDailyCap] = useState(routine?.schedule.dailyCapMicros !== undefined ? toAmount(routine.schedule.dailyCapMicros) : '');
  const systemZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [timeZone, setTimeZone] = useState(routine?.schedule.timeZone ?? systemZone);
  // Built once per editor: about four hundred zones, each with its offset now. The saved zone stays in the list.
  const [zoneChoices] = useState(() => timeZoneChoices(systemZone, timeZone, new Date()));
  const [enabled, setEnabled] = useState(routine?.enabled ?? true);
  const initialTrigger = routine ? triggerOf(routine) : undefined;
  const [triggerKind, setTriggerKind] = useState<RoutineTriggerKind>(initialTrigger?.kind ?? 'schedule');
  const [folder, setFolder] = useState<{ folderId: string; name: string } | undefined>(initialTrigger?.kind === 'folder' ? { folderId: initialTrigger.folderId, name: initialTrigger.folderName } : undefined);
  // An app trigger (stage 4): which connected app, which of its read-only tools, with what arguments, how often, and the
  // words a new item must have. The arguments are edited as JSON text and checked on save.
  const initialApp = initialTrigger?.kind === 'app' ? initialTrigger : undefined;
  const appServers = (workspace.mcpServers ?? []).filter(server => server.enabled);
  const [appServerId, setAppServerId] = useState(initialApp?.serverId ?? appServers[0]?.id ?? '');
  const [appTool, setAppTool] = useState(initialApp?.tool ?? '');
  const [appArguments, setAppArguments] = useState(initialApp ? JSON.stringify(initialApp.arguments, null, 2) : '{}');
  const [appEvery, setAppEvery] = useState(String(initialApp?.everyMinutes ?? 15));
  const [appKeywords, setAppKeywords] = useState(initialApp?.keywords.join(', ') ?? '');
  const appServer = appServers.find(server => server.id === appServerId);
  const readOnlyTools = (appServer?.tools ?? []).filter(tool => tool.readOnly);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  // A schedule may read pages with the profile and site list saved here; saving is what approves them (COD-261).
  // A schedule never acts on pages (COD-261), so reading is the most it can be set to.
  const [browserLevel, setBrowserLevel] = useState<BrowserLevel>(browserLevelOf(initial?.toolCapabilities ?? []) === 'none' ? 'none' : 'read');
  const [browserProfile, setBrowserProfile] = useState<BrowserProfileId>((initial?.browser ?? defaultBrowserChoice()).profileId);
  const [browserSites, setBrowserSites] = useState<BrowserSite[]>(initial?.browser?.sites ?? []);
  // A weekly "check what changed on the web" needs web search as much as the browser; a search never asks anyone,
  // so an unattended run may use it like a chat can (dogfood, 2026-09-26).
  const [web, setWeb] = useState((initial?.toolCapabilities ?? []).includes('network.web'));
  // The schedule's own working folder (COD-294): picked here at the level chosen here, and approved by saving.
  // `workFolder.granted` is the widest level the picker was opened at, so a higher one asks for the folder again.
  const savedWorkspace = routine?.workspace;
  const [workFolder, setWorkFolder] = useState<{ folderId: string; name: string; granted: WorkspaceLevel } | undefined>(savedWorkspace
    ? { folderId: savedWorkspace.folderId, name: savedWorkspace.folderName, granted: workspaceLevelOf(savedWorkspace.permissions) } : undefined);
  const [workLevel, setWorkLevel] = useState<WorkspaceLevel>(savedWorkspace ? workspaceLevelOf(savedWorkspace.permissions) : 'none');
  const [review, setReview] = useState(savedWorkspace?.review ?? true);
  const browser = useBrowserState();
  const nameInput = useRef<HTMLInputElement>(null);
  const zoneError = error === INVALID_ZONE();
  const team = workspace.teams.find(team => `team:${team.id}` === target);
  useEffect(() => {
    let cancelled = false;
    void orglet.call('sourceMetadata', { ids: initial?.sourceIds ?? [] }).then(metadata => {
      if (!cancelled) setSources(current => current.map(source => { const found = metadata.find(item => item.id === source.id); return { ...source, name: found?.name ?? source.name, bytes: found?.bytes ?? source.bytes }; }));
    }).catch(err => { if (!cancelled) setError((err as Error).message); });
    return () => { cancelled = true; };
  }, [initial]);
  const workers = team ? workspace.workers.filter(worker => [...team.memberIds, team.synthesizerId].includes(worker.id)) : workspace.workers.filter(worker => worker.id === target);
  const providers = [...new Set(workers.map(worker => worker.provider).filter(provider => provider !== 'demo'))];
  const destination = providers.length ? t('đến {0}', [providers.map(providerLabel).join(t(' và '))]) : demoReplies() ? t('ở chế độ Demo') : t('khi Tí đã kết nối model');
  // Leaving asks for confirmation only when something differs from what the editor opened with.
  const snapshot = JSON.stringify([name, brief, target, sources.map(source => source.id), budget, frequency, weekday, time, timeZone, enabled, triggerKind, folder?.folderId, appServerId, appTool, appArguments, appEvery, appKeywords, browserLevel, browserProfile, browserSites.map(entry => `${entry.decision}:${entry.site}`), web, workFolder?.folderId, workLevel, review, everyHours, windowOn, windowFrom, windowTo, weekdaysOnly, dailyCap]);
  const budgetMicros = toMicros(budget);
  const capMicros = dailyCap.trim() ? toMicros(dailyCap) : undefined;
  // The schedule as it would be saved; the hourly fields go only with an hourly schedule.
  const draftSchedule: Schedule = {
    frequency, weekday, time, timeZone,
    ...(frequency === 'hours' ? { everyHours: everyHours as Schedule['everyHours'], ...(windowOn ? { window: { from: windowFrom, to: windowTo } } : {}), ...(weekdaysOnly ? { weekdaysOnly: true } : {}) } : {}),
    ...(capMicros !== undefined && Number.isSafeInteger(capMicros) ? { dailyCapMicros: capMicros } : {}),
  };
  const windowInvalid = frequency === 'hours' && windowOn && windowFrom >= windowTo;
  const capInvalid = capMicros !== undefined && (!Number.isSafeInteger(capMicros) || capMicros < 1000 || (Number.isSafeInteger(budgetMicros) && capMicros < budgetMicros));
  const ceiling = Number.isSafeInteger(budgetMicros) && budgetMicros > 0 && !windowInvalid ? costCeiling(draftSchedule, triggerKind, budgetMicros, draftSchedule.dailyCapMicros) : '';
  // The permissions the saved task carries: what it had, with the web and the browser as chosen here. A schedule
  // that never had either keeps carrying none, so saving it again changes nothing.
  const leadProvider = (workspace.workers.find(worker => worker.id === (team?.synthesizerId ?? target)) ?? workspace.workers[0])?.provider ?? 'demo';
  const toolCapabilities = scheduleCapabilities(initial?.toolCapabilities, leadProvider, browserLevel === 'read', web);
  const trigger: RoutineTrigger | undefined = triggerKind === 'folder'
    ? folder && { kind: 'folder', folderId: folder.folderId, folderName: folder.name }
    : triggerKind === 'app' ? appTriggerDraft({ server: appServer, tool: appTool, argumentsText: appArguments, everyText: appEvery, keywordsText: appKeywords })
    : { kind: triggerKind };
  const workingFolder: RoutineWorkspace | null = workFolder && workLevel !== 'none'
    ? { folderId: workFolder.folderId, folderName: workFolder.name, permissions: permissionsForLevel(workLevel), review: team ? false : review }
    : null;
  const editsFolder = workLevel === 'write' || workLevel === 'execute';
  /**
   * A level for the working folder, the way a chat's folder control works (COD-291): the first folder, or a level wider
   * than the one it was picked at, opens the native picker at that level; a narrower one keeps the folder. Cancelling
   * the picker leaves everything as it was.
   */
  const chooseWorkLevel = async (level: WorkspaceLevel, pickAgain = false) => {
    if (level === 'none') { setWorkLevel('none'); return; }
    const within = workFolder && workspaceLevels.indexOf(level) <= workspaceLevels.indexOf(workFolder.granted);
    if (within && !pickAgain) { setWorkLevel(level); return; }
    setBusy(true); setError('');
    try {
      const picked = await orglet.pickRoutineWorkspace(permissionsForLevel(level));
      if (!picked) return;
      setWorkFolder({ folderId: picked.folderId, name: picked.name, granted: level });
      setWorkLevel(level);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  const pickFolder = async () => {
    setBusy(true); setError('');
    try {
      const picked = await orglet.pickWatchFolder();
      if (picked) setFolder({ folderId: picked.folderId, name: picked.name });
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  const initialSnapshot = useRef(snapshot);
  // A new schedule starts at its name. Without this, focus stayed on the button the Create button turned into,
  // "Back to schedules" (COD-283).
  useEffect(() => { if (!routine) nameInput.current?.focus(); }, [routine]);
  useEffect(() => { onDirty(snapshot !== initialSnapshot.current); }, [snapshot, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);
  return <form className="form routine-editor" onSubmit={async event => {
    event.preventDefault(); setError('');
    if (triggerKind === 'schedule' && !TimeZone.safeParse(timeZone).success) {
      setError(INVALID_ZONE());
      event.currentTarget.querySelector<HTMLElement>('[data-field="timeZone"]')?.focus();
      return;
    }
    if (!trigger) { setError(triggerKind === 'app' ? appTriggerProblem({ server: appServer, tool: appTool, argumentsText: appArguments, everyText: appEvery }) : t('Chọn thư mục để lịch theo dõi.')); return; }
    if (triggerKind === 'schedule' && windowInvalid) { setError(t('Giờ bắt đầu của khung giờ phải trước giờ kết thúc.')); return; }
    if (capInvalid) { setError(t('Giới hạn mỗi ngày cần ít nhất bằng giới hạn mỗi lần chạy.')); return; }
    setBusy(true);
    try {
      // Saving is the permission (user, 2026-09-19). The tick that used to ask again said nothing the act of
      // writing a brief, picking a worker, setting a limit and turning it on had not already said. What guards an
      // unattended run is still there: the core stores this exact setup as approvedConfig and refuses to run when
      // the worker, skill, team or model has changed since, and a restored backup comes back off and unapproved.
      // An event trigger still carries the time fields, valid ones, so switching back to the clock keeps them.
      const zone = TimeZone.safeParse(timeZone).success ? timeZone : Intl.DateTimeFormat().resolvedOptions().timeZone;
      // An event trigger keeps an hourly schedule's valid fields too; a window that does not fit is dropped.
      const schedule = windowInvalid ? { ...draftSchedule, window: undefined } : draftSchedule;
      await orglet.call('saveRoutine', { ...(routine ? { id: routine.id } : {}), name, enabled, schedule: { ...schedule, timeZone: zone }, trigger, workspace: workingFolder, task: { workerId: team?.synthesizerId ?? target, ...(team ? { teamId: team.id } : {}), brief, sourceIds: sources.map(source => source.id), excludedSources: initial?.excludedSources ?? [], budgetMicros: toMicros(budget), consent: providers.length > 0, providerScopes: providers,
        ...(toolCapabilities ? { toolCapabilities } : {}), ...(browserLevel === 'read' ? { browser: { profileId: browserProfile, sites: browserSites } } : {}) } });
      saved();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }}>

    <section className="routine-group" aria-labelledby="routine-group-job">
      <h4 id="routine-group-job">{t('Việc cần làm')}</h4>
      <label><FieldLabel icon={CalendarClock} required>{t('Tên lịch')}</FieldLabel><Input ref={nameInput} value={name} onChange={event => setName(event.target.value)} required maxLength={80} placeholder={t('Ví dụ: Review sáng thứ hai')} /></label>
      <label><FieldLabel icon={MessageSquare} required>{t('Brief lặp lại')}</FieldLabel><Textarea rows={4} value={brief} onChange={event => setBrief(event.target.value)} required maxLength={16000} /></label>
      <Select label={<FieldLabel icon={UserRound} required>{t('Giao cho')}</FieldLabel>} value={target} onChange={value => { setTarget(value); }} options={[...workspace.workers.map(worker => ({ value: worker.id, label: worker.name, group: t('Tí'), icon: <WorkerFace worker={worker} size="xs" /> })), ...workspace.teams.map(team => ({ value: `team:${team.id}`, label: channelLabel(team.name), group: t('Kênh'), icon: <RosterAvatars workers={teamRoster(team, workspace.workers)} max={2} /> }))]} />
      <div className="routine-sources">
        <PanelHeading level={3} title={<FieldLabel icon={FileText}>{t('Nguồn ({0}/20)', [sources.length])}</FieldLabel>}>
          <Button type="button" variant="outline" disabled={busy} onClick={async () => {
            setBusy(true); setError('');
            try { const picked = await orglet.pickSources(); if (picked.length + sources.length > 20) throw new Error(t('Lịch có tối đa 20 nguồn. Bỏ bớt nguồn rồi chọn lại.')); setSources([...sources, ...picked]); }
            catch (err) { setError((err as Error).message); } finally { setBusy(false); }
          }}><FilePlus size={15} />{t('Chọn nguồn cho lịch')}</Button>
        </PanelHeading>
        {sources.length > 0 ? <ul className="attachment-list">{sources.map(source => <Attachment key={source.id} name={source.name} bytes={source.bytes} removeLabel={t('Bỏ nguồn {0}', [source.name])} onRemove={() => { setSources(sources.filter(item => item.id !== source.id)); }} />)}</ul> : <p className="muted">{t('Chưa chọn nguồn. Lịch vẫn chạy được chỉ với brief.')}</p>}
        <p className="muted">{t('Tệp đã đổi hoặc bị thu hồi sẽ chặn lần chạy; chọn lại rồi lưu lịch.')}</p>
      </div>
    </section>

    <section className="routine-group" aria-labelledby="routine-group-time">
      <h4 id="routine-group-time">{t('Khi nào chạy')}</h4>
      <Select label={<FieldLabel icon={Zap} required>{t('Bắt đầu')}</FieldLabel>} value={triggerKind} onChange={value => { setTriggerKind(value as RoutineTriggerKind); if (zoneError) setError(''); }} options={[
        { value: 'schedule', label: t('Theo lịch'), icon: <CalendarClock size={16} /> },
        { value: 'folder', label: t('Khi có tệp mới'), icon: <FolderInput size={16} /> },
        { value: 'called', label: t('Chỉ khi được gọi'), icon: <SquareTerminal size={16} /> },
        { value: 'app', label: t('Khi có mục mới trong ứng dụng'), icon: <Webhook size={16} /> },
      ]} />
      {triggerKind === 'schedule' && <>
        <div className="field-grid">
          <Select label={<FieldLabel icon={Repeat} required>{t('Tần suất')}</FieldLabel>} value={frequency} onChange={value => { setFrequency(value as ScheduleFrequency); }} options={[
            { value: 'daily', label: t('Hằng ngày'), icon: <Sun size={16} /> },
            { value: 'weekdays', label: t('Ngày thường (T2–T6)'), icon: <Briefcase size={16} /> },
            { value: 'weekly', label: t('Hằng tuần'), icon: <CalendarRange size={16} /> },
            { value: 'hours', label: t('Theo giờ'), icon: <Timer size={16} /> },
          ]} />
          {frequency === 'weekly' && <Select label={<FieldLabel icon={CalendarDays} required>{t('Ngày trong tuần')}</FieldLabel>} value={String(weekday)} onChange={value => { setWeekday(Number(value)); }} options={weekdays.map((day, index) => ({ value: String(index), label: day }))} />}
          {frequency === 'hours'
            ? <Select label={<FieldLabel icon={Timer} required>{t('Cách nhau')}</FieldLabel>} value={String(everyHours)} onChange={value => { setEveryHours(Number(value)); }} options={EVERY_HOURS_CHOICES.map(hours => ({ value: String(hours), label: everyHoursInWords(hours) }))} />
            : <label><FieldLabel icon={Clock} required>{t('Giờ chạy')}</FieldLabel><Input type="time" value={time} onChange={event => setTime(event.target.value)} required /></label>}
          <Select label={<FieldLabel icon={Globe} required>{t('Múi giờ')}</FieldLabel>} value={timeZone} field="timeZone" menuMinWidth={300} invalid={zoneError} describedBy={zoneError ? 'routine-zone-error' : undefined}
            onChange={value => { setTimeZone(value); if (zoneError) setError(''); }}
            options={zoneChoices.map(zone => ({ value: zone.value, label: zone.label, detail: zone.offset || undefined, group: zone.system ? t('Máy này') : zone.region || t('Khác') }))} inlineDetail />
        </div>
        {zoneError && <p id="routine-zone-error" role="alert" className="error">{error}</p>}
        {/* An hourly schedule may keep to part of the day and to weekdays (COD-288). Each is on or off, so a switch. */}
        {frequency === 'hours' && <div className="routine-hours">
          <SwitchField checked={windowOn} onChange={setWindowOn}
            description={windowOn ? t('Lần đầu lúc giờ bắt đầu, lần cuối trước giờ kết thúc.') : t('Chạy suốt ngày, từ nửa đêm.')}>
            <FieldLabel icon={Clock}>{t('Chỉ trong khung giờ')}</FieldLabel>
          </SwitchField>
          {windowOn && <div className="field-grid">
            <label><FieldLabel icon={Clock} required>{t('Từ')}</FieldLabel><Input type="time" value={windowFrom} onChange={event => setWindowFrom(event.target.value)} aria-invalid={windowInvalid || undefined} required /></label>
            <label><FieldLabel icon={Clock} required>{t('Đến')}</FieldLabel><Input type="time" value={windowTo} onChange={event => setWindowTo(event.target.value)} aria-invalid={windowInvalid || undefined} required /></label>
          </div>}
          <SwitchField checked={weekdaysOnly} onChange={setWeekdaysOnly} description={t('Thứ hai đến thứ sáu.')}>
            <FieldLabel icon={Briefcase}>{t('Chỉ ngày thường')}</FieldLabel>
          </SwitchField>
        </div>}
        <p className="muted">{frequency === 'hours'
          ? t('Chỉ chạy khi Orglet đang mở. Đến giờ mà lần trước chưa xong thì bỏ qua giờ đó.')
          : t('Chỉ chạy khi Orglet đang mở; các lần lỡ gộp thành một lần chạy bù.')}</p>
      </>}
      {triggerKind === 'folder' && <div className="routine-folder">
        <PanelHeading level={3} title={<FieldLabel icon={FolderOpen} required>{t('Thư mục theo dõi')}</FieldLabel>}>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void pickFolder()}><FolderInput size={15} />{folder ? t('Đổi thư mục') : t('Chọn thư mục')}</Button>
        </PanelHeading>
        {folder ? <p className="routine-folder-name"><Folder size={15} aria-hidden="true" /><span title={folder.name}>{folder.name}</span><span className="muted">{t('Chỉ đọc')}</span></p> : <p className="muted">{t('Chưa chọn thư mục.')}</p>}
        <p className="muted">{t('Mỗi tệp mới trong thư mục này bắt đầu một lần chạy, với tệp đó đính kèm; nhiều tệp đến cùng lúc chạy chung một lần. Chỉ theo dõi khi Orglet đang mở. Tệp có sẵn và tệp đến khi app tắt không được chạy.')}</p>
      </div>}
      {triggerKind === 'app' && <div className="routine-app">
        {appServers.length === 0
          ? <p className="muted">{t('Chưa có ứng dụng nào đang bật. Kết nối một ứng dụng trong Cài đặt → MCP trước.')}</p>
          : <>
            <div className="field-grid">
              <Select label={<FieldLabel icon={Webhook} required>{t('Ứng dụng')}</FieldLabel>} value={appServerId} onChange={value => { setAppServerId(value); setAppTool(''); }}
                options={appServers.map(server => ({ value: server.id, label: server.name }))} />
              {readOnlyTools.length > 0 && <Select label={<FieldLabel icon={SquareTerminal} required>{t('Công cụ chỉ đọc')}</FieldLabel>} value={appTool} onChange={setAppTool} menuMinWidth={280}
                options={readOnlyTools.map(tool => ({ value: tool.name, label: tool.name, detail: tool.description || undefined }))} />}
            </div>
            {readOnlyTools.length === 0 && <p className="muted">{t('Ứng dụng này chưa có công cụ chỉ đọc. Bấm Kiểm tra kết nối trong Cài đặt → MCP để tải lại danh sách.')}</p>}
            <label><FieldLabel icon={FileText}>{t('Tham số (JSON)')}</FieldLabel><Textarea className="mcp-mono" rows={3} value={appArguments} onChange={event => setAppArguments(event.target.value)} spellCheck={false} /></label>
            <div className="field-grid">
              <label><FieldLabel icon={Timer} required>{t('Xem lại sau mỗi (phút)')}</FieldLabel><Input type="number" min={APP_TRIGGER_MINUTES.least} max={APP_TRIGGER_MINUTES.most} value={appEvery} onChange={event => setAppEvery(event.target.value)} required /></label>
              <label><FieldLabel icon={MessageSquare}>{t('Chỉ khi có một trong các từ')}</FieldLabel><Input value={appKeywords} onChange={event => setAppKeywords(event.target.value)} placeholder={t('Ví dụ: urgent, hóa đơn')} /></label>
            </div>
          </>}
        <p className="muted">{t('Orglet tự gọi công cụ này theo khoảng thời gian đã chọn, khi app đang mở. Lần đầu chỉ ghi nhận những gì đang có; mục mới sau đó bắt đầu một lần chạy, đính kèm dưới dạng tệp. Chỉ công cụ mà ứng dụng đánh dấu là chỉ đọc mới được chọn.')}</p>
      </div>}
      {triggerKind === 'called' && <div className="routine-called">
        <CommandBlock command={runCommandOf(name.trim() || t('Tên lịch'))} label={t('Chạy từ terminal')} copyLabel={t('Sao chép lệnh')} copyIcon={<Copy size={14} />} onCopy={next => void copyCommand(next)} />
        <p className="muted">{t('Lịch chỉ chạy khi lệnh này gọi nó, lúc Orglet đang mở. Thêm --file để đính kèm tệp cho lần đó.')}</p>
      </div>}
    </section>

    <section className="routine-group" aria-labelledby="routine-group-limits">
      <h4 id="routine-group-limits">{t('Giới hạn & quyền')}</h4>
      <label><FieldLabel icon={Wallet} required>{t('Giới hạn mỗi lần chạy')}</FieldLabel><MoneyInput type="number" min="0" step="any" value={budget} onChange={setBudget} required /></label>
      {/* The ceiling is said before saving (COD-288), and a lower daily cap can be set under it. */}
      <div className="routine-cap">
        <label><FieldLabel icon={Gauge}>{t('Giới hạn mỗi ngày')}</FieldLabel><MoneyInput type="number" min="0" step="any" value={dailyCap} onChange={setDailyCap} placeholder={t('Không giới hạn')} invalid={capInvalid} aria-describedby="routine-cap-ceiling" /></label>
        {ceiling && <p id="routine-cap-ceiling" className="muted">{ceiling}</p>}
      </div>
      {/* The schedule's own folder (COD-294): the chat's folder levels and native picker, saved and approved with the
          schedule. Without it a scheduled run has no folder, whatever the orglet's chat was given. */}
      <div className="routine-workspace">
        <Select label={<FieldLabel icon={FolderOpen}>{t('Thư mục làm việc')}</FieldLabel>} value={workLevel} disabled={busy || !providers.length}
          onChange={value => void chooseWorkLevel(value as WorkspaceLevel)}
          options={workspaceLevels.map(level => ({ value: level, label: workspaceLevelNames[level] }))} />
        {workFolder && workLevel !== 'none' && <p className="routine-folder-name"><Folder size={15} aria-hidden="true" /><span title={workFolder.name}>{workFolder.name}</span>
          <button type="button" className="text-link" disabled={busy} aria-label={t('Đổi thư mục làm việc {0}', [workFolder.name])} onClick={() => void chooseWorkLevel(workLevel, true)}>{t('Đổi')}</button></p>}
        <p className="muted">{workLevel === 'none'
          ? t('Không có thư mục, mỗi lần chạy chỉ có brief và nguồn.')
          : workLevel === 'execute'
            ? t('Mỗi lần chạy làm trên bản sao riêng của thư mục. Lệnh chạy không có mạng.')
            : t('Mỗi lần chạy làm trên bản sao riêng của thư mục.')}</p>
        {editsFolder && <SwitchField checked={team ? false : review} onChange={setReview} disabled={busy || Boolean(team)}
          description={team
            ? t('Kênh áp dụng thay đổi của từng Tí ngay khi Tí đó xong, vì Tí sau làm tiếp trên các tệp đó.')
            : review
              ? t('Thay đổi chờ trong chat của lần chạy đến khi bạn bấm Áp dụng. Lần chạy sau đợi đến lúc đó.')
              : t('Thay đổi vào thư mục ngay khi lần chạy xong.')}>
          <FieldLabel icon={FileDiff}>{t('Xem trước khi áp dụng')}</FieldLabel>
        </SwitchField>}
      </div>
      <SwitchField checked={web} onChange={setWeb} disabled={!providers.length}
        description={t('Tìm qua {0}, đọc trang web công khai.', [WEB_SEARCH_PROVIDER_NAMES[workspace.webSearchProvider]])}>
        <FieldLabel icon={Globe}>{t('Đọc và tìm kiếm web')}</FieldLabel>
      </SwitchField>
      <Select label={<FieldLabel icon={AppWindow}>{t('Trình duyệt')}</FieldLabel>} value={browserLevel} onChange={value => setBrowserLevel(value as BrowserLevel)}
        options={routineBrowserLevels.map(level => ({ value: level, label: level === 'read' ? t('Đọc trang') : t('Không dùng trình duyệt') }))} />
      {browserLevel === 'read' && <div className="routine-browser">
        <Select label={<FieldLabel icon={UserRound}>{t('Hồ sơ trình duyệt')}</FieldLabel>} value={browserProfile} onChange={value => setBrowserProfile(value as BrowserProfileId)} options={profileOptions(browser.state, browserProfile)} />
        <div className="routine-browser-sites">
          <FieldLabel icon={ShieldCheck}>{t('Trang')}</FieldLabel>
          <BrowserSitesEditor sites={browserSites} disabled={busy} onChange={setBrowserSites} />
        </div>
        <p className="muted">{t('Lịch chỉ đọc trang, không bấm hay gửi gì. Trang trên máy này hoặc mạng nội bộ cần có trong danh sách; hồ sơ đã đăng nhập chỉ mở trang được phép.')}</p>
      </div>}
      <SwitchField checked={enabled} onChange={setEnabled}>{t('Bật lịch')}</SwitchField>
      {/* Where the data goes is worth saying; it just is not worth asking about twice, since saving is the
          permission (user, 2026-09-19). It stays as a plain line rather than a tick. */}
      {enabled && <p className="muted">{sources.length > 0
        ? sources.length === 1 ? t('Mỗi lần chạy gửi brief và nguồn này {0}, trong giới hạn trên.', [destination]) : t('Mỗi lần chạy gửi brief và {0} nguồn này {1}, trong giới hạn trên.', [sources.length, destination])
        : t('Mỗi lần chạy gửi brief này {0}, trong giới hạn trên.', [destination])}</p>}
      <p className="muted">{browserLevel === 'read' ? t('Đổi Tí, skill, kênh, model, hồ sơ hay danh sách trang thì cần lưu lịch lại.') : t('Đổi Tí, skill, kênh hay model thì cần lưu lịch lại.')}</p>
    </section>
    <div className="sticky-actions">{error && !zoneError ? <p className="form-error" role="alert">{error}</p> : null}<Button type="button" variant="outline" disabled={busy} onClick={back}>{t('Hủy')}</Button><Button variant="primary" disabled={busy}>{t('Lưu lịch')}</Button></div>
  </form>;
}
