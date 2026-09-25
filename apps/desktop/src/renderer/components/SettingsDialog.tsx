import * as Dialog from '@radix-ui/react-dialog';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Check, Contrast, Database, Info, MessageSquare, Plug, SlidersHorizontal, SquareTerminal, Wallet, X, RefreshCw, ExternalLink, Monitor, Moon, Sun, FileKey, Download, ArchiveRestore, Copy, Palette, Pencil, UserPlus, Trash2, UserRound, Laptop } from 'lucide-react';
import { avatarPalette } from './Avatar';
import { DEFAULT_ACCENT_COLOR } from '../../shared/accent';
import { ColorPicker } from './ColorPicker';
import { AnchoredPopover } from './AnchoredPopover';
import { API_PROVIDER_NAMES, ApiProvider, isLocalApi, type Connections, type LogoColor, type ProviderScope, type Workspace } from '../../shared/contracts';
import { harnessCatalog, loginShellNames, SYSTEM_ACCOUNT_ID, tightestWindow, type HarnessAccountUsage, type HarnessInfo, type HarnessUsage, type LoginCommand, type LoginShell } from '../../shared/harness';
import { PlanUsage } from './PlanUsage';
import { bundledFont, CODE_FONT_SUGGESTIONS, FontFamily, fontStack, INTERFACE_FONT_SUGGESTIONS, INTERFACE_PREFERRED_FONTS, type FontRole } from '../../shared/fonts';
import { Button, PanelHeading, keepOpenForPopup } from './ui';
import { Select } from './Select';
import { CurrencyFlag } from './CurrencyFlag';
import { BudgetReconciliation } from './BudgetReconciliation';
import { formatMoney, moneySymbol, toAmount, toMicros } from './money';
import { currencies, CurrencyCode, usdCurrency } from '../../shared/currency';
import { ProviderMark } from './ProviderMark';
import { StatusMark, type StatusMarkState } from './StatusMark';
import { InfoTip } from './InfoTip';
import { RowMenu } from './RowMenu';
import { toast } from './toast';
import { confirmAction } from './confirm';
import { ERASE_CONFIRMATION, type EraseScope, type EraseSummary } from '../../shared/erase';
import { Switch } from './Switch';
import { CodeFontPreview, InterfaceFontSample } from './FontPreview';
import { AboutSettings } from './AboutSettings';
import { t, tMessage, translated } from '../i18n';
import { DEFAULT_LANGUAGE } from '../../shared/i18n';
import { orglet } from '../api';
import { CommandBlock, Skeleton, SkeletonGroup } from '@codepawl/orglet-ui';
import { dwellAbout, modelLists } from '../caches';
import { dwellHandlers } from '../prefetch';

/** Fake password dots for a saved key — never the real secret; renderer never reads keys back. */
const SAVED_KEY_MASK = '••••••••••••••••';

export type SettingsTab = 'general' | 'chat' | 'connections' | 'harness' | 'usage' | 'data' | 'about';
// Short sections, each a few rows (user, 2026-09-17: clearer, but not overwhelming). About sits last (COD-176).
const tabs: { id: SettingsTab; label: string; icon: ReactNode }[] = [
  { id: 'general', label: 'Chung', icon: <SlidersHorizontal size={16} /> },
  { id: 'chat', label: 'Cuộc trò chuyện', icon: <MessageSquare size={16} /> },
  { id: 'connections', label: 'Kết nối API', icon: <Plug size={16} /> },
  { id: 'harness', label: 'Harness trên máy', icon: <SquareTerminal size={16} /> },
  { id: 'usage', label: 'Chi phí & giới hạn', icon: <Wallet size={16} /> },
  { id: 'data', label: 'Dữ liệu', icon: <Database size={16} /> },
  { id: 'about', label: 'Giới thiệu', icon: <Info size={16} /> },
];
// Section notes sit under the section title.
/** What each saved setting is called, so a "Đã lưu" notice can say which one it was (COD-174). Same words as the rows. */
const settingNames = translated({
  language: 'Ngôn ngữ', theme: 'Giao diện', accentColor: 'Màu nhấn', logoColor: 'Màu logo', interfaceFont: 'Phông chữ', codeFont: 'Phông chữ code',
  autoTitles: 'Tự đặt tên cuộc trò chuyện', copyFormat: 'Định dạng khi sao chép', downloadFormat: 'Định dạng khi tải xuống', confirmOpenTask: 'Hỏi trước khi mở công việc',
  archiveRetentionDays: 'Tự xóa mục đã lưu trữ', connectionLimitMicros: 'Giới hạn mỗi connection / tháng', providerConcurrency: 'Request đồng thời mỗi provider', providerConsent: 'Provider được phép',
  autoUpdate: 'Tự động cập nhật',
});
const eraseNames: Record<EraseScope, string> = translated({ chats: 'Xóa lịch sử trò chuyện', knowledge: 'Xóa kiến thức', memory: 'Xóa ghi nhớ', sources: 'Xóa nguồn đã nhập', everything: 'Xóa toàn bộ dữ liệu' });

const sectionLabels: Partial<Record<SettingsTab, string>> = {
  connections: 'Key được mã hóa trên máy này và không vào bản sao lưu.',
  harness: 'Đăng nhập lỗi thì Orglet dừng lại, không chuyển sang Demo.',
  usage: 'Chỉ tính request qua Orglet; harness trên máy dùng gói riêng.',
};

/** Who is signed in and on which plan, as one line: "an@example.com · ChatGPT Plus". */
const accountLine = (usage: HarnessAccountUsage) => [usage.email, usage.plan].filter(Boolean).join(' · ');

/** An account in the picker: its address and how much of the allowance closest to its limit is used. */
function accountSummary(usage: HarnessAccountUsage | undefined): string | undefined {
  if (!usage) return undefined;
  if (usage.unavailable === 'signed_out') return t('Chưa đăng nhập');
  const tightest = tightestWindow(usage);
  if (!tightest) return usage.email;
  const used = t('đã dùng {0}%', [Math.round(tightest.usedPercent)]);
  return usage.email ? `${usage.email} · ${used}` : used;
}

/** Why a signed-in account shows no allowance. Signed out says nothing here: the login command below already does. */
function usageGapText(item: HarnessInfo, usage: HarnessAccountUsage): string | undefined {
  if (usage.unavailable === 'unsupported') return unreportedUsageText(item);
  if (usage.unavailable === 'expired') return t('Phiên đăng nhập đã hết hạn. Mở {0} một lần rồi bấm Dò lại.', [item.name]);
  if (usage.unavailable === 'failed') return t('Chưa đọc được hạn mức lúc này.');
  return undefined;
}

/** Cursor Agent and Gemini CLI never report a plan allowance; for the others it depends on how they signed in. */
function unreportedUsageText(item: HarnessInfo): string {
  if (item.id === 'cursor') return t('Cursor Agent không cho biết gói đã dùng bao nhiêu.');
  if (item.id === 'gemini') return t('Gemini CLI không cho biết gói đã dùng bao nhiêu.');
  return t('Kiểu đăng nhập này không có hạn mức gói.');
}

/** What to do in the terminal once the login command runs. Gemini CLI has no login command, so it names the menu choice. */
function signInStep(item: HarnessInfo): string {
  if (item.id === 'gemini') return t('Chạy lệnh bên dưới, chọn Sign in with Google, đăng nhập xong gõ /quit rồi bấm Dò lại.');
  return t('Chạy lệnh bên dưới trong terminal rồi bấm Dò lại.');
}

/**
 * Which account of one harness runs. An account is a folder the CLI signs in to, so switching is a folder swap:
 * the status, the version and the login command above all follow the account picked here. Adding one selects it,
 * so the login command shown next is the one that signs into it. Each option names the address signed in to it
 * and how much of its plan is used, so switching to the one with room is a choice made on sight.
 */
function HarnessAccountPicker({ item, usage, busy, onSelect, onSave, onRemove }: {
  item: HarnessInfo; usage?: HarnessAccountUsage[]; busy: boolean;
  onSelect: (id: string) => void; onSave: (id: string | undefined, label: string) => void; onRemove: (id: string) => void;
}) {
  const summaryOf = (accountId: string) => accountSummary(usage?.find(row => row.accountId === accountId));
  const row = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<{ id?: string; label: string }>();
  const active = item.accounts.find(account => account.id === item.accountId);
  const close = () => setEditing(undefined);
  const submit = () => {
    const label = editing?.label.trim();
    if (!label) return;
    onSave(editing?.id, label);
    close();
  };
  return <div className="harness-account" ref={row}>
    <Select size="sm" className="harness-account-select" ariaLabel={t('Tài khoản {0}', [item.name])} value={item.accountId} disabled={busy}
      menuMinWidth={320} showDetail={false}
      onChange={onSelect}
      options={[
        { value: SYSTEM_ACCOUNT_ID, label: t('Tài khoản mặc định'), detail: summaryOf(SYSTEM_ACCOUNT_ID) ?? t('Đã đăng nhập sẵn'), icon: <Laptop size={16} /> },
        ...item.accounts.map(account => ({ value: account.id, label: account.label, detail: summaryOf(account.id), icon: <UserRound size={16} /> })),
      ]} />
    {/* Where the CLI lives and which folder this account signs in from: detail behind the "i", not a line in the row. */}
    {(item.executable || item.configDir) && <InfoTip label={t('Chi tiết tài khoản')} rows={[
      ...(item.executable ? [{ label: t('Chương trình'), value: item.executable, mono: true, onCopy: () => void copyText(item.executable) }] : []),
      ...(item.configDir ? [{ label: t('Thư mục đăng nhập'), value: item.configDir, mono: true, onCopy: () => void copyText(item.configDir!) }] : []),
    ]} />}
    <RowMenu label={t('Tài khoản {0}', [item.name])} items={[
      { label: t('Thêm tài khoản'), icon: UserPlus, onSelect: () => setEditing({ label: '' }) },
      ...(active ? [
        { label: t('Đổi tên'), icon: Pencil, onSelect: () => setEditing({ id: active.id, label: active.label }) },
        {
          label: t('Xóa tài khoản'), icon: Trash2, danger: true,
          confirm: { question: t('Xóa tài khoản này cùng phần đăng nhập đã lưu trong thư mục của nó?'), label: t('Xóa') },
          onSelect: () => onRemove(active.id),
        },
      ] : []),
    ]} />
    <AnchoredPopover anchor={row} open={Boolean(editing)} onClose={close} label={editing?.id ? t('Đổi tên tài khoản') : t('Thêm tài khoản')}>
      <form className="harness-account-form" onSubmit={event => { event.preventDefault(); submit(); }}>
        <input autoFocus value={editing?.label ?? ''} maxLength={60} disabled={busy}
          aria-label={t('Tên tài khoản')} placeholder={t('Ví dụ: Tài khoản công ty')}
          onChange={event => setEditing(current => current && { ...current, label: event.target.value })} />
        <Button type="submit" variant="outline" disabled={busy || !editing?.label.trim()}>{t('Lưu')}</Button>
      </form>
    </AnchoredPopover>
  </div>;
}

/**
 * `document.fonts.check` answers "would this render", which is true for any name because a fallback always matches.
 * Measuring is the only way to learn whether the machine really has a family: draw the same text in the family with
 * a generic fallback behind it, and see whether the width moved.
 */
function fontInstalled(family: string): boolean {
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return false;
  const sample = 'mmmmmmmmmmlliwWQ';
  return ['monospace', 'sans-serif', 'serif'].some(generic => {
    context.font = `72px ${generic}`;
    const plain = context.measureText(sample).width;
    context.font = `72px "${family}", ${generic}`;
    return context.measureText(sample).width !== plain;
  });
}

/** Value of the "type your own" option. `FontFamily` refuses underscores, so no real family can collide with it. */
const CUSTOM_FONT = '__custom__';

/**
 * One font choice. The bundled font is the first option and the default; the rest are families this machine
 * actually has, plus whatever the person typed. Every option is drawn in the font it names, so the list is the
 * preview, and the sample below the pair shows the two together once picked.
 */
function FontSetting({ role, title, description, value, busy, onPick }: {
  role: FontRole; title: string; description: string; value?: string; busy: boolean; onPick: (family: string | null) => void;
}) {
  const row = useRef<HTMLDivElement>(null);
  const [typing, setTyping] = useState<string>();
  const suggestions = role === 'interface' ? INTERFACE_FONT_SUGGESTIONS : CODE_FONT_SUGGESTIONS;
  const [installed, setInstalled] = useState<string[]>([]);
  const [hasSfPro, setHasSfPro] = useState(false);
  useEffect(() => {
    let live = true;
    void document.fonts.ready.then(() => {
      if (!live) return;
      setInstalled(suggestions.filter(fontInstalled));
      setHasSfPro(role === 'interface' && INTERFACE_PREFERRED_FONTS.some(fontInstalled));
    });
    return () => { live = false; };
  }, [suggestions, role]);
  const bundled = bundledFont(role);
  // The default row names what this machine actually draws (owner, 2026-09-25): SF Pro where it is installed,
  // otherwise the bundled face. SF Pro is never offered on a machine without it, and Inter gets a row of its own
  // only when SF Pro is the default.
  const defaultLabel = hasSfPro ? 'SF Pro' : bundled;
  const bundledChoice = hasSfPro ? [bundled] : [];
  const otherInstalled = installed.filter(family => !INTERFACE_PREFERRED_FONTS.includes(family) && family !== bundled);
  const keptPick = value && value !== bundled ? [value] : [];
  const families = [...new Set([...bundledChoice, ...otherInstalled, ...keptPick])];
  const submit = () => {
    const family = FontFamily.safeParse(typing);
    if (!family.success) return;
    onPick(family.data);
    setTyping(undefined);
  };
  return <div ref={row}>
    <Row title={title} description={description}>
      <Select ariaLabel={title} className="setting-select" menuMinWidth={240} disabled={busy} value={value ?? ''}
        onChange={next => { if (next === CUSTOM_FONT) setTyping(value ?? ''); else onPick(next || null); }}
        options={[
          { value: '', label: defaultLabel, note: t('mặc định'), labelStyle: { fontFamily: fontStack(role) } },
          ...families.map(family => ({ value: family, label: family, labelStyle: { fontFamily: `"${family}"` } })),
          { value: CUSTOM_FONT, label: t('Phông khác…'), icon: <Pencil size={15} /> },
        ]} />
    </Row>
    <AnchoredPopover anchor={row} open={typing !== undefined} onClose={() => setTyping(undefined)} label={t('Phông khác')}>
      <form className="font-custom-form" onSubmit={event => { event.preventDefault(); submit(); }}>
        <input autoFocus value={typing ?? ''} maxLength={64} disabled={busy}
          aria-label={t('Tên phông chữ')} placeholder={role === 'interface' ? 'Inter Tight' : 'Fira Code'}
          onChange={event => setTyping(event.target.value)} />
        <Button type="submit" variant="outline" disabled={busy || !FontFamily.safeParse(typing).success}>{t('Dùng phông này')}</Button>
      </form>
    </AnchoredPopover>
  </div>;
}

/**
 * One deletion. Three of them ask a plain yes/no; the full erase asks the person to type the app's name in a
 * popover beside its own row, because it is the one that cannot be undone from inside Orglet.
 *
 * The row says only what goes (COD-221); what stays, and what the deletion cannot undo, is the `caveat`, read
 * at the moment it matters: in the confirm question.
 */
function EraseRow({ scope, title, description, caveat, question, busy, onErase }: {
  scope: EraseScope; title: string; description: string; caveat: string; question: string; busy: boolean;
  onErase: (scope: EraseScope, confirm?: string) => void;
}) {
  const row = useRef<HTMLDivElement>(null);
  const [typed, setTyped] = useState<string>();
  const total = scope === 'everything';
  const start = async () => {
    if (total) { setTyped(''); return; }
    if (await confirmAction({ title: question, description: caveat, confirmLabel: t('Xóa') })) onErase(scope);
  };
  return <div ref={row}>
    <Row title={title} description={description}>
      <Button variant="outline" className="danger" disabled={busy} onClick={() => void start()}><Trash2 size={14} />{t('Xóa')}</Button>
    </Row>
    <AnchoredPopover anchor={row} open={typed !== undefined} onClose={() => setTyped(undefined)} label={question}>
      <form className="erase-form" onSubmit={event => {
        event.preventDefault();
        if (typed !== ERASE_CONFIRMATION) return;
        setTyped(undefined);
        onErase(scope, ERASE_CONFIRMATION);
      }}>
        <p className="erase-caveat">{caveat}</p>
        <label htmlFor="erase-confirm">{t('Gõ {0} để xác nhận. Không hoàn tác được.', [ERASE_CONFIRMATION])}</label>
        <div>
          <input id="erase-confirm" autoFocus value={typed ?? ''} maxLength={20} disabled={busy} autoComplete="off" spellCheck={false}
            onChange={event => setTyped(event.target.value)} />
          <Button type="submit" variant="outline" className="danger" disabled={busy || typed !== ERASE_CONFIRMATION}>{t('Xóa toàn bộ')}</Button>
        </div>
      </form>
    </AnchoredPopover>
  </div>;
}

function Row({ title, description, children, id }: { title: string; description?: ReactNode; children?: ReactNode; id?: string }) {
  return <div className="setting-row">
    <div className="setting-text"><span id={id} className="setting-title">{title}</span>{description && <span className="setting-description">{description}</span>}</div>
    {children && <div className="setting-control">{children}</div>}
  </div>;
}

/**
 * A harness state, as the circle the rest of the app already uses for a state plus one short phrase. The phrase is
 * one thing, not two joined by a dot: what the row can do right now. Whether it is installed and whether it is
 * signed in are the lines underneath, so the state does not repeat them (user, 2026-09-22).
 */
function statusPill(item: HarnessInfo): { className: string; label: string; mark: StatusMarkState } {
  if (item.status === 'not_installed') return { className: 'not_installed', label: t('Chưa cài'), mark: { variant: 'empty', tone: 'muted' } };
  if (item.status === 'detected') return { className: 'logged_out', label: t('Chưa đăng nhập'), mark: { variant: 'dashed', tone: 'muted' } };
  if (item.status === 'auth_error') return { className: 'auth_error', label: t('Lỗi đăng nhập'), mark: { variant: 'dashed', tone: 'error' } };
  if (item.runnable) return { className: 'logged_in', label: t('Sẵn sàng'), mark: { variant: 'filled', tone: 'success' } };
  return { className: 'logged_in', label: t('Đã đăng nhập'), mark: { variant: 'empty', tone: 'success' } };
}

/**
 * The clipboard is written in the main process. This window is served from `file://`, where Chromium answers
 * `navigator.clipboard.writeText` with `NotAllowedError: Write permission denied`, so the button had never once
 * copied anything (user, 2026-09-20); the `execCommand` fallback behind it was deprecated and no more reliable.
 */
async function copyCommand(command: string) {
  try {
    await orglet.copyText(command);
    toast(t('Đã sao chép lệnh'), 'success', command);
  } catch {
    toast(t('Không sao chép được lệnh'), 'error', command);
  }
}

/** A path or value from a detail popover, through the same main-process clipboard as the commands. */
async function copyText(value: string) {
  try {
    await orglet.copyText(value);
    toast(t('Đã sao chép'), 'success', value);
  } catch {
    toast(t('Không sao chép được'), 'error', value);
  }
}

/** The terminal the person picked for login commands (COD-230): UI chrome, so localStorage. */
const loginShellKey = 'orglet.login-shell';
function readLoginShell(): LoginShell | undefined {
  try { return (localStorage.getItem(loginShellKey) as LoginShell | null) ?? undefined; } catch { return undefined; }
}
function rememberLoginShell(shell: LoginShell) {
  try { localStorage.setItem(loginShellKey, shell); } catch { /* a blocked store only forgets the choice */ }
}

/**
 * The login line for the terminal the person uses. PowerShell, Command Prompt and Git Bash each need their own form
 * on Windows. The terminal picker sits in the command card's top bar, small and borderless in the card's own colour
 * (user, 2026-09-25), and the choice is remembered for every row.
 */
function LoginCommandCopy({ commands, label }: { commands: LoginCommand[]; label: string }) {
  const [shell, setShell] = useState(readLoginShell);
  const current = commands.find(item => item.shell === shell) ?? commands[0];
  if (!current) return null;
  // The trigger is a small chip, so the menu gets its own width rather than the chip's.
  const picker = commands.length > 1 && <Select size="sm" className="login-shell-select" ariaLabel={t('Chọn terminal')} value={current.shell} showDetail={false} menuMinWidth={220}
    onChange={next => { setShell(next as LoginShell); rememberLoginShell(next as LoginShell); }}
    options={commands.map(item => ({ value: item.shell, label: loginShellNames[item.shell], icon: <SquareTerminal size={15} /> }))} />;
  return <CommandCopy command={current.command} label={label} picker={picker || undefined} />;
}

/** A command to paste, from the kit's `CommandBlock`, copied through the main process. */
function CommandCopy({ command, label, picker }: { command: string; label: string; picker?: ReactNode }) {
  return <CommandBlock command={command} label={label} toolbar={picker} copyLabel={t('Sao chép lệnh')} copyIcon={<Copy size={14} />} onCopy={next => void copyCommand(next)} />;
}


/** `harnesses` is undefined until the first detection lands, which runs each CLI and takes seconds on a cold start. */
type Props = { open: boolean; tab: SettingsTab; onTab: (tab: SettingsTab) => void; onClose: () => void; workspace: Workspace; connections: Connections; onConnections: (next: Connections) => void; harnesses: HarnessInfo[] | undefined; onHarnesses: (next: HarnessInfo[]) => void };

/** The shape of the three harness rows before detection has said what they are: never "not found" while it is still looking. */
function HarnessRowShapes() {
  return <SkeletonGroup label={t('Đang dò harness trên máy…')}>
    {harnessCatalog.map((id, index) => <div key={id} className="setting-row harness-row">
      <ProviderMark provider={id} />
      <div className="setting-text">
        <Skeleton width="38%" delay={index * 0.06} />
        <Skeleton width="72%" delay={index * 0.06 + 0.04} />
      </div>
    </div>)}
  </SkeletonGroup>;
}

export function SettingsDialog({ open, tab, onTab, onClose, workspace, connections, onConnections, harnesses, onHarnesses }: Props) {
  const [busy, setBusy] = useState(false);
  // Dò lại keeps the last rows on screen and says it is looking again beside the button, rather than clearing them.
  const [detecting, setDetecting] = useState(false);
  /** Plan usage per harness account; undefined until the first read lands. Read only while the Harness tab is open. */
  const [usage, setUsage] = useState<HarnessUsage>();
  const loadUsage = useCallback(async (refresh: boolean) => {
    try {
      setUsage(await orglet.call('harnessUsage', { refresh }));
    } catch {
      setUsage({});
    }
  }, []);
  const readsUsage = open && tab === 'harness' && harnesses !== undefined;
  useEffect(() => { if (readsUsage) void loadUsage(false); }, [readsUsage, loadUsage]);
  const detectAgain = () => void act(async () => {
    setDetecting(true);
    try { onHarnesses(await orglet.call('harnesses', { refresh: true })); }
    finally { setDetecting(false); }
    // Usage goes over the network, so the rows come back first and the bars follow.
    void loadUsage(true);
    // The core dropped the harness model lists with the detection; the session copies follow.
    modelLists.invalidate();
    return t('Đã dò lại harness');
  }, t('Harness trên máy'));
  /** A connection that changed makes the session's model lists for it wrong; the core already dropped its own. */
  const changeConnections = (next: Connections) => { modelLists.invalidate(); onConnections(next); };
  const [keyDrafts, setKeyDrafts] = useState<Partial<Record<ApiProvider, string>>>({});
  /** Providers the user opened for editing before a key is saved. Saved connections stay “on” from `connections`. */
  const [editing, setEditing] = useState<Partial<Record<ApiProvider, boolean>>>({});
  /** Cleared mask so the user can type a replacement without ever reading the real key back. */
  const [replacing, setReplacing] = useState<Partial<Record<ApiProvider, boolean>>>({});
  const currency = workspace.currency ?? usdCurrency;
  /** The accent's own picker, opened from the swatch row so a colour outside the palette is still reachable. */
  const [colorPanel, setColorPanel] = useState(false);
  const customColorButton = useRef<HTMLButtonElement>(null);
  const closeColorPanel = useCallback(() => setColorPanel(false), []);
  const accent = workspace.accentColor ?? DEFAULT_ACCENT_COLOR;
  const customAccent = !avatarPalette.some(color => color.toLowerCase() === accent.toLowerCase());
  const [limit, setLimit] = useState(toAmount(workspace.connectionLimitMicros));
  const [limitError, setLimitError] = useState('');
  const savedLimit = useRef(workspace.connectionLimitMicros);
  useEffect(() => { if (!open) { setLimitError(''); setLimit(toAmount(workspace.connectionLimitMicros)); setKeyDrafts({}); setEditing({}); setReplacing({}); } }, [open, workspace.connectionLimitMicros, currency.code, currency.rate]);

  /** A budget reservation is named by the chat it belongs to, the way the reconciliation list names it. */
  const reservationName = (reservationId: string) => {
    const reservation = workspace.budgetReservations.find(item => item.id === reservationId);
    const task = workspace.tasks.find(item => item.id === reservation?.taskId);
    return task?.title || task?.brief.split('\n')[0] || reservation?.taskId;
  };
  /** Runs one change and toasts its outcome; `about` names the setting or provider it concerned, for the notice centre. */
  const act = async (action: () => Promise<string | void>, about?: string) => {
    setBusy(true);
    try { const text = await action(); if (text) toast(text, 'success', about); }
    catch (err) { toast((err as Error).message, 'error', about); }
    finally { setBusy(false); }
  };
  // Settings apply as soon as they change; the command always carries the full current set.
  const save = (patch: Partial<{ language: Workspace['language']; theme: Workspace['theme']; autoTitles: boolean; copyFormat: Workspace['copyFormat']; downloadFormat: Workspace['downloadFormat']; confirmOpenTask: boolean; archiveRetentionDays: Workspace['archiveRetentionDays']; connectionLimitMicros: number; providerConcurrency: number; providerConsent: ProviderScope[]; accentColor: string; logoColor: LogoColor; interfaceFont: string | null; codeFont: string | null; autoUpdate: boolean }>) => act(async () => {
    await orglet.call('settings', { language: workspace.language ?? DEFAULT_LANGUAGE, theme: workspace.theme, autoTitles: workspace.autoTitles, copyFormat: workspace.copyFormat, downloadFormat: workspace.downloadFormat, confirmOpenTask: workspace.confirmOpenTask, archiveRetentionDays: workspace.archiveRetentionDays, connectionLimitMicros: workspace.connectionLimitMicros, providerConcurrency: workspace.providerConcurrency, providerConsent: workspace.providerConsent ?? [], accentColor: workspace.accentColor, logoColor: workspace.logoColor, autoUpdate: workspace.autoUpdate, ...patch });
    return t('Đã lưu');
  }, Object.keys(patch).map(key => settingNames[key as keyof typeof settingNames]).filter(Boolean).join(', '));
  const eraseMessage = (summary: EraseSummary) => {
    if (summary.scope === 'everything') return t('Đã xóa toàn bộ dữ liệu. Orglet trở lại như mới cài.');
    if (summary.scope === 'knowledge') return t('Đã xóa {0} mục kiến thức.', [summary.knowledge]);
    if (summary.scope === 'memory') return t('Đã xóa {0} ghi nhớ.', [summary.memory]);
    if (summary.scope === 'chats') return t('Đã xóa {0} cuộc trò chuyện.', [summary.chats]);
    return summary.sourcesForgotten
      ? t('Đã xóa {0} nguồn, thu hồi {1} nguồn còn được trò chuyện nhắc tới.', [summary.sources, summary.sourcesForgotten])
      : t('Đã xóa {0} nguồn.', [summary.sources]);
  };
  const erase = (scope: EraseScope, confirm?: string) => void act(async () =>
    eraseMessage(await orglet.call('eraseData', { scope, ...(confirm ? { confirm } : {}) })), eraseNames[scope]);
  const commitLimit = () => {
    const micros = toMicros(limit);
    if (!Number.isFinite(micros) || micros < 1000 || micros > 1_000_000_000) { setLimitError(t('Nhập từ {0} đến {1}.', [formatMoney(1000), formatMoney(1_000_000_000)])); return; }
    setLimitError('');
    if (micros !== savedLimit.current) { savedLimit.current = micros; void save({ connectionLimitMicros: micros }); }
  };
  const current = tabs.find(item => item.id === tab)!;

  return <Dialog.Root open={open} onOpenChange={value => { if (!value) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="modal-overlay" />
      <Dialog.Content className="settings-dialog" aria-describedby={undefined} onEscapeKeyDown={keepOpenForPopup}>
        <div className="settings-header"><Dialog.Title>{t('Cài đặt')}</Dialog.Title><Dialog.Close asChild><Button size="icon" aria-label={t('Đóng cài đặt')}><X size={18} /></Button></Dialog.Close></div>
        <div className="settings-body">
          <nav className="settings-tabs" role="tablist" aria-orientation="vertical" aria-label={t('Mục cài đặt')} onKeyDown={event => {
            if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
            event.preventDefault();
            const index = tabs.findIndex(item => item.id === tab);
            const next = tabs[(index + (event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
            onTab(next.id); document.getElementById(`settings-tab-${next.id}`)?.focus();
          }}>
            {/* The About tab reads the build, the updater and the release list; resting on its tab fetches them ahead of the click. */}
            {tabs.map(item => <button key={item.id} id={`settings-tab-${item.id}`} type="button" role="tab" aria-selected={tab === item.id} aria-controls="settings-panel" tabIndex={tab === item.id ? 0 : -1} onClick={() => onTab(item.id)} {...(item.id === 'about' ? dwellHandlers(dwellAbout) : {})}>{item.icon}<span>{t(item.label)}</span></button>)}
          </nav>
          <section className="settings-panel" id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${tab}`}>
            <PanelHeading title={t(current.label)} description={sectionLabels[tab] ? t(sectionLabels[tab]) : undefined}>{tab === 'harness' && <>
              {/* The button says it is checking instead of a line beside it, so the heading never reflows while it runs. */}
              <Button disabled={busy || harnesses === undefined} onClick={detectAgain} aria-live="polite" data-checking={detecting || undefined}><RefreshCw size={13} /><span className="steady-label"><span aria-hidden={detecting}>{t('Dò lại')}</span><span aria-hidden={!detecting}>{t('Đang dò lại…')}</span></span></Button>
            </>}</PanelHeading>

            {tab === 'general' && <>
              <Row title={t('Ngôn ngữ')} description={t('Áp dụng cho toàn bộ giao diện và thông báo.')}>
                <Select ariaLabel={t('Ngôn ngữ')} className="setting-select" value={workspace.language ?? DEFAULT_LANGUAGE} disabled={busy} onChange={value => void save({ language: value as Workspace['language'] })} options={[{ value: 'en', label: 'English (US)', icon: <CurrencyFlag code="USD" /> }, { value: 'en-GB', label: 'English (UK)', icon: <CurrencyFlag code="GBP" /> }, { value: 'vi', label: 'Tiếng Việt', icon: <CurrencyFlag code="VND" /> }]} />
              </Row>
              <Row title={t('Giao diện')} description={t('Sáng, tối, hoặc đi theo Windows.')}>
                <Select ariaLabel={t('Giao diện')} className="setting-select" value={workspace.theme} disabled={busy} onChange={value => void save({ theme: value as Workspace['theme'] })} options={[{ value: 'system', label: t('Theo hệ thống'), icon: <Monitor size={16} /> }, { value: 'light', label: t('Sáng'), icon: <Sun size={16} /> }, { value: 'dark', label: t('Tối'), icon: <Moon size={16} /> }]} />
              </Row>
              <Row title={t('Màu nhấn')} description={t('Dùng cho thẻ @tên, nút chính và công tắc đang bật.')}>
                <div className="setting-swatches" role="radiogroup" aria-label={t('Màu nhấn')}>
                  {avatarPalette.map(color => {
                    const checked = accent.toLowerCase() === color.toLowerCase();
                    return <button key={color} type="button" role="radio" aria-checked={checked} tabIndex={checked ? 0 : -1} disabled={busy}
                      className="avatar-swatch" style={{ '--avatar-color': color } as CSSProperties} aria-label={color} title={color}
                      onClick={() => void save({ accentColor: color })}>{checked && <Check size={12} strokeWidth={3} aria-hidden="true" />}</button>;
                  })}
                  {/* A swatch like its neighbours: a colour wheel with a pencil, or the custom accent itself once one is chosen. */}
                  <button ref={customColorButton} type="button" className="avatar-swatch accent-swatch-custom" data-custom={customAccent || undefined}
                    style={customAccent ? { '--avatar-color': accent } as CSSProperties : undefined}
                    aria-label={customAccent ? t('Màu tùy chỉnh {0}, chỉnh sửa', [accent]) : t('Chọn màu khác')} title={customAccent ? accent : t('Chọn màu khác')}
                    aria-haspopup="dialog" aria-expanded={colorPanel} aria-pressed={customAccent} disabled={busy} onClick={() => setColorPanel(open => !open)}>
                    <Pencil size={11} strokeWidth={2.75} aria-hidden="true" />
                  </button>
                </div>
              </Row>
              <AnchoredPopover anchor={customColorButton} open={colorPanel} onClose={closeColorPanel} label={t('Tạo màu')}>
                <ColorPicker id="accent-colors" value={accent} presets={avatarPalette} saved={workspace.avatarColors ?? []}
                  onChange={color => void save({ accentColor: color })}
                  onSave={color => void act(async () => { await orglet.call('saveAvatarColors', { colors: [...new Set([...(workspace.avatarColors ?? []), color])] }); }, t('Màu đã lưu'))}
                  onRemove={color => void act(async () => { await orglet.call('saveAvatarColors', { colors: (workspace.avatarColors ?? []).filter(item => item !== color) }); }, t('Màu đã lưu'))}
                  onClose={closeColorPanel} />
              </AnchoredPopover>
              <Row title={t('Màu logo')} description={t('Logo trong ứng dụng: màu chữ, hoặc màu nhấn bạn chọn.')}>
                <Select ariaLabel={t('Màu logo')} className="setting-select" value={workspace.logoColor ?? 'mono'} disabled={busy} onChange={value => void save({ logoColor: value as LogoColor })} options={[{ value: 'mono', label: t('Đơn sắc'), icon: <Contrast size={16} /> }, { value: 'accent', label: t('Theo màu nhấn'), icon: <Palette size={16} /> }]} />
              </Row>
              <FontSetting role="interface" busy={busy} value={workspace.interfaceFont}
                title={t('Phông chữ')} description={t('Dùng cho toàn bộ chữ trong app.')}
                onPick={family => void save({ interfaceFont: family })} />
              <InterfaceFontSample />
              <FontSetting role="code" busy={busy} value={workspace.codeFont}
                title={t('Phông chữ code')} description={t('Dùng cho code, đường dẫn và các giá trị kỹ thuật.')}
                onPick={family => void save({ codeFont: family })} />
              <CodeFontPreview />
            </>}

            {tab === 'chat' && <>
              <Row id="auto-title-label" title={t('Tự đặt tên cuộc trò chuyện')} description={t('Đặt tên sau câu trả lời đầu; tên bạn tự đổi được giữ.')}>
                <Switch checked={workspace.autoTitles} disabled={busy} labelledBy="auto-title-label" onChange={value => void save({ autoTitles: value })} />
              </Row>
              <Row title={t('Định dạng khi sao chép')} description={t('Chọn sẵn để bấm một lần là sao chép, không hiện menu.')}>
                <Select ariaLabel={t('Định dạng khi sao chép')} className="setting-select" value={workspace.copyFormat} disabled={busy} onChange={value => void save({ copyFormat: value as Workspace['copyFormat'] })} options={[{ value: 'ask', label: t('Luôn hỏi') }, { value: 'text', label: t('Văn bản thuần') }, { value: 'markdown', label: 'Markdown' }]} />
              </Row>
              <Row title={t('Định dạng khi tải xuống')} description={t('Chọn sẵn để bấm một lần là tải, không hiện menu.')}>
                <Select ariaLabel={t('Định dạng khi tải xuống')} className="setting-select" value={workspace.downloadFormat} disabled={busy} onChange={value => void save({ downloadFormat: value as Workspace['downloadFormat'] })} options={[{ value: 'ask', label: t('Luôn hỏi') }, { value: 'text', label: t('Văn bản (.txt)') }, { value: 'markdown', label: 'Markdown (.md)' }]} />
              </Row>
              <Row title={t('Tự xóa mục đã lưu trữ')} description={t('Cuộc trò chuyện, Tí và hội; số liệu chi phí được giữ.')}>
                <Select ariaLabel={t('Tự xóa mục đã lưu trữ')} className="setting-select" value={String(workspace.archiveRetentionDays)} disabled={busy} onChange={value => void save({ archiveRetentionDays: Number(value) as Workspace['archiveRetentionDays'] })} options={[{ value: '7', label: t('Sau 7 ngày') }, { value: '30', label: t('Sau 30 ngày') }, { value: '0', label: t('Không tự xóa') }]} />
              </Row>
              <Row title={t('Request đồng thời mỗi provider')} description={t('Vượt giới hạn thì bước đó xếp hàng chờ, chưa trừ ngân sách.')}>
                <Select ariaLabel={t('Request đồng thời mỗi provider')} className="setting-select" value={String(workspace.providerConcurrency)} disabled={busy} onChange={value => void save({ providerConcurrency: Number(value) })} options={[1, 2, 3, 4].map(value => ({ value: String(value), label: `${value} request`, detail: value === 1 ? t('tuần tự') : undefined }))} />
              </Row>
            </>}

            {tab === 'connections' && <>
              {ApiProvider.options.map(provider => {
                const name = API_PROVIDER_NAMES[provider];
                const local = isLocalApi(provider);
                const draft = keyDrafts[provider] ?? '';
                const active = connections[provider] || !!editing[provider];
                const showMask = !!connections[provider] && !draft && !replacing[provider];
                const titleId = `${provider}-connection-title`;
                return <div key={provider} role="region" aria-label={t('Kết nối {0}', [name])} className={`setting-row setting-connection${active ? '' : ' inactive'}`}>
                  <ProviderMark provider={provider} />
                  <div className="setting-text">
                    <span id={titleId} className="setting-title">{local ? name : `${name} API`}</span>
                    <span className="setting-description">{local
                      ? (connections[provider] ? t('Đã bật Ollama tại 127.0.0.1:11434') : t('Tắt · bật công tắc nếu Ollama đang chạy trên máy này'))
                      : active
                        ? (connections[provider] ? t('Đã lưu API key') : t('Nhập key để kích hoạt'))
                        : t('Tắt · bật công tắc để nhập key')} · <button type="button" className="text-link" disabled={busy} onClick={() => void act(async () => { await orglet.openPricing(provider); }, name)}>{local ? t('Tài liệu') : provider === 'opencode-go' ? t('Giá và hạn mức gói') : t('Bảng giá')}<ExternalLink size={12} aria-hidden="true" /></button></span>
                  </div>
                  <div className="setting-control">
                    <Switch checked={active} disabled={busy} labelledBy={titleId} onChange={on => {
                      if (local) {
                        void act(async () => {
                          changeConnections(on ? await orglet.connect('ollama') : await orglet.disconnect('ollama'));
                          return on ? t('Đã bật Ollama') : t('Đã ngắt {0}', [name]);
                        }, name);
                        return;
                      }
                      if (on) {
                        setEditing(current => ({ ...current, [provider]: true }));
                        return;
                      }
                      setKeyDrafts(current => ({ ...current, [provider]: '' }));
                      setEditing(current => ({ ...current, [provider]: false }));
                      setReplacing(current => ({ ...current, [provider]: false }));
                      if (connections[provider]) {
                        void act(async () => {
                          changeConnections(await orglet.disconnect(provider));
                          return t('Đã ngắt {0}', [name]);
                        }, name);
                      }
                    }} />
                  </div>
                  {/* A key is long and this row is narrow, so the field takes a line of its own below the
                      switch rather than sharing the text column with it (user, 2026-09-20). */}
                    {active && !local && <form className="setting-key-form" onSubmit={event => {
                      event.preventDefault();
                      const key = draft.trim();
                      if (!key || key === SAVED_KEY_MASK) return;
                      void act(async () => {
                        changeConnections(await orglet.connect(provider, key));
                        setKeyDrafts(current => ({ ...current, [provider]: '' }));
                        setEditing(current => ({ ...current, [provider]: false }));
                        setReplacing(current => ({ ...current, [provider]: false }));
                        return t('Đã lưu API key {0}', [name]);
                      }, name);
                    }}>
                      <Button type="button" size="icon" variant="ghost" className="setting-key-file" disabled={busy} aria-label={t('Từ tệp')} onClick={() => void act(async () => {
                        const next = await orglet.connect(provider);
                        changeConnections(next);
                        if (next[provider]) {
                          setKeyDrafts(current => ({ ...current, [provider]: '' }));
                          setEditing(current => ({ ...current, [provider]: false }));
                          setReplacing(current => ({ ...current, [provider]: false }));
                          return t('Đã lưu API key {0}', [name]);
                        }
                      }, name)}><FileKey size={15} /></Button>
                      <input type="password" name={`${provider}-api-key`} autoComplete="off" spellCheck={false} disabled={busy} value={showMask ? SAVED_KEY_MASK : draft} placeholder={connections[provider] ? t('Nhập key mới để thay') : t('Dán hoặc nhập API key')} aria-label={t('API key {0}', [name])} onFocus={() => { if (connections[provider] && !draft) setReplacing(current => ({ ...current, [provider]: true })); }} onBlur={() => { if (!draft) setReplacing(current => ({ ...current, [provider]: false })); }} onChange={event => setKeyDrafts(current => ({ ...current, [provider]: event.target.value }))} />
                      <Button type="submit" variant="outline" disabled={busy || !draft.trim()}>{t('Lưu key')}</Button>
                    </form>}
                </div>;
              })}
            </>}

            {tab === 'harness' && <>
              <div role="region" aria-label={t('Harness trên máy')}>
                {harnesses === undefined && <HarnessRowShapes />}
                {(harnesses ?? []).map(item => {
                  const pill = statusPill(item);
                  const showLogin = item.status !== 'signed_in';
                  const accountUsage = usage?.[item.id]?.find(row => row.accountId === item.accountId);
                  const signedInAs = !showLogin && accountUsage?.email ? accountLine(accountUsage) : undefined;
                  const usageGap = !showLogin && accountUsage ? usageGapText(item, accountUsage) : undefined;
                  /** An account change re-detects in the core and drops its usage copy; the bars are read again after. */
                  const changeAccount = async (change: () => Promise<HarnessInfo[]>) => {
                    onHarnesses(await change());
                    void loadUsage(false);
                  };
                  return <div key={item.id} className="setting-row harness-row">
                    <ProviderMark provider={item.id} />
                    <div className="setting-text">
                      {/* The mark, the name and the state read as one line, so the eye does not have to travel
                          down the row to learn whether this harness is usable (user, 2026-09-19). */}
                      <span className="harness-head">
                        {/* The version rides on the name's line: a line of its own only pushed the row down. */}
                        <span className="setting-title"><span>{item.name}</span>{item.version && <span className="harness-version">{item.version}</span>}{!item.runnable && <span className="badge">{t('Chỉ trạng thái')}</span>}</span>
                        <span className={`status-pill ${pill.className}`}><StatusMark variant={pill.mark.variant} tone={pill.mark.tone} label={pill.label} decorative />{pill.label}</span>
                      </span>
                      {/* Signed in, the account itself says more than "signed in through claude.ai". */}
                      {/* Found but signed out, the state says so and the command follows: one short line points at it. */}
                      <span className="setting-description">{signedInAs ?? (item.status === 'detected' ? signInStep(item) : tMessage(item.authDetail))}</span>
                      {!showLogin && usage === undefined && <SkeletonGroup label={t('Đang đọc hạn mức gói…')}>
                        <div className="plan-usage"><Skeleton width="70%" /></div>
                      </SkeletonGroup>}
                      {!showLogin && accountUsage && <PlanUsage windows={accountUsage.windows} label={t('Hạn mức gói {0}', [item.name])} />}
                      {usageGap && <span className="setting-description">{usageGap}</span>}
                      {/* A harness that cannot hold accounts still shows where it lives; the others keep it behind the "i". */}
                      {item.executable && !item.runnable ? <span className="setting-path" title={item.executable}>{item.executable}</span> : null}
                      {item.runnable && <HarnessAccountPicker item={item} usage={usage?.[item.id]} busy={busy}
                        onSelect={id => void act(async () => {
                          await changeAccount(() => orglet.call('selectHarnessAccount', { harness: item.id, id }));
                          return t('Đã đổi tài khoản {0}', [item.name]);
                        }, item.name)}
                        onSave={(id, label) => void act(async () => {
                          await changeAccount(() => orglet.call('saveHarnessAccount', { harness: item.id, ...(id ? { id } : {}), label }));
                          return id ? t('Đã đổi tên tài khoản') : t('Đã thêm tài khoản {0}. Đăng nhập bằng lệnh bên dưới.', [label]);
                        }, item.name)}
                        onRemove={id => void act(async () => {
                          await changeAccount(() => orglet.call('removeHarnessAccount', { harness: item.id, id }));
                          return t('Đã xóa tài khoản');
                        }, item.name)} />}
                      {((item.status === 'not_installed' && item.installCommand) || showLogin) && <div className="harness-commands">
                        {item.status === 'not_installed' && item.installCommand && <CommandCopy command={item.installCommand} label={t('Lệnh cài (tài liệu chính thức)')} />}
                        {showLogin && <LoginCommandCopy commands={item.loginCommands} label={item.status === 'not_installed' ? t('Sau khi cài, đăng nhập bằng') : t('Lệnh đăng nhập')} />}
                      </div>}
                    </div>
                  </div>;
                })}
                {harnesses !== undefined && !harnesses.length && <Row title={t('Chưa tìm thấy Claude Code, Codex, Cursor Agent hoặc Gemini CLI trên máy này.')} description={t('Cài một harness rồi bấm Dò lại.')} />}
              </div>
            </>}

            {tab === 'usage' && <>
              <Row title={t('Đã đối soát')} description={t('Phần provider đã chốt số và tính tiền.')}><span className="setting-value">{formatMoney(workspace.usage.chargedMicros)}</span></Row>
              <Row title={t('Đang giữ chỗ')} description={workspace.usage.uncertainCount > 0 ? <span className="error">{t('{0} request chưa rõ chi phí, vẫn được tính vào giới hạn.', [workspace.usage.uncertainCount])}</span> : t('Request đang chạy hoặc chưa rõ chi phí.')}><span className="setting-value">{formatMoney(workspace.usage.reservedMicros)}</span></Row>
              <Row id="limit-label" title={t('Giới hạn mỗi connection / tháng')} description={limitError ? <span className="error" id="limit-error">{limitError}</span> : t('Tháng tính theo UTC. Áp dụng riêng cho từng API provider.')}>
                <span className={`money-input ${limitError ? 'invalid' : ''}`}><span aria-hidden>{moneySymbol()}</span><input aria-labelledby="limit-label" aria-invalid={Boolean(limitError)} aria-describedby={limitError ? 'limit-error' : undefined} inputMode="decimal" value={limit} disabled={busy} onChange={event => setLimit(event.target.value)} onBlur={commitLimit} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commitLimit(); } }} /></span>
              </Row>
              <Row title={t('Tiền tệ')} description={currency.code === 'USD' ? t('Chi phí được lưu bằng USD theo giá của provider.') : t('1 USD = {0} {1}{2}. Chi phí vẫn lưu bằng USD, chỉ quy đổi khi hiển thị.', [new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 4 }).format(currency.rate), currency.code, currency.updatedAt ? t(' · cập nhật {0}', [new Date(currency.updatedAt).toLocaleString('vi-VN')]) : ''])}>
                <Select ariaLabel={t('Tiền tệ')} className="setting-select" inlineDetail menuMinWidth={270} value={currency.code} disabled={busy} onChange={value => void act(async () => { await orglet.call('setCurrency', { code: CurrencyCode.parse(value) }); return value === 'USD' ? t('Đã đổi sang USD.') : t('Đã đổi sang {0} theo tỷ giá mới nhất.', [value]); }, t('Tiền tệ'))} options={(Object.keys(currencies) as CurrencyCode[]).map(code => ({ value: code, label: code, detail: t(currencies[code]), icon: <CurrencyFlag code={code} /> }))} />
              </Row>
              {currency.code !== 'USD' && <Row title={t('Tỷ giá')} description={currency.error ? <span className="error">{t('{0} Đang dùng tỷ giá gần nhất.', [currency.error])}</span> : t('Mỗi 12 giờ từ open.er-api.com, không gửi dữ liệu của bạn.')}>
                <Button disabled={busy} onClick={() => void act(async () => { await orglet.call('refreshCurrency', {}); return t('Đã cập nhật tỷ giá'); }, t('Tỷ giá'))}><RefreshCw size={14} />{t('Cập nhật')}</Button>
              </Row>}
              <BudgetReconciliation workspace={workspace} busy={busy} onReconcile={async (reservationId, amountMicros, source) => {
                setBusy(true);
                try {
                  await orglet.call('reconcileBudget', { reservationId, amountMicros, source });
                  toast(t('Đã lưu đối soát ngân sách.'), 'success', reservationName(reservationId));
                } catch (error) {
                  toast((error as Error).message, 'error', reservationName(reservationId));
                  throw error;
                } finally {
                  setBusy(false);
                }
              }} />
            </>}

            {tab === 'data' && <>
              <Row title={t('Sao lưu')} description={t('Lưu Tí, hội và cuộc trò chuyện vào một tệp.')}>
                <Button variant="outline" disabled={busy} onClick={() => void act(async () => (await orglet.backup()) ? t('Đã lưu bản sao lưu') : undefined, t('Sao lưu'))}><Download size={14} />{t('Lưu bản sao lưu')}</Button>
              </Row>
              <Row title={t('Khôi phục')} description={t('Thêm các mục còn thiếu từ một bản sao lưu.')}>
                <Button variant="outline" disabled={busy} onClick={() => void act(async () => (await orglet.restore()) ? t('Đã khôi phục các mục còn thiếu') : undefined, t('Khôi phục từ tệp'))}><ArchiveRestore size={14} />{t('Khôi phục từ tệp')}</Button>
              </Row>
              <EraseRow busy={busy} scope="chats" onErase={erase}
                title={t('Xóa lịch sử trò chuyện')}
                description={t('Xóa mọi cuộc trò chuyện và báo cáo.')}
                caveat={t('Tí, hội, skill và kiến thức được giữ lại. Số liệu chi phí được giữ.')}
                question={t('Xóa mọi cuộc trò chuyện và báo cáo?')} />
              <EraseRow busy={busy} scope="knowledge" onErase={erase}
                title={t('Xóa kiến thức')}
                description={t('Xóa mọi kiến thức, kể cả đề xuất đang chờ.')}
                caveat={t('Kể cả đề xuất đang chờ duyệt. Ghi nhớ của các Tí được giữ lại.')}
                question={t('Xóa toàn bộ kiến thức đã tích lũy?')} />
              <EraseRow busy={busy} scope="memory" onErase={erase}
                title={t('Xóa ghi nhớ')}
                description={t('Xóa mọi ghi nhớ của các Tí.')}
                caveat={t('Ở mọi phạm vi, kể cả ghi nhớ đang chờ duyệt. Kiến thức bạn viết hoặc duyệt được giữ lại.')}
                question={t('Xóa mọi ghi nhớ của các Tí?')} />
              <EraseRow busy={busy} scope="sources" onErase={erase}
                title={t('Xóa nguồn đã nhập')}
                description={t('Quên mọi tệp đã nhập; tệp gốc trên máy không đổi.')}
                caveat={t('Tệp gốc trên máy không đổi. Nguồn còn được một cuộc trò chuyện nhắc tới chỉ bị thu hồi quyền đọc, để cuộc trò chuyện đó vẫn mở được.')}
                question={t('Quên mọi tệp nguồn đã nhập?')} />
              <EraseRow busy={busy} scope="everything" onErase={erase}
                title={t('Xóa toàn bộ dữ liệu')}
                description={t('Đưa Orglet về như mới cài.')}
                caveat={t('Mọi trò chuyện, Tí, hội, skill, lịch, nguồn, kiến thức, ghi nhớ và cài đặt. API key được giữ lại.')}
                question={t('Xóa sạch mọi thứ trong Orglet?')} />
              <Row title={t('Nơi lưu dữ liệu')} description={t('Mọi thứ nằm trên máy này. Không có tài khoản Orglet.')} />
            </>}

            {tab === 'about' && <AboutSettings workspace={workspace} busy={busy} act={act} onAutoUpdate={value => void save({ autoUpdate: value })} />}
          </section>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
