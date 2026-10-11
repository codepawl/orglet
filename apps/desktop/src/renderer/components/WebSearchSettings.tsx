import { useEffect, useState, type ReactNode } from 'react';
import { ExternalLink, Radar, Search, Server, Shield, Sparkles, Trash2 } from 'lucide-react';
import { BrandMark } from './brandMarks';
import type { Connections } from '../../shared/contracts';
import type { AboutLink } from '../../shared/updates';
import {
  SearxngUrl, WEB_SEARCH_PROVIDER_NAMES, WEB_SEARCH_PROVIDER_ORDER, WEB_SEARCH_TEST_QUERY, WebSearchKeyProvider,
  type WebSearchProvider,
} from '../../shared/web-tools';
import { Button } from './ui';
import { Select } from './Select';
import { StatusMark } from './StatusMark';
import { orglet } from '../api';
import { t, translated } from '../i18n';

/** Fake password dots for a saved key; the real key never comes back to the window. */
const SAVED_KEY_MASK = '••••••••••••••••';

/** What each provider is and whether it needs a key: one short line under its name in the list and under the picker. */
const providerNotes: Record<WebSearchProvider, string> = translated({
  auto: 'Exa miễn phí, rồi DuckDuckGo. Không cần key hay cài đặt.',
  exa: 'Miễn phí, không cần key; có giới hạn lượt.',
  tavily: 'Cần key. Gói miễn phí có 1.000 lượt tìm mỗi tháng.',
  brave: 'Cần key từ trang quản lý của Brave.',
  searxng: 'Máy chủ SearXNG bạn tự chạy hoặc tin cậy. Không cần key.',
  duckduckgo: 'Không cần key; hay đòi xác minh người dùng.',
});

/** Where each key is made. Exa works without one; Tavily and Brave do not. */
const keyLinks: Record<WebSearchKeyProvider, AboutLink> = { exa: 'exaKeys', tavily: 'tavilyKeys', brave: 'braveKeys' };

/** The mark beside a provider's name: its own mark where the app has one, otherwise a plain icon. */
function providerIcon(provider: WebSearchProvider): ReactNode {
  switch (provider) {
    case 'exa': return <BrandMark brand="exa" size={14} />;
    case 'duckduckgo': return <BrandMark brand="duckduckgo" size={15} />;
    case 'auto': return <Sparkles size={14} aria-hidden="true" />;
    case 'tavily': return <Radar size={14} aria-hidden="true" />;
    case 'brave': return <Shield size={14} aria-hidden="true" />;
    case 'searxng': return <Server size={14} aria-hidden="true" />;
  }
}

type Act = (action: () => Promise<string | void>, about?: string) => Promise<void>;
type Outcome = { tone: 'success' | 'error'; text: string };

/**
 * Settings → Web search (COD-266): where `web_search` sends a query, the key of Exa, Tavily or Brave, the address of a
 * SearXNG instance, and a Test that runs one real query. A key goes to main only; this component never learns more than
 * "a key is saved". The Test result stays on the row until the provider or the setup changes, because it answers a
 * question about exactly that setup.
 */
export function WebSearchSettings({ provider, keys, instanceUrl, busy, act, onProvider, onInstanceUrl, onConnections }: {
  provider: WebSearchProvider;
  keys: Record<WebSearchKeyProvider, boolean>;
  instanceUrl: string | null;
  busy: boolean;
  act: Act;
  onProvider: (provider: WebSearchProvider) => void;
  onInstanceUrl: (address: string) => void;
  onConnections: (next: Connections) => void;
}) {
  const [draft, setDraft] = useState('');
  const [replacing, setReplacing] = useState(false);
  const [addressDraft, setAddressDraft] = useState(instanceUrl ?? '');
  const [addressError, setAddressError] = useState<string>();
  const [testing, setTesting] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>();
  const name = provider === 'auto' ? t(WEB_SEARCH_PROVIDER_NAMES.auto) : WEB_SEARCH_PROVIDER_NAMES[provider];
  const keyProvider = WebSearchKeyProvider.safeParse(provider).data;
  const keyNeeded = provider === 'tavily' || provider === 'brave';
  const hasKey = keyProvider ? keys[keyProvider] : false;
  const showMask = hasKey && !draft && !replacing;
  const missing = keyNeeded && !hasKey ? t('Cần API key trước khi tìm kiếm.') : provider === 'searxng' && !instanceUrl ? t('Cần địa chỉ máy chủ trước khi tìm kiếm.') : undefined;
  useEffect(() => setOutcome(undefined), [provider, hasKey, instanceUrl]);
  useEffect(() => { setDraft(''); setReplacing(false); }, [provider]);
  useEffect(() => { setAddressDraft(instanceUrl ?? ''); setAddressError(undefined); }, [instanceUrl]);

  const saveKey = () => {
    const key = draft.trim();
    if (!keyProvider || !key || key === SAVED_KEY_MASK) return;
    void act(async () => {
      onConnections(await orglet.saveWebSearchKey(keyProvider, key));
      setDraft('');
      setReplacing(false);
      return t('Đã lưu API key {0}', [name]);
    }, name);
  };
  const removeKey = () => {
    if (!keyProvider) return;
    void act(async () => {
      onConnections(await orglet.removeWebSearchKey(keyProvider));
      return t('Đã xóa API key {0}', [name]);
    }, name);
  };
  const saveAddress = () => {
    const address = addressDraft.trim();
    if (address) {
      const checked = SearxngUrl.safeParse(address);
      if (!checked.success) {
        setAddressError(t('Địa chỉ phải bắt đầu bằng https://, không kèm cổng, tài khoản, dấu ? hay #.'));
        return;
      }
    }
    setAddressError(undefined);
    onInstanceUrl(address);
  };
  const test = async () => {
    setOutcome(undefined);
    setTesting(true);
    try {
      const result = await orglet.call('testWebSearch', {});
      const text = result.title ? t('Kết quả đầu: {0}, từ {1}', [result.title, result.answeredBy]) : t('{0} trả lời nhưng không có kết quả nào.', [result.answeredBy]);
      setOutcome({ tone: 'success', text });
    } catch (error) {
      setOutcome({ tone: 'error', text: (error as Error).message });
    } finally {
      setTesting(false);
    }
  };

  return <>
    <div className="setting-row">
      <div className="setting-text">
        <span id="web-search-provider-title" className="setting-title">{t('Nhà cung cấp')}</span>
        <span className="setting-description">{providerNotes[provider]}</span>
      </div>
      <div className="setting-control">
        <Select ariaLabel={t('Nhà cung cấp tìm kiếm web')} className="setting-select" value={provider} disabled={busy}
          onChange={value => onProvider(value as WebSearchProvider)} menuMinWidth={440} showDetail={false}
          options={WEB_SEARCH_PROVIDER_ORDER.map(option => ({
            value: option, label: option === 'auto' ? t(WEB_SEARCH_PROVIDER_NAMES.auto) : WEB_SEARCH_PROVIDER_NAMES[option],
            note: option === 'auto' ? t('mặc định') : undefined, detail: providerNotes[option], icon: providerIcon(option),
          }))} />
      </div>
    </div>
    {keyProvider && <div role="region" aria-labelledby="search-key-title" className="setting-row web-search-key">
      <div className="setting-text">
        <span id="search-key-title" className="setting-title">{t('API key {0}', [name])}</span>
        {/* Where to get a key matters only while there is none. */}
        <span className="setting-description">{hasKey ? t('Đã lưu. Tìm kiếm dùng lượt của tài khoản {0} của bạn.', [name]) : <>
          {keyNeeded ? t('Bắt buộc. Tìm kiếm chỉ chạy khi có key.') : t('Không bắt buộc. Thêm key khi hết lượt miễn phí.')} <button type="button" className="text-link" disabled={busy}
            onClick={() => void act(async () => { await orglet.openLink(keyLinks[keyProvider]); }, name)}>{t('Lấy key')}<ExternalLink size={12} aria-hidden="true" /></button>
        </>}</span>
      </div>
      {hasKey && <div className="setting-control">
        <Button variant="ghost" disabled={busy} onClick={removeKey}><Trash2 size={14} />{t('Xóa key')}</Button>
      </div>}
      {/* The key takes a line of its own under the row, like the API keys. */}
      <form className="setting-key-form" onSubmit={event => { event.preventDefault(); saveKey(); }}>
        <input type="password" name={`${keyProvider}-search-key`} autoComplete="off" spellCheck={false} disabled={busy} value={showMask ? SAVED_KEY_MASK : draft}
          placeholder={hasKey ? t('Nhập key mới để thay') : t('Dán hoặc nhập API key')} aria-label={t('API key {0}', [name])}
          onFocus={() => { if (hasKey && !draft) setReplacing(true); }} onBlur={() => { if (!draft) setReplacing(false); }}
          onChange={event => setDraft(event.target.value)} />
        <Button type="submit" variant="outline" disabled={busy || !draft.trim()}>{t('Lưu key')}</Button>
      </form>
    </div>}
    {provider === 'searxng' && <div role="region" aria-labelledby="searxng-address-title" className="setting-row web-search-key">
      <div className="setting-text">
        <span id="searxng-address-title" className="setting-title">{t('Địa chỉ máy chủ SearXNG')}</span>
        <span className="setting-description">{t('Chỉ dùng được máy chủ công khai qua HTTPS. Máy chủ trên máy này hoặc trong mạng riêng chưa dùng được. Máy chủ cần bật JSON trong search.formats.')}</span>
        {addressError && <span className="setting-description web-search-outcome error" role="alert">
          <StatusMark variant="filled" tone="error" label={t('Lỗi')} decorative /><span>{addressError}</span>
        </span>}
      </div>
      {instanceUrl && <div className="setting-control">
        <Button variant="ghost" disabled={busy} onClick={() => onInstanceUrl('')}><Trash2 size={14} />{t('Xóa địa chỉ')}</Button>
      </div>}
      <form className="setting-key-form" onSubmit={event => { event.preventDefault(); saveAddress(); }}>
        <input type="url" name="searxng-address" autoComplete="off" spellCheck={false} disabled={busy} value={addressDraft}
          placeholder="https://searx.example.org" aria-label={t('Địa chỉ máy chủ SearXNG')} aria-invalid={addressError ? true : undefined}
          onChange={event => { setAddressDraft(event.target.value); setAddressError(undefined); }} />
        <Button type="submit" variant="outline" disabled={busy || !addressDraft.trim() || addressDraft.trim() === (instanceUrl ?? '')}>{t('Lưu địa chỉ')}</Button>
      </form>
    </div>}
    <div className="setting-row">
      <div className="setting-text">
        <span className="setting-title">{t('Thử tìm kiếm')}</span>
        <span className={`setting-description web-search-outcome${outcome || missing ? ` ${outcome?.tone ?? 'error'}` : ''}`} aria-live="polite">
          {((outcome && !testing) || missing) && <StatusMark variant="filled" tone={missing && !outcome ? 'error' : outcome?.tone ?? 'error'} label={outcome?.tone === 'success' ? t('Tìm được') : t('Lỗi')} decorative />}
          <span>{testing ? t('Đang tìm “{0}”…', [WEB_SEARCH_TEST_QUERY]) : outcome ? outcome.text : missing ?? t('Tìm “{0}” và hiện kết quả đầu tiên.', [WEB_SEARCH_TEST_QUERY])}</span>
        </span>
      </div>
      <div className="setting-control">
        {/* The wait is told in the line beside it, so the button keeps one label and one width. */}
        <Button variant="outline" disabled={busy || testing || Boolean(missing)} onClick={() => void test()}><Search size={13} />{t('Chạy thử')}</Button>
      </div>
    </div>
  </>;
}
