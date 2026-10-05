import { useState } from 'react';
import { Boxes, Database, FileText, Folder, FolderTree, Globe, Lock, Plus, ShieldCheck, SlidersHorizontal, Trash, UserRound, UsersRound } from 'lucide-react';
import { Input } from '@codepawlhq/orglet-ui';
import type { Worker, Workspace } from '../../shared/contracts';
import { CHANNEL_CATEGORY_LIMIT, MAX_CHANNEL_MEMBERS } from '../../shared/channels';
import { MAX_SPACE_CATEGORIES, SPACE_FOLDER_LIMIT, SPACE_NAME_LIMIT, type Space, type SpaceDefaultCapability } from '../../shared/spaces';
import { SwitchField } from './Switch';
import { Button, FieldLabel } from './ui';
import { Avatar } from './Avatar';
import { ProviderMark } from './ProviderMark';
import { Checkbox } from './Checkbox';
import { Select } from './Select';
import { TabbedFormDialog } from './DialogTabs';
import { fieldInvalid } from './fieldInvalid';
import { toast } from './toast';
import { t } from '../i18n';
import { orglet } from '../api';

type Tab = 'general' | 'members' | 'categories' | 'permissions';
type InvalidField = 'name' | 'members' | 'category';

const generalTab = { id: 'general' as const, label: 'Chung', icon: <SlidersHorizontal size={16} /> };
const membersTab = { id: 'members' as const, label: 'Thành viên', icon: <UsersRound size={16} /> };
const categoriesTab = { id: 'categories' as const, label: 'Nhóm', icon: <FolderTree size={16} /> };
const permissionsTab = { id: 'permissions' as const, label: 'Quyền', icon: <ShieldCheck size={16} /> };
/** What a new channel has when its space sets nothing, so the switches start where the app itself would. */
const APP_DEFAULTS: readonly SpaceDefaultCapability[] = ['source.read', 'dataset.check'];

/** A category while the dialog is open: `key` tells the rows apart, `id` is set for one the space already has. */
type CategoryDraft = { key: string; id?: string; name: string; listed: boolean; orgletIds: string[] };

/** The space being edited, or nothing for a new one. `initialTab` opens its orglets or its categories straight away. */
export type SpaceDraft = { space?: Space; initialTab?: Tab };

let nextCategoryKey = 0;
function categoryKey(): string {
  nextCategoryKey += 1;
  return `new-${nextCategoryKey}`;
}

/**
 * Creating or editing a space (docs/spaces-design.md): its name, the orglets in it, and its categories, each with every
 * orglet of the space or some of them. Saving resolves every channel of the space again, so an orglet unticked here
 * leaves those channels. Remount (via key) to reset the draft.
 */
export function SpaceDialog({ open, draft, workspace, onClose, onCreated }: { open: boolean; draft: SpaceDraft; workspace: Workspace; onClose: () => void; onCreated: (spaceId: string) => void }) {
  const editing = draft.space;
  const [tab, setTab] = useState<Tab>(draft.initialTab ?? 'general');
  const [name, setName] = useState(editing?.name ?? '');
  const [folder, setFolder] = useState(editing?.folder ?? '');
  const [orgletIds, setOrgletIds] = useState<string[]>(() => editing ? editing.orgletIds.filter(id => workspace.workers.some(worker => worker.id === id)) : []);
  const [categories, setCategories] = useState<CategoryDraft[]>(() => (editing?.categories ?? []).map(category => ({ key: category.id, id: category.id, name: category.name, listed: Boolean(category.orgletIds), orgletIds: category.orgletIds ?? [] })));
  // What a new channel in the space starts with. Sent only once the space has a setting or the person touched one,
  // so opening and saving a space never changes what its next channel gets.
  const [defaults, setDefaults] = useState<readonly SpaceDefaultCapability[]>(editing?.defaults?.capabilities ?? APP_DEFAULTS);
  const [defaultsSet, setDefaultsSet] = useState(Boolean(editing?.defaults));
  const changeDefault = (capability: SpaceDefaultCapability, enabled: boolean) => {
    setDefaults(current => enabled ? [...current.filter(item => item !== capability), capability] : current.filter(item => item !== capability));
    setDefaultsSet(true);
  };
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState<InvalidField>();
  const [flash, setFlash] = useState(0);
  const clearError = () => { setError(''); setInvalid(undefined); };
  const fail = (at: Tab, message: string, field: InvalidField) => {
    setTab(at); setError(message); setInvalid(field); setFlash(count => count + 1);
    setTimeout(() => document.querySelector<HTMLElement>(`#space-panel [data-field="${field}"]`)?.focus(), 0);
  };
  const members = workspace.workers.filter(worker => orgletIds.includes(worker.id));
  const changeCategory = (key: string, change: Partial<CategoryDraft>) => {
    setCategories(current => current.map(category => category.key === key ? { ...category, ...change } : category));
    if (invalid === 'category') clearError();
  };

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return fail('general', t('Đặt tên cho không gian.'), 'name');
    if (!orgletIds.length) return fail('members', t('Chọn ít nhất một Tí.'), 'members');
    if (categories.some(category => !category.name.trim())) return fail('categories', t('Đặt tên cho từng nhóm, hoặc xóa nhóm trống.'), 'category');
    const fields = {
      name: trimmed,
      orgletIds,
      // An empty name takes the space out of its folder.
      folder: folder.trim() || null,
      ...(defaultsSet ? { defaults: { capabilities: [...defaults] } } : {}),
      categories: categories.map(category => ({
        ...(category.id ? { id: category.id } : {}),
        name: category.name.trim(),
        // A category never holds an orglet the space lost in this same edit.
        ...(category.listed ? { orgletIds: category.orgletIds.filter(id => orgletIds.includes(id)) } : {}),
      })),
    };
    setBusy(true); clearError();
    void (async () => {
      try {
        if (editing) {
          await orglet.call('updateSpace', { id: editing.id, ...fields });
          toast(t('Đã lưu không gian'), 'success', trimmed);
        } else {
          const spaceId = await orglet.call('createSpace', fields);
          toast(t('Đã tạo không gian'), 'success', trimmed);
          onCreated(spaceId);
        }
        onClose();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    })();
  };

  return <TabbedFormDialog open={open} onClose={onClose} title={editing ? t('Thiết lập không gian') : t('Không gian mới')} tabs={[generalTab, membersTab, categoriesTab, permissionsTab]} tab={tab} onTab={next => { setTab(next); clearError(); }}
    panelId="space-panel" onSubmit={submit} submitLabel={editing ? t('Lưu không gian') : t('Tạo không gian')} busy={busy} error={error}>
    {tab === 'general' && <>
      <label><FieldLabel icon={Boxes} required>{t('Tên không gian')}</FieldLabel>
        <Input data-field="name" value={name} onChange={event => { setName(event.target.value); if (invalid === 'name') clearError(); }} maxLength={SPACE_NAME_LIMIT} placeholder={t('ví dụ: Ra mắt sản phẩm')} invalid={invalid === 'name'} flash={flash} /></label>
      <p className="muted">{t('Một không gian gom các kênh của một việc lớn, với những Tí làm việc đó. Kênh trong không gian chỉ có những Tí của không gian.')}</p>
      <label><FieldLabel icon={Folder}>{t('Thư mục')}</FieldLabel>
        <Input value={folder} onChange={event => setFolder(event.target.value)} maxLength={SPACE_FOLDER_LIMIT} placeholder={t('ví dụ: Khách hàng')} list="space-folder-names" />
        <span className="muted">{t('Các không gian cùng tên thư mục nằm chung một nhóm trên thanh bên trái. Để trống thì không gian đứng riêng.')}</span></label>
      <datalist id="space-folder-names">{[...new Set(workspace.spaces.flatMap(space => space.folder ?? []))].map(item => <option key={item} value={item} />)}</datalist>
    </>}
    {tab === 'members' && <>
      <fieldset><legend><FieldLabel icon={UserRound} required>{t('Tí trong không gian')}</FieldLabel></legend><div className="fieldset-options">
        {workspace.workers.map(worker => <Checkbox key={worker.id} aria-label={worker.name} data-field={invalid === 'members' ? 'members' : undefined} checked={orgletIds.includes(worker.id)}
          disabled={!orgletIds.includes(worker.id) && orgletIds.length >= MAX_CHANNEL_MEMBERS}
          onChange={event => { setOrgletIds(current => event.target.checked ? [...current, worker.id] : current.filter(id => id !== worker.id)); if (invalid === 'members') clearError(); }} {...fieldInvalid(invalid === 'members', flash)}>
          <span className="inline-mark">{orgletFace(worker)}{worker.name}</span>
        </Checkbox>)}
        {!workspace.workers.length && <p className="muted">{t('Chưa có Tí nào. Tạo một Tí trước.')}</p>}
      </div></fieldset>
      {editing && <p className="muted">{t('Bỏ một Tí khỏi không gian thì Tí đó rời mọi kênh trong không gian. Tin nhắn cũ vẫn còn.')}</p>}
    </>}
    {tab === 'categories' && <>
      <p className="muted">{t('Nhóm gom các kênh trong không gian. Một nhóm có thể chỉ có một số Tí của không gian.')}</p>
      {categories.map(category => <div key={category.key} className="space-category">
        <div className="space-category-head">
          <Input aria-label={t('Tên nhóm')} data-field={invalid === 'category' && !category.name.trim() ? 'category' : undefined} value={category.name} maxLength={CHANNEL_CATEGORY_LIMIT} placeholder={t('Tên nhóm')}
            onChange={event => changeCategory(category.key, { name: event.target.value })} invalid={invalid === 'category' && !category.name.trim()} flash={flash} />
          <Button type="button" size="icon" aria-label={t('Xóa nhóm {0}', [category.name.trim() || t('chưa đặt tên')])} title={t('Xóa nhóm')} onClick={() => { setCategories(current => current.filter(item => item.key !== category.key)); clearError(); }}><Trash size={16} /></Button>
        </div>
        <Select ariaLabel={t('Ai ở trong nhóm {0}', [category.name.trim() || t('chưa đặt tên')])} value={category.listed ? 'listed' : 'inherit'} onChange={value => changeCategory(category.key, { listed: value === 'listed' })}
          options={[
            { value: 'inherit', label: t('Mọi Tí của không gian'), icon: <UsersRound size={16} /> },
            { value: 'listed', label: t('Chỉ những Tí được chọn'), icon: <Lock size={16} /> },
          ]} />
        {category.listed && <div className="fieldset-options">
          {members.map(worker => <Checkbox key={worker.id} aria-label={worker.name} checked={category.orgletIds.includes(worker.id)}
            onChange={event => changeCategory(category.key, { orgletIds: event.target.checked ? [...category.orgletIds, worker.id] : category.orgletIds.filter(id => id !== worker.id) })}>
            <span className="inline-mark">{orgletFace(worker)}{worker.name}</span>
          </Checkbox>)}
          {!members.length && <p className="muted">{t('Chọn Tí cho không gian trước.')}</p>}
        </div>}
      </div>)}
      <Button type="button" variant="outline" disabled={categories.length >= MAX_SPACE_CATEGORIES} onClick={() => setCategories(current => [...current, { key: categoryKey(), name: '', listed: false, orgletIds: [] }])}><Plus size={16} />{t('Thêm nhóm')}</Button>
    </>}
    {tab === 'permissions' && <>
      <p className="muted">{t('Kênh mới trong không gian bắt đầu với những quyền này. Từng kênh vẫn đổi được quyền của riêng nó. Trình duyệt, ứng dụng và thư mục làm việc luôn chọn theo từng kênh.')}</p>
      <SwitchField checked={defaults.includes('source.read')} onChange={enabled => changeDefault('source.read', enabled)} description={t('Đọc các tệp đính kèm trong chat này.')}>
        <FileText size={15} aria-hidden="true" />{t('Đọc nguồn đính kèm')}
      </SwitchField>
      <SwitchField checked={defaults.includes('dataset.check')} onChange={enabled => changeDefault('dataset.check', enabled)} description={t('Kiểm tra cấu trúc dữ liệu đã đính kèm.')}>
        <Database size={15} aria-hidden="true" />{t('Kiểm tra dữ liệu')}
      </SwitchField>
      <SwitchField checked={defaults.includes('network.web')} onChange={enabled => changeDefault('network.web', enabled)} description={t('Tìm và đọc trang web công khai.')}>
        <Globe size={15} aria-hidden="true" />{t('Đọc và tìm kiếm web')}
      </SwitchField>
    </>}
  </TabbedFormDialog>;
}

function orgletFace(worker: Worker) {
  return <Avatar name={worker.name} seed={worker.id} emoji={worker.avatar?.emoji} mascot={worker.avatar?.mascot} defaultMascot hint={worker.description} color={worker.avatar?.color} size="xs"
    badge={worker.provider === 'demo' ? undefined : <ProviderMark provider={worker.provider} size="small" decorative />} />;
}
