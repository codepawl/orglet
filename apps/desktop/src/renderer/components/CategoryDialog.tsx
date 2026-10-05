import { useState } from 'react';
import { FolderTree, Lock, SlidersHorizontal, UsersRound } from 'lucide-react';
import { Input } from '@codepawlhq/orglet-ui';
import type { Worker, Workspace } from '../../shared/contracts';
import { CHANNEL_CATEGORY_LIMIT } from '../../shared/channels';
import { MAX_SPACE_CATEGORIES, type Space } from '../../shared/spaces';
import { FieldLabel } from './ui';
import { Avatar } from './Avatar';
import { ProviderMark } from './ProviderMark';
import { Checkbox } from './Checkbox';
import { Select } from './Select';
import { TabbedFormDialog } from './DialogTabs';
import { toast } from './toast';
import { t } from '../i18n';
import { orglet } from '../api';

type Tab = 'general' | 'members';
type InvalidField = 'name';

const generalTab = { id: 'general' as const, label: 'Chung', icon: <SlidersHorizontal size={16} /> };
const membersTab = { id: 'members' as const, label: 'Thành viên', icon: <UsersRound size={16} /> };

/** The space a new category goes into. */
export type CategoryDraft = { space: Space };

/**
 * A new category of a space, in a dialog of its own the way a channel has one (user, 2026-10-05): its name, and
 * whether it has every orglet of the space or a list of its own. Saving adds it to the space's categories and leaves
 * everything else about the space as it is. Remount (via key) to reset the draft.
 */
export function CategoryDialog({ open, draft, workspace, onClose }: { open: boolean; draft: CategoryDraft; workspace: Workspace; onClose: () => void }) {
  const space = draft.space;
  const [tab, setTab] = useState<Tab>('general');
  const [name, setName] = useState('');
  const [listed, setListed] = useState(false);
  const [orgletIds, setOrgletIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState<InvalidField>();
  const [flash, setFlash] = useState(0);
  const clearError = () => { setError(''); setInvalid(undefined); };
  const members = workspace.workers.filter(worker => space.orgletIds.includes(worker.id));
  const full = space.categories.length >= MAX_SPACE_CATEGORIES;

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setTab('general'); setError(t('Đặt tên cho nhóm.')); setInvalid('name'); setFlash(count => count + 1);
      setTimeout(() => document.querySelector<HTMLElement>('#category-panel [data-field="name"]')?.focus(), 0);
      return;
    }
    setBusy(true); clearError();
    void (async () => {
      try {
        await orglet.call('updateSpace', {
          id: space.id, name: space.name, ...(space.color ? { color: space.color } : {}), orgletIds: space.orgletIds,
          categories: [...space.categories, { name: trimmed, ...(listed ? { orgletIds } : {}) }],
        });
        toast(t('Đã tạo nhóm'), 'success', trimmed);
        onClose();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    })();
  };

  return <TabbedFormDialog open={open} onClose={onClose} title={t('Nhóm mới')} tabs={[generalTab, membersTab]} tab={tab} onTab={next => { setTab(next); clearError(); }}
    panelId="category-panel" onSubmit={submit} submitLabel={t('Tạo nhóm')} busy={busy} error={error || (full ? t('Không gian đã có đủ số nhóm.') : '')}>
    {tab === 'general' && <>
      <label><FieldLabel icon={FolderTree} required>{t('Tên nhóm')}</FieldLabel>
        <Input data-field="name" value={name} onChange={event => { setName(event.target.value); if (invalid === 'name') clearError(); }} maxLength={CHANNEL_CATEGORY_LIMIT} placeholder={t('ví dụ: Nghiên cứu')} invalid={invalid === 'name'} flash={flash} /></label>
      <p className="muted">{t('Nhóm gom các kênh trong không gian. Một nhóm có thể chỉ có một số Tí của không gian.')}</p>
    </>}
    {tab === 'members' && <>
      <Select ariaLabel={t('Ai ở trong nhóm {0}', [name.trim() || t('chưa đặt tên')])} value={listed ? 'listed' : 'inherit'} onChange={value => setListed(value === 'listed')}
        options={[
          { value: 'inherit', label: t('Mọi Tí của không gian'), icon: <UsersRound size={16} /> },
          { value: 'listed', label: t('Chỉ những Tí được chọn'), icon: <Lock size={16} /> },
        ]} />
      {listed && <div className="fieldset-options">
        {members.map(worker => <Checkbox key={worker.id} aria-label={worker.name} checked={orgletIds.includes(worker.id)}
          onChange={event => setOrgletIds(current => event.target.checked ? [...current, worker.id] : current.filter(id => id !== worker.id))}>
          <span className="inline-mark">{orgletFace(worker)}{worker.name}</span>
        </Checkbox>)}
      </div>}
    </>}
  </TabbedFormDialog>;
}

function orgletFace(worker: Worker) {
  return <Avatar name={worker.name} seed={worker.id} emoji={worker.avatar?.emoji} mascot={worker.avatar?.mascot} defaultMascot hint={worker.description} color={worker.avatar?.color} size="xs"
    badge={worker.provider === 'demo' ? undefined : <ProviderMark provider={worker.provider} size="small" decorative />} />;
}
