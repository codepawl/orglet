import { useState, type ReactNode } from 'react';
import { Hash, MessageSquareQuote, SlidersHorizontal, UserRound, Users, UsersRound } from 'lucide-react';
import { Input } from '@codepawl/orglet-ui';
import type { Team, Worker, Workspace } from '../../shared/contracts';
import { CHANNEL_NAME_LIMIT, CHANNEL_TOPIC_LIMIT, MAX_CHANNEL_MEMBERS, memberKey, type ChannelMember } from '../../shared/channels';
import { FieldLabel } from './ui';
import { Avatar, RosterAvatars } from './Avatar';
import { ProviderMark } from './ProviderMark';
import { Checkbox } from './Checkbox';
import { TabbedFormDialog } from './DialogTabs';
import { fieldInvalid } from './fieldInvalid';
import { teamRoster } from '../assignees';
import { toast } from './toast';
import { t } from '../i18n';
import { orglet } from '../api';

type Tab = 'general' | 'members';
type InvalidField = 'name' | 'members';
const tabs = [
  { id: 'general' as const, label: 'Chung', icon: <SlidersHorizontal size={16} /> },
  { id: 'members' as const, label: 'Thành viên', icon: <UsersRound size={16} /> },
];

/**
 * The channel being edited, or the members a new one starts with (orglets or crews picked in the sidebar).
 * `initialTab` opens the members straight away, as the header's faces do.
 */
export type ChannelDraft = { id: string; name: string; topic?: string; members: ChannelMember[]; initialTab?: 'members' } | { id?: undefined; members?: ChannelMember[]; initialTab?: undefined };

/**
 * Creating or editing a channel (COD-361): its name and topic, then who is in it, crews and orglets. A crew answers in
 * the channel as its orglets. A new channel opens empty; its first message is what makes its chat. Saving an existing
 * one takes effect from the next message. Remount (via key) to reset the draft.
 */
export function ChannelDialog({ open, draft, workspace, onClose, onCreated }: { open: boolean; draft: ChannelDraft; workspace: Workspace; onClose: () => void; onCreated: (channelId: string) => void }) {
  const editing = draft.id !== undefined;
  const [tab, setTab] = useState<Tab>(draft.initialTab ?? 'general');
  const [name, setName] = useState(editing ? draft.name : '');
  const [topic, setTopic] = useState(editing ? draft.topic ?? '' : '');
  // Members that left the workspace are not offered again, so saving drops them.
  const [members, setMembers] = useState<ChannelMember[]>(() => (draft.members ?? []).filter(member => listed(member, workspace)));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState<InvalidField>();
  const [flash, setFlash] = useState(0);
  const clearError = () => { setError(''); setInvalid(undefined); };
  const fail = (at: Tab, message: string, field: InvalidField) => {
    setTab(at); setError(message); setInvalid(field); setFlash(count => count + 1);
    setTimeout(() => document.querySelector<HTMLElement>(`#channel-panel [data-field="${field}"]`)?.focus(), 0);
  };
  const picked = (member: ChannelMember) => members.some(item => memberKey(item) === memberKey(member));
  const toggle = (member: ChannelMember, on: boolean) => {
    setMembers(current => on ? [...current, member] : current.filter(item => memberKey(item) !== memberKey(member)));
    if (invalid === 'members') clearError();
  };

  const submit = async () => {
    const trimmed = name.trim().replace(/^#+\s*/, '');
    if (!trimmed) return fail('general', t('Đặt tên cho kênh.'), 'name');
    if (!members.length) return fail('members', t('Chọn ít nhất một Tí hoặc một hội.'), 'members');
    const fields = { name: trimmed, topic: topic.trim(), members };
    setBusy(true); clearError();
    try {
      if (editing) {
        await orglet.call('updateChannel', { id: draft.id, ...fields });
        toast(t('Đã lưu kênh'), 'success', `#${trimmed}`);
      } else {
        const channelId = await orglet.call('createChannel', fields);
        toast(t('Đã tạo kênh'), 'success', `#${trimmed}`);
        onCreated(channelId);
      }
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const memberRow = (member: ChannelMember, label: string, face: ReactNode) =>
    <Checkbox key={memberKey(member)} aria-label={label} data-field={invalid === 'members' ? 'members' : undefined} checked={picked(member)}
      disabled={!picked(member) && members.length >= MAX_CHANNEL_MEMBERS} onChange={event => toggle(member, event.target.checked)} {...fieldInvalid(invalid === 'members', flash)}>
      <span className="inline-mark">{face}{label}</span>
    </Checkbox>;

  return <TabbedFormDialog open={open} onClose={onClose} title={editing ? t('Thiết lập kênh') : t('Kênh mới')} tabs={tabs} tab={tab} onTab={next => { setTab(next); clearError(); }}
    panelId="channel-panel" onSubmit={() => void submit()} submitLabel={editing ? t('Lưu kênh') : t('Tạo kênh')} busy={busy} error={error}>
    {tab === 'general' && <>
      <label><FieldLabel icon={Hash} required>{t('Tên kênh')}</FieldLabel>
        <Input data-field="name" value={name} onChange={event => { setName(event.target.value); if (invalid === 'name') clearError(); }} maxLength={CHANNEL_NAME_LIMIT + 1} placeholder={t('ví dụ: ra-mắt')} invalid={invalid === 'name'} flash={flash} /></label>
      <label><FieldLabel icon={MessageSquareQuote}>{t('Chủ đề')}</FieldLabel>
        <Input value={topic} onChange={event => setTopic(event.target.value)} maxLength={CHANNEL_TOPIC_LIMIT} placeholder={t('Kênh này để làm gì')} /></label>
      <p className="muted">{t('Mỗi Tí trong kênh trả lời lần lượt và đọc được các câu trả lời trước. Gắn @tên để hỏi riêng một Tí.')}</p>
    </>}
    {tab === 'members' && <>
      {workspace.teams.length > 0 && <fieldset><legend><FieldLabel icon={Users}>{t('Hội')}</FieldLabel></legend><div className="fieldset-options">
        {workspace.teams.map(team => memberRow({ kind: 'crew', id: team.id }, team.name, crewFace(team, workspace.workers)))}
      </div></fieldset>}
      <fieldset><legend><FieldLabel icon={UserRound}>{t('Tí')}</FieldLabel></legend><div className="fieldset-options">
        {workspace.workers.map(worker => memberRow({ kind: 'orglet', id: worker.id }, worker.name, orgletFace(worker)))}
        {!workspace.workers.length && <p className="muted">{t('Chưa có Tí nào. Tạo một Tí trước.')}</p>}
      </div></fieldset>
      <p className="muted">{t('Một hội trong kênh trả lời bằng các Tí của nó, lần lượt như mọi Tí khác.')}</p>
    </>}
  </TabbedFormDialog>;
}

function listed(member: ChannelMember, workspace: Pick<Workspace, 'workers' | 'teams'>): boolean {
  if (member.kind === 'orglet') return workspace.workers.some(worker => worker.id === member.id);
  return workspace.teams.some(team => team.id === member.id);
}

function orgletFace(worker: Worker) {
  return <Avatar name={worker.name} seed={worker.id} emoji={worker.avatar?.emoji} mascot={worker.avatar?.mascot} defaultMascot hint={worker.description} color={worker.avatar?.color} size="xs"
    badge={worker.provider === 'demo' ? undefined : <ProviderMark provider={worker.provider} size="small" decorative />} />;
}

function crewFace(team: Team, workers: readonly Worker[]) {
  return <RosterAvatars workers={teamRoster(team, workers)} size="xs" max={2} countRest={false} />;
}
