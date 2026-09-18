import { useEffect, useRef, useState } from 'react';
import type { Routine, TaskInput, Workspace } from '../../shared/contracts';
import { Button, FieldLabel, MoneyInput, PanelHeading } from './ui';
import { CalendarRange, Sun, Users, AlertTriangle, ArrowLeft, CalendarClock, CalendarDays, Clock, FilePlus, FileText, Globe, MessageSquare, MessageSquareText, Pencil, Power, Repeat, UserRound, Wallet, X } from 'lucide-react';
import { providerLabel } from './providers';
import { formatMoney, toAmount, toMicros } from './money';
import { TimeZone } from '../../shared/schedule';
import { Select } from './Select';
import { t } from '../i18n';
import { currentLocale, translated, tMessage } from '../i18n';
import { orglet } from '../api';
import { Checkbox } from './Checkbox';
import { StatusMark } from './StatusMark';

const weekdays = translated(['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy']);
export const formatRoutineTime = (iso: string, timeZone: string) => new Date(iso).toLocaleString(currentLocale(), { timeZone, dateStyle: 'short', timeStyle: 'short' });
/** Which screen of the Routines dialog is showing; the dialog title renders it as a breadcrumb. */
export type RoutineView = { editing: false } | { editing: true; routine?: Routine };
export function RoutinesPanel({ workspace, draft, openTask, view, onView, onBack, onDirty }: { workspace: Workspace; draft?: TaskInput; openTask: (id: string) => void; view: RoutineView; onView: (view: RoutineView) => void; onBack: () => void; onDirty: (dirty: boolean) => void }) {
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const action = async (fn: () => Promise<unknown>) => { setBusy(true); setError(''); try { await fn(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); } };
  if (view.editing) return <RoutineEditor key={view.routine?.id ?? 'new'} routine={view.routine} draft={view.routine ? undefined : draft} workspace={workspace} saved={() => { onDirty(false); onView({ editing: false }); }} back={onBack} onDirty={onDirty} />;
  const assignee = (item: Routine) => item.task.teamId ? workspace.teams.find(team => team.id === item.task.teamId)?.name ?? t('Nhóm đã xóa') : workspace.workers.find(worker => worker.id === item.task.workerId)?.name ?? t('Nhân viên đã xóa');
  return <div className="form">
    {!workspace.routines.length && <div className="routine-empty"><CalendarClock size={28} aria-hidden="true" /><p>{t('Chưa có lịch.')}</p><p className="muted">{t('Tạo một lịch, hoặc viết brief rồi chọn “Lên lịch cho công việc này”.')}</p></div>}
    <div className="routine-list">
      {workspace.routines.map(item => <section key={item.id} className="routine-card" aria-label={t('Lịch {0}', [item.name])}>
        <div className="routine-head">
          <span className="routine-icon" aria-hidden="true"><CalendarClock size={18} /></span>
          <div className="routine-title"><h3>{item.name}</h3><span className={`status-pill ${item.enabled ? 'logged_in' : ''}`}><StatusMark variant={item.enabled ? 'filled' : 'empty'} tone={item.enabled ? 'success' : 'muted'} label={item.enabled ? t('Đang bật') : t('Đã tắt')} decorative />{item.enabled ? t('Đang bật') : t('Đã tắt')}</span></div>
          <div className="routine-actions">
            <Button size="icon" aria-label={t('Sửa lịch {0}', [item.name])} title={t('Sửa lịch')} disabled={busy} onClick={() => onView({ editing: true, routine: item })}><Pencil size={16} /></Button>
            {item.enabled && <Button size="icon" aria-label={t('Tắt lịch')} title={t('Tắt lịch')} disabled={busy} onClick={() => void action(() => orglet.call('saveRoutine', { id: item.id, name: item.name, enabled: false, schedule: item.schedule, task: item.task }))}><Power size={16} /></Button>}
          </div>
        </div>
        <ul className="routine-meta">
          <li><Repeat size={14} aria-hidden="true" />{t('{0} lúc {1}', [item.schedule.frequency === 'daily' ? t('Hằng ngày') : t('Mỗi {0}', [weekdays[item.schedule.weekday].toLowerCase()]), item.schedule.time])}</li>
          <li><Globe size={14} aria-hidden="true" />{item.schedule.timeZone}</li>
          {item.enabled && <li><CalendarDays size={14} aria-hidden="true" />{t('Lần tới {0}', [formatRoutineTime(item.nextDueAt, item.schedule.timeZone)])}</li>}
          <li><UserRound size={14} aria-hidden="true" />{assignee(item)}</li>
          <li><Wallet size={14} aria-hidden="true" />{t('{0} mỗi lần', [formatMoney(item.task.budgetMicros)])}</li>
          <li><FileText size={14} aria-hidden="true" />{t('{0} nguồn', [item.task.sourceIds.length])}</li>
        </ul>
        <p className="routine-brief"><MessageSquareText size={14} aria-hidden="true" /><span>{item.task.brief}</span></p>
        {item.pending && <div className="routine-alert" role="status"><AlertTriangle size={16} aria-hidden="true" /><div>
          <h4>{t('Lần chạy bị lỡ')}</h4>
          <p>{tMessage(item.pending.reason)}</p>
          <p className="muted">{t('Lần bị lỡ {0}. Nhiều lần trong lúc máy tắt được gộp thành một lần chạy bù; lịch tới không mất.', [formatRoutineTime(item.pending.dueAt, item.schedule.timeZone)])}</p>
          <div className="actions">
          <Button disabled={busy || !item.enabled} variant="primary" onClick={() => void action(async () => openTask(await orglet.call('catchUpRoutine', { id: item.id })))}>{t('Chạy bù một lần')}</Button>
          <Button disabled={busy} onClick={() => void action(() => orglet.call('dismissRoutine', { id: item.id }))}>{t('Bỏ qua lần lỡ')}</Button>
        </div></div></div>}
        {item.lastTaskId && <Button className="routine-last" disabled={busy} onClick={() => openTask(item.lastTaskId!)}><MessageSquare size={15} />{t('Mở lần chạy gần nhất')}</Button>}
      </section>)}
    </div>
    {error && <p role="alert" className="error">{error}</p>}
  </div>;
}
function RoutineEditor({ routine, draft, workspace, saved, back, onDirty }: { routine?: Routine; draft?: TaskInput; workspace: Workspace; saved: () => void; back: () => void; onDirty: (dirty: boolean) => void }) {
  const initial = routine?.task ?? draft;
  const [name, setName] = useState(routine?.name ?? '');
  const [brief, setBrief] = useState(initial?.brief ?? '');
  const [target, setTarget] = useState(initial?.teamId ? `team:${initial.teamId}` : initial?.workerId ?? workspace.workers[0].id);
  const [sources, setSources] = useState<{ id: string; name: string }[]>((initial?.sourceIds ?? []).map(id => ({ id, name: t('Nguồn {0}', [id.slice(0, 8)]) })));
  const [budget, setBudget] = useState(toAmount(initial?.budgetMicros ?? 500_000));
  const [frequency, setFrequency] = useState(routine?.schedule.frequency ?? 'daily');
  const [weekday, setWeekday] = useState(routine?.schedule.weekday ?? 1);
  const [time, setTime] = useState(routine?.schedule.time ?? '09:00');
  const [timeZone, setTimeZone] = useState(routine?.schedule.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [enabled, setEnabled] = useState(routine?.enabled ?? true); const [approved, setApproved] = useState(false);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const zoneInput = useRef<HTMLInputElement>(null); const approvalInput = useRef<HTMLInputElement>(null);
  const zoneError = error.startsWith('Timezone'); const approvalError = error === t('Cần xác nhận quyền tự chạy cho lịch này.');
  const team = workspace.teams.find(team => `team:${team.id}` === target);
  useEffect(() => {
    let cancelled = false;
    void orglet.call('sourceMetadata', { ids: initial?.sourceIds ?? [] }).then(metadata => {
      if (!cancelled) setSources(current => current.map(source => ({ ...source, name: metadata.find(item => item.id === source.id)?.name ?? source.name })));
    }).catch(err => { if (!cancelled) setError((err as Error).message); });
    return () => { cancelled = true; };
  }, [initial]);
  const workers = team ? workspace.workers.filter(worker => [...team.memberIds, team.synthesizerId].includes(worker.id)) : workspace.workers.filter(worker => worker.id === target);
  const providers = [...new Set(workers.map(worker => worker.provider).filter(provider => provider !== 'demo'))];
  // Leaving asks for confirmation only when something differs from what the editor opened with.
  const snapshot = JSON.stringify([name, brief, target, sources.map(source => source.id), budget, frequency, weekday, time, timeZone, enabled]);
  const initialSnapshot = useRef(snapshot);
  useEffect(() => { onDirty(snapshot !== initialSnapshot.current); }, [snapshot, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);
  return <form className="form routine-editor" onChange={() => setApproved(false)} onSubmit={async event => {
    event.preventDefault(); setError('');
    if (!TimeZone.safeParse(timeZone).success) { setError(t('Timezone không hợp lệ. Dùng tên như Asia/Ho_Chi_Minh hoặc UTC.')); zoneInput.current?.focus(); return; }
    if (enabled && !approved) { setError(t('Cần xác nhận quyền tự chạy cho lịch này.')); approvalInput.current?.focus(); return; }
    setBusy(true);
    try {
      await orglet.call('saveRoutine', { ...(routine ? { id: routine.id } : {}), name, enabled, schedule: { frequency, weekday, time, timeZone }, task: { workerId: team?.synthesizerId ?? target, ...(team ? { teamId: team.id } : {}), brief, sourceIds: sources.map(source => source.id), excludedSources: initial?.excludedSources ?? [], budgetMicros: toMicros(budget), consent: approved && providers.length > 0, providerScopes: approved ? providers : [] } });
      saved();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }}>

    <section className="routine-group" aria-labelledby="routine-group-job">
      <h4 id="routine-group-job">{t('Công việc')}</h4>
      <label><FieldLabel icon={CalendarClock} required>{t('Tên lịch')}</FieldLabel><input value={name} onChange={event => setName(event.target.value)} required maxLength={80} placeholder={t('Ví dụ: Review sáng thứ hai')} /></label>
      <label><FieldLabel icon={MessageSquare} required>{t('Brief lặp lại')}</FieldLabel><textarea rows={4} value={brief} onChange={event => setBrief(event.target.value)} required maxLength={16000} /></label>
      <Select label={<FieldLabel icon={UserRound} required>Giao cho</FieldLabel>} value={target} onChange={value => { setTarget(value); setApproved(false); }} options={[...workspace.workers.map(worker => ({ value: worker.id, label: worker.name, group: t('Nhân viên'), icon: <UserRound size={16} /> })), ...workspace.teams.map(team => ({ value: `team:${team.id}`, label: team.name, group: t('Nhóm'), icon: <Users size={16} /> }))]} />
      <div className="routine-sources">
        <PanelHeading level={3} title={<FieldLabel icon={FileText}>{t('Nguồn ({0}/20)', [sources.length])}</FieldLabel>}>
          <Button type="button" variant="outline" disabled={busy} onClick={async () => {
            setBusy(true); setError('');
            try { const picked = await orglet.pickSources(); if (picked.length + sources.length > 20) throw new Error(t('Lịch có tối đa 20 nguồn. Bỏ bớt nguồn rồi chọn lại.')); setSources([...sources, ...picked]); setApproved(false); }
            catch (err) { setError((err as Error).message); } finally { setBusy(false); }
          }}><FilePlus size={15} />{t('Chọn nguồn cho lịch')}</Button>
        </PanelHeading>
        {sources.length > 0 ? <div className="attachment-list">{sources.map(source => <span className="attachment" key={source.id}><FileText size={14} /><span>{source.name}</span><button type="button" aria-label={t('Bỏ nguồn {0}', [source.name])} onClick={() => { setSources(sources.filter(item => item.id !== source.id)); setApproved(false); }}><X size={14} /></button></span>)}</div> : <p className="muted">{t('Chưa chọn nguồn. Lịch vẫn chạy được chỉ với brief.')}</p>}
        <p className="muted">{t('Chỉ dùng các tệp đã chọn với nội dung hiện tại. Tệp thay đổi hoặc bị thu hồi sẽ chặn lần chạy; chọn lại nguồn và lưu lịch để cấp quyền mới.')}</p>
      </div>
    </section>

    <section className="routine-group" aria-labelledby="routine-group-time">
      <h4 id="routine-group-time">{t('Thời gian')}</h4>
      <div className="field-grid">
        <Select label={<FieldLabel icon={Repeat} required>{t('Tần suất')}</FieldLabel>} value={frequency} onChange={value => { setFrequency(value as typeof frequency); setApproved(false); }} options={[{ value: 'daily', label: t('Hằng ngày'), icon: <Sun size={16} /> }, { value: 'weekly', label: t('Hằng tuần'), icon: <CalendarRange size={16} /> }]} />
        {frequency === 'weekly' && <Select label={<FieldLabel icon={CalendarDays} required>{t('Ngày trong tuần')}</FieldLabel>} value={String(weekday)} onChange={value => { setWeekday(Number(value)); setApproved(false); }} options={weekdays.map((day, index) => ({ value: String(index), label: day }))} />}
        <label><FieldLabel icon={Clock} required>{t('Giờ chạy')}</FieldLabel><input type="time" value={time} onChange={event => setTime(event.target.value)} required /></label>
        <label><FieldLabel icon={Globe} required>Timezone</FieldLabel><input ref={zoneInput} value={timeZone} onChange={event => { setTimeZone(event.target.value); if (zoneError) setError(''); }} required maxLength={100} placeholder="Asia/Ho_Chi_Minh" aria-invalid={zoneError || undefined} aria-describedby={zoneError ? 'routine-zone-error' : undefined} data-flash={zoneError ? 1 : undefined} /></label>
      </div>
      {zoneError && <p id="routine-zone-error" role="alert" className="error">{error}</p>}
      <p className="muted">{t('App tắt hoặc máy ngủ thì không chạy. Lịch không mất: khi mở lại, các lần lỡ gộp thành một lần chạy bù. Giờ bị bỏ qua do đổi giờ mùa hè không được chạy bù; giờ lặp chỉ chạy một lần.')}</p>
    </section>

    <section className="routine-group" aria-labelledby="routine-group-limits">
      <h4 id="routine-group-limits">{t('Giới hạn & quyền')}</h4>
      <label><FieldLabel icon={Wallet} required>{t('Giới hạn mỗi lần chạy')}</FieldLabel><MoneyInput type="number" min="0" step="any" value={budget} onChange={setBudget} required /></label>
      <Checkbox checked={enabled} onChange={event => setEnabled(event.target.checked)}>{t('Bật lịch')}</Checkbox>
      {enabled && <Checkbox ref={approvalInput} checked={approved} aria-invalid={approvalError} aria-describedby={approvalError ? 'routine-approval-error' : undefined} data-flash={approvalError ? 1 : undefined} onChange={event => { setApproved(event.target.checked); if (approvalError) setError(''); }} labelProps={{ onChange: event => event.stopPropagation() }}>{t('Cho phép tự chạy brief và {0} nguồn này với cấu hình hiện tại{1}, trong giới hạn đã đặt.', [sources.length, providers.length ? t(', gửi dữ liệu đến {0}', [providers.map(providerLabel).join(t(' và '))]) : t(' ở chế độ Demo')])}</Checkbox>}
      {approvalError && <span className="visually-hidden" id="routine-approval-error">{error}</span>}
      <p className="muted">{t('Đổi nhân viên, skill, nhóm hoặc model sẽ yêu cầu lưu lại quyền chạy. Tắt lịch không hủy task đang chạy.')}</p>
    </section>
    <div className="sticky-actions">{error ? <p className="form-error" role="alert">{error}</p> : null}<Button type="button" variant="outline" disabled={busy} onClick={back}><ArrowLeft size={16} />{t('Quay lại')}</Button><Button variant="primary" disabled={busy}>{t('Lưu lịch')}</Button></div>
  </form>;
}
