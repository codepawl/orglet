import { useEffect, useRef, useState } from 'react';
import type { Routine, TaskInput, Worker, Workspace } from '../../shared/contracts';
import { Button, FieldLabel, MoneyInput, PanelHeading } from './ui';
import { Attachment } from './Attachment';
import { AppWindow, ShieldCheck, CalendarRange, Sun, Users, AlertTriangle, ArrowLeft, CalendarClock, CalendarDays, Clock, Copy, FilePlus, FileText, Folder, FolderInput, FolderOpen, Globe, MessageSquare, MessageSquareText, Pencil, Repeat, SquareTerminal, UserRound, Wallet, Zap } from 'lucide-react';
import { providerLabel } from './providers';
import { formatMoney, toAmount, toMicros } from './money';
import { TimeZone } from '../../shared/schedule';
import { Select } from './Select';
import { t } from '../i18n';
import { currentLanguage, currentLocale, translated, tMessage } from '../i18n';
import { orglet } from '../api';
import { Switch, SwitchField } from './Switch';
import { StatusMark } from './StatusMark';
import { CommandBlock, Input, Textarea } from '@codepawl/orglet-ui';
import { triggerOf, type RoutineTrigger, type RoutineTriggerKind } from '../../shared/routine-triggers';
import { toast } from './toast';
import { Avatar, RosterAvatars } from './Avatar';
import { teamRoster } from '../assignees';
import { BrowserSitesEditor, profileOptions, useBrowserState } from './BrowserSettings';
import { browserLevelOf, capabilitiesWithBrowserLevel, defaultBrowserChoice, routineBrowserLevels, type BrowserLevel, type BrowserProfileId, type BrowserSite } from '../../shared/browser';
import { snapshotCapabilities, withCapability, type ToolCapability } from '../../shared/tool-policy';
import { WEB_SEARCH_PROVIDER_NAMES } from '../../shared/web-tools';

const weekdays = translated(['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy']);
export const formatRoutineTime = (iso: string, timeZone: string) => new Date(iso).toLocaleString(currentLocale(), { timeZone, dateStyle: 'short', timeStyle: 'short' });
/** The command that starts a routine from a terminal (COD-245); the name is quoted so spaces survive the shell. */
export const runCommandOf = (name: string) => `orglet run "${name.replace(/"/g, '\\"')}"`;
const TRIGGER_ICONS: Record<RoutineTriggerKind, typeof CalendarClock> = { schedule: CalendarClock, folder: FolderInput, called: SquareTerminal };
/** The routine's trigger in a few words, for the one line under its name. */
function triggerSummary(routine: Routine): string {
  const trigger = triggerOf(routine);
  if (trigger.kind === 'folder') return t('Khi có tệp mới trong {0}', [trigger.folderName]);
  if (trigger.kind === 'called') return t('Chỉ khi được gọi');
  // Vietnamese writes the day in lower case mid-sentence ("Mỗi thứ hai"); English keeps "Every Monday".
  const day = currentLanguage() === 'vi' ? weekdays[routine.schedule.weekday].toLowerCase() : weekdays[routine.schedule.weekday];
  const cadence = routine.schedule.frequency === 'daily' ? t('Hằng ngày') : t('Mỗi {0}', [day]);
  return t('{0} lúc {1}', [cadence, routine.schedule.time]);
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
/** Which screen of the Routines dialog is showing; the dialog title renders it as a breadcrumb. */
export type RoutineView = { editing: false } | { editing: true; routine?: Routine };
export function RoutinesPanel({ workspace, draft, openTask, view, onView, onBack, onDirty }: { workspace: Workspace; draft?: TaskInput; openTask: (id: string) => void; view: RoutineView; onView: (view: RoutineView) => void; onBack: () => void; onDirty: (dirty: boolean) => void }) {
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const action = async (fn: () => Promise<unknown>) => { setBusy(true); setError(''); try { await fn(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); } };
  if (view.editing) return <RoutineEditor key={view.routine?.id ?? 'new'} routine={view.routine} draft={view.routine ? undefined : draft} workspace={workspace} saved={() => { onDirty(false); onView({ editing: false }); }} back={onBack} onDirty={onDirty} />;
  const assignee = (item: Routine) => item.task.teamId ? workspace.teams.find(team => team.id === item.task.teamId)?.name ?? t('Hội đã xóa') : workspace.workers.find(worker => worker.id === item.task.workerId)?.name ?? t('Tí đã xóa');
  /** The face of whoever runs the schedule: the orglet's own, a crew's first members, or the plain icon once it is gone. */
  const assigneeFace = (item: Routine) => {
    if (item.task.teamId) {
      const team = workspace.teams.find(entry => entry.id === item.task.teamId);
      return team ? <RosterAvatars workers={teamRoster(team, workspace.workers)} max={2} /> : <Users size={14} aria-hidden="true" />;
    }
    const worker = workspace.workers.find(entry => entry.id === item.task.workerId);
    return worker ? <WorkerFace worker={worker} size="xxs" /> : <UserRound size={14} aria-hidden="true" />;
  };
  return <div className="form">
          {!workspace.routines.length && <div className="routine-empty"><CalendarClock size={28} aria-hidden="true" /><p>{t('Chưa có lịch.')}</p><p className="muted">{t('Tạo một lịch, hoặc viết brief rồi chọn “Lên lịch cho tin này”.')}</p></div>}
    <div className="routine-list">
      {workspace.routines.map(item => {
        const trigger = triggerOf(item);
        const TriggerIcon = TRIGGER_ICONS[trigger.kind];
        const summary = triggerSummary(item);
        return <section key={item.id} className="routine-card" aria-label={t('Lịch {0}', [item.name])}>
        <div className="routine-head">
          <span className="routine-icon" aria-hidden="true"><TriggerIcon size={18} /></span>
          <div className="routine-title"><h3>{item.name}</h3>
            {/* One line under the name: on or off, then what starts it. It never wraps; a long folder name ends in … */}
            <p className="routine-subline"><span className={`status-pill ${item.enabled ? 'logged_in' : ''}`}><StatusMark variant={item.enabled ? 'filled' : 'empty'} tone={item.enabled ? 'success' : 'muted'} label={item.enabled ? t('Đang bật') : t('Đã tắt')} decorative />{item.enabled ? t('Đang bật') : t('Đã tắt')}</span><span className="routine-trigger" title={summary}>{summary}</span></p>
          </div>
          <div className="routine-actions">
            <Button size="icon" aria-label={t('Sửa lịch {0}', [item.name])} title={t('Sửa lịch')} disabled={busy} onClick={() => onView({ editing: true, routine: item })}><Pencil size={16} /></Button>
            {/* On or off is two states, so it wears a switch (user, 2026-09-19). Its name stays "Bật lịch"
                whichever way it is set, because the state is what aria-checked says. */}
            <Switch checked={item.enabled} disabled={busy} label={t('Bật lịch')}
              onChange={enabled => void action(() => orglet.call('saveRoutine', { id: item.id, name: item.name, enabled, schedule: item.schedule, ...(item.trigger ? { trigger: item.trigger } : {}), task: item.task }))} />
          </div>
        </div>
        <ul className="routine-meta">
          {trigger.kind === 'schedule' && <li><Globe size={14} aria-hidden="true" />{item.schedule.timeZone}</li>}
          {trigger.kind === 'schedule' && item.enabled && <li><CalendarDays size={14} aria-hidden="true" />{t('Lần tới {0}', [formatRoutineTime(item.nextDueAt, item.schedule.timeZone)])}</li>}
          <li>{assigneeFace(item)}{assignee(item)}</li>
          <li><Wallet size={14} aria-hidden="true" />{t('{0} mỗi lần', [formatMoney(item.task.budgetMicros)])}</li>
          {/* A schedule with no sources says nothing about them, rather than "0 sources" (COD-258). */}
          {item.task.sourceIds.length > 0 && <li><FileText size={14} aria-hidden="true" />{t('{0} nguồn', [item.task.sourceIds.length])}</li>}
        </ul>
        <p className="routine-brief"><MessageSquareText size={14} aria-hidden="true" /><span>{item.task.brief}</span></p>
        {item.pending && <div className="routine-alert" role="status"><AlertTriangle size={16} aria-hidden="true" /><div>
          <h4>{t('Lần chạy bị lỡ')}</h4>
          <p>{tMessage(item.pending.reason)}</p>
          <p className="muted">{t('Lần bị lỡ {0}. Nhiều lần lỡ gộp thành một lần chạy bù.', [formatRoutineTime(item.pending.dueAt, item.schedule.timeZone)])}</p>
          <div className="actions">
          <Button disabled={busy || !item.enabled} variant="primary" onClick={() => void action(async () => openTask(await orglet.call('catchUpRoutine', { id: item.id })))}>{t('Chạy bù một lần')}</Button>
          <Button disabled={busy} onClick={() => void action(() => orglet.call('dismissRoutine', { id: item.id }))}>{t('Bỏ qua lần lỡ')}</Button>
        </div></div></div>}
        {item.notice && <div className="routine-alert" role="status"><AlertTriangle size={16} aria-hidden="true" /><div>
          <h4>{t('Lịch chưa chạy')}</h4>
          <p>{tMessage(item.notice.reason)}</p>
          <p className="muted">{t('Lúc {0}. Tệp đến khi app tắt không được chạy lại.', [formatRoutineTime(item.notice.at, item.schedule.timeZone)])}</p>
          <div className="actions"><Button disabled={busy} onClick={() => void action(() => orglet.call('dismissRoutine', { id: item.id }))}>{t('Ẩn thông báo')}</Button></div>
        </div></div>}
        {item.lastTaskId && <Button className="routine-last" disabled={busy} onClick={() => openTask(item.lastTaskId!)}><MessageSquare size={15} />{t('Mở lần chạy gần nhất')}</Button>}
      </section>;
      })}
    </div>
    {error && <p role="alert" className="error">{error}</p>}
  </div>;
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
  const [target, setTarget] = useState(initial?.teamId ? `team:${initial.teamId}` : initial?.workerId ?? workspace.workers[0].id);
  const [sources, setSources] = useState<{ id: string; name: string; bytes?: number }[]>((initial?.sourceIds ?? []).map(id => ({ id, name: t('Nguồn {0}', [id.slice(0, 8)]) })));
  const [budget, setBudget] = useState(toAmount(initial?.budgetMicros ?? 500_000));
  const [frequency, setFrequency] = useState(routine?.schedule.frequency ?? 'daily');
  const [weekday, setWeekday] = useState(routine?.schedule.weekday ?? 1);
  const [time, setTime] = useState(routine?.schedule.time ?? '09:00');
  const [timeZone, setTimeZone] = useState(routine?.schedule.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [enabled, setEnabled] = useState(routine?.enabled ?? true);
  const initialTrigger = routine ? triggerOf(routine) : undefined;
  const [triggerKind, setTriggerKind] = useState<RoutineTriggerKind>(initialTrigger?.kind ?? 'schedule');
  const [folder, setFolder] = useState<{ folderId: string; name: string } | undefined>(initialTrigger?.kind === 'folder' ? { folderId: initialTrigger.folderId, name: initialTrigger.folderName } : undefined);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  // A schedule may read pages with the profile and site list saved here; saving is what approves them (COD-261).
  // A schedule never acts on pages (COD-261), so reading is the most it can be set to.
  const [browserLevel, setBrowserLevel] = useState<BrowserLevel>(browserLevelOf(initial?.toolCapabilities ?? []) === 'none' ? 'none' : 'read');
  const [browserProfile, setBrowserProfile] = useState<BrowserProfileId>((initial?.browser ?? defaultBrowserChoice()).profileId);
  const [browserSites, setBrowserSites] = useState<BrowserSite[]>(initial?.browser?.sites ?? []);
  // A weekly "check what changed on the web" needs web search as much as the browser; a search never asks anyone,
  // so an unattended run may use it like a chat can (dogfood, 2026-09-26).
  const [web, setWeb] = useState((initial?.toolCapabilities ?? []).includes('network.web'));
  const browser = useBrowserState();
  const zoneInput = useRef<HTMLInputElement>(null);
  const zoneError = error.startsWith('Timezone');
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
  const destination = providers.length ? t('đến {0}', [providers.map(providerLabel).join(t(' và '))]) : t('ở chế độ Demo');
  // Leaving asks for confirmation only when something differs from what the editor opened with.
  const snapshot = JSON.stringify([name, brief, target, sources.map(source => source.id), budget, frequency, weekday, time, timeZone, enabled, triggerKind, folder?.folderId, browserLevel, browserProfile, browserSites.map(entry => `${entry.decision}:${entry.site}`), web]);
  // The permissions the saved task carries: what it had, with the web and the browser as chosen here. A schedule
  // that never had either keeps carrying none, so saving it again changes nothing.
  const leadProvider = (workspace.workers.find(worker => worker.id === (team?.synthesizerId ?? target)) ?? workspace.workers[0]).provider;
  const toolCapabilities = scheduleCapabilities(initial?.toolCapabilities, leadProvider, browserLevel === 'read', web);
  const trigger: RoutineTrigger | undefined = triggerKind === 'folder'
    ? folder && { kind: 'folder', folderId: folder.folderId, folderName: folder.name }
    : { kind: triggerKind };
  const pickFolder = async () => {
    setBusy(true); setError('');
    try {
      const picked = await orglet.pickWatchFolder();
      if (picked) setFolder({ folderId: picked.folderId, name: picked.name });
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  const initialSnapshot = useRef(snapshot);
  useEffect(() => { onDirty(snapshot !== initialSnapshot.current); }, [snapshot, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);
  return <form className="form routine-editor" onSubmit={async event => {
    event.preventDefault(); setError('');
    if (triggerKind === 'schedule' && !TimeZone.safeParse(timeZone).success) { setError(t('Timezone không hợp lệ. Dùng tên như Asia/Ho_Chi_Minh hoặc UTC.')); zoneInput.current?.focus(); return; }
    if (!trigger) { setError(t('Chọn thư mục để lịch theo dõi.')); return; }
    setBusy(true);
    try {
      // Saving is the permission (user, 2026-09-19). The tick that used to ask again said nothing the act of
      // writing a brief, picking a worker, setting a limit and turning it on had not already said. What guards an
      // unattended run is still there: the core stores this exact setup as approvedConfig and refuses to run when
      // the worker, skill, team or model has changed since, and a restored backup comes back off and unapproved.
      // An event trigger still carries the time fields, valid ones, so switching back to the clock keeps them.
      const zone = TimeZone.safeParse(timeZone).success ? timeZone : Intl.DateTimeFormat().resolvedOptions().timeZone;
      await orglet.call('saveRoutine', { ...(routine ? { id: routine.id } : {}), name, enabled, schedule: { frequency, weekday, time, timeZone: zone }, trigger, task: { workerId: team?.synthesizerId ?? target, ...(team ? { teamId: team.id } : {}), brief, sourceIds: sources.map(source => source.id), excludedSources: initial?.excludedSources ?? [], budgetMicros: toMicros(budget), consent: providers.length > 0, providerScopes: providers,
        ...(toolCapabilities ? { toolCapabilities } : {}), ...(browserLevel === 'read' ? { browser: { profileId: browserProfile, sites: browserSites } } : {}) } });
      saved();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }}>

    <section className="routine-group" aria-labelledby="routine-group-job">
      <h4 id="routine-group-job">{t('Công việc')}</h4>
      <label><FieldLabel icon={CalendarClock} required>{t('Tên lịch')}</FieldLabel><Input value={name} onChange={event => setName(event.target.value)} required maxLength={80} placeholder={t('Ví dụ: Review sáng thứ hai')} /></label>
      <label><FieldLabel icon={MessageSquare} required>{t('Brief lặp lại')}</FieldLabel><Textarea rows={4} value={brief} onChange={event => setBrief(event.target.value)} required maxLength={16000} /></label>
      <Select label={<FieldLabel icon={UserRound} required>{t('Giao cho')}</FieldLabel>} value={target} onChange={value => { setTarget(value); }} options={[...workspace.workers.map(worker => ({ value: worker.id, label: worker.name, group: t('Tí'), icon: <WorkerFace worker={worker} size="xs" /> })), ...workspace.teams.map(team => ({ value: `team:${team.id}`, label: team.name, group: t('Hội'), icon: <RosterAvatars workers={teamRoster(team, workspace.workers)} max={2} /> }))]} />
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
      ]} />
      {triggerKind === 'schedule' && <>
        <div className="field-grid">
          <Select label={<FieldLabel icon={Repeat} required>{t('Tần suất')}</FieldLabel>} value={frequency} onChange={value => { setFrequency(value as typeof frequency); }} options={[{ value: 'daily', label: t('Hằng ngày'), icon: <Sun size={16} /> }, { value: 'weekly', label: t('Hằng tuần'), icon: <CalendarRange size={16} /> }]} />
          {frequency === 'weekly' && <Select label={<FieldLabel icon={CalendarDays} required>{t('Ngày trong tuần')}</FieldLabel>} value={String(weekday)} onChange={value => { setWeekday(Number(value)); }} options={weekdays.map((day, index) => ({ value: String(index), label: day }))} />}
          <label><FieldLabel icon={Clock} required>{t('Giờ chạy')}</FieldLabel><Input type="time" value={time} onChange={event => setTime(event.target.value)} required /></label>
          <label><FieldLabel icon={Globe} required>Timezone</FieldLabel><Input ref={zoneInput} value={timeZone} onChange={event => { setTimeZone(event.target.value); if (zoneError) setError(''); }} required maxLength={100} placeholder="Asia/Ho_Chi_Minh" aria-invalid={zoneError || undefined} aria-describedby={zoneError ? 'routine-zone-error' : undefined} data-flash={zoneError ? 1 : undefined} /></label>
        </div>
        {zoneError && <p id="routine-zone-error" role="alert" className="error">{error}</p>}
        <p className="muted">{t('Chỉ chạy khi Orglet đang mở; các lần lỡ gộp thành một lần chạy bù.')}</p>
      </>}
      {triggerKind === 'folder' && <div className="routine-folder">
        <PanelHeading level={3} title={<FieldLabel icon={FolderOpen} required>{t('Thư mục theo dõi')}</FieldLabel>}>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void pickFolder()}><FolderInput size={15} />{folder ? t('Đổi thư mục') : t('Chọn thư mục')}</Button>
        </PanelHeading>
        {folder ? <p className="routine-folder-name"><Folder size={15} aria-hidden="true" /><span title={folder.name}>{folder.name}</span><span className="muted">{t('Chỉ đọc')}</span></p> : <p className="muted">{t('Chưa chọn thư mục.')}</p>}
        <p className="muted">{t('Mỗi tệp mới trong thư mục này bắt đầu một lần chạy, với tệp đó đính kèm; nhiều tệp đến cùng lúc chạy chung một lần. Chỉ theo dõi khi Orglet đang mở. Tệp có sẵn và tệp đến khi app tắt không được chạy.')}</p>
      </div>}
      {triggerKind === 'called' && <div className="routine-called">
        <CommandBlock command={runCommandOf(name.trim() || t('Tên lịch'))} label={t('Chạy từ terminal')} copyLabel={t('Sao chép lệnh')} copyIcon={<Copy size={14} />} onCopy={next => void copyCommand(next)} />
        <p className="muted">{t('Lịch chỉ chạy khi lệnh này gọi nó, lúc Orglet đang mở. Thêm --file để đính kèm tệp cho lần đó.')}</p>
      </div>}
    </section>

    <section className="routine-group" aria-labelledby="routine-group-limits">
      <h4 id="routine-group-limits">{t('Giới hạn & quyền')}</h4>
      <label><FieldLabel icon={Wallet} required>{t('Giới hạn mỗi lần chạy')}</FieldLabel><MoneyInput type="number" min="0" step="any" value={budget} onChange={setBudget} required /></label>
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
        ? t('Mỗi lần chạy gửi brief và {0} nguồn này {1}, trong giới hạn trên.', [sources.length, destination])
        : t('Mỗi lần chạy gửi brief này {0}, trong giới hạn trên.', [destination])}</p>}
      <p className="muted">{browserLevel === 'read' ? t('Đổi Tí, skill, hội, model, hồ sơ hay danh sách trang thì cần lưu lịch lại.') : t('Đổi Tí, skill, hội hay model thì cần lưu lịch lại.')}</p>
    </section>
    <div className="sticky-actions">{error && !zoneError ? <p className="form-error" role="alert">{error}</p> : null}<Button type="button" variant="outline" disabled={busy} onClick={back}><ArrowLeft size={16} />{t('Quay lại')}</Button><Button variant="primary" disabled={busy}>{t('Lưu lịch')}</Button></div>
  </form>;
}
