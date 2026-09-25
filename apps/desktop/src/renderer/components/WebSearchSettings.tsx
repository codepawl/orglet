import { useEffect, useState } from 'react';
import { ExternalLink, Search, Trash2 } from 'lucide-react';
import type { Connections } from '../../shared/contracts';
import { WEB_SEARCH_PROVIDER_NAMES, WEB_SEARCH_TEST_QUERY, type WebSearchProvider } from '../../shared/web-tools';
import { Button } from './ui';
import { Select } from './Select';
import { StatusMark } from './StatusMark';
import { orglet } from '../api';
import { t, translated } from '../i18n';

/** Fake password dots for a saved key; the real key never comes back to the window. */
const SAVED_KEY_MASK = '••••••••••••••••';

/** What each provider means for the person, under the provider row. */
const providerNotes: Record<WebSearchProvider, string> = translated({
  exa: 'Miễn phí, không cần key; có giới hạn lượt.',
  duckduckgo: 'Không cần key; hay đòi xác minh người dùng.',
});

type Act = (action: () => Promise<string | void>, about?: string) => Promise<void>;
type Outcome = { tone: 'success' | 'error'; text: string };

/**
 * Settings → Web search (COD-266): where `web_search` sends a query, Exa's optional key, and a Test that runs one real
 * query. The key goes to main only; this component never learns more than "a key is saved". The Test result stays on
 * the row until the provider or the key changes, because it answers a question about exactly that setup.
 */
export function WebSearchSettings({ provider, hasKey, busy, act, onProvider, onConnections }: {
  provider: WebSearchProvider;
  hasKey: boolean;
  busy: boolean;
  act: Act;
  onProvider: (provider: WebSearchProvider) => void;
  onConnections: (next: Connections) => void;
}) {
  const [draft, setDraft] = useState('');
  const [replacing, setReplacing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>();
  const name = WEB_SEARCH_PROVIDER_NAMES[provider];
  const showMask = hasKey && !draft && !replacing;
  useEffect(() => setOutcome(undefined), [provider, hasKey]);

  const saveKey = () => {
    const key = draft.trim();
    if (!key || key === SAVED_KEY_MASK) return;
    void act(async () => {
      onConnections(await orglet.saveWebSearchKey('exa', key));
      setDraft('');
      setReplacing(false);
      return t('Đã lưu Exa API key');
    }, 'Exa');
  };
  const removeKey = () => void act(async () => {
    onConnections(await orglet.removeWebSearchKey('exa'));
    return t('Đã xóa Exa API key');
  }, 'Exa');
  const test = async () => {
    setOutcome(undefined);
    setTesting(true);
    try {
      const result = await orglet.call('testWebSearch', {});
      const text = result.title ? t('Kết quả đầu: {0}', [result.title]) : t('{0} trả lời nhưng không có kết quả nào.', [name]);
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
          onChange={value => onProvider(value as WebSearchProvider)}
          options={[{ value: 'exa', label: 'Exa', note: t('mặc định') }, { value: 'duckduckgo', label: 'DuckDuckGo' }]} menuMinWidth={210} />
      </div>
    </div>
    {provider === 'exa' && <div role="region" aria-labelledby="exa-key-title" className="setting-row web-search-key">
      <div className="setting-text">
        <span id="exa-key-title" className="setting-title">{t('Exa API key')}</span>
        {/* Where to get a key matters only while there is none. */}
        <span className="setting-description">{hasKey ? t('Đã lưu. Tìm kiếm dùng lượt của tài khoản Exa của bạn.') : <>
          {t('Không bắt buộc. Thêm key khi hết lượt miễn phí.')} · <button type="button" className="text-link" disabled={busy}
            onClick={() => void act(async () => { await orglet.openLink('exaKeys'); }, 'Exa')}>{t('Lấy key')}<ExternalLink size={12} aria-hidden="true" /></button>
        </>}</span>
      </div>
      {hasKey && <div className="setting-control">
        <Button variant="ghost" disabled={busy} onClick={removeKey}><Trash2 size={14} />{t('Xóa key')}</Button>
      </div>}
      {/* The key takes a line of its own under the row, like the API keys. */}
      <form className="setting-key-form" onSubmit={event => { event.preventDefault(); saveKey(); }}>
        <input type="password" name="exa-api-key" autoComplete="off" spellCheck={false} disabled={busy} value={showMask ? SAVED_KEY_MASK : draft}
          placeholder={hasKey ? t('Nhập key mới để thay') : t('Dán hoặc nhập API key')} aria-label={t('API key {0}', ['Exa'])}
          onFocus={() => { if (hasKey && !draft) setReplacing(true); }} onBlur={() => { if (!draft) setReplacing(false); }}
          onChange={event => setDraft(event.target.value)} />
        <Button type="submit" variant="outline" disabled={busy || !draft.trim()}>{t('Lưu key')}</Button>
      </form>
    </div>}
    <div className="setting-row">
      <div className="setting-text">
        <span className="setting-title">{t('Thử tìm kiếm')}</span>
        <span className={`setting-description web-search-outcome${outcome ? ` ${outcome.tone}` : ''}`} aria-live="polite">
          {outcome && !testing && <StatusMark variant="filled" tone={outcome.tone} label={outcome.tone === 'success' ? t('Tìm được') : t('Lỗi')} decorative />}
          <span>{testing ? t('Đang tìm “{0}”…', [WEB_SEARCH_TEST_QUERY]) : outcome ? outcome.text : t('Tìm “{0}” và hiện kết quả đầu tiên.', [WEB_SEARCH_TEST_QUERY])}</span>
        </span>
      </div>
      <div className="setting-control">
        {/* The wait is told in the line beside it, so the button keeps one label and one width. */}
        <Button variant="outline" disabled={busy || testing} onClick={() => void test()}><Search size={13} />{t('Chạy thử')}</Button>
      </div>
    </div>
  </>;
}
