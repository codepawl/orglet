import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Check, Contrast, Database, MessageSquare, Plug, SlidersHorizontal, SquareTerminal, Wallet, X, RefreshCw, ExternalLink, Monitor, Moon, Sun, FileKey, Download, ArchiveRestore, Copy, Palette } from 'lucide-react';
import { avatarPalette } from './Avatar';
import { DEFAULT_ACCENT_COLOR } from '../../shared/accent';
import { ColorPicker } from './ColorPicker';
import { API_PROVIDER_NAMES, ApiProvider, isLocalApi, type Connections, type LogoColor, type ProviderScope, type Workspace } from '../../shared/contracts';
import type { HarnessInfo } from '../../shared/harness';import { Button, PanelHeading, keepOpenForPopup } from './ui';
import { Select } from './Select';
import { CurrencyFlag } from './CurrencyFlag';
import { BudgetReconciliation } from './BudgetReconciliation';
import { formatMoney, moneySymbol, toAmount, toMicros } from './money';
import { currencies, CurrencyCode, usdCurrency } from '../../shared/currency';
import { ProviderMark } from './ProviderMark';
import { StatusMark, type StatusMarkState } from './StatusMark';
import { toast } from './toast';
import { Switch } from './Switch';
import { t, tMessage } from '../i18n';
import { DEFAULT_LANGUAGE } from '../../shared/i18n';
import { orglet } from '../api';
import { version as appVersion } from '../../../../../package.json';

/** Fake password dots for a saved key — never the real secret; renderer never reads keys back. */
const SAVED_KEY_MASK = '••••••••••••••••';

export type SettingsTab = 'general' | 'chat' | 'connections' | 'harness' | 'usage' | 'data';
// Six short sections, each a few rows (user, 2026-09-17: clearer, but not overwhelming).
const tabs: { id: SettingsTab; label: string; icon: ReactNode }[] = [
  { id: 'general', label: 'Chung', icon: <SlidersHorizontal size={16} /> },
  { id: 'chat', label: 'Cuộc trò chuyện', icon: <MessageSquare size={16} /> },
  { id: 'connections', label: 'Kết nối API', icon: <Plug size={16} /> },
  { id: 'harness', label: 'Harness trên máy', icon: <SquareTerminal size={16} /> },
  { id: 'usage', label: 'Chi phí & giới hạn', icon: <Wallet size={16} /> },
  { id: 'data', label: 'Dữ liệu', icon: <Database size={16} /> },
];
// Section notes sit under the section title.
const sectionLabels: Partial<Record<SettingsTab, string>> = {
  connections: 'Bật provider cần dùng rồi dán key hoặc chọn tệp .txt. Key được mã hóa trên máy và không nằm trong bản sao lưu. Ollama chỉ cần bật công tắc — không cần key.',
  harness: 'Chưa cài, đã thấy trên máy, và đã đăng nhập sẵn sàng chạy là ba trạng thái khác nhau. Lỗi đăng nhập hiện lệnh sửa; Orglet không chuyển sang Demo. Chọn harness ở mục Model khi thiết lập Tí.',
  usage: 'Chỉ tính request qua Orglet, không phải tổng hóa đơn API key. Harness trên máy dùng gói của chính nó nên không nằm trong các số này. Input cached được tính theo giá thường.',
};

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
    toast(t('Đã sao chép lệnh'));
  } catch {
    toast(t('Không sao chép được lệnh'), 'error');
  }
}

function CommandCopy({ command, label }: { command: string; label: string }) {
  return <div className="setting-repair">
    <span className="setting-repair-label">{label}</span>
    <div className="setting-repair-row">
      <code className="setting-command">{command}</code>
      <Button type="button" size="icon" aria-label={t('Sao chép lệnh')} title={t('Sao chép lệnh')} onClick={() => void copyCommand(command)}><Copy size={13} /></Button>
    </div>
  </div>;
}


type Props = { open: boolean; tab: SettingsTab; onTab: (tab: SettingsTab) => void; onClose: () => void; workspace: Workspace; connections: Connections; onConnections: (next: Connections) => void; harnesses: HarnessInfo[]; onHarnesses: (next: HarnessInfo[]) => void };

export function SettingsDialog({ open, tab, onTab, onClose, workspace, connections, onConnections, harnesses, onHarnesses }: Props) {
  const [busy, setBusy] = useState(false);
  const [keyDrafts, setKeyDrafts] = useState<Partial<Record<ApiProvider, string>>>({});
  /** Providers the user opened for editing before a key is saved. Saved connections stay “on” from `connections`. */
  const [editing, setEditing] = useState<Partial<Record<ApiProvider, boolean>>>({});
  /** Cleared mask so the user can type a replacement without ever reading the real key back. */
  const [replacing, setReplacing] = useState<Partial<Record<ApiProvider, boolean>>>({});
  const currency = workspace.currency ?? usdCurrency;
  /** The accent's own picker, opened from the swatch row so a colour outside the palette is still reachable. */
  const [colorPanel, setColorPanel] = useState(false);
  const accent = workspace.accentColor ?? DEFAULT_ACCENT_COLOR;
  const [limit, setLimit] = useState(toAmount(workspace.connectionLimitMicros));
  const [limitError, setLimitError] = useState('');
  const savedLimit = useRef(workspace.connectionLimitMicros);
  useEffect(() => { if (!open) { setLimitError(''); setLimit(toAmount(workspace.connectionLimitMicros)); setKeyDrafts({}); setEditing({}); setReplacing({}); } }, [open, workspace.connectionLimitMicros, currency.code, currency.rate]);

  const act = async (action: () => Promise<string | void>) => {
    setBusy(true);
    try { const text = await action(); if (text) toast(text); }
    catch (err) { toast((err as Error).message, 'error'); }
    finally { setBusy(false); }
  };
  // Settings apply as soon as they change; the command always carries the full current set.
  const save = (patch: Partial<{ language: Workspace['language']; theme: Workspace['theme']; autoTitles: boolean; copyFormat: Workspace['copyFormat']; downloadFormat: Workspace['downloadFormat']; confirmOpenTask: boolean; archiveRetentionDays: Workspace['archiveRetentionDays']; connectionLimitMicros: number; providerConcurrency: number; providerConsent: ProviderScope[]; accentColor: string; logoColor: LogoColor }>) => act(async () => {
    await orglet.call('settings', { language: workspace.language ?? DEFAULT_LANGUAGE, theme: workspace.theme, autoTitles: workspace.autoTitles, copyFormat: workspace.copyFormat, downloadFormat: workspace.downloadFormat, confirmOpenTask: workspace.confirmOpenTask, archiveRetentionDays: workspace.archiveRetentionDays, connectionLimitMicros: workspace.connectionLimitMicros, providerConcurrency: workspace.providerConcurrency, providerConsent: workspace.providerConsent ?? [], accentColor: workspace.accentColor, logoColor: workspace.logoColor, ...patch });
    return t('Đã lưu');
  });
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
            {tabs.map(item => <button key={item.id} id={`settings-tab-${item.id}`} type="button" role="tab" aria-selected={tab === item.id} aria-controls="settings-panel" tabIndex={tab === item.id ? 0 : -1} onClick={() => onTab(item.id)}>{item.icon}<span>{t(item.label)}</span></button>)}
          </nav>
          <section className="settings-panel" id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${tab}`}>
            <PanelHeading title={t(current.label)} description={sectionLabels[tab] ? t(sectionLabels[tab]) : undefined}>{tab === 'harness' && <Button disabled={busy} onClick={() => void act(async () => { onHarnesses(await orglet.call('harnesses', { refresh: true })); return t('Đã dò lại harness'); })}><RefreshCw size={13} />{t('Dò lại')}</Button>}</PanelHeading>

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
                  <Button type="button" size="icon" className="setting-swatch-custom" aria-label={t('Chọn màu khác')} title={t('Chọn màu khác')}
                    aria-expanded={colorPanel} disabled={busy} onClick={() => setColorPanel(open => !open)}><Palette size={15} /></Button>
                </div>
              </Row>
              {colorPanel && <ColorPicker id="accent-colors" value={accent} presets={avatarPalette} saved={workspace.avatarColors ?? []}
                onChange={color => void save({ accentColor: color })}
                onSave={color => void act(async () => { await orglet.call('saveAvatarColors', { colors: [...new Set([...(workspace.avatarColors ?? []), color])] }); })}
                onRemove={color => void act(async () => { await orglet.call('saveAvatarColors', { colors: (workspace.avatarColors ?? []).filter(item => item !== color) }); })}
                onClose={() => setColorPanel(false)} />}
              <Row title={t('Màu logo')} description={t('Logo trong ứng dụng: màu chữ, hoặc màu nhấn bạn chọn.')}>
                <Select ariaLabel={t('Màu logo')} className="setting-select" value={workspace.logoColor ?? 'mono'} disabled={busy} onChange={value => void save({ logoColor: value as LogoColor })} options={[{ value: 'mono', label: t('Đơn sắc'), icon: <Contrast size={16} /> }, { value: 'accent', label: t('Theo màu nhấn'), icon: <Palette size={16} /> }]} />
              </Row>
            </>}

            {tab === 'chat' && <>
              <Row id="auto-title-label" title={t('Tự đặt tên cuộc trò chuyện')} description={t('Sau câu trả lời đầu tiên, Tí đặt một tên ngắn. Tên bạn tự đổi luôn được giữ.')}>
                <Switch checked={workspace.autoTitles} disabled={busy} labelledBy="auto-title-label" onChange={value => void save({ autoTitles: value })} />
              </Row>
              <Row title={t('Định dạng khi sao chép')} description={t('Chọn sẵn để bấm một lần là sao chép, không hiện menu.')}>
                <Select ariaLabel={t('Định dạng khi sao chép')} className="setting-select" value={workspace.copyFormat} disabled={busy} onChange={value => void save({ copyFormat: value as Workspace['copyFormat'] })} options={[{ value: 'ask', label: t('Luôn hỏi') }, { value: 'text', label: t('Văn bản thuần') }, { value: 'markdown', label: 'Markdown' }]} />
              </Row>
              <Row title={t('Định dạng khi tải xuống')} description={t('Chọn sẵn để bấm một lần là tải, không hiện menu.')}>
                <Select ariaLabel={t('Định dạng khi tải xuống')} className="setting-select" value={workspace.downloadFormat} disabled={busy} onChange={value => void save({ downloadFormat: value as Workspace['downloadFormat'] })} options={[{ value: 'ask', label: t('Luôn hỏi') }, { value: 'text', label: t('Văn bản (.txt)') }, { value: 'markdown', label: 'Markdown (.md)' }]} />
              </Row>
              <Row title={t('Tự xóa mục đã lưu trữ')} description={t('Áp dụng cho cuộc trò chuyện, Tí và hội, tính từ lúc lưu trữ. Cuộc trò chuyện đã tốn phí chỉ giữ lại số liệu chi phí.')}>
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
                        : t('Tắt · bật công tắc để nhập key')} · <button type="button" className="text-link" disabled={busy} onClick={() => void act(async () => { await orglet.openPricing(provider); })}>{local ? t('Tài liệu') : provider === 'opencode-go' ? t('Giá và hạn mức gói') : t('Bảng giá')}<ExternalLink size={12} aria-hidden="true" /></button></span>
                  </div>
                  <div className="setting-control">
                    <Switch checked={active} disabled={busy} labelledBy={titleId} onChange={on => {
                      if (local) {
                        void act(async () => {
                          onConnections(on ? await orglet.connect('ollama') : await orglet.disconnect('ollama'));
                          return on ? t('Đã bật Ollama') : t('Đã ngắt {0}', [name]);
                        });
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
                          onConnections(await orglet.disconnect(provider));
                          return t('Đã ngắt {0}', [name]);
                        });
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
                        onConnections(await orglet.connect(provider, key));
                        setKeyDrafts(current => ({ ...current, [provider]: '' }));
                        setEditing(current => ({ ...current, [provider]: false }));
                        setReplacing(current => ({ ...current, [provider]: false }));
                        return t('Đã lưu API key {0}', [name]);
                      });
                    }}>
                      <Button type="button" size="icon" variant="ghost" className="setting-key-file" disabled={busy} aria-label={t('Từ tệp')} onClick={() => void act(async () => {
                        const next = await orglet.connect(provider);
                        onConnections(next);
                        if (next[provider]) {
                          setKeyDrafts(current => ({ ...current, [provider]: '' }));
                          setEditing(current => ({ ...current, [provider]: false }));
                          setReplacing(current => ({ ...current, [provider]: false }));
                          return t('Đã lưu API key {0}', [name]);
                        }
                      })}><FileKey size={15} /></Button>
                      <input type="password" name={`${provider}-api-key`} autoComplete="off" spellCheck={false} disabled={busy} value={showMask ? SAVED_KEY_MASK : draft} placeholder={connections[provider] ? t('Nhập key mới để thay') : t('Dán hoặc nhập API key')} aria-label={t('API key {0}', [name])} onFocus={() => { if (connections[provider] && !draft) setReplacing(current => ({ ...current, [provider]: true })); }} onBlur={() => { if (!draft) setReplacing(current => ({ ...current, [provider]: false })); }} onChange={event => setKeyDrafts(current => ({ ...current, [provider]: event.target.value }))} />
                      <Button type="submit" variant="outline" disabled={busy || !draft.trim()}>{t('Lưu key')}</Button>
                    </form>}
                </div>;
              })}
            </>}

            {tab === 'harness' && <>
              <div role="region" aria-label={t('Harness trên máy')}>
                {harnesses.map(item => {
                  const pill = statusPill(item);
                  const showLogin = item.status !== 'signed_in';
                  return <div key={item.id} className="setting-row harness-row">
                    <ProviderMark provider={item.id} />
                    <div className="setting-text">
                      {/* The mark, the name and the state read as one line, so the eye does not have to travel
                          down the row to learn whether this harness is usable (user, 2026-09-19). */}
                      <span className="harness-head">
                        <span className="setting-title"><span>{item.name}</span>{!item.runnable && <span className="badge">{t('Chỉ trạng thái')}</span>}</span>
                        <span className={`status-pill ${pill.className}`}><StatusMark variant={pill.mark.variant} tone={pill.mark.tone} label={pill.label} decorative />{pill.label}</span>
                      </span>
                      {/* With nothing installed the version line only repeats what the detail line already says. */}
                      {item.version && <span className="setting-description">{item.version}</span>}
                      <span className="setting-description">{tMessage(item.authDetail)}</span>
                      {item.executable ? <span className="setting-path" title={item.executable}>{item.executable}</span> : null}
                      {((item.status === 'not_installed' && item.installCommand) || showLogin) && <div className="harness-commands">
                        {item.status === 'not_installed' && item.installCommand && <CommandCopy command={item.installCommand} label={t('Lệnh cài (tài liệu chính thức)')} />}
                        {showLogin && <CommandCopy command={item.loginCommand} label={item.status === 'not_installed' ? t('Sau khi cài, đăng nhập bằng') : t('Lệnh đăng nhập')} />}
                      </div>}
                    </div>
                  </div>;
                })}
                {!harnesses.length && <Row title={t('Chưa tìm thấy Claude Code, Codex hoặc Cursor Agent trên máy này.')} description={t('Cài một harness rồi bấm Dò lại.')} />}
              </div>
            </>}

            {tab === 'usage' && <>
              <Row title={t('Đã đối soát')} description={t('Phần provider đã chốt số và tính tiền.')}><span className="setting-value">{formatMoney(workspace.usage.chargedMicros)}</span></Row>
              <Row title={t('Đang giữ chỗ')} description={workspace.usage.uncertainCount > 0 ? <span className="error">{t('{0} request chưa rõ chi phí, vẫn được tính vào giới hạn.', [workspace.usage.uncertainCount])}</span> : t('Request đang chạy hoặc chưa rõ chi phí.')}><span className="setting-value">{formatMoney(workspace.usage.reservedMicros)}</span></Row>
              <Row id="limit-label" title={t('Giới hạn mỗi connection / tháng')} description={limitError ? <span className="error" id="limit-error">{limitError}</span> : t('Tháng tính theo UTC. Áp dụng riêng cho từng API provider.')}>
                <span className={`money-input ${limitError ? 'invalid' : ''}`}><span aria-hidden>{moneySymbol()}</span><input aria-labelledby="limit-label" aria-invalid={Boolean(limitError)} aria-describedby={limitError ? 'limit-error' : undefined} inputMode="decimal" value={limit} disabled={busy} onChange={event => setLimit(event.target.value)} onBlur={commitLimit} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commitLimit(); } }} /></span>
              </Row>
              <Row title={t('Tiền tệ')} description={currency.code === 'USD' ? t('Chi phí được lưu bằng USD theo giá của provider.') : t('1 USD = {0} {1}{2}. Chi phí vẫn lưu bằng USD, chỉ quy đổi khi hiển thị.', [new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 4 }).format(currency.rate), currency.code, currency.updatedAt ? t(' · cập nhật {0}', [new Date(currency.updatedAt).toLocaleString('vi-VN')]) : ''])}>
                <Select ariaLabel={t('Tiền tệ')} className="setting-select" inlineDetail menuMinWidth={270} value={currency.code} disabled={busy} onChange={value => void act(async () => { await orglet.call('setCurrency', { code: CurrencyCode.parse(value) }); return value === 'USD' ? t('Đã đổi sang USD.') : t('Đã đổi sang {0} theo tỷ giá mới nhất.', [value]); })} options={(Object.keys(currencies) as CurrencyCode[]).map(code => ({ value: code, label: code, detail: t(currencies[code]), icon: <CurrencyFlag code={code} /> }))} />
              </Row>
              {currency.code !== 'USD' && <Row title={t('Tỷ giá')} description={currency.error ? <span className="error">{t('{0} Đang dùng tỷ giá gần nhất.', [currency.error])}</span> : t('Tự làm mới mỗi 12 giờ từ open.er-api.com. Request không kèm dữ liệu của bạn.')}>
                <Button disabled={busy} onClick={() => void act(async () => { await orglet.call('refreshCurrency', {}); return t('Đã cập nhật tỷ giá'); })}><RefreshCw size={14} />{t('Cập nhật')}</Button>
              </Row>}
              <BudgetReconciliation workspace={workspace} busy={busy} onReconcile={async (reservationId, amountMicros, source) => {
                setBusy(true);
                try {
                  await orglet.call('reconcileBudget', { reservationId, amountMicros, source });
                  toast(t('Đã lưu đối soát ngân sách.'));
                } catch (error) {
                  toast((error as Error).message, 'error');
                  throw error;
                } finally {
                  setBusy(false);
                }
              }} />
            </>}

            {tab === 'data' && <>
              <Row title={t('Sao lưu')} description={t('Tí, hội, lịch sử, báo cáo và chi phí vào một tệp JSON. Không gồm API key hay nội dung tệp nguồn; báo cáo có thể chứa trích dẫn.')}>
                <Button variant="outline" disabled={busy} onClick={() => void act(async () => (await orglet.backup()) ? t('Đã lưu bản sao lưu') : undefined)}><Download size={14} />{t('Lưu bản sao lưu')}</Button>
              </Row>
              <Row title={t('Khôi phục')} description={t('Bổ sung các mục còn thiếu, giữ nguyên dữ liệu và cài đặt hiện tại. Nguồn khôi phục cần được chọn lại để cấp quyền đọc.')}>
                <Button variant="outline" disabled={busy} onClick={() => void act(async () => (await orglet.restore()) ? t('Đã khôi phục các mục còn thiếu') : undefined)}><ArchiveRestore size={14} />{t('Khôi phục từ tệp')}</Button>
              </Row>
              <Row title={t('Phiên bản')} description={`Orglet ${appVersion} · SQLite ${workspace.sqliteVersion}`} />
              <Row title={t('Nơi lưu dữ liệu')} description={t('Mọi cuộc trò chuyện, báo cáo và cài đặt nằm trên máy này. Không có tài khoản Orglet, và không một bí mật nào bị tổn hại trong quá trình làm ra app này.')} />
            </>}
          </section>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
