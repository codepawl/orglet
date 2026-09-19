import { useState } from 'react';
import { SlidersHorizontal, Type, UserRound, Users, UsersRound, Wallet } from 'lucide-react';
import type { Task, Workspace } from '../../shared/contracts';
import { FieldLabel, MoneyInput } from './ui';
import { Select } from './Select';
import { Checkbox } from './Checkbox';
import { Avatar } from './Avatar';
import { TabbedFormDialog } from './DialogTabs';
import { fieldInvalid } from './fieldInvalid';
import { formatMoney, toAmount, toMicros } from './money';
import { toast } from './toast';
import { t } from '../i18n';
import { orglet } from '../api';

type Tab = 'general' | 'limits';
type InvalidField = 'assignees' | 'budget';
const tabs = [
  { id: 'general' as const, label: 'Chung', icon: <SlidersHorizontal size={16} /> },
  { id: 'limits' as const, label: 'Giới hạn', icon: <Wallet size={16} /> },
];

/**
 * Task settings, like the worker and team dialogs: its name, who answers it and its cost limit. Assign it to all
 * workers (including ones added later), to chosen workers (several make a group chat that answers in turn), or to a
 * team. New assignees answer from the next message and see the earlier chat. Remount (via key) to reset the draft.
 */
export function TaskDialog({ open, task, workspace, usedMicros, onClose }: { open: boolean; task?: Task; workspace: Workspace; usedMicros: number; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('general');
  const [title, setTitle] = useState(task?.title ?? '');
  const [mode, setMode] = useState(!task ? 'workers' : task.teamId ? `team:${task.teamId}` : task.assignees === 'all' ? 'all' : 'workers');
  const [chosen, setChosen] = useState<string[]>(() => !task ? [] : Array.isArray(task.assignees) ? task.assignees : [task.workerId]);
  const [budget, setBudget] = useState(toAmount(task?.budgetMicros ?? 500_000));
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState<InvalidField>();
  const [flash, setFlash] = useState(0);
  if (!task) return null;
  const running = ['queued', 'running', 'pausing'].includes(task.status);
  const clearError = () => { setError(''); setInvalid(undefined); };
  const fail = (at: Tab, message: string, field?: InvalidField) => {
    setTab(at); setError(message); setInvalid(field); setFlash(n => n + 1);
  };

  const submit = async () => {
    const budgetMicros = toMicros(budget);
    if (mode === 'workers' && !chosen.length) return fail('general', t('Chọn ít nhất một nhân viên.'), 'assignees');
    if (!Number.isFinite(budgetMicros) || budgetMicros < 1000 || budgetMicros > 100_000_000) return fail('limits', t('Nhập từ {0} đến {1}.', [formatMoney(1000), formatMoney(100_000_000)]), 'budget');
    const assignee = mode === 'all' ? { kind: 'all' as const } : mode.startsWith('team:') ? { kind: 'team' as const, teamId: mode.slice(5) } : { kind: 'workers' as const, workerIds: workspace.workers.map(worker => worker.id).filter(id => chosen.includes(id)) };
    setBusy(true); clearError();
    try {
      await orglet.call('updateTask', { id: task.id, title: title.trim(), assignee, budgetMicros });
      toast(t('Đã lưu công việc')); onClose();
    } catch (err) { setError((err as Error).message); setInvalid(undefined); } finally { setBusy(false); }
  };

  return <TabbedFormDialog open={open} onClose={onClose} title={t('Thiết lập công việc')} tabs={tabs} tab={tab} onTab={next => { setTab(next); clearError(); }} panelId="task-panel" onSubmit={() => void submit()} submitLabel={t('Lưu công việc')} busy={busy || running} error={error}>
    {tab === 'general' && <>
      <label><FieldLabel icon={Type}>{t('Tên công việc')}</FieldLabel><input value={title} onChange={event => setTitle(event.target.value)} maxLength={120} placeholder={task.brief.split('\n')[0].slice(0, 120)} /></label>
      <Select label={<FieldLabel icon={UserRound} required>{t('Giao cho')}</FieldLabel>} value={mode} onChange={value => { setMode(value); if (invalid === 'assignees') clearError(); }} invalid={invalid === 'assignees'} flash={flash} options={[
        { value: 'all', label: t('Toàn bộ nhân viên'), detail: t('{0} nhân viên, gồm cả người thêm sau', [workspace.workers.length]), icon: <UsersRound size={16} /> },
        { value: 'workers', label: t('Chọn nhân viên'), detail: t('Một hoặc nhiều người'), icon: <UserRound size={16} /> },
        ...workspace.teams.map(team => ({ value: `team:${team.id}`, label: team.name, group: t('Nhóm'), icon: <Users size={16} /> })),
      ]} />
      {mode === 'workers' && <fieldset className="assignee-list"><legend className="visually-hidden">{t('Chọn nhân viên')}</legend>
        {workspace.workers.map(worker => <Checkbox key={worker.id} aria-label={worker.name} checked={chosen.includes(worker.id)} onChange={event => { setChosen(current => event.target.checked ? [...current, worker.id] : current.filter(id => id !== worker.id)); if (invalid === 'assignees') clearError(); }} {...fieldInvalid(invalid === 'assignees', flash)}>
          <span className="inline-mark"><Avatar name={worker.name} seed={worker.id} mascot={worker.avatar?.mascot} defaultMascot hint={worker.description} color={worker.avatar?.color} size="xs" />{worker.name}</span>
        </Checkbox>)}
      </fieldset>}
      <p className="muted">{mode === 'all' || (mode === 'workers' && chosen.length > 1) ? t('Mỗi tin nhắn được từng người trả lời lần lượt; người sau đọc được câu trả lời của người trước.') : t('Người được giao trả lời tin nhắn tiếp theo và đọc được cuộc trò chuyện trước đó.')}</p>
    </>}
    {tab === 'limits' && <>
      <label><FieldLabel icon={Wallet} required>{t('Giới hạn chi phí của công việc')}</FieldLabel><MoneyInput type="number" min="0" step="any" value={budget} onChange={value => { setBudget(value); if (invalid === 'budget') clearError(); }} invalid={invalid === 'budget'} flash={flash} /></label>
      <p className="muted">{t('Đã dùng {0}, tính cả các tin nhắn trước. Khi giao cho nhiều người, mọi câu trả lời dùng chung giới hạn này.', [formatMoney(usedMicros)])}</p>
    </>}
    {running && <p role="status">{t('Công việc đang chạy. Đợi xong rồi hãy đổi thiết lập.')}</p>}
  </TabbedFormDialog>;
}
