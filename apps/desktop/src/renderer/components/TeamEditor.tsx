import { useState } from 'react';
import type { Team, Workspace } from '../../shared/contracts';
import { Button, FieldLabel, MoneyInput } from './ui';
import { Activity, Columns2, FileText, GitCompare, ListOrdered, CalendarDays, Clock, Combine, Database, Download, FileUp, Globe, Plus, KeyRound, Layers, ListChecks, ScrollText, ShieldCheck, SlidersHorizontal, Type, Users, Wallet, Workflow } from 'lucide-react';
import { ProviderMark } from './ProviderMark';
import { Avatar } from './Avatar';
import { TabbedFormDialog } from './DialogTabs';
import { Select } from './Select';
import { toast } from './toast';
import { toAmount, toMicros } from './money';
import templates from '../../../../../templates/catalog.json';
import { TimeZone } from '../../shared/schedule';
import { ReviewPolicy } from '../../shared/review';
import { fieldInvalid } from './fieldInvalid';
import { t } from '../i18n';
import { orglet } from '../api';
import { Checkbox } from './Checkbox';

type Tab = 'general' | 'instructions' | 'checklist' | 'dataset' | 'limits';
type InvalidField = 'name' | 'members' | 'instructions' | 'checks' | 'limit' | 'taskBudget' | 'concurrency' | 'shiftZone' | 'shift';
const tabs = [
  { id: 'general' as const, label: 'Chung', icon: <SlidersHorizontal size={16} /> },
  { id: 'instructions' as const, label: 'Hướng dẫn', icon: <ScrollText size={16} /> },
  { id: 'checklist' as const, label: 'Checklist', icon: <ListChecks size={16} /> },
  { id: 'dataset' as const, label: 'Dataset', icon: <Database size={16} /> },
  { id: 'limits' as const, label: 'Giới hạn & ca', icon: <Wallet size={16} /> },
];

/** Team create/edit. Remount (via key) to reset the draft. */
export function TeamDialog({ open, team, workspace, onClose }: { open: boolean; team?: Team; workspace: Workspace; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('general');
  const [name, setName] = useState(team?.name ?? '');
  const [instructions, setInstructions] = useState(team?.instructions ?? 'Combine evidence from each role into one review. Preserve disagreements and explicitly identify missing evidence.');
  const [members, setMembers] = useState(team?.memberIds ?? (workspace.workers[0] ? [workspace.workers[0].id] : []));
  const [synthesizer, setSynthesizer] = useState(team?.synthesizerId ?? workspace.workers[0]?.id ?? '');
  const [workflow, setWorkflow] = useState(team?.workflow ?? 'parallel');
  const [limit, setLimit] = useState(toAmount(team?.monthlyBudgetMicros ?? 5_000_000));
  const [taskBudget, setTaskBudget] = useState(toAmount(team?.taskBudgetMicros ?? 500_000));
  const [preflight, setPreflight] = useState(Boolean(team?.preflight));
  const [idColumn, setIdColumn] = useState(team?.preflight?.idColumn ?? '');
  const [compareTwo, setCompareTwo] = useState(team?.preflight?.compareTwo ?? true);
  const [requiredChecks, setRequiredChecks] = useState<ReviewPolicy['requiredChecks']>(team?.reviewPolicy?.requiredChecks ?? []);
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
    if (!name.trim()) return fail('general', t('Nhập tên nhóm.'), 'name');
    if (!members.length || members.length > 4) return fail('general', t('Chọn từ 1 đến 4 thành viên.'), 'members');
    if (!instructions.trim()) return fail('instructions', t('Hướng dẫn của nhóm không được để trống.'), 'instructions');
    if (requiredChecks.length && !ReviewPolicy.safeParse({ requiredChecks }).success) return fail('checklist', t('Mỗi mục kiểm tra cần tên riêng, tối đa 200 ký tự; không để trống hoặc trùng tên.'), 'checks');
    const monthlyBudgetMicros = toMicros(limit), taskBudgetMicros = toMicros(taskBudget);
    if (!Number.isFinite(monthlyBudgetMicros) || monthlyBudgetMicros < 0) return fail('limits', t('Giới hạn chi phí phải là số không âm.'), 'limit');
    if (!Number.isFinite(taskBudgetMicros) || taskBudgetMicros < 0) return fail('limits', t('Giới hạn chi phí phải là số không âm.'), 'taskBudget');
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) return fail('limits', t('Số công việc chạy đồng thời từ 1 đến 4.'), 'concurrency');
    if (shift && !TimeZone.safeParse(shiftZone).success) return fail('limits', t('Timezone của ca không hợp lệ. Dùng tên như Asia/Ho_Chi_Minh hoặc UTC.'), 'shiftZone');
    if (shift && (!shiftDays.length || shiftStart === shiftEnd)) return fail('limits', t('Chọn ít nhất một ngày làm việc và giờ bắt đầu khác giờ kết thúc.'), 'shift');
    void run(async () => {
      await orglet.call('saveTeam', { ...(team ? { id: team.id } : {}), name, instructions, ...(requiredChecks.length ? { reviewPolicy: { requiredChecks } } : {}), memberIds: members, synthesizerId: synthesizer, workflow, monthlyBudgetMicros, taskBudgetMicros, maxConcurrentTasks: concurrency, ...(shift ? { workHours: { timeZone: shiftZone, start: shiftStart, end: shiftEnd, days: shiftDays } } : {}), ...(preflight ? { preflight: { idColumn: idColumn.trim() || null, compareTwo } } : {}) });
      toast(team ? t('Đã lưu nhóm.') : t('Đã tạo nhóm.')); onClose();
    });
  };

  const actions = tab === 'checklist'
    ? <Button type="button" variant="outline" disabled={busy || requiredChecks.length >= 20} onClick={() => { setRequiredChecks(current => [...current, { name: '', checker: 'none' }]); setTimeout(() => (document.querySelector('#team-panel fieldset:last-of-type input') as HTMLElement | null)?.focus(), 0); }}><Plus size={16} />{t('Thêm mục kiểm tra')}</Button>
    : tab === 'general' && team
      ? <Button type="button" variant="outline" disabled={busy} onClick={() => void run(async () => { if (await orglet.exportTemplate(team.id)) toast(t('Đã xuất template.')); })}><Download size={16} />{t('Xuất template đã lưu')}</Button>
      : tab === 'general'
        ? <Button type="button" variant="outline" disabled={busy} onClick={() => void run(async () => { if (await orglet.importTemplate()) onClose(); })}><FileUp size={16} />{t('Nhập template từ tệp')}</Button>
        : undefined;

  return <TabbedFormDialog open={open} onClose={onClose} title={team ? t('Thiết lập nhóm') : t('Nhóm mới')} tabs={tabs} tab={tab} onTab={next => { setTab(next); clearError(); }} panelId="team-panel" onSubmit={submit} submitLabel={t('Lưu nhóm')} busy={busy} actions={actions} error={error} description={tab === 'checklist' ? t('Báo cáo tổng hợp phải đề cập các mục này. Mục thiếu bằng chứng được giữ là chưa đánh giá. Thay đổi chỉ áp dụng cho lần chạy mới.') : undefined}>
    {tab === 'general' && <>
      {!team && <section><h3>{t('Bắt đầu từ template')}</h3>
        <div className="template-choices">{templates.map(template => <Button type="button" key={template.id} variant="outline" disabled={busy} onClick={() => void run(async () => { await orglet.call('createTemplate', { templateId: template.id as 'research-review' | 'eris-review', provider: 'demo' }); onClose(); })}>{template.name}</Button>)}</div>
        <p className="muted">{t('Template tạo nhân viên ở chế độ Demo. Chọn model cho từng nhân viên khi sẵn sàng.')}</p>
      </section>}
      <label><FieldLabel icon={Users} required>{t('Tên nhóm')}</FieldLabel><input data-field="name" value={name} onChange={e => { setName(e.target.value); if (invalid === 'name') clearError(); }} maxLength={80} {...fieldInvalid(invalid === 'name', flash)} /></label>
      <fieldset><legend><FieldLabel icon={Users} required>{t('Thành viên (1–4)')}</FieldLabel></legend>{workspace.workers.map(worker => <Checkbox key={worker.id} aria-label={worker.name} data-field={invalid === 'members' ? 'members' : undefined} checked={members.includes(worker.id)} onChange={e => { setMembers(current => e.target.checked ? [...current, worker.id] : current.filter(id => id !== worker.id)); if (invalid === 'members') clearError(); }} {...fieldInvalid(invalid === 'members', flash)}><span className="inline-mark"><Avatar name={worker.name} seed={worker.id} emoji={worker.avatar?.emoji} mascot={worker.avatar?.mascot} defaultMascot hint={worker.description} color={worker.avatar?.color} size="xs" badge={worker.provider === 'demo' ? undefined : <ProviderMark provider={worker.provider} size="small" decorative />} />{worker.name}</span></Checkbox>)}{!workspace.workers.length && <p className="muted">{t('Chưa có nhân viên. Tạo nhân viên trước hoặc bắt đầu từ template.')}</p>}</fieldset>
      <Select label={<FieldLabel icon={Combine} required>{t('Nhân viên tổng hợp')}</FieldLabel>} value={synthesizer} onChange={setSynthesizer} options={workspace.workers.map(worker => ({ value: worker.id, label: worker.name, icon: <Avatar name={worker.name} seed={worker.id} emoji={worker.avatar?.emoji} mascot={worker.avatar?.mascot} defaultMascot hint={worker.description} color={worker.avatar?.color} size="xs" badge={worker.provider === 'demo' ? undefined : <ProviderMark provider={worker.provider} size="small" decorative />} /> }))} />
      <Select label={<FieldLabel icon={Workflow} required>{t('Quy trình')}</FieldLabel>} value={workflow} onChange={value => setWorkflow(value as typeof workflow)} options={[{ value: 'parallel', label: t('Song song, rồi tổng hợp'), icon: <Columns2 size={16} /> }, { value: 'sequential', label: t('Tuần tự, rồi tổng hợp'), icon: <ListOrdered size={16} /> }]} />
      <p className="muted">{t('Tuần tự theo thứ tự chọn thành viên. Song song chạy tối đa hai role cùng lúc. Thử lại giữ các kết quả role đã hoàn tất.')}</p>
      {team && <p className="muted">{t('Template xuất ra gồm cấu hình nhóm, nhân viên và skill đã lưu. Không chứa API key, nguồn hay lịch sử công việc.')}</p>}
    </>}
    {tab === 'instructions' && <textarea data-field="instructions" aria-label={t('Hướng dẫn của nhóm')} aria-required="true" rows={12} value={instructions} onChange={e => { setInstructions(e.target.value); if (invalid === 'instructions') clearError(); }} maxLength={16000} {...fieldInvalid(invalid === 'instructions', flash)} />}
    {tab === 'checklist' && <>
      {requiredChecks.map((check, index) => <fieldset key={index}><legend>{t('Mục {0}', [index + 1])}</legend>
        <div className="form">
          <label><FieldLabel icon={Type} required>{t('Tên mục')}</FieldLabel><input data-field={index === 0 ? 'checks' : undefined} aria-label={t('Tên mục {0}', [index + 1])} value={check.name} maxLength={200} onChange={event => { setRequiredChecks(current => current.map((item, position) => position === index ? { ...item, name: event.target.value } : item)); if (invalid === 'checks') clearError(); }} {...fieldInvalid(invalid === 'checks', flash)} /></label>
          <Select label={<><FieldLabel icon={ShieldCheck} required>{t('Bằng chứng')}</FieldLabel><span className="visually-hidden"> {t('cho mục {0}', [index + 1])}</span></>} value={check.checker} onChange={value => setRequiredChecks(current => current.map((item, position) => position === index ? { ...item, checker: value as ReviewPolicy['requiredChecks'][number]['checker'] } : item))} options={[{ value: 'none', label: t('Nguồn đã đọc'), icon: <FileText size={16} /> }, { value: 'run_audit', label: t('Kiểm tra run-log'), detail: t('Cần kết quả trước khi PASS'), icon: <Activity size={16} /> }, { value: 'pair_alignment', label: t('Đối chiếu hai dataset'), detail: t('Cột, số dòng, tập ID trước khi PASS'), icon: <GitCompare size={16} /> }]} />
          <Button type="button" disabled={busy} aria-label={t('Bỏ mục {0}', [index + 1])} onClick={() => setRequiredChecks(current => current.filter((_, position) => position !== index))}>{t('Bỏ mục')}</Button>
        </div>
      </fieldset>)}
      {!requiredChecks.length && <p className="empty-history">{t('Chưa đặt checklist bắt buộc cho nhóm này.')}</p>}
    </>}
    {tab === 'dataset' && <>
      <Checkbox checked={preflight} onChange={event => setPreflight(event.target.checked)}>{t('Kiểm tra dataset trước khi review')}</Checkbox>
      <p className="muted">{t('Chạy checker local cho các CSV, JSONL và Parquet đã chọn trước mọi role, kể cả Demo. Lưu phạm vi và lỗi kiểm tra vào báo cáo; không chạy code challenge.')}</p>
      {preflight && <>
        <label><FieldLabel icon={KeyRound}>{t('Cột ID cho preflight (không bắt buộc)')}</FieldLabel><input value={idColumn} onChange={event => setIdColumn(event.target.value)} maxLength={256} placeholder={t('Ví dụ: id')} /></label>
        <Checkbox checked={compareTwo} onChange={event => setCompareTwo(event.target.checked)}>{t('Đối chiếu schema và ID khi task có đúng hai dataset')}</Checkbox>
        <p className="muted">{t('Đối chiếu không tự xác định quan hệ train/test hay submission/answers. Chọn đúng hai nguồn cần so sánh; để trống cột ID nếu chưa biết contract.')}</p>
      </>}
    </>}
    {tab === 'limits' && <>
      <label><FieldLabel icon={Wallet} required>{t('Giới hạn nhóm / tháng')}</FieldLabel><MoneyInput data-field="limit" type="number" min="0" step="any" value={limit} onChange={value => { setLimit(value); if (invalid === 'limit') clearError(); }} invalid={invalid === 'limit'} flash={flash} /></label>
      <label><FieldLabel icon={Wallet} required>{t('Giới hạn mỗi task')}</FieldLabel><MoneyInput data-field="taskBudget" type="number" min="0" step="any" value={taskBudget} onChange={value => { setTaskBudget(value); if (invalid === 'taskBudget') clearError(); }} invalid={invalid === 'taskBudget'} flash={flash} /></label>
      <label><FieldLabel icon={Layers} required>{t('Số công việc chạy đồng thời')}</FieldLabel><input data-field="concurrency" type="number" min="1" max="4" step="1" value={concurrency} onChange={event => { setConcurrency(Number(event.target.value)); if (invalid === 'concurrency') clearError(); }} {...fieldInvalid(invalid === 'concurrency', flash)} /></label>
      <Checkbox checked={shift} onChange={event => setShift(event.target.checked)}>{t('Giới hạn khung giờ làm việc')}</Checkbox>
      {shift && <>
        <label><FieldLabel icon={Globe} required>{t('Timezone của ca')}</FieldLabel><input data-field="shiftZone" value={shiftZone} onChange={event => { setShiftZone(event.target.value); if (invalid === 'shiftZone') clearError(); }} maxLength={100} {...fieldInvalid(invalid === 'shiftZone', flash)} /></label>
        <label><FieldLabel icon={Clock} required>{t('Bắt đầu ca')}</FieldLabel><input data-field="shift" type="time" value={shiftStart} onChange={event => { setShiftStart(event.target.value); if (invalid === 'shift') clearError(); }} {...fieldInvalid(invalid === 'shift', flash)} /></label>
        <label><FieldLabel icon={Clock} required>{t('Kết thúc ca')}</FieldLabel><input type="time" value={shiftEnd} onChange={event => { setShiftEnd(event.target.value); if (invalid === 'shift') clearError(); }} {...fieldInvalid(invalid === 'shift', flash)} /></label>
        <fieldset><legend><FieldLabel icon={CalendarDays} required>{t('Ngày bắt đầu ca')}</FieldLabel></legend>{[t('Chủ nhật'), t('Thứ hai'), t('Thứ ba'), t('Thứ tư'), t('Thứ năm'), t('Thứ sáu'), t('Thứ bảy')].map((day, index) => <Checkbox key={day} checked={shiftDays.includes(index)} onChange={event => { setShiftDays(current => event.target.checked ? [...current, index] : current.filter(value => value !== index)); if (invalid === 'shift') clearError(); }} {...fieldInvalid(invalid === 'shift', flash)}>{day}</Checkbox>)}</fieldset>
        <p className="muted">{t('Hết ca, Orglet hoàn tất bước đang chạy rồi tạm dừng và lưu bàn giao. Tiếp tục trong ca sau bằng nút checkpoint. Nếu giờ kết thúc sớm hơn giờ bắt đầu, ca kéo qua ngày kế tiếp.')}</p>
      </>}
    </>}
  </TabbedFormDialog>;
}
