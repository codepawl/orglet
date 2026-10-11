import { useState } from 'react';
import { Hash, SlidersHorizontal, Type, UserRound, UsersRound } from 'lucide-react';
import { channelLabel } from '../../shared/channels';
import type { Task, Workspace } from '../../shared/contracts';
import { FieldLabel } from './ui';
import { Select } from './Select';
import { Checkbox } from './Checkbox';
import { Avatar } from './Avatar';
import { TabbedFormDialog } from './DialogTabs';
import { fieldInvalid } from './fieldInvalid';
import { fieldMessage } from '../fieldErrors';
import { toast } from './toast';
import { t } from '../i18n';
import { orglet } from '../api';
import { Input } from '@codepawlhq/orglet-ui';
import { LocalOnlyControl } from './LocalOnlyControl';

type Tab = 'general';
type InvalidField = 'assignees';
const tabs = [
  { id: 'general' as const, label: 'Chung', icon: <SlidersHorizontal size={16} /> },
];

/**
 * Task settings, like the worker and team dialogs: its name and who answers it. A channel's name and
 * members are the channel's own (COD-361, `ChannelDialog`), so a channel keeps only the sync choice. Assign it to all
 * workers (including ones added later), to chosen workers (several make a group chat that answers in turn), or to a
 * team. New assignees answer from the next message and see the earlier chat. Remount (via key) to reset the draft.
 */
export function TaskDialog({ open, task, workspace, onClose }: { open: boolean; task?: Task; workspace: Workspace; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('general');
  const [title, setTitle] = useState(task?.title ?? '');
  const [localOnly, setLocalOnly] = useState(Boolean(task && workspace.syncLocalOnly?.tasks.includes(task.id)));
  const [mode, setMode] = useState(!task ? 'workers' : task.teamId ? `team:${task.teamId}` : task.assignees === 'all' ? 'all' : 'workers');
  const [chosen, setChosen] = useState<string[]>(() => !task ? [] : Array.isArray(task.assignees) ? task.assignees : [task.workerId]);
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
    if (mode === 'workers' && !chosen.length) return fail('general', t('Chọn ít nhất một Tí.'), 'assignees');
    const assignee = mode === 'all' ? { kind: 'all' as const } : mode.startsWith('team:') ? { kind: 'team' as const, teamId: mode.slice(5) } : { kind: 'workers' as const, workerIds: workspace.workers.map(worker => worker.id).filter(id => chosen.includes(id)) };
    setBusy(true); clearError();
    try {
      await orglet.call('updateTask', { id: task.id, title: title.trim(), assignee, localOnly });
      toast(t('Đã lưu chat'), 'success', title.trim() || task.title || task.brief.split('\n')[0]); onClose();
    } catch (err) { setError((err as Error).message); setInvalid(undefined); } finally { setBusy(false); }
  };

  return <TabbedFormDialog open={open} onClose={onClose} title={t('Thiết lập chat')} tabs={tabs} tab={tab} onTab={next => { setTab(next); clearError(); }} panelId="task-panel" onSubmit={() => void submit()} submitLabel={t('Lưu chat')} busy={busy || running} error={invalid ? '' : error}>
    {tab === 'general' && !task.channel && <>
      <label><FieldLabel icon={Type}>{t('Tên chat')}</FieldLabel><Input value={title} onChange={event => setTitle(event.target.value)} maxLength={120} placeholder={task.brief.split('\n')[0].slice(0, 120)} /></label>
      <Select label={<FieldLabel icon={UserRound} required>{t('Giao cho')}</FieldLabel>} value={mode} onChange={value => { setMode(value); if (invalid === 'assignees') clearError(); }} invalid={invalid === 'assignees'} flash={flash} options={[
        { value: 'all', label: t('Toàn bộ Tí'), detail: workspace.workers.length === 1 ? t('1 Tí, gồm cả người thêm sau') : t('{0} Tí, gồm cả người thêm sau', [workspace.workers.length]), icon: <UsersRound size={16} /> },
        { value: 'workers', label: t('Chọn Tí'), detail: t('Một hoặc nhiều người'), icon: <UserRound size={16} /> },
        // A crew's chat from before crews became channels keeps its crew; no other chat can be given one (COD-369).
        ...workspace.teams.filter(team => team.id === task.teamId).map(team => ({ value: `team:${team.id}`, label: channelLabel(team.name), group: t('Kênh'), icon: <Hash size={16} /> })),
      ]} />
      {mode === 'workers' && <fieldset className="assignee-list"><legend className="visually-hidden">{t('Chọn Tí')}</legend>
        {workspace.workers.map(worker => <Checkbox key={worker.id} aria-label={worker.name} checked={chosen.includes(worker.id)} onChange={event => { setChosen(current => event.target.checked ? [...current, worker.id] : current.filter(id => id !== worker.id)); if (invalid === 'assignees') clearError(); }} {...fieldInvalid(invalid === 'assignees', flash)}>
          <span className="inline-mark"><Avatar name={worker.name} seed={worker.id} mascot={worker.avatar?.mascot} hint={worker.description} color={worker.avatar?.color} size="xs" />{worker.name}</span>
        </Checkbox>)}
      </fieldset>}
      {fieldMessage('assignees', invalid, error)}
      <p className="muted">{mode === 'all' || (mode === 'workers' && chosen.length > 1) ? t('Từng người trả lời lần lượt, đọc được câu trả lời trước đó.') : t('Người được giao trả lời tin nhắn tiếp theo và đọc được cuộc trò chuyện trước đó.')}</p>
    </>}
    {running && <p role="status">{t('Công việc đang chạy. Đợi xong rồi hãy đổi thiết lập.')}</p>}
    <LocalOnlyControl checked={localOnly} onChange={setLocalOnly} inherited={workspace.syncLocalOnly?.inheritedTasks.includes(task.id)} permanent={workspace.syncLocalOnly?.permanentTasks?.includes(task.id)} orgletDeleted={workspace.syncLocalOnly?.deletedOrgletTasks?.includes(task.id)} />
  </TabbedFormDialog>;
}
