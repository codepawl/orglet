import { useState } from 'react';
import { MAX_CREW_CONCURRENT_TASKS, MAX_CREW_MEMBERS, QUIET_PARALLEL_LIMIT, type Team, type Worker, type Workspace } from '../../shared/contracts';
import { Button, FieldLabel, MoneyInput } from './ui';
import { Columns2, ListOrdered, CalendarDays, Clock, Combine, Download, FileUp, Globe, Layers, ScrollText, SlidersHorizontal, Users, Wallet, Workflow } from 'lucide-react';
import { ProviderMark } from './ProviderMark';
import { Avatar } from './Avatar';
import { TabbedFormDialog } from './DialogTabs';
import { Select } from './Select';
import { toast } from './toast';
import { toAmount, toMicros } from './money';
import { TimeZone } from '../../shared/schedule';
import { fieldInvalid } from './fieldInvalid';
import { t } from '../i18n';
import { orglet } from '../api';
import { Checkbox } from './Checkbox';
import { SwitchField } from './Switch';
import { Input, Textarea } from '@codepawl/orglet-ui';

type Tab = 'general' | 'limits';
type InvalidField = 'name' | 'members' | 'instructions' | 'limit' | 'taskBudget' | 'concurrency' | 'shiftZone' | 'shift';
const tabs = [
  { id: 'general' as const, label: 'Chung', icon: <SlidersHorizontal size={16} /> },
  { id: 'limits' as const, label: 'Giới hạn & ca', icon: <Wallet size={16} /> },
];

/**
 * The orglet a new crew starts with as its member and its lead: the first one on a real connection, since a crew of
 * the Demo orglet does nothing useful when others are connected (dogfood round 5, COD-287).
 */
function firstConnectedWorker(workers: readonly Worker[]): Worker | undefined {
  return workers.find(worker => worker.provider !== 'demo') ?? workers[0];
}

/** Team create/edit. Remount (via key) to reset the draft. */
export function TeamDialog({ open, team, workspace, onClose, onCreated }: { open: boolean; team?: Team; workspace: Workspace; onClose: () => void; /** A new crew was saved; the app opens its chat (COD-255). Not called when an existing one is saved. */ onCreated?: (teamId: string) => void }) {
  const [tab, setTab] = useState<Tab>('general');
  const [name, setName] = useState(team?.name ?? '');
  const startingWorker = firstConnectedWorker(workspace.workers);
  const [instructions, setInstructions] = useState(team?.instructions ?? t('Gộp phần việc của từng Tí thành một câu trả lời. Giữ nguyên chỗ các Tí không đồng ý với nhau và nói rõ còn thiếu bằng chứng nào.'));
  const [members, setMembers] = useState(team?.memberIds ?? (startingWorker ? [startingWorker.id] : []));
  const [synthesizer, setSynthesizer] = useState(team?.synthesizerId ?? startingWorker?.id ?? '');
  const [workflow, setWorkflow] = useState(team?.workflow ?? 'parallel');
  const [limit, setLimit] = useState(toAmount(team?.monthlyBudgetMicros ?? 5_000_000));
  const [taskBudget, setTaskBudget] = useState(toAmount(team?.taskBudgetMicros ?? 500_000));
  // A checklist and a dataset check are no longer set up here (COD-143). A team that already has them, such as one
  // made from the Eris Review template, keeps them on save and can drop them from General.
  const [reviewPolicy, setReviewPolicy] = useState(team?.reviewPolicy);
  const [preflight, setPreflight] = useState(team?.preflight);
  const [concurrency, setConcurrency] = useState(team?.maxConcurrentTasks ?? 4);
  const [shift, setShift] = useState(Boolean(team?.workHours));
  const [shiftZone, setShiftZone] = useState(team?.workHours?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [shiftStart, setShiftStart] = useState(team?.workHours?.start ?? '09:00');
  const [shiftEnd, setShiftEnd] = useState(team?.workHours?.end ?? '17:00');
  const [shiftDays, setShiftDays] = useState(team?.workHours?.days ?? [1, 2, 3, 4, 5]);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState<InvalidField>();
  const [flash, setFlash] = useState(0);
  const clearError = () => { setError(''); setInvalid(undefined); };
  /** Shows the error on the tab that owns the field and focuses that field once the tab has rendered. */
  const fail = (at: Tab, message: string, field?: InvalidField) => {
    setTab(at); setError(message); setInvalid(field); setFlash(n => n + 1);
    if (field) setTimeout(() => (document.querySelector(`#team-panel [data-field="${field}"]`) as HTMLElement | null)?.focus(), 0);
  };
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true); clearError();
    try { await work(); } catch (err) { setError((err as Error).message); setInvalid(undefined); } finally { setBusy(false); }
  };

  const submit = () => {
    if (!name.trim()) return fail('general', t('Nhập tên hội.'), 'name');
    if (!members.length || members.length > MAX_CREW_MEMBERS) return fail('general', t('Chọn từ 1 đến {0} thành viên.', [MAX_CREW_MEMBERS]), 'members');
    if (!instructions.trim()) return fail('general', t('Hướng dẫn của hội không được để trống.'), 'instructions');
    const monthlyBudgetMicros = toMicros(limit), taskBudgetMicros = toMicros(taskBudget);
    if (!Number.isFinite(monthlyBudgetMicros) || monthlyBudgetMicros < 0) return fail('limits', t('Giới hạn chi phí phải là số không âm.'), 'limit');
    if (!Number.isFinite(taskBudgetMicros) || taskBudgetMicros < 0) return fail('limits', t('Giới hạn chi phí phải là số không âm.'), 'taskBudget');
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_CREW_CONCURRENT_TASKS) return fail('limits', t('Số công việc chạy đồng thời từ 1 đến {0}.', [MAX_CREW_CONCURRENT_TASKS]), 'concurrency');
    if (shift && !TimeZone.safeParse(shiftZone).success) return fail('limits', t('Timezone của ca không hợp lệ. Dùng tên như Asia/Ho_Chi_Minh hoặc UTC.'), 'shiftZone');
    if (shift && (!shiftDays.length || shiftStart === shiftEnd)) return fail('limits', t('Chọn ít nhất một ngày làm việc và giờ bắt đầu khác giờ kết thúc.'), 'shift');
    void run(async () => {
      const saved = await orglet.call('saveTeam', { ...(team ? { id: team.id } : {}), name, instructions, ...(reviewPolicy ? { reviewPolicy } : {}), memberIds: members, synthesizerId: synthesizer, workflow, monthlyBudgetMicros, taskBudgetMicros, maxConcurrentTasks: concurrency, ...(shift ? { workHours: { timeZone: shiftZone, start: shiftStart, end: shiftEnd, days: shiftDays } } : {}), ...(preflight ? { preflight } : {}) });
      toast(team ? t('Đã lưu hội') : t('Đã tạo hội'), 'success', name);
      if (!team) onCreated?.(saved.id);
      onClose();
    });
  };

  const actions = tab === 'general' && team
      ? <Button type="button" variant="outline" disabled={busy} onClick={() => void run(async () => { if (await orglet.exportTemplate(team.id)) toast(t('Đã xuất template'), 'success', team.name); })}><Download size={16} />{t('Xuất template đã lưu')}</Button>
      : tab === 'general'
        ? <Button type="button" variant="outline" disabled={busy} onClick={() => void run(async () => { if (await orglet.importTemplate()) onClose(); })}><FileUp size={16} />{t('Nhập template')}</Button>
        : undefined;

  return <TabbedFormDialog open={open} onClose={onClose} title={team ? t('Thiết lập hội') : t('Hội mới')} tabs={tabs} tab={tab} onTab={next => { setTab(next); clearError(); }} panelId="team-panel" onSubmit={submit} submitLabel={t('Lưu hội')} busy={busy} actions={actions} error={error}>
    {tab === 'general' && <>
      <label><FieldLabel icon={Users} required>{t('Tên hội')}</FieldLabel><Input data-field="name" value={name} onChange={e => { setName(e.target.value); if (invalid === 'name') clearError(); }} maxLength={80} invalid={invalid === 'name'} flash={flash} /></label>
      <fieldset><legend><FieldLabel icon={Users} required>{t('Thành viên (1–{0})', [MAX_CREW_MEMBERS])}</FieldLabel></legend><div className="fieldset-options">{workspace.workers.map(worker => <Checkbox key={worker.id} aria-label={worker.name} data-field={invalid === 'members' ? 'members' : undefined} checked={members.includes(worker.id)} disabled={!members.includes(worker.id) && members.length >= MAX_CREW_MEMBERS} onChange={e => { setMembers(current => e.target.checked ? [...current, worker.id] : current.filter(id => id !== worker.id)); if (invalid === 'members') clearError(); }} {...fieldInvalid(invalid === 'members', flash)}><span className="inline-mark"><Avatar name={worker.name} seed={worker.id} emoji={worker.avatar?.emoji} mascot={worker.avatar?.mascot} defaultMascot hint={worker.description} color={worker.avatar?.color} size="xs" badge={worker.provider === 'demo' ? undefined : <ProviderMark provider={worker.provider} size="small" decorative />} />{worker.name}</span></Checkbox>)}{!workspace.workers.length && <p className="muted">{t('Chưa có Tí nào. Tạo một Tí trước.')}</p>}</div></fieldset>
      {members.length > QUIET_PARALLEL_LIMIT && <p className="muted">{t('Mỗi thành viên là một lượt gọi model, nên hội đông hơn thì mỗi lượt tốn hơn.')}</p>}
      <Select label={<FieldLabel icon={Combine} required>{t('Tí trưởng')}</FieldLabel>} value={synthesizer} onChange={setSynthesizer} options={workspace.workers.map(worker => ({ value: worker.id, label: worker.name, icon: <Avatar name={worker.name} seed={worker.id} emoji={worker.avatar?.emoji} mascot={worker.avatar?.mascot} defaultMascot hint={worker.description} color={worker.avatar?.color} size="xs" badge={worker.provider === 'demo' ? undefined : <ProviderMark provider={worker.provider} size="small" decorative />} /> }))} />
      <Select label={<FieldLabel icon={Workflow} required>{t('Quy trình')}</FieldLabel>} value={workflow} onChange={value => setWorkflow(value as typeof workflow)} options={[{ value: 'parallel', label: t('Song song, rồi tổng hợp'), icon: <Columns2 size={16} /> }, { value: 'sequential', label: t('Tuần tự, rồi tổng hợp'), icon: <ListOrdered size={16} /> }]} />
      <p className="muted">{t('Tuần tự theo thứ tự chọn thành viên; song song tối đa hai người cùng lúc.')}</p>
      <label><FieldLabel icon={ScrollText} required>{t('Hướng dẫn của hội')}</FieldLabel><Textarea data-field="instructions" rows={8} value={instructions} onChange={e => { setInstructions(e.target.value); if (invalid === 'instructions') clearError(); }} maxLength={16000} invalid={invalid === 'instructions'} flash={flash} /></label>
      {(reviewPolicy || preflight) && <div className="review-setup-list">
        {reviewPolicy && <p className="muted review-setup"><span>{t('Báo cáo của hội phải trả lời {0} mục kiểm tra.', [reviewPolicy.requiredChecks.length])}</span><Button type="button" variant="ghost" disabled={busy} onClick={() => setReviewPolicy(undefined)}>{t('Bỏ checklist')}</Button></p>}
        {preflight && <p className="muted review-setup"><span>{t('Tệp CSV/JSON được kiểm tra trên máy trước khi hội review.')}</span><Button type="button" variant="ghost" disabled={busy} onClick={() => setPreflight(undefined)}>{t('Tắt kiểm tra dataset')}</Button></p>}
      </div>}
      {team && <p className="muted">{t('Template gồm hội, Tí và skill đã lưu; không có API key.')}</p>}
    </>}
    {tab === 'limits' && <>
      <label><FieldLabel icon={Wallet} required>{t('Giới hạn hội / tháng')}</FieldLabel><MoneyInput data-field="limit" type="number" min="0" step="any" value={limit} onChange={value => { setLimit(value); if (invalid === 'limit') clearError(); }} invalid={invalid === 'limit'} flash={flash} /></label>
      <label><FieldLabel icon={Wallet} required>{t('Giới hạn mỗi task')}</FieldLabel><MoneyInput data-field="taskBudget" type="number" min="0" step="any" value={taskBudget} onChange={value => { setTaskBudget(value); if (invalid === 'taskBudget') clearError(); }} invalid={invalid === 'taskBudget'} flash={flash} /></label>
      <label><FieldLabel icon={Layers} required>{t('Số công việc chạy đồng thời')}</FieldLabel><Input data-field="concurrency" type="number" min="1" max={MAX_CREW_CONCURRENT_TASKS} step="1" value={concurrency} onChange={event => { setConcurrency(Number(event.target.value)); if (invalid === 'concurrency') clearError(); }} invalid={invalid === 'concurrency'} flash={flash} /></label>
      {concurrency > QUIET_PARALLEL_LIMIT && <p className="muted">{t('Chạy nhiều cùng lúc thì chi phí cũng dồn về cùng lúc.')}</p>}
      <SwitchField checked={shift} onChange={setShift}>{t('Giới hạn khung giờ làm việc')}</SwitchField>
      {shift && <>
        <label><FieldLabel icon={Globe} required>{t('Timezone của ca')}</FieldLabel><Input data-field="shiftZone" value={shiftZone} onChange={event => { setShiftZone(event.target.value); if (invalid === 'shiftZone') clearError(); }} maxLength={100} invalid={invalid === 'shiftZone'} flash={flash} /></label>
        <label><FieldLabel icon={Clock} required>{t('Bắt đầu ca')}</FieldLabel><Input data-field="shift" type="time" value={shiftStart} onChange={event => { setShiftStart(event.target.value); if (invalid === 'shift') clearError(); }} invalid={invalid === 'shift'} flash={flash} /></label>
        <label><FieldLabel icon={Clock} required>{t('Kết thúc ca')}</FieldLabel><Input type="time" value={shiftEnd} onChange={event => { setShiftEnd(event.target.value); if (invalid === 'shift') clearError(); }} invalid={invalid === 'shift'} flash={flash} /></label>
        <fieldset><legend><FieldLabel icon={CalendarDays} required>{t('Ngày bắt đầu ca')}</FieldLabel></legend><div className="fieldset-options">{[t('Chủ nhật'), t('Thứ hai'), t('Thứ ba'), t('Thứ tư'), t('Thứ năm'), t('Thứ sáu'), t('Thứ bảy')].map((day, index) => <Checkbox key={day} checked={shiftDays.includes(index)} onChange={event => { setShiftDays(current => event.target.checked ? [...current, index] : current.filter(value => value !== index)); if (invalid === 'shift') clearError(); }} {...fieldInvalid(invalid === 'shift', flash)}>{day}</Checkbox>)}</div></fieldset>
        <p className="muted">{t('Hết ca thì Orglet xong bước đang chạy rồi tạm dừng đến ca sau. Giờ kết thúc sớm hơn giờ bắt đầu nghĩa là ca qua đêm.')}</p>
      </>}
    </>}
  </TabbedFormDialog>;
}
