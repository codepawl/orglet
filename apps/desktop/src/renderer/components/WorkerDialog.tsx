import { useState } from 'react';
import { AlignLeft, Smile, Cpu, ScrollText, Sparkles, UserRound, Wallet, SlidersHorizontal } from 'lucide-react';
import type { Connections, Worker, Workspace } from '../../shared/contracts';
import { harnessNames, isHarness, type HarnessInfo } from '../../shared/harness';
import { FieldLabel, MoneyInput } from './ui';
import { Select } from './Select';
import { ProviderMark } from './ProviderMark';
import { AvatarPicker } from './Avatar';
import { isMascot, mascotIds } from './mascots';
import { autoMascot } from './mascotSuggest';
import { TabbedFormDialog } from './DialogTabs';
import { readiness } from './providers';
import { fieldInvalid } from './fieldInvalid';
import { toAmount, toMicros } from './money';
import { toast } from './toast';
import { t } from '../i18n';
import { orglet } from '../api';

const defaultInstructions = 'Work with the user like a helpful coworker: answer questions, talk things through and do what they ask. Keep replies clear and to the point. Write a formal report only when asked.';
type Tab = 'general' | 'instructions' | 'skill';
type InvalidField = 'name' | 'instructions' | 'budget';
const tabs = [
  { id: 'general' as const, label: 'Chung', icon: <SlidersHorizontal size={16} /> },
  { id: 'instructions' as const, label: 'Hướng dẫn', icon: <ScrollText size={16} /> },
  { id: 'skill' as const, label: 'Kỹ năng', icon: <Sparkles size={16} /> },
];

/** Worker create/edit. Remount (via key) to reset the draft. */
export function WorkerDialog({ open, worker, workspace, connections, harnesses, onClose }: { open: boolean; worker?: Worker; workspace: Workspace; connections: Connections; harnesses: HarnessInfo[]; onClose: () => void }) {
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
  const [invalid, setInvalid] = useState<InvalidField>();
  const [flash, setFlash] = useState(0);
  const ready = readiness(connections, harnesses);
  const paid = provider !== 'demo' && !isHarness(provider);
  const skill = workspace.skills.find(item => item.id === skillId);
  const clearError = () => { setError(''); setInvalid(undefined); };
  const fail = (at: Tab, message: string, field?: InvalidField) => {
    setTab(at); setError(message); setInvalid(field); setFlash(n => n + 1);
    if (field) setTimeout(() => (document.querySelector(`#worker-panel [data-field="${field}"]`) as HTMLElement | null)?.focus(), 0);
  };
  const unavailable = t('Chưa sẵn sàng');
  const modelOption = (value: Worker['provider'], label: string, detail: string, group: string, available: boolean) => ({
    value, label, detail, group, icon: <ProviderMark provider={value} size="small" decorative />,
    ...(available ? {} : { dimmed: true, badge: unavailable }),
  });

  const submit = async () => {
    if (!name.trim()) return fail('general', t('Nhập tên nhân viên.'), 'name');
    if (!instructions.trim()) return fail('instructions', t('Hướng dẫn không được để trống.'), 'instructions');
    const taskBudgetMicros = toMicros(budget);
    if (!Number.isFinite(taskBudgetMicros) || taskBudgetMicros < 0) return fail('general', t('Giới hạn mỗi task phải là số không âm.'), 'budget');
    setBusy(true); clearError();
    try {
      await orglet.call('saveWorker', { ...(worker ? { id: worker.id } : {}), name, instructions, provider, skillId, taskBudgetMicros, ...(Object.keys(avatar).length ? { avatar } : {}), ...(description.trim() ? { description: description.trim() } : {}) });
      toast(worker ? t('Đã lưu nhân viên.') : t('Đã tạo nhân viên.')); onClose();
    } catch (err) { setError((err as Error).message); setInvalid(undefined); } finally { setBusy(false); }
  };

  return <TabbedFormDialog open={open} onClose={onClose} title={worker ? t('Thiết lập nhân viên') : t('Nhân viên mới')} tabs={tabs} tab={tab} onTab={next => { setTab(next); clearError(); }} panelId="worker-panel" description={tab === 'instructions' ? t('Mỗi lần lưu tạo một revision mới. Lần chạy cũ giữ nguyên hướng dẫn và kỹ năng đã dùng.') : tab === 'skill' ? t('Gói skill nhập từ thư mục cần được review trong Thư viện trước khi chọn.') : undefined} onSubmit={() => void submit()} submitLabel={t('Lưu nhân viên')} busy={busy} error={error}>
    {tab === 'general' && <>
      <div className="field"><span className="field-title"><FieldLabel icon={Smile}>{t('Avatar')}</FieldLabel></span><AvatarPicker name={name} seed={seed} hint={description} hints={{ skill: skill?.name, instructions: instructions === defaultInstructions ? undefined : instructions }} taken={takenMascots} savedColors={workspace.avatarColors} onSavedColorsChange={colors => void orglet.call('saveAvatarColors', { colors }).catch(error => toast(error instanceof Error ? error.message : String(error), 'error'))} value={avatar} onChange={setAvatar} badge={provider === 'demo' ? undefined : <ProviderMark provider={provider} size="small" decorative />} /></div>
      <label><FieldLabel icon={UserRound} required>{t('Tên nhân viên')}</FieldLabel><input data-field="name" value={name} onChange={event => { setName(event.target.value); if (invalid === 'name') clearError(); }} maxLength={80} placeholder={t('Ví dụ: Data reviewer')} {...fieldInvalid(invalid === 'name', flash)} /></label>
      <label><FieldLabel icon={AlignLeft}>{t('Mô tả ngắn')}</FieldLabel><input value={description} onChange={event => setDescription(event.target.value)} maxLength={160} placeholder={t('Ví dụ: Đọc log và kiểm tra phần scoring')} /></label>
      <Select label={<FieldLabel icon={Cpu} required>Model</FieldLabel>} value={provider} onChange={value => setProvider(value as Worker['provider'])} options={[
        modelOption('demo', 'Demo', t('không gọi API'), t('Thử nghiệm'), true),
        modelOption('openai', 'OpenAI', 'GPT-4.1 mini', t('API trả phí'), ready.openai),
        modelOption('anthropic', 'Anthropic', 'Claude Haiku 4.5', t('API trả phí'), ready.anthropic),
        modelOption('xai', 'Grok', 'grok-3-mini', t('API trả phí'), ready.xai),
        ...(['claude-code', 'codex', 'cursor'] as const).filter(id => provider === id || harnesses.some(item => item.id === id)).map(id => {
          const found = harnesses.find(item => item.id === id);
          return modelOption(id, harnessNames[id], [found ? found.version : t('chưa tìm thấy'), found?.auth === 'logged_out' ? t('chưa đăng nhập') : ''].filter(Boolean).join(' · '), t('Harness trên máy'), ready[id]);
        }),
      ]} />
      {isHarness(provider) && <p className="muted">{t('Dùng bản {0} đã cài và tài khoản đang đăng nhập trên máy. {1} Chi phí tính theo gói của harness, không qua ngân sách Orglet.', [harnessNames[provider], provider === 'codex' ? t('Codex nhận nội dung nguồn văn bản trong prompt và không có tool đọc tệp hay chạy lệnh.') : provider === 'cursor' ? t('Cursor Agent chạy ở chế độ ask với sandbox; chỉ đọc bản sao nguồn của task, không dùng --force.') : t('Claude Code chỉ đọc bản sao nguồn của task, không chạy lệnh.')])}</p>}
      {paid && <label><FieldLabel icon={Wallet} required>{t('Giới hạn mỗi task')}</FieldLabel><MoneyInput data-field="budget" type="number" min="0" step="any" value={budget} onChange={value => { setBudget(value); if (invalid === 'budget') clearError(); }} invalid={invalid === 'budget'} flash={flash} /></label>}
    </>}
    {tab === 'instructions' && <>
      <textarea data-field="instructions" aria-label={t('Hướng dẫn')} aria-required="true" rows={12} value={instructions} onChange={event => { setInstructions(event.target.value); if (invalid === 'instructions') clearError(); }} maxLength={16000} {...fieldInvalid(invalid === 'instructions', flash)} />
    </>}
    {tab === 'skill' && <>
      <Select ariaLabel={t('Kỹ năng')} value={skillId} onChange={setSkill} options={workspace.skills.map(item => { const pending = !!item.package && item.package.reviewedHash !== item.package.hash; return { value: item.id, label: item.name, detail: pending ? t('v{0} · Cần review trong Thư viện', [item.revision]) : `v${item.revision}`, icon: <Sparkles size={16} />, disabled: pending }; })} />
      {skill && <p className="prose muted">{skill.content}</p>}
    </>}
  </TabbedFormDialog>;
}
