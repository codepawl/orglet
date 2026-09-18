import { useState } from 'react';
import { AlignLeft, Smile, Cpu, ScrollText, Sparkles, UserRound, Wallet, SlidersHorizontal } from 'lucide-react';
import type { Worker, Workspace } from '../../shared/contracts';
import { harnessNames, isHarness, type HarnessInfo } from '../../shared/harness';
import { FieldLabel, MoneyInput } from './ui';
import { Select } from './Select';
import { ProviderMark } from './ProviderMark';
import { AvatarPicker } from './Avatar';
import { isMascot, mascotIds } from './mascots';
import { autoMascot } from './mascotSuggest';
import { TabbedFormDialog } from './DialogTabs';
import { toAmount, toMicros } from './money';
import { toast } from './toast';
import { t } from '../i18n';
import { orglet } from '../api';

const defaultInstructions = 'Work with the user like a helpful coworker: answer questions, talk things through and do what they ask. Keep replies clear and to the point. Write a formal report only when asked.';
type Tab = 'general' | 'instructions' | 'skill';
const tabs = [
  { id: 'general' as const, label: 'Chung', icon: <SlidersHorizontal size={16} /> },
  { id: 'instructions' as const, label: 'Hướng dẫn', icon: <ScrollText size={16} /> },
  { id: 'skill' as const, label: 'Kỹ năng', icon: <Sparkles size={16} /> },
];

/** Worker create/edit. Remount (via key) to reset the draft. */
export function WorkerDialog({ open, worker, workspace, harnesses, onClose }: { open: boolean; worker?: Worker; workspace: Workspace; harnesses: HarnessInfo[]; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('general');
  // Faces other workers already show, so suggestions lean towards a different one.
  const takenMascots = workspace.workers.filter(item => item.id !== worker?.id).map(item => isMascot(item.avatar?.mascot) ? item.avatar.mascot : autoMascot(mascotIds, item.id, { name: item.name, description: item.description }));
  const [name, setName] = useState(worker?.name ?? '');
  const [instructions, setInstructions] = useState(worker?.instructions ?? defaultInstructions);
  const [provider, setProvider] = useState<Worker['provider']>(worker?.provider ?? 'demo');
  const [skillId, setSkill] = useState(worker?.skillId ?? workspace.skills[0].id);
  const [budget, setBudget] = useState(toAmount(worker?.taskBudgetMicros ?? 500_000));
  const [avatar, setAvatar] = useState(worker?.avatar ?? {});
  const [description, setDescription] = useState(worker?.description ?? '');
  // New workers get a stable colour seed before they have an id.
  const [seed] = useState(() => worker?.id ?? crypto.randomUUID());
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const paid = provider !== 'demo' && !isHarness(provider);
  const skill = workspace.skills.find(item => item.id === skillId);
  const fail = (at: Tab, message: string) => { setTab(at); setError(message); };

  const submit = async () => {
    if (!name.trim()) return fail('general', t('Nhập tên nhân viên.'));
    if (!instructions.trim()) return fail('instructions', t('Hướng dẫn không được để trống.'));
    const taskBudgetMicros = toMicros(budget);
    if (!Number.isFinite(taskBudgetMicros) || taskBudgetMicros < 0) return fail('general', t('Giới hạn mỗi task phải là số không âm.'));
    setBusy(true); setError('');
    try {
      await orglet.call('saveWorker', { ...(worker ? { id: worker.id } : {}), name, instructions, provider, skillId, taskBudgetMicros, ...(Object.keys(avatar).length ? { avatar } : {}), ...(description.trim() ? { description: description.trim() } : {}) });
      toast(worker ? t('Đã lưu nhân viên.') : t('Đã tạo nhân viên.')); onClose();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };

  return <TabbedFormDialog open={open} onClose={onClose} title={worker ? t('Thiết lập nhân viên') : t('Nhân viên mới')} tabs={tabs} tab={tab} onTab={next => { setTab(next); setError(''); }} panelId="worker-panel" description={tab === 'instructions' ? t('Mỗi lần lưu tạo một revision mới. Lần chạy cũ giữ nguyên hướng dẫn và kỹ năng đã dùng.') : tab === 'skill' ? t('Gói skill nhập từ thư mục cần được review trong Thư viện trước khi chọn.') : undefined} onSubmit={() => void submit()} submitLabel={t('Lưu nhân viên')} busy={busy}>
    {tab === 'general' && <>
      <div className="field"><span className="field-title"><FieldLabel icon={Smile}>{t('Avatar')}</FieldLabel></span><AvatarPicker name={name} seed={seed} hint={description} hints={{ skill: skill?.name, instructions: instructions === defaultInstructions ? undefined : instructions }} taken={takenMascots} savedColors={workspace.avatarColors} onSavedColorsChange={colors => void orglet.call('saveAvatarColors', { colors }).catch(error => toast(error instanceof Error ? error.message : String(error), 'error'))} value={avatar} onChange={setAvatar} badge={provider === 'demo' ? undefined : <ProviderMark provider={provider} size="small" decorative />} /></div>
      <label><FieldLabel icon={UserRound} required>{t('Tên nhân viên')}</FieldLabel><input value={name} onChange={event => setName(event.target.value)} maxLength={80} placeholder={t('Ví dụ: Data reviewer')} /></label>
      <label><FieldLabel icon={AlignLeft}>{t('Mô tả ngắn')}</FieldLabel><input value={description} onChange={event => setDescription(event.target.value)} maxLength={160} placeholder={t('Ví dụ: Đọc log và kiểm tra phần scoring')} /></label>
      <Select label={<FieldLabel icon={Cpu} required>Model</FieldLabel>} value={provider} onChange={value => setProvider(value as Worker['provider'])} options={[
        { value: 'demo', label: 'Demo', detail: t('không gọi API'), group: t('Thử nghiệm'), icon: <ProviderMark provider="demo" size="small" decorative /> },
        { value: 'openai', label: 'OpenAI', detail: 'GPT-4.1 mini', group: t('API trả phí'), icon: <ProviderMark provider="openai" size="small" decorative /> },
        { value: 'anthropic', label: 'Anthropic', detail: 'Claude Haiku 4.5', group: t('API trả phí'), icon: <ProviderMark provider="anthropic" size="small" decorative /> },
        ...(['claude-code', 'codex'] as const).map(id => {
          const found = harnesses.find(item => item.id === id);
          const detail = !found || found.status === 'not_installed' ? t('chưa cài')
            : found.status === 'detected' ? [found.version, t('đã thấy · chưa đăng nhập')].filter(Boolean).join(' · ')
            : found.status === 'auth_error' ? [found.version, t('lỗi đăng nhập')].filter(Boolean).join(' · ')
            : found.runnable ? [found.version, t('đã đăng nhập · sẵn sàng')].filter(Boolean).join(' · ')
            : [found.version, t('đã đăng nhập')].filter(Boolean).join(' · ');
          return { value: id, label: harnessNames[id], group: t('Harness trên máy'), detail, icon: <ProviderMark provider={id} size="small" decorative /> };
        }),
      ]} />
      {isHarness(provider) && <p className="muted">{t('Dùng bản {0} đã cài và tài khoản đang đăng nhập trên máy. {1} Chi phí tính theo gói của harness, không qua ngân sách Orglet.', [harnessNames[provider], provider === 'codex' ? t('Codex nhận nội dung nguồn văn bản trong prompt và không có tool đọc tệp hay chạy lệnh.') : t('Claude Code chỉ đọc bản sao nguồn của task, không chạy lệnh.')])}</p>}
      {paid && <label><FieldLabel icon={Wallet} required>{t('Giới hạn mỗi task')}</FieldLabel><MoneyInput type="number" min="0" step="any" value={budget} onChange={setBudget} /></label>}
    </>}
    {tab === 'instructions' && <>
      <textarea aria-label={t('Hướng dẫn')} aria-required="true" rows={12} value={instructions} onChange={event => setInstructions(event.target.value)} maxLength={16000} />
    </>}
    {tab === 'skill' && <>
      <Select ariaLabel={t('Kỹ năng')} value={skillId} onChange={setSkill} options={workspace.skills.map(item => { const pending = !!item.package && item.package.reviewedHash !== item.package.hash; return { value: item.id, label: item.name, detail: pending ? t('v{0} · Cần review trong Thư viện', [item.revision]) : `v${item.revision}`, icon: <Sparkles size={16} />, disabled: pending }; })} />
      {skill && <p className="prose muted">{skill.content}</p>}
    </>}
    {error && <p role="alert" className="error">{error}</p>}
  </TabbedFormDialog>;
}
