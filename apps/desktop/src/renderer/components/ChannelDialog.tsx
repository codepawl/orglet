import { useState, type ReactNode } from 'react';
import { CalendarDays, Clock, Columns2, Combine, Download, FileUp, FolderTree, Globe, Hash, Layers, ListOrdered, MessageSquareQuote, MessagesSquare, ScrollText, SlidersHorizontal, UserRound, UsersRound, Wallet, Workflow } from 'lucide-react';
import { Input, Textarea } from '@codepawl/orglet-ui';
import { MAX_CREW_CONCURRENT_TASKS, MAX_CREW_MEMBERS, QUIET_PARALLEL_LIMIT, type ChannelLeadSettings, type Team, type Worker, type Workspace } from '../../shared/contracts';
import { CHANNEL_CATEGORY_LIMIT, CHANNEL_NAME_LIMIT, CHANNEL_TOPIC_LIMIT, MAX_CHANNEL_MEMBERS, type ChannelMember, type ChannelMode } from '../../shared/channels';
import { TimeZone } from '../../shared/schedule';
import { Button, FieldLabel, MoneyInput } from './ui';
import { Avatar } from './Avatar';
import { ProviderMark } from './ProviderMark';
import { Checkbox } from './Checkbox';
import { Select } from './Select';
import { SwitchField } from './Switch';
import { TabbedFormDialog } from './DialogTabs';
import { fieldInvalid } from './fieldInvalid';
import { toAmount, toMicros } from './money';
import { toast } from './toast';
import { categoryNames } from '../areas';
import { t } from '../i18n';
import { orglet } from '../api';

type Tab = 'general' | 'members' | 'how' | 'limits';
type InvalidField = 'name' | 'members' | 'instructions' | 'limit' | 'taskBudget' | 'concurrency' | 'shiftZone' | 'shift';

const generalTab = { id: 'general' as const, label: 'Chung', icon: <SlidersHorizontal size={16} /> };
const membersTab = { id: 'members' as const, label: 'Thành viên', icon: <UsersRound size={16} /> };
const howTab = { id: 'how' as const, label: 'Cách làm việc', icon: <Workflow size={16} /> };
const limitsTab = { id: 'limits' as const, label: 'Giới hạn & ca', icon: <Wallet size={16} /> };

/**
 * The channel being edited, or the members a new one starts with (orglets picked in the sidebar). `crewId` names the
 * crew record that holds how the lead splits the work (COD-369). `initialTab` opens the members straight away, as the
 * header's faces do.
 */
export type ChannelDraft = { id: string; name: string; topic?: string; category?: string; members: ChannelMember[]; crewId?: string; initialTab?: 'members' } | { id?: undefined; members?: ChannelMember[]; category?: string; initialTab?: undefined };

/** A new channel's lead while the person has not picked one: kept while it is still a member, else the first member. */
export function nextLead(current: string, members: readonly string[]): string {
  if (members.includes(current)) return current;
  return members[0] ?? '';
}

/**
 * Creating or editing a channel (COD-361, COD-369): its name and topic, its orglets, and how it works. Orglets take
 * turns, or the lead splits the work, the way a crew did: then the lead, the workflow, the lead's instructions, the
 * budget and the work hours are the channel's too. A new channel opens empty; its first message is what makes its
 * chat. Saving an existing one takes effect from the next message. Remount (via key) to reset the draft.
 */
export function ChannelDialog({ open, draft, workspace, onClose, onCreated }: { open: boolean; draft: ChannelDraft; workspace: Workspace; onClose: () => void; onCreated: (channelId: string) => void }) {
  const editing = draft.id !== undefined;
  const crew = editing && draft.crewId ? workspace.teams.find(team => team.id === draft.crewId) : undefined;
  const [tab, setTab] = useState<Tab>(draft.initialTab ?? 'general');
  const [name, setName] = useState(editing ? draft.name : '');
  const [topic, setTopic] = useState(editing ? draft.topic ?? '' : '');
  // The category the channel is listed under in the Channels area (COD-366); a new channel made from a category's + starts in it.
  const [category, setCategory] = useState(draft.category ?? '');
  const knownCategories = categoryNames([...workspace.tasks.map(task => task.channel?.category), ...workspace.emptyChannels.map(channel => channel.category)]);
  // Members are orglets; a crew picked before crews became channels joins as its orglets, and one that left the
  // workspace is not offered again, so saving drops it.
  const [orgletIds, setOrgletIds] = useState<string[]>(() => startingOrglets(draft.members ?? [], workspace));
  const [mode, setMode] = useState<ChannelMode>(crew ? 'lead' : 'turns');
  const lead = useLeadSettings(crew, orgletIds);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState<InvalidField>();
  const [flash, setFlash] = useState(0);
  const clearError = () => { setError(''); setInvalid(undefined); };
  const fail = (at: Tab, message: string, field: InvalidField) => {
    setTab(at); setError(message); setInvalid(field); setFlash(count => count + 1);
    setTimeout(() => document.querySelector<HTMLElement>(`#channel-panel [data-field="${field}"]`)?.focus(), 0);
  };
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true); clearError();
    try { await work(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  const changeMembers = (next: string[]) => {
    setOrgletIds(next);
    lead.followMembers(next);
    if (invalid === 'members') clearError();
  };

  const submit = () => {
    const trimmed = name.trim().replace(/^#+\s*/, '');
    if (!trimmed) return fail('general', t('Đặt tên cho kênh.'), 'name');
    if (!orgletIds.length) return fail('members', t('Chọn ít nhất một Tí.'), 'members');
    const leadSettings = mode === 'lead' ? lead.validate(orgletIds, fail) : undefined;
    if (mode === 'lead' && !leadSettings) return;
    const fields = { name: trimmed, topic: topic.trim(), category: category.trim(), members: orgletIds.map(id => ({ kind: 'orglet' as const, id })), mode, ...(leadSettings ? { lead: leadSettings } : {}) };
    void run(async () => {
      if (editing) {
        await orglet.call('updateChannel', { id: draft.id, ...fields });
        toast(t('Đã lưu kênh'), 'success', `#${trimmed}`);
      } else {
        const channelId = await orglet.call('createChannel', fields);
        toast(t('Đã tạo kênh'), 'success', `#${trimmed}`);
        onCreated(channelId);
      }
      onClose();
    });
  };

  const tabs = mode === 'lead' ? [generalTab, membersTab, howTab, limitsTab] : [generalTab, membersTab, howTab];
  const actions = tab === 'general' && crew
    ? <Button type="button" variant="outline" disabled={busy} onClick={() => void run(async () => { if (await orglet.exportTemplate(crew.id)) toast(t('Đã xuất template'), 'success', `#${name}`); })}><Download size={16} />{t('Xuất template')}</Button>
    : tab === 'general' && !editing
      ? <Button type="button" variant="outline" disabled={busy} onClick={() => void run(async () => { if (await orglet.importTemplate()) onClose(); })}><FileUp size={16} />{t('Nhập template')}</Button>
      : undefined;

  return <TabbedFormDialog open={open} onClose={onClose} title={editing ? t('Thiết lập kênh') : t('Kênh mới')} tabs={tabs} tab={tab} onTab={next => { setTab(next); clearError(); }}
    panelId="channel-panel" onSubmit={submit} submitLabel={editing ? t('Lưu kênh') : t('Tạo kênh')} busy={busy} error={error} actions={actions}>
    {tab === 'general' && <>
      <label><FieldLabel icon={Hash} required>{t('Tên kênh')}</FieldLabel>
        <Input data-field="name" value={name} onChange={event => { setName(event.target.value); if (invalid === 'name') clearError(); }} maxLength={CHANNEL_NAME_LIMIT + 1} placeholder={t('ví dụ: ra-mắt')} invalid={invalid === 'name'} flash={flash} /></label>
      <label><FieldLabel icon={MessageSquareQuote}>{t('Chủ đề')}</FieldLabel>
        <Input value={topic} onChange={event => setTopic(event.target.value)} maxLength={CHANNEL_TOPIC_LIMIT} placeholder={t('Kênh này để làm gì')} /></label>
      <label><FieldLabel icon={FolderTree}>{t('Nhóm')}</FieldLabel>
        <Input value={category} onChange={event => setCategory(event.target.value)} maxLength={CHANNEL_CATEGORY_LIMIT} list="channel-categories" placeholder={t('Không nhóm')} />
        <datalist id="channel-categories">{knownCategories.map(name => <option key={name} value={name} />)}</datalist></label>
      {editing && !crew && <p className="muted">{t('Template lưu cách Tí trưởng chia việc. Chọn cách đó trong Cách làm việc để xuất template.')}</p>}
      {crew && <p className="muted">{t('Template gồm kênh, Tí và skill đã lưu; không có API key.')}</p>}
    </>}
    {tab === 'members' && <>
      <fieldset><legend><FieldLabel icon={UserRound} required>{t('Tí trong kênh')}</FieldLabel></legend><div className="fieldset-options">
        {workspace.workers.map(worker => <Checkbox key={worker.id} aria-label={worker.name} data-field={invalid === 'members' ? 'members' : undefined} checked={orgletIds.includes(worker.id)}
          disabled={!orgletIds.includes(worker.id) && orgletIds.length >= MAX_CHANNEL_MEMBERS} onChange={event => changeMembers(event.target.checked ? [...orgletIds, worker.id] : orgletIds.filter(id => id !== worker.id))} {...fieldInvalid(invalid === 'members', flash)}>
          <span className="inline-mark">{orgletFace(worker)}{worker.name}</span>
        </Checkbox>)}
        {!workspace.workers.length && <p className="muted">{t('Chưa có Tí nào. Tạo một Tí trước.')}</p>}
      </div></fieldset>
      {mode === 'lead' && orgletIds.length > QUIET_PARALLEL_LIMIT && <p className="muted">{t('Mỗi Tí là một lượt gọi model, nên kênh đông hơn thì mỗi tin nhắn tốn hơn.')}</p>}
    </>}
    {tab === 'how' && <>
      <Select label={<FieldLabel icon={Workflow} required>{t('Cách làm việc')}</FieldLabel>} value={mode} onChange={value => setMode(value as ChannelMode)} menuMinWidth={320}
        options={[
          { value: 'turns', label: t('Lần lượt trả lời'), detail: t('Mỗi Tí trả lời rồi đến Tí tiếp theo'), icon: <MessagesSquare size={16} /> },
          { value: 'lead', label: t('Tí trưởng chia việc'), detail: t('Tí trưởng lên kế hoạch, giao việc rồi gộp kết quả'), icon: <Combine size={16} /> },
        ]} />
      {mode === 'turns' && <p className="muted">{t('Mỗi Tí trong kênh trả lời lần lượt và đọc được các câu trả lời trước. Gắn @tên để hỏi riêng một Tí.')}</p>}
      {mode === 'lead' && lead.howFields(workspace.workers.filter(worker => orgletIds.includes(worker.id)), { busy, invalid, flash, clearError })}
    </>}
    {tab === 'limits' && mode === 'lead' && lead.limitFields({ invalid, flash, clearError })}
  </TabbedFormDialog>;
}

type FieldState = { invalid: InvalidField | undefined; flash: number; clearError: () => void };
type Fail = (at: Tab, message: string, field: InvalidField) => void;

/**
 * What a channel where the lead splits the work sets (COD-369): the crew editor's fields, read from the crew record
 * behind the channel or a new crew's defaults, with the fields and the checks that go with them.
 */
function useLeadSettings(crew: Team | undefined, orgletIds: readonly string[]) {
  const [synthesizer, setSynthesizer] = useState(crew?.synthesizerId ?? orgletIds[0] ?? '');
  // A lead the person did not pick follows the members, so unticking it never leaves a lead outside the channel.
  const [leadPicked, setLeadPicked] = useState(Boolean(crew));
  const [workflow, setWorkflow] = useState<Team['workflow']>(crew?.workflow ?? 'parallel');
  const [instructions, setInstructions] = useState(crew?.instructions ?? t('Gộp phần việc của từng Tí thành một câu trả lời. Giữ nguyên chỗ các Tí không đồng ý với nhau và nói rõ còn thiếu bằng chứng nào.'));
  const [reviewPolicy, setReviewPolicy] = useState(crew?.reviewPolicy);
  const [preflight, setPreflight] = useState(crew?.preflight);
  const [limit, setLimit] = useState(toAmount(crew?.monthlyBudgetMicros ?? 5_000_000));
  const [taskBudget, setTaskBudget] = useState(toAmount(crew?.taskBudgetMicros ?? 500_000));
  const [concurrency, setConcurrency] = useState(crew?.maxConcurrentTasks ?? 4);
  const [shift, setShift] = useState(Boolean(crew?.workHours));
  const [shiftZone, setShiftZone] = useState(crew?.workHours?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [shiftStart, setShiftStart] = useState(crew?.workHours?.start ?? '09:00');
  const [shiftEnd, setShiftEnd] = useState(crew?.workHours?.end ?? '17:00');
  const [shiftDays, setShiftDays] = useState(crew?.workHours?.days ?? [1, 2, 3, 4, 5]);

  const followMembers = (members: readonly string[]) => {
    if (!leadPicked || !members.includes(synthesizer)) setSynthesizer(current => nextLead(current, members));
  };

  /** The settings to send, or undefined after pointing at the field at fault. */
  const validate = (members: readonly string[], fail: Fail): ChannelLeadSettings | undefined => {
    const working = members.filter(id => id !== synthesizer || !crew || crew.memberIds.includes(crew.synthesizerId));
    if (working.length > MAX_CREW_MEMBERS) { fail('members', t('Khi Tí trưởng chia việc, kênh có tối đa {0} Tí làm phần việc.', [MAX_CREW_MEMBERS]), 'members'); return undefined; }
    if (!instructions.trim()) { fail('how', t('Hướng dẫn của Tí trưởng không được để trống.'), 'instructions'); return undefined; }
    const monthlyBudgetMicros = toMicros(limit);
    const taskBudgetMicros = toMicros(taskBudget);
    if (!Number.isFinite(monthlyBudgetMicros) || monthlyBudgetMicros < 0) { fail('limits', t('Giới hạn chi phí phải là số không âm.'), 'limit'); return undefined; }
    if (!Number.isFinite(taskBudgetMicros) || taskBudgetMicros < 0) { fail('limits', t('Giới hạn chi phí phải là số không âm.'), 'taskBudget'); return undefined; }
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_CREW_CONCURRENT_TASKS) { fail('limits', t('Số công việc chạy đồng thời từ 1 đến {0}.', [MAX_CREW_CONCURRENT_TASKS]), 'concurrency'); return undefined; }
    if (shift && !TimeZone.safeParse(shiftZone).success) { fail('limits', t('Timezone của ca không hợp lệ. Dùng tên như Asia/Ho_Chi_Minh hoặc UTC.'), 'shiftZone'); return undefined; }
    if (shift && (!shiftDays.length || shiftStart === shiftEnd)) { fail('limits', t('Chọn ít nhất một ngày làm việc và giờ bắt đầu khác giờ kết thúc.'), 'shift'); return undefined; }
    return {
      synthesizerId: members.includes(synthesizer) ? synthesizer : members[0],
      instructions, workflow, monthlyBudgetMicros, taskBudgetMicros, maxConcurrentTasks: concurrency,
      workHours: shift ? { timeZone: shiftZone, start: shiftStart, end: shiftEnd, days: shiftDays } : null,
      preflight: preflight ?? null,
      reviewPolicy: reviewPolicy ?? null,
    };
  };

  const howFields = (members: readonly Worker[], { busy, invalid, flash, clearError }: FieldState & { busy: boolean }): ReactNode => <>
    <Select label={<FieldLabel icon={Combine} required>{t('Tí trưởng')}</FieldLabel>} value={synthesizer} onChange={value => { setLeadPicked(true); setSynthesizer(value); }}
      options={members.map(worker => ({ value: worker.id, label: worker.name, icon: orgletFace(worker) }))} />
    <Select label={<FieldLabel icon={ListOrdered} required>{t('Quy trình')}</FieldLabel>} value={workflow} onChange={value => setWorkflow(value as Team['workflow'])}
      options={[{ value: 'parallel', label: t('Song song, rồi tổng hợp'), icon: <Columns2 size={16} /> }, { value: 'sequential', label: t('Tuần tự, rồi tổng hợp'), icon: <ListOrdered size={16} /> }]} />
    <p className="muted">{t('Tuần tự theo thứ tự chọn thành viên; song song tối đa hai người cùng lúc.')}</p>
    <label><FieldLabel icon={ScrollText} required>{t('Hướng dẫn của Tí trưởng')}</FieldLabel>
      <Textarea data-field="instructions" rows={6} value={instructions} onChange={event => { setInstructions(event.target.value); if (invalid === 'instructions') clearError(); }} maxLength={16000} invalid={invalid === 'instructions'} flash={flash} /></label>
    {(reviewPolicy || preflight) && <div className="review-setup-list">
      {reviewPolicy && <p className="muted review-setup"><span>{t('Câu trả lời của kênh phải trả lời {0} mục kiểm tra.', [reviewPolicy.requiredChecks.length])}</span><Button type="button" variant="ghost" disabled={busy} onClick={() => setReviewPolicy(undefined)}>{t('Bỏ checklist')}</Button></p>}
      {preflight && <p className="muted review-setup"><span>{t('Tệp CSV/JSON được kiểm tra trên máy trước khi kênh review.')}</span><Button type="button" variant="ghost" disabled={busy} onClick={() => setPreflight(undefined)}>{t('Tắt kiểm tra dataset')}</Button></p>}
    </div>}
  </>;

  const limitFields = ({ invalid, flash, clearError }: FieldState): ReactNode => <>
    <label><FieldLabel icon={Wallet} required>{t('Giới hạn kênh / tháng')}</FieldLabel><MoneyInput data-field="limit" type="number" min="0" step="any" value={limit} onChange={value => { setLimit(value); if (invalid === 'limit') clearError(); }} invalid={invalid === 'limit'} flash={flash} /></label>
    <label><FieldLabel icon={Wallet} required>{t('Giới hạn mỗi task')}</FieldLabel><MoneyInput data-field="taskBudget" type="number" min="0" step="any" value={taskBudget} onChange={value => { setTaskBudget(value); if (invalid === 'taskBudget') clearError(); }} invalid={invalid === 'taskBudget'} flash={flash} /></label>
    <label><FieldLabel icon={Layers} required>{t('Số công việc chạy đồng thời')}</FieldLabel><Input data-field="concurrency" type="number" min="1" max={MAX_CREW_CONCURRENT_TASKS} step="1" value={concurrency} onChange={event => { setConcurrency(Number(event.target.value)); if (invalid === 'concurrency') clearError(); }} invalid={invalid === 'concurrency'} flash={flash} /></label>
    {concurrency > QUIET_PARALLEL_LIMIT && <p className="muted">{t('Chạy nhiều cùng lúc thì chi phí cũng dồn về cùng lúc.')}</p>}
    <SwitchField checked={shift} onChange={setShift}>{t('Giới hạn khung giờ làm việc')}</SwitchField>
    {shift && <>
      <label><FieldLabel icon={Globe} required>{t('Timezone của ca')}</FieldLabel><Input data-field="shiftZone" value={shiftZone} onChange={event => { setShiftZone(event.target.value); if (invalid === 'shiftZone') clearError(); }} maxLength={100} invalid={invalid === 'shiftZone'} flash={flash} /></label>
      <label><FieldLabel icon={Clock} required>{t('Bắt đầu ca')}</FieldLabel><Input data-field="shift" type="time" value={shiftStart} onChange={event => { setShiftStart(event.target.value); if (invalid === 'shift') clearError(); }} invalid={invalid === 'shift'} flash={flash} /></label>
      <label><FieldLabel icon={Clock} required>{t('Kết thúc ca')}</FieldLabel><Input type="time" value={shiftEnd} onChange={event => { setShiftEnd(event.target.value); if (invalid === 'shift') clearError(); }} invalid={invalid === 'shift'} flash={flash} /></label>
      <fieldset><legend><FieldLabel icon={CalendarDays} required>{t('Ngày bắt đầu ca')}</FieldLabel></legend><div className="fieldset-options">{weekdayNames().map((day, index) => <Checkbox key={day} checked={shiftDays.includes(index)} onChange={event => { setShiftDays(current => event.target.checked ? [...current, index] : current.filter(value => value !== index)); if (invalid === 'shift') clearError(); }} {...fieldInvalid(invalid === 'shift', flash)}>{day}</Checkbox>)}</div></fieldset>
      <p className="muted">{t('Hết ca thì Orglet xong bước đang chạy rồi tạm dừng đến ca sau. Giờ kết thúc sớm hơn giờ bắt đầu nghĩa là ca qua đêm.')}</p>
    </>}
  </>;

  return { followMembers, validate, howFields, limitFields };
}

function weekdayNames(): string[] {
  return [t('Chủ nhật'), t('Thứ hai'), t('Thứ ba'), t('Thứ tư'), t('Thứ năm'), t('Thứ sáu'), t('Thứ bảy')];
}

/** The orglets a draft starts with: its orglets as listed, a crew as its members then its lead, each once. */
function startingOrglets(members: readonly ChannelMember[], workspace: Pick<Workspace, 'workers' | 'teams'>): string[] {
  const listed = new Set(workspace.workers.map(worker => worker.id));
  const ids: string[] = [];
  for (const member of members) {
    const crew = member.kind === 'crew' ? workspace.teams.find(team => team.id === member.id) : undefined;
    const orgletIds = member.kind === 'orglet' ? [member.id] : crew ? [...crew.memberIds, crew.synthesizerId] : [];
    for (const orgletId of orgletIds) if (listed.has(orgletId) && !ids.includes(orgletId)) ids.push(orgletId);
  }
  return ids;
}

function orgletFace(worker: Worker) {
  return <Avatar name={worker.name} seed={worker.id} emoji={worker.avatar?.emoji} mascot={worker.avatar?.mascot} defaultMascot hint={worker.description} color={worker.avatar?.color} size="xs"
    badge={worker.provider === 'demo' ? undefined : <ProviderMark provider={worker.provider} size="small" decorative />} />;
}
