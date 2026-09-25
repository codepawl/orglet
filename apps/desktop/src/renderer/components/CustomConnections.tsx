import { useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, KeyRound, Link2, Pencil, Plus, Tag, Trash2 } from 'lucide-react';
import type { Connections } from '../../shared/contracts';
import {
  baseUrlHost, checkBaseUrl, connectionPricing, customProviderId, MAX_CUSTOM_CONNECTIONS, MAX_PRICE_MICROS_PER_MILLION,
  type CustomConnection, type CustomConnectionPrice,
} from '../../shared/custom-connections';
import { pricingLabel } from '../customConnections';
import { toAmount, toMicros } from './money';
import { Input } from '@codepawl/orglet-ui';
import { AnchoredPopover } from './AnchoredPopover';
import { Button, FieldLabel, MoneyInput, PanelHeading } from './ui';
import { ProviderMark } from './ProviderMark';
import { RowMenu } from './RowMenu';
import { toast } from './toast';
import { modelLists } from '../caches';
import { orglet } from '../api';
import { t, tMessage } from '../i18n';

/** Prices are typed in the display currency, per million tokens, and stored as USD micros. */
type Draft = { id?: string; name: string; baseUrl: string; key: string; inputPrice: string; outputPrice: string };
type PriceCheck = { ok: true; price: CustomConnectionPrice | null } | { ok: false; error: string };

/** Both prices or neither: one side alone would bill half of every request at an invented zero. */
function priceOf(draft: Draft): PriceCheck {
  const input = draft.inputPrice.trim();
  const output = draft.outputPrice.trim();
  if (!input && !output) return { ok: true, price: null };
  if (!input || !output) return { ok: false, error: t('Nhập cả giá vào và giá ra, hoặc để trống cả hai.') };
  const inputMicrosPerMillion = toMicros(input);
  const outputMicrosPerMillion = toMicros(output);
  const valid = (micros: number) => Number.isSafeInteger(micros) && micros >= 0 && micros <= MAX_PRICE_MICROS_PER_MILLION;
  if (!valid(inputMicrosPerMillion) || !valid(outputMicrosPerMillion)) return { ok: false, error: t('Giá phải là số không âm, tối đa 1.000 USD mỗi 1M token.') };
  return { ok: true, price: { inputMicrosPerMillion, outputMicrosPerMillion } };
}

function draftOf(connection?: CustomConnection): Draft {
  if (!connection) return { name: '', baseUrl: '', key: '', inputPrice: '', outputPrice: '' };
  return {
    id: connection.id, name: connection.name, baseUrl: connection.baseUrl, key: '',
    inputPrice: connection.price ? toAmount(connection.price.inputMicrosPerMillion) : '',
    outputPrice: connection.price ? toAmount(connection.price.outputMicrosPerMillion) : '',
  };
}

/** A row's second line: host, price and key. The short form fits the settings dialog; the full one is its tooltip. */
function metaLine(connection: CustomConnection, hasKey: boolean, full: boolean): string {
  const key = full
    ? (hasKey ? t('Đã lưu API key') : t('Không có API key'))
    : (hasKey ? t('Đã lưu key') : t('Không có key'));
  return [baseUrlHost(connection.baseUrl), pricingLabel(connection, full), key].join(' · ');
}

/** What leaving both prices empty means for the address typed so far. */
function emptyPriceNote(baseUrl: string): string {
  const checked = checkBaseUrl(baseUrl);
  if (!checked.ok) return t('Để trống thì máy chủ trên máy này hoặc mạng nội bộ được tính miễn phí; máy chủ khác chưa rõ giá.');
  if (connectionPricing({ baseUrl: checked.url }).kind === 'local') return t('Để trống thì miễn phí, vì máy chủ nằm trên máy này hoặc mạng nội bộ.');
  return t('Để trống thì chưa rõ giá: mỗi request giữ chỗ phần còn lại của giới hạn mỗi task cho tới khi bạn đối soát.');
}
type Act = (action: () => Promise<string | void>, about?: string) => Promise<void>;

/**
 * Custom OpenAI-compatible connections in Settings → API connections (COD-242): one row per connection with its
 * address and whether a key is saved, a menu to edit, drop the key or delete it, and a small form beside the trigger
 * to add or change one. The key goes to main only; this component never learns more than "a key is saved".
 */
export function CustomConnectionsSection({ connections, keys, busy, act, onConnections }: {
  connections: readonly CustomConnection[];
  keys: Connections['custom'];
  busy: boolean;
  act: Act;
  onConnections: (next: Connections) => void;
}) {
  const addButton = useRef<HTMLButtonElement>(null);
  const [adding, setAdding] = useState(false);
  const full = connections.length >= MAX_CUSTOM_CONNECTIONS;
  const closeAdd = () => setAdding(false);

  return <section className="custom-connections" aria-labelledby="custom-connections-title">
    <PanelHeading level={3} title={<span id="custom-connections-title">{t('Kết nối tùy chỉnh')}</span>}
      description={t('Mọi máy chủ tương thích OpenAI.')}>
      <Button ref={addButton} variant="outline" disabled={busy || full} aria-haspopup="dialog" aria-expanded={adding} onClick={() => setAdding(open => !open)}>
        <Plus size={14} />{t('Thêm kết nối')}
      </Button>
    </PanelHeading>
    {connections.map(connection => <CustomConnectionRow key={connection.id} connection={connection} hasKey={Boolean(keys[connection.id])}
      busy={busy} act={act} onConnections={onConnections} />)}
    <AnchoredPopover anchor={addButton} open={adding} onClose={closeAdd} label={t('Thêm kết nối')}>
      <CustomConnectionForm initial={draftOf()} hasKey={false} onDone={closeAdd} onConnections={onConnections} />
    </AnchoredPopover>
  </section>;
}

function CustomConnectionRow({ connection, hasKey, busy, act, onConnections }: {
  connection: CustomConnection; hasKey: boolean; busy: boolean; act: Act; onConnections: (next: Connections) => void;
}) {
  const row = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const titleId = `custom-${connection.id}-title`;
  const provider = customProviderId(connection.id);
  const closeEdit = () => setEditing(false);
  const removeKey = () => void act(async () => {
    onConnections(await orglet.disconnect(provider));
    modelLists.invalidate();
    return t('Đã xóa API key của {0}', [connection.name]);
  }, connection.name);
  const remove = () => void act(async () => {
    await orglet.call('deleteCustomConnection', { id: connection.id });
    onConnections(await orglet.connections());
    modelLists.invalidate();
    return t('Đã xóa kết nối {0}', [connection.name]);
  }, connection.name);

  return <div ref={row} role="region" aria-labelledby={titleId} className="setting-row setting-connection custom-connection-row">
    <ProviderMark provider={provider} decorative />
    <div className="setting-text">
      <span id={titleId} className="setting-title">{connection.name}</span>
      {/* One line: the short form, cut with an ellipsis if it still does not fit; the full wording is in its tooltip. */}
      <span className="setting-description custom-connection-meta" title={metaLine(connection, hasKey, true)}>{metaLine(connection, hasKey, false)}</span>
    </div>
    <div className="setting-control">
      <RowMenu label={t('Kết nối {0}', [connection.name])} items={[
        { label: t('Chỉnh sửa'), icon: Pencil, onSelect: () => setEditing(true) },
        ...(hasKey ? [{ label: t('Xóa API key'), icon: KeyRound, onSelect: removeKey }] : []),
        { label: t('Xóa kết nối'), icon: Trash2, danger: true, onSelect: remove,
          confirm: { question: t('Xóa kết nối này và API key của nó?'), label: t('Xóa') } },
      ]} />
    </div>
    <AnchoredPopover anchor={row} open={editing} onClose={closeEdit} label={t('Sửa kết nối {0}', [connection.name])}>
      <CustomConnectionForm initial={draftOf(connection)}
        hasKey={hasKey} onDone={closeEdit} onConnections={onConnections} disabled={busy} />
    </AnchoredPopover>
  </div>;
}

/**
 * Name, base URL, an optional key and an optional price per million tokens. The address is checked as it is typed;
 * the core checks it again on save.
 */
function CustomConnectionForm({ initial, hasKey, onDone, onConnections, disabled = false }: {
  initial: Draft; hasKey: boolean; onDone: () => void; onConnections: (next: Connections) => void; disabled?: boolean;
}) {
  const [draft, setDraft] = useState(initial);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const urlCheck = checkBaseUrl(draft.baseUrl);
  const urlError = touched && draft.baseUrl.trim() && !urlCheck.ok ? tMessage(urlCheck.error) : '';
  const priceCheck = priceOf(draft);
  const priceError = touched && !priceCheck.ok ? priceCheck.error : '';
  const change = (field: keyof Draft) => (value: string) => {
    setDraft(current => ({ ...current, [field]: value }));
    setError('');
  };

  /**
   * The name and address go to the core first, then the key to main when one was typed. A key main refuses leaves the
   * connection saved without one, and the form stays open on that saved connection so the key can be fixed.
   */
  const submit = async () => {
    setTouched(true);
    if (!draft.name.trim() || !urlCheck.ok || !priceCheck.ok) return;
    setSaving(true);
    try {
      const saved = await orglet.call('saveCustomConnection', {
        ...(draft.id ? { id: draft.id } : {}),
        name: draft.name.trim(),
        baseUrl: draft.baseUrl.trim(),
        price: priceCheck.price,
      });
      setDraft(current => ({ ...current, id: saved.id }));
      modelLists.invalidate();
      const key = draft.key.trim();
      if (key) onConnections(await orglet.connect(customProviderId(saved.id), key));
      toast(draft.id ? t('Đã lưu kết nối {0}', [saved.name]) : t('Đã thêm kết nối {0}', [saved.name]), 'success', saved.name);
      onDone();
    } catch (failure) {
      setError(tMessage((failure as Error).message));
    } finally {
      setSaving(false);
    }
  };

  const busy = saving || disabled;
  return <form className="form custom-connection-form" noValidate onSubmit={event => { event.preventDefault(); void submit(); }}>
    <label><FieldLabel icon={Tag} required>{t('Tên')}</FieldLabel>
      <Input autoFocus value={draft.name} maxLength={60} disabled={busy} placeholder={t('Ví dụ: LM Studio')}
        invalid={touched && !draft.name.trim()} onChange={event => change('name')(event.target.value)} />
    </label>
    <label><FieldLabel icon={Link2} required>{t('Địa chỉ gốc')}</FieldLabel>
      <Input value={draft.baseUrl} maxLength={500} disabled={busy} placeholder="http://localhost:1234/v1" spellCheck={false}
        inputMode="url" invalid={Boolean(urlError)} aria-describedby={urlError ? 'custom-connection-url-error' : undefined}
        onBlur={() => setTouched(true)} onChange={event => change('baseUrl')(event.target.value)} />
      {urlError && <span className="error" id="custom-connection-url-error">{urlError}</span>}
    </label>
    <label><FieldLabel icon={KeyRound}>{t('API key')}</FieldLabel>
      <Input type="password" value={draft.key} maxLength={500} disabled={busy} autoComplete="off" spellCheck={false}
        placeholder={hasKey ? t('Đã lưu · nhập key mới để thay') : t('Không cần cho máy chủ trên máy này')}
        onChange={event => change('key')(event.target.value)} />
    </label>
    <div className="custom-connection-prices">
      <label><FieldLabel icon={ArrowDownToLine}>{t('Giá vào')}</FieldLabel>
        <MoneyInput value={draft.inputPrice} disabled={busy} placeholder="0" invalid={Boolean(priceError)} onChange={change('inputPrice')} />
      </label>
      <label><FieldLabel icon={ArrowUpFromLine}>{t('Giá ra')}</FieldLabel>
        <MoneyInput value={draft.outputPrice} disabled={busy} placeholder="0" invalid={Boolean(priceError)} onChange={change('outputPrice')} />
      </label>
      <span className={priceError ? 'error' : 'muted'}>{priceError || `${t('Giá cho mỗi 1M token.')} ${priceCheck.ok && priceCheck.price ? t('Tính như API trả phí: giữ chỗ trước, chốt theo số token thật.') : emptyPriceNote(draft.baseUrl)}`}</span>
    </div>
    <div className="custom-connection-actions">
      {error ? <p className="form-error" role="alert">{error}</p> : <span className="dialog-footer-spacer" />}
      <Button type="button" variant="ghost" disabled={saving} onClick={onDone}>{t('Hủy')}</Button>
      <Button type="submit" variant="primary" disabled={busy}>{t('Lưu')}</Button>
    </div>
  </form>;
}
