import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Database, MessageSquare, Plug, SlidersHorizontal, SquareTerminal, Wallet, X, RefreshCw, ExternalLink, Monitor, Moon, Sun, FileKey, Unplug, Download, ArchiveRestore, Copy } from 'lucide-react';
import type { Connections, ProviderScope, Workspace } from '../../shared/contracts';
import type { HarnessInfo } from '../../shared/harness';
import { Button, PanelHeading, keepOpenForPopup } from './ui';
import { Select } from './Select';
import { CurrencyFlag } from './CurrencyFlag';
import { formatMoney, moneySymbol, toAmount, toMicros } from './money';
import { currencies, CurrencyCode, usdCurrency } from '../../shared/currency';
import { ProviderMark } from './ProviderMark';
import { toast } from './toast';
import { Switch } from './Switch';
import { t, tMessage } from '../i18n';
import { DEFAULT_LANGUAGE } from '../../shared/i18n';
import { orglet } from '../api';

export type SettingsTab = 'general' | 'chat' | 'connections' | 'harness' | 'usage' | 'data';
// Six short sections, each a few rows (user, 2026-09-17: clearer, but not overwhelming).
const tabs: { id: SettingsTab; label: string; icon: ReactNode }[] = [
  { id: 'general', label: 'Chung', icon: <SlidersHorizontal size={16} /> },
  { id: 'chat', label: 'Công việc', icon: <MessageSquare size={16} /> },
  { id: 'connections', label: 'Kết nối API', icon: <Plug size={16} /> },
  { id: 'harness', label: 'Harness trên máy', icon: <SquareTerminal size={16} /> },
  { id: 'usage', label: 'Chi phí & giới hạn', icon: <Wallet size={16} /> },
  { id: 'data', label: 'Dữ liệu', icon: <Database size={16} /> },
];
// Section notes sit under the section title.
const sectionLabels: Partial<Record<SettingsTab, string>> = {
  connections: 'Nhập key từ tệp .txt. Key được mã hóa trên máy và không nằm trong bản sao lưu.',
  harness: 'Chưa cài, đã thấy trên máy, và đã đăng nhập sẵn sàng chạy là ba trạng thái khác nhau. Lỗi đăng nhập hiện lệnh sửa; Orglet không chuyển sang Demo. Cursor chỉ hiện trạng thái cài/đăng nhập, phiên bản này chưa chạy Cursor.',
  usage: 'Chỉ tính request qua Orglet, không phải tổng hóa đơn API key. Harness trên máy dùng gói của chính nó nên không nằm trong các số này. Input cached được tính theo giá thường.',
};

function Row({ title, description, children, id }: { title: string; description?: ReactNode; children?: ReactNode; id?: string }) {
  return <div className="setting-row">
    <div className="setting-text"><span id={id} className="setting-title">{title}</span>{description && <span className="setting-description">{description}</span>}</div>
    {children && <div className="setting-control">{children}</div>}
  </div>;
}

function statusPill(item: HarnessInfo) {
  if (item.status === 'not_installed') return { className: 'not_installed', label: t('Chưa cài') };
  if (item.status === 'detected') return { className: 'logged_out', label: t('Đã thấy · chưa đăng nhập') };
  if (item.status === 'auth_error') return { className: 'auth_error', label: t('Lỗi đăng nhập') };
  if (item.runnable) return { className: 'logged_in', label: t('Đã đăng nhập · sẵn sàng') };
  return { className: 'logged_in', label: t('Đã đăng nhập') };
}

async function copyCommand(command: string) {
  try {
    await navigator.clipboard.writeText(command);
    toast(t('Đã sao chép lệnh.'));
  } catch {
    try {
      const field = document.createElement('textarea');
      field.value = command;
      field.setAttribute('readonly', '');
      field.style.cssText = 'position:fixed;left:-9999px';
      document.body.appendChild(field);
      field.select();
      if (!document.execCommand('copy')) throw new Error('copy');
      field.remove();
      toast(t('Đã sao chép lệnh.'));
    } catch {
      toast(t('Không sao chép được lệnh.'), 'error');
    }
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
  const currency = workspace.currency ?? usdCurrency;
  const [limit, setLimit] = useState(toAmount(workspace.connectionLimitMicros));
  const [limitError, setLimitError] = useState('');
  const savedLimit = useRef(workspace.connectionLimitMicros);
  useEffect(() => { if (!open) { setLimitError(''); setLimit(toAmount(workspace.connectionLimitMicros)); } }, [open, workspace.connectionLimitMicros, currency.code, currency.rate]);

  const act = async (action: () => Promise<string | void>) => {
    setBusy(true);
    try { const text = await action(); if (text) toast(text); }
    catch (err) { toast((err as Error).message, 'error'); }
    finally { setBusy(false); }
  };
  // Settings apply as soon as they change; the command always carries the full current set.
  const save = (patch: Partial<{ language: Workspace['language']; theme: Workspace['theme']; autoTitles: boolean; copyFormat: Workspace['copyFormat']; downloadFormat: Workspace['downloadFormat']; confirmOpenTask: boolean; archiveRetentionDays: Workspace['archiveRetentionDays']; connectionLimitMicros: number; providerConcurrency: number; providerConsent: ProviderScope[] }>) => act(async () => {
    await orglet.call('settings', { language: workspace.language ?? DEFAULT_LANGUAGE, theme: workspace.theme, autoTitles: workspace.autoTitles, copyFormat: workspace.copyFormat, downloadFormat: workspace.downloadFormat, confirmOpenTask: workspace.confirmOpenTask, archiveRetentionDays: workspace.archiveRetentionDays, connectionLimitMicros: workspace.connectionLimitMicros, providerConcurrency: workspace.providerConcurrency, providerConsent: workspace.providerConsent ?? [], ...patch });
    return t('Đã lưu.');
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
            <PanelHeading title={t(current.label)} description={sectionLabels[tab] ? t(sectionLabels[tab]) : undefined}>{tab === 'harness' && <Button disabled={busy} onClick={() => void act(async () => { onHarnesses(await orglet.call('harnesses', { refresh: true })); return t('Đã dò lại harness.'); })}><RefreshCw size={13} />{t('Dò lại')}</Button>}</PanelHeading>

            {tab === 'general' && <>
              <Row title={t('Ngôn ngữ')} description={t('Áp dụng cho toàn bộ giao diện và thông báo.')}>
                <Select ariaLabel={t('Ngôn ngữ')} className="setting-select" value={workspace.language ?? DEFAULT_LANGUAGE} disabled={busy} onChange={value => void save({ language: value as Workspace['language'] })} options={[{ value: 'en', label: 'English (US)', icon: <CurrencyFlag code="USD" /> }, { value: 'en-GB', label: 'English (UK)', icon: <CurrencyFlag code="GBP" /> }, { value: 'vi', label: 'Tiếng Việt', icon: <CurrencyFlag code="VND" /> }]} />
              </Row>
              <Row title={t('Giao diện')} description={t('Theo hệ thống dùng chế độ sáng/tối của Windows.')}>
                <Select ariaLabel={t('Giao diện')} className="setting-select" value={workspace.theme} disabled={busy} onChange={value => void save({ theme: value as Workspace['theme'] })} options={[{ value: 'system', label: t('Theo hệ thống'), icon: <Monitor size={16} /> }, { value: 'light', label: t('Sáng'), icon: <Sun size={16} /> }, { value: 'dark', label: t('Tối'), icon: <Moon size={16} /> }]} />
              </Row>
            </>}

            {tab === 'chat' && <>
              <Row id="auto-title-label" title={t('Tự đặt tên công việc')} description={t('Sau câu trả lời đầu tiên, nhân viên đặt một tên ngắn cho công việc. Tên bạn tự đổi luôn được giữ.')}>
                <Switch checked={workspace.autoTitles} disabled={busy} labelledBy="auto-title-label" onChange={value => void save({ autoTitles: value })} />
              </Row>
              <Row id="confirm-open-label" title={t('Hỏi trước khi mở công việc')} description={t('Khi bấm một công việc trong danh sách của nhân viên.')}>
                <Switch checked={workspace.confirmOpenTask} disabled={busy} labelledBy="confirm-open-label" onChange={value => void save({ confirmOpenTask: value })} />
              </Row>
              <Row title={t('Định dạng khi sao chép')} description={t('Chọn sẵn để bấm một lần là sao chép, không hiện menu.')}>
                <Select ariaLabel={t('Định dạng khi sao chép')} className="setting-select" value={workspace.copyFormat} disabled={busy} onChange={value => void save({ copyFormat: value as Workspace['copyFormat'] })} options={[{ value: 'ask', label: t('Luôn hỏi') }, { value: 'text', label: t('Văn bản thuần') }, { value: 'markdown', label: 'Markdown' }]} />
              </Row>
              <Row title={t('Định dạng khi tải xuống')} description={t('Chọn sẵn để bấm một lần là tải, không hiện menu.')}>
                <Select ariaLabel={t('Định dạng khi tải xuống')} className="setting-select" value={workspace.downloadFormat} disabled={busy} onChange={value => void save({ downloadFormat: value as Workspace['downloadFormat'] })} options={[{ value: 'ask', label: t('Luôn hỏi') }, { value: 'text', label: t('Văn bản (.txt)') }, { value: 'markdown', label: 'Markdown (.md)' }]} />
              </Row>
              <Row title={t('Tự xóa mục đã lưu trữ')} description={t('Áp dụng cho công việc, nhân viên và nhóm, tính từ lúc lưu trữ. Công việc đã tốn phí chỉ giữ lại số liệu chi phí.')}>
                <Select ariaLabel={t('Tự xóa mục đã lưu trữ')} className="setting-select" value={String(workspace.archiveRetentionDays)} disabled={busy} onChange={value => void save({ archiveRetentionDays: Number(value) as Workspace['archiveRetentionDays'] })} options={[{ value: '7', label: t('Sau 7 ngày') }, { value: '30', label: t('Sau 30 ngày') }, { value: '0', label: t('Không tự xóa') }]} />
              </Row>
              <Row title={t('Request đồng thời mỗi provider')} description={t('Bước vượt giới hạn sẽ xếp hàng và chưa giữ ngân sách.')}>
                <Select ariaLabel={t('Request đồng thời mỗi provider')} className="setting-select" value={String(workspace.providerConcurrency)} disabled={busy} onChange={value => void save({ providerConcurrency: Number(value) })} options={[1, 2, 3, 4].map(value => ({ value: String(value), label: `${value} request`, detail: value === 1 ? t('tuần tự') : undefined }))} />
              </Row>
            </>}

            {tab === 'connections' && <>
              {(['openai', 'anthropic'] as const).map(provider => {
                const name = provider === 'openai' ? 'OpenAI' : 'Anthropic';
                return <div key={provider} role="region" aria-label={t('Kết nối {0}', [name])} className="setting-row">
                  <ProviderMark provider={provider} />
                  <div className="setting-text">
                    <span className="setting-title">{name} API</span>
                    <span className="setting-description">{connections[provider] ? t('Đã lưu API key') : t('Chưa có API key')} · <button type="button" className="text-link" onClick={() => void act(async () => { await orglet.openPricing(provider); })}>{t('Bảng giá')}<ExternalLink size={12} aria-hidden="true" /></button></span>
                  </div>
                  <div className="setting-control">
                    {connections[provider] && <Button disabled={busy} onClick={() => void act(async () => { onConnections(await orglet.disconnect(provider)); return t('Đã ngắt {0}.', [name]); })}><Unplug size={14} />{t('Ngắt kết nối')}</Button>}
                    <Button variant="outline" disabled={busy} onClick={() => void act(async () => { onConnections(await orglet.connect(provider)); })}><FileKey size={14} />{connections[provider] ? 'Thay key' : t('Nhập API key từ tệp')}</Button>
                  </div>
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
                      <span className="setting-title"><span>{item.name}</span>{!item.runnable && <span className="badge">{t('Chỉ trạng thái')}</span>}</span>
                      <span className="setting-description">{item.version || t('Chưa tìm thấy bản cài.')}</span>
                      <span className="setting-description">{tMessage(item.authDetail)}</span>
                      {item.status === 'not_installed' && item.installCommand && <CommandCopy command={item.installCommand} label={t('Lệnh cài (tài liệu chính thức)')} />}
                      {showLogin && <CommandCopy command={item.loginCommand} label={item.status === 'not_installed' ? t('Sau khi cài, đăng nhập bằng') : t('Lệnh đăng nhập')} />}
                      {item.executable ? <span className="setting-path" title={item.executable}>{item.executable}</span> : null}
                    </div>
                    <div className="setting-control"><span className={`status-pill ${pill.className}`}>{pill.label}</span></div>
                  </div>;
                })}
                {!harnesses.length && <Row title={t('Chưa dò được harness trên máy này.')} description={t('Bấm Dò lại sau khi cài Claude Code, Codex hoặc Cursor CLI.')} />}
              </div>
            </>}

            {tab === 'usage' && <>
              <Row title={t('Đã đối soát')} description={t('Chi phí request đi qua Orglet đã có số liệu từ provider.')}><span className="setting-value">{formatMoney(workspace.usage.chargedMicros)}</span></Row>
              <Row title={t('Đang giữ chỗ')} description={workspace.usage.uncertainCount > 0 ? <span className="error">{t('{0} request chưa rõ chi phí, vẫn được tính vào giới hạn.', [workspace.usage.uncertainCount])}</span> : t('Request đang chạy hoặc chưa rõ chi phí.')}><span className="setting-value">{formatMoney(workspace.usage.reservedMicros)}</span></Row>
              <Row id="limit-label" title={t('Giới hạn mỗi connection / tháng')} description={limitError ? <span className="error" id="limit-error">{limitError}</span> : t('Tháng tính theo UTC. Áp dụng riêng cho từng API provider.')}>
                <span className={`money-input ${limitError ? 'invalid' : ''}`}><span aria-hidden>{moneySymbol()}</span><input aria-labelledby="limit-label" aria-invalid={Boolean(limitError)} aria-describedby={limitError ? 'limit-error' : undefined} inputMode="decimal" value={limit} disabled={busy} onChange={event => setLimit(event.target.value)} onBlur={commitLimit} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commitLimit(); } }} /></span>
              </Row>
              <Row title={t('Tiền tệ')} description={currency.code === 'USD' ? t('Chi phí được lưu bằng USD theo giá của provider.') : t('1 USD = {0} {1}{2}. Chi phí vẫn lưu bằng USD, chỉ quy đổi khi hiển thị.', [new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 4 }).format(currency.rate), currency.code, currency.updatedAt ? t(' · cập nhật {0}', [new Date(currency.updatedAt).toLocaleString('vi-VN')]) : ''])}>
                <Select ariaLabel={t('Tiền tệ')} className="setting-select" inlineDetail menuMinWidth={270} value={currency.code} disabled={busy} onChange={value => void act(async () => { await orglet.call('setCurrency', { code: CurrencyCode.parse(value) }); return value === 'USD' ? t('Đã đổi sang USD.') : t('Đã đổi sang {0} theo tỷ giá mới nhất.', [value]); })} options={(Object.keys(currencies) as CurrencyCode[]).map(code => ({ value: code, label: code, detail: t(currencies[code]), icon: <CurrencyFlag code={code} /> }))} />
              </Row>
              {currency.code !== 'USD' && <Row title={t('Tỷ giá')} description={currency.error ? <span className="error">{t('{0} Đang dùng tỷ giá gần nhất.', [currency.error])}</span> : t('Tự làm mới mỗi 12 giờ từ open.er-api.com. Request không kèm dữ liệu của bạn.')}>
                <Button disabled={busy} onClick={() => void act(async () => { await orglet.call('refreshCurrency', {}); return t('Đã cập nhật tỷ giá.'); })}><RefreshCw size={14} />{t('Cập nhật')}</Button>
              </Row>}
            </>}

            {tab === 'data' && <>
              <Row title={t('Sao lưu')} description={t('Nhân viên, nhóm, lịch sử, báo cáo và chi phí vào một tệp JSON. Không gồm API key hay nội dung tệp nguồn; báo cáo có thể chứa trích dẫn.')}>
                <Button variant="outline" disabled={busy} onClick={() => void act(async () => (await orglet.backup()) ? t('Đã lưu bản sao lưu.') : undefined)}><Download size={14} />{t('Lưu bản sao lưu')}</Button>
              </Row>
              <Row title={t('Khôi phục')} description={t('Bổ sung các mục còn thiếu, giữ nguyên dữ liệu và cài đặt hiện tại. Nguồn khôi phục cần được chọn lại để cấp quyền đọc.')}>
                <Button variant="outline" disabled={busy} onClick={() => void act(async () => (await orglet.restore()) ? t('Đã khôi phục các mục còn thiếu.') : undefined)}><ArchiveRestore size={14} />{t('Khôi phục từ tệp')}</Button>
              </Row>
              <Row title={t('Phiên bản')} description={`Orglet 0.1 · SQLite ${workspace.sqliteVersion}`} />
              <Row title={t('Nơi lưu dữ liệu')} description={t('Mọi công việc, báo cáo và cài đặt nằm trên máy này. Không có tài khoản Orglet.')} />
            </>}
          </section>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
