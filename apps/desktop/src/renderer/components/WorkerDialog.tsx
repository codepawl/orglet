import { useEffect, useState, type ReactNode } from 'react';
import { AlignLeft, Brain, Smile, Cpu, ScrollText, ShieldCheck, Sparkles, UserRound, Wallet, SlidersHorizontal } from 'lucide-react';
import { isMemory } from '../../shared/knowledge';
import { MemoryList } from './Memories';
import { isPaidApi, type Connections, type Worker, type Workspace } from '../../shared/contracts';
import { CATALOG_HINT_IDS } from '../../shared/models';
import { baseUrlHost, connectionPricing, customProviderId, findCustomConnection, type CustomConnection } from '../../shared/custom-connections';
import { pricingLabel } from '../customConnections';
import { liveWorkerTask, newChatKey } from '../../shared/live-task';
import { permissionsForLevel, type WorkspaceLevel } from '../../shared/capability-status';
import { snapshotCapabilities, type ToolCapability } from '../../shared/tool-policy';
import type { NewChatWorkspaceView, WorkspaceGrantView } from '../../shared/workspace-access';
import { harnessCatalog, harnessNames, isHarness, type HarnessInfo } from '../../shared/harness';
import { FieldLabel, MoneyInput } from './ui';
import { Select } from './Select';
import { ModelPicker } from './ModelPicker';
import { ProviderMark } from './ProviderMark';
import { StatusMark } from './StatusMark';
import { AvatarPicker } from './Avatar';
import { isMascot, mascotIds } from './mascots';
import { autoMascot } from './mascotSuggest';
import { TabbedFormDialog } from './DialogTabs';
import { readiness } from './providers';
import { openCodeModelIssue } from './openCodeModel';
import { PermissionControls } from './PermissionControls';
import { toAmount, toMicros } from './money';
import { toast } from './toast';
import { t, tMessage } from '../i18n';
import { orglet } from '../api';
import { Input, SwitchField, Textarea } from '@codepawl/orglet-ui';
import { taskGrants } from '../caches';
import { Zap } from 'lucide-react';

const defaultInstructions = 'Work with the user like a helpful coworker: answer questions, talk things through and do what they ask. Keep replies clear and to the point. Write a formal report only when asked.';
type Tab = 'general' | 'skill' | 'permissions' | 'memory';
type InvalidField = 'name' | 'instructions' | 'budget' | 'modelId';
const tabs = [
  { id: 'general' as const, label: 'Chung', icon: <SlidersHorizontal size={16} /> },
  { id: 'skill' as const, label: 'Kỹ năng', icon: <Sparkles size={16} /> },
  { id: 'permissions' as const, label: 'Quyền', icon: <ShieldCheck size={16} /> },
  { id: 'memory' as const, label: 'Ghi nhớ', icon: <Brain size={16} /> },
];

/** How this connection's requests are charged, beside its model picker. */
function customConnectionCostNote(connection: CustomConnection): string {
  const pricing = connectionPricing(connection);
  if (pricing.kind === 'local') return t('Máy chủ trên máy này hoặc mạng nội bộ: tính miễn phí. Nhập giá trong Cài đặt nếu bạn muốn tính khác.');
  if (pricing.kind === 'entered') return t('Tính theo giá bạn nhập: giữ chỗ trước mỗi request, chốt theo số token thật.');
  return t('Orglet không biết giá của kết nối này: mỗi request giữ chỗ phần còn lại của giới hạn mỗi task cho tới khi bạn nhập chi phí thật trong Cài đặt → Chi phí & giới hạn.');
}

/** Worker create/edit. Remount (via key) to reset the draft. */
export function WorkerDialog({ open, worker, workspace, connections, harnesses, initialTab, onClose, onOpenChat }: { open: boolean; worker?: Worker; workspace: Workspace; connections: Connections; harnesses: HarnessInfo[]; /** The tab to open on; the trace above an answer opens straight onto Memory (COD-220). */ initialTab?: Tab; onClose: () => void; /** Opens the chat a memory came from; the dialog closes first. */ onOpenChat: (taskId: string) => void }) {
  const [tab, setTab] = useState<Tab>(initialTab ?? 'general');
  // Faces other workers already show, so suggestions lean towards a different one.
  const takenMascots = workspace.workers.filter(item => item.id !== worker?.id).map(item => isMascot(item.avatar?.mascot) ? item.avatar.mascot : autoMascot(mascotIds, item.id, { name: item.name, description: item.description }));
  const [name, setName] = useState(worker?.name ?? '');
  const [instructions, setInstructions] = useState(worker?.instructions ?? defaultInstructions);
  const [provider, setProvider] = useState<Worker['provider']>(worker?.provider ?? 'demo');
  const [modelId, setModelId] = useState(worker?.modelId ?? '');
  const [skillId, setSkill] = useState(worker?.skillId ?? workspace.skills[0].id);
  const [budget, setBudget] = useState(toAmount(worker?.taskBudgetMicros ?? 500_000));
  const [avatar, setAvatar] = useState(worker?.avatar ?? {});
  const [description, setDescription] = useState(worker?.description ?? '');
  // Saved with the worker, like its other fields; off for every worker until the person turns it on (COD-199).
  const [autoApplyProposals, setAutoApplyProposals] = useState(worker?.autoApplyProposals ?? false);
  // New workers get a stable colour seed before they have an id.
  const [seed] = useState(() => worker?.id ?? crypto.randomUUID());
  // Permissions chosen for a worker that is not saved yet; they reach the core once the worker has an id.
  const [draftCapabilities, setDraftCapabilities] = useState<ToolCapability[]>();
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState<InvalidField>();
  const [flash, setFlash] = useState(0);
  const ready = readiness(connections, harnesses, workspace.customConnections);
  const customConnection = findCustomConnection(workspace.customConnections, provider);
  const paid = isPaidApi(provider);
  // Claude Code is the one harness that takes a spending cap, so its chat's limit is set here too.
  const capped = paid || provider === 'claude-code';
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
    if (!name.trim()) return fail('general', t('Nhập tên Tí.'), 'name');
    if (!instructions.trim()) return fail('general', t('Hướng dẫn không được để trống.'), 'instructions');
    const taskBudgetMicros = toMicros(budget);
    if (!Number.isFinite(taskBudgetMicros) || taskBudgetMicros < 0) return fail('general', t('Giới hạn mỗi task phải là số không âm.'), 'budget');
    const trimmedModel = modelId.trim();
    if (trimmedModel.length > 200) return fail('general', t('ID model tối đa 200 ký tự.'), 'modelId');
    const modelIssue = openCodeModelIssue(provider, trimmedModel);
    if (modelIssue) return fail('general', modelIssue, 'modelId');
    // A custom connection has no default model to fall back on.
    if (customConnection && !trimmedModel) return fail('general', t('Chọn hoặc gõ ID model cho {0}.', [customConnection.name]), 'modelId');
    setBusy(true); clearError();
    try {
      const saved = await orglet.call('saveWorker', { ...(worker ? { id: worker.id } : {}), name, instructions, provider, skillId, taskBudgetMicros, ...(Object.keys(avatar).length ? { avatar } : {}), ...(description.trim() ? { description: description.trim() } : {}), ...(provider !== 'demo' && trimmedModel ? { modelId: trimmedModel } : {}), ...(autoApplyProposals ? { autoApplyProposals: true } : {}) });
      if (!worker && draftCapabilities) await orglet.call('setToolCapabilities', { workerId: saved.id, capabilities: draftCapabilities });
      toast(worker ? t('Đã lưu Tí') : t('Đã tạo Tí'), 'success', name); onClose();
    } catch (err) { setError((err as Error).message); setInvalid(undefined); } finally { setBusy(false); }
  };

  // What this worker remembered for itself, newest first; team and workspace memories live in Thư viện → Knowledge.
  const memories = worker ? workspace.knowledge.filter(item => isMemory(item) && item.status !== 'archived' && item.scope.type === 'worker' && item.scope.id === worker.id).sort((first, second) => second.createdAt.localeCompare(first.createdAt)) : [];

  return <TabbedFormDialog open={open} onClose={onClose} title={worker ? t('Thiết lập Tí') : t('Tí mới')} tabs={tabs} tab={tab} onTab={next => { setTab(next); clearError(); }} panelId="worker-panel" description={tab === 'skill' ? t('Gói nhập từ thư mục cần review trong Thư viện trước.') : tab === 'permissions' ? t('Cho chat riêng của Tí; chat hội có quyền riêng.') : tab === 'memory' ? t('Điều Tí mang theo giữa các cuộc trò chuyện.') : undefined} onSubmit={() => void submit()} submitLabel={t('Lưu Tí')} busy={busy} error={error}>
    {tab === 'general' && <>
      <div className="field"><span className="field-title"><FieldLabel icon={Smile}>{t('Avatar')}</FieldLabel></span><AvatarPicker name={name} seed={seed} hint={description} hints={{ skill: skill?.name, instructions: instructions === defaultInstructions ? undefined : instructions }} taken={takenMascots} savedColors={workspace.avatarColors} onSavedColorsChange={colors => void orglet.call('saveAvatarColors', { colors }).catch(error => toast(error instanceof Error ? error.message : String(error), 'error', t('Màu avatar đã lưu')))} value={avatar} onChange={setAvatar} badge={provider === 'demo' ? undefined : <ProviderMark provider={provider} size="small" decorative />} /></div>
      <label><FieldLabel icon={UserRound} required>{t('Tên Tí')}</FieldLabel><Input data-field="name" value={name} onChange={event => { setName(event.target.value); if (invalid === 'name') clearError(); }} maxLength={80} placeholder={t('Ví dụ: Data reviewer')} invalid={invalid === 'name'} flash={flash} /></label>
      <label><FieldLabel icon={AlignLeft}>{t('Mô tả ngắn')}</FieldLabel><Input value={description} onChange={event => setDescription(event.target.value)} maxLength={160} placeholder={t('Ví dụ: Đọc log và kiểm tra phần scoring')} /></label>
      <label><FieldLabel icon={ScrollText} required>{t('Hướng dẫn')}</FieldLabel><Textarea data-field="instructions" rows={6} value={instructions} onChange={event => { setInstructions(event.target.value); if (invalid === 'instructions') clearError(); }} maxLength={16000} invalid={invalid === 'instructions'} flash={flash} /></label>
      {worker && <p className="muted">{t('Lần chạy cũ giữ nguyên hướng dẫn và kỹ năng đã dùng.')}</p>}
      <Select label={<FieldLabel icon={Cpu} required>Model</FieldLabel>} value={provider} onChange={value => { const next = value as Worker['provider']; setProvider(next); if (next !== provider) setModelId(''); }} options={[
        modelOption('demo', 'Demo', t('không gọi API'), t('Thử nghiệm'), true),
        modelOption('openai', 'OpenAI', t('gợi ý {0}', [CATALOG_HINT_IDS.openai]), t('API trả phí'), ready.openai),
        modelOption('anthropic', 'Anthropic', t('gợi ý {0}', [CATALOG_HINT_IDS.anthropic]), t('API trả phí'), ready.anthropic),
        modelOption('xai', 'Grok', t('gợi ý {0}', [CATALOG_HINT_IDS.xai]), t('API trả phí'), ready.xai),
        modelOption('openrouter', 'OpenRouter', t('gợi ý {0}', [CATALOG_HINT_IDS.openrouter]), t('API trả phí'), ready.openrouter),
        modelOption('opencode-zen', 'OpenCode Zen', t('trả theo mức dùng'), t('API trả phí'), ready['opencode-zen']),
        modelOption('opencode-go', 'OpenCode Go', t('gói đăng ký có hạn mức'), t('API theo gói'), ready['opencode-go']),
        modelOption('ollama', 'Ollama', t('gợi ý {0}', [CATALOG_HINT_IDS.ollama]), t('Local trên máy này'), ready.ollama),
        // Connections the person added in Settings (COD-242), under the name they gave each one.
        ...workspace.customConnections.map(connection => modelOption(customProviderId(connection.id), connection.name, `${baseUrlHost(connection.baseUrl)} · ${pricingLabel(connection)}`, t('Kết nối tùy chỉnh'), true)),
        // A harness carries its state as the circle the rest of the app uses for one, so the line underneath is the
        // version and one phrase rather than three things strung together on dots (user, 2026-09-22). The circle is
        // more exact than the generic "not ready" badge it stands in for: it tells missing from signed out from broken.
        ...harnessCatalog.map(id => {
          const found = harnesses.find(item => item.id === id);
          const state = !found || found.status === 'not_installed' ? { word: t('chưa cài'), mark: { variant: 'empty', tone: 'muted' } as const }
            : found.status === 'detected' ? { word: t('chưa đăng nhập'), mark: { variant: 'dashed', tone: 'muted' } as const }
            : found.status === 'auth_error' ? { word: t('lỗi đăng nhập'), mark: { variant: 'dashed', tone: 'error' } as const }
            : found.runnable ? { word: t('sẵn sàng'), mark: { variant: 'filled', tone: 'success' } as const }
            : { word: t('đã đăng nhập'), mark: { variant: 'empty', tone: 'success' } as const };
          const detail = [found?.version, state.word].filter(Boolean).join(' · ');
          return {
            ...modelOption(id, harnessNames[id], detail, t('Harness trên máy'), ready[id]),
            badge: <StatusMark variant={state.mark.variant} tone={state.mark.tone} label={state.word} decorative />,
          };
        }),
      ]} />
      {provider !== 'demo' && <ModelPicker provider={provider} value={modelId} onChange={value => { setModelId(value); if (invalid === 'modelId') clearError(); }} invalid={invalid === 'modelId'} flash={flash} />}
      {isHarness(provider) && <p className="muted">{t('Chạy bằng {0} trên máy, tính theo gói của nó, không qua ngân sách Orglet.', [harnessNames[provider]])}</p>}
      {provider === 'ollama' && <p className="muted">{t('Chạy Ollama tại 127.0.0.1:11434; không tính vào ngân sách Orglet.')}</p>}
      {provider === 'opencode-zen' && <p className="muted">{t('Zen trừ số dư theo từng request; Orglet không theo dõi hay giới hạn khoản này.')}</p>}
      {customConnection && <p className="muted">{customConnectionCostNote(customConnection)}</p>}
      {provider === 'opencode-go' && <p className="muted">{t('Tính vào hạn mức gói Go, không qua ngân sách Orglet. Bật Use balance thì phần vượt trừ vào số dư Zen.')}</p>}
      {capped && <label><FieldLabel icon={Wallet} required>{t('Giới hạn mỗi task')}</FieldLabel><MoneyInput data-field="budget" type="number" min="0" step="any" value={budget} onChange={value => { setBudget(value); if (invalid === 'budget') clearError(); }} invalid={invalid === 'budget'} flash={flash} /></label>}
    </>}
    {tab === 'skill' && <>
      <Select ariaLabel={t('Kỹ năng')} value={skillId} onChange={setSkill} options={workspace.skills.map(item => { const pending = !!item.package && item.package.reviewedHash !== item.package.hash; return { value: item.id, label: item.name, detail: pending ? t('v{0} · Cần review trong Thư viện', [item.revision]) : `v${item.revision}`, icon: <Sparkles size={16} />, disabled: pending }; })} />
      {skill && <p className="prose muted">{skill.content}</p>}
    </>}
    {tab === 'permissions' && <>
      {/* Auto-apply is not a chat permission: it belongs to the orglet and is saved with it. It still sits in the
          same list, under Propose app changes, because that is the switch it extends (owner, 2026-09-25: a separate
          block left a gap and read as unrelated). What it never covers (a raised limit, a template, a run that read
          unvetted content) is decided in the core and summed up as "the rest". */}
      <WorkerChatPermissions worker={worker} workspace={workspace} draft={{ id: worker?.id ?? seed, name: name || t('Tí mới'), provider, connected: provider === 'demo' || ready[provider] }}
        draftCapabilities={draftCapabilities} onDraftCapabilities={setDraftCapabilities}
        extra={<SwitchField checked={autoApplyProposals} onChange={setAutoApplyProposals}
          description={t('Đề xuất an toàn áp dụng ngay, có Hoàn tác; phần còn lại vẫn chờ bạn.')}>
          <Zap size={15} aria-hidden="true" />{t('Áp dụng thay đổi trong app mà không cần hỏi')}
        </SwitchField>} />
    </>}
    {tab === 'memory' && <MemoryList memories={memories} workspace={workspace} onOpenChat={onOpenChat} />}
  </TabbedFormDialog>;
}

/**
 * The permissions of this worker's own chat, changed in place the way Details changes them. Permissions live on the
 * chat; before its first message the switches set what that chat will start with (kept under the worker in the
 * core, or in the dialog's draft while the worker has no id yet, COD-178) and the folder waits under the worker
 * until the first message turns it into a grant (COD-186). A worker not saved yet has nothing to keep a folder
 * under, so only then does the folder wait.
 */
function WorkerChatPermissions({ worker, workspace, draft, draftCapabilities, onDraftCapabilities, extra }: {
  worker?: Worker; workspace: Workspace; draft: { id: string; name: string; provider: Worker['provider']; connected: boolean };
  draftCapabilities?: ToolCapability[]; onDraftCapabilities: (capabilities: ToolCapability[]) => void; extra?: ReactNode;
}) {
  const chat = worker ? liveWorkerTask(workspace.tasks, worker.id) : undefined;
  const pending = worker && !chat ? workspace.newChatCapabilities[newChatKey({ workerId: worker.id })] : undefined;
  const [capabilities, setCapabilities] = useState(chat ? chat.toolCapabilities : worker ? pending : draftCapabilities);
  // The grant a hover on the worker's row already fetched is drawn first (COD-218); the fresh copy replaces it.
  const [grant, setGrant] = useState<WorkspaceGrantView | null | undefined>(chat ? taskGrants.get(chat.id) : null);
  const [pendingFolder, setPendingFolder] = useState<NewChatWorkspaceView | undefined>(worker && !chat ? workspace.newChatWorkspace[newChatKey({ workerId: worker.id })] : undefined);
  const [busy, setBusy] = useState(false);
  const readGrant = async (taskId: string) => setGrant(await taskGrants.refresh(taskId));
  useEffect(() => {
    if (!chat) return;
    void readGrant(chat.id).catch(error => toast(tMessage(String(error)), 'error', t('Quyền của {0}', [draft.name])));
  }, [chat?.id]);
  const change = (perform: () => Promise<void>) => {
    setBusy(true);
    void perform().catch(error => toast(tMessage(String(error)), 'error', t('Quyền của {0}', [draft.name]))).finally(() => setBusy(false));
  };
  const onCapability = (capability: ToolCapability, enabled: boolean) => change(async () => {
    const next = (capabilities ?? snapshotCapabilities(draft.provider)).filter(item => item !== capability);
    if (enabled) next.push(capability);
    if (chat) await orglet.call('setToolCapabilities', { taskId: chat.id, capabilities: next });
    else if (worker) await orglet.call('setToolCapabilities', { workerId: worker.id, capabilities: next });
    else onDraftCapabilities(next);
    setCapabilities(next);
  });
  const onWorkspace = (level: WorkspaceLevel) => change(async () => {
    if (chat) {
      if (level === 'none') await orglet.call('revokeWorkspace', { taskId: chat.id });
      else await orglet.pickWorkspace(chat.id, permissionsForLevel(level));
      await readGrant(chat.id);
      return;
    }
    if (!worker) return;
    if (level === 'none') {
      await orglet.call('revokeWorkspace', { workerId: worker.id });
      setPendingFolder(undefined);
      return;
    }
    const picked = await orglet.pickNewChatWorkspace({ workerId: worker.id }, permissionsForLevel(level));
    if (picked) setPendingFolder(picked);
  });
  return <PermissionControls workers={[draft]} capabilities={capabilities} grant={grant} pending={pendingFolder} taskId={chat?.id} sourceCount={chat?.sourceIds.length ?? 0}
    busy={busy} folderLocked={chat || worker ? undefined : t('Lưu Tí rồi chọn thư mục.')} onCapability={onCapability} onWorkspace={onWorkspace} extra={extra} />;
}
